import { act } from "react"
import * as Effect from "effect/Effect"
import { expect, it, vi } from "vitest"
import { controlledStream } from "./controlled-stream.ts"
import { agentId, item, mountThread } from "./thread-fixtures.tsx"

it("7.10 keeps the thread usable when an unknown event arrives", async () => {
  const container = await mountThread([
    item(2, { _tag: "UnknownEvent", tag: "FuturePieceEvent", namespace: "client" }),
    item(3, { _tag: "ThreadItem", itemId: "text", replay: false, content: { _tag: "text", text: "Still visible" } })
  ])
  expect(container.textContent).toContain("Still visible") // catches a page-level crash that hides subsequent supported events
})

it("FR-094 continues a mounted thread after a live unknown event and resumes its cursor", async () => {
  const live = await controlledStream()
  const reconnected = await controlledStream()
  const subscribe = vi.fn().mockImplementationOnce(() => live.stream).mockImplementation(() => reconnected.stream)
  const prompt = vi.fn(() => Effect.succeed({}))
  let sequence = 1
  const container = await mountThread([], { "client.subscribe": subscribe, prompt,
    "client.snapshot": () => Effect.succeed({ sequence, agents: [{ agentId, name: "Worker one" }], requests: [], questions: [] })
  })
  expect(container.textContent).not.toContain("Still live")
  await act(async () => { await live.emit(item(2, { _tag: "UnknownEvent", tag: "FuturePieceEvent", namespace: "client" })) })
  expect(container.querySelector('form[aria-label="Prompt agent"]')).not.toBeNull()
  await act(async () => {
    await live.emit(item(3, { _tag: "ThreadItem", itemId: "live", content: { _tag: "text", text: "Still live" } }))
  })
  expect(container.textContent).toContain("Still live")
  const form = container.querySelector<HTMLFormElement>('form[aria-label="Prompt agent"]')!
  form.querySelector("textarea")!.value = "Continue after the unknown event."
  await act(async () => { form.requestSubmit() })
  expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ agentId, text: "Continue after the unknown event." }))
  expect(container.textContent).toContain("Prompt sent.")
  await act(async () => { sequence = 3; await live.fail() })
  await act(async () => { await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2)) })
  expect(subscribe.mock.calls[1]![0]).toEqual(expect.objectContaining({ after: 3, filter: { agents: [agentId] } }))
  await act(async () => { await reconnected.emit(item(4, { _tag: "UnknownEvent", tag: "NextFutureEvent", namespace: "client" })) })
  await act(async () => { sequence = 4; await reconnected.fail() })
  await act(async () => { await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(3)) })
  expect(subscribe.mock.calls[2]![0]).toEqual(expect.objectContaining({ after: 4 }))
  expect(container.textContent).toContain("Still live")
})
