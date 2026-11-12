import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";

import * as Views from "../../src/views/Views.ts";
import { rebuild } from "../../src/views/rebuild.ts";
import {
  accountFor, deliveryFor, echoFile, fixturePath, harnessFor, makeRunnerRig, removeRunnerRig,
  replayPlayerPath, spawnFor, startPayloadFor, withAcpRunner, withEngine, writeFakeAdapter,
  writeReplayAdapter, type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { call, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually, tagged } from "../support/routingRig.ts";
import { event, queued, ready, sent } from "../support/viewFixtures.ts";
import { append, withViews } from "../support/withViews.ts";

// Foundry roles 7.5 / unit 11c. Only the adapter is a child double: the ACP
// protocol, runner, handler, durable log, redactor and rebuild are real.
// Proposed usage seam: ACP token names, plus `used`, on both turn-end events.
let rig: RunnerRig;
beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("LGTM_HOME", rig.stateFolder);
});
afterEach(() => {
  vi.unstubAllEnvs();
  removeRunnerRig(rig);
});
registerRebuildCheck({ noLog: true });

const live = (name: string, body: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => body() as Effect.Effect<unknown, unknown, never>, 60_000);

// These steps send real ACP frames through the existing fake's raw-frame
// facility. The fake's later ordinary idle frame must not end the turn twice.
const rawUpdate = (update: Record<string, unknown>) => ({
  step: "raw_frame", frame: JSON.stringify({
    jsonrpc: "2.0", method: "session/update", params: { sessionId: "${session}", update },
  }),
});
const used = (value: number) => rawUpdate({ sessionUpdate: "usage_update", used: value, size: 1_000_000 });
const idle = (inputTokens: number, cachedReadTokens: number, cachedWriteTokens: number) => rawUpdate({
  sessionUpdate: "state_update", state: "idle", stopReason: "end_turn",
  usage: { inputTokens, cachedReadTokens, cachedWriteTokens, outputTokens: 4,
    totalTokens: inputTokens + cachedReadTokens + cachedWriteTokens + 4 },
});

live("U01: the raw Claude idle-frame usage reaches the internal event and persisted TurnEnded without a transcript (catches dropping idle usage or stripping it at either decoder)", () => {
  const harness = harnessFor("claude", writeReplayAdapter(rig, "claude.ndjson", rig.work), {
    permissionMapping: { "read-only": "plan", ask: "default", edit: "acceptEdits", full: "bypassPermissions" },
  });
  const account = accountFor("claude", { turns: [] }, echoFile(rig));
  return withEngine(rig, { harness, accounts: [account] }, (context) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const started = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "hello" })));
    const rows = yield* eventually(readLog, (rows) => tagged(rows, "TurnEnded").length === 1);
    const ends = tagged(rows, "TurnEnded");
    expect(ends).toHaveLength(1);
    // Hand-read from claude.ndjson's usage_update and final idle frame.
    const usage = { used: 43_916, inputTokens: 2, cachedReadTokens: 0, cachedWriteTokens: 43_910 };
    expect(ends[0]).toMatchObject({ agentId: started.agentId, compact: false, usage });
    expect(context.events.find((event) => event._tag === "turnEnded")).toMatchObject({ usage });
    expect(existsSync(join(rig.home, ".claude", "projects"))).toBe(false);
    expect(existsSync(join(rig.stateFolder, "transcripts"))).toBe(false);
  }));
});

