import { existsSync, readFileSync } from "node:fs";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, it as plainIt, vi } from "vitest";

import { parseReplay, ReplayParseError } from "../../../testing/src/replay.ts";
import type { RunnerEvent } from "../../src/runner/Runner.ts";
import {
  accountFor, alive, deliveryFor, echoFile, fixturePath, harnessFor, makeRunnerRig, readEcho, removeRunnerRig, spawnFor,
  startPayloadFor, withAcpRunner, withEngine, writeFakeAdapter, writeReplayAdapter, type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { call, logAfter, headSequence, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually, tagged } from "../support/routingRig.ts";

// Criterion 6.2, second half (task 6a.2; row 51; issues 38, 64): replaying
// each recorded real session through the runner produces the expected
// events, and updates that arrive during `session/load` are tagged as replay.
//
// The recorded sessions are played by `replay.ts --match method`, which
// answers the runner's own frames with the recorded replies (the runner's
// frames differ from the recorder's). The out-of-usage sample is played by
// the fake agent. The error classifier is unit 6c's; here it is a stand-in,
// and the test checks only that the runner passes the kind through.

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

const ofDelivery = (events: ReadonlyArray<RunnerEvent>, deliveryId: string) =>
  events.filter((event) => "deliveryId" in event && event.deliveryId === deliveryId);
const messages = (events: ReadonlyArray<RunnerEvent>) =>
  events.flatMap((event) => event._tag === "deliveryUpdate" && event.kind === "message" ? [event.text] : []);

// The recordings and what each replays as (issue 38). The third harness has two:
// `cursor-out-of-usage.ndjson` is the recording made while the owner's account had no usage
// left, an out-of-usage reply that ends normally, and `cursor.ndjson` is the normal greeting
// the owner records after the account resets. `cursor.ndjson` is replayed only when it exists.
const normal = { _tag: "success" } as const;
const outOfUsage = { _tag: "pause", reason: "out-of-usage" } as const;
const recorded = [
  { name: "claude", file: "claude.ndjson", harness: "claude", protocolVersion: 2, sessionId: "5a051567-eff6-47dd-96cf-b043a7b0635a", text: "ok", outcome: normal },
  { name: "codex", file: "codex.ndjson", harness: "codex", protocolVersion: 2, sessionId: "01a196cd-177a-7062-a56c-7a0fb3765163", text: "ok", outcome: normal },
  { name: "cursor out of usage", file: "cursor-out-of-usage.ndjson", harness: "cursor", protocolVersion: 1, sessionId: "ecc95bd5-7b12-40f4-b2e9-5a84cecae71b", text: "\n\nUpgrade your plan to continue", outcome: outOfUsage },
] as const;
// The recording is not here yet, so the case below reads only its shape, not a session id or text.
const normalCursor = "cursor.ndjson";
const normalCursorMissing = "6.2 replay cursor (normal reply): skipped, awaiting the owner's normal Cursor recording (issue 38)";

const replayCase = (c: { readonly name: string; readonly file: string; readonly harness: string; readonly protocolVersion: unknown; readonly sessionId: unknown; readonly text: unknown; readonly outcome: { readonly _tag: string } }) =>
  live(`6.2 replay ${c.name}: the recorded session opens with its session id and version, its agent text becomes exactly one message update, then promptReply ${c.outcome._tag === "success" ? "success" : "pause"}, then turnEnded (breaks if the runner misreads this adapter's protocol generation, reports the user's own echoed prompt or usage notices as agent text, or ends the turn before the reply)`, () =>
    withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
      const adapter = writeReplayAdapter(rig, c.file, rig.work);
      const spawn = yield* spawnFor(rig, harnessFor(c.harness, adapter), accountFor(c.harness, { turns: [] }, echoFile(rig)));
      const opened = yield* context.runner.start(spawn.input);
      expect(opened.session).toEqual({ _tag: "acp", sessionId: c.sessionId });
      expect(opened.protocolVersion).toEqual(c.protocolVersion);
      const delivery = deliveryFor(spawn.agentId, "Reply with the word ok. Do not run tools or create or change any file.");
      const before = context.events.length;
      yield* context.runner.prompt({ agentId: spawn.agentId, incarnation: spawn.incarnation, delivery });
      yield* context.waitFor((event) => event._tag === "turnEnded" && event.deliveryId === delivery.id, before);
      const own = ofDelivery(context.eventsAfter(before), delivery.id);
      expect(messages(own)).toEqual([c.text]);
      const tags = own.filter((event) => event._tag !== "deliveryUpdate").map((event) => event._tag);
      expect(tags).toEqual(["promptReply", "turnEnded"]);
      expect(own.find((event) => event._tag === "promptReply")).toMatchObject({ outcome: c.outcome });
      for (const event of own) expect(event).toMatchObject({ agentId: spawn.agentId, incarnation: spawn.incarnation });
      expect(own.every((event) => event._tag !== "deliveryUpdate" || event.replay === false)).toBe(true);
    })));

