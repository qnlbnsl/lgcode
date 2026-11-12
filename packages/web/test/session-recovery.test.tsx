import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { afterEach, expect, it, vi } from "vitest"
import { App } from "../src/index.ts"

const browser = vi.hoisted(() => ({ client: undefined as unknown, connect: vi.fn() }))
vi.mock("@lgtm/client/browser", async () => {
  const Effect = await import("effect/Effect")
  return { connect: (...args: unknown[]) => { browser.connect(...args); return Effect.succeed(browser.client) } }
})

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ root: Root; container: HTMLDivElement }> = []
const snapshot = (sequence = 7, count = 0) => ({
  sequence, agents: [{
    agentId: "worker", name: "Worker", role: "worker", groups: [], parent: { _tag: "owner" },
    state: { _tag: "idle" }, displayedState: "Idle", openPermissionRequests: count, openQuestionsAsked: 0,
    harness: "codex", account: "default", permission: "ask", folder: "/work", startedAt: 1
  }], requests: [], questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0
})
const envelope = (sequence: number, event: object) => ({
  sequence, eventId: `event-${sequence}`, occurredAt: sequence, caller: { _tag: "owner" }, event
})
const render = async () => {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => { root.render(<App />) })
  return container
}
const eventually = async (check: () => void) => {
  for (let attempt = 0; ; attempt++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    try { check(); return } catch (error) { if (attempt >= 150) throw error }
  }
}

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => { root.unmount() })
    container.remove()
  }
  history.replaceState(null, "", "/")
  vi.unstubAllGlobals()
  browser.connect.mockReset()
  browser.client = undefined
})

it("keeps session-check failures out of the owner view and lets the owner retry", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
  vi.stubGlobal("fetch", fetch)
  const container = await render()
  expect(container.querySelector('.app')).toBeNull()
  expect(container.querySelector('form[aria-label="Log in"]')).toBeNull()
  await act(async () => { container.querySelector("button")!.click() })
  expect(container.querySelector('form[aria-label="Log in"]')).not.toBeNull()
  expect(browser.connect).not.toHaveBeenCalled()
  expect(fetch.mock.calls.every(([, options]) => options.method === "POST")).toBe(true)
})

it("clears the password before a pending login settles, sends one request for a double submit, and opens the cookie session", async () => {
  let complete!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => { complete = resolve })
  const subscribe = vi.fn(() => Stream.never)
  browser.client = { "client.snapshot": () => Effect.succeed(snapshot()), "client.subscribe": subscribe }
  const fetch = vi.fn(async (url: string) => url === "/api/session" ? new Response(null, { status: 401 }) : pending)
  vi.stubGlobal("fetch", fetch)
  const container = await render()
  const password = container.querySelector<HTMLInputElement>('input[type="password"]')!
  const form = container.querySelector("form")!
  await act(async () => {
    password.value = crypto.randomUUID()
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
  })
  expect(password.value).toBe("")
  expect(fetch.mock.calls.filter(([url]) => url === "/api/login")).toHaveLength(1)
  expect(container.querySelector('.app')).toBeNull()
  await act(async () => { complete(new Response(null, { status: 204 })) })
  await eventually(() => expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ after: 7 })))
  expect(container.querySelector('.repo-tree')?.textContent).toContain("Worker")
  expect(browser.connect).toHaveBeenCalledWith({ url: expect.stringMatching(/^ws:\/\/.+\/api$/) })
})

it("uses the client stream, skips unknown events safely, and resumes from a checkpoint", async () => {
  const rawSubscribe = vi.fn(() => { throw new Error("unfiltered engine subscription used") })
  const subscribe = vi.fn().mockImplementationOnce(() => Stream.concat(Stream.fromIterable([
    envelope(8, { _tag: "UnknownEvent", tag: "future.Change", namespace: "future" }),
    { _tag: "client.Checkpoint", sequence: 11 }
  ]), Stream.fail(new Error("dropped")))).mockImplementation(() => Stream.never)
  const current = { ...snapshot(), project: { sequence: 7, truncated: false,
    projects: [], repositories: [], workspaces: [], teams: [], agents: [], tasks: [], sprints: [] } }
  browser.client = { "client.snapshot": () => Effect.succeed(current), "client.subscribe": subscribe, subscribe: rawSubscribe,
    "client.requests": () => Effect.succeed({ sequence: current.sequence, items: [] }),
    "client.alerts.list": () => Effect.succeed({ items: [] }),
    "client.sequence": () => Effect.succeed({ sequence: current.sequence }) }
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  const container = await render()
  await eventually(() => expect(subscribe).toHaveBeenCalledTimes(2))
  expect(subscribe.mock.calls[1]![0]).toEqual(expect.objectContaining({ after: 11 }))
  expect(rawSubscribe).not.toHaveBeenCalled()
  expect(container.querySelector('.repo-tree')?.textContent).toContain("Worker")
})

