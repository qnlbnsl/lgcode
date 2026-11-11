import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import * as Effect from "effect/Effect"
import * as Deferred from "effect/Deferred"
import * as Stream from "effect/Stream"
import * as Schema from "effect/Schema"
import { ClientRequest, EventEnvelope } from "@lgcode/contracts"
import { afterEach, expect, it, vi } from "vitest"
import { App } from "../src/app.tsx"
import { controlledStream } from "./controlled-stream.ts"

const browser = vi.hoisted(() => ({ client: undefined as unknown }))
// Effect-valued connect is synchronous, just like the real browser client.
vi.mock("@lgcode/client/browser", async () => { const Effect = await import("effect/Effect"); return { connect: () => Effect.succeed(browser.client) } })
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const roots: Array<{ root: Root; container: HTMLDivElement }> = []
const agent = { agentId: "lead", name: "Lead <script>", role: "lead", groups: [], parent: { _tag: "owner" }, state: { _tag: "idle" }, displayedState: "Idle", openPermissionRequests: 0, openQuestionsAsked: 0, harness: "codex", account: "default", permission: "ask", folder: "/work", startedAt: 1 }
const project = { projectId: "p", repoId: "r", name: "Actual project", goal: "Build", leadAgentId: "lead", worktreeId: "w", machineId: "local" }
const snapshot = { sequence: 7, agents: [agent], requests: [], questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0, project: {
  sequence: 7, truncated: false, repositories: [{ repoId: "r", name: "Actual repository", path: "/work" }], projects: [project],
  workspaces: [{ worktreeId: "w", repoId: "r", branch: "main", path: "/work", machineId: "local" }], teams: [{ projectId: "p", teamId: "t", name: "Actual team", worktreeId: "w" }],
  agents: [{ agentId: "lead", projectId: "p", status: "Ready" }], tasks: [], sprints: []
} }
function client() { return { "client.snapshot": () => Effect.succeed(snapshot), "client.subscribe": () => Stream.never,
  "client.requests": () => Effect.succeed({ sequence: 7, items: [] }), "client.alerts.list": () => Effect.succeed({ items: [] }), "client.sequence": () => Effect.succeed({ sequence: 7 }) } }
