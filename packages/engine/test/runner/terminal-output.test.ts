import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";
import * as AcpRunner from "../../src/runner/AcpRunner.ts";
import * as Views from "../../src/views/Views.ts";
import { rebuild } from "../../src/views/rebuild.ts";
import { accountFor, echoFile, fakeAgentPath, harnessFor, readEcho, makeRunnerRig, removeRunnerRig, startPayloadFor, withEngine, writeFakeAdapter, type RunnerRig } from "../support/acpRunnerRig.ts";
import { call, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually, tagged } from "../support/routingRig.ts";

registerRebuildCheck({ noLog: true });
let rig: RunnerRig;
beforeEach(() => { rig = makeRunnerRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); removeRunnerRig(rig); });
const frame = (update: unknown) => ({ step: "raw_frame", frame: JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "${session}", update } }) });
const base64 = (text: string) => Buffer.from(text).toString("base64");
const shapes = [
  { harness: "claude", shape: "v2 snapshot" },
  { harness: "codex", shape: "v2 chunks" },
  { harness: "claude", shape: "terminal metadata snapshot" },
  { harness: "codex", shape: "terminal metadata delta" },
] as const;
type Shape = typeof shapes[number];
// The terminal id deliberately differs from the call id: association must use
// the terminal reference, not a guessed equality or the last active call.
const updates = ({ shape }: Shape, parts: ReadonlyArray<string>, exitCode: number) => {
  const reference = { sessionUpdate: shape.startsWith("terminal metadata") ? "tool_call" : "tool_call_update", toolCallId: "call-output", title: "Run command", status: "in_progress", rawInput: { command: "test-command" }, content: [{ type: "terminal", terminalId: "terminal-output" }] };
  if (shape === "v2 snapshot") return [
    // The pinned converter emits terminal updates before their tool report.
    frame({ sessionUpdate: "terminal_update", terminalId: "terminal-output", output: { data: base64(parts.join("")) }, exitStatus: { exitCode } }),
    frame(reference),
  ];
  if (shape === "v2 chunks") return [frame(reference),
    ...parts.map((text) => frame({ sessionUpdate: "terminal_output_chunk", terminalId: "terminal-output", data: base64(text) })),
    frame({ sessionUpdate: "terminal_update", terminalId: "terminal-output", exitStatus: { exitCode, signal: null } }),
  ];
  return [frame(reference), ...parts.map((text, i) => frame({ sessionUpdate: "tool_call_update", toolCallId: "call-output", _meta: {
    ...(shape === "terminal metadata snapshot" ? { terminal_output: { terminal_id: "terminal-output", data: parts.slice(0, i + 1).join("") } } : { terminal_output_delta: { terminal_id: "terminal-output", data: text } }),
    ...(i === parts.length - 1 ? { terminal_exit: { terminal_id: "terminal-output", exit_code: exitCode, signal: null } } : {}),
  } }))];
};
const payloads = (items: ReadonlyArray<{ content: { _tag: string; callId?: string; output?: string } }>) => items.flatMap(({ content }) => {
  if (content._tag !== "tool-call" || content.callId !== "call-output" || content.output === undefined) return [];
  try { const value = JSON.parse(content.output); return value?.terminalId === "terminal-output" ? [value] : []; } catch { return []; }
});

