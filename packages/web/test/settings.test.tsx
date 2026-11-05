import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { afterEach, expect, it, vi } from "vitest"
import { App } from "../src/index.ts"

const browser = vi.hoisted(() => ({ client: undefined as unknown, connect: vi.fn() }))
vi.mock("@shephrd/client/browser", async () => {
  const Effect = await import("effect/Effect")
  return { connect: (...args: unknown[]) => { browser.connect(...args); return Effect.succeed(browser.client) } }
})

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ root: Root; container: HTMLDivElement }> = []
const webSettings = { enabled: true, port: 8787, heartbeatSeconds: 25, proxyMode: false }
const alertSettings = {
  kinds: [{ kind: "approval", push: true }, { kind: "question", push: false }],
  carrier: { _tag: "ntfy", server: "https://push.example", topic: "shephrd" }, tokenSet: true
}

const render = async () => {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  await act(async () => { root.render(<App />) })
  return container
}

const setControlValue = (control: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(control, value)
  control.dispatchEvent(new Event("input", { bubbles: true }))
  control.dispatchEvent(new Event("change", { bubbles: true }))
}

const openSettings = async (container: HTMLElement) => {
  const link = Array.from(container.querySelectorAll("a")).find((item) => item.textContent?.includes("Settings"))
  expect(link, "the owner needs a Settings link to reach the page").toBeTruthy()
  await act(async () => { link!.click() })
}

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => { root.unmount() })
    container.remove()
  }
  vi.unstubAllGlobals()
  browser.connect.mockReset()
  browser.client = undefined
})

it("7.8 changes a kind's alert push setting through its client command", async () => {
  let acknowledge!: (value: { requestId: string }) => void
  const pending = new Promise<{ requestId: string }>((resolve) => { acknowledge = resolve })
  const set = vi.fn(() => Effect.tryPromise(() => pending))
  const read = vi.fn(() => Effect.succeed({ requestId: "reply", ...alertSettings }))
  browser.client = {
    "client.snapshot": () => Effect.succeed({ requestId: "snapshot", sequence: 7, agents: [], requests: [], questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0 }),
    "client.subscribe": () => Stream.never,
    "client.alerts.settings": read,
    "client.alerts.settings.set": set,
    "client.web.settings": () => Effect.succeed({ requestId: "reply", ...webSettings, serverState: "running" })
  }
  const container = await render()
  await openSettings(container)
  await vi.waitFor(() => expect(container.textContent).toContain("approval"))
  const control = container.querySelector<HTMLInputElement>('input[type="checkbox"]')
  expect(control, "alert push settings need a usable checkbox").toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")!.set!.call(control, false)
    control!.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await vi.waitFor(() => expect(set).toHaveBeenCalledWith(expect.objectContaining({ kind: "approval", push: false })))
  expect(control!.checked).toBe(false)
  expect(control!.disabled).toBe(true)
  await act(async () => { acknowledge({ requestId: "reply" }) })
  await vi.waitFor(() => expect(control!.disabled).toBe(false))
  expect(control!.checked).toBe(false)
  expect(container.textContent).toContain("Alert push setting saved.")
  expect(read).toHaveBeenCalledTimes(1)
  expect(set).toHaveBeenCalledTimes(1)
})

it("7.8 changes the alert carrier server and topic through its client command", async () => {
  const set = vi.fn(() => Effect.succeed({ requestId: "reply" }))
  browser.client = {
    "client.snapshot": () => Effect.succeed({ requestId: "snapshot", sequence: 7, agents: [], requests: [], questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0 }),
    "client.subscribe": () => Stream.never,
    "client.alerts.settings": () => Effect.succeed({ requestId: "reply", ...alertSettings }),
    "client.alerts.carrier.set": set,
    "client.web.settings": () => Effect.succeed({ requestId: "reply", ...webSettings, serverState: "running" })
  }
  const container = await render()
  await openSettings(container)
  await vi.waitFor(() => expect(container.querySelector('input[name="server"]')).toBeTruthy())
  const server = container.querySelector<HTMLInputElement>('input[name="server"]')!
  const topic = container.querySelector<HTMLInputElement>('input[name="topic"]')!
  await act(async () => {
    setControlValue(server, "https://notify.example")
    setControlValue(topic, "phone-alerts")
    container.querySelector("form[aria-label='Alert carrier']")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
  })
  await vi.waitFor(() => expect(set).toHaveBeenCalledWith(expect.objectContaining({ carrier: { _tag: "ntfy", server: "https://notify.example", topic: "phone-alerts" } })))
})

