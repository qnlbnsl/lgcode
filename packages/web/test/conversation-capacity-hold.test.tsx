import { act } from "react"
import * as Effect from "effect/Effect"
import { expect, it, vi } from "vitest"
import { CommandHandler } from "../../engine/src/commands/CommandHandler.ts"
import { runCapacity, hold, eventsNamed } from "../../engine/test/support/capacityRig.ts"
import { accept, send, spawn, promptsTo } from "../../engine/test/support/deliveryRig.ts"
import { agentRow, call, headSequence, ownerCredential, readLog, success } from "../../engine/test/support/handlerRig.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"
import { controlledStream } from "./controlled-stream.ts"
import { agentId, cleanupThread, item, mountThread } from "./thread-fixtures.tsx"

const button = (container: HTMLElement, name: string) => [...container.querySelectorAll("button")]
  .find((node) => (node.getAttribute("aria-label") ?? node.textContent) === name)
const observe = (check: () => void) => vi.waitFor(async () => { await act(async () => {}); check() })

for (const scenario of [
  { accepted: true, pendingCancel: false },
  { accepted: true, pendingCancel: true },
  { accepted: false, pendingCancel: true },
]) it(`issue 602: real capacity hold restores mounted Send and retires cancellation; accepted=${scenario.accepted}, pending=${scenario.pendingCancel}`, async () => {
  let acknowledge: (() => void) | undefined
  try {
    await runCapacity((rig, runner) => Effect.gen(function* () {
      yield* registerRebuildCheck()
      const target = yield* spawn(rig, runner, undefined, { name: "Worker one" })
      const deliveryId = yield* send(runner, target, "Original actual work")
      if (scenario.accepted) yield* accept(runner, target, deliveryId)
      const initial = success(yield* call(ownerCredential, "client.thread", { agentId: target.agentId, after: 0, limit: 100 }))
      expect(initial.items.some((row: { event: { _tag: string } }) => row.event._tag === "DeliverySent")).toBe(true)
      const handler = yield* CommandHandler
      const live = yield* Effect.promise(controlledStream)
      const pending = new Promise<void>((resolve) => { acknowledge = resolve })
      let cancelReached = false
      const cancel = vi.fn((payload: Record<string, unknown>) => handler.execute(ownerCredential, "cancel-reply", payload).pipe(
        Effect.flatMap((reply) => {
          cancelReached = true
          return scenario.pendingCancel ? Effect.promise(() => pending.then(() => reply)) : Effect.succeed(reply)
        }),
      ))
      const prompt = vi.fn((payload: Record<string, unknown>) => handler.execute(ownerCredential, "prompt", payload))
      const client: Record<string, unknown> = Object.fromEntries([
        "client.snapshot", "client.thread", "client.requests", "client.alerts.list", "client.sequence", "accounts", "client.agent.configuration",
      ].map((name) => [name, (payload: Record<string, unknown>) => handler.execute(ownerCredential, name, payload)]))
      client["client.subscribe"] = () => live.stream
      client["cancel-reply"] = cancel
      client.prompt = prompt
      let container!: HTMLElement
      yield* Effect.promise(async () => {
        container = await mountThread(initial.items, client, `/thread/${target.agentId}`)
        await observe(() => expect(button(container, "Stop reply")).toBeTruthy())
        await act(async () => {
          const input = container.querySelector("textarea")!
          input.value = "Keep this unsent draft through the hold"
          input.dispatchEvent(new Event("input", { bubbles: true }))
        })
        if (scenario.pendingCancel) {
          await act(async () => button(container, "Stop reply")!.click())
          await observe(() => expect(cancelReached).toBe(true))
          expect(cancel).toHaveBeenCalledTimes(1)
          expect(runner.callsOf("cancel")).toHaveLength(1)
          expect(container.textContent).not.toContain("Reply stopped.")
        }
      })
      const before = yield* headSequence
      const held = yield* hold(runner, target, deliveryId)
      expect((yield* agentRow(target.agentId))?.state._tag).toBe("idle")
      expect(eventsNamed(held, "DeliveryHeld")).toEqual([{ _tag: "DeliveryHeld", agentId: target.agentId, deliveryId, reason: "capacity" }])
      expect(eventsNamed(held, "TurnEnded")).toEqual([])
      expect(eventsNamed(held, "StateChanged")).toEqual([])
      expect(eventsNamed(held, "DeliveryRequeued")).toHaveLength(scenario.accepted ? 0 : 1)
      if (scenario.accepted) expect(eventsNamed(held, "DeliveryQueued")).toHaveLength(1)
      const page = success(yield* call(ownerCredential, "client.thread", { agentId: target.agentId, after: before, limit: 100 }))
      yield* Effect.promise(async () => {
        // Only committed authenticated thread envelopes cross this transport.
        // The engine owns acceptance, the carry-on and the hold; none are fabricated.
        await act(async () => { for (const row of page.items) await live.emit(row) })
        await observe(() => {
          expect(button(container, "Stop reply")).toBeUndefined()
          expect(button(container, "Recover stop reply")).toBeUndefined()
          expect(button(container, "Send prompt")?.disabled).toBe(false)
        })
        expect(container.querySelector("textarea")!.value).toBe("Keep this unsent draft through the hold")
        expect(container.textContent).not.toContain("Reply stopped.")
        expect(container.textContent).not.toContain("Waiting for the turn to end")
        expect(container.textContent).not.toContain("Could not confirm the stop request.")
        await act(async () => acknowledge?.())
        expect(button(container, "Send prompt")?.disabled).toBe(false)
        expect(button(container, "Recover stop reply")).toBeUndefined()
        expect(container.textContent).not.toContain("Waiting for the turn to end")
        await act(async () => button(container, "Send prompt")!.click())
        await observe(() => expect(container.querySelector("textarea")!.value).toBe(""))
        expect(prompt).toHaveBeenCalledTimes(1)
        expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ agentId: target.agentId, text: "Keep this unsent draft through the hold", requestId: expect.any(String) }))
      })
      expect(promptsTo(runner, target)).toHaveLength(1)
      const queued = (yield* readLog).filter((row) => row.event._tag === "DeliveryQueued" && row.event.delivery.target === target.agentId
        && row.event.delivery.content._tag === "prompt" && row.event.delivery.content.text === "Keep this unsent draft through the hold")
      expect(queued).toHaveLength(1)
    }))
  } finally {
    acknowledge?.()
    await cleanupThread()
  }
}, 20_000)