live("U02: a second turn with no usage has none in the runner or the log (catches retaining the previous turn's terminal tokens or used value)", () => {
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const account = accountFor("first", { turns: [
    [{ step: "text", text: "first" }, used(1_234), idle(11, 22, 33)],
    [{ step: "text", text: "second, no usage" }],
  ] }, echoFile(rig));
  return withEngine(rig, { harness, accounts: [account] }, (context) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const started = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "first" })));
    yield* eventually(readLog, (rows) => tagged(rows, "TurnEnded").length === 1);
    success(yield* call(ownerCredential, "prompt", { agentId: started.agentId, text: "second" }));
    const rows = yield* eventually(readLog, (rows) => tagged(rows, "TurnEnded").length === 2);
    const ends = tagged(rows, "TurnEnded");
    expect(ends).toHaveLength(2);
    expect(ends[1]).not.toHaveProperty("usage");
    const internal = context.events.filter((event) => event._tag === "turnEnded");
    expect(internal).toHaveLength(2);
    expect(internal[1]).not.toHaveProperty("usage");
    // Positive control: isolation cannot pass by discarding all usage.
    expect(ends[0]).toMatchObject({ usage: { used: 1_234, inputTokens: 11, cachedReadTokens: 22, cachedWriteTokens: 33 } });
    expect(internal[0]).toMatchObject({ usage: { used: 1_234 } });
  }));
});

// Derive a session/load recording from the existing recording, preserving
// its real handshake. Old usage arrives during load, before any live turn.
const replayWithOldUsage = () => {
  const entries = readFileSync(fixturePath("claude.ndjson"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const index = entries.findIndex((entry) => entry.type === "expect_outbound" && entry.frame?.method === "session/new");
  const opened = entries[index + 1].frame.result;
  const notification = (update: Record<string, unknown>) => ({ type: "emit_inbound", frame: {
    jsonrpc: "2.0", method: "session/update", params: { sessionId: opened.sessionId, update },
  } });
  const fixture = join(rig.root, "load-usage.ndjson");
  writeFileSync(fixture, [...entries.slice(0, index),
    // The Effect ACP client maps its public loadSession to v2's resume.
    { type: "expect_outbound", frame: { jsonrpc: "2.0", id: 2, method: "session/resume", params: {} } },
    notification({ sessionUpdate: "usage_update", used: 999_999, size: 1_000_000 }),
    notification({ sessionUpdate: "state_update", state: "idle", stopReason: "end_turn",
      usage: { inputTokens: 900, cachedReadTokens: 800, cachedWriteTokens: 700, outputTokens: 0, totalTokens: 2_400 } }),
    { type: "emit_inbound", frame: { jsonrpc: "2.0", id: 2, result: { configOptions: opened.configOptions } } },
    { type: "expect_outbound", frame: { jsonrpc: "2.0", id: 4, method: "session/set_config_option", params: {} } },
    { type: "emit_inbound", frame: { jsonrpc: "2.0", id: 4, result: { configOptions: opened.configOptions } } },
    { type: "expect_outbound", frame: { jsonrpc: "2.0", id: 3, method: "session/prompt", params: {} } },
    { type: "emit_inbound", frame: { jsonrpc: "2.0", id: 3, result: { messageId: "live-usage" } } },
    notification({ sessionUpdate: "state_update", state: "running" }),
    notification({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "live response" } }),
    notification({ sessionUpdate: "state_update", state: "idle", stopReason: "end_turn",
      usage: { inputTokens: 7, cachedReadTokens: 0, outputTokens: 4, totalTokens: 11 } }),
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  const adapter = join(rig.bin, "load-usage-adapter");
  const argv = [replayPlayerPath, fixture, "--workspace", rig.work, "--match", "method"];
  writeFileSync(adapter, `#!${process.execPath}\nprocess.argv.splice(1, process.argv.length - 1, ...${JSON.stringify(argv)});\nimport(${JSON.stringify(pathToFileURL(replayPlayerPath).href)});\n`);
  chmodSync(adapter, 0o755);
  return { adapter, sessionId: opened.sessionId as string };
};

live("U03: replayed usage creates no turn end and supplies no values to the next live turn (catches collecting usage from session/load into process state)", () =>
  withAcpRunner(rig, {}, (context) => Effect.gen(function* () {
    const replay = replayWithOldUsage();
    const harness = harnessFor("claude", replay.adapter, {
      permissionMapping: { "read-only": "plan", ask: "default", edit: "acceptEdits", full: "bypassPermissions" },
    });
    const spawn = yield* spawnFor(rig, harness, accountFor("claude", { turns: [] }, echoFile(rig)));
    yield* context.runner.load({ ...spawn.input, session: { _tag: "acp", sessionId: replay.sessionId } });
    expect(context.events.filter((event) => event._tag === "turnEnded")).toEqual([]);
    const delivery = deliveryFor(spawn.agentId, "live turn");
    yield* context.runner.prompt({ sentSequence: 1, agentId: spawn.agentId, incarnation: spawn.incarnation, delivery });
    const ended = yield* context.waitFor((event) => event._tag === "turnEnded" && event.deliveryId === delivery.id);
    // Exact equality catches a stale `used` or cache-write count, while the
    // positive input count catches a runner that simply drops every usage.
    expect(ended).toHaveProperty("usage", { inputTokens: 7, cachedReadTokens: 0 });
    expect(context.events.filter((event) => event._tag === "turnEnded")).toHaveLength(1);
  })));

for (const contextUsed of [700, 0, undefined]) {
  live(`U04 (${contextUsed === undefined ? "no used" : `used=${contextUsed}`}): a multi-request turn keeps the last context sample and terminal input counts, without summing requests (catches summing usage_update.used, treating zero as absent, or inventing a used value)`, () => {
    const harness = harnessFor("first", writeFakeAdapter(rig));
    const account = accountFor("first", { turns: [[
      { step: "text", text: "first model request" },
      ...(contextUsed === undefined ? [] : [used(90_000)]),
      { step: "tool_call", toolCallId: "between-requests", title: "Read", kind: "read", status: "completed", output: "done" },
      { step: "text", text: "last model request" },
      ...(contextUsed === undefined ? [] : [used(contextUsed)]),
      idle(7, 8, 9),
    ]] }, echoFile(rig));
    return withEngine(rig, { harness, accounts: [account] }, (context) => Effect.gen(function* () {
      yield* registerRebuildCheck();
      success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "two requests" })));
      const rows = yield* eventually(readLog, (rows) => tagged(rows, "TurnEnded").length === 1);
      const usage = { ...(contextUsed === undefined ? {} : { used: contextUsed }), inputTokens: 7, cachedReadTokens: 8, cachedWriteTokens: 9 };
      expect(tagged(rows, "TurnEnded")).toHaveLength(1);
      expect(tagged(rows, "TurnEnded")[0]).toHaveProperty("usage", usage);
      expect(context.events.find((event) => event._tag === "turnEnded")).toHaveProperty("usage", usage);
    }));
  });
}