it("waits for a coherent control snapshot before acknowledging a permission event", async () => {
  const read = vi.fn().mockReturnValueOnce(Effect.succeed(snapshot()))
    .mockReturnValueOnce(Effect.succeed(snapshot()))
    .mockReturnValue(Effect.succeed(snapshot(9, 1)))
  const subscribe = vi.fn().mockImplementationOnce(() => Stream.concat(Stream.fromIterable([
    envelope(8, { _tag: "PermissionRequested", agentId: "worker" })
  ]), Stream.fail(new Error("dropped")))).mockImplementation(() => Stream.never)
  browser.client = { "client.snapshot": read, "client.subscribe": subscribe }
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  const container = await render()
  await eventually(() => expect(subscribe).toHaveBeenCalledTimes(2))
  expect(subscribe.mock.calls[1]![0]).toEqual(expect.objectContaining({ after: 9 }))
  expect(container.querySelector('.repo-tree')?.textContent).toContain("Worker")
  expect(read).toHaveBeenCalledTimes(3)
})

it("drops the owner view when a failed stream's session probe is unauthorized", async () => {
  browser.client = { "client.snapshot": () => Effect.succeed(snapshot()), "client.subscribe": () => Stream.fail(new Error("dropped")) }
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValue(new Response(null, { status: 401 }))
  vi.stubGlobal("fetch", fetch)
  const container = await render()
  await eventually(() => expect(container.querySelector('form[aria-label="Log in"]')).not.toBeNull())
  expect(container.querySelector('.app')).toBeNull()
  expect(container.textContent).not.toContain("Worker")
})

it("closes the stream scope when the owner logs out", async () => {
  let closed = false
  browser.client = {
    "client.snapshot": () => Effect.succeed(snapshot()),
    "client.subscribe": () => Stream.never.pipe(Stream.ensuring(Effect.sync(() => { closed = true })))
  }
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  const container = await render()
  await eventually(() => expect(container.querySelector('.repo-tree')?.textContent).toContain("Worker"))
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Log out"]')!.click() })
  await eventually(() => expect(closed).toBe(true))
  expect(container.querySelector('form[aria-label="Log in"]')).not.toBeNull()
})

it("shows an immediately replayed state transition as authoritative over the snapshot", async () => {
  browser.client = {
    "client.snapshot": () => Effect.succeed(snapshot()),
    "client.subscribe": () => Stream.concat(Stream.fromIterable([
      envelope(8, { _tag: "StateChanged", agentId: "worker", state: { _tag: "working" } })
    ]), Stream.never)
  }
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  const container = await render()
  await eventually(() => expect(container.querySelector('.repo-tree')?.textContent).toContain("Worker"))
  expect(container.querySelector('.agent-link small')?.textContent).toBe("Working")
})

it("takes a fresh snapshot after the server refuses a cursor", async () => {
  const read = vi.fn().mockReturnValueOnce(Effect.succeed(snapshot(7)))
    .mockReturnValue(Effect.succeed(snapshot(2)))
  const subscribe = vi.fn().mockImplementationOnce(() => Stream.fail({ _tag: "CommandError", reason: "command refused" }))
    .mockImplementation(() => Stream.never)
  browser.client = { "client.snapshot": read, "client.subscribe": subscribe }
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  const container = await render()
  await eventually(() => expect(subscribe).toHaveBeenCalledTimes(2))
  expect(subscribe.mock.calls[1]![0]).toEqual(expect.objectContaining({ after: 2 }))
  expect(read).toHaveBeenCalledTimes(2)
  expect(container.querySelector('.repo-tree')?.textContent).toContain("Worker")
})

it("clears uncertain request submissions at logout before a fresh owner session mounts", async () => {
  history.replaceState(null, "", "/#/thread/worker")
  const source = envelope(2, { _tag: 'QuestionAsked', agentId: 'worker', questionId: 'session-question', text: 'Continue?', holder: { _tag: 'owner' } })
  const current = { ...snapshot(), questions: [{ id: 'session-question', agentId: 'worker', sourceSequence: 2, holder: { _tag: 'owner' } }],
    project: { sequence: 7, truncated: false, projects: [], repositories: [], workspaces: [], teams: [], agents: [], tasks: [], sprints: [] } }
  const answer = vi.fn(() => Effect.fail(new Error('uncertain answer')))
  browser.client = { 'client.snapshot': () => Effect.succeed(current), 'client.subscribe': () => Stream.never,
    'client.thread': () => Effect.succeed({ items: [source] }), answer,
    'client.requests': () => Effect.succeed({ sequence: 7, items: [] }), 'client.alerts.list': () => Effect.succeed({ items: [] }),
    'client.sequence': () => Effect.succeed({ sequence: 7 }) }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
  const container = await render()
  const send = () => container.querySelector<HTMLButtonElement>('form[aria-label="Answer question"] button')!
  await eventually(() => expect(send()?.disabled).toBe(false))
  const field = container.querySelector<HTMLTextAreaElement>('form[aria-label="Answer question"] textarea')!
  field.value = 'private session answer'
  await act(async () => field.form!.requestSubmit())
  await eventually(() => expect(container.textContent).toContain('Could not confirm the answer.'))
  expect(send().disabled).toBe(true)
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Log out"]')!.click())
  expect(container.querySelector('.app')).toBeNull()
  expect(container.textContent).not.toContain('private session answer')
  const login = container.querySelector<HTMLFormElement>('form[aria-label="Log in"]')!
  login.querySelector<HTMLInputElement>('input')!.value = 'new session password'
  await act(async () => login.requestSubmit())
  await eventually(() => expect(send()?.disabled).toBe(false))
  expect(container.querySelector<HTMLTextAreaElement>('form[aria-label="Answer question"] textarea')!.value).toBe('')
  expect(answer).toHaveBeenCalledTimes(1)
})