it("issue 602: mounted cancellation ignores holds for another agent or delivery and retires only its own", async () => {
  const live = await controlledStream()
  let sequence = 2, observedSequence = 0
  const cancel = vi.fn(() => Effect.succeed({}))
  const container = await mountThread([item(2, { _tag: "DeliverySent", deliveryId: "first", method: "acp" })], {
    "cancel-reply": cancel, "client.subscribe": () => live.stream,
    "client.snapshot": () => { observedSequence = sequence; return Effect.succeed({ sequence,
      agents: [{ agentId, name: "Worker one", state: { _tag: sequence === 5 || sequence === 8 ? "idle" : "working" } }],
      requests: [], questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0 }) },
  })
  await act(async () => button(container, "Stop reply")!.click())
  expect(container.textContent).toContain("Waiting for the turn to end")
  const emit = async (next: number, event: Record<string, unknown>) => {
    await act(async () => { sequence = next; await live.emit(item(next, event)) })
    await observe(() => expect(observedSequence).toBe(next))
  }
  await emit(3, { _tag: "DeliveryHeld", deliveryId: "another-delivery", reason: "capacity" })
  expect(button(container, "Stop reply")).toBeTruthy()
  expect(container.textContent).toContain("Waiting for the turn to end")
  await emit(4, { _tag: "DeliveryHeld", agentId: "another-agent", deliveryId: "first", reason: "capacity" })
  expect(button(container, "Stop reply")).toBeTruthy()
  expect(container.textContent).toContain("Waiting for the turn to end")
  await emit(5, { _tag: "DeliveryHeld", deliveryId: "first", reason: "capacity" })
  await observe(() => expect(button(container, "Send prompt")).toBeTruthy())
  expect(button(container, "Recover stop reply")).toBeUndefined()
  expect(container.textContent).not.toContain("Waiting for the turn to end")
  expect(container.textContent).not.toContain("Reply stopped.")
  await emit(6, { _tag: "DeliverySent", deliveryId: "next", method: "acp" })
  await act(async () => button(container, "Stop reply")!.click())
  expect(cancel).toHaveBeenCalledTimes(2)
  expect(cancel.mock.calls[0]).not.toEqual(cancel.mock.calls[1])
  await emit(7, { _tag: "DeliveryHeld", deliveryId: "first", reason: "capacity" })
  expect(button(container, "Stop reply")).toBeTruthy()
  expect(container.textContent).toContain("Waiting for the turn to end")
  await emit(8, { _tag: "DeliveryHeld", deliveryId: "next", reason: "capacity" })
  await observe(() => expect(button(container, "Send prompt")).toBeTruthy())
  expect(container.textContent).not.toContain("Waiting for the turn to end")
  expect(container.textContent).not.toContain("Reply stopped.")
})
