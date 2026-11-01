import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { MinimumLogLevel } from "effect/References";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { redactingLoggerLayer } from "../../src/identity/logger.ts";
import { verifyAgentToken } from "../../src/identity/tokens.ts";
import { incarnationOf, makeFakeRunner } from "../support/fakeRunner.ts";
import {
  agentIdOf, call, headSequence, logAfter, makeFakeSecrets, makeRig, ownerCredential, provideRig, removeRig,
  seedAccount, seedAgent, seedHarness, stateOf, success, type Fakes, type Logged, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually, option, pause, requestPermission, requestRow, snapshot, standardOptions, tagged } from "../support/routingRig.ts";

// Unit 5c fix round 1, rulings 1, 3 and 4: the engine's consumer of runner
// events.
//
// - Ruling 1 (F-1, B4): one malformed event, or one event whose append
//   fails, must not end the consumer. The engine drops a malformed event
//   with a fixed log line and goes on with the next event.
// - Ruling 3 (B2, issue 61): `exited` carries an incarnation, and an exit
//   whose incarnation is not a live token hash of the named agent changes
//   nothing.
// - Ruling 4 (F-2): the incarnation check names the agent, so one agent's
//   live incarnation cannot act for another agent.
//
// Each case ends with a later, valid event the engine must still record. The
// stream is read in order, so once that event is written the earlier one
// has been read.

let rig: Rig;
beforeEach(() => {
  rig = makeRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPHERD_HOME", rig.stateFolder);
});
afterEach(() => {
  vi.unstubAllEnvs();
  removeRig(rig);
});

const withRig = <A, E, R>(body: (fakes: Fakes) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fakes: Fakes = { runner: yield* makeFakeRunner(), secrets: makeFakeSecrets() };
    return yield* provideRig(rig, fakes, Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAccount();
      yield* seedHarness();
      yield* fakes.runner.subscribed;
      return yield* body(fakes);
    }));
  });

// Log lines, captured through the redacting logger the service installs.
const capturing = (lines: Array<string>) => Layer.mergeAll(
  redactingLoggerLayer({ redactText: (text: string) => text }, (line) => { lines.push(line); }),
  Layer.succeed(MinimumLogLevel, "All"),
);

const tokenWorks = (raw: string) => verifyAgentToken(raw).pipe(Effect.result, Effect.map((result) => result._tag === "Success"));

// The agents of the turn ends written after `before`, in order. It waits
// until `expected` is reached or about four seconds pass, and does not fail
// itself, so the assertion shows what the engine wrote.
const turnEndsAfter = (before: number, expected: ReadonlyArray<string>) =>
  eventually(logAfter(before), (rows) => tagged(rows, "TurnEnded").length >= expected.length)
    .pipe(Effect.map((rows) => ({ rows, ended: tagged(rows, "TurnEnded").map((event) => event.agentId as string) })));

// A valid `turnEnded` for `who`, emitted with its current incarnation.
const turnEnded = (fakes: Fakes, who: { readonly agentId: string; readonly token: string }) =>
  fakes.runner.emit({ _tag: "turnEnded", agentId: agentIdOf(who.agentId), incarnation: incarnationOf(who.token) });

// A valid permission request from `who`, which the engine records (the
// control below proves it), as a plain object the cases break one field of.
const validRequest = (who: { readonly agentId: string; readonly token: string }, id: string) => ({
  _tag: "permissionRequested",
  agentId: who.agentId,
  incarnation: incarnationOf(who.token),
  permissionRequestId: id,
  toolCallId: "tool-planted-7c1e",
  description: "planted-description-5d0b: run the tests.",
  options: standardOptions,
  settingsWrite: false,
});

// The four inputs the cyber verifier used to end the consumer at 64fa63a.
const malformed: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["an empty permissionRequestId", { permissionRequestId: "" }],
  ["an option at level \"superuser\"", { options: [option("once", "allow_once", "ask"), { ...option("root", "allow_once", "ask"), level: "superuser" }] }],
  ["an empty toolCallId", { toolCallId: "" }],
  ["an empty option list", { options: [] }],
];

