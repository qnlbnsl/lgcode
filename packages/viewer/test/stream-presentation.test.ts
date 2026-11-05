import { expect, it } from "vitest";
import { threadText } from "../src/text.ts";
import { envelope } from "../../client/test/support/unit3.ts";
it("renders one reply, one readable command and one prompt with its source and states", () => {
  const items = [
    envelope(1, { _tag: "DeliveryQueued", delivery: { id: "d", target: "agent-a", sender: { _tag: "owner" }, source: { _tag: "wait", id: "w" }, content: { _tag: "prompt", text: "Unique prompt" } } }),
    envelope(2, { _tag: "DeliverySent", agentId: "agent-a", deliveryId: "d", method: "acp" }),
    envelope(3, { _tag: "PromptSent", agentId: "agent-a", deliveryId: "d", sender: { _tag: "owner" }, text: "Unique prompt" }),
    envelope(4, { _tag: "DeliveryAccepted", agentId: "agent-a", deliveryId: "d" }),
    ...["P", "INE", "APPLE"].map((text, i) => envelope(i + 5, { _tag: "ThreadItem", agentId: "agent-a", itemId: "m", replay: false, content: { _tag: "text", text } })),
    envelope(8, { _tag: "ThreadItem", agentId: "agent-a", itemId: "c1", replay: false, content: { _tag: "tool-call", callId: "c", title: "printf hello", status: "pending" } }),
    envelope(9, { _tag: "ThreadItem", agentId: "agent-a", itemId: "c2", replay: false, content: { _tag: "tool-call", callId: "c", title: "", status: "completed", output: '{"output":"hello\\nworld","exitCode":0}' } }),
  ];
  const text = threadText(items);
  expect(text.map((entry) => entry.text)).toEqual([
    "Prompt · From: Owner\nSource: wait: w\nUnique prompt\nQueued → Sent → Accepted", "PINEAPPLE", "printf hello\ncompleted\nhello\nworld\nExit code: 0"
  ]);
});
