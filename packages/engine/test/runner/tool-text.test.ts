import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { expect, it } from "vitest";
import { translate } from "../../src/runner/translate.ts";
it("renders adapter command and content as readable text and leaves omitted output unchanged", () => {
  expect(translate({ sessionUpdate: "tool_call", toolCallId: "c", title: "Run shell", status: "pending", rawInput: { command: "printf hello" } }, false)[0]?.content)
    .toMatchObject({ input: "printf hello" });
  expect(translate({ sessionUpdate: "tool_call_update", toolCallId: "c", status: "completed", content: [{ type: "content", content: { type: "text", text: "hello\nworld" } }] }, false)[0]?.content)
    .toMatchObject({ output: "hello\nworld" });
  expect(translate({ sessionUpdate: "tool_call_update", toolCallId: "c", status: "in_progress" }, false)[0]?.content).not.toHaveProperty("output");
  expect(translate({ sessionUpdate: "tool_call_update", toolCallId: "c", rawOutput: "more output" }, false)[0]?.content).not.toHaveProperty("status");
});

registerRebuildCheck({ noLog: true });
