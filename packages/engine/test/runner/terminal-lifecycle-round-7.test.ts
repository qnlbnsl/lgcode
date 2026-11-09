import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";
import * as Views from "../../src/views/Views.ts";
import { rebuild } from "../../src/views/rebuild.ts";
import { accountFor, echoFile, fakeAgentPath, harnessFor, makeRunnerRig, removeRunnerRig, startPayloadFor, withEngine, writeFakeAdapter, type RunnerRig } from "../support/acpRunnerRig.ts";
import { call, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually, tagged } from "../support/routingRig.ts";

registerRebuildCheck({ noLog: true });
let rig: RunnerRig;
beforeEach(() => { rig = makeRunnerRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); removeRunnerRig(rig); });
const frame = (update: unknown) => ({ step: "raw_frame", frame: JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "${session}", update } }) });
const reference = frame({ sessionUpdate: "tool_call_update", toolCallId: "call", title: "Run", status: "in_progress", content: [{ type: "terminal", terminalId: "terminal" }] });
const chunk = (text: string) => frame({ sessionUpdate: "terminal_output_chunk", terminalId: "terminal", data: Buffer.from(text).toString("base64") });
const marker = { step: "plan", entries: [{ content: "at gate", priority: "high", status: "in_progress" }] };
// Large fixtures are loaded inside the child so the operating system's
// per-environment-variable limit does not constrain the output regression.
const scriptAdapter = (script: unknown) => {
  const path = join(rig.root, "large-script.json");
  writeFileSync(path, JSON.stringify(script));
  const adapter = writeFakeAdapter(rig);
  writeFileSync(adapter, `#!${process.execPath}
import { readFileSync } from "node:fs";
process.env.FAKE_AGENT_SCRIPT = JSON.stringify({ ...JSON.parse(process.env.FAKE_AGENT_SCRIPT), ...JSON.parse(readFileSync(${JSON.stringify(path)}, "utf8")) });
await import(${JSON.stringify(pathToFileURL(fakeAgentPath).href)});
`);
  return adapter;
};
const snapshots = (rows: ReadonlyArray<any>) => rows.flatMap((row) => {
  if (row.content?._tag !== "tool-call" || !row.content.output) return [];
  try { const value = JSON.parse(row.content.output); return value.terminalId === "terminal" ? [value] : []; } catch { return []; }
});

for (const repaired of [false, true]) {
  it.live(`249: loss before idle completes the turn fail closed${repaired ? " and repair permits the next redacted turn" : ""}`, () => Effect.gen(function* () {
    const config = join(rig.home, ".claude"); mkdirSync(config, { recursive: true });
    const store = join(config, ".credentials.json");
    const secret = "credential-round-seven-0123456789abcdef";
    writeFileSync(store, JSON.stringify({ token: secret }));
    const gate = join(rig.root, "release");
    const harness = harnessFor("claude", writeFakeAdapter(rig));
    const account = accountFor("claude", { turns: [
      [reference, chunk("held terminal tail"), marker, { step: "wait_for_file", path: gate }],
      [reference, frame({ sessionUpdate: "tool_call_update", toolCallId: "call", _meta: { terminal_output_delta: { terminal_id: "terminal", data: "recovered ${env:LOGIN_TOKEN} output" } } })],
    ] }, echoFile(rig), { LOGIN_TOKEN: "secret:login" });
    return yield* withEngine(rig, { harness, accounts: [account], secrets: { "secret:login": secret } }, (context) => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const reply = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "first" })));
      yield* context.waitFor((event) => event._tag === "deliveryUpdate" && event.kind === "plan");
      writeFileSync(store, "{broken"); writeFileSync(gate, "go");
      const first = yield* eventually(readLog, (rows) => tagged(rows, "TurnEnded").length === 1);
      expect(tagged(first, "TurnEnded")).toHaveLength(1);
      expect(JSON.stringify(tagged(first, "ThreadItem"))).toContain("output withheld: account credentials cannot be inspected");
      expect(JSON.stringify([tagged(first, "ThreadItem"), context.events])).not.toContain("held terminal tail");
      if (repaired) {
        writeFileSync(store, JSON.stringify({ token: secret }));
        success(yield* call(ownerCredential, "prompt", { agentId: reply.agentId, text: "second" }));
        const second = yield* eventually(readLog, (rows) => tagged(rows, "TurnEnded").length === 2);
        expect(tagged(second, "TurnEnded")).toHaveLength(2);
        expect(snapshots(tagged(second, "ThreadItem")).at(-1)?.output).toBe("recovered [REDACTED] output");
        expect(JSON.stringify([tagged(second, "ThreadItem"), context.events, context.logLines])).not.toContain(secret);
      }
    }));
  }) as Effect.Effect<unknown, unknown, never>, 60_000);
}

