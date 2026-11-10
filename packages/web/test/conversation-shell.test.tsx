import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { App } from "../src/app.tsx"
import { adminShellClient } from "./admin-shell-client.ts"

const api = vi.hoisted(() => ({ client: {} as Record<string, unknown> }))
vi.mock("@lgcode/client/browser", async () => { const Effect = await import("effect/Effect"); return { connect: () => Effect.succeed(api.client) } })
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const agent = (agentId: string, name: string) => ({ agentId, name, role: "lead", groups: [], parent: { _tag: "owner" }, state: { _tag: "idle" }, displayedState: "Idle", openPermissionRequests: 0, openQuestionsAsked: 0, harness: "codex", account: "default", permission: "ask", folder: "/work", startedAt: 1 })
const snapshot = { sequence: 7, agents: [agent("lead", "Lead"), agent("worker", "Worker")], requests: [], questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0, project: {
  sequence: 7, truncated: false, repositories: [{ repoId: "r", name: "Repository", path: "/work" }],
  projects: [{ projectId: "p", repoId: "r", name: "Project", goal: "Build", leadAgentId: "lead", worktreeId: "w", machineId: "local" }],
  workspaces: [{ worktreeId: "w", repoId: "r", branch: "main", path: "/work", machineId: "local" }],
  teams: [{ projectId: "p", teamId: "t", name: "Team", worktreeId: "w", channelId: "team-channel" }],
  agents: [{ agentId: "lead", projectId: "p", status: "Ready" }, { agentId: "worker", projectId: "p", status: "Ready" }], tasks: [], sprints: []
} }
let root: Root, container: HTMLDivElement
let width = 1440
const media = new Set<{ query: string; callback: () => void }>()
const matches = (query: string) => query.includes("min-width:1801") ? width >= 1801 : query.includes("max-width:1100") ? width <= 1100 : query.includes("max-width:700") ? width <= 700 : false
const viewport = async (next: number) => { width = next; vi.stubGlobal("innerWidth", width); await act(async () => { for (const row of media) row.callback() }) }
const button = (name: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!
const input = () => container.querySelector<HTMLTextAreaElement>("textarea")!
const type = async (text: string) => { await act(async () => { input().value = text; input().dispatchEvent(new Event("input", { bubbles: true })) }) }
const navigate = async (hash: string) => { await act(async () => { history.pushState(null, "", hash); window.dispatchEvent(new PopStateEvent("popstate")) }) }
const eventually = async (check: () => void) => { for (let count = 0; ; count++) { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) }); try { check(); return } catch (error) { if (count > 150) throw error } } }
const mount = async (hash: string) => { history.replaceState(null, "", hash); await act(async () => root.render(<App />)); await eventually(() => expect(container.querySelector('[aria-label="Workspace tabs"]')).not.toBeNull()) }
beforeEach(() => {
  width = 1440; localStorage.clear(); media.clear()
  vi.stubGlobal("innerWidth", width)
  vi.stubGlobal("matchMedia", (query: string) => ({ get matches() { return matches(query) }, addEventListener: (_name: string, callback: () => void) => media.add({ query, callback }), removeEventListener: (_name: string, callback: () => void) => { for (const row of media) if (row.callback === callback) media.delete(row) } }))
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  vi.spyOn(document, "hidden", "get").mockReturnValue(false)
  api.client = { ...adminShellClient(), "client.snapshot": () => Effect.succeed(snapshot), "client.subscribe": () => Stream.never,
    "client.thread": () => Effect.succeed({ items: [] }), "board.peek": vi.fn(() => Effect.succeed({ items: [] })),
    "board.post": vi.fn(() => Effect.succeed({})), prompt: vi.fn(() => Effect.succeed({})),
    "client.agent.configuration": () => Effect.succeed({ configuration: { status: "applied", desired: { model: "a" }, applied: { model: "a" } }, models: { source: "configured", options: [{ id: "a", label: "Model A" }] }, efforts: { source: "unavailable", options: [] } }),
    "client.agent.context": () => Effect.succeed({ context: { _tag: "unavailable", reason: "not-reported" } }),
    "project.changes": () => Effect.succeed({ result: { items: [{ path: "actual.txt", status: "modified" }], truncated: false } }) }
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); history.replaceState(null, "", "/") })

