import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import * as Effect from "effect/Effect"
import { afterEach, expect, it, vi } from "vitest"
import { App } from "../src/index.ts"
import { adminShellClient } from "./admin-shell-client.ts"

const browser = vi.hoisted(() => ({ client: undefined as unknown, connect: vi.fn() }))
vi.mock("@lgtm/client/browser", async () => {
  const Effect = await import("effect/Effect")
  return { connect: (...args: unknown[]) => { browser.connect(...args); return Effect.succeed(browser.client) } }
})

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ root: Root; container: HTMLDivElement }> = []
const envelope = { sequence: 7, eventId: "event-7", occurredAt: 7, caller: { _tag: "owner" }, event: { _tag: "UnknownEvent", tag: "future.Event", namespace: "future" } }
const openAlert = {
  alertId: "alert-open", alertKey: "approval.worker.permission-1", kind: "approval", agentId: "worker-one",
  subject: { _tag: "permission", id: "permission-1" }, title: "Permission needs your approval",
  sourceSequence: 4, status: "open", raisedAt: 4
}
const clearedAlert = {
  alertId: "alert-cleared", alertKey: "question.worker.question-1", kind: "question", agentId: "worker-two",
  subject: { _tag: "question", id: "question-1" }, title: "A question needs your answer",
  sourceSequence: 5, status: "cleared", raisedAt: 5, clearedAt: 6
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

const openAlerts = async (container: HTMLElement) => {
  const link = container.querySelector<HTMLAnchorElement>('a[aria-label="Phone notifications"]')
  expect(link, "the owner needs an Alerts link to reach the page").toBeTruthy()
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

it("7.7 lists both open and cleared alerts from the alert read", async () => {
  const list = vi.fn(({ status }: { status?: string }) => Effect.succeed({
    requestId: "reply", items: status === "cleared" ? [clearedAlert] : status === "open" ? [openAlert] : [openAlert, clearedAlert]
  }))
  browser.client = {
    ...adminShellClient(),
    "client.alerts.list": list
  }
  const container = await render()
  await openAlerts(container)

  await vi.waitFor(() => {
    expect(container.textContent).toContain("Permission needs your approval")
    expect(container.textContent).toContain("A question needs your answer")
  })
  expect(list).toHaveBeenCalled()
})

it("7.7 opens an alert's agent thread through a link without sending a command", async () => {
  const commands = vi.fn(() => Effect.succeed({ requestId: "reply" }))
  browser.client = {
    ...adminShellClient(),
    "client.alerts.list": () => Effect.succeed({ requestId: "reply", items: [openAlert] }),
    "client.alerts.dismiss": commands
  }
  const container = await render()
  await openAlerts(container)
  await vi.waitFor(() => expect(container.textContent).toContain(openAlert.title))

  const threadLink = Array.from(container.querySelectorAll("a")).find((item) => item.getAttribute("href")?.includes("worker-one"))
  expect(threadLink, "the alert must link to its agent thread").toBeTruthy()
  await act(async () => { threadLink!.click() })
  expect(commands).not.toHaveBeenCalled()
})

it.each([
  { status: "failed", generation: 7, attempt: 1, reason: "token missing", final: false, label: "Failed" },
  { status: "failed", generation: 7, attempt: 5, reason: "carrier delivery failed", final: true, label: "Still failing" },
  { status: "delivered", generation: 7, attempt: 6, label: "Delivered" }
])("FR-017 displays $label separately from the alert lifecycle and refreshes after recovery", async ({ label, ...delivery }) => {
  let item = { ...openAlert, delivery }
  browser.client = {
    ...adminShellClient(),
    "client.alerts.list": () => Effect.succeed({ requestId: "reply", items: [item] })
  }
  const container = await render()
  await openAlerts(container)
  await vi.waitFor(() => {
    expect(container.textContent).toContain(`Delivery: ${label}`)
    expect(container.textContent).toContain(`Attempt: ${delivery.attempt}`)
    expect(container.textContent).toContain("Status: open")
    if (delivery.status === "failed") expect(container.textContent).toContain(delivery.reason)
  })
  item = { ...openAlert, status: "cleared", delivery: { status: "delivered", generation: 7, attempt: 6 } }
  const refresh = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Refresh alerts")!
  await act(async () => { refresh.click() })
  await vi.waitFor(() => {
    expect(container.textContent).toContain("Delivery: Delivered")
    expect(container.textContent).toContain("Status: cleared")
    expect(container.textContent).not.toContain("Still failing")
    expect(container.textContent).not.toContain("token missing")
    expect(container.textContent).not.toContain("carrier delivery failed")
  })
})
