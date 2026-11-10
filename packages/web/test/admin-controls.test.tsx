import { ConversationSession } from "../src/thread/conversationState.tsx"
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import type { ClientSnapshot, Project, Repository, Workspace } from "@lgcode/contracts"
import type { ShellData } from "../src/data/ShellDataProvider.tsx"
import { createRequestSources } from "../src/data/requestSources.ts"
import { Alerts } from "../src/admin/alerts.tsx"
import { Settings } from "../src/admin/settings.tsx"
import { ProjectSettingsPage } from "../src/admin/project-settings.tsx"
import { Subscriptions } from "../src/admin/subscriptions.tsx"
import { Machines } from "../src/admin/machines.tsx"
import { NotificationPrompt } from "../src/admin/notification-prompt.tsx"

const mock = vi.hoisted(() => ({ client: undefined as unknown, data: undefined as unknown, disabled: false }))
vi.mock("@lgcode/client/browser", async () => {
  const Effect = await import("effect/Effect")
  return { connect: () => Effect.succeed(mock.client) }
})
vi.mock("../src/data/ShellDataProvider.tsx", () => ({ useShellData: () => mock.data, useMutationDisabled: () => mock.disabled }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mounts: Array<{ root: Root; element: HTMLDivElement }> = []
const ack = () => Effect.succeed({ requestId: "reply" })
const project = { projectId: "project", repoId: "repo", name: "Field", goal: "Ship the tool", leadAgentId: "lead", worktreeId: "assigned", machineId: "local", shell: "bash" } as Project
const repository = { repoId: "repo", name: "<img src=x>\u202e repository", path: "/repo" } as Repository
const workspaces = [
  { worktreeId: "assigned", repoId: "repo", machineId: "local", branch: "field", path: "/repo/.worktrees/field", checkout: "worktree" },
  { worktreeId: "inspected", repoId: "repo", machineId: "local", branch: "other", path: "/repo/.worktrees/other", checkout: "worktree" }
] as Workspace[]
const snapshot = { sequence: 7, agents: [], requests: [], questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0 } as unknown as ClientSnapshot
const baseData = (): ShellData => ({ snapshot, navigation: { projects: [project], repositories: [repository], workspaces, teams: [], agents: [] },
  requests: [], alerts: [], complete: true, connection: "Live", retry: vi.fn(), onSessionExpired: vi.fn(), requestSources: createRequestSources(), conversations: new ConversationSession() })
const alertSettings = { kinds: [{ kind: "approval", push: true }], carrier: { _tag: "ntfy", server: "https://push.example", topic: "alerts" }, tokenSet: true }
const webSettings = { enabled: true, port: 8787, heartbeatSeconds: 25, proxyMode: false, serverState: "running" }
const failed = { alertId: "notice", alertKey: "other.notice", sourceSequence: 1, kind: "other", title: "Attention", raisedAt: 1, status: "open",
  delivery: { status: "failed", generation: 4, attempt: 2, reason: "carrier delivery failed", final: false } }
async function render(node: ReactNode) {
  const element = document.createElement("div")
  document.body.append(element)
  const root = createRoot(element)
  mounts.push({ root, element })
  await act(async () => { root.render(node) })
  return { element, root }
}
async function settle(check: () => void) {
  for (let attempt = 0; ; attempt++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    try { check(); return } catch (error) { if (attempt === 100) throw error }
  }
}
const button = (element: HTMLElement, text: string) => [...element.querySelectorAll("button")].find((row) => row.textContent === text)!
async function click(element: HTMLElement, text: string) { await act(async () => { button(element, text).click() }) }
async function submit(element: HTMLElement, label: string) {
  await act(async () => { element.querySelector(`form[aria-label="${label}"]`)!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })) })
}
beforeEach(() => {
  mock.data = baseData()
  mock.disabled = false
  history.replaceState(null, "", "/")
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", "") } })
})
afterEach(async () => {
  (mock.data as ShellData).requestSources.close()
  for (const { root, element } of mounts.splice(0)) { await act(async () => root.unmount()); element.remove() }
  vi.unstubAllGlobals()
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal")
  history.replaceState(null, "", "/")
})

it("recovers a notification retry with the exact receipt identity after a lost acknowledgement", async () => {
  let delivered = false
  const retry = vi.fn().mockReturnValueOnce(Effect.fail(new Error("transport lost"))).mockImplementation(() => {
    delivered = true
    return Effect.succeed({ accepted: true })
  })
  mock.client = { "client.alerts.list": () => Effect.succeed({ items: [delivered ? { ...failed, delivery: { status: "delivered", generation: 4, attempt: 3 } } : failed] }), "client.alerts.retry": retry }
  const { element } = await render(<Alerts onSessionExpired={vi.fn()} />)
  await settle(() => expect(element.textContent).toContain("Attempt: 2"))
  await click(element, "Retry")
  await settle(() => expect(element.textContent).toContain("result is uncertain"))
  await click(element, "Retry same notification")
  await settle(() => expect(element.textContent).toContain("Delivery: Delivered"))
  expect(retry).toHaveBeenCalledTimes(2)
  expect(retry.mock.calls[0]![0]).toEqual(retry.mock.calls[1]![0])
  expect(retry.mock.calls[0]![0]).toEqual(expect.objectContaining({ alertId: "notice", generation: 4, attempt: 2 }))
  expect(element.textContent).toContain("Phone arrival is not confirmed")
})