it.live("D: chunk redaction protects the secret fragment cut by the retained tail's left edge", () => Effect.gen(function* () {
  const secret = "registered-truncation-edge-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const half = Math.floor(secret.length / 2);
  const suffix = "x".repeat(16_384 - (secret.length - half));
  const adapter = writeFakeAdapter(rig);
  writeFileSync(adapter, `#!${process.execPath}
const script = JSON.parse(process.env.FAKE_AGENT_SCRIPT);
for (const step of script.turns[0]) {
  if (!step.frame) continue;
  const row = JSON.parse(step.frame);
  if (row.params.update.data) {
    const text = Buffer.from(row.params.update.data, "base64").toString().replaceAll("SECRET_FIRST", process.env.PLANTED_KEY.slice(0, ${half})).replaceAll("SECRET_LAST", process.env.PLANTED_KEY.slice(${half}));
    row.params.update.data = Buffer.from(text).toString("base64");
    step.frame = JSON.stringify(row);
  }
}
process.env.FAKE_AGENT_SCRIPT = JSON.stringify(script);
await import(${JSON.stringify(pathToFileURL(fakeAgentPath).href)});
`);
  const harness = harnessFor("first", adapter);
  const account = accountFor("first", { turns: [[reference, chunk("prefix".repeat(100) + "SECRET_FIRST"), chunk("SECRET_LAST" + suffix)]] }, echoFile(rig), { PLANTED_KEY: "secret:edge" });
  return yield* withEngine(rig, { harness, accounts: [account], secrets: { "secret:edge": secret } }, (context) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "go" })));
    const rows = yield* eventually(readLog, (events) => tagged(events, "TurnEnded").length === 1);
    expect(tagged(rows, "TurnEnded")).toHaveLength(1);
    const view = yield* (yield* Views.Views).snapshot;
    const replay = yield* rebuild(view.sequence);
    const sql = yield* SqlClient.SqlClient;
    const stored = yield* sql<{ payload_json: string }>`SELECT payload_json FROM events`;
    for (const text of [JSON.stringify(context.events), JSON.stringify(stored), JSON.stringify(view), JSON.stringify(replay), context.logLines.join("\n")]) {
      expect(text).not.toContain(secret.slice(half));
      expect(text).not.toContain(secret.slice(0, half));
    }
    expect(snapshots(tagged(rows, "ThreadItem")).at(-1)?.output).toBe(("prefix".repeat(100) + "[REDACTED]" + suffix).slice(-16_384));
  }));
}) as Effect.Effect<unknown, unknown, never>, 60_000);

for (const source of ["terminal", "message"]) {
  it.live(`E diagnostic: stop emits but does not store the held ${source} tail`, () => Effect.gen(function* () {
    const gate = join(rig.root, "never-release");
    const harness = harnessFor("first", writeFakeAdapter(rig));
    const tail = `${source} held tail`;
    const echo = echoFile(rig);
    // The queued plan must finish before the tail. A second acknowledged FIFO
    // round trip places actual tail handling before the direct raw-frame barrier.
    // Neither round trip emits content that could flush the short held tail.
    const account = accountFor("first", { turns: [[reference, marker, { step: "notification_barrier" }, ...(source === "terminal" ? [chunk(tail)] : [{ step: "text", text: tail }]), { step: "notification_barrier" }, frame({ sessionUpdate: "available_commands_update", availableCommands: [] }), { step: "wait_for_file", path: gate }]] }, echo);
    return yield* withEngine(rig, { harness, accounts: [account] }, (context) => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const reply = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "go" })));
      yield* context.waitFor((event) => event._tag === "deliveryUpdate" && event.kind === "plan");
      // Issue 556: script order alone cannot order queued SDK notifications and
      // direct writes. The round trips above establish the actual wire order.
      yield* context.waitFor((event) => event._tag === "deliveryUpdate" && event.kind === "available_commands_update");
      const refusals = JSON.parse(readFileSync(echo, "utf8")).inbound.filter((row: any) => row.error?.message === "Method not found: _lgcode_test_notification_barrier");
      expect(refusals).toHaveLength(2);
      expect(refusals.every((row: any) => row.error.code === -32601)).toBe(true);
      expect(JSON.stringify(context.events)).not.toContain(tail);
      success(yield* call(ownerCredential, "stop", { agentId: reply.agentId }));
      const runner = yield* eventually(Effect.sync(() => JSON.stringify(context.events)), (text) => text.includes(tail));
      expect(runner).toContain(tail);
      expect(JSON.stringify(tagged(yield* readLog, "ThreadItem"))).not.toContain(tail);
    }));
  }) as Effect.Effect<unknown, unknown, never>, 60_000);
}

