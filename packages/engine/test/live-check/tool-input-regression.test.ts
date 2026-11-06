import { afterEach, expect, it, vi } from "vitest";
import { toolText } from "@sheprd/contracts/thread";
import { translate } from "../../src/runner/translate.ts";
import { authRefused, exactCommand, exitCodeOf, foregroundCommand, mcpAskDiscovery, mcpAskInput, shellIdentityStatus, terminalToolOutput } from "../../scripts/live/probeEvidence.ts";
import { probeCommands } from "../../scripts/live/liveProbes.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { fakeEngine, LEAD, markerIn, runProbe, type FakeEngine } from "./probe-fake-engine.ts";

vi.mock("@sheprd/client", async (original) => {
  const client = await original<typeof import("@sheprd/client")>();
  const { fakeConnect } = await import("./probe-fake-registry.ts");
  return { ...client, connect: (options: Parameters<typeof client.connect>[0]) => (fakeConnect(options) ?? client.connect(options)) as never };
});

registerRebuildCheck({ noLog: true });
const engines: FakeEngine[] = [];
afterEach(() => { for (const engine of engines.splice(0)) engine.cleanup(); });

const storedInput = (rawInput: unknown, sessionUpdate = "tool_call"): string => {
  const content = translate({ sessionUpdate, toolCallId: "probe", rawInput }, false)[0]!.content;
  if (content._tag !== "tool-call" || content.input === undefined) throw new Error("missing stored tool input");
  return content.input;
};

it.each(["tool_call", "tool_call_update"])("matches the real translator's %s input and preserves all shell arguments", (update) => {
  const input = storedInput({ command: "printf hello", cwd: "/tmp/probe", timeout: 1000, run_in_background: false }, update);
  expect(exactCommand(input, "printf hello")).toBe(true);
  expect(exactCommand(input, "printf other")).toBe(false);
  expect(foregroundCommand(input, "printf hello")).toBe(true);
  expect(JSON.parse(input)).toEqual({ command: "printf hello", cwd: "/tmp/probe", timeout: 1000, run_in_background: false });
  expect(toolText(input)).toBe("printf hello");
});

it.each(["/bin/bash", "/bin/sh", "/bin/zsh", "bash", "sh", "zsh"])("keeps exact matching for %s wrappers, including inner quotes", (shell) => {
  for (const flag of ["-c", "-lc"]) {
    const input = storedInput({ command: `${shell} ${flag} 'printf '\\''ok'\\'''` });
    expect(exactCommand(input, "printf 'ok'")).toBe(true);
    expect(exactCommand(input, "printf 'other'")).toBe(false);
  }
});

it.each([
  { command: "printf other" },
  { command: "printf hello there" },
  { command: ["printf", "hello"] },
  { command: "bash -lc 'printf other'" },
  { command: "bash -lc 'printf hello' extra" },
  { command: "printf hello", background: true },
  { command: "printf hello", run_in_background: true },
])("does not accept a different command or background hold: %j", (input) => {
  expect(foregroundCommand(storedInput(input), "printf hello")).toBe(false);
});

it("preserves non-shell arguments for the ask and discovery matchers", () => {
  expect(mcpAskInput(storedInput({ server: "sheprd", tool: "ask", arguments: { text: "probe marker" } }), "mcp.sheprd.ask", "probe marker")).toBe(true);
  expect(mcpAskInput(storedInput({ text: "probe marker" }), "mcp__sheprd__ask", "probe marker")).toBe(true);
  expect(mcpAskInput(storedInput({ server: "other", tool: "ask", arguments: { text: "probe marker" } }), "mcp.other.ask", "probe marker")).toBe(false);
  expect(mcpAskDiscovery({ title: "ToolSearch", status: "completed", input: storedInput({ query: "select:mcp__sheprd__ask", max_results: 1 }), output: '[{"type":"tool_reference","tool_name":"mcp__sheprd__ask"}]' })).toBe(true);
  expect(JSON.parse(storedInput({ type: "text", text: "file text", path: "example.txt" }))).toEqual({ type: "text", text: "file text", path: "example.txt" });
});

it("reads earlier JSON objects and plain display text without inferring missing shell arguments", () => {
  expect(exactCommand('{"command":"printf hello"}', "printf hello")).toBe(true);
  expect(exactCommand("printf hello", "printf hello")).toBe(true);
  expect(exactCommand("bash -lc 'printf hello'", "printf hello")).toBe(true);
  expect(exactCommand("printf other", "printf hello")).toBe(false);
  expect(exactCommand(undefined, "printf hello")).toBe(false);
  expect(foregroundCommand("printf hello", "printf hello")).toBe(false);
  expect(toolText("printf hello")).toBe("printf hello");
  expect(exactCommand(storedInput("printf hello"), "printf hello")).toBe(true);
});

const translatedTool = (update: Record<string, unknown>) => {
  const content = translate({ sessionUpdate: "tool_call_update", toolCallId: "probe", status: "completed", ...update }, false)[0]!.content;
  if (content._tag !== "tool-call") throw new Error("missing tool call");
  return { ...content, status: content.status ?? "pending" };
};
const lookupInput = { query: "select:mcp__sheprd__ask", max_results: 1 };
const reference = { type: "tool_reference", tool_name: "mcp__sheprd__ask" };

it.each([
  { rawOutput: [reference] },
  { content: [{ type: "content", content: { type: "text", text: '[{"type":"tool_reference","tool_name":"mcp__sheprd__ask"}]' } }] },
])("matches discovery evidence from the real translator without flattening its output: %j", (payload) => {
  const tool = translatedTool({ title: "ToolSearch", rawInput: lookupInput, ...payload });
  expect(mcpAskDiscovery(tool)).toBe(true);
  expect(JSON.parse(tool.output!)).toEqual("rawOutput" in payload ? payload.rawOutput : payload.content);
});