it("refreshes a refused stale retry without exposing raw refusal data", async () => {
  let item = failed
  const list = vi.fn(() => Effect.succeed({ items: [item] }))
  mock.client = { "client.alerts.list": list, "client.alerts.retry": () => {
    item = { ...failed, delivery: { ...failed.delivery, generation: 5, attempt: 1 } }
    return Effect.fail({ _tag: "CommandError", requestId: "refused", reason: "private token data" })
  } }
  const { element } = await render(<Alerts onSessionExpired={vi.fn()} />)
  await settle(() => expect(element.textContent).toContain("Attempt: 2"))
  await click(element, "Retry")
  await settle(() => expect(element.textContent).toContain("retry was refused"))
  expect(element.textContent).toContain("Attempt: 1")
  expect(element.textContent).not.toContain("private token data")
  expect(list).toHaveBeenCalledTimes(2)
})

it("can recover a pending retry after refresh shows its already delivered notification", async () => {
  let delivered = false
  const retry = vi.fn().mockImplementationOnce(() => { delivered = true; return Effect.fail(new Error("lost acknowledgement")) }).mockReturnValueOnce(Effect.succeed({ accepted: true }))
  mock.client = { "client.alerts.list": () => Effect.succeed({ items: [delivered ? { ...failed, delivery: { status: "delivered", generation: 4, attempt: 3 } } : failed] }), "client.alerts.retry": retry }
  const { element } = await render(<Alerts onSessionExpired={vi.fn()} />)
  await settle(() => expect(button(element, "Retry")).toBeDefined())
  await click(element, "Retry")
  await settle(() => expect(button(element, "Recover retry result")).toBeDefined())
  await click(element, "Refresh alerts")
  await settle(() => expect(element.textContent).toContain("Delivery: Delivered"))
  await click(element, "Recover retry result")
  await settle(() => expect(element.textContent).toContain("accepted the retry"))
  expect(retry.mock.calls[0]![0]).toEqual(retry.mock.calls[1]![0])
  expect(button(element, "Recover retry result")).toBeUndefined()
})

it("keeps a token draft during rerender and wipes the detached control on navigation", async () => {
  mock.client = { "client.alerts.settings": () => Effect.succeed(alertSettings), "client.web.settings": () => Effect.succeed(webSettings) }
  const expired = vi.fn()
  const { element, root } = await render(<Settings onSessionExpired={expired} />)
  await settle(() => expect(element.querySelector('[name="token"]')).not.toBeNull())
  const token = element.querySelector<HTMLInputElement>('[name="token"]')!
  token.value = "unsaved-secret-canary"
  await act(async () => root.render(<Settings onSessionExpired={expired} />))
  expect(element.querySelector('[name="token"]')).toBe(token)
  expect(token.value).toBe("unsaved-secret-canary")
  await act(async () => root.render(<p>Another page</p>))
  expect(token.value).toBe("")
  expect(element.textContent).not.toContain("unsaved-secret-canary")
})

it("reports an uncertain test send without an automatic resend", async () => {
  const send = vi.fn(() => Effect.fail(new Error("secret transport body")))
  mock.client = { "client.alerts.settings": () => Effect.succeed(alertSettings), "client.web.settings": () => Effect.succeed(webSettings), "client.alerts.test": send }
  const { element } = await render(<Settings onSessionExpired={vi.fn()} />)
  await settle(() => expect(button(element, "Send test notification")).toBeDefined())
  await click(element, "Send test notification")
  await settle(() => expect(element.textContent).toContain("It may have been sent"))
  expect(send).toHaveBeenCalledTimes(1)
  expect(element.textContent).not.toContain("secret transport body")
})

it("uses assigned project facts when the route inspects another team workspace", async () => {
  const { element } = await render(<ProjectSettingsPage route={{ page: "project", projectId: project.projectId, tab: "settings", teamId: "team" as never, workspaceId: workspaces[1]!.worktreeId }} />)
  const facts = element.querySelector("dl")!
  expect(facts.textContent).toContain("/repo/.worktrees/field")
  expect(facts.textContent).not.toContain("/repo/.worktrees/other")
  expect(facts.textContent).toContain("\\u202e")
  expect(facts.querySelector("img")).toBeNull()
})

