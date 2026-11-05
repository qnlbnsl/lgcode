import { expect, it } from "vitest";
import { toolText } from "@shephrd/contracts/thread";
import { translate } from "../../src/runner/translate.ts";
import { exactCommand, foregroundCommand, mcpAskDiscovery, mcpAskInput } from "../../scripts/live/probeEvidence.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

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
  expect(mcpAskInput(storedInput({ server: "shephrd", tool: "ask", arguments: { text: "probe marker" } }), "mcp.shephrd.ask", "probe marker")).toBe(true);
  expect(mcpAskInput(storedInput({ text: "probe marker" }), "mcp__shephrd__ask", "probe marker")).toBe(true);
  expect(mcpAskInput(storedInput({ server: "other", tool: "ask", arguments: { text: "probe marker" } }), "mcp.other.ask", "probe marker")).toBe(false);
  expect(mcpAskDiscovery({ title: "ToolSearch", status: "completed", input: storedInput({ query: "select:mcp__shephrd__ask", max_results: 1 }), output: '[{"type":"tool_reference","tool_name":"mcp__shephrd__ask"}]' })).toBe(true);
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