// ---------------------------------------------------------------------------
// Ruling 1: a bad event does not end the consumer
// ---------------------------------------------------------------------------

it.live("5c fix-1 ruling 1 control: catches a valid permission request, built as the malformed cases are built, that the engine does not record", () =>
  withRig((fakes) => Effect.gen(function* () {
    yield* seedAgent({ id: "lead" });
    const worker = yield* seedAgent({ id: "worker", parent: "lead", state: "working" });
    yield* fakes.runner.emitRaw(validRequest(worker, "perm-control"));
    const row = yield* eventually(requestRow("perm-control"), (found) => found !== undefined);
    expect(row).toMatchObject({ agentId: "worker", status: "open", toolCallId: "tool-planted-7c1e", options: standardOptions });
  })).pipe(Effect.orDie));

for (const [name, change] of malformed) {
  it.live(`5c fix-1 ruling 1, ${name}: catches a runner event that fails the event schema ending the consumer, being written, or reaching the log line`, () => {
    const lines: Array<string> = [];
    return withRig((fakes) => Effect.gen(function* () {
      yield* seedAgent({ id: "lead" });
      const worker = yield* seedAgent({ id: "worker", parent: "lead", state: "working" });
      const other = yield* seedAgent({ id: "other", state: "working" });
      const before = yield* headSequence;

      yield* fakes.runner.emitRaw({ ...validRequest(worker, "perm-malformed"), ...change });
      yield* turnEnded(fakes, other);
      yield* turnEnded(fakes, worker);
      const { rows, ended } = yield* turnEndsAfter(before, ["other", "worker"]);

      // Both later events are written, and the malformed one left no row.
      expect(ended).toEqual(["other", "worker"]);
      expect(rows.map((row: Logged) => row.event._tag)).toEqual(["TurnEnded", "TurnEnded"]);
      expect(tagged(rows, "PermissionRequested")).toEqual([]);
      expect(Object.values((yield* snapshot).requests)).toEqual([]);
      // Ruling 1's fixed line, with no content of the event.
      expect(lines.some((line) => line.includes("runner event dropped: malformed"))).toBe(true);
      for (const line of lines) {
        for (const content of ["planted-description-5d0b", "tool-planted-7c1e", "superuser"]) expect(line).not.toContain(content);
      }

      // The consumer still records a valid request from the same agent.
      const { row } = yield* requestPermission(fakes.runner, worker, { permissionRequestId: "perm-after" });
      expect(row).toMatchObject({ agentId: "worker", status: "open" });
    })).pipe(Effect.provide(capturing(lines)), Effect.orDie);
  });
}

// One captured line, parsed: the redacting logger writes one JSON object
// per line, with a `cause` only when one was logged.
const parsed = (line: string): { readonly message: unknown; readonly cause?: unknown } => JSON.parse(line);
const hasDefect = (cause: unknown): boolean =>
  Array.isArray(cause) && cause.some((reason) => (reason as { readonly _tag?: unknown })._tag === "Die");

