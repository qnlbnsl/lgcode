// @vitest-environment node
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { act } from "react"
import * as Effect from "effect/Effect"
import * as Cause from "effect/Cause"
import * as Stream from "effect/Stream"
import * as Redacted from "effect/Redacted"
import { afterEach, expect, it, vi } from "vitest"
import { completedSetup } from "../e2e/support/completedSetup.ts"
import { CommandHandler } from "../../engine/src/commands/CommandHandler.ts"
import { makeFakeRunner, type FakeRunner } from "../../engine/test/support/fakeRunner.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"
import { call, freshRequest, harnessSettings, makeFakeSecrets, makeRig, ownerCredential as owner, provideRig,
  removeRig, success, type Rig } from "../../engine/test/support/handlerRig.ts"

const transport = vi.hoisted(() => ({ client: undefined as unknown }))
const closeWindows: Array<() => void> = []
vi.mock("@lgtm/client/browser", async () => {
  const Effect = await import("effect/Effect")
  return { connect: () => Effect.succeed(transport.client) }
})
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
type Execute = (name: string, payload: Record<string, unknown>) => Effect.Effect<Record<string, unknown>, unknown>
interface Journey {
  readonly rig: Rig
  readonly runner: FakeRunner
  readonly container: HTMLDivElement
  readonly execute: Execute
}
const eventually = async (check: () => void) => {
  for (let count = 0; ; count++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    try { check(); return } catch (error) { if (count > 200) throw error }
  }
}
const button = (root: ParentNode, name: string) => {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find((row) => row.textContent?.trim() === name)
  expect(found, name).toBeDefined()
  return found!
}
const click = async (root: ParentNode, name: string) => { await act(async () => button(root, name).click()) }
const field = (root: ParentNode, label: string) => {
  const node = [...root.querySelectorAll<HTMLLabelElement>("label")].find((row) => row.textContent?.trim() === label)
  expect(node, label).toBeDefined()
  const target = node!.htmlFor ? document.getElementById(node!.htmlFor) : node!.querySelector("input,textarea")
  expect(target, label).not.toBeNull()
  return target as HTMLInputElement | HTMLTextAreaElement
}
const fill = async (root: ParentNode, label: string, value: string) => {
  await act(async () => {
    const control = field(root, label), prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(control, value)
    control.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
const submit = async (control: HTMLElement) => {
  await act(async () => control.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
}
const mountedJourney = async (body: (journey: Journey) => Promise<void>, wrap?: (execute: Execute) => Execute) => {
  // Engine import.meta URLs must remain Node file URLs. Vitest's browser
  // environment transforms its installed adapter directory into an HTTP asset
  // URL. Create the real DOM here, then import React DOM and the production App.
  const { JSDOM } = createRequire(import.meta.url)("jsdom")
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1/", pretendToBeVisual: true })
  for (const name of ["window", "document", "navigator", "history", "location", "HTMLElement", "Element", "Node", "HTMLDialogElement",
    "HTMLInputElement", "HTMLTextAreaElement", "Event", "PopStateEvent", "MouseEvent", "KeyboardEvent", "getComputedStyle", "localStorage", "sessionStorage"]) vi.stubGlobal(name, dom.window[name])
  closeWindows.push(() => dom.window.close())
  const { createRoot } = await import("react-dom/client"), { App } = await import("../src/app.tsx")
  const rig = makeRig(), container = document.createElement("div")
  vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder)
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  history.replaceState({}, "", "/#/?view=projects")
  // This only supplies jsdom's absent modal methods. Native focus containment,
  // inertness, cookies and actual WebSockets remain browser proof, held here.
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function(this: HTMLDialogElement) { this.open = true } },
    close: { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")) } }
  })
  document.body.append(container)
  const root = createRoot(container)
  try {
    execFileSync("git", ["-C", rig.work, "init", "-b", "main"], { stdio: "ignore" })
    execFileSync("git", ["-C", rig.work, "-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Initial"], { stdio: "ignore" })
    const runner = await Effect.runPromise(makeFakeRunner())
    await Effect.runPromise(provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
      yield* registerRebuildCheck()
      success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "zsh" } }))
      success(yield* call(owner, "harnesses", { operation: "set", harness: harnessSettings("cursor", { adapterPath: process.execPath, reportedModes: [{ id: "default", level: "ask" }] }) }))
      success(yield* call(owner, "accounts", { operation: "add", account: { id: "primary", harness: "cursor", enabled: true } }))
      success(yield* call(owner, "accounts set-secret", { accountId: "primary", name: "CURSOR_API_KEY", nonce: freshRequest(), value: Redacted.make("synthetic-mounted-new-project") }))
      yield* completedSetup(undefined, rig.work, "Actual Product")
      const handler = yield* CommandHandler
      const execute: Execute = (name, payload) => handler.execute(owner, name, { requestId: freshRequest(), ...payload }).pipe(
        Effect.tapCause((cause) => Effect.sync(() => console.error("Mounted fixture handler failure", name, Cause.pretty(cause))))
      )
      const delivered = wrap?.(execute) ?? execute
      // The transport and session probe are controlled. The App, Shell,
      // provider, forms, real handler, database, Git, receipts and lead launch
      // all execute normally. No alternate page or debug reducer is mounted.
      transport.client = new Proxy({}, { get: (_target, name) => name === "client.subscribe" ? () => Stream.never
        : (payload: Record<string, unknown>) => delivered(String(name), payload).pipe(Effect.mapError((error) => ({
          _tag: "CommandError" as const, reason: error !== null && typeof error === "object" && "reason" in error ? String(error.reason) : "refused"
        }))) })
      yield* Effect.promise(async () => {
        await act(async () => root.render(<App />))
        await eventually(() => expect(button(container, "New project").disabled).toBe(false))
        await body({ rig, runner, container, execute })
      })
    })))
  } finally {
    await act(async () => root.unmount())
    container.remove(); removeRig(rig)
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal"); Reflect.deleteProperty(HTMLDialogElement.prototype, "close")
  }
}
afterEach(() => {
  history.replaceState({}, "", "/"); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks()
  for (const close of closeWindows.splice(0)) close()
})

