import { act } from "react"
import * as Effect from "effect/Effect"
import { expect, it, vi } from "vitest"
import { controlledStream } from "./controlled-stream.ts"
import { agentId, item, mountThread } from "./thread-fixtures.tsx"

const button = (container: HTMLElement, name: string) => [...container.querySelectorAll("button")]
  .find((node) => (node.getAttribute("aria-label") ?? node.textContent) === name)

it.each([true, false])("the mounted Thread settles a cancel only on terminal evidence after its action unmounts: stopped=%s", async (stopped) => {
  const live = await controlledStream()
  let sequence = 2
  const cancel = vi.fn(() => Effect.succeed({}))
  const prompt = vi.fn(() => Effect.succeed({}))
  const container = await mountThread([item(2, { _tag: "DeliverySent", deliveryId: "first", method: "acp" })], {
    "cancel-reply": cancel, prompt,
    "client.subscribe": () => live.stream,
    "client.snapshot": () => Effect.succeed({ sequence, agents: [{ agentId, name: "Worker one", state: { _tag: sequence === 3 ? "idle" : "working" } }],
      requests: [], questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0 }),
  })
  await act(async () => { button(container, "Stop reply")!.click(); button(container, "Stop reply")!.click() })
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(container.textContent).toContain("Waiting for the turn to end")
  expect(container.textContent).not.toContain("Reply stopped.")
  expect(button(container, "Send prompt")).toBeUndefined()
  await act(async () => {
    sequence = 3
    await live.emit(item(3, { _tag: "TurnEnded", compact: false, stopped }))
  })
  expect(button(container, "Stop reply")).toBeUndefined()
  expect(button(container, "Send prompt")).toBeTruthy()
  expect(container.textContent).toContain(stopped ? "Reply stopped." : "Reply ended.")
  expect(container.textContent).not.toContain("Waiting for the turn to end")
  const input = container.querySelector("textarea")!
  await act(async () => { input.value = "Next actual prompt"; input.dispatchEvent(new Event("input", { bubbles: true })) })
  await act(async () => button(container, "Send prompt")!.click())
  expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ requestId: expect.any(String), agentId, text: "Next actual prompt" }))
  await act(async () => { sequence = 4; await live.emit(item(4, { _tag: "DeliverySent", deliveryId: "next", method: "acp" })) })
  expect(button(container, "Stop reply")!.disabled).toBe(false)
  await act(async () => button(container, "Stop reply")!.click())
  expect(cancel).toHaveBeenCalledTimes(2)
  expect(cancel.mock.calls[1]).not.toEqual(cancel.mock.calls[0])
})

it("a mounted Thread's terminal evidence wins over a late cancel acknowledgement", async () => {
  const live = await controlledStream()
  let sequence = 2
  let acknowledge!: (value: object) => void
  const pending = new Promise<object>((resolve) => { acknowledge = resolve })
  const cancel = vi.fn(() => Effect.promise(() => pending))
  const container = await mountThread([item(2, { _tag: "DeliverySent", deliveryId: "first", method: "acp" })], {
    "cancel-reply": cancel, "client.subscribe": () => live.stream,
    "client.snapshot": () => Effect.succeed({ sequence, agents: [{ agentId, name: "Worker one" }],
      requests: [], questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0 }),
  })
  await act(async () => button(container, "Stop reply")!.click())
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(container.textContent).not.toContain("Reply stopped.")
  await act(async () => { sequence = 3; await live.emit(item(3, { _tag: "TurnEnded", compact: false, stopped: true })) })
  expect(container.textContent).toContain("Reply stopped.")
  await act(async () => acknowledge({}))
  expect(container.textContent).toContain("Reply stopped.")
  expect(container.textContent).not.toContain("Waiting for the turn to end")
})