it("shares actual agent drafts between dock and full page and remembers a visited assigned worker", async () => {
  await mount("/#/project/p/board")
  await eventually(() => expect(input()?.getAttribute("aria-label")).toBe("Message Lead"))
  await type("lead draft")
  await act(async () => [...container.querySelectorAll<HTMLAnchorElement>('[role="tab"]')].find((tab) => tab.textContent === "Chat")!.click())
  expect(location.hash).toBe("#/thread/lead"); expect(input().value).toBe("lead draft")
  await navigate("/#/thread/worker"); await type("worker draft")
  await navigate("/#/project/p/board")
  expect(input().getAttribute("aria-label")).toBe("Message Worker"); expect(input().value).toBe("worker draft")
  await act(async () => button("Conversation with Worker").click())
  expect(container.querySelector("textarea")).toBeNull()
  await act(async () => button("Conversation with Worker").click())
  expect(input().value).toBe("worker draft")
  await navigate("/#/thread/lead"); expect(input().value).toBe("lead draft")
  expect(Object.values(localStorage).join(" ")).not.toContain("draft")
})

it("shares team dock/page state, posts only to the actual team channel, and reports an absent channel", async () => {
  await mount("/#/project/p/team/t/board")
  await eventually(() => expect(input()?.getAttribute("aria-label")).toBe("Message Team"))
  await type("team draft")
  await act(async () => [...container.querySelectorAll<HTMLAnchorElement>('[role="tab"]')].find((tab) => tab.textContent === "Chat")!.click())
  expect(location.hash).toBe("#/project/p/team/t/chat"); expect(input().value).toBe("team draft")
  await act(async () => input().form!.requestSubmit())
  expect(api.client["board.post"]).toHaveBeenCalledWith(expect.objectContaining({ channelId: "team-channel", text: "team draft", to: [], reply: "none" }))
  expect(api.client.prompt).not.toHaveBeenCalled()
  await type("kept team draft"); await navigate("/#/project/p/team/t/board"); expect(input().value).toBe("kept team draft")
  const noChannel = { ...snapshot, project: { ...snapshot.project, teams: [{ ...snapshot.project.teams[0]!, channelId: undefined }] } }
  api.client["client.snapshot"] = () => Effect.succeed(noChannel)
  await act(async () => button("Reconnect now").click())
  await eventually(() => expect(container.textContent).toContain("This team's chat channel is unavailable."))
  expect(container.querySelector("textarea")).toBeNull()
})

it("contains compact dock focus, lets a nested model menu own Escape, and returns focus to its opener", async () => {
  await viewport(390); await mount("/#/project/p/board")
  const opener = button("Conversation with Lead")
  expect(opener.getAttribute("aria-expanded")).toBe("false")
  await act(async () => { opener.focus(); opener.click() })
  const dock = container.querySelector<HTMLElement>("#conversation-dock")!
  expect(dock.getAttribute("aria-modal")).toBe("true"); expect(dock.contains(document.activeElement)).toBe(true)
  expect(container.querySelector(".view-body")!.hasAttribute("inert")).toBe(true)
  expect(container.querySelector(".sidebar")!.hasAttribute("inert")).toBe(true)
  await eventually(() => expect(button("Model").disabled).toBe(false))
  await act(async () => button("Model").click())
  expect(document.activeElement?.getAttribute("role")).toBe("menuitemradio")
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })))
  expect(container.querySelector('[role="menu"]')).toBeNull(); expect(dock.hidden).toBe(false); expect(document.activeElement).toBe(button("Model"))
  await act(async () => button("Model").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })))
  expect(dock.hidden).toBe(true); expect(document.activeElement).toBe(opener)
})

it("keeps Git closed below the wide threshold, bounds width preferences and shows real context beside a wide chat", async () => {
  await mount("/#/project/p/git")
  const dock = container.querySelector<HTMLElement>("#conversation-dock")!
  expect(dock.hidden).toBe(true)
  await act(async () => button("Conversation with Lead").click()); expect(dock.hidden).toBe(false)
  const resize = container.querySelector<HTMLElement>('[aria-label="Resize the thread panel"]')!
  for (let n = 0; n < 30; n++) await act(async () => resize.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })))
  expect(localStorage.getItem("lgcode-layout-lead")).toBe("600")
  for (let n = 0; n < 30; n++) await act(async () => resize.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })))
  expect(localStorage.getItem("lgcode-layout-lead")).toBe("320")
  expect(container.querySelector<HTMLElement>(".app")!.style.getPropertyValue("--lead-width")).toBe("320px")
  await viewport(2560); await navigate("/#/thread/lead")
  await eventually(() => expect(container.querySelector('[aria-label="Task and changes"]')?.textContent).toContain("actual.txt"))
  expect(container.querySelector('[aria-label="Task and changes"]')?.textContent).toContain("No sprints in flight.")
  await navigate("/#/project/p/terminal"); expect(container.querySelector<HTMLElement>("#conversation-dock")!.hidden).toBe(false)
  expect(container.querySelector(".pending-page")?.textContent).toContain("Terminal")
})