it("mounts the single real form from Home, registers at Machines, returns the exact draft, creates its dedicated worktree and opens its actual lead", async () => {
  await mountedJourney(async ({ container, rig, runner }) => {
    await click(container, "New project")
    await eventually(() => expect(container.querySelector("dialog")?.open).toBe(true))
    const dialog = container.querySelector("dialog")!
    await eventually(() => expect(field(dialog, "Project name").value).toBe("Actual Product"))
    await fill(dialog, "Project name", "Mounted goal")
    await fill(dialog, "Goal", "Keep this exact draft across Machines")
    await click(dialog, "Add repository")
    expect(location.hash).toBe("#/service/machines")
    await eventually(() => expect(container.textContent).toContain("Add repository to this computer"))
    expect(container.querySelector('[aria-label="Machines"] table')).not.toBeNull()
    const registration = container.querySelector(".review-page[aria-labelledby]")!
    await fill(registration, "Name", "Actual Product")
    await fill(registration, "Existing checkout folder", rig.work)
    await submit(field(registration, "Existing checkout folder"))
    await eventually(() => expect(location.hash).toBe("#/?view=projects"))
    await eventually(() => expect(button(dialog, "Create project").disabled).toBe(false))
    expect(field(dialog, "Project name").value).toBe("Mounted goal")
    expect(field(dialog, "Goal").value).toBe("Keep this exact draft across Machines")
    expect(dialog.querySelector('input[type="checkbox"]')).toBeNull()
    expect([...dialog.querySelectorAll("dt")].map((row) => row.textContent)).toEqual(["Branch", "Folder"])
    expect(dialog.textContent).toContain("mounted-goal")
    await submit(field(dialog, "Project name"))
    await eventually(() => expect(location.hash).toMatch(/^#\/thread\//))
    expect(runner.callsOf("start")).toHaveLength(1)
    const start = runner.callsOf("start")[0]!.input
    expect(location.hash).toBe(`#/thread/${encodeURIComponent(start.agentId)}`)
    expect(execFileSync("git", ["-C", start.folder, "branch", "--show-current"], { encoding: "utf8" }).trim()).toBe("mounted-goal")
    expect(dialog.open).toBe(false)
  })
})

it("Cancel at the actual Machines registration returns to the same draft and Escape restores the remounted Home trigger", async () => {
  await mountedJourney(async ({ container, runner, execute }) => {
    await click(container, "New project")
    const dialog = container.querySelector("dialog")!
    await eventually(() => expect(field(dialog, "Project name").value).toBe("Actual Product"))
    await fill(dialog, "Project name", "Keep on Cancel")
    await fill(dialog, "Goal", "Do not drop this draft")
    const original = button(container, "New project")
    await click(dialog, "Add repository")
    await click(container.querySelector(".review-page[aria-labelledby]")!, "Cancel")
    await eventually(() => expect(dialog.open).toBe(true))
    expect(location.hash).toBe("#/?view=projects")
    expect(field(dialog, "Project name").value).toBe("Keep on Cancel")
    expect(field(dialog, "Goal").value).toBe("Do not drop this draft")
    const current = button(container, "New project")
    expect(current).not.toBe(original)
    await act(async () => dialog.dispatchEvent(new Event("cancel", { cancelable: true })))
    expect(dialog.open).toBe(false)
    expect(document.activeElement).toBe(current)
    expect((await Effect.runPromise(execute("project.repositories", {}))).items).toHaveLength(1)
    expect(runner.callsOf("start")).toHaveLength(0)
  })
})

it("a committed lost create reply stays frozen through Machines and recovers the identical receipt once from the mounted form", async () => {
  const attempts: Record<string, unknown>[] = []
  let lose = true
  await mountedJourney(async ({ container, rig, runner, execute }) => {
    await click(container, "New project")
    const dialog = container.querySelector("dialog")!
    await fill(dialog, "Project name", "Lost mounted reply")
    await fill(dialog, "Goal", "Original frozen goal")
    await eventually(() => expect(button(dialog, "Create project").disabled).toBe(false))
    await submit(field(dialog, "Project name"))
    await eventually(() => expect(dialog.textContent).toContain("Could not confirm creation"))
    expect(runner.callsOf("start")).toHaveLength(1)
    await click(dialog, "Cancel")
    await act(async () => container.querySelector<HTMLAnchorElement>('a[href="/#/service/machines"]')!.click())
    await click(container, "Add repository")
    await click(container.querySelector(".review-page[aria-labelledby]")!, "Cancel")
    expect(location.hash).toBe("#/service/machines")
    await act(async () => container.querySelector<HTMLAnchorElement>('a[aria-label="Home"]')!.click())
    await click(container, "New project")
    await eventually(() => expect(button(dialog, "Check same creation").disabled).toBe(false))
    expect(field(dialog, "Goal").value).toBe("Original frozen goal")
    expect(field(dialog, "Goal").matches(":disabled")).toBe(true)
    await click(dialog, "Check same creation")
    await eventually(() => expect(location.hash).toMatch(/^#\/thread\//))
    expect(attempts).toHaveLength(2); expect(attempts[0]).toBe(attempts[1])
    expect(runner.callsOf("start")).toHaveLength(1)
    expect(location.hash).toBe(`#/thread/${encodeURIComponent(runner.callsOf("start")[0]!.input.agentId)}`)
    expect((await Effect.runPromise(execute("project.creations", {}))).items).toEqual([])
  }, (execute) => (name, payload) => {
    if (name !== "project.create") return execute(name, payload)
    attempts.push(payload)
    return execute(name, payload).pipe(Effect.flatMap((reply) => {
      if (lose) { lose = false; return Effect.fail(new Error("Injected lost reply after actual committed creation")) }
      return Effect.succeed(reply)
    }))
  })
})

it("typed registration expiry ends the actual owner mount and neither controller carries typed text into the next login", async () => {
  await mountedJourney(async ({ container, rig, runner }) => {
    await click(container, "New project")
    const dialog = container.querySelector("dialog")!
    await eventually(() => expect(field(dialog, "Project name").value).toBe("Actual Product"))
    await fill(dialog, "Project name", "Private old project")
    await fill(dialog, "Goal", "Private old goal")
    await click(dialog, "Add repository")
    const registration = container.querySelector(".review-page[aria-labelledby]")!
    await fill(registration, "Name", "Private old registration")
    await fill(registration, "Existing checkout folder", rig.work)
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })))
    await submit(field(registration, "Name"))
    await eventually(() => expect(container.querySelector('form[aria-label="Log in"]')).not.toBeNull())
    expect(container.textContent).not.toContain("Private old")
    expect(container.querySelector("dialog")).toBeNull()
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
    await fill(container, "Password", "synthetic-next-owner")
    await submit(field(container, "Password"))
    await eventually(() => expect(container.querySelector('a[aria-label="Home"]')).not.toBeNull())
    await act(async () => container.querySelector<HTMLAnchorElement>('a[aria-label="Home"]')!.click())
    await eventually(() => expect(button(container, "New project")).toBeDefined())
    await click(container, "New project")
    const next = container.querySelector("dialog")!
    await eventually(() => expect(field(next, "Project name").value).toBe("Actual Product"))
    expect(field(next, "Goal").value).toBe("")
    await eventually(() => expect(field(next, "Project name").value).toBe("Actual Product"))
    await click(next, "Add repository")
    const fresh = container.querySelector(".review-page[aria-labelledby]")!
    expect(field(fresh, "Name").value).toBe("Actual Product")
    expect(field(fresh, "Existing checkout folder").value).toBe(rig.work)
    expect(runner.callsOf("start")).toHaveLength(0)
  }, (execute) => (name, payload) => (name === "project.repository.add" || name === "project.repository.locate")
    ? Effect.fail({ _tag: "CommandError", reason: "invalid credential" }) : execute(name, payload))
})

