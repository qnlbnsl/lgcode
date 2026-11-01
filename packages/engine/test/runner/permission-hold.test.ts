import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { mapPermissionOption } from "../../src/runner/permissions.ts";
import type { RunnerEvent } from "../../src/runner/Runner.ts";
import {
  accountFor, deliveryFor, echoFile, harnessFor, makeRunnerRig, peekEcho, readEcho, removeRunnerRig, spawnFor,
  startPayloadFor, withAcpRunner, withEngine, writeFakeAdapter, type Echo, type RunnerContext, type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { call, failureOf, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually, pause, tagged } from "../support/routingRig.ts";

// Criterion 6.3 (task 6a.3; rows 35b, 56, 65; issues 68, 72, 73): a
// permission request holds the agent until it is answered, then releases it
// with the chosen option. The runner mints the request identifier itself,
// unique across agents, maps every option onto Shepherd's scale, and marks a
// request that would write a harness settings path.

let rig: RunnerRig;
beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPHERD_HOME", rig.stateFolder);
});
afterEach(() => {
  vi.unstubAllEnvs();
  removeRunnerRig(rig);
});

registerRebuildCheck({ noLog: true });

// Every requirement is provided inside the test; the cast keeps a missing
// module from widening the requirement type.
const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => test() as Effect.Effect<unknown, unknown, never>, 60_000);

const options = [
  { optionId: "allow-once", name: "Yes", kind: "allow_once" },
  { optionId: "allow-with-updates", name: "Yes, and don't ask again", kind: "allow_always" },
  { optionId: "reject", name: "No", kind: "reject_once" },
];
const permissionStep = (toolCallId: string, locations?: ReadonlyArray<{ path: string }>) => ({
  step: "permission", toolCallId, title: "Run the tests", options, ...(locations === undefined ? {} : { locations }),
});

// The replies the child received to its own requests (frames with a result).
const repliesIn = (echo: Echo | undefined) => (echo?.inbound ?? []).filter((frame) => frame.method === undefined && frame.result !== undefined);

const permissionEvents = (events: ReadonlyArray<RunnerEvent>) =>
  events.filter((event): event is Extract<RunnerEvent, { _tag: "permissionRequested" }> => event._tag === "permissionRequested");

const startPrompted = (context: RunnerContext, turn: ReadonlyArray<Record<string, unknown>>) => Effect.gen(function* () {
  const echo = echoFile(rig);
  const spawn = yield* spawnFor(rig, harnessFor("first", writeFakeAdapter(rig)), accountFor("first", { turns: [turn] }, echo));
  yield* context.runner.start(spawn.input);
  const delivery = deliveryFor(spawn.agentId, "go");
  yield* context.runner.prompt({ agentId: spawn.agentId, incarnation: spawn.incarnation, delivery });
  return { ...spawn, echo, delivery };
});

live("6.3 hold: the agent waits until the owner answers, then gets exactly the chosen option and finishes its turn (breaks if the runner answers by itself, releases the agent early, or sends a different option)", () =>
  Effect.gen(function* () {
    const echo = echoFile(rig);
    const harness = harnessFor("first", writeFakeAdapter(rig));
    const account = accountFor("first", { turns: [[permissionStep("tool-hold-1"), { step: "text", text: "after the answer" }]] }, echo);
    return yield* withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "go" })));
      const asked = yield* eventually(readLog, (rows) => tagged(rows, "PermissionRequested").length > 0);
      const request = tagged(asked, "PermissionRequested")[0]!;
      expect(request.toolCallId).toBe("tool-hold-1");
      yield* pause(600);
      const held = yield* readLog;
      expect(tagged(held, "TurnEnded")).toEqual([]);
      expect(JSON.stringify(tagged(held, "ThreadItem"))).not.toContain("permission:");
      expect(repliesIn(peekEcho(echo))).toEqual([]);
      success(yield* call(ownerCredential, "answer", { kind: "permission", id: request.permissionRequestId, optionId: "allow-once" }));
      const rows = yield* eventually(readLog, (current) => tagged(current, "TurnEnded").length > 0);
      expect(JSON.stringify(tagged(rows, "ThreadItem"))).toContain("permission:selected:allow-once");
      const replies = repliesIn(yield* readEcho(echo));
      expect(replies).toHaveLength(1);
      expect(replies[0]!.result).toEqual({ outcome: { outcome: "selected", optionId: "allow-once" } });
    }));
  }));

