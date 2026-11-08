import { act } from "react"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { expect, it, vi } from "vitest"
import type { Sender } from "@lgcode/contracts"
import { agentId, item, mountThread } from "./thread-fixtures.tsx"

// DeliveryQueued has neither an envelope agentId nor an event agentId.
const queued = (sequence: number, id: string, text: string, sender: Sender = { _tag: "owner" }) => ({
  sequence, eventId: `event-${sequence}`, occurredAt: sequence, caller: { _tag: "owner" },
  event: { _tag: "DeliveryQueued", delivery: { id, target: agentId, sender, content: { _tag: "prompt", text } } }
})
const advancingSnapshot = () => {
  const snapshot = (sequence: number) => ({ sequence, agents: [{ agentId, name: "Worker one" }], requests: [], questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0 })
  return vi.fn().mockReturnValueOnce(Effect.succeed(snapshot(1))).mockReturnValueOnce(Effect.succeed(snapshot(1)))
    .mockReturnValue(Effect.succeed(snapshot(10)))
}

it("keeps first and later outgoing sources across history pages and displays their delivery history and question answers", async () => {
  const thread = vi.fn().mockReturnValueOnce(Effect.succeed({ items: [item(2, {
    _tag: "AgentStarted", firstPromptDelivery: queued(2, "first", "First owner prompt").event.delivery
  })], next: 2 }))
    .mockReturnValue(Effect.succeed({ items: [
      item(3, { _tag: "DeliverySent", deliveryId: "first", method: "acp" }),
      item(4, { _tag: "DeliveryAccepted", deliveryId: "first" }),
      queued(5, "later", "Later owner prompt"),
      item(6, { _tag: "DeliveryHeld", deliveryId: "later", reason: "capacity" }),
      item(7, { _tag: "QuestionAnswered", questionId: "question-1", answeredBy: { _tag: "owner" }, text: "Use the safe branch", deliveryId: "answer" })
    ] }))
  const container = await mountThread([], { "client.thread": thread, "client.subscribe": () => Stream.never })
  expect(container.textContent).toContain("First owner prompt")
  expect(container.textContent).toContain("Later owner prompt")
  expect(container.textContent).toContain("Accepted")
  expect(container.textContent).toContain("Held")
  expect(container.textContent).toContain("Use the safe branch")
  const deliveries = [...container.querySelectorAll('article[aria-label="Outgoing delivery"]')]
  const first = deliveries.find((card) => card.textContent?.includes("First owner prompt"))!
  const later = deliveries.find((card) => card.textContent?.includes("Later owner prompt"))!
  expect(first.textContent).toContain("Delivery: first")
  expect(first.textContent).toContain("Accepted")
  expect(first.textContent).not.toContain("Held")
  expect(later.textContent).toContain("Delivery: later")
  expect(later.textContent).toContain("Held")
  expect(later.textContent).not.toContain("Accepted")
})

it("recovers a live oversized source and retains it when its delivery state arrives after reconnect", async () => {
  const source = queued(2, "board-wake", "Board delivery context", { _tag: "piece", namespace: "board" })
  const read = vi.fn(() => Effect.succeed({ envelope: source }))
  const subscribe = vi.fn().mockImplementationOnce(() => Stream.concat(Stream.fromIterable([
    { _tag: "client.Oversized", sequence: 2, tag: "DeliveryQueued", bytes: 300_000 },
  ]), Stream.fail(new Error("disconnect"))))
    .mockImplementation(() => Stream.concat(Stream.fromIterable([
      item(3, { _tag: "DeliverySent", deliveryId: "board-wake", method: "acp" }),
      item(4, { _tag: "DeliveryAccepted", deliveryId: "board-wake" })
    ]), Stream.never))
  const container = await mountThread([], { "client.event": read, "client.subscribe": subscribe, "client.snapshot": advancingSnapshot() })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)) })
  expect(container.textContent).toContain("Accepted")
  expect(container.textContent).toContain("Board delivery context")
  expect(container.textContent).toContain("board-wake")
  expect(read).toHaveBeenCalledWith(expect.objectContaining({ sequence: 2 }))
  expect(subscribe.mock.calls[1]![0]).toEqual(expect.objectContaining({ after: 2 }))
})

it("keeps a historical source through all later state transitions without losing its text", async () => {
  const source = queued(2, "outgoing", "Recovered outgoing prompt")
  const container = await mountThread([source], { "client.snapshot": advancingSnapshot(), "client.subscribe": () => Stream.concat(Stream.fromIterable([
    item(3, { _tag: "DeliveryRequeued", deliveryId: "outgoing", reason: "retry" }),
    item(4, { _tag: "DeliveryReturned", deliveryId: "outgoing", sender: { _tag: "owner" }, reason: "unavailable" }),
    item(5, { _tag: "DeliveryWithdrawn", deliveryId: "outgoing", reason: "cancelled" })
  ]), Stream.never) })
  expect(container.textContent).toContain("Recovered outgoing prompt")
  expect(container.textContent).toContain("Requeued")
  expect(container.textContent).toContain("Returned")
  expect(container.textContent).toContain("Withdrawn")
})
