import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { Client } from "@lgtm/client/browser"
import * as Effect from "effect/Effect"
import { afterEach, expect, it, vi } from "vitest"
import { NewProjectSession } from "../src/project/creation.ts"
import { NewProjectDialog } from "../src/project/newProject.tsx"
import type { withClient } from "../src/thread/client.ts"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ root: Root; host: HTMLDivElement; session: NewProjectSession }> = []
const discovery = { state: "available", repositories: [], truncated: false, harnesses: [],
  readyDefaults: { harness: "cursor", account: { _tag: "named", accountId: "primary" }, permission: "ask", model: "actual-model", effort: "high" } }
const placement = (name = "project") => ({ repositoryPath: "/work", path: `/work/.worktrees/${name}`, branch: name, checkout: "worktree", reserved: false })
const clientFor = (overrides: Record<string, unknown> = {}) => ({
  "client.sequence": () => Effect.succeed({ sequence: 1 }),
  "project.settings": () => Effect.succeed({ settings: { workspaceFolder: "/work", shell: "zsh" } }),
  "project.setup.discover": () => Effect.succeed({ result: discovery }),
  "project.repositories": () => Effect.succeed({ items: [{ repoId: "repo", name: "Repository <literal>", path: "/work" }] }),
  "project.creations": () => Effect.succeed({ items: [] }),
  "project.placement.preview": () => Effect.succeed({ result: placement() }),
  ...overrides
}) as unknown as Client
const runFor = (client: Client): typeof withClient => (action, signal) => Effect.runPromise(action(client), { signal })
const eventually = async (body: () => void) => {
  for (let count = 0; ; count++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
    try { body(); return } catch (error) { if (count === 200) throw error }
  }
}
const mount = async (session: NewProjectSession, options: { presentation?: "dialog" | "setup"; onCreated?: () => void } = {}) => {
  const host = document.createElement("div"); document.body.append(host)
  const root = createRoot(host); mounted.push({ root, host, session })
  await act(async () => { root.render(<NewProjectDialog creation={session} onAddRepository={() => {}} onSettings={() => {}}
    onCreated={options.onCreated ?? (() => {})} presentation={options.presentation ?? "setup"} />) })
  return host
}
afterEach(async () => {
  for (const { root, host, session } of mounted.splice(0)) { await act(async () => { root.unmount(); session.dispose() }); host.remove() }
  vi.unstubAllGlobals(); vi.restoreAllMocks()
})