it.each([["idle", "Idle"], ["working", "Working"], ["stopped", "Stopped"]] as const)("activity states: renders the actual %s state as %s", async (state, label) => {
  api.client["client.snapshot"] = () => Effect.succeed({ ...snapshot,
    agents: [{ ...agent("worker", "Worker"), role: "builder", state: { _tag: state }, displayedState: label }] })
  await mount("/#/thread/worker")
  await eventually(() => expect(container.querySelector('.conversation-heading [aria-label="Agent activity"]')?.textContent).toBe(label))
  expect(container.querySelector(".conversation-role")?.textContent).toBe("builder")
})

it("parity: shows the actual agent role and activity independently of connection state", async () => {
  const value = { ...snapshot, agents: [{ ...agent("worker", "<script>Worker</script>"), role: "builder", state: { _tag: "working" }, displayedState: "Working" }] }
  api.client["client.snapshot"] = () => Effect.succeed(value)
  await mount("/#/thread/worker")
  await eventually(() => expect(input()?.getAttribute("aria-label")).toBe("Message <script>Worker</script>"))
  const heading = container.querySelector(".conversation-heading")!
  expect(heading.querySelector("h2")?.textContent).toBe("<script>Worker</script>")
  expect(heading.textContent).toContain("builder")
  expect(heading.querySelector('[aria-label="Agent activity"]')?.textContent).toBe("Working")
  expect(heading.querySelector("script")).toBeNull()
  await act(async () => window.dispatchEvent(new Event("offline")))
  expect(heading.querySelector('[aria-label="Agent activity"]')?.textContent).toBe("Working")
  expect(container.querySelector(".connection-details")?.textContent).toContain("Offline")
  expect(button("Send prompt").disabled).toBe(true)
  expect(input().disabled).toBe(false)
  await type("Editable offline draft")
  expect(input().value).toBe("Editable offline draft")
  await act(async () => input().form!.requestSubmit())
  expect(api.client.prompt).not.toHaveBeenCalled()
  expect(input().value).toBe("Editable offline draft")
})

it("parity: counts the real project team's open requests for its lead without making held requests owner attention", async () => {
  const value = { ...snapshot, agents: [agent("lead", "Lead"), { ...agent("worker", "Worker"), parent: { _tag: "agent", agentId: "lead" }, groups: ["team:p/t"], openPermissionRequests: 1, openQuestionsAsked: 1 }],
    project: { ...snapshot.project, agents: [...snapshot.project.agents, { agentId: "foreign", projectId: "other", status: "Needs you" }] } }
  api.client["client.snapshot"] = () => Effect.succeed(value)
  const rows = [
    { kind: "permission", id: "approval", agentId: "worker", holder: { _tag: "owner" }, status: "open", sourceSequence: 2, openedAt: 1, canAnswer: true },
    { kind: "question", id: "held", agentId: "worker", holder: { _tag: "agent", agentId: "lead" }, status: "open", sourceSequence: 3, openedAt: 2, canAnswer: false },
    { kind: "question", id: "closed", agentId: "worker", holder: { _tag: "owner" }, status: "answered", sourceSequence: 4, openedAt: 3, canAnswer: false },
    { kind: "question", id: "elsewhere", agentId: "foreign", holder: { _tag: "agent", agentId: "foreign-lead" }, status: "open", sourceSequence: 5, openedAt: 4, canAnswer: false }
  ]
  api.client["client.requests"] = () => Effect.succeed({ sequence: 7, items: rows })
  await mount("/#/thread/lead")
  await eventually(() => expect(input()?.disabled).toBe(false))
  const heading = container.querySelector(".conversation-heading")!
  expect(heading.textContent).toContain("lead")
  expect(heading.querySelector('[aria-label="Agent activity"]')?.textContent).toBe("Waiting on 2 requests")
  expect(container.querySelector(".conversation-busy")?.textContent).toBe("Waiting on 2 requests")
  expect(button("1 items need attention")).not.toBeNull()
  expect(button("2 items need attention")).toBeNull()
  await navigate("/#/")
  expect(container.querySelector('[aria-label="Needs attention"]')?.textContent ?? container.textContent).not.toContain("elsewhere")
})

