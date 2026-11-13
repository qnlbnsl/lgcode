// Mounts the website from design/mock in live mode, on the engine records in fixtures.ts,
// and checks that no sample record from seed() reaches the store or any screen.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mapSnapshot } from "../src/mapping.ts"
import type { LiveConnection, StorePatch, Write } from "../src/connection.ts"
import { engineSnapshot } from "./fixtures.ts"

// jsdom lacks these browser features, which the website reads.
globalThis.matchMedia ??= ((query: string) => ({
  matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {},
  addListener() {}, removeListener() {}, dispatchEvent: () => false
})) as unknown as typeof matchMedia
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
globalThis.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } } as unknown as typeof IntersectionObserver
Element.prototype.scrollIntoView ??= function () {}
Element.prototype.scrollTo ??= function () {}

interface Store { state: Record<string, unknown> }
interface Website {
  mount(element: Element, options: { connection: LiveConnection; mode: "live" }): { store: Store }
  unmount(element: Element): void
}
interface Sample { seed(): Record<string, unknown> }

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const settle = async () => { for (let i = 0; i < 4; i++) await tick() }

// A connection that answers like a signed-in engine, from the fixture, with no network.
function fakeConnection() {
  let write: Write = () => {}
  const calls: string[] = []
  const connection: LiveConnection = {
    kind: "engine", label: "the test engine",
    call(tag) { calls.push(tag) }, push() {},
    open(next) { write = next; write({ session: { status: "in", firstRun: false }, conn: { status: "live", lastHeard: 1 }, owner: { name: "Test Owner", initials: "TO" }, ...mapSnapshot(engineSnapshot, Date.now()) }) },
    async signIn() { return "in" }, async signOut() { write({ session: { status: "out", firstRun: false } }) },
    reconnect() {}, close() {}
  }
  return { connection, calls, write: (patch: StorePatch) => write(patch) }
}

// Every identifier and name in seed(), the website's sample.
function sampleIdentifiers(sample: Record<string, unknown>): Set<string> {
  const found = new Set<string>()
  for (const value of Object.values(sample)) {
    if (!Array.isArray(value)) continue
    for (const row of value) {
      if (typeof row !== "object" || row === null) continue
      const record = row as Record<string, unknown>
      if (typeof record["id"] === "string") found.add(record["id"])
    }
  }
  for (const key of ["repos", "projects", "machines"] as const) for (const row of sample[key] as Array<{ name: string }>) found.add(row.name)
  found.add((sample["owner"] as { name: string }).name)
  for (const id of Object.keys(sample["threads"] as object)) found.add(id)
  return found
}

// Every string in the store, as values and as keys of maps.
function strings(value: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (typeof value === "string") out.push(value)
  else if (typeof value === "object" && value !== null && !seen.has(value)) {
    seen.add(value)
    for (const [key, child] of Object.entries(value)) { if (!Array.isArray(value)) out.push(key); strings(child, out, seen) }
  }
  return out
}

// Words from the sample that no live screen may show. They come from seed() and from the
// sample records the screens keep for Git, Files, the terminal, Workflow and Mocks.
function sampleWords(sample: Record<string, unknown>): string[] {
  const words = ["Maya Okafor", "Workstation", "Buildbox", "lgtm-studio", "atlas-docs", "billing-api", "feat/agent-console",
    "Merge pull request #34", "packages/web/src/shell", "reconnect.test.ts", "First screen", "Filter chips", "owner@example.com", "0.9.0", "55e1bbd"]
  for (const key of ["projects", "sprints"] as const) for (const row of sample[key] as Array<{ name: string }>) words.push(row.name)
  for (const row of sample["requests"] as Array<{ title: string }>) words.push(row.title)
  for (const row of sample["tasks"] as Array<{ title: string }>) words.push(row.title)
  return words
}