async function mount(path = "/#/") {
  history.replaceState(null, "", path)
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  const container = document.createElement("div"); document.body.append(container)
  const root = createRoot(container); roots.push({ root, container })
  await act(async () => { root.render(<App />) })
  return container
}
async function eventually(check: () => void) {
  for (let count = 0; ; count++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    try { check(); return } catch (error) { if (count > 100) throw error }
  }
}
afterEach(async () => {
  for (const { root, container } of roots.splice(0)) { await act(async () => root.unmount()); container.remove() }
  history.replaceState(null, "", "/"); localStorage.clear(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})
it("keeps disclosure separate from selection and uses real entity names as text", async () => {
  browser.client = client()
  const container = await mount()
  await eventually(() => expect(container.querySelector('.project-select')?.textContent).toBe("Actual project"))
  expect(container.querySelector("script")).toBeNull()
  const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Collapse Actual repository"]')!
  await act(async () => toggle.click())
  expect(location.hash).toBe("#/")
  expect(container.querySelector('.project-select')).toBeNull()
  await act(async () => toggle.click())
  await act(async () => container.querySelector<HTMLAnchorElement>('.project-select')!.click())
  expect(location.hash).toBe("#/project/p/board")
  expect(container.querySelector('.project-select')?.getAttribute('aria-current')).toBe("page")
  await act(async () => container.querySelector<HTMLAnchorElement>('.team-select')!.click())
  expect(location.hash).toBe("#/project/p/team/t/chat")
  expect(container.querySelector('.project-select')?.hasAttribute('aria-current')).toBe(false)
  expect(container.querySelector('.team-select')?.getAttribute('aria-current')).toBe("page")
})
it("ranks the quick switcher by name, supports keyboard selection, and restores its opener", async () => {
  browser.client = client()
  const container = await mount()
  await eventually(() => expect(container.querySelector('.project-select')).not.toBeNull())
  const opener = container.querySelector<HTMLButtonElement>('[aria-label="Find project or agent"]')!
  await act(async () => { opener.focus(); opener.click() })
  expect(document.activeElement?.getAttribute("role")).toBe("combobox")
  expect(container.querySelector("main")?.hasAttribute("inert")).toBe(true)
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
  expect(container.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(opener)
})
it("does not steal shortcut keys from input, editable content, or terminal elements", async () => {
  browser.client = client()
  const container = await mount()
  for (const node of [document.createElement("input"), document.createElement("div"), document.createElement("div")]) {
    if (node.tagName !== "INPUT") node.setAttribute("contenteditable", "true")
    container.append(node)
    const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true })
    await act(async () => node.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(false)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    node.remove()
  }
  const terminal = document.createElement("div"); terminal.dataset.terminal = ""; container.append(terminal)
  const event = new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true, cancelable: true })
  await act(async () => terminal.dispatchEvent(event))
  expect(event.defaultPrevented).toBe(false)
})
it("remembers bounded navigation widths and folds to its remembered rail", async () => {
  browser.client = client()
  const container = await mount()
  const handle = container.querySelector<HTMLElement>('[role="separator"]')!
  await act(async () => handle.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })))
  expect(handle.getAttribute("aria-valuenow")).toBe("360")
  expect(localStorage.getItem("lgcode-layout-sidebar")).toBe("360")
  expect(container.querySelector<HTMLElement>('.app')?.style.getPropertyValue('--sidebar-width')).toBe("360px")
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true })))
  expect(container.querySelector('.sidebar-collapsed')).not.toBeNull()
  expect(localStorage.getItem('lgcode-sidebar')).toBe('rail')
})
it("refreshes a coherent project snapshot for namespace changes and retains the last tree on a failed paged recovery", async () => {
  const live = await controlledStream()
  let current = snapshot
  let projectionRevision = 7
  let recoveryFails = false
  browser.client = { ...client(), "client.snapshot": () => Effect.succeed(current), "client.subscribe": () => live.stream,
    "client.requests": () => recoveryFails ? Effect.fail(new Error("unavailable")) : Effect.succeed({ sequence: projectionRevision, items: [] }),
    "client.sequence": () => Effect.succeed({ sequence: projectionRevision }) }
  const container = await mount()
  await eventually(() => expect(container.querySelector('.project-select')?.textContent).toBe('Actual project'))
  await act(async () => {
    projectionRevision = 8
    current = { ...snapshot, sequence: 8, project: { ...snapshot.project, sequence: 8, projects: [{ ...project, name: 'Renamed project' }] } }
    await live.emit({ sequence: 8, eventId: 'e8', occurredAt: 8, caller: { _tag: 'owner' }, event: { _tag: 'project.Renamed', projectId: 'p', name: 'Renamed project' } })
  })
  await eventually(() => expect(container.querySelector('.project-select')?.textContent).toBe('Renamed project'))
  await act(async () => {
    recoveryFails = true
    current = { ...current, sequence: 9 }
    await live.emit({ sequence: 9, eventId: 'e9', occurredAt: 9, caller: { _tag: 'owner' }, event: { _tag: 'project.Renamed', projectId: 'p', name: 'Not yet coherent' } })
  })
  expect(container.querySelector('.project-select')?.textContent).toBe('Renamed project')
  expect(container.textContent).toContain('Showing the last complete project navigation.')
})