it("parity: shows current team membership from the real roster and project identity without consuming board reads", async () => {
  const worker = { ...agent("worker", "Worker"), role: "builder", groups: ["team:p/t"] }
  let value = { ...snapshot, agents: [agent("lead", "Lead"), worker, { ...agent("foreign", "Other team worker"), groups: ["team:other/t"] }], project: { ...snapshot.project,
    teams: [...snapshot.project.teams, { projectId: "other", teamId: "t", name: "Other team", worktreeId: "other-w", channelId: "other-channel" }],
    agents: [...snapshot.project.agents, { agentId: "foreign", projectId: "other", status: "Ready" }] } }
  api.client["client.snapshot"] = () => Effect.succeed(value)
  const consuming = vi.fn(() => Effect.succeed({}))
  api.client["board.read"] = consuming; api.client["board.ack"] = consuming
  await mount("/#/project/p/team/t/chat")
  await eventually(() => expect(input()?.getAttribute("aria-label")).toBe("Message Team"))
  expect(container.querySelector(".conversation-heading")?.textContent).toContain("1 agent")
  expect(container.querySelector(".conversation-heading")?.textContent).not.toContain("2 agents")
  value = { ...value, agents: [...value.agents, { ...worker, agentId: "joined", name: "Joined worker" }], project: { ...value.project, agents: [...value.project.agents, { agentId: "joined", projectId: "p", status: "Ready" }] } }
  await act(async () => button("Reconnect now").click())
  await eventually(() => expect(container.querySelector(".conversation-heading")?.textContent).toContain("2 agents"))
  value = { ...value, agents: value.agents.map((row) => row.agentId === "worker" ? { ...row, groups: [] } : row) }
  await act(async () => button("Reconnect now").click())
  await eventually(() => expect(container.querySelector(".conversation-heading")?.textContent).toContain("1 agent"))
  expect(api.client["board.peek"]).toHaveBeenCalledWith(expect.objectContaining({ channelId: "team-channel" }))
  expect(consuming).not.toHaveBeenCalled()
  expect(api.client["board.post"]).not.toHaveBeenCalled()
})

it("parity: puts the sole desktop panel toggle beside the tabs and opens the full conversation through Chat", async () => {
  await mount("/#/project/p/board")
  await eventually(() => expect(input()?.getAttribute("aria-label")).toBe("Message Lead"))
  const opener = button("Conversation with Lead"), tabs = container.querySelector('[aria-label="Workspace tabs"]')!
  expect(tabs.closest(".workspace-tab-row")?.contains(opener)).toBe(true)
  expect(opener.previousElementSibling?.contains(tabs)).toBe(true)
  const dock = container.querySelector<HTMLElement>("#conversation-dock")!
  expect(dock.hidden).toBe(false)
  expect(dock.querySelector('[aria-label="Close the thread"]')).toBeNull()
  expect(dock.querySelector(".conversation-dock-heading a")).toBeNull()
  await type("kept through the sole toggle")
  await act(async () => opener.click()); expect(dock.hidden).toBe(true)
  await act(async () => opener.click()); expect(dock.hidden).toBe(false)
  expect(input().value).toBe("kept through the sole toggle")
  await act(async () => [...container.querySelectorAll<HTMLAnchorElement>('[role="tab"]')].find((tab) => tab.textContent === "Chat")!.click())
  expect(location.hash).toBe("#/thread/lead")
  expect(container.querySelector("#conversation-dock")).toBeNull()
  expect(input().value).toBe("kept through the sole toggle")
})

it("parity: keeps the compact drawer close control at 1100 pixels and removes it at 1101", async () => {
  await viewport(1100); await mount("/#/project/p/board")
  const opener = button("Conversation with Lead")
  await act(async () => { opener.focus(); opener.click() })
  const dock = container.querySelector<HTMLElement>("#conversation-dock")!
  expect(dock.getAttribute("aria-modal")).toBe("true")
  expect(dock.contains(document.activeElement)).toBe(true)
  expect(button("Close the thread")).not.toBeNull()
  expect(dock.querySelector(".conversation-dock-heading a")).toBeNull()
  await act(async () => button("Close the thread").click())
  expect(dock.hidden).toBe(true); expect(document.activeElement).toBe(opener)
  await viewport(1101)
  await act(async () => opener.click())
  expect(dock.getAttribute("aria-modal")).toBeNull()
  expect(button("Close the thread")).toBeNull()
  expect(container.querySelector(".view-body")!.hasAttribute("inert")).toBe(false)
})