for (const scenario of shapes) {
  it.live(`issue 242: ${scenario.harness} ${scenario.shape} retains output and a nonzero exit in runner, log, live thread and rebuild`, () => Effect.gen(function* () {
    const harness = harnessFor(scenario.harness, writeFakeAdapter(rig));
    const unknown = scenario.shape.startsWith("terminal metadata")
      ? [frame({ sessionUpdate: "tool_call_update", toolCallId: "call-output", _meta: {
        terminal_output_delta: { terminal_id: "unmapped", data: "foreign output" },
        terminal_exit: { terminal_id: "unmapped", exit_code: 99 },
      } })]
      : [frame({ sessionUpdate: "terminal_output_chunk", terminalId: "unmapped", data: base64("foreign output") }),
        frame({ sessionUpdate: "terminal_update", terminalId: "unmapped", exitStatus: { exitCode: 99 } })];
    const account = accountFor(scenario.harness, { protocolVersion: scenario.shape.startsWith("terminal metadata") ? 1 : 2, turns: [[
      ...updates(scenario, ["line one\n", "line two\n"], 7),
      ...unknown,
      frame({ sessionUpdate: "tool_call_update", toolCallId: "call-output", status: "completed" }),
    ]] }, echoFile(rig));
    return yield* withEngine(rig, { harness, accounts: [account] }, (context) => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const reply = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "go" })));
      const rows = yield* eventually(readLog, (events) => tagged(events, "TurnEnded").length > 0);
      const own = tagged(rows, "ThreadItem");
      expect(own.some((item) => item.content._tag === "tool-call" && item.content.callId === "call-output")).toBe(true);
      expect(payloads(own).at(-1)).toMatchObject({ output: "line one\nline two\n", exitCode: 7, truncated: false });
      // A tool report can arrive after its terminal notifications. Its generic
      // empty content must not become the last update and hide the snapshot.
      const finalTool = own.filter((item) => item.content._tag === "tool-call" && item.content.callId === "call-output").at(-1)!;
      expect(payloads([finalTool]).at(-1)).toMatchObject({ output: "line one\nline two\n", exitCode: 7 });
      const runnerItems = context.events.flatMap((event) => event._tag === "deliveryUpdate" && event.content !== undefined ? [{ content: event.content }] : []);
      expect(payloads(runnerItems).at(-1)).toMatchObject({ output: "line one\nline two\n", exitCode: 7 });
      // AccountChanged contains the scripted input; inspect emitted thread
      // output and runner events rather than that owner-supplied fixture.
      expect(JSON.stringify([own, context.events])).not.toContain("foreign output");
      expect(JSON.stringify(payloads(own))).not.toContain('"exitCode":99');
      const last = own.filter((item) => item.content._tag === "tool-call" && item.content.output?.includes('"exitCode":7')).at(-1);
      expect(last?.content).toMatchObject({ status: "failed", callId: "call-output" });
      const view = yield* (yield* Views.Views).snapshot;
      const replay = yield* rebuild(view.sequence);
      for (const state of [view, replay]) {
        const thread = state.threads[reply.agentId]!.flatMap((row) => row.event._tag === "ThreadItem" ? [row.event] : []);
        expect(payloads(thread).at(-1)).toMatchObject({ output: "line one\nline two\n", exitCode: 7 });
        expect(JSON.stringify(thread)).not.toContain("foreign output");
      }
      expect(replay).toEqual(view);
    }));
  }) as Effect.Effect<unknown, unknown, never>, 60_000);

  it.live(`issue 242: ${scenario.harness} ${scenario.shape} redacts decoded raw and split secret output at every boundary`, () => Effect.gen(function* () {
    // Configure the real runner's gated logger, preserving its implementation.
    const originalLayer = AcpRunner.layer;
    vi.spyOn(AcpRunner, "layer").mockImplementation((configuration) => originalLayer({ ...configuration, protocolLog: true }));
    const secret = 'registered-quote-"-newline-\n-terminal-secret-0123456789abcdef';
    const split = Math.floor(secret.length / 2);
    const parts = ["visible\nPLANTED_FULL\nsplit:", "PLANTED_FIRST", "PLANTED_LAST\ntoken:TOKEN_FULL\ntoken split:TOKEN_FIRST", "TOKEN_LAST\nfinished\n"];
    const adapter = writeFakeAdapter(rig);
    // Materialize secrets inside the fake child after spawn. Putting their
    // literal/base64 forms in AccountChanged would redact the script before
    // it ran, proving setup redaction rather than the terminal boundary.
    writeFileSync(adapter, `#!${process.execPath}
const script = JSON.parse(process.env.FAKE_AGENT_SCRIPT);
const replacements = {};
for (const [label, value] of [["PLANTED", process.env.PLANTED_KEY], ["TOKEN", process.env.LGTM_TOKEN]]) {
  replacements[label + "_FULL"] = value;
  replacements[label + "_FIRST"] = value.slice(0, Math.floor(value.length / 2));
  replacements[label + "_LAST"] = value.slice(Math.floor(value.length / 2));
}
const expand = (text) => Object.entries(replacements).reduce((result, [key, value]) => result.replaceAll(key, value), text);
for (const step of script.turns[0]) {
  const row = JSON.parse(step.frame);
  const update = row.params.update;
  if (typeof update.data === "string") update.data = Buffer.from(expand(Buffer.from(update.data, "base64").toString())).toString("base64");
  if (typeof update.output?.data === "string") update.output.data = Buffer.from(expand(Buffer.from(update.output.data, "base64").toString())).toString("base64");
  for (const key of ["terminal_output", "terminal_output_delta"]) if (update._meta?.[key]) update._meta[key].data = expand(update._meta[key].data);
  step.frame = JSON.stringify(row);
}
process.env.FAKE_AGENT_SCRIPT = JSON.stringify(script);
await import(${JSON.stringify(pathToFileURL(fakeAgentPath).href)});
`);
    const harness = harnessFor(scenario.harness, adapter);
    const echo = echoFile(rig);
    const account = accountFor(scenario.harness, { protocolVersion: scenario.shape.startsWith("terminal metadata") ? 1 : 2, turns: [updates(scenario, parts, 0)] }, echo, { PLANTED_KEY: "secret:terminal" });
    return yield* withEngine(rig, { harness, accounts: [account], secrets: { "secret:terminal": secret } }, (context) => Effect.gen(function* () {
      yield* registerRebuildCheck();
      success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "go" })));
      const rows = yield* eventually(readLog, (events) => tagged(events, "TurnEnded").length > 0);
      expect(payloads(tagged(rows, "ThreadItem")).at(-1)).toMatchObject({ output: "visible\n[REDACTED]\nsplit:[REDACTED]\ntoken:[REDACTED]\ntoken split:[REDACTED]\nfinished\n", exitCode: 0 });
      expect(context.logLines.some((line) => line.includes("terminal output withheld")) || scenario.shape.startsWith("terminal metadata")).toBe(true);
      const token = (yield* readEcho(echo)).env.LGTM_TOKEN!;
      const state = yield* (yield* Views.Views).snapshot;
      const replay = yield* rebuild(state.sequence);
      const sql = yield* SqlClient.SqlClient;
      const stored = (yield* sql<{ payload_json: string }>`SELECT payload_json FROM events`).map((row) => row.payload_json).join("\n");
      for (const text of [JSON.stringify(context.events), stored, JSON.stringify(state), JSON.stringify(replay), context.logLines.join("\n")]) {
        expect(text).not.toContain(token);
        expect(text).not.toContain(base64(token));
        expect(text).not.toContain(base64(token.slice(0, Math.floor(token.length / 2))));
        expect(text).not.toContain(base64(token.slice(Math.floor(token.length / 2))));
        expect(text).not.toContain(secret);
        expect(text).not.toContain(JSON.stringify(secret).slice(1, -1));
        expect(text).not.toContain(base64(secret));
        expect(text).not.toContain(base64(secret.slice(0, split)));
        expect(text).not.toContain(base64(secret.slice(split)));
      }
    }));
  }) as Effect.Effect<unknown, unknown, never>, 60_000);
}