it.each([
  '[{"type":"tool_reference","tool_name":"mcp__sheprd__ask"}]',
  '{\n  "type": "tool_reference",\n  "tool_name": "mcp__sheprd__ask"\n}',
  '[{"type":"tool_reference","tool_name":"mcp__sheprd__ask"}]\n[{"type":"tool_reference","tool_name":"mcp__sheprd__ask"}]',
])("reads historical discovery output without changing the required reference: %s", (output) => {
  expect(mcpAskDiscovery({ title: "ToolSearch", status: "completed", input: storedInput(lookupInput), output })).toBe(true);
});

it.each([
  { rawOutput: [{ type: "tool_reference", tool_name: "mcp__sheprd__other" }] },
  { rawOutput: [{ ...reference, extra: "unexpected" }] },
  { rawOutput: [{ type: "text", text: "The ask tool was found." }] },
  { rawOutput: [] },
])("rejects discovery output without only the exact completed reference: %j", ({ rawOutput }) => {
  const tool = translatedTool({ title: "ToolSearch", rawInput: lookupInput, rawOutput });
  expect(mcpAskDiscovery(tool)).toBe(false);
});

it("preserves structured exit evidence and decodes serialized terminal snapshots", () => {
  const tool = translatedTool({ rawOutput: { output: "visible", exit_code: 7, metadata: { retained: true } } });
  expect(exitCodeOf(tool.output!)).toBe(7);
  expect(JSON.parse(tool.output!)).toEqual({ output: "visible", exit_code: 7, metadata: { retained: true } });
  const terminal = translatedTool({ rawOutput: { terminalId: "terminal", output: "LCP_ENV_BEGIN\nPATH\nLCP_ENV_END\nthe engine refused this identity (HTTP 403)\n", truncated: false, exitCode: 1 } });
  const text = terminalToolOutput(terminal.output)!;
  expect(text).toBe("LCP_ENV_BEGIN\nPATH\nLCP_ENV_END\nthe engine refused this identity (HTTP 403)\n\nExit code: 1\n");
  expect(shellIdentityStatus(text)).toBe("absent");
  expect(authRefused(text, exitCodeOf(terminal.output!))).toBe(true);
});

it("keeps terminal-only reports from replacing the correlated terminal snapshot with an empty output", () => {
  expect(translatedTool({ content: [{ type: "terminal", terminalId: "terminal" }] })).not.toHaveProperty("output");
});

it.each([
  { payload: { rawOutput: null }, output: "null" },
  { payload: { rawOutput: [] }, output: "[]" },
  { payload: { content: [] }, output: "[]" },
])("preserves an explicit empty result instead of retaining stale evidence: %j", ({ payload, output }) => {
  expect(translatedTool(payload).output).toBe(output);
});

it("runs translated discovery snapshots through the real sandbox probe", async () => {
  const engine = fakeEngine(); engines.push(engine);
  engine.script = { onPrompt: (e, p) => {
    if (p.agentId === LEAD) {
      for (const rawOutput of [[], [reference]]) e.emit(p.agentId, { _tag: "ThreadItem", content: translatedTool({ toolCallId: "lookup", title: "ToolSearch", rawInput: lookupInput, rawOutput }) });
      e.emit(p.agentId, { _tag: "ThreadItem", content: translatedTool({ toolCallId: "lookup", status: "completed" }) });
    }
    e.emit(p.agentId, { _tag: "ThreadItem", content: translatedTool({ toolCallId: "ask", title: "mcp__sheprd__ask", rawInput: { text: markerIn(p.text) }, rawOutput: "question recorded" }) });
    e.emit(p.agentId, { _tag: "QuestionAsked", text: markerIn(p.text) }, { caller: { _tag: "agent", agentId: p.agentId } });
    e.turnEnded(p.agentId);
  } };
  expect((await runProbe(engine, "sandbox-mcp")).passed).toBe(true);
});

it.each(["serialized text", "content blocks", "terminal snapshots", "historical plain text"])("the real shell probe reads %s after merging updates", async (shape) => {
  const engine = fakeEngine({ shellListing: false }); engines.push(engine);
  engine.script = { onPrompt: (e, p) => {
    const text = "LCP_ENV_BEGIN\nPATH\nLCP_ENV_END\nthe engine refused this identity (HTTP 403)\nLCP_EXIT=1\n";
    const payload = shape === "content blocks" ? { content: [{ type: "content", content: { type: "text", text } }] }
      : { rawOutput: shape === "terminal snapshots" ? { terminalId: "terminal", output: text, truncated: false, exitCode: 1 } : text };
    e.emit(p.agentId, { _tag: "ThreadItem", content: translatedTool({ toolCallId: "shell", rawInput: { command: probeCommands(e.state).removedVariables }, rawOutput: "partial output" }) });
    const final = translatedTool({ toolCallId: "shell", status: "failed", ...payload });
    e.emit(p.agentId, { _tag: "ThreadItem", content: shape === "historical plain text" ? { ...final, output: text } : final });
    e.emit(p.agentId, { _tag: "ThreadItem", content: translatedTool({ toolCallId: "shell", status: "failed" }) });
    e.turnEnded(p.agentId);
  } };
  const result = await runProbe(engine, "removed-variables");
  expect(result.passed, result.reason).toBe(true);
  expect(result.rows.every((row) => row.outcome === "refused by ancestry check")).toBe(true);
});