live("6.3 issue 72: two agents asking with the same tool call id and protocol id get distinct runner-minted request ids, and an answer reaches only its own agent (breaks if the runner forwards the child's request or tool call id, or answers by request id without the agent)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const first = yield* startPrompted(context, [permissionStep("tool-same")]);
    const second = yield* startPrompted(context, [permissionStep("tool-same")]);
    yield* context.waitFor((event) => event._tag === "permissionRequested" && event.agentId === second.agentId);
    yield* context.waitFor((event) => event._tag === "permissionRequested" && event.agentId === first.agentId);
    const requests = permissionEvents(context.events);
    expect(requests).toHaveLength(2);
    const [a, b] = [requests.find((event) => event.agentId === first.agentId)!, requests.find((event) => event.agentId === second.agentId)!];
    expect(a.permissionRequestId).not.toBe(b.permissionRequestId);
    for (const event of [a, b]) {
      expect(event.toolCallId).toBe("tool-same");
      expect(event.permissionRequestId).not.toBe("tool-same");
      expect(["0", "1", "2"]).not.toContain(event.permissionRequestId);
    }
    expect(a).toMatchObject({ incarnation: first.incarnation });
    expect(b).toMatchObject({ incarnation: second.incarnation });
    // The first agent's request id under the second agent's name is refused.
    const crossed = yield* context.runner.answerPermission({ agentId: second.agentId, requestId: a.permissionRequestId, optionId: "allow-once" }).pipe(Effect.result);
    expect(crossed._tag).toBe("Failure");
    yield* context.runner.answerPermission({ agentId: first.agentId, requestId: a.permissionRequestId, optionId: "reject" });
    yield* context.waitFor((event) => event._tag === "deliveryUpdate" && event.agentId === first.agentId && event.text === "permission:selected:reject");
    yield* pause(300);
    expect(repliesIn(peekEcho(second.echo))).toEqual([]);
  })));

live("6.3 unknown answers: an answer for a request id the runner never minted, or an option the request did not offer, is refused and sends nothing (breaks if the runner forwards any answer to the child)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const agent = yield* startPrompted(context, [permissionStep("tool-unknown")]);
    const request = (yield* context.waitFor((event) => event._tag === "permissionRequested" && event.agentId === agent.agentId)) as Extract<RunnerEvent, { _tag: "permissionRequested" }>;
    const unknown = yield* context.runner.answerPermission({ agentId: agent.agentId, requestId: "never-minted", optionId: "allow-once" }).pipe(Effect.result);
    const badOption = yield* context.runner.answerPermission({ agentId: agent.agentId, requestId: request.permissionRequestId, optionId: "allow-everything" }).pipe(Effect.result);
    expect(unknown._tag).toBe("Failure");
    expect(badOption._tag).toBe("Failure");
    yield* pause(300);
    expect(repliesIn(peekEcho(agent.echo))).toEqual([]);
  })));

live("6.3 rows 56 and 65: a request whose tool call touches a harness settings path is marked settingsWrite, and one that does not is not (breaks if settingsWrite is hard-coded or ignores the tool call's locations)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const cases = [
      { path: `${rig.work}/.claude/settings.local.json`, settingsWrite: true },
      { path: `${rig.work}/.mcp.json`, settingsWrite: true },
      { path: `${rig.work}/.codex/config.toml`, settingsWrite: true },
      { path: `${rig.work}/.Cursor/cli.json`, settingsWrite: true },
      { path: `${rig.work}/src/index.ts`, settingsWrite: false },
    ];
    for (const entry of cases) {
      const agent = yield* startPrompted(context, [permissionStep(`tool-${cases.indexOf(entry)}`, [{ path: entry.path }])]);
      const request = yield* context.waitFor((event) => event._tag === "permissionRequested" && event.agentId === agent.agentId);
      expect(request, entry.path).toMatchObject({ settingsWrite: entry.settingsWrite });
    }
  })));

live("6.3 mapped options: the request carries every offered option with its id, name and kind, mapped by the runner's own table (breaks if the event carries raw options, or a mapping other than mapPermissionOption)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const agent = yield* startPrompted(context, [permissionStep("tool-map")]);
    const request = (yield* context.waitFor((event) => event._tag === "permissionRequested" && event.agentId === agent.agentId)) as Extract<RunnerEvent, { _tag: "permissionRequested" }>;
    expect(request.options).toEqual(options.map((option) => mapPermissionOption("first", option)));
  })));