it("contains the phone drawer's focus, inerts the view, and restores Menu on Escape", async () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  browser.client = client()
  const container = await mount()
  const menu = container.querySelector<HTMLButtonElement>('[aria-label="Open navigation"]')!
  await act(async () => { menu.focus(); menu.click() })
  const drawer = container.querySelector<HTMLElement>('.sidebar')!
  expect(drawer.getAttribute('role')).toBe('dialog')
  expect(drawer.hasAttribute('inert')).toBe(false)
  expect(container.querySelector('main')?.hasAttribute('inert')).toBe(true)
  expect(drawer.contains(document.activeElement)).toBe(true)
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(drawer.getAttribute('role')).toBeNull()
  expect(drawer.hasAttribute('inert')).toBe(true)
  expect(document.activeElement).toBe(menu)
})
it("keeps a draft while a disconnected shell disables the independent live thread's mutations", async () => {
  const shellStream = await controlledStream()
  const prompt = vi.fn(() => Effect.succeed({}))
  browser.client = { ...client(), prompt, 'client.thread': () => Effect.succeed({ items: [] }),
    'client.subscribe': ({ filter }: { filter?: unknown }) => filter === undefined ? shellStream.stream : Stream.never }
  const container = await mount('/#/thread/lead')
  const field = container.querySelector<HTMLTextAreaElement>('form[aria-label="Prompt agent"] textarea')!
  const send = container.querySelector<HTMLButtonElement>('[aria-label="Send prompt"]')!
  await act(async () => { field.value = 'Retain my draft'; field.dispatchEvent(new Event('input', { bubbles: true })) })
  await eventually(() => expect(send.disabled).toBe(false))
  await act(async () => shellStream.fail())
  expect(send.disabled).toBe(true)
  expect(field.value).toBe('Retain my draft')
  await act(async () => field.form!.requestSubmit())
  expect(prompt).not.toHaveBeenCalled()
})
it("blocks a live thread immediately on native offline and waits for coherent recovery after online", async () => {
  const recovered = await Effect.runPromise(Deferred.make<void>())
  let recovering = false
  const prompt = vi.fn(() => Effect.succeed({}))
  browser.client = { ...client(), prompt, 'client.thread': () => Effect.succeed({ items: [] }),
    'client.requests': () => recovering ? Deferred.await(recovered).pipe(Effect.as({ sequence: 7, items: [] })) : Effect.succeed({ sequence: 7, items: [] }) }
  const container = await mount('/#/thread/lead')
  const field = container.querySelector<HTMLTextAreaElement>('form[aria-label="Prompt agent"] textarea')!
  const send = container.querySelector<HTMLButtonElement>('[aria-label="Send prompt"]')!
  await act(async () => { field.value = 'Private draft survives native offline'; field.dispatchEvent(new Event('input', { bubbles: true })) })
  await eventually(() => expect(send.disabled).toBe(false))
  await act(async () => window.dispatchEvent(new Event('offline')))
  expect(send.disabled).toBe(true)
  expect(field.value).toBe('Private draft survives native offline')
  await act(async () => field.form!.requestSubmit())
  expect(prompt).not.toHaveBeenCalled()
  recovering = true
  await act(async () => window.dispatchEvent(new Event('online')))
  expect(send.disabled).toBe(true)
  expect(field.value).toBe('Private draft survives native offline')
  await act(async () => { await Effect.runPromise(Deferred.succeed(recovered, undefined)) })
  await eventually(() => expect(send.disabled).toBe(false))
  expect(prompt).not.toHaveBeenCalled()
})