it("retains the original uncertain stop through navigation and pending history, ignoring another agent's terminal event", async () => {
  const live = await controlledStream()
  let sequence = 2, pendingHistory = false
  let release!: (reply: object) => void
  const pending = new Promise<object>((resolve) => { release = resolve })
  const sent = item(2, { _tag: "DeliverySent", deliveryId: "first", method: "acp" })
  const cancel = vi.fn().mockReturnValueOnce(Effect.fail({ _tag: "CommandError", reason: "database write failed" })).mockReturnValue(Effect.succeed({}))
  const container = await mountThread([sent], {
    "cancel-reply": cancel, "client.subscribe": () => live.stream,
    "client.thread": () => pendingHistory ? Effect.promise(() => pending) : Effect.succeed({ items: [sent] }),
    "client.snapshot": () => Effect.succeed({ sequence, agents: [{ agentId, name: "Worker one" }],
      requests: [], questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0 }),
  })
  await act(async () => button(container, "Stop reply")!.click())
  expect(container.textContent).toContain("Could not confirm the stop request.")
  await act(async () => container.querySelector<HTMLAnchorElement>('nav[aria-label="Pages"] a[aria-label="Home"]')!.click())
  pendingHistory = true
  await act(async () => { history.pushState(null, "", `/#/thread/${agentId}`); window.dispatchEvent(new PopStateEvent("popstate")) })
  expect(container.textContent).toContain("Loading thread")
  expect(container.textContent).toContain("Could not confirm the stop request.")
  expect(container.textContent).not.toContain("The reply is no longer active.")
  await act(async () => release({ items: [sent] }))
  await act(async () => button(container, "Recover stop reply")!.click())
  expect(cancel).toHaveBeenCalledTimes(2)
  expect(cancel.mock.calls[1]).toEqual(cancel.mock.calls[0])
  await act(async () => { sequence = 3; await live.emit({ ...item(3, { _tag: "TurnEnded", compact: false, stopped: true }), event: { _tag: "TurnEnded", agentId: "other-agent", compact: false, stopped: true } }) })
  expect(container.textContent).toContain("Waiting for the turn to end")
  expect(container.textContent).not.toContain("Reply stopped.")
  await act(async () => { sequence = 4; await live.emit(item(4, { _tag: "TurnEnded", compact: false, stopped: true })) })
  expect(container.textContent).toContain("Reply stopped.")
})

it("the mounted Thread keeps active and idle drafts offline and permits neither stop nor send writes", async () => {
  const live = await controlledStream()
  let sequence = 2
  const cancel = vi.fn(() => Effect.succeed({})), prompt = vi.fn(() => Effect.succeed({}))
  const container = await mountThread([item(2, { _tag: "DeliverySent", deliveryId: "first", method: "acp" })], {
    "cancel-reply": cancel, prompt, "client.subscribe": () => live.stream,
    "client.snapshot": () => Effect.succeed({ sequence, agents: [{ agentId, name: "Worker one" }],
      requests: [], questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0 }),
  })
  const input = container.querySelector("textarea")!
  await act(async () => { input.value = "Keep the complete offline draft"; input.dispatchEvent(new Event("input", { bubbles: true })) })
  expect(button(container, "Send prompt")).toBeUndefined()
  await act(async () => window.dispatchEvent(new Event("offline")))
  expect(button(container, "Stop reply")!.disabled).toBe(true)
  await act(async () => { button(container, "Stop reply")!.click(); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })) })
  expect(cancel).not.toHaveBeenCalled(); expect(prompt).not.toHaveBeenCalled()
  expect(input.value).toBe("Keep the complete offline draft")
  await act(async () => window.dispatchEvent(new Event("online")))
  expect(button(container, "Stop reply")!.disabled).toBe(false)
  await act(async () => { sequence = 3; await live.emit(item(3, { _tag: "TurnEnded", compact: false })) })
  expect(button(container, "Stop reply")).toBeUndefined()
  expect(button(container, "Send prompt")!.disabled).toBe(false)
  await act(async () => window.dispatchEvent(new Event("offline")))
  expect(button(container, "Send prompt")!.disabled).toBe(true)
  await act(async () => { button(container, "Send prompt")!.click(); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })) })
  expect(cancel).not.toHaveBeenCalled(); expect(prompt).not.toHaveBeenCalled()
  expect(input.value).toBe("Keep the complete offline draft")
  await act(async () => window.dispatchEvent(new Event("online")))
  await act(async () => button(container, "Send prompt")!.click())
  expect(prompt).toHaveBeenCalledTimes(1)
  expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ requestId: expect.any(String), agentId, text: "Keep the complete offline draft" }))
})
