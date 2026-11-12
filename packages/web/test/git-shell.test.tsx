import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { ClientSnapshot } from "@lgtm/contracts"
import { afterEach, expect, it, vi } from "vitest"
import { App } from "../src/app.tsx"
import * as gitState from "../src/git/state.ts"
import { snapshot } from "./project-fixtures.ts"

const browser = vi.hoisted(() => ({ client: {} as Record<string, unknown> }))
// Substitute only the transport boundary. App, authentication transitions,
// ShellDataProvider, watcher, Shell, GitPage and GitSession all mount normally.
vi.mock("@lgtm/client/browser", async () => {
  const Effect = await import("effect/Effect")
  return { connect: () => Effect.succeed(browser.client) }
})
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ root: Root; container: HTMLDivElement; active: boolean }> = []
const head = "a".repeat(40), nextHead = "b".repeat(40)
type Payload = { readonly requestId: string; readonly worktreeId: string; readonly message?: string }
const button = (container: HTMLElement, name: string) => {
  const result = [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === name || node.getAttribute("aria-label") === name)
  if (!result) throw new Error(`Missing button ${name}`)
  return result
}
const wait = async (check: () => void) => {
  for (let attempt = 0; ; attempt++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    try { check(); return } catch (error) { if (attempt >= 100) throw error }
  }
}
const click = async (node: HTMLElement) => { await act(async () => node.click()) }
const draft = async (container: HTMLElement, value: string) => {
  const field = container.querySelector<HTMLTextAreaElement>("#git-message")!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
const submit = async (container: HTMLElement) => {
  await wait(() => expect(container.querySelector<HTMLButtonElement>("#git-commit")?.disabled).toBe(false))
  await act(async () => container.querySelector("#git-commit-form")!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })))
}
const tab = (container: HTMLElement, name: string) => [...container.querySelectorAll<HTMLAnchorElement>('[role="tab"]')].find((node) => node.textContent === name)!

function environment() {
  const base = snapshot()
  const current = Schema.decodeUnknownSync(ClientSnapshot)({ ...base, project: { ...base.project,
    repositories: [...base.project!.repositories, { repoId: "foreign", name: "Other repository", path: "/other" }],
    workspaces: [
      { worktreeId: "w", repoId: "r", machineId: "local", branch: "feature", path: "/work/repo/.worktrees/feature", checkout: "worktree", projectId: "p" },
      { worktreeId: "main", repoId: "r", machineId: "local", branch: "main", path: "/work/repo", checkout: "main" },
      { worktreeId: "team", repoId: "r", machineId: "local", branch: "team-feature", path: "/work/repo/.worktrees/team", checkout: "worktree", parentId: "w", projectId: "p", teamId: "t" },
      { worktreeId: "foreign", repoId: "foreign", machineId: "local", branch: "private", path: "/other", checkout: "main" }
    ], teams: base.project!.teams.map((row) => ({ ...row, worktreeId: "team" }))
  } })
  let currentHead = head, failState = false, sessionStatus = 204
  let logout = async () => new Response(null, { status: 204 })
  const ordinaryDiff = (payload: Payload) => Effect.succeed({ requestId: payload.requestId, result: { patch: "", additions: 0, deletions: 0, binary: false, truncated: false } })
  let diff: (payload: Payload) => Effect.Effect<unknown, unknown> = ordinaryDiff
  const fetch = vi.fn(async (url: string) => url === "/api/logout" ? logout() : new Response(null, { status: url === "/api/session" ? sessionStatus : 204 }))
  vi.stubGlobal("fetch", fetch)
  const changes = (payload: Payload) => Effect.succeed({ requestId: payload.requestId, result: { truncated: false, items: [{ path: `${payload.worktreeId}.txt`, originalPath: null, index: "A", worktree: " ", staged: true, unstaged: false, conflict: false, untracked: false }] } })
  const commit = vi.fn((payload: Payload): Effect.Effect<unknown, unknown> => Effect.succeed({ requestId: payload.requestId, result: { head: currentHead } }))
  const subscribe = vi.fn(() => Stream.never)
  browser.client = {
    "client.snapshot": () => Effect.succeed(current), "client.subscribe": subscribe,
    "client.requests": () => Effect.succeed({ sequence: current.sequence, items: [] }),
    "client.alerts.list": () => Effect.succeed({ items: [] }), "client.sequence": () => Effect.succeed({ sequence: current.sequence }),
    "project.git.state": (payload: Payload) => failState ? Effect.fail({ _tag: "CommandError", reason: "command refused" }) : Effect.succeed({ requestId: payload.requestId, result: { head: currentHead, branch: current.project!.workspaces.find((row) => row.worktreeId === payload.worktreeId)!.branch, upstream: null, mergeHead: null, ahead: 0, behind: 0, pending: 0, pendingSince: null } }),
    "project.changes": changes, "project.history": (payload: Payload) => Effect.succeed({ requestId: payload.requestId, result: { items: [], truncated: false } }),
    "project.review.status": (payload: Payload) => Effect.succeed({ requestId: payload.requestId, result: { review: null, evidence: { tests: { state: "missing" }, review: { state: "missing" } } } }),
    "project.diff": (payload: Payload) => diff(payload),
    "project.commit": commit
  }
  return { current, commit, subscribe, fetch, expire: () => { failState = true; sessionStatus = 401 }, accept: () => { currentHead = nextHead }, recover: () => { failState = false; sessionStatus = 204 }, failReads: () => { failState = true }, holdLogout: (pending: Promise<Response>) => { logout = () => pending }, readDiff: (read: typeof diff) => { diff = read }, ordinaryDiff }
}

