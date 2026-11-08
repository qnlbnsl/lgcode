import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Stream from "effect/Stream"
import { afterEach, expect, it, vi } from "vitest"
import { App } from "../src/index.ts"

const browser = vi.hoisted(() => ({ client: undefined as unknown }))
vi.mock("@lgcode/client/browser", async () => {
  const Effect = await import("effect/Effect")
  return { connect: () => Effect.succeed(browser.client) }
})
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []
const ack = () => Effect.succeed({ requestId: "reply" })
const initialAlerts = () => ({
  kinds: [{ kind: "approval", push: true }],
  carrier: { _tag: "ntfy", server: "https://push.example", topic: "alerts" }, tokenSet: true
})
const initialWeb = { enabled: true, port: 8787, heartbeatSeconds: 25, proxyMode: false, serverState: "running" }
const baseClient = () => ({
  "client.snapshot": () => Effect.succeed({ sequence: 7, agents: [], requests: [], questions: [] }),
  "client.subscribe": () => Stream.never,
  "client.alerts.settings": () => Effect.succeed(initialAlerts()),
  "client.web.settings": () => Effect.succeed(initialWeb)
})
async function render(path: string, strict = false) {
  history.replaceState(null, "", `/?page=${path.slice(1)}`)
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => { root.render(strict ? <StrictMode><App /></StrictMode> : <App />) })
  return container
}
async function submit(container: HTMLElement, label: string) {
  await act(async () => {
    container.querySelector(`form[aria-label="${label}"]`)!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
  })
}
async function eventually(check: () => void) {
  for (let attempt = 0; ; attempt++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    try { check(); return } catch (error) { if (attempt >= 100) throw error }
  }
}
afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => { root.unmount() })
    container.remove()
  }
  history.replaceState(null, "", "/")
  vi.unstubAllGlobals()
})

it("follows alert page cursors and refreshes without retaining removed rows", async () => {
  const row = (id: string) => ({ alertId: id, title: id, kind: "other", status: "open" })
  const list = vi.fn().mockReturnValueOnce(Effect.succeed({ items: [row("first")], next: 12 }))
    .mockReturnValueOnce(Effect.succeed({ items: [row("second")] }))
    .mockReturnValueOnce(Effect.succeed({ items: [] }))
  browser.client = { ...baseClient(), "client.alerts.list": list }
  const container = await render("/alerts")
  await eventually(() => expect(container.textContent).toContain("first"))
  const more = () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Load more alerts")
  await act(async () => { more()!.click() })
  await eventually(() => expect(container.textContent).toContain("second"))
  expect(container.textContent).toContain("first")
  expect(list.mock.calls[1]![0]).toEqual(expect.objectContaining({ after: 12, limit: 100 }))
  expect(more()).toBeUndefined()
  await act(async () => { container.querySelector<HTMLButtonElement>('section[aria-label="Alerts"] button')!.click() })
  await eventually(() => expect(container.textContent).toContain("No alerts."))
  expect(container.textContent).not.toContain("first")
})

it("clears a token immediately, submits once, and wipes it even when the command fails", async () => {
  let fail!: (error: Error) => void
  const pending = new Promise<never>((_, reject) => { fail = reject })
  let captured: Redacted.Redacted<string> | undefined
  const set = vi.fn(({ value }: { value: Redacted.Redacted<string> }) => {
    captured = value
    expect(Redacted.value(value)).toBe("dummy-only-token")
    expect(value.label).toBe("secret value")
    return Effect.tryPromise(() => pending)
  })
  browser.client = { ...baseClient(), "client.alerts.carrier.set-token": set }
  const container = await render("/settings")
  await eventually(() => expect(container.querySelector('input[name="token"]')).not.toBeNull())
  const token = container.querySelector<HTMLInputElement>('input[name="token"]')!
  token.value = "dummy-only-token"
  await submit(container, "Carrier token")
  expect(token.value).toBe("")
  await submit(container, "Carrier token")
  expect(set).toHaveBeenCalledTimes(1)
  expect(set.mock.calls[0]![0]).toEqual(expect.objectContaining({ origin: "https://push.example", nonce: expect.any(String), requestId: expect.any(String) }))
  await act(async () => { fail(new Error("dummy-only-token")) })
  await eventually(() => expect(container.textContent).toContain("Could not complete"))
  expect(container.textContent).not.toContain("dummy-only-token")
  expect(() => Redacted.value(captured!)).toThrow()
  expect(token.value).toBe("")
})

it("keeps a push toggle visible while saving and restores it if the save fails", async () => {
  let fail!: (error: Error) => void
  const pending = new Promise<never>((_, reject) => { fail = reject })
  browser.client = { ...baseClient(), "client.alerts.settings.set": () => Effect.tryPromise(() => pending) }
  const container = await render("/settings")
  await eventually(() => expect(container.querySelector('section[aria-label="Alert push settings"] input')).not.toBeNull())
  const checkbox = container.querySelector<HTMLInputElement>('section[aria-label="Alert push settings"] input')!
  await act(async () => { checkbox.click() })
  expect(checkbox.checked).toBe(false)
  expect(checkbox.disabled).toBe(true)
  await act(async () => { fail(new Error("save failed")) })
  await eventually(() => expect(checkbox.disabled).toBe(false))
  expect(checkbox.checked).toBe(true)
})