it("keeps an archive dialog cancellable when the connection is lost", async () => {
  const props = { route: { page: "project" as const, projectId: project.projectId, tab: "settings" as const } }
  const { element, root } = await render(<ProjectSettingsPage {...props} />)
  await click(element, "Archive")
  mock.disabled = true
  await act(async () => root.render(<ProjectSettingsPage {...props} />))
  expect(element.querySelector<HTMLButtonElement>("dialog .admin-primary")!.disabled).toBe(true)
  expect([...element.querySelectorAll<HTMLButtonElement>("dialog button")].find((item) => item.textContent === "Cancel")!.disabled).toBe(false)
  await click(element, "Cancel")
  expect(element.querySelector("dialog")).toBeNull()
})

it("replays an unconfirmed rename with the same body and updates shared navigation only after acknowledgement", async () => {
  const rename = vi.fn().mockReturnValueOnce(Effect.fail(new Error("socket closed"))).mockReturnValueOnce(ack())
  mock.client = { "project.rename": rename, "project.read": () => Effect.succeed({ items: [{ ...project, name: "New name" }] }) }
  const { element } = await render(<ProjectSettingsPage route={{ page: "project", projectId: project.projectId, tab: "settings" }} />)
  element.querySelector<HTMLInputElement>('[name="rename"]')!.value = "New name"
  await submit(element, "Rename project")
  await settle(() => expect(element.textContent).toContain("Retry same action"))
  expect((mock.data as ShellData).retry).not.toHaveBeenCalled()
  expect(element.querySelector<HTMLInputElement>('[name="rename"]')!.matches(":disabled")).toBe(true)
  await click(element, "Retry same action")
  await settle(() => expect(element.textContent).toContain("Project settings saved"))
  expect(rename.mock.calls[0]![0]).toEqual(rename.mock.calls[1]![0])
  expect((mock.data as ShellData).retry).toHaveBeenCalledTimes(1)
})

it("confirms archive, retains an unfinished archive identity, and restores without resuming agents", async () => {
  let row = project
  const archive = vi.fn((_payload: unknown): Effect.Effect<{ requestId: string }, unknown> => ack()).mockImplementationOnce(() => {
    row = { ...project, archiving: true }
    return Effect.fail({ _tag: "CommandError", reason: "failed stop detail" })
  }).mockImplementationOnce(() => { row = { ...project, archivedAt: 7 as never }; return ack() })
  const restore = vi.fn().mockImplementation(() => { row = project; return ack() })
  mock.client = { "project.archive": archive, "project.restore": restore, "project.read": () => Effect.succeed({ items: [row] }) }
  const { element } = await render(<ProjectSettingsPage route={{ page: "project", projectId: project.projectId, tab: "settings" }} />)
  await click(element, "Archive")
  expect(archive).not.toHaveBeenCalled()
  expect(element.querySelector("dialog[open]")).not.toBeNull()
  await act(async () => { element.querySelector<HTMLButtonElement>("dialog .admin-primary")!.click() })
  await settle(() => expect(element.textContent).toContain("Archiving is unfinished"))
  expect(element.textContent).not.toContain("failed stop detail")
  expect(button(element, "Restore")).toBeUndefined()
  await click(element, "Retry same action")
  await settle(() => expect(button(element, "Restore")).toBeDefined())
  expect(archive.mock.calls[0]![0]).toEqual(archive.mock.calls[1]![0])
  await click(element, "Restore")
  await settle(() => expect(element.textContent).toContain("Its agents remain stopped"))
  expect(restore).toHaveBeenCalledTimes(1)
})

