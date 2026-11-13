import * as board from "../src/board.ts"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { Client, connect } from "@lgtm/client/browser"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { engineConnection, type LiveConnection } from "../src/connection.ts"
import { mapSnapshot } from "../src/mapping.ts"
import { engineSnapshot } from "./fixtures.ts"

globalThis.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
globalThis.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof IntersectionObserver
Element.prototype.scrollIntoView ??= function () {}
Element.prototype.scrollTo ??= function () {}
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 10)) }
interface Website {
  mount(element: Element, options: { connection: LiveConnection; mode: "live" }): { store: { state: Record<string, any> } }
  unmount(element: Element): void
}
let website: Website
let element: HTMLElement
beforeAll(async () => { website = await import("../../../design/mock/js/app.js" as string) as Website })
afterEach(() => { website.unmount(element); element.remove() })
async function mount(route: string, connection?: LiveConnection, records = mapSnapshot(engineSnapshot, 1)) {
  const calls: string[] = []
  const live: LiveConnection = connection ?? {
    kind: "engine", label: "test engine", board, async request(tag) { calls.push(tag); throw new Error("Test refusal") }, call(tag) { calls.push(tag) }, push() {},
    open(write) { write({ ...records, session: { status: "in", firstRun: false }, conn: { status: "reconnecting", lastHeard: 0 } }) },
    async signIn() { return "in" }, async signOut() {}, reconnect() { calls.push("reconnect") }, close() {}
  }
  element = document.createElement("div"); document.body.append(element)
  location.hash = "#" + route
  const { store } = website.mount(element, { mode: "live", connection: live })
  await settle()
  return { store, calls }
}
function button(text: string, root: ParentNode = document) {
  const found = [...root.querySelectorAll<HTMLElement>("button,[role=menuitem]")].find((b) => b.textContent?.trim().startsWith(text))
  expect(found, `control ${text}`).toBeDefined()
  return found!
}
function noticeOnly(state: Record<string, any>) {
  expect(state.toasts.map((t: { text: string }) => t.text)).toEqual(["This is not connected to the service yet. Nothing was changed."])
}

it("a refused defaults switch never displays Saved (finding 6)", async () => {
  const { store, calls } = await mount("/settings?section=defaults")
  store.state.ui.saved = Date.now()
  const before = JSON.stringify(store.state.settings)
  element.querySelector<HTMLElement>('[role="switch"]')!.click()
  await settle()
  expect(JSON.stringify(store.state.settings)).toBe(before)
  expect(store.state.ui.saved).toBeFalsy()
  expect(element.querySelector(".svc-saved")?.textContent).not.toContain("Saved")
  noticeOnly(store.state)
  expect(calls).toEqual([])
})

it("Reconnect now leaves success to the connection (finding 7)", async () => {
  const { store, calls } = await mount("/home")
  element.querySelector<HTMLElement>('[aria-label="Connection: Reconnecting"]')!.click()
  await settle()
  expect(element.textContent).toContain("The service has not answered yet.")
  button("Reconnect now").click(); await settle()
  expect(calls).toEqual(["reconnect"])
  expect(store.state.conn.status).toBe("reconnecting")
  expect(store.state.toasts).toEqual([])
})

for (const [section, control, delay, forbidden] of [
  ["about", "Check for an update", 1000, "Up to date"],
  ["workflow", "Check again", 700, "Checked at"],
] as const) it(`${control} refuses without simulated feedback (finding 7)`, async () => {
  const { store, calls } = await mount(`/settings?section=${section}`)
  button(control).click(); await new Promise((r) => setTimeout(r, delay)); await settle()
  noticeOnly(store.state)
  expect(element.textContent).not.toContain(forbidden)
  expect(calls).toEqual([])
})

it("restart refuses before scheduling a simulated restart (finding 7)", async () => {
  const { store, calls } = await mount("/settings?section=about")
  button("Restart").click(); await settle()
  const dialog = document.querySelector('[role="dialog"]')!
  button("Restart", dialog).click(); await new Promise((r) => setTimeout(r, 2500)); await settle()
  noticeOnly(store.state)
  expect(calls).toEqual([])
  expect(store.state.conn.status).toBe("reconnecting")
})

it("Scan harnesses again refuses instead of claiming a scan (finding 7)", async () => {
  const { store, calls } = await mount("/machines")
  element.querySelector<HTMLElement>('.svc-machines [aria-haspopup="menu"]')!.click(); await settle()
  button("Scan harnesses again").click(); await settle()
  noticeOnly(store.state)
  expect(calls).toEqual([])
})

for (const logout of [204, 403, "network"] as const) it(`the actual logout control clears collections and renders confirmation ${logout} (findings 1 and 8)`, async () => {
  const posts: string[] = []
  const client = { "client.snapshot": () => Effect.succeed(engineSnapshot), "project.settings": () => Effect.succeed({}), "client.subscribe": () => Stream.never } as unknown as Client
  const connection = engineConnection({
    location: { protocol: "http:", host: "127.0.0.1:8787" }, debug() {}, connect: (() => Effect.succeed(client)) as typeof connect,
    fetch: (async (path) => { posts.push(String(path)); if (path === "/api/logout" && logout === "network") throw new Error("network"); return { status: path === "/api/logout" ? logout : 204 } }) as typeof fetch
  })
  const { store } = await mount("/home", connection)
  await vi.waitFor(() => expect(element.querySelector('[aria-label="Log out"]')).not.toBeNull())
  expect(store.state.projects.length).toBeGreaterThan(0)
  element.querySelector<HTMLElement>('[aria-label="Log out"]')!.click(); await settle()
  expect(posts).toContain("/api/logout")
  for (const key of ["machines", "subscriptions", "repos", "projects", "teams", "agents", "requests", "worktrees", "sprints", "tasks"]) expect(store.state[key], key).toEqual([])
  expect(element.querySelector("#login-password")).not.toBeNull()
  expect(element.textContent).not.toContain("Harvest report")
  if (logout !== 204) expect(element.textContent).toContain("Session revocation was not confirmed")
})

