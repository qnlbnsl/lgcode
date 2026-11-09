import { click, environment, mount, questionEvent, request, resetData } from "./page-fixtures.tsx"
import { act } from "react"
import * as Effect from "effect/Effect"
import { beforeEach, expect, it, vi } from "vitest"
import { RequestList, RequestBlock } from "../src/requests/RequestList.tsx"
import { Request, type RequestEvent } from "../src/thread/request.tsx"
import { clearRequestAttempts, useRequestAttempt } from "../src/thread/requestAttempt.ts"
import { requestId } from "../src/thread/client.ts"
import { Lifecycle } from "../src/thread/lifecycle.tsx"

beforeEach(resetData)
const panel = (id: string) => {
  const envelope = questionEvent(id)
  return <Request event={envelope.event as RequestEvent} open items={[envelope]} signal={new AbortController().signal} />
}
it("simultaneous copies share the uncertain lock, require authoritative refresh, and retry unchanged text with the original key", async () => {
  const answer = vi.fn().mockReturnValueOnce(Effect.fail({ _tag: "ClientError" })).mockReturnValue(Effect.succeed({}))
  environment.client.answer = answer
  environment.client["client.requests"] = () => Effect.succeed({ items: [request({ id: "shared-question" })], sequence: 12 })
  const { container } = await mount(<>{panel("shared-question")}{panel("shared-question")}</>)
  const ids = [...container.querySelectorAll("section")].map((row) => row.id)
  expect(new Set(ids).size).toBe(ids.length)
  const forms = [...container.querySelectorAll("form")]
  for (const form of forms) form.querySelector("textarea")!.value = "Same answer"
  await act(async () => forms[0]!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
  await vi.waitFor(() => expect(container.textContent).toContain("Could not confirm"))
  await act(async () => forms[1]!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
  expect(answer).toHaveBeenCalledTimes(1)
  expect([...container.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].every((row) => row.disabled)).toBe(true)
  await click(container, "Refresh this request")
  await act(async () => forms[0]!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
  await vi.waitFor(() => expect(answer).toHaveBeenCalledTimes(2))
  expect(answer.mock.calls[1]![0]).toEqual(answer.mock.calls[0]![0])
})

it("a refreshed request held by an agent stays unanswerable and never claims that an answer was sent", async () => {
  environment.client.answer = () => Effect.fail({ _tag: "ClientError" })
  environment.client["client.requests"] = () => Effect.succeed({ items: [request({ id: "moved-question", holder: { _tag: "agent", agentId: "worker" }, canAnswer: false })], sequence: 12 })
  const { container } = await mount(panel("moved-question"))
  container.querySelector("textarea")!.value = "Wait"
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
  await click(container, "Refresh this request")
  await vi.waitFor(() => expect(container.textContent).toContain("closed or held elsewhere"))
  expect(container.textContent).not.toContain("Answer sent.")
  expect(container.querySelector("form")).toBeNull()
})

it("a definite server refusal gets a fresh command only after an authoritative open-owner refresh", async () => {
  const answer = vi.fn().mockReturnValueOnce(Effect.fail({ _tag: "CommandError", reason: "held elsewhere" })).mockReturnValue(Effect.succeed({}))
  environment.client.answer = answer
  environment.client["client.requests"] = () => Effect.succeed({ items: [request({ id: "refused-question" })], sequence: 12 })
  const { container } = await mount(panel("refused-question"))
  container.querySelector("textarea")!.value = "Direction"
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
  await click(container, "Refresh this request")
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
  expect(answer).toHaveBeenCalledTimes(2)
  expect(answer.mock.calls[1]![0].requestId).not.toBe(answer.mock.calls[0]![0].requestId)
})

it("a missing or mismatched full event exposes no answer buttons", async () => {
  environment.client["client.event"] = () => Effect.succeed({ envelope: questionEvent("different-request") })
  const { container } = await mount(<RequestBlock request={request({ id: "expected-request" })} />)
  await vi.waitFor(() => expect(container.textContent).toContain("Could not load the full request"))
  expect(container.querySelector("textarea")).toBeNull()
})

it("removing the answered row focuses the next row, then the explicit empty state", async () => {
  environment.client["client.event"] = () => Effect.succeed({ envelope: questionEvent("first") })
  const first = request({ id: "first" }), second = request({ id: "second", sourceSequence: 11 })
  const { container, render } = await mount(<RequestList requests={[first, second]} />)
  const button = container.querySelector<HTMLButtonElement>('[data-home-item="question:first"]')!
  await act(async () => { button.focus(); button.click() })
  await render(<RequestList requests={[second]} />)
  expect(document.activeElement).toBe(container.querySelector('[data-home-item="question:second"]'))
  await act(async () => (document.activeElement as HTMLButtonElement).click())
  await render(<RequestList requests={[]} />)
  expect(document.activeElement).toBe(container.querySelector(".request-list"))
  expect(document.activeElement!.textContent).toContain("No open requests.")
})

it("reconnecting disables both question and permission submissions", async () => {
  environment.disabled = true
  environment.client.answer = vi.fn(() => Effect.succeed({}))
  const { container } = await mount(panel("offline-question"))
  expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
  expect(environment.client.answer).not.toHaveBeenCalled()
})

it.each(["failed", "sending"] as const)("session teardown clears a retained %s attempt and ignores its late completion", async (status) => {
  let captured: ReturnType<typeof useRequestAttempt>["entry"] | undefined
  function Probe() {
    const { state, entry } = useRequestAttempt("session-question")
    captured = entry
    return <output>{state.status}:{state.command?.value ?? "empty"}</output>
  }
  const { container, render } = await mount(<Probe />)
  const oldEntry = captured!
  const command = { value: "Private owner answer", requestId: requestId() }
  await act(async () => oldEntry.update({ status, locked: true, command }))
  expect(container.textContent).toContain(command.value)
  // Navigation retains an uncertain command within the same owner session.
  await render(null)
  await render(<Probe />)
  expect(captured).toBe(oldEntry)
  expect(container.textContent).toContain(command.value)
  await act(async () => clearRequestAttempts())
  expect(oldEntry.state).toEqual({ status: "ready", locked: false })
  expect(container.textContent).toBe("ready:empty")
  await render(null)
  await render(<Probe />)
  const nextEntry = captured!
  expect(nextEntry).not.toBe(oldEntry)
  expect(nextEntry.state).toEqual({ status: "ready", locked: false })
  // The abandoned transport may still settle after the new session mounts.
  await act(async () => oldEntry.update({ status: "failed", locked: true, command }))
  expect(oldEntry.state.command).toBeUndefined()
  expect(nextEntry.state).toEqual({ status: "ready", locked: false })
  expect(container.textContent).toBe("ready:empty")
})

it.each(["ClientError", "CommandError"])("failed-start Resume handles %s receipts without claiming the agent is running", async (tag) => {
  const resume = vi.fn().mockReturnValueOnce(Effect.fail({ _tag: tag })).mockReturnValue(Effect.succeed({}))
  environment.client.resume = resume
  const agent = { ...environment.data.snapshot!.agents[0]!, state: { _tag: "stopped" as const }, startFailure: "could-not-start" as const }
  const { container } = await mount(<Lifecycle agent={agent} signal={new AbortController().signal} />)
  await click(container, "Resume agent")
  await vi.waitFor(() => expect(container.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false))
  await click(container, "Resume agent")
  await vi.waitFor(() => expect(container.textContent).toContain("Resume requested."))
  expect(resume).toHaveBeenCalledTimes(2)
  const first = resume.mock.calls[0]![0], second = resume.mock.calls[1]![0]
  expect(first).toMatchObject({ agentId: agent.agentId, fresh: true })
  expect(second.requestId === first.requestId).toBe(tag === "ClientError")
  expect(container.textContent).not.toMatch(/agent (?:is )?running/i)
})

it("the shared mutation guard disables failed-start Resume during reconnect", async () => {
  environment.disabled = true
  const resume = vi.fn(() => Effect.succeed({}))
  environment.client.resume = resume
  const agent = { ...environment.data.snapshot!.agents[0]!, state: { _tag: "stopped" as const } }
  const { container } = await mount(<Lifecycle agent={agent} signal={new AbortController().signal} />)
  expect(container.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true)
  await click(container, "Resume agent")
  expect(resume).not.toHaveBeenCalled()
})
