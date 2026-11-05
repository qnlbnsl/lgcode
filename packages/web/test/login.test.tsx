import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { App } from "../src/index.ts"

const roots: Array<{ container: HTMLDivElement; root: Root }> = []
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const renderApp = async () => {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  roots.push({ container, root })
  await act(async () => { root.render(<App />) })
  return container
}

const settle = async () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

afterEach(async () => {
  for (const { container, root } of roots.splice(0)) {
    await act(async () => { root.unmount() })
    container.remove()
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})

it("7.1 shows the login form after an unauthenticated session probe and sends the password only in the login body", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    requests.push({ url, init })
    if (url === "/api/session") return new Response(null, { status: 401 })
    if (url === "/api/login") return new Response(null, { status: 204 })
    throw new Error(`Unexpected request ${url}`)
  }))

  const container = await renderApp()
  let formAfter401: Element | null = null
  await act(async () => { await vi.waitFor(() => { formAfter401 = container.querySelector('form[aria-label="Log in"]'); if (formAfter401 === null) throw new Error("login form is not rendered") }) })
  expect(formAfter401).toBeTruthy() // catches rendering the owner view after HTTP 401

  const password = container.querySelector<HTMLInputElement>('input[type="password"]')
  const form = container.querySelector<HTMLFormElement>("form")
  expect(password).toBeTruthy()
  expect(form).toBeTruthy()
  await act(async () => {
    password!.value = "correct horse battery staple"
    password!.dispatchEvent(new Event("input", { bubbles: true }))
    password!.dispatchEvent(new Event("change", { bubbles: true }))
    form!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
  })
  await settle()

  const login = requests.find((request) => request.url === "/api/login")
  expect(login?.init.method).toBe("POST") // catches putting credentials in a URL or another route
  expect(login?.init.body).toBe(JSON.stringify({ password: "correct horse battery staple" }))
  expect(new Headers(login?.init.headers).has("authorization")).toBe(false) // catches a credential header
  expect(password!.value).toBe("") // catches retaining the secret in a live form control
  expect(localStorage.length).toBe(0) // catches browser-persistent credentials
  expect(sessionStorage.length).toBe(0)
  expect(await window.indexedDB?.databases?.() ?? []).toEqual([]) // catches storing the password in IndexedDB where the browser supports inspection
})

it("7.1 returns to the login form after logout", async () => {
  let loggedIn = true
  const requests: string[] = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    requests.push(url)
    if (url === "/api/session") return new Response(null, { status: loggedIn ? 204 : 401 })
    if (url === "/api/logout") { loggedIn = false; return new Response(null, { status: 204 }) }
    throw new Error(`Unexpected request ${url}`)
  }))

  const container = await renderApp()
  expect(container.querySelector('button[aria-label="Log out"]')).toBeTruthy() // catches a logged-in session that never opens the owner view
  const logout = container.querySelector<HTMLButtonElement>('button[aria-label="Log out"]')
  expect(logout).toBeTruthy()
  await act(async () => { logout!.click() })
  await settle()

  expect(requests).toContain("/api/logout") // catches a logout control that does not end the session
  expect(container.querySelector('form[aria-label="Log in"]')).toBeTruthy() // catches stale authenticated UI
})