it("reuses a recovered permission source for summary, detail and later independent thread hydration", async () => {
  const live = await controlledStream()
  const permission = Schema.decodeUnknownSync(EventEnvelope)({ sequence: 8, eventId: 'permission-source', occurredAt: 8, caller: { _tag: 'owner' }, event: {
    _tag: 'PermissionRequested', agentId: 'lead', permissionRequestId: 'shared-source', holder: { _tag: 'owner' },
    deliveryId: 'delivery', toolCallId: 'call', description: 'Actual approval source', toolInput: { command: 'printf shared-source' },
    options: [{ id: 'once', name: 'Allow once', kind: 'allow_once', persistent: false, level: 'ask' }], settingsWrite: false } })
  const row = Schema.decodeUnknownSync(ClientRequest)({ kind: 'permission', id: 'shared-source', agentId: 'lead', holder: { _tag: 'owner' }, sourceSequence: 8,
    openedAt: 8, status: 'open', canAnswer: true })
  let exposed = false
  const read = vi.fn(() => Effect.succeed({ envelope: permission }))
  browser.client = { ...client(), 'client.snapshot': () => Effect.succeed(exposed ? { ...snapshot, sequence: 8, requests: [row] } : snapshot),
    'client.subscribe': ({ filter }: { filter?: unknown }) => filter === undefined ? live.stream : Stream.never,
    'client.requests': () => Effect.succeed({ sequence: exposed ? 8 : 7, items: exposed ? [row] : [] }),
    'client.sequence': () => Effect.succeed({ sequence: exposed ? 8 : 7 }), 'client.event': read,
    'client.thread': () => Effect.succeed({ items: [{ _tag: 'client.Oversized', sequence: 8, agentId: 'lead', tag: 'PermissionRequested', bytes: 1_100_000 }] }) }
  const container = await mount()
  await eventually(() => expect(container.querySelector('.project-select')).not.toBeNull())
  await act(async () => { exposed = true; await live.emit(permission) })
  await eventually(() => expect(container.querySelector('.home-row-command')?.textContent).toBe('printf shared-source'))
  // The real browser client yields this full envelope after its recovery RPC.
  // No second UI source read is needed to render its summary or full detail.
  expect(read).not.toHaveBeenCalled()
  await act(async () => container.querySelector<HTMLButtonElement>('[data-home-item="permission:shared-source"]')!.click())
  await eventually(() => expect(container.querySelector('.home-detail [data-request-id="shared-source"]')).not.toBeNull())
  expect(read).not.toHaveBeenCalled()
  await act(async () => container.querySelector<HTMLAnchorElement>('.home-detail-footer a')!.click())
  await eventually(() => expect(container.querySelector('[aria-label="Thread"] [data-request-id="shared-source"]')).not.toBeNull())
  expect(container.querySelector('[aria-label="Thread"]')?.textContent).toContain('printf shared-source')
  expect(read).not.toHaveBeenCalled()
})
it.each(["logout", "expiry", "unmount"] as const)("closes pending request-source reads at actual App %s and isolates a later owner session", async (teardown) => {
  const live = await controlledStream()
  const finalized = vi.fn()
  let release!: (reply: { envelope: typeof EventEnvelope.Type }) => void
  const pending = new Promise<{ envelope: typeof EventEnvelope.Type }>((resolve) => { release = resolve })
  const source = (command: string) => Schema.decodeUnknownSync(EventEnvelope)({ sequence: 6, eventId: 'session-permission', occurredAt: 6,
    caller: { _tag: 'owner' }, event: { _tag: 'PermissionRequested', agentId: 'lead', permissionRequestId: 'session-source',
      holder: { _tag: 'owner' }, deliveryId: 'delivery', toolCallId: 'call', description: 'Session request', toolInput: { command },
      options: [{ id: 'once', name: 'Allow once', kind: 'allow_once', persistent: false, level: 'ask' }], settingsWrite: false } })
  const row = Schema.decodeUnknownSync(ClientRequest)({ kind: 'permission', id: 'session-source', agentId: 'lead', holder: { _tag: 'owner' },
    sourceSequence: 6, openedAt: 6, status: 'open', canAnswer: true })
  const read = vi.fn().mockImplementationOnce(() => Effect.tryPromise(() => pending).pipe(Effect.ensuring(Effect.sync(finalized))))
    .mockImplementation(() => Effect.succeed({ envelope: source('current owner source') }))
  browser.client = { ...client(), 'client.subscribe': () => live.stream, 'client.event': read,
    'client.requests': () => Effect.succeed({ sequence: 7, items: [row] }) }
  let container = await mount()
  await eventually(() => expect(read).toHaveBeenCalledTimes(1))
  if (teardown === 'logout') await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Log out"]')!.click())
  else if (teardown === 'expiry') {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))
    await act(async () => live.fail())
  } else {
    const mounted = roots.pop()!
    await act(async () => mounted.root.unmount())
    mounted.container.remove()
  }
  await eventually(() => expect(finalized).toHaveBeenCalledTimes(1))
  await act(async () => release({ envelope: source('previous owner late private source') }))
  browser.client = { ...browser.client as ReturnType<typeof client>, 'client.subscribe': () => Stream.never }
  if (teardown === 'unmount') container = await mount()
  else {
    await eventually(() => expect(container.querySelector('form[aria-label="Log in"]')).not.toBeNull())
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    const login = container.querySelector<HTMLFormElement>('form[aria-label="Log in"]')!
    login.querySelector<HTMLInputElement>('input')!.value = 'new owner password'
    await act(async () => login.requestSubmit())
  }
  await eventually(() => expect(container.querySelector('.home-row-command')?.textContent).toBe('current owner source'))
  expect(read).toHaveBeenCalledTimes(2)
  expect(container.textContent).not.toContain('previous owner late private source')
})
it("keeps keyboard focus on workspace tabs and preserves query context on direct service links", async () => {
  browser.client = client()
  const container = await mount('/#/project/p/board')
  await eventually(() => expect(container.querySelector('.project-select')).not.toBeNull())
  const board = container.querySelector<HTMLAnchorElement>('[role="tab"][href="/#/project/p/board"]')!
  await act(async () => {
    board.focus()
    board.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
  })
  expect(location.hash).toBe('#/thread/lead')
  expect(document.activeElement?.textContent).toBe('Chat')
  const link = document.createElement('a'); link.href = '/#/service/machines?project=p'; container.querySelector('.view-body')!.append(link)
  await act(async () => link.click())
  expect(location.hash).toBe('#/service/machines?project=p')
})
it("keeps the full owner count and failed-notification badge while the bell shows six failures-first DTO rows", async () => {
  const requests = Array.from({ length: 8 }, (_, index) => ({ kind: 'question', id: `q-${index}`, agentId: 'lead', holder: { _tag: 'owner' },
    sourceSequence: index + 5, openedAt: index + 1, status: 'open', canAnswer: true }))
  const failedAgent = { ...agent, state: { _tag: 'stopped' }, startFailure: 'not-signed-in' }
  browser.client = { ...client(), 'client.snapshot': () => Effect.succeed({ ...snapshot, sequence: 100, agents: [failedAgent] }),
    'client.requests': () => Effect.succeed({ sequence: 100, items: [...requests, { ...requests[0], id: 'not-owner', holder: { _tag: 'agent', agentId: 'lead' } }] }),
    'client.sequence': () => Effect.succeed({ sequence: 100 }),
    'client.alerts.list': () => Effect.succeed({ items: Array.from({ length: 3 }, (_, index) => ({ alertId: `a-${index}`, delivery: { status: 'failed' } })) }) }
  const container = await mount()
  await eventually(() => expect(container.querySelector('[aria-label="9 items need attention"]')).not.toBeNull())
  expect(container.querySelector('[aria-label="3 failed notifications"]')).not.toBeNull()
  await act(async () => container.querySelector<HTMLButtonElement>('.topbar .attention-toggle')!.click())
  const bell = container.querySelector('.attention-menu')!
  expect(bell.querySelectorAll('.failed-start-list > details')).toHaveLength(1)
  expect(bell.querySelectorAll('.home-request-row')).toHaveLength(5)
  expect(bell.querySelector('[data-home-item="question:q-0"]')).not.toBeNull()
  expect(bell.querySelector('[data-home-item="question:q-5"]')).toBeNull()
  expect(bell.querySelector('.failed-start-list')!.compareDocumentPosition(bell.querySelector('.request-list')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it.each(['requests', 'alerts'])("retains the complete tree when a %s cursor does not advance", async (collection) => {
  const live = await controlledStream()
  let current = snapshot
  let malformed = false
  browser.client = { ...client(), 'client.snapshot': () => Effect.succeed(current), 'client.subscribe': () => live.stream,
    'client.requests': () => Effect.succeed({ sequence: current.sequence, items: [], ...(malformed && collection === 'requests' ? { next: 0 } : {}) }),
    'client.alerts.list': () => Effect.succeed({ items: [], ...(malformed && collection === 'alerts' ? { next: 0 } : {}) }),
    'client.sequence': () => Effect.succeed({ sequence: current.sequence }) }
  const container = await mount()
  await eventually(() => expect(container.querySelector('[aria-label="0 items need attention"]')).not.toBeNull())
  await act(async () => {
    malformed = true
    current = { ...snapshot, sequence: 8 }
    await live.emit({ sequence: 8, eventId: 'e8', occurredAt: 8, caller: { _tag: 'owner' }, event: { _tag: 'project.Renamed', projectId: 'p', name: 'Project' } })
  })
  expect(container.querySelector('.project-select')?.textContent).toBe('Actual project')
  expect(container.querySelector('[aria-label="Unknown number of items need attention"]')).not.toBeNull()
  expect(container.textContent).toContain('Showing the last complete project navigation.')
})

it("returns an already mounted Home view to Needs attention when its navigation link resets the URL", async () => {
  browser.client = client()
  const container = await mount()
  await eventually(() => expect(container.querySelector('.project-select')).not.toBeNull())
  const projects = [...container.querySelectorAll<HTMLButtonElement>('.home-tabs button')].find((button) => button.querySelector('.tab-long')?.textContent === 'All projects')!
  await act(async () => projects.click())
  expect(location.hash).toBe('#/?view=projects')
  expect(projects.getAttribute('aria-selected')).toBe('true')
  await act(async () => container.querySelector<HTMLAnchorElement>('.home-nav a[aria-label="Home"]')!.click())
  expect(location.hash).toBe('#/')
  expect(container.querySelector('.home-tabs [aria-selected="true"] .tab-long')?.textContent).toBe('Needs attention')
})

// The real shared watcher receives one refresh followed by a quiet, content-only
// marker. The page reads have already advanced beyond that snapshot's anchor.
async function mismatchedRecovery() {
  const live = await controlledStream()
  const state = { snapshot, sequence: 7, final: undefined as Deferred.Deferred<void, Error> | undefined, active: 0, maximum: 0 }
  const snapshots = vi.fn(() => Effect.succeed(state.snapshot))
  const requests = vi.fn(() => Effect.succeed({ sequence: state.sequence, items: [] }))
  const subscribe = vi.fn(({ filter }: { filter?: unknown }) => {
    if (filter !== undefined) return Stream.never
    state.maximum = Math.max(state.maximum, ++state.active)
    return live.stream.pipe(Stream.ensuring(Effect.sync(() => { state.active-- })))
  })
  const prompt = vi.fn(() => Effect.succeed({}))
  browser.client = { ...client(), prompt, 'client.thread': () => Effect.succeed({ items: [] }),
    'client.snapshot': snapshots, 'client.subscribe': subscribe, 'client.requests': requests,
    'client.sequence': () => state.final === undefined ? Effect.succeed({ sequence: state.sequence })
      : Deferred.await(state.final).pipe(Effect.as({ sequence: state.sequence })) }
  const container = await mount('/#/thread/lead')
  const field = container.querySelector<HTMLTextAreaElement>('form[aria-label="Prompt agent"] textarea')!
  const send = container.querySelector<HTMLButtonElement>('[aria-label="Send prompt"]')!
  await act(async () => { field.value = 'Draft retained through incompatible revisions'; field.dispatchEvent(new Event('input', { bubbles: true })) })
  await eventually(() => expect(send.disabled).toBe(false))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  const publish = async (sequence: number) => {
    state.snapshot = { ...snapshot, sequence }
    await act(async () => { await live.emit({ sequence, eventId: `refresh-${sequence}`, occurredAt: sequence,
      caller: { _tag: 'owner' }, event: { _tag: 'TurnEnded', agentId: 'lead' } }) })
  }
  state.sequence = 19
  await publish(18)
  await act(async () => { await live.emit({ _tag: 'client.Checkpoint', sequence: 19 }) })
  expect(requests).toHaveBeenCalledTimes(2)
  expect(container.querySelector('[aria-label="Unknown number of items need attention"]')).not.toBeNull()
  expect(container.querySelector('.project-select')?.textContent).toBe('Actual project')
  expect(send.disabled).toBe(true)
  expect(field.value).toBe('Draft retained through incompatible revisions')
  return { live, state, snapshots, requests, subscribe, prompt, container, field, send, publish }
}

it('recovers snapshot18/request19 on a quiet stream through one fresh watcher, preserving the draft and coherent write guard', async () => {
  const h = await mismatchedRecovery()
  const before = h.snapshots.mock.calls.length
  h.state.snapshot = { ...snapshot, sequence: 19 }
  h.state.final = await Effect.runPromise(Deferred.make<void, Error>())
  await act(async () => { await vi.advanceTimersByTimeAsync(249) })
  expect(h.snapshots).toHaveBeenCalledTimes(before)
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(h.snapshots).toHaveBeenCalledTimes(before + 1)
  expect(h.requests).toHaveBeenCalledTimes(3)
  expect(h.send.disabled).toBe(true)
  expect(h.field.value).toBe('Draft retained through incompatible revisions')
  await act(async () => h.field.form!.requestSubmit())
  expect(h.prompt).not.toHaveBeenCalled()
  await act(async () => { await Effect.runPromise(Deferred.succeed(h.state.final!, undefined)) })
  expect(h.send.disabled).toBe(false)
  expect(h.container.querySelector('[aria-label="0 items need attention"]')).not.toBeNull()
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
  expect(h.snapshots).toHaveBeenCalledTimes(before + 1)
  expect(h.state.maximum).toBe(1)
  expect(h.state.active).toBe(1)
})

it('backs off repeated incoherent reads without enabling writes or creating parallel watchers', async () => {
  const h = await mismatchedRecovery()
  const before = h.snapshots.mock.calls.length
  for (const delay of [250, 500, 1_000, 2_000, 4_000, 5_000, 5_000]) {
    const count = h.snapshots.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(delay - 1) })
    expect(h.snapshots).toHaveBeenCalledTimes(count)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(h.snapshots).toHaveBeenCalledTimes(count + 1)
    expect(h.send.disabled).toBe(true)
  }
  expect(h.snapshots).toHaveBeenCalledTimes(before + 7)
  expect(h.field.value).toBe('Draft retained through incompatible revisions')
  expect(h.state.maximum).toBe(1)
})

it('cancels a pending collection recovery when a newer coherent snapshot replaces it', async () => {
  const h = await mismatchedRecovery()
  h.state.sequence = 20
  await h.publish(20)
  expect(h.send.disabled).toBe(false)
  const before = h.snapshots.mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
  expect(h.snapshots).toHaveBeenCalledTimes(before)
  expect(h.state.maximum).toBe(1)
})

it('cancels recovery offline and requires coherent reads from the new online generation', async () => {
  const h = await mismatchedRecovery()
  await act(async () => window.dispatchEvent(new Event('offline')))
  const before = h.snapshots.mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
  expect(h.snapshots).toHaveBeenCalledTimes(before)
  expect(h.state.active).toBe(0)
  h.state.snapshot = { ...snapshot, sequence: 19 }
  h.state.final = await Effect.runPromise(Deferred.make<void, Error>())
  await act(async () => window.dispatchEvent(new Event('online')))
  expect(h.snapshots).toHaveBeenCalledTimes(before + 1)
  expect(h.send.disabled).toBe(true)
  expect(h.field.value).toBe('Draft retained through incompatible revisions')
  await act(async () => { await Effect.runPromise(Deferred.succeed(h.state.final!, undefined)) })
  expect(h.send.disabled).toBe(false)
  expect(h.state.maximum).toBe(1)
})

it.each(['logout', 'expiry', 'unmount'] as const)('cancels an old collection retry on App %s and cannot restart a later session', async (teardown) => {
  const h = await mismatchedRecovery()
  if (teardown === 'logout') await act(async () => h.container.querySelector<HTMLButtonElement>('[aria-label="Log out"]')!.click())
  else if (teardown === 'expiry') {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))
    await act(async () => h.live.fail())
  } else {
    const mounted = roots.pop()!
    await act(async () => mounted.root.unmount())
    mounted.container.remove()
  }
  expect(h.state.active).toBe(0)
  const before = h.snapshots.mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
  expect(h.snapshots).toHaveBeenCalledTimes(before)
  browser.client = { ...client(), 'client.thread': () => Effect.succeed({ items: [] }) }
  vi.useRealTimers()
  const later = await mount('/#/thread/lead')
  const newField = later.querySelector<HTMLTextAreaElement>('form[aria-label="Prompt agent"] textarea')!
  expect(newField.value).toBe('')
  await act(async () => { newField.value = 'New owner draft'; newField.dispatchEvent(new Event('input', { bubbles: true })) })
  await eventually(() => expect(later.querySelector<HTMLButtonElement>('[aria-label="Send prompt"]')?.disabled).toBe(false))
  expect(newField.value).toBe('New owner draft')
  expect(h.snapshots).toHaveBeenCalledTimes(before)
  expect(h.state.maximum).toBe(1)
})