it("uses the canonical saved carrier origin and discards token input after a destination change", async () => {
  const read = vi.fn().mockReturnValueOnce(Effect.succeed(initialAlerts()))
    .mockReturnValue(Effect.succeed({ ...initialAlerts(), carrier: { _tag: "ntfy", server: "https://new.example", topic: "new" }, tokenSet: false }))
  const setToken = vi.fn(ack)
  browser.client = { ...baseClient(), "client.alerts.settings": read, "client.alerts.carrier.set": vi.fn(ack), "client.alerts.carrier.set-token": setToken }
  const container = await render("/settings")
  await eventually(() => expect(container.querySelector('input[name="token"]')).not.toBeNull())
  container.querySelector<HTMLInputElement>('input[name="token"]')!.value = "unused-token"
  container.querySelector<HTMLInputElement>('input[name="server"]')!.value = "https://NEW.example:443"
  container.querySelector<HTMLInputElement>('input[name="topic"]')!.value = "new"
  await submit(container, "Alert carrier")
  await eventually(() => expect(container.textContent).toContain("No token set"))
  expect(container.querySelector<HTMLInputElement>('input[name="token"]')!.value).toBe("")
  container.querySelector<HTMLInputElement>('input[name="token"]')!.value = "dummy-new-token"
  await submit(container, "Carrier token")
  expect(setToken).toHaveBeenCalledWith(expect.objectContaining({ origin: "https://new.example" }))
})

it("clears the carrier and disables token entry when no destination remains", async () => {
  const read = vi.fn().mockReturnValueOnce(Effect.succeed(initialAlerts()))
    .mockReturnValue(Effect.succeed({ ...initialAlerts(), carrier: { _tag: "none" }, tokenSet: false }))
  const clear = vi.fn(ack)
  browser.client = { ...baseClient(), "client.alerts.settings": read, "client.alerts.carrier.set": clear }
  const container = await render("/settings")
  await eventually(() => expect(container.querySelector('input[name="token"]')).not.toBeNull())
  await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Clear carrier")!.click() })
  await eventually(() => expect(container.textContent).toContain("No carrier configured"))
  expect(clear).toHaveBeenCalledWith(expect.objectContaining({ carrier: { _tag: "none" } }))
  expect(container.querySelector<HTMLInputElement>('input[name="token"]')!.disabled).toBe(true)
})

it("sends all web settings, including proxy and enable controls", async () => {
  const set = vi.fn(ack)
  browser.client = { ...baseClient(), "client.web.settings.set": set }
  const container = await render("/settings")
  await eventually(() => expect(container.querySelector('input[name="port"]')).not.toBeNull())
  const form = container.querySelector<HTMLFormElement>('form[aria-label="Web server settings"]')!
  const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement
  input("enabled").checked = false
  input("port").value = "8899"
  input("heartbeatSeconds").value = "40"
  input("proxyMode").checked = true
  input("publicAddress").value = "https://lgcode.example"
  await submit(container, "Web server settings")
  expect(set).toHaveBeenCalledWith(expect.objectContaining({ settings: {
    enabled: false, port: 8899, heartbeatSeconds: 40, proxyMode: true, publicAddress: "https://lgcode.example"
  } }))
})

it("returns an expired settings session to login without displaying server error text", async () => {
  browser.client = { ...baseClient(), "client.alerts.settings": () => Effect.fail(new Error("private server data")) }
  const container = await render("/settings")
  const fetch = vi.mocked(globalThis.fetch)
  fetch.mockResolvedValue(new Response(null, { status: 401 }))
  // The first operation may already have probed while rendering. Retry with
  // the now-expired session to exercise the refusal from the page entry point.
  if (container.querySelector('[aria-label="Settings"]')) {
    await eventually(() => expect(container.querySelector<HTMLButtonElement>('section[aria-label="Settings"] button')!.disabled).toBe(false))
    await act(async () => { container.querySelector<HTMLButtonElement>('section[aria-label="Settings"] button')!.click() })
  }
  await eventually(() => expect(container.querySelector('form[aria-label="Log in"]')).not.toBeNull())
  expect(container.textContent).not.toContain("private server data")
  expect(container.querySelector('[aria-label="Settings"]')).toBeNull()
})

it.each([
  { page: "alerts", strict: false }, { page: "alerts", strict: true },
  { page: "settings", strict: false }, { page: "settings", strict: true }
])("cancels the active $page read on navigation (StrictMode=$strict)", async ({ page, strict }) => {
  let generation = 0
  const active = new Set<number>()
  const closed: number[] = []
  const read = () => Effect.suspend(() => {
    const id = ++generation
    active.add(id)
    return Effect.never.pipe(Effect.ensuring(Effect.sync(() => { active.delete(id); closed.push(id) })))
  })
  browser.client = { ...baseClient(), [page === "alerts" ? "client.alerts.list" : "client.alerts.settings"]: read }
  const container = await render(`/${page}`, strict)
  await eventually(() => expect(active.size).toBe(1))
  const current = [...active][0]!
  expect(closed).not.toContain(current)
  if (strict) {
    expect(generation).toBeGreaterThan(1)
    expect(closed.length).toBeGreaterThan(0)
  } else expect(closed).toEqual([])
  const before = closed.length
  await act(async () => { Array.from(container.querySelectorAll("a")).find((link) => link.textContent === "Situation")!.click() })
  await eventually(() => expect(container.querySelector('[aria-label="Situation"]')).not.toBeNull())
  await eventually(() => expect(closed).toContain(current))
  expect(closed).toHaveLength(before + 1)
  expect(active.size).toBe(0)
})