it.each(["working", "stopped"] as const)("keeps placement and retry disabled with pairing tooltips and no request for %s agents", async (state) => {
  history.replaceState(null, "", "/#/service/machines?project=project")
  const data = baseData()
  mock.data = { ...data, navigation: { ...data.navigation!, agents: [{ agentId: "lead", projectId: "project", status: state }] },
    snapshot: { ...snapshot, agents: [{ agentId: "lead", state: { _tag: state }, capacityHeld: state === "working" }] } }
  const place = vi.fn(ack)
  mock.client = { "project.place": place }
  const { element } = await render(<Machines onSessionExpired={vi.fn()} />)
  expect(document.activeElement).toBe(element.querySelector("tr[data-placement=project]"))
  const select = element.querySelector<HTMLSelectElement>("select")!
  const retry = button(element, "Retry same placement")!
  expect(select.disabled).toBe(true)
  expect(retry.disabled).toBe(true)
  for (const control of [select, retry]) expect(control.title).toBe("Moving a project to another machine waits for machine pairing.")
  await act(async () => {
    select.dispatchEvent(new Event("change", { bubbles: true }))
    retry.click()
    retry.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
  expect(element.textContent).toContain("/repo/.worktrees/field")
  expect(element.textContent).not.toContain("/repo/.worktrees/other")
  expect(element.textContent).toContain("requires machine pairing, which is not available yet")
  expect(element.textContent).toContain(`${state === "working" ? 1 : 0} held`)
  expect(place).not.toHaveBeenCalled()
})

it("permanently dismisses the waiting-request offer only after an acknowledged command", async () => {
  mock.data = { ...baseData(), requests: [{ id: "question", status: "open", holder: { _tag: "owner" } }] }
  const dismiss = vi.fn().mockReturnValueOnce(Effect.fail(new Error("lost reply"))).mockReturnValueOnce(ack())
  mock.client = { "client.alerts.settings": () => Effect.succeed({ ...alertSettings, carrier: { _tag: "none" }, tokenSet: false, pushPromptDismissed: false }), "client.alerts.prompt.dismiss": dismiss }
  const { element } = await render(<NotificationPrompt onSessionExpired={vi.fn()} />)
  await settle(() => expect(button(element, "Not now")).toBeDefined())
  await click(element, "Not now")
  await settle(() => expect(button(element, "Retry dismissal")).toBeDefined())
  expect(localStorage.getItem("lgcode-phone-notifications-dismissed")).toBeNull()
  await click(element, "Retry dismissal")
  await settle(() => expect(element.querySelector("aside")).toBeNull())
  expect(dismiss.mock.calls[0]![0]).toEqual(dismiss.mock.calls[1]![0])
  expect(localStorage.getItem("lgcode-phone-notifications-dismissed")).toBe("true")
  const second = await render(<NotificationPrompt onSessionExpired={vi.fn()} />)
  expect(second.element.querySelector("aside")).toBeNull()
})

it.each(["incomplete", "held", "configured", "dismissed"])("keeps the notification offer hidden for %s state", async (state) => {
  mock.data = { ...baseData(), complete: state !== "incomplete", requests: [{ id: "question", status: "open", holder: state === "held" ? { _tag: "agent", agentId: "lead" } : { _tag: "owner" } }] }
  const read = vi.fn(() => Effect.succeed({ ...alertSettings, carrier: state === "configured" ? alertSettings.carrier : { _tag: "none" }, pushPromptDismissed: state === "dismissed" }))
  mock.client = { "client.alerts.settings": read }
  const { element } = await render(<NotificationPrompt onSessionExpired={vi.fn()} />)
  if (state === "held" || state === "incomplete") expect(read).not.toHaveBeenCalled()
  else await settle(() => expect(read).toHaveBeenCalled())
  expect(element.querySelector("aside")).toBeNull()
})

it("preserves account environment and secret references when renaming and wipes a rejected secret", async () => {
  const account = { id: "sub", harness: "codex", displayName: "Private", environment: { KEEP: "value", API_TOKEN: "secret:existing" }, secret: "secret:account" }
  const set = vi.fn((_payload: unknown) => ack())
  let secret: Redacted.Redacted<string> | undefined
  mock.client = { accounts: (payload: { operation: string }) => payload.operation === "list" ? Effect.succeed({ accounts: [account] }) : set(payload),
    "client.snapshot": () => Effect.succeed({ ...snapshot, accounts: [{ id: "sub", status: "signed-out", enabled: true, environment: [] }] }),
    harnesses: () => Effect.succeed({ harnesses: [{ id: "codex" }] }), "accounts set-secret": (payload: { value: Redacted.Redacted<string> }) => {
      secret = payload.value
      expect(Redacted.value(secret)).toBe("dummy-secret-value")
      return Effect.fail(new Error("dummy-secret-value"))
    } }
  const { element } = await render(<Subscriptions onSessionExpired={vi.fn()} />)
  await settle(() => expect(button(element, "Edit")).toBeDefined())
  await click(element, "Edit")
  element.querySelector<HTMLInputElement>('[name="secret"]')!.value = "dummy-secret-value"
  element.querySelector<HTMLInputElement>('[name="variable"]')!.value = "API_TOKEN"
  await submit(element, "Subscription secret")
  await settle(() => expect(element.textContent).toContain("unconfirmed"))
  expect(element.querySelector<HTMLInputElement>('[name="secret"]')!.value).toBe("")
  expect(() => Redacted.value(secret!)).toThrow()
  expect(element.textContent).not.toContain("dummy-secret-value")
  await click(element, "Refresh subscriptions")
  await settle(() => expect(element.querySelector<HTMLInputElement>('[name="name"]')!.disabled).toBe(false))
  element.querySelector<HTMLInputElement>('[name="name"]')!.value = "Renamed"
  await submit(element, "Subscription settings")
  await settle(() => expect(set).toHaveBeenCalledTimes(1))
  expect(set.mock.calls[0]![0]).toEqual(expect.objectContaining({ operation: "set", account: { ...account, displayName: "Renamed" } }))
})