for (const c of recorded) replayCase(c);

// A normal Cursor greeting: a successful reply with text and no pause, like claude and codex.
if (existsSync(fixturePath(normalCursor))) {
  replayCase({ name: "cursor (normal reply)", file: normalCursor, harness: "cursor", protocolVersion: expect.any(Number), sessionId: expect.stringMatching(/\S/), text: expect.stringMatching(/\S/), outcome: normal });
} else {
  plainIt.skip(normalCursorMissing, () => {});
}

it.effect("6.2 fixtures: every recorded fixture parses, and a broken one fails with the exported ReplayParseError naming its line (breaks if a fixture is corrupted or the parse error is no longer exported)", () =>
  Effect.gen(function* () {
    const files = [...recorded.map((c) => [c.file, c.harness] as const), ...(existsSync(fixturePath(normalCursor)) ? [[normalCursor, "cursor"] as const] : [])];
    for (const [file, harness] of files) {
      const transcript = yield* parseReplay(readFileSync(fixturePath(file), "utf8"));
      expect(transcript.provider).toBe(harness);
    }
    const broken = yield* parseReplay(`${readFileSync(fixturePath("codex.ndjson"), "utf8")}{broken\n`).pipe(Effect.flip);
    expect(broken).toBeInstanceOf(ReplayParseError);
    expect(broken.lineNumber).toBe(19);
  }));

live("6.2 row 51, runner: every update the adapter sends while session/load runs is tagged replay, and updates after load are not (breaks if replayed history is reported as live updates, or live updates stay tagged after the load)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const echo = echoFile(rig);
    const script = {
      history: [{ role: "user", text: "earlier prompt with delivery-planted-1" }, { role: "agent", text: "earlier answer" }],
      turns: [[{ step: "text", text: "live answer" }]],
    };
    const spawn = yield* spawnFor(rig, harnessFor("first", writeFakeAdapter(rig)), accountFor("first", script, echo));
    const before = context.events.length;
    const loaded = yield* context.runner.load({ ...spawn.input, session: { _tag: "acp", sessionId: "fake-session-7" } });
    expect(loaded.session).toEqual({ _tag: "acp", sessionId: "fake-session-7" });
    const during = context.eventsAfter(before).filter((event) => event._tag === "deliveryUpdate");
    expect(during.length).toBeGreaterThanOrEqual(1);
    for (const event of during) expect(event).toMatchObject({ agentId: spawn.agentId, incarnation: spawn.incarnation, replay: true });
    expect(during.some((event) => event._tag === "deliveryUpdate" && event.text.includes("earlier answer"))).toBe(true);
    const delivery = deliveryFor(spawn.agentId, "go");
    const next = context.events.length;
    yield* context.runner.prompt({ agentId: spawn.agentId, incarnation: spawn.incarnation, delivery });
    yield* context.waitFor((event) => event._tag === "turnEnded" && event.deliveryId === delivery.id, next);
    const live = ofDelivery(context.eventsAfter(next), delivery.id).filter((event) => event._tag === "deliveryUpdate");
    expect(live.length).toBeGreaterThanOrEqual(1);
    for (const event of live) expect(event).toMatchObject({ replay: false });
  })));