for (const shape of ["v2", "v1"]) {
  it.effect(`270: ${shape} 2,000 chunks keep the stored event count below ten and payload below 100 KiB`, () => Effect.gen(function* () {
    const parts = Array.from({ length: 2000 }, (_, i) => String(i).padStart(4, "0") + "x".repeat(96));
    const harness = harnessFor("first", scriptAdapter({ turns: [[reference, ...parts.map((part) => shape === "v2" ? chunk(part) : frame({ sessionUpdate: "tool_call_update", toolCallId: "call", _meta: { terminal_output_delta: { terminal_id: "terminal", data: part } } }))]] }));
    const account = accountFor("first", {}, echoFile(rig));
    return yield* withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "go" })));
      const rows = yield* eventually(readLog, (events) => tagged(events, "TurnEnded").length === 1);
      expect(tagged(rows, "TurnEnded")).toHaveLength(1);
      const tools = tagged(rows, "ThreadItem").filter((row) => row.content._tag === "tool-call");
      expect(tools.length).toBeLessThan(10);
      expect(Buffer.byteLength(JSON.stringify(tools))).toBeLessThan(100 * 1024);
      expect(snapshots(tools).at(-1)).toMatchObject({ output: parts.join("").slice(-16_384), truncated: true });
    }));
  }) as Effect.Effect<unknown, unknown, never>, 60_000);
}

it.live("271: the cap warning contains no output and occurs once in each overflowing turn", () => Effect.gen(function* () {
  const turn = Array.from({ length: 300 }, (_, i) => frame({ sessionUpdate: "terminal_output_chunk", terminalId: `unclaimed-${i}`, data: Buffer.from("private terminal output").toString("base64") }));
  const harness = harnessFor("first", scriptAdapter({ turns: [turn, turn] }));
  const account = accountFor("first", {}, echoFile(rig));
  return yield* withEngine(rig, { harness, accounts: [account] }, (context) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const reply = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "one" })));
    yield* eventually(readLog, (events) => tagged(events, "TurnEnded").length === 1);
    const warnings = () => context.logLines.filter((line) => line.includes("terminal limit reached"));
    expect(warnings()).toHaveLength(1);
    expect(warnings().join("\n")).not.toContain("private terminal output");
    success(yield* call(ownerCredential, "prompt", { agentId: reply.agentId, text: "two" }));
    const rows = yield* eventually(readLog, (events) => tagged(events, "TurnEnded").length === 2);
    expect(tagged(rows, "TurnEnded")).toHaveLength(2);
    expect(warnings()).toHaveLength(2);
  }));
}) as Effect.Effect<unknown, unknown, never>, 60_000);

it.live("270: a repeated completed report cannot hide the terminal's final retained snapshot", () => Effect.gen(function* () {
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const account = accountFor("first", { turns: [[
    frame({ sessionUpdate: "tool_call_update", toolCallId: "call", title: "Run", status: "completed", content: [{ type: "terminal", terminalId: "terminal" }] }),
    chunk("final command output"),
    frame({ sessionUpdate: "terminal_update", terminalId: "terminal", exitStatus: { exitCode: 0 } }),
    frame({ sessionUpdate: "tool_call_update", toolCallId: "call", status: "completed" }),
  ]] }, echoFile(rig));
  return yield* withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "go" })));
    const rows = yield* eventually(readLog, (events) => tagged(events, "TurnEnded").length === 1);
    expect(tagged(rows, "TurnEnded")).toHaveLength(1);
    const last = tagged(rows, "ThreadItem").filter((row) => row.content._tag === "tool-call" && row.content.callId === "call").at(-1)!;
    expect(snapshots([last]).at(-1)).toMatchObject({ output: "final command output", exitCode: 0 });
  }));
}) as Effect.Effect<unknown, unknown, never>, 60_000);

it.live("271: discarding terminal carry on coverage loss does not reset the warning within the same turn", () => Effect.gen(function* () {
  const config = join(rig.home, ".claude"); mkdirSync(config, { recursive: true });
  const store = join(config, ".credentials.json"); writeFileSync(store, "{}");
  const firstGate = join(rig.root, "lose-coverage");
  const secondGate = join(rig.root, "repair-coverage");
  const overflow = Array.from({ length: 300 }, (_, i) => frame({ sessionUpdate: "terminal_output_chunk", terminalId: `unknown-${i}`, data: Buffer.from("unclaimed").toString("base64") }));
  const harness = harnessFor("claude", scriptAdapter({ turns: [[
    ...overflow, marker, { step: "wait_for_file", path: firstGate },
    reference, frame({ sessionUpdate: "available_commands_update", availableCommands: [] }),
    { step: "wait_for_file", path: secondGate }, ...overflow,
  ]] }));
  const account = accountFor("claude", {}, echoFile(rig));
  return yield* withEngine(rig, { harness, accounts: [account] }, (context) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "go" })));
    yield* context.waitFor((event) => event._tag === "deliveryUpdate" && event.kind === "plan");
    writeFileSync(store, "{broken"); writeFileSync(firstGate, "go");
    yield* context.waitFor((event) => event._tag === "deliveryUpdate" && event.kind === "available_commands_update");
    writeFileSync(store, "{}"); writeFileSync(secondGate, "go");
    const rows = yield* eventually(readLog, (events) => tagged(events, "TurnEnded").length === 1);
    expect(tagged(rows, "TurnEnded")).toHaveLength(1);
    expect(context.logLines.filter((line) => line.includes("terminal limit reached"))).toHaveLength(1);
  }));
}) as Effect.Effect<unknown, unknown, never>, 60_000);
