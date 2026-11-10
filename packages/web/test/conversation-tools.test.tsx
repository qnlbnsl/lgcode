import { adminShellClient } from "./admin-shell-client.ts"
import { ShellDataProvider, useConversation } from "../src/data/ShellDataProvider.tsx"
import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import * as Effect from "effect/Effect"
import type { ClientEnvelope } from "@lgcode/client/browser"
import type { AgentId, ChannelId, ProjectId, TeamId } from "@lgcode/contracts"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { AgentTools } from "../src/thread/agentTools.tsx"
import { ReplyControls } from "../src/thread/replyControls.tsx"
import { TeamConversation } from "../src/thread/team.tsx"

const api = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock("@lgcode/client/browser", async () => {
  const Effect = await import("effect/Effect")
  return { connect: () => Effect.succeed(api.current) }
})
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const agentId = "a" as AgentId
let root: Root, container: HTMLDivElement
const render = async (children: ReactNode) => { await act(async () => root.render(<ShellDataProvider onSessionExpired={() => {}}>{children}</ShellDataProvider>)) }
const button = (name: string) => [...container.querySelectorAll("button")].find((node) => (node.getAttribute("aria-label") ?? node.textContent) === name)!
const item = (sequence: number, event: object) => ({ sequence, event: { agentId, ...event } }) as ClientEnvelope
beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  vi.spyOn(document, "hidden", "get").mockReturnValue(false)
  api.current = adminShellClient()
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() })

it("uses advertised choice IDs and waits for real applied evidence, including zero context usage", async () => {
  let configuration = { status: "pending", desired: { model: "model-b", effort: "low" }, applied: { model: "model-a", effort: "low" } }
  const configure = vi.fn(() => Effect.succeed({})); api.current.configure = configure
  api.current["client.agent.configuration"] = () => Effect.succeed({ configuration, models: { source: "negotiated", options: [{ id: "model-a", label: "Readable model A" }, { id: "model-b", label: "Readable model B" }] }, efforts: { source: "unavailable", options: [] } })
  api.current["client.agent.context"] = () => Effect.succeed({ context: { _tag: "available", used: 0, window: 200, percent: 0, reportedAt: 1 } })
  await render(<AgentTools agentId={agentId} disabled={false} />)
  expect(container.textContent).toContain("0% context"); expect(container.textContent).toContain("Configuration: pending")
  expect(container.textContent).toContain("Applied model: model-a")
  expect(button("Effort").disabled).toBe(true)
  await act(async () => button("Model").click())
  expect(document.activeElement?.textContent).toBe("Readable model B")
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })))
  expect(document.activeElement?.textContent).toBe("Readable model A")
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
  expect(container.querySelector('[role="menu"]')).toBeNull(); expect(document.activeElement).toBe(button("Model"))
  await act(async () => button("Model").click())
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })))
  await act(async () => (document.activeElement as HTMLButtonElement).click())
  expect(configure).toHaveBeenCalledWith(expect.objectContaining({ agentId, model: "model-a" }))
  expect(configure.mock.calls[0]).not.toContain("Readable model A")
  expect(container.textContent).toContain("Configuration: pending")
  configuration = { status: "applied", desired: { model: "model-a", effort: "low" }, applied: { model: "model-a", effort: "low" } }
  await act(async () => button("Refresh configuration").click())
  expect(container.textContent).toContain("Configuration: applied")
})

it("does not expose the previous agent's settings while the next agent read is pending", async () => {
  api.current["client.agent.configuration"] = ({ agentId: id }: { agentId: AgentId }) => id === agentId
    ? Effect.succeed({ configuration: { status: "applied", desired: { model: "private-old-model" }, applied: { model: "private-old-model" } }, models: { source: "negotiated", options: [{ id: "private-old-model" }] }, efforts: { source: "unavailable", options: [] } }) : Effect.never
  api.current["client.agent.context"] = () => Effect.succeed({ context: { _tag: "available", used: 50, window: 100, percent: 50, reportedAt: 1 } })
  await render(<AgentTools agentId={agentId} disabled={false} />)
  expect(button("Model").textContent).toContain("private-old-model")
  await render(<AgentTools agentId={"next-agent" as AgentId} disabled={false} />)
  expect(container.textContent).not.toContain("private-old-model"); expect(container.textContent).not.toContain("50%")
  expect(button("Model").disabled).toBe(true)
})