it("7.8 sets and clears the carrier token without reading it back", async () => {
  const setToken = vi.fn(() => Effect.succeed({ requestId: "reply" }))
  const clearToken = vi.fn(() => Effect.succeed({ requestId: "reply" }))
  browser.client = {
    "client.snapshot": () => Effect.succeed({ requestId: "snapshot", sequence: 7, agents: [], requests: [], questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0 }),
    "client.subscribe": () => Stream.never,
    "client.alerts.settings": () => Effect.succeed({ requestId: "reply", ...alertSettings }),
    "client.alerts.carrier.set-token": setToken,
    "client.alerts.carrier.clear-token": clearToken,
    "client.web.settings": () => Effect.succeed({ requestId: "reply", ...webSettings, serverState: "running" })
  }
  const container = await render()
  await openSettings(container)
  await vi.waitFor(() => expect(container.textContent).toContain("Token set"))
  expect(container.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe("")
  const token = container.querySelector<HTMLInputElement>('input[type="password"]')
  expect(token, "the token must be entered in a write-only control").toBeTruthy()
  await act(async () => {
    token!.value = "dummy-test-value"
    token!.dispatchEvent(new Event("input", { bubbles: true }))
    container.querySelector("form[aria-label='Carrier token']")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
  })
  await vi.waitFor(() => expect(setToken).toHaveBeenCalledWith(expect.objectContaining({ origin: "https://push.example" })))
  expect(container.textContent).not.toContain("dummy-test-value")
  const clear = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Clear token"))
  expect(clear, "the owner must be able to remove the carrier token").toBeTruthy()
  await act(async () => { clear!.click() })
  await vi.waitFor(() => expect(clearToken).toHaveBeenCalledTimes(1))
})

it("7.8 changes web server settings and shows the current serverState", async () => {
  const set = vi.fn(() => Effect.succeed({ requestId: "reply" }))
  browser.client = {
    "client.snapshot": () => Effect.succeed({ requestId: "snapshot", sequence: 7, agents: [], requests: [], questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0 }),
    "client.subscribe": () => Stream.never,
    "client.alerts.settings": () => Effect.succeed({ requestId: "reply", ...alertSettings }),
    "client.web.settings": () => Effect.succeed({ requestId: "reply", ...webSettings, serverState: "port-taken" }),
    "client.web.settings.set": set
  }
  const container = await render()
  await openSettings(container)
  await vi.waitFor(() => expect(container.textContent).toContain("port-taken"))
  expect(container.textContent).toContain("8787")
  const port = container.querySelector<HTMLInputElement>('input[name="port"]')
  expect(port, "web server settings need an editable port control").toBeTruthy()
  await act(async () => {
    setControlValue(port!, "8899")
    setControlValue(container.querySelector<HTMLInputElement>('input[name="publicAddress"]')!, "https://shephrd.example.test:9443")
    container.querySelector("form[aria-label='Web server settings']")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
  })
  await vi.waitFor(() => expect(set).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ port: 8899, publicAddress: "https://shephrd.example.test:9443" }) })))
})

it("FR-001 refuses an HTTP public address before saving and explains HTTPS", async () => {
  const set = vi.fn(() => Effect.succeed({ requestId: "reply" }))
  browser.client = {
    "client.snapshot": () => Effect.succeed({ requestId: "snapshot", sequence: 7, agents: [], requests: [], questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0 }),
    "client.subscribe": () => Stream.never,
    "client.alerts.settings": () => Effect.succeed({ requestId: "reply", ...alertSettings }),
    "client.web.settings": () => Effect.succeed({ requestId: "reply", ...webSettings, serverState: "running" }),
    "client.web.settings.set": set
  }
  const container = await render()
  await openSettings(container)
  await vi.waitFor(() => expect(container.querySelector('input[name="publicAddress"]')).toBeTruthy())
  await act(async () => {
    setControlValue(container.querySelector<HTMLInputElement>('input[name="publicAddress"]')!, "http://shephrd.example.test")
    container.querySelector("form[aria-label='Web server settings']")!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
  })
  expect(container.querySelector('[role="status"]')?.textContent).toMatch(/public address.*https/i)
  expect(set).not.toHaveBeenCalled()
})