for (const [route, label] of [["/machines", "Add machine"], ["/r/rp-orchard", "Add repository"]] as const) {
  it(`${label} does not start a simulated discovery (finding 7)`, async () => {
    const { store, calls } = await mount(route)
    if (label === "Add repository") {
      const actions = await import("../../../design/mock/js/actions.js" as string) as { openDialog(d: unknown): void }
      actions.openDialog({ type: "add-repository", machine: "local" })
      // Adding a repository is connected to the engine, so its dialog opens. It must still
      // wait for the owner, and never show the sample's invented remote.
      await new Promise((done) => setTimeout(done, 900))
      expect((store.state.dialog as { type?: string } | null)?.type).toBe("add-repository")
      expect(document.body.textContent).not.toContain("github.com/acme")
      expect(calls).toEqual([])
      return
    }
    button(label).click()
    await settle()
    noticeOnly(store.state)
    expect(store.state.dialog).toBeNull()
    expect(calls).toEqual([])
  })
}

it("Home renders retained requests when agent summaries are truncated (finding 2)", async () => {
  const records = mapSnapshot({ ...engineSnapshot, project: { ...engineSnapshot.project!, truncated: true, agents: [] } }, 1)
  await mount("/home", undefined, records)
  expect(element.textContent).toContain("Which branch should the release use?")
  expect(element.textContent).toContain("Team lead")
  expect(element.textContent).not.toMatch(/undefined|NaN/)
})

it("Nudge shows an engine refusal without inventing a board post (finding 7)", async () => {
  const { store, calls } = await mount("/p/pj-orchard/agents")
  element.querySelector<HTMLElement>('[aria-label="More for Worker one"]')!.click(); await settle()
  button("Nudge").click(); await settle()
  expect(store.state.toasts.map((t: { text: string }) => t.text)).toEqual(["Test refusal"])
  expect(store.state.posts).toEqual([])
  expect(calls).toEqual(["board.post"])
})

it("sign-in refuses before showing a simulated account flow (finding 7)", async () => {
  const { store, calls } = await mount("/subscriptions")
  const actions = await import("../../../design/mock/js/actions.js" as string) as { openDialog(d: unknown): void }
  actions.openDialog({ type: "signin", subscription: "acct-main" }); await settle()
  noticeOnly(store.state)
  expect(store.state.dialog).toBeNull()
  expect(calls).toEqual([])
})

it("a refused full run starts no delayed simulation (finding 7)", async () => {
  const { store, calls } = await mount("/p/pj-orchard/workflow/runs")
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  try {
    button("Start full run").click()
    await vi.advanceTimersByTimeAsync(3300)
    noticeOnly(store.state)
    expect(store.state.workflow["pj-orchard"].runs).toEqual([])
    expect(calls).toEqual([])
  } finally { vi.useRealTimers() }
})

it("shows a fast initial session response before passive effects run", async () => {
  const client = { "client.snapshot": () => Effect.succeed(engineSnapshot), "project.settings": () => Effect.succeed({}), "client.subscribe": () => Stream.never } as unknown as Client
  const connection = engineConnection({ location: { protocol: "http:", host: "127.0.0.1:8787" }, debug() {},
    connect: (() => Effect.succeed(client)) as typeof connect, fetch: async () => new Response(null, { status: 204 }) })
  const { store } = await mount("/home", connection)
  expect(store.state.session.status).toBe("in")
  expect(element.querySelector(".tree-row.project")).not.toBeNull()
  expect(element.querySelector(".tree-row.project")?.textContent).toContain("Harvest report")
})

it("answers an approval with Allow and Deny, and keeps a long standing answer in the Allow menu", async () => {
  const long = "Yes, and don't ask again for commands that start with `rm -- /tmp/a-very-long-path-that-does-not-exist`"
  const base = mapSnapshot(engineSnapshot, 1)
  const records = { ...base, requests: base.requests.map((r) => r.id !== "perm-1" ? r : { ...r, task: "tk-1", options: [
    { id: "once", label: "Yes, proceed", kind: "allow_once", primary: true },
    { id: "always", label: long, kind: "allow_always" },
    { id: "no", label: "No, and tell the agent what to do differently", kind: "reject_once" }] }) }
  const { calls } = await mount("/p/pj-orchard/task/tk-1", undefined, records)
  const card = element.querySelector<HTMLElement>("#req-perm-1 .qc-actions")
  expect(card, "the open approval card").not.toBeNull()
  // The harness's long wording is not a button on the card.
  expect([...card!.querySelectorAll("button")].map((b) => b.textContent?.trim())).toEqual(["Allow", "", "Deny", "Details", "Open thread"])
  button("Allow", card!).click()
  await settle()
  expect(calls).toContain("answer")
})
