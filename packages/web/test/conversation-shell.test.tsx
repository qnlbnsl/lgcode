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
  await act(async () => container.querySelector<HTMLAnchorElement>('.conversation-dock-heading a')!.click())
  expect(location.hash).toBe("#/thread/lead"); expect(input().value).toBe("lead draft")
  await navigate("/#/thread/worker"); await type("worker draft")
  await navigate("/#/project/p/board")
  expect(input().getAttribute("aria-label")).toBe("Message Worker"); expect(input().value).toBe("worker draft")
  await act(async () => button("Close the thread").click())
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
  await act(async () => container.querySelector<HTMLAnchorElement>('.conversation-dock-heading a')!.click())
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