// Rows 35b and 56, issue 73, and the first harness's adapter source
// (`@agentclientprotocol/claude-agent-acp` 0.99.1,
// dist/permissions/options/shared.js and tools.js, read 2026-11-01). The
// level is the highest the option can lead to; persistent means its effect
// outlives the session or changes the session's own mode, so the owner
// must answer it whatever the ceiling.
const claudeOptions: ReadonlyArray<readonly [string, string, string, { level: string; persistent: boolean }]> = [
  ["allow-once", "Yes", "allow_once", { level: "ask", persistent: false }],
  ["reject", "No", "reject_once", { level: "read-only", persistent: false }],
  // Writes an allow rule to `.claude/settings.local.json`.
  ["allow-with-updates", "Yes, and don't ask again", "allow_always", { level: "edit", persistent: true }],
  ["allow-skill-exact", "Yes, and don't ask again for build", "allow_always", { level: "edit", persistent: true }],
  // Leaving plan mode into bypass or auto mode raises the session to full,
  // although the adapter labels it allow_always like a saved rule.
  ["exit-plan-bypass", "Yes, and bypass permissions", "allow_always", { level: "full", persistent: true }],
  ["exit-plan-clear-bypass", "Yes, clear context and bypass permissions", "allow_always", { level: "full", persistent: true }],
  ["exit-plan-auto", "Yes, and use auto mode", "allow_always", { level: "full", persistent: true }],
  ["exit-plan-clear-auto", "Yes, clear context and use auto mode", "allow_always", { level: "full", persistent: true }],
  ["exit-plan-accept-edits", "Yes, auto-accept edits", "allow_always", { level: "edit", persistent: true }],
  ["exit-plan-clear-accept-edits", "Yes, clear context and auto-accept edits", "allow_always", { level: "edit", persistent: true }],
  // Leaves plan mode for the default mode, which asks before edits.
  ["exit-plan-default", "Yes, manually approve edits", "allow_once", { level: "ask", persistent: false }],
];

it("6.3 option table, first harness (rows 35b, 56, issue 73): each recorded option id maps to the level it can reach and its persistence, with id, name and kind kept (breaks if the mapping uses the option kind alone, which lets a mode-raising allow_always pass as edit)", () => {
  for (const [optionId, name, kind, want] of claudeOptions) {
    expect(mapPermissionOption("claude", { optionId, name, kind }), optionId).toEqual({ id: optionId, name, kind, ...want });
  }
});

it("6.3 option table, any harness (rows 35b, 56): the four protocol kinds map onto Shepherd's scale, and an unknown kind is full and persistent, so only the owner can choose it (breaks if an unknown kind fails open)", () => {
  const kinds: ReadonlyArray<readonly [string, { level: string; persistent: boolean }]> = [
    ["allow_once", { level: "ask", persistent: false }],
    ["allow_always", { level: "edit", persistent: true }],
    ["reject_once", { level: "read-only", persistent: false }],
    ["reject_always", { level: "read-only", persistent: true }],
    ["allow_for_ever_and_ever", { level: "full", persistent: true }],
    ["", { level: "full", persistent: true }],
  ];
  for (const harness of ["codex", "gemini", "cursor", "first"]) {
    for (const [kind, want] of kinds) {
      expect(mapPermissionOption(harness, { optionId: `option-${kind}`, name: "Option", kind }), `${harness} ${kind}`).toMatchObject(want);
    }
  }
});

live("6.3 issue 68: when the asking child dies before the answer, the engine records the crash, and a later answer is either refused or its failed delivery is logged, never silently lost (breaks if a committed answer to a dead process leaves no record)", () =>
  Effect.gen(function* () {
    const echo = echoFile(rig);
    const harness = harnessFor("first", writeFakeAdapter(rig));
    const account = accountFor("first", { turns: [[permissionStep("tool-dies")]] }, echo);
    return yield* withEngine(rig, { harness, accounts: [account] }, (context) => Effect.gen(function* () {
      yield* registerRebuildCheck();
      success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "go" })));
      const asked = yield* eventually(readLog, (rows) => tagged(rows, "PermissionRequested").length > 0);
      const request = tagged(asked, "PermissionRequested")[0]!;
      process.kill((yield* readEcho(echo)).pid, "SIGKILL");
      yield* eventually(readLog, (rows) => tagged(rows, "AgentCrashed").length > 0);
      const linesBefore = context.logLines.length;
      const outcome = yield* call(ownerCredential, "answer", { kind: "permission", id: request.permissionRequestId, optionId: "allow-once" });
      const rows = yield* readLog;
      expect(tagged(rows, "AgentCrashed")).toHaveLength(1);
      if (failureOf(outcome) === undefined) {
        yield* pause(300);
        expect(context.logLines.slice(linesBefore).some((line) => line.includes("permission answer delivery failed"))).toBe(true);
      }
    }));
  }));
