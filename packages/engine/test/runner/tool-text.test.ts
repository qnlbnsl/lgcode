import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { expect, it } from "vitest";
import { translate } from "../../src/runner/translate.ts";
import { toolText } from "@lgcode/contracts/thread";
it("preserves adapter input for readable display and leaves omitted output unchanged", () => {
  const content = translate({ sessionUpdate: "tool_call", toolCallId: "c", title: "Run shell", status: "pending", rawInput: { command: "printf hello" } }, false)[0]!.content;
  expect(content).toMatchObject({ input: '{"command":"printf hello"}' });
  if (content._tag !== "tool-call") throw new Error("missing tool call");
  expect(toolText(content.input!)).toBe("printf hello");
  const output = translate({ sessionUpdate: "tool_call_update", toolCallId: "c", status: "completed", content: [{ type: "content", content: { type: "text", text: "hello\nworld" } }] }, false)[0]!.content;
  expect(output).toMatchObject({ output: '[{"type":"content","content":{"type":"text","text":"hello\\nworld"}}]' });
  if (output._tag !== "tool-call") throw new Error("missing tool call");
  expect(toolText(output.output!)).toBe("hello\nworld");
  expect(translate({ sessionUpdate: "tool_call_update", toolCallId: "c", status: "in_progress" }, false)[0]?.content).not.toHaveProperty("output");
  expect(translate({ sessionUpdate: "tool_call_update", toolCallId: "c", rawOutput: "more output" }, false)[0]?.content).not.toHaveProperty("status");
});

registerRebuildCheck({ noLog: true });
