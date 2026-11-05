import { act } from "react"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { expect, it, vi } from "vitest"
import { item, mountThread } from "./thread-fixtures.tsx"

const fragment = (sequence: number, text: string, itemId = "reply-1") => item(sequence, {
  _tag: "ThreadItem", itemId, replay: false, content: { _tag: "text", text }
})

it("joins reply fragments across pages and reconnects, preserving one plain-text block", async () => {
  const thread = vi.fn().mockReturnValueOnce(Effect.succeed({ items: [fragment(2, "P")], next: 2 }))
    .mockReturnValue(Effect.succeed({ items: [fragment(3, "INE") ] }))
  const subscribe = vi.fn().mockImplementationOnce(() => Stream.concat(Stream.fromIterable([fragment(4, "APPLE")]), Stream.fail("disconnect")))
    .mockImplementation(() => Stream.concat(Stream.fromIterable([fragment(4, "APPLE"), fragment(5, "<b>safe</b>")]), Stream.never))
  const snapshot = { sequence: 10, agents: [{ agentId: "worker-1", name: "Worker one" }], requests: [], questions: [] }
  const snapshots = vi.fn().mockReturnValueOnce(Effect.succeed({ ...snapshot, sequence: 1 })).mockReturnValueOnce(Effect.succeed({ ...snapshot, sequence: 1 })).mockReturnValue(Effect.succeed(snapshot))
  const container = await mountThread([], { "client.thread": thread, "client.subscribe": subscribe, "client.snapshot": snapshots })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)) })
  const blocks = container.querySelectorAll('article[aria-label="Agent message"]')
  expect(blocks).toHaveLength(1)
  expect(blocks[0]!.textContent).toContain("PINEAPPLE<b>safe</b>")
  expect(blocks[0]!.querySelector("b")).toBeNull()
})

it("updates one command with its status and readable output without dropping its command", async () => {
  const tool = (sequence: number, fields: object) => item(sequence, { _tag: "ThreadItem", itemId: `tool-${sequence}`, replay: false,
    content: { _tag: "tool-call", callId: "call-1", title: "", status: "pending", ...fields } })
  const container = await mountThread([
    tool(2, { title: "printf hello", input: "printf hello" }),
    tool(3, { status: "in_progress" }),
    tool(4, { status: "completed", output: "hello\nworld" })
  ], { "client.subscribe": () => Stream.never })
  const blocks = container.querySelectorAll('article[aria-label="Agent message"]')
  expect(blocks).toHaveLength(1)
  expect(blocks[0]!.textContent).toContain("printf hello")
  expect(blocks[0]!.textContent).toContain("completed")
  expect(blocks[0]!.textContent).toContain("hello\nworld")
})

it("shows one prompt with its source and queue, send and acceptance states", async () => {
  const container = await mountThread([
    item(2, { _tag: "AgentStarted", firstPromptDelivery: { id: "first", target: "worker-1", sender: { _tag: "owner" }, content: { _tag: "prompt", text: "Unique first prompt" } } }),
    item(3, { _tag: "DeliverySent", deliveryId: "first", method: "acp" }),
    item(4, { _tag: "PromptSent", deliveryId: "first", sender: { _tag: "owner" }, text: "Unique first prompt" }),
    item(5, { _tag: "DeliveryAccepted", deliveryId: "first" })
  ], { "client.subscribe": () => Stream.never })
  expect(container.textContent!.split("Unique first prompt")).toHaveLength(2)
  const prompt = container.querySelector('article[aria-label="Outgoing delivery"]')!
  for (const text of ["Owner", "Queued", "Sent", "Accepted"]) expect(prompt.textContent).toContain(text)
})

it("puts stopped agents and failed starts in their own lane with a safe reason", async () => {
  const snapshot = { sequence: 1, agents: [{ agentId: "worker-1", name: "Worker one", role: "worker", harness: "codex", groups: [],
    state: { _tag: "stopped" }, openPermissionRequests: 0, openQuestionsAsked: 0, startFailure: "not-signed-in" }], requests: [], questions: [] }
  const container = await mountThread([], { "client.snapshot": () => Effect.succeed(snapshot), "client.subscribe": () => Stream.never }, "/")
  expect(container.querySelector('[aria-label="Stopped"]')?.textContent).toContain("Worker one")
  expect(container.querySelector('[aria-label="Stopped"]')?.textContent).toContain("Not signed in")
  expect(container.querySelector('[aria-label="Idle"]')?.textContent).not.toContain("Worker one")
})

it("shows a failed start in its thread and prompts explain why it failed", async () => {
  const container = await mountThread([item(2, { _tag: "AgentStartFailed", reason: "model-refused" })], { "client.subscribe": () => Stream.never })
  expect(container.textContent).toContain("Failed to start: Adapter refused the model")
})

it("stops and resumes from the thread using the existing commands", async () => {
  const stop = vi.fn(() => Effect.succeed({}))
  const resume = vi.fn(() => Effect.succeed({}))
  const container = await mountThread([], { stop, resume, "client.subscribe": () => Stream.never })
  const button = [...container.querySelectorAll("button")].find((button) => button.textContent === "Stop agent")
  expect(button).toBeDefined()
  await act(async () => { button!.click() })
  expect(stop).toHaveBeenCalledWith(expect.objectContaining({ agentId: "worker-1" }))
  const snapshots = { sequence: 1, agents: [{ agentId: "worker-1", name: "Worker one", state: { _tag: "stopped" } }], requests: [], questions: [] }
  const stopped = await mountThread([], { stop, resume, "client.snapshot": () => Effect.succeed(snapshots), "client.subscribe": () => Stream.never })
  const resumeButton = [...stopped.querySelectorAll("button")].find((button) => button.textContent === "Resume agent")
  expect(resumeButton).toBeDefined()
  await act(async () => { resumeButton!.click() })
  expect(resume).toHaveBeenCalledWith(expect.objectContaining({ agentId: "worker-1" }))
})

it("shows one updated tool action in a permission request's missing-input context", async () => {
  const tool = (sequence: number, status: string) => item(sequence, { _tag: "ThreadItem", itemId: `c-${sequence}`, replay: false,
    content: { _tag: "tool-call", callId: "call-1", title: "printf hello", status } })
  const container = await mountThread([tool(2, "pending"), tool(3, "in_progress"), item(4, {
    _tag: "PermissionRequested", permissionRequestId: "p", holder: { _tag: "owner" }, deliveryId: "d", toolCallId: "call-1", description: "Run command", options: [], settingsWrite: false
  })], { "client.subscribe": () => Stream.never })
  const context = container.querySelector('[aria-label="Permission request"]')!
  expect(context.textContent!.split("Matching tool action")).toHaveLength(2)
  expect(context.textContent).toContain("in_progress")
})