async function mount() {
  history.replaceState(null, "", "/#/project/p/team/t/git")
  const item = { root: undefined as unknown as Root, container: document.createElement("div"), active: true }
  document.body.append(item.container); item.root = createRoot(item.container); mounted.push(item)
  await act(async () => item.root.render(<App />))
  await wait(() => expect(button(item.container, "Fetch").disabled).toBe(false))
  return item
}
const unmount = async (item: typeof mounted[number]) => {
  if (item.active) { await act(async () => item.root.unmount()); item.active = false }
}
const login = async (container: HTMLElement) => {
  await wait(() => expect(container.querySelector('form[aria-label="Log in"]')).not.toBeNull())
  await act(async () => {
    container.querySelector<HTMLInputElement>('input[type="password"]')!.value = "synthetic password"
    container.querySelector('form[aria-label="Log in"]')!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
  })
  await wait(() => expect(button(container, "Fetch").disabled).toBe(false))
}
afterEach(async () => {
  for (const item of mounted.splice(0)) { await unmount(item); item.container.remove() }
  history.replaceState(null, "", "/"); localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals()
})

it("Git Shell: mounts assigned and inspected identities, preserves drafts across tabs and obeys shared offline authority", async () => {
  const env = environment(), factory = vi.spyOn(gitState, "createGitSession")
  const { container } = await mount()
  await draft(container, "team private draft")
  const read: { signal?: AbortSignal } = {}
  let finishRead!: (value: unknown) => void
  const pendingRead = new Promise<unknown>((resolve) => { finishRead = resolve })
  env.readDiff(() => Effect.tryPromise((signal) => { read.signal = signal; return pendingRead }))
  await click(button(container, "All files"))
  await wait(() => expect(read.signal).toBeDefined())
  await click(tab(container, "Terminal")); expect(container.querySelector("#git-message")).toBeNull()
  expect(read.signal?.aborted).toBe(true)
  env.readDiff(env.ordinaryDiff)
  await act(async () => finishRead({ result: { patch: "late private read", additions: 0, deletions: 0, binary: false, truncated: false } }))
  await click(tab(container, "Git"))
  await wait(() => expect(container.querySelector<HTMLTextAreaElement>("#git-message")?.value).toBe("team private draft"))
  await click(container.querySelector<HTMLElement>('[data-git-worktree="main"]')!)
  await wait(() => expect(container.querySelector(".git-inspecting")?.textContent).toContain("Assigned: team-feature"))
  expect(location.hash).toBe("#/project/p/team/t/git?workspace=main")
  expect(container.querySelector('[data-git-worktree="team"]')?.textContent).toContain("Assigned")
  expect(container.querySelector('[data-git-worktree="foreign"]')).toBeNull()
  expect(container.querySelector<HTMLTextAreaElement>("#git-message")?.value).toBe("")
  await draft(container, "main private draft")
  await click(container.querySelector<HTMLElement>('[data-git-worktree="team"]')!)
  await wait(() => expect(container.querySelector<HTMLTextAreaElement>("#git-message")?.value).toBe("team private draft"))
  await wait(() => expect(button(container, "Fetch").disabled).toBe(false))
  await act(async () => window.dispatchEvent(new Event("offline")))
  expect(button(container, "Fetch").disabled).toBe(true)
  expect(container.querySelector<HTMLTextAreaElement>("#git-message")?.value).toBe("team private draft")
  await act(async () => window.dispatchEvent(new Event("online")))
  await wait(() => expect(button(container, "Fetch").disabled).toBe(false))
  expect(factory).toHaveBeenCalledOnce()
  expect(env.commit).not.toHaveBeenCalled()
})

