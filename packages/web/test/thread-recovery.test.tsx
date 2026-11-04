import { act } from "react"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { expect, it, vi } from "vitest"
import { agentId, item, mountThread, permissionRequest } from "./thread-fixtures.tsx"
import { threadHref, threadLocation } from "../src/thread/links.ts"

const snapshot = (sequence: number, requests: ReadonlyArray<unknown> = []) => ({
  sequence, agents: [{ agentId, name: "Worker one" }], requests, questions: [],
  requestsWithoutDisplay: 0, questionsWithoutDisplay: 0
})
const requestRow = { id: "permission-1", agentId, holder: { _tag: "owner" }, sourceSequence: 2 }
const allowIn = (container: HTMLElement) => [...container.querySelectorAll("button")].find((button) => button.textContent === "Allow")

it("recovers snapshot-only permission context before displaying an answer control", async () => {
  const event = vi.fn(() => Effect.succeed({ envelope: permissionRequest({ toolInput: { command: "inspect" } }) }))
  const container = await mountThread([], {
    "client.snapshot": () => Effect.succeed(snapshot(2, [requestRow])), "client.event": event
  })
  expect(event).toHaveBeenCalledTimes(1)
  expect(event).toHaveBeenCalledWith(expect.objectContaining({ sequence: 2 }))
  expect(container.textContent).toContain('"command":"inspect"')
  expect(allowIn(container)?.disabled).toBe(false)
})

it("loads later history pages and keeps answered requests from becoming actionable again", async () => {
  const read = vi.fn().mockReturnValueOnce(Effect.succeed({ items: [permissionRequest()], next: 2 }))
    .mockReturnValueOnce(Effect.succeed({ items: [item(3, {
      _tag: "PermissionAnswered", permissionRequestId: "permission-1", answer: { _tag: "selected", optionId: "allow-once" }
    }), item(4, { _tag: "ThreadItem", itemId: "later", content: { _tag: "text", text: "Later page" } })] }))
  const container = await mountThread([], { "client.thread": read })
  expect(read.mock.calls[1]![0]).toEqual(expect.objectContaining({ after: 2, agentId }))
  expect(container.textContent).toContain("Later page")
  expect(allowIn(container)).toBeUndefined()
})

it("automatically recovers a large permission marker and preserves text behind a newer control snapshot", async () => {
  const read = vi.fn().mockReturnValueOnce(Effect.succeed(snapshot(1)))
    .mockReturnValueOnce(Effect.succeed(snapshot(1)))
    .mockReturnValue(Effect.succeed(snapshot(5, [requestRow])))
  const event = vi.fn(() => Effect.succeed({ envelope: permissionRequest({ toolInput: "real input" }) }))
  const subscribe = vi.fn().mockImplementationOnce(() => Stream.concat(Stream.fromIterable([
    { _tag: "client.Oversized", sequence: 2, tag: "PermissionRequested", agentId, bytes: 300_000 },
    item(3, { _tag: "ThreadItem", itemId: "text", content: { _tag: "text", text: "Queued behind control" } }),
    { _tag: "client.Checkpoint", sequence: 5 }
  ]), Stream.fail(new Error("dropped")))).mockImplementation(() => Stream.never)
  const container = await mountThread([], { "client.snapshot": read, "client.event": event, "client.subscribe": subscribe })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)) })
  expect(container.textContent).toContain("Queued behind control")
  expect(container.textContent).toContain("real input")
  expect(allowIn(container)?.disabled).toBe(false)
  expect(container.querySelector('button[aria-label*="Load"]')).toBeNull()
  expect(event).toHaveBeenCalledTimes(1)
  expect(subscribe.mock.calls[1]![0]).toEqual(expect.objectContaining({ after: 5 }))
})

it("answers a question with its identity once and exposes hidden formatting in action input", async () => {
  const answer = vi.fn(() => Effect.succeed({}))
  const container = await mountThread([
    permissionRequest({ toolInput: { command: `echo\u202erun${" ".repeat(400)}end` }, inputTruncated: true }),
    item(3, { _tag: "QuestionAsked", questionId: "question-1", text: "Continue?", holder: { _tag: "owner" } })
  ], { answer })
  expect(container.textContent).toContain("\\u202e")
  expect(container.textContent).toContain("[400 spaces]")
  expect(container.textContent).toContain("The action's input is not visible.")
  expect(container.textContent).toContain("The action's input is cut at 8 KiB.")
  const form = container.querySelector<HTMLFormElement>('form[aria-label="Answer question"]')!
  form.querySelector("textarea")!.value = "Continue safely."
  await act(async () => { form.requestSubmit(); form.requestSubmit() })
  expect(answer).toHaveBeenCalledTimes(1)
  expect(answer).toHaveBeenCalledWith(expect.objectContaining({ kind: "question", id: "question-1", text: "Continue safely." }))
})

it("opens static-index thread links without sending commands", async () => {
  const answer = vi.fn(() => Effect.succeed({}))
  const prompt = vi.fn(() => Effect.succeed({}))
  const href = threadHref(agentId, "unknown:post-42")
  expect(new URL(href, "http://localhost").pathname).toBe("/")
  expect(threadLocation(new URL(href, "http://localhost").href)).toEqual({ agentId, subject: "unknown:post-42" })
  const container = await mountThread([], { answer, prompt }, href)
  expect(container.textContent).toContain("post-42")
  expect(answer).not.toHaveBeenCalled()
  expect(prompt).not.toHaveBeenCalled()
})
