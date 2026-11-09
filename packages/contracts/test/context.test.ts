import * as Schema from "effect/Schema"
import { expect, it } from "vitest"
import { CommandsRpcGroup, ContextReferences, Event } from "../src/index.ts"

const context = [
  { _tag: "task", projectId: "project", taskId: "task" },
  { _tag: "file", projectId: "project", repoId: "repo", worktreeId: "workspace", path: "src/literal <file>.ts" }
]
it("keeps old events readable and retains selected identities through the affected durable event schemas", () => {
  const decode = Schema.decodeUnknownSync(Event), encode = Schema.encodeSync(Event)
  const delivery = { id: "delivery", target: "worker", sender: { _tag: "owner" }, content: { _tag: "prompt", text: "Original" } }
  const old = [
    { _tag: "DeliveryQueued", delivery },
    { _tag: "PromptSent", agentId: "worker", deliveryId: "delivery", sender: { _tag: "owner" }, text: "Original" },
    { _tag: "board.PostWritten", postId: "post", channelId: "channel", author: { _tag: "owner" }, text: "Original", to: [], reply: "none" },
    { _tag: "board.WakeBuilt", wakeId: "wake", targetAgentId: "worker", carried: ["post"], mustReply: [], reminders: [], completions: [], completionReplyText: [], noAnswers: [] }
  ]
  for (const wire of old) {
    expect(decode(wire)).toEqual(wire)
    const selected = wire._tag === "DeliveryQueued" ? { ...wire, delivery: { ...delivery, content: { ...delivery.content, context } } } : { ...wire, context }
    expect(decode(JSON.parse(JSON.stringify(encode(decode(selected)))))).toEqual(selected)
  }
})
it("keeps context optional on old commands and accepts identities without trusting display fields", () => {
  for (const [name, body] of [
    ["prompt", { requestId: "request", agentId: "worker", text: "Original" }],
    ["board.post", { requestId: "request", channelId: "channel", text: "Original", to: [], reply: "none" }]
  ] as const) {
    const decode = Schema.decodeUnknownSync(CommandsRpcGroup.requests.get(name)!.payloadSchema)
    expect(decode(body)).toEqual(body)
    expect(decode({ ...body, context: context.map((ref) => ({ ...ref, label: "Not authority", permission: "full", root: "/private" })) })).toEqual({ ...body, context })
  }
  expect(Schema.is(ContextReferences)(Array(17).fill(context[0]))).toBe(false)
  expect(Schema.is(ContextReferences)([{ ...context[1], path: "../private" }])).toBe(false)
})