it("Git Shell: retains a typed lost reply across tab unmount, refreshes to uncertainty and sends only a fresh explicit choice", async () => {
  const env = environment(), factory = vi.spyOn(gitState, "createGitSession")
  env.commit.mockImplementationOnce(() => { env.failReads(); return Effect.fail({ _tag: "CommandError", reason: "database read failed" }) })
    .mockImplementation((payload) => Effect.sync(() => { env.accept(); return { requestId: payload.requestId, result: { head: nextHead } } }))
  const { container } = await mount()
  await draft(container, "frozen original draft"); await submit(container)
  await wait(() => expect(container.textContent).toContain("Outcome unconfirmed."))
  const original = env.commit.mock.calls[0]![0]
  expect(original).toMatchObject({ worktreeId: "team", message: "frozen original draft" })
  await draft(container, "new unsent draft")
  await click(tab(container, "Terminal")); await click(tab(container, "Git"))
  await wait(() => expect(container.textContent).toContain("Outcome unconfirmed."))
  expect(container.querySelector<HTMLTextAreaElement>("#git-message")?.value).toBe("new unsent draft")
  expect(env.commit).toHaveBeenCalledOnce()
  env.recover(); await click(button(container, "Refresh Git"))
  await wait(() => expect(container.textContent).toContain("does not establish"))
  expect(container.querySelector("#git-notice")).toBeNull()
  expect(container.querySelector<HTMLTextAreaElement>("#git-message")?.value).toBe("new unsent draft")
  await submit(container)
  await wait(() => expect(container.querySelector("#git-notice")?.textContent).toContain(nextHead))
  expect(env.commit).toHaveBeenCalledTimes(2)
  expect(env.commit.mock.calls[1]![0].requestId).not.toBe(original.requestId)
  expect(env.commit.mock.calls[1]![0].message).toBe("new unsent draft")
  expect(factory).toHaveBeenCalledOnce()
})

for (const boundary of ["confirmed logout", "typed expiry", "Shell cleanup"] as const) {
  it(`Git Shell: clears protected state and interrupts pending work on ${boundary}`, async () => {
    const env = environment(), factory = vi.spyOn(gitState, "createGitSession")
    let complete!: (value: unknown) => void
    const active: { signal?: AbortSignal } = {}
    const pending = new Promise<unknown>((resolve) => { complete = resolve })
    env.commit.mockImplementation(() => Effect.tryPromise((signal) => { active.signal = signal; return pending }))
    const item = await mount(), { container } = item
    await draft(container, "protected owner draft"); await submit(container)
    await wait(() => expect(env.commit).toHaveBeenCalledOnce())
    const session = factory.mock.results[0]!.value as gitState.GitSession
    const key = gitState.workspaceKey(env.current.project!.repositories[0]!.repoId, "local", env.current.project!.teams[0]!.worktreeId)
    expect(active.signal?.aborted).toBe(false)
    if (boundary === "confirmed logout") {
      let confirm!: (response: Response) => void
      env.holdLogout(new Promise((resolve) => { confirm = resolve }))
      await click(button(container, "Log out"))
      expect(active.signal?.aborted).toBe(false)
      expect(session.get(key).message).toBe("protected owner draft")
      await act(async () => confirm(new Response(null, { status: 204 })))
      await wait(() => expect(container.querySelector('form[aria-label="Log in"]')).not.toBeNull())
    } else if (boundary === "typed expiry") {
      env.expire(); await click(button(container, "Refresh Git"))
      await wait(() => expect(container.querySelector('form[aria-label="Log in"]')).not.toBeNull())
      expect(env.fetch).toHaveBeenCalledWith("/api/session", expect.objectContaining({ method: "POST", cache: "no-store" }))
    } else await unmount(item)
    expect(active.signal?.aborted).toBe(true)
    expect(session.attempt).toBeUndefined()
    expect(session.get(key).message).toBe("")
    env.recover()
    let fresh = container
    if (boundary === "Shell cleanup") fresh = (await mount()).container
    else await login(container)
    await act(async () => complete({ result: { head: nextHead } }))
    expect(factory).toHaveBeenCalledTimes(2)
    expect(fresh.querySelector("#git-notice")).toBeNull()
    expect(fresh.querySelector<HTMLTextAreaElement>("#git-message")?.value).toBe("")
    expect(fresh.textContent).not.toContain("protected owner draft")
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain("protected owner draft")
    expect(sessionStorage.length).toBe(0)
  })
}