// Criterion 4.5 (fix-1 lead ruling after the round 2 commit): after a write
// failure the event log refuses every later append until restart, so no
// later event can be written here. The consumer shows it is still reading
// by logging its fixed failure line once for each later event.
it.live("5c fix-1 ruling 1, append refused: catches one runner event whose append fails ending the consumer, logging event content, or letting a defect escape", () => {
  const lines: Array<string> = [];
  return withRig((fakes) => Effect.gen(function* () {
    yield* seedAgent({ id: "lead" });
    const asker = yield* seedAgent({ id: "asker-5c41", parent: "lead", state: "working" });
    const bystander = yield* seedAgent({ id: "bystander-5c41", state: "working" });
    const sql = yield* SqlClient.SqlClient;
    // The log refuses one kind of event, as a full disk or a broken file
    // would refuse a write; the refusal then latches (criterion 4.5).
    yield* sql.unsafe(`CREATE TRIGGER planted_failure BEFORE INSERT ON events WHEN NEW.event_type = 'PermissionRequested'
      BEGIN SELECT RAISE(ABORT, 'planted insert failure'); END`);
    const before = yield* headSequence;
    const mark = lines.length;

    // The refused event, then two later valid events, each read only if the
    // consumer survived the one before it.
    yield* fakes.runner.emitRaw(validRequest(asker, "perm-refused"));
    yield* turnEnded(fakes, bystander);
    yield* turnEnded(fakes, asker);
    yield* eventually(Effect.sync(() => lines.length - mark), (count) => count >= 3);
    yield* pause(200);
    const logged = lines.slice(mark);

    // One fixed line per event: three lines, the same message each time.
    expect(logged).toHaveLength(3);
    const messages = logged.map((line) => parsed(line).message);
    expect(typeof messages[0]).toBe("string");
    expect(messages[0]).not.toContain("malformed");
    expect(new Set(messages.map((message) => JSON.stringify(message))).size).toBe(1);
    // No event content and no escaped defect in any line.
    for (const line of logged) {
      for (const content of ["planted-description-5d0b", "tool-planted-7c1e", "perm-refused", "asker-5c41", "bystander-5c41", "planted insert failure"]) {
        expect(line).not.toContain(content);
      }
      expect(hasDefect(parsed(line).cause)).toBe(false);
    }
    // Nothing was written, and the refused request has no row.
    expect(yield* logAfter(before)).toEqual([]);
    expect(yield* requestRow("perm-refused")).toBeUndefined();
    expect(Object.values((yield* snapshot).requests)).toEqual([]);
  })).pipe(Effect.provide(capturing(lines)), Effect.orDie);
});

// ---------------------------------------------------------------------------
// Ruling 3: `exited` is bound to its spawn
// ---------------------------------------------------------------------------

it.live("5c fix-1 ruling 3(a), current incarnation: catches an exit of the agent's own current spawn that no longer crashes it or leaves its token live", () =>
  withRig((fakes) => Effect.gen(function* () {
    const solo = yield* seedAgent({ id: "solo", state: "working" });
    const before = yield* headSequence;
    yield* fakes.runner.emit({
      _tag: "exited", agentId: agentIdOf("solo"), incarnation: incarnationOf(solo.token), exitCode: 1, signal: null, stderr: "",
    });
    expect(yield* eventually(stateOf("solo"), (state) => state === "crashed")).toBe("crashed");
    expect(yield* tokenWorks(solo.token)).toBe(false);
    expect(tagged(yield* logAfter(before), "AgentCrashed")).toEqual([expect.objectContaining({ agentId: "solo", exitCode: 1 })]);
  })).pipe(Effect.orDie));

it.live("5c fix-1 ruling 3(b), earlier spawn: catches a late exit of the spawn before a stop and resume that crashes the new run or revokes its new token", () =>
  withRig((fakes) => Effect.gen(function* () {
    const solo = yield* seedAgent({ id: "solo", state: "working" });
    const other = yield* seedAgent({ id: "other", state: "working" });
    success(yield* call(ownerCredential, "stop", { agentId: "solo" }));
    success(yield* call(ownerCredential, "resume", { agentId: "solo" }));
    const loads = fakes.runner.callsOf("load");
    expect(loads).toHaveLength(1);
    const newToken = Redacted.value(loads[0]!.input.token);
    const resumed = yield* stateOf("solo");
    expect(resumed).toBe("idle");
    expect(yield* tokenWorks(newToken)).toBe(true);
    const before = yield* headSequence;

    yield* fakes.runner.emit({
      _tag: "exited", agentId: agentIdOf("solo"), incarnation: incarnationOf(solo.token), exitCode: 1, signal: null, stderr: "",
    });
    yield* turnEnded(fakes, other);
    const { rows, ended } = yield* turnEndsAfter(before, ["other"]);
    expect(ended).toEqual(["other"]);
    expect(tagged(rows, "AgentCrashed")).toEqual([]);
    expect(yield* stateOf("solo")).toBe(resumed);
    expect(yield* tokenWorks(newToken)).toBe(true);
  })).pipe(Effect.orDie));