live("U05: old TurnEnded rows rebuild unchanged alongside new usage rows after reopening the database (catches mandatory new fields or usage lost on durable read)", () =>
  Effect.gen(function* () {
    const old = { _tag: "TurnEnded", agentId: "agent-a", compact: false };
    const modern = { _tag: "TurnEnded", agentId: "agent-a", compact: false,
      usage: { inputTokens: 7, cachedReadTokens: 8, cachedWriteTokens: 9 } };
    const first = yield* withViews(rig.root, Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* append("old-usage-log", [...ready, queued, sent, event(old)]);
      const views = yield* Views.Views;
      const oldView = yield* views.snapshot;
      expect((yield* rebuild(oldView.sequence)).threads["agent-a"]?.at(-1)?.event).toEqual(old);
      // A second ordinary delivery makes another legal working -> idle turn.
      yield* append("new-usage-log", [
        event({ _tag: "DeliveryQueued", delivery: { id: "delivery-b", target: "agent-a", sender: { _tag: "owner" }, content: { _tag: "prompt", text: "next" } } }),
        event({ _tag: "DeliverySent", agentId: "agent-a", deliveryId: "delivery-b", method: "acp" }),
        event(modern),
      ]);
      return structuredClone(yield* views.snapshot);
    }));
    yield* withViews(rig.root, Effect.gen(function* () {
      yield* registerRebuildCheck();
      const rebuilt = yield* rebuild(first.sequence);
      expect(yield* (yield* Views.Views).snapshot).toEqual(rebuilt);
      const ends = rebuilt.threads["agent-a"]?.filter((row) => row.event._tag === "TurnEnded").map((row) => row.event);
      expect(ends).toEqual([old, modern]);
    }));
  }));