it("actual logout disposes an in-flight owner operation and its late committed reply cannot navigate or refill the next owner form", async () => {
  let release: (() => void) | undefined
  await mountedJourney(async ({ container, rig, runner, execute }) => {
    await click(container, "New project")
    const dialog = container.querySelector("dialog")!
    await fill(dialog, "Project name", "Late owner reply")
    await fill(dialog, "Goal", "Old committed goal")
    await eventually(() => expect(button(dialog, "Create project").disabled).toBe(false))
    await submit(field(dialog, "Project name"))
    await eventually(() => expect(release).toBeTypeOf("function"))
    expect(runner.callsOf("start")).toHaveLength(1)
    await click(dialog, "Cancel")
    await click(container, "Log out")
    await eventually(() => expect(container.querySelector('form[aria-label="Log in"]')).not.toBeNull())
    await fill(container, "Password", "synthetic-next-owner")
    await submit(field(container, "Password"))
    await eventually(() => expect(button(container, "New project")).toBeDefined())
    await act(async () => release!())
    expect(location.hash).not.toMatch(/^#\/thread\//)
    await click(container, "New project")
    const next = container.querySelector("dialog")!
    await eventually(() => expect(field(next, "Project name").value).toBe("Actual Product"))
    expect(field(next, "Goal").value).toBe("")
    expect(field(next, "Goal").disabled).toBe(false)
    expect(next.textContent).not.toContain("Check same creation")
    expect(runner.callsOf("start")).toHaveLength(1)
  }, (execute) => (name, payload) => name === "project.create"
    ? execute(name, payload).pipe(Effect.flatMap((reply) => Effect.promise(() => new Promise<Record<string, unknown>>((resolve) => { release = () => resolve(reply) }))))
    : execute(name, payload))
})