describe("the live website", () => {
  const element = document.createElement("div")
  let website: Website
  let store: Store
  let fake: ReturnType<typeof fakeConnection>
  let sample: Record<string, unknown>
  const errors: unknown[] = []
  const originalError = console.error

  beforeAll(async () => {
    console.error = (...args: unknown[]) => { errors.push(args); }
    // A screen that throws while drawing surfaces as an unhandled rejection or error.
    process.on("unhandledRejection", (reason) => { errors.push(reason) })
    addEventListener("error", (event) => { errors.push(event.error) })
    document.body.append(element)
    location.hash = "#/home"
    // seed() is read only to learn what the sample is. It never reaches the live store.
    sample = (await import("../../../design/mock/js/data.js" as string) as Sample).seed()
    website = await import("../../../design/mock/js/app.js" as string) as Website
    fake = fakeConnection()
    store = website.mount(element, { connection: fake.connection, mode: "live" }).store
    await settle()
  })
  afterAll(() => { website.unmount(element); element.remove(); console.error = originalError })

  it("fills the store from the engine's records", () => {
    expect((store.state["repos"] as Array<{ id: string }>).map((r) => r.id)).toEqual(["rp-orchard"])
    expect((store.state["projects"] as Array<{ id: string }>).map((p) => p.id)).toEqual(["pj-orchard", "pj-orphan"])
    expect((store.state["owner"] as { name: string }).name).toBe("Test Owner")
    expect((store.state["conn"] as { status: string }).status).toBe("live")
  })

  it("keeps every identifier from seed() out of the live store", () => {
    const ids = sampleIdentifiers(sample)
    expect(ids.size).toBeGreaterThan(100)
    const leaked = strings(store.state).filter((value) => ids.has(value))
    expect(leaked).toEqual([])
  })

  it("shows the engine's repositories, projects and agents in the sidebar", async () => {
    location.hash = "#/p/pj-orchard/board"
    await settle()
    const sidebar = element.querySelector(".sidebar")!.textContent!
    expect(sidebar).toContain("orchard")
    expect(sidebar).toContain("Harvest report")
    expect(sidebar).toContain("Test Owner")
    expect(element.querySelector('[aria-label="Mock controls"]')).toBeNull()
  })

  const routes = [
    "/home", "/projects", "/machines", "/subscriptions", "/notifications", "/settings", "/setup",
    "/r/rp-orchard", "/r/rp-orchard/design",
    ...["board", "board/table", "board/roadmap", "workflow", "workflow/review", "workflow/runs", "workflow/result", "workflow/settings",
      "mocks", "chat", "chat/ag-worker", "messages", "agents", "terminal", "files", "git", "settings", "team/tm-alpha", "sprint/sp-a", "task/tk-1"]
      .map((tab) => `/p/pj-orchard/${tab}`),
    "/p/pj-orphan/board", "/p/pj-orphan/chat"
  ]
  for (const route of routes) {
    it(`draws ${route} with no sample and no error`, async () => {
      errors.length = 0
      location.hash = "#" + route
      await settle()
      const text = element.textContent ?? ""
      expect(text.length).toBeGreaterThan(0)
      for (const word of sampleWords(sample)) expect(text, `${route} shows the sample "${word}"`).not.toContain(word)
      expect(text).not.toMatch(/\bundefined\b|\bNaN\b/)
      expect(errors).toEqual([])
    })
  }

  it("opens a machine's details with no sample and no error", async () => {
    errors.length = 0
    location.hash = "#/machines"
    await settle()
    element.querySelector<HTMLElement>("tr.click")!.click()
    await settle()
    const text = element.textContent ?? ""
    expect(element.querySelector(".svc-detail")).not.toBeNull()
    for (const word of sampleWords(sample)) expect(text).not.toContain(word)
    expect(text).not.toMatch(/\bundefined\b|\bNaN\b/)
    expect(errors).toEqual([])
  })

  it("refuses a change to an engine record, says so, and leaves the store alone", async () => {
    location.hash = "#/home"
    await settle()
    const before = JSON.stringify(store.state["requests"])
    const actions = await import("../../../design/mock/js/actions.js" as string) as {
      answerRequest(id: string, option: string): void; archiveProject(id: string): void; sendMessage(agent: string, text: string): void
    }
    actions.answerRequest("perm-1", "allow")
    actions.archiveProject("pj-orchard")
    actions.sendMessage("ag-lead", "hello")
    await settle()
    expect(JSON.stringify(store.state["requests"])).toBe(before)
    expect((store.state["projects"] as Array<{ archived: boolean }>)[0]!.archived).toBe(false)
    expect((store.state["threads"] as Record<string, unknown[]>)["ag-lead"] ?? []).toEqual([])
    expect(fake.calls).toEqual([])
    expect(element.querySelector(".toasts")!.textContent).toContain("not connected to the service yet")
  })

  it("refuses a screen's own write to a record, and keeps the rest of that turn from changing", async () => {
    const lib = await import("../../../design/mock/js/lib.js" as string) as { update(fn: (s: Record<string, unknown>) => void): void }
    await new Promise((resolve) => setTimeout(resolve, 5))
    lib.update((s) => { (s["projects"] as Array<{ name: string }>)[0]!.name = "Changed" })
    lib.update((s) => { (s["ui"] as Record<string, unknown>)["saved"] = 1 })
    expect((store.state["projects"] as Array<{ name: string }>)[0]!.name).toBe("Harvest report")
    expect((store.state["ui"] as Record<string, unknown>)["saved"]).toBeUndefined()
    expect(() => { (store.state as Record<string, unknown>)["repos"] = [] }).toThrow()
  })

  it("renders the Login page when the connection supplies an ended session", async () => {
    fake.write({ session: { status: "out", firstRun: false }, repos: [], projects: [], agents: [] })
    location.hash = "#/home"
    await settle()
    expect(element.querySelector("#login-password")).not.toBeNull()
    expect(element.textContent).not.toContain("Harvest report")
  })
})