live("6.2 row 51, engine: a resume replays the history, and the replayed updates write no thread item and accept no delivery (breaks if replay updates reach the thread or accept, or the resume cannot find the recorded session, issue 64)", () =>
  Effect.gen(function* () {
    const echo = echoFile(rig);
    const harness = harnessFor("first", writeFakeAdapter(rig));
    const account = accountFor("first", {
      protocolVersion: 1, history: [{ role: "user", text: "earlier prompt" }, { role: "agent", text: "earlier answer planted-7d1e" }], turns: [],
    }, echo);
    return yield* withEngine(rig, { harness, accounts: [account] }, (context) => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const reply = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work)));
      yield* eventually(readLog, (rows) => tagged(rows, "SessionOpened").length === 1);
      success(yield* call(ownerCredential, "stop", { agentId: reply.agentId }));
      yield* eventually(readLog, (rows) => tagged(rows, "AgentStopped").length === 1);
      const before = yield* headSequence;
      const replayed = context.events.length;
      success(yield* call(ownerCredential, "resume", { agentId: reply.agentId }));
      const rows = yield* eventually(logAfter(before), (current) => tagged(current, "SessionOpened").length === 1);
      expect(tagged(rows, "SessionOpened")).toHaveLength(1);
      yield* context.waitFor((event) => event._tag === "deliveryUpdate" && event.replay, replayed);
      const after = yield* logAfter(before);
      expect(JSON.stringify(tagged(after, "ThreadItem"))).not.toContain("planted-7d1e");
      expect(tagged(after, "ThreadItem").filter((item) => !item.replay)).toEqual([]);
      expect(tagged(after, "DeliveryAccepted")).toEqual([]);
    }));
  }));

live("6.2 issue 38: the third harness's out-of-usage sample, replayed through the runner, is passed through as a classified pause, not a crash (breaks if the runner drops the error kind, reports the turn as success, or stops the child)", () =>
  Effect.gen(function* () {
    const sample = JSON.parse(readFileSync(fixturePath("errors/cursor-out-of-usage.json"), "utf8")) as { harness: string; kind: string; text: string };
    const seen: Array<{ harness: string; text: string }> = [];
    const classifyError = (input: { readonly harness: string; readonly text: string }) => {
      seen.push({ harness: input.harness, text: input.text });
      return input.text.includes(sample.text) ? "out-of-usage" as const : undefined;
    };
    return yield* withAcpRunner(rig, { classifyError }, (context) => Effect.gen(function* () {
      const echo = echoFile(rig);
      const script = { turns: [[{ step: "out_of_usage", message: sample.text, resetsAt: "2026-11-02T00:00:00Z" }]] };
      const spawn = yield* spawnFor(rig, harnessFor("cursor", writeFakeAdapter(rig)), accountFor("cursor", script, echo));
      yield* context.runner.start(spawn.input);
      const delivery = deliveryFor(spawn.agentId, "go");
      const before = context.events.length;
      yield* context.runner.prompt({ agentId: spawn.agentId, incarnation: spawn.incarnation, delivery });
      const reply = yield* context.waitFor((event) => event._tag === "promptReply" && event.deliveryId === delivery.id, before);
      expect(reply).toMatchObject({ agentId: spawn.agentId, incarnation: spawn.incarnation, outcome: { _tag: "pause", reason: "out-of-usage" } });
      expect(seen.some((input) => input.harness === "cursor" && input.text.includes(sample.text))).toBe(true);
      expect(context.eventsAfter(before).filter((event) => event._tag === "exited")).toEqual([]);
      expect(alive((yield* readEcho(echo)).pid)).toBe(true);
    }));
  }));