it("renders actual settings and Branch/Folder preview as literal text with Run on before Project name and no worktree choice", async () => {
  const session = new NewProjectSession(() => {}, runFor(clientFor()))
  await session.refresh()
  const host = await mount(session)
  expect([...host.querySelectorAll("label")].map((row) => row.textContent)).toEqual(["Repository", "Run on", "Project name"])
  expect(host.textContent).toContain("Repository <literal>")
  expect(host.querySelector("literal")).toBeNull()
  expect(host.textContent).toContain("actual-model · high")
  expect([...host.querySelectorAll("dt")].map((row) => row.textContent)).toEqual(["Branch", "Folder"])
  expect(host.textContent).toContain("This preview reserves nothing")
  expect(host.querySelector('input[type="checkbox"]')).toBeNull()
  expect(host.querySelector('input[id$="-goal"]')).toBeNull()
  expect(host.querySelector('textarea[id$="-goal"]')).toBeNull()
  expect(session.getSnapshot().draft).not.toHaveProperty("useWorktree")
  expect(host.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(false)
  expect(localStorage.length + sessionStorage.length).toBe(0)
})

it("ignores an obsolete preview and disposes typed text and every late response at the owner session boundary", async () => {
  let release!: (value: unknown) => void
  let count = 0
  const api = clientFor({ "project.placement.preview": () => ++count === 2
    ? Effect.promise(() => new Promise((resolve) => { release = resolve }))
    : Effect.succeed({ result: placement(count === 1 ? "initial" : "latest") }) })
  const session = new NewProjectSession(() => {}, runFor(api))
  await session.refresh(); const host = await mount(session)
  await act(async () => { session.update({ name: "Old draft", goal: "Protected goal" }) })
  await eventually(() => expect(release).toBeTypeOf("function"))
  await act(async () => { session.update({ name: "New draft" }) })
  await eventually(() => expect(session.getSnapshot().preview?.branch).toBe("latest"))
  await act(async () => { release({ result: placement("obsolete") }) })
  expect(session.getSnapshot().preview?.branch).toBe("latest")
  await act(async () => { session.dispose() })
  expect(session.getSnapshot().draft).toMatchObject({ name: "", goal: "" })
  expect(session.getSnapshot().attempt).toBeUndefined()
  expect(host.textContent).not.toContain("Protected goal")
  const nextLogin = new NewProjectSession(() => {}, runFor(clientFor()))
  await nextLogin.refresh()
  expect(nextLogin.getSnapshot().draft.goal).toBe("")
  expect(nextLogin.getSnapshot().draft.name).not.toBe("New draft")
  nextLogin.dispose()
})

it("locks a double submit synchronously, allows route departure, and ignores creation completion after logout", async () => {
  let release!: (value: unknown) => void
  const create = vi.fn(() => Effect.promise(() => new Promise((resolve) => { release = resolve })))
  const api = clientFor({ "project.create": create, "project.read": () => Effect.succeed({ items: [{ projectId: "created", name: "Project", goal: "Private", repoId: "repo", leadAgentId: "lead", worktreeId: "workspace", machineId: "local" }] }) })
  const session = new NewProjectSession(() => {}, runFor(api)), onCreated = vi.fn()
  await session.refresh(); const host = await mount(session, { onCreated })
  await act(async () => {
    const form = host.querySelector("form")!
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
  })
  await eventually(() => expect(create).toHaveBeenCalledTimes(1))
  const frozen = session.getSnapshot().attempt!
  expect(frozen.useWorktree).toBe(true)
  await act(async () => { session.addRepository(); session.update({ goal: "Changed" }); session.returnFromMachines() })
  expect(session.getSnapshot().attempt).toBe(frozen)
  await act(async () => { session.dispose(); release({ requestId: frozen.requestId, projectId: "created" }) })
  expect(session.getSnapshot().attempt).toBeUndefined()
  expect(session.getSnapshot().project).toBeUndefined()
  expect(onCreated).not.toHaveBeenCalled()
})

it("clears the draft when the real session probe reports expiry during a failed placement read", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })))
  const expired = vi.fn()
  const api = clientFor({ "project.placement.preview": () => Effect.fail({ _tag: "CommandError", reason: "invalid credential" }) })
  const session = new NewProjectSession(expired, runFor(api))
  session.update({ name: "Private draft", goal: "Secret task prose" })
  await session.refresh()
  expect(expired).toHaveBeenCalledTimes(1)
  expect(session.getSnapshot().draft.name).toBe("")
  expect(session.getSnapshot().draft.goal).toBe("")
  expect(session.getSnapshot().repositories).toEqual([])
})

it("shows an unavailable selected machine and actual missing repository remedy without enabling Create", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  const session = new NewProjectSession(() => {}, runFor(clientFor({
    "project.placement.preview": (payload: { machineId: string }) => Effect.fail({ _tag: "CommandError",
      reason: payload.machineId === "local" ? "repository location not found" : "only the confirmed local machine can start a project" })
  })))
  await session.refresh()
  const host = await mount(session)
  expect(host.textContent).toContain("This computer does not have Repository <literal>.")
  await act(async () => { session.update({ machineId: "offline-machine" }) })
  await eventually(() => expect(session.getSnapshot().previewState).toBe("unavailable"))
  expect(host.textContent).toContain("offline-machine · Unavailable")
  expect(host.textContent).toContain("only the confirmed local machine can start a project")
  expect(host.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(true)
  expect([...host.querySelectorAll("button")].some((row) => row.textContent === "Add repository")).toBe(true)
  expect(session.getSnapshot().draft.machineId).toBe("offline-machine")
})