it.live("5c fix-1 ruling 3(c), another agent's incarnation: catches an exit naming agent B, carrying agent A's live incarnation, that crashes B or revokes either token", () =>
  withRig((fakes) => Effect.gen(function* () {
    const first = yield* seedAgent({ id: "agent-a", state: "working" });
    const second = yield* seedAgent({ id: "agent-b", state: "working" });
    const other = yield* seedAgent({ id: "other", state: "working" });
    const before = yield* headSequence;

    yield* fakes.runner.emit({
      _tag: "exited", agentId: agentIdOf("agent-b"), incarnation: incarnationOf(first.token), exitCode: 1, signal: null, stderr: "",
    });
    yield* turnEnded(fakes, other);
    const { rows, ended } = yield* turnEndsAfter(before, ["other"]);
    expect(ended).toEqual(["other"]);
    expect(tagged(rows, "AgentCrashed")).toEqual([]);
    expect(yield* stateOf("agent-b")).toBe("working");
    expect(yield* stateOf("agent-a")).toBe("working");
    expect(yield* tokenWorks(second.token)).toBe(true);
    expect(yield* tokenWorks(first.token)).toBe(true);
  })).pipe(Effect.orDie));

// ---------------------------------------------------------------------------
// Ruling 4: the incarnation check names the agent
// ---------------------------------------------------------------------------

it.live("5c fix-1 ruling 4, turn end: catches a turn end naming agent B, carrying agent A's live incarnation, that writes \"turn ended\" for B (the agent_id condition dropped)", () =>
  withRig((fakes) => Effect.gen(function* () {
    const first = yield* seedAgent({ id: "agent-a", state: "working" });
    yield* seedAgent({ id: "agent-b", state: "working" });
    const other = yield* seedAgent({ id: "other", state: "working" });
    const before = yield* headSequence;

    yield* fakes.runner.emit({ _tag: "turnEnded", agentId: agentIdOf("agent-b"), incarnation: incarnationOf(first.token) });
    yield* turnEnded(fakes, other);
    const { rows, ended } = yield* turnEndsAfter(before, ["other"]);
    expect(ended).toEqual(["other"]);
    expect(rows.map((row: Logged) => row.event._tag)).toEqual(["TurnEnded"]);
    expect(yield* stateOf("agent-b")).toBe("working");
  })).pipe(Effect.orDie));

it.live("5c fix-1 ruling 4, permission request: catches a request naming agent B, carrying agent A's live incarnation, that is recorded for B (the agent_id condition dropped)", () =>
  withRig((fakes) => Effect.gen(function* () {
    const first = yield* seedAgent({ id: "agent-a", state: "working" });
    yield* seedAgent({ id: "agent-b", state: "working" });
    const other = yield* seedAgent({ id: "other", state: "working" });
    const before = yield* headSequence;

    yield* fakes.runner.emit({
      _tag: "permissionRequested", agentId: agentIdOf("agent-b"), incarnation: incarnationOf(first.token),
      permissionRequestId: "perm-borrowed", toolCallId: "tool-borrowed", description: "Borrowed incarnation.",
      options: standardOptions, settingsWrite: false,
    });
    yield* turnEnded(fakes, other);
    const { rows, ended } = yield* turnEndsAfter(before, ["other"]);
    expect(ended).toEqual(["other"]);
    expect(rows.map((row: Logged) => row.event._tag)).toEqual(["TurnEnded"]);
    expect(yield* requestRow("perm-borrowed")).toBeUndefined();
  })).pipe(Effect.orDie));