it('aborts a held coherent-read attempt at unmount and ignores its late failure in the later owner session', async () => {
  const h = await mismatchedRecovery()
  h.state.snapshot = { ...snapshot, sequence: 19 }
  h.state.final = await Effect.runPromise(Deferred.make<void, Error>())
  await act(async () => { await vi.advanceTimersByTimeAsync(250) })
  expect(h.requests).toHaveBeenCalledTimes(3)
  expect(h.send.disabled).toBe(true)
  const mounted = roots.pop()!
  await act(async () => mounted.root.unmount())
  mounted.container.remove()
  expect(h.state.active).toBe(0)
  const before = h.snapshots.mock.calls.length
  browser.client = { ...client(), 'client.thread': () => Effect.succeed({ items: [] }) }
  vi.useRealTimers()
  const later = await mount('/#/thread/lead')
  const newField = later.querySelector<HTMLTextAreaElement>('form[aria-label="Prompt agent"] textarea')!
  expect(newField.value).toBe('')
  await act(async () => { newField.value = 'New owner draft'; newField.dispatchEvent(new Event('input', { bubbles: true })) })
  await eventually(() => expect(later.querySelector<HTMLButtonElement>('[aria-label="Send prompt"]')?.disabled).toBe(false))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  await act(async () => { await Effect.runPromise(Deferred.fail(h.state.final!, new Error('retired read failed'))) })
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
  expect(h.snapshots).toHaveBeenCalledTimes(before)
  expect(later.querySelector<HTMLButtonElement>('[aria-label="Send prompt"]')?.disabled).toBe(false)
  expect(newField.value).toBe('New owner draft')
})