it.each([{ _tag: "ClientError" }, { _tag: "CommandError", reason: "database write failed" }])("retains an uncertain configuration key across navigation and recovers it explicitly: %j", async (failure) => {
  const configure = vi.fn().mockReturnValueOnce(Effect.fail(failure)).mockReturnValue(Effect.succeed({})); api.current.configure = configure
  api.current["client.agent.configuration"] = () => Effect.succeed({ configuration: { status: "pending", desired: { model: "a" } }, models: { source: "configured", options: [{ id: "a" }, { id: "b" }] }, efforts: { source: "unavailable", options: [] } })
  api.current["client.agent.context"] = () => Effect.succeed({ context: { _tag: "unavailable", reason: "not-reported" } })
  await render(<AgentTools agentId={agentId} disabled={false} />)
  await act(async () => button("Model").click())
  await act(async () => button("b").click())
  expect(container.textContent).toContain("Could not confirm")
  const original = configure.mock.calls[0]![0]
  await render(<p>Other page</p>); await render(<AgentTools agentId={agentId} disabled={false} />)
  await act(async () => button("Recover configuration").click())
  expect(configure.mock.calls[1]![0]).toEqual(original)
  expect(container.textContent).toContain("Context unavailable")
})

it("paginates owner peek only and retains readable team messages when a later page fails", async () => {
  const post = { postId: "post", channelId: "channel", sequence: 1, author: { _tag: "agent", agentId }, text: "<b>literal team text</b>", status: "closed", to: [], reply: "none", acknowledged: [], dispositions: [] }
  const peek = vi.fn().mockReturnValueOnce(Effect.succeed({ items: [post], next: "cursor" })).mockReturnValueOnce(Effect.succeed({ items: [{ ...post, postId: "post-2", sequence: 2, text: "Second page" }] })).mockReturnValue(Effect.fail({ _tag: "CommandError" }))
  api.current["board.peek"] = peek
  const read = vi.fn(), ack = vi.fn(); api.current["board.read"] = read; api.current["board.acknowledge"] = ack
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  const view = <TeamConversation projectId={"p" as ProjectId} teamId={"t" as TeamId} channelId={"channel" as ChannelId} name="Build" disabled={false} onSessionExpired={() => {}} />
  await render(view)
  expect(container.textContent).toContain("Second page"); expect(container.querySelector("b")).toBeNull()
  expect(peek.mock.calls[1]![0]).toMatchObject({ after: "cursor", channelId: "channel" }); expect(read).not.toHaveBeenCalled(); expect(ack).not.toHaveBeenCalled()
  await act(async () => button("Refresh conversation").click())
  expect(container.textContent).toContain("Reconnecting"); expect(container.textContent).toContain("Second page")
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Send message"]')!.disabled).toBe(true)
  vi.unstubAllGlobals()
})

it("keeps Resume's original key and fresh policy through a generic error, changed reloadability and navigation", async () => {
  const resume = vi.fn().mockReturnValueOnce(Effect.fail({ _tag: "CommandError", reason: "database write failed" })).mockReturnValue(Effect.succeed({}))
  api.current.resume = resume
  const base = { agentId, state: { _tag: "stopped" }, session: { _tag: "acp", sessionId: "old" }, reloadable: false } as unknown as import("@lgcode/contracts").ClientSnapshot["agents"][number]
  const { Lifecycle } = await import("../src/thread/lifecycle.tsx")
  await render(<Lifecycle agent={base} signal={new AbortController().signal} />)
  await act(async () => button("Resume agent").click())
  expect(container.textContent).toContain("Could not confirm")
  const original = resume.mock.calls[0]![0]
  expect(original).toMatchObject({ agentId, fresh: true })
  await render(<p>Other route</p>)
  await render(<Lifecycle agent={{ ...base, reloadable: true }} signal={new AbortController().signal} />)
  await act(async () => button("Resume agent").click())
  expect(resume.mock.calls[1]![0]).toEqual(original)
})
