import { act } from "react"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { expect, it, vi } from "vitest"
import { controlledStream } from "./controlled-stream.ts"
import { agentId, item, mountThread, permissionRequest, requestId } from "./thread-fixtures.tsx"

it.each([
  { name: "matching", callId: "tool-1", flags: {}, warning: false },
  { name: "redacted", callId: "tool-1", flags: { inputRedacted: true }, warning: true },
  { name: "truncated", callId: "tool-1", flags: { inputTruncated: true }, warning: true },
  { name: "different tool", callId: "other-tool", flags: {}, warning: true }
])("FR-038 shares a loaded live action with its request: $name", async ({ callId, flags, warning }) => {
  const live = await controlledStream()
  const full = item(2, { _tag: "ThreadItem", itemId: "large", content: {
    _tag: "file-change", callId, path: "src/large.ts", diff: `+loaded change\n${"x".repeat(270_000)}`
  } })
  const read = vi.fn(() => Effect.succeed({ envelope: full }))
  let sequence = 1
  const subscribe = vi.fn().mockImplementationOnce(() => live.stream).mockImplementation(() => Stream.never)
  const container = await mountThread([], {
    "client.subscribe": subscribe, "client.event": read,
    "client.snapshot": () => Effect.succeed({ sequence, agents: [{ agentId, name: "Worker one" }],
      requests: sequence === 1 ? [] : [{ id: requestId, agentId, holder: { _tag: "owner" }, sourceSequence: 3 }],
      questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0 })
  })
  await act(async () => {
    sequence = 3
    await live.emit({ _tag: "client.Oversized", sequence: 2, tag: "ThreadItem", agentId, bytes: 300_000 })
    await live.emit({ ...permissionRequest(flags), sequence: 3 })
  })
  const request = () => container.querySelector<HTMLElement>(`[data-request-id="${requestId}"]`)!
  expect(request().textContent).toContain("The action's input is not visible.")
  expect(read).not.toHaveBeenCalled()
  await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Load full thread item"]')!.click() })
  expect(read).toHaveBeenCalledTimes(1)
  if (callId === "tool-1") {
    expect(request().textContent).toContain("src/large.ts")
    expect(request().textContent).toContain("+loaded change")
    const allow = [...request().querySelectorAll("button")].find((button) => button.textContent === "Allow")!
    for (const text of ["src/large.ts", "+loaded change"]) {
      const context = [...request().querySelectorAll("pre")].find((node) => node.textContent?.startsWith(text))!
      expect(context.compareDocumentPosition(allow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(context.closest("details:not([open]), [hidden]")).toBeNull()
    }
  } else expect(request().textContent).not.toContain("+loaded change")
  expect(request().textContent?.includes("The action's input is not visible.")).toBe(warning)
  expect(container.querySelectorAll('article[aria-label="Agent message"]')).toHaveLength(1)
  expect(container.querySelector('button[aria-label="Load full thread item"]')).toBeNull()
  if ("inputRedacted" in flags) expect(request().textContent).toContain("redaction changed it")
  if ("inputTruncated" in flags) expect(request().textContent).toContain("cut at 8 KiB")

  // A subsequent publication and reconnect must retain the recovered event.
  await act(async () => {
    sequence = 4
    await live.emit({ _tag: "client.Oversized", sequence: 4, tag: "ThreadItem", agentId: "other-agent", bytes: 300_000 })
    await live.fail()
  })
  await act(async () => { await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2)) })
  expect(container.querySelectorAll('article[aria-label="Agent message"]')).toHaveLength(1)
  expect(request().textContent?.includes("The action's input is not visible.")).toBe(warning)
})

it("FR-038 rejects an unrelated recovered agent and permits a successful retry", async () => {
  const full = item(3, { _tag: "ThreadItem", itemId: "large", content: {
    _tag: "tool-call", callId: "tool-1", title: "Inspect project", status: "pending", input: "inspect src" }
  })
  const read = vi.fn().mockReturnValueOnce(Effect.succeed({ envelope: { ...full, event: { ...full.event, agentId: "other-agent" } } }))
    .mockReturnValue(Effect.succeed({ envelope: full }))
  const container = await mountThread([permissionRequest(),
    { _tag: "client.Oversized", sequence: 3, tag: "ThreadItem", agentId, bytes: 300_000 }
  ], { "client.event": read })
  const request = container.querySelector('[data-request-id="permission-1"]')!
  await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Load full thread item"]')!.click() })
  expect(container.textContent).toContain("Could not load this item. Try again.")
  expect(request.textContent).toContain("The action's input is not visible.")
  expect(request.textContent).not.toContain("inspect src")
  await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Load full thread item"]')!.click() })
  expect(read).toHaveBeenCalledTimes(2)
  expect(request.textContent).toContain("inspect src")
  expect(request.textContent).not.toContain("The action's input is not visible.")
  expect(container.querySelectorAll('article[aria-label="Agent message"]')).toHaveLength(1)
})

it("FR-038 cancels a content read when leaving the thread and ignores late completion", async () => {
  let release!: (value: { envelope: ReturnType<typeof item> }) => void
  const pending = new Promise<{ envelope: ReturnType<typeof item> }>((resolve) => { release = resolve })
  const finalized = vi.fn()
  const read = vi.fn(() => Effect.tryPromise(() => pending).pipe(Effect.ensuring(Effect.sync(finalized))))
  const container = await mountThread([
    { _tag: "client.Oversized", sequence: 3, tag: "ThreadItem", agentId, bytes: 300_000 }
  ], { "client.event": read, "client.subscribe": () => Stream.never })
  const load = container.querySelector<HTMLButtonElement>('button[aria-label="Load full thread item"]')!
  await act(async () => { load.click(); load.click() })
  expect(read).toHaveBeenCalledTimes(1)
  expect(load.disabled).toBe(true)
  await act(async () => { container.querySelector<HTMLAnchorElement>('nav[aria-label="Pages"] a[aria-label="Home"]')!.click() })
  expect(finalized).toHaveBeenCalledTimes(1)
  await act(async () => { release({ envelope: item(3, { _tag: "ThreadItem", itemId: "late", content: { _tag: "text", text: "late content" } }) }) })
  expect(container.querySelector('[aria-label="Thread"]')).toBeNull()
  expect(container.textContent).not.toContain("late content")
})