it("keeps a generic CommandError uncertain even when no pending intent is visible", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  const session = new NewProjectSession(() => {}, runFor(clientFor({
    "project.create": () => Effect.fail({ _tag: "CommandError", reason: "database write failed" })
  })))
  await session.refresh(); await session.start()
  const frozen = session.getSnapshot().attempt
  expect(frozen).toBeDefined()
  expect(session.getSnapshot().pending).toEqual([])
  expect(session.getSnapshot().phase).toBe("uncertain")
  session.correctRefusal(); session.update({ goal: "Different body" })
  expect(session.getSnapshot().attempt).toBe(frozen)
  expect(session.getSnapshot().draft.goal).toBe("")
  session.dispose()
})

it("a failed later repository page preserves stale facts and cannot prove the repository collection empty", async () => {
  const repositories = vi.fn<() => Effect.Effect<unknown, unknown>>(() => Effect.succeed({ items: [{ repoId: "repo", name: "Actual previous repository", path: "/work" }] }))
  const session = new NewProjectSession(() => {}, runFor(clientFor({ "project.repositories": repositories })))
  await session.refresh()
  repositories.mockImplementationOnce(() => Effect.succeed({ items: [{ repoId: "partial", name: "Partial page", path: "/partial" }], next: "later" }))
    .mockImplementationOnce(() => Effect.fail(new Error("Later page unavailable")))
  await session.refresh()
  expect(session.getSnapshot().loaded).toBe(false)
  expect(session.getSnapshot().repositories.map((row) => row.name)).toEqual(["Actual previous repository"])
  await session.start(); expect(session.getSnapshot().attempt).toBeUndefined()
  session.dispose()
})

it("the modal closes on Escape and restores focus to its original trigger", async () => {
  // jsdom has no modal implementation. This checks our cancel/focus handlers;
  // native focus trapping and inertness belong to the held real-browser case.
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", "") } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open") } }
  })
  const trigger = document.createElement("button"); trigger.textContent = "New project"; document.body.append(trigger); trigger.focus()
  try {
    const session = new NewProjectSession(() => {}, runFor(clientFor()))
    session.open()
    const host = await mount(session, { presentation: "dialog" })
    expect(host.querySelector("dialog")?.open).toBe(true)
    await act(async () => { host.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })) })
    expect(host.querySelector("dialog")?.open).toBe(false)
    expect(document.activeElement).toBe(trigger)
  } finally {
    trigger.remove(); Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal"); Reflect.deleteProperty(HTMLDialogElement.prototype, "close")
  }
})

it("wraps modal Tab at the current visible enabled endpoints while leaving interior and modified Tab native", async () => {
  // jsdom has no layout or native dialog behavior. Supply rectangles only for
  // this mounted form; the browser case proves the actual keyboard journey.
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", "") } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open") } }
  })
  try {
    const session = new NewProjectSession(() => {}, runFor(clientFor()))
    await act(async () => { session.open() })
    const host = await mount(session, { presentation: "dialog" })
    const dialog = host.querySelector("dialog")!
    const close = dialog.querySelector<HTMLButtonElement>('[aria-label="Close project setup"]')!
    const submit = dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!
    const refresh = [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Refresh")!
    const cancel = [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!
    const goal = dialog.querySelector<HTMLInputElement>('input[id$="-goal"]')!
    await eventually(() => expect(submit.disabled).toBe(false))
    for (const element of dialog.querySelectorAll<HTMLElement>("button,input,select")) {
      vi.spyOn(element, "getClientRects").mockImplementation(() => (element.hidden || element.style.display === "none" ? [] : [{}]) as unknown as DOMRectList)
    }
    const tab = async (element: HTMLElement, shiftKey = false, ctrlKey = false) => {
      element.focus()
      const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true, shiftKey, ctrlKey })
      await act(async () => { element.dispatchEvent(event) })
      return event
    }
    expect((await tab(close, true)).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(submit)
    expect((await tab(submit)).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close)
    expect((await tab(goal)).defaultPrevented).toBe(false)
    expect((await tab(close, true, true)).defaultPrevented).toBe(false)

    submit.disabled = true
    expect((await tab(close, true)).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(refresh)
    expect((await tab(refresh)).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close)
    refresh.hidden = true
    expect((await tab(close, true)).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(cancel)
    expect((await tab(cancel)).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close)
  } finally {
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal"); Reflect.deleteProperty(HTMLDialogElement.prototype, "close")
  }
})