it.live("issue 242: an unknown terminal never contaminates another call, and retained output is bounded after redaction", () => Effect.gen(function* () {
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const data = "x".repeat(40_000) + "safe tail\n";
  const account = accountFor("first", { turns: [[
    frame({ sessionUpdate: "terminal_output_chunk", terminalId: "unmapped", data: base64("foreign output") }),
    frame({ sessionUpdate: "terminal_update", terminalId: "unmapped", exitStatus: { exitCode: 99 } }),
    ...updates({ harness: "codex", shape: "v2 chunks" }, [data], 0),
  ]] }, echoFile(rig));
  return yield* withEngine(rig, { harness, accounts: [account] }, (context) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "go" })));
    const rows = yield* eventually(readLog, (events) => tagged(events, "TurnEnded").length > 0);
    const output = payloads(tagged(rows, "ThreadItem")).at(-1);
    expect(output).toMatchObject({ output: data.slice(-16_384), exitCode: 0, truncated: true });
    expect(JSON.stringify([rows, context.events, yield* (yield* Views.Views).snapshot])).not.toContain("foreign output");
    expect(JSON.stringify(payloads(tagged(rows, "ThreadItem")))).not.toContain('"exitCode":99');
  }));
}) as Effect.Effect<unknown, unknown, never>, 60_000);
