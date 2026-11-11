import { adminShellClient } from "./admin-shell-client.ts"
import { ShellDataProvider, useConversation } from "../src/data/ShellDataProvider.tsx"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import * as Effect from "effect/Effect"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { AgentId, ContextReference, ProjectId, TeamId, ChannelId, WorkspaceId, TaskId } from "@lgcode/contracts"
import { Composer } from "../src/thread/composer.tsx"
import { conversationKey, type ConversationIdentity, type ConversationSession } from "../src/thread/conversationState.tsx"

const api = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock("@lgcode/client/browser", async () => {
  const Effect = await import("effect/Effect")
  return { connect: () => Effect.succeed(api.current) }
})
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const agent: ConversationIdentity = { _tag: "agent", agentId: "same-name-agent-a" as AgentId }
const other: ConversationIdentity = { _tag: "agent", agentId: "same-name-agent-b" as AgentId }
const team: ConversationIdentity = { _tag: "team", projectId: "p" as ProjectId, teamId: "t" as TeamId, channelId: "c" as ChannelId }
const task: ContextReference = { _tag: "task", projectId: "p" as ProjectId, taskId: "task-1" as TaskId }
let root: Root
let container: HTMLDivElement
let session: ConversationSession
const scope = { projectId: "p" as ProjectId, worktreeId: "w" as WorkspaceId }
function Screen({ identity, copies = 1 }: { identity: Exclude<ConversationIdentity, { readonly _tag: "board" }>; copies?: number }) {
  session = useConversation(identity).session
  return <>{Array.from({ length: copies }, (_, index) => <Composer key={index} identity={identity} recipient="Same name" scope={scope} />)}</>
}
const render = async (identity: Exclude<ConversationIdentity, { readonly _tag: "board" }> = agent, copies = 1) => { await act(async () => root.render(<ShellDataProvider onSessionExpired={() => {}}><Screen identity={identity} copies={copies} /></ShellDataProvider>)) }
const input = (index = 0) => container.querySelectorAll("textarea")[index]!
const type = async (text: string, index = 0) => { await act(async () => { input(index).value = text; input(index).dispatchEvent(new Event("input", { bubbles: true })) }) }
const button = (text: string) => [...container.querySelectorAll("button")].find((row) => row.textContent === text)!
const submit = async (index = 0) => { await act(async () => container.querySelectorAll("form")[index]!.requestSubmit()) }
const originalDialog = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal")
beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  api.current = { ...adminShellClient(), prompt: vi.fn(() => Effect.succeed({ deliveryId: "d" })), "board.post": vi.fn(() => Effect.succeed({ postId: "post" })) }
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } })
})
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks()
  if (originalDialog) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalDialog)
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal")
})

it("keeps independent drafts and typed context through navigation and shares simultaneous page/dock copies", async () => {
  await render(); await type("draft A")
  await act(async () => session.entry(agent).update({ context: [{ reference: task, label: "TASK-1" }], reading: { sequence: 42, offset: 8, bottom: false } }))
  await render(other); expect(input().value).toBe(""); await type("draft B")
  await render(agent, 2)
  expect(input().value).toBe("draft A"); expect(input(1).value).toBe("draft A")
  expect(session.entry(agent).state.reading).toEqual({ sequence: 42, offset: 8, bottom: false })
  expect(container.textContent).toContain("TASK-1")
  await type("changed in dock", 1); expect(input().value).toBe("changed in dock")
  expect(session.entry(other).state.draft).toBe("draft B")
  expect(conversationKey(agent)).not.toBe(conversationKey(team))
})

it.each([{ _tag: "ClientError" }, { _tag: "CommandError", reason: "database read failed" }, { _tag: "CommandError", reason: "command refused" }])("freezes an uncertain payload and recovers the exact key, body and context after edits and navigation: %j", async (failure) => {
  const send = vi.fn().mockReturnValueOnce(Effect.fail(failure)).mockReturnValue(Effect.succeed({ deliveryId: "d" }))
  api.current.prompt = send
  await render(); await type("original")
  await act(async () => session.entry(agent).update({ context: [{ reference: task, label: "TASK-1" }] }))
  await submit(); expect(container.textContent).toContain("Could not confirm")
  const original = send.mock.calls[0]![0]
  await type("new draft"); await submit(); expect(send).toHaveBeenCalledTimes(1)
  await render(other); await render(agent)
  await act(async () => button("Recover original send").click())
  expect(send).toHaveBeenCalledTimes(2); expect(send.mock.calls[1]![0]).toEqual(original)
  expect(original).toMatchObject({ text: "original", agentId: agent.agentId, context: [task] })
  expect(input().value).toBe("new draft"); expect(session.entry(agent).state.context).toHaveLength(1)
})

it("locks competing copies and keeps a send alive across navigation without clearing a newer draft", async () => {
  let resolve!: (value: object) => void
  const pending = new Promise<object>((done) => { resolve = done })
  const send = vi.fn(() => Effect.promise(() => pending)); api.current.prompt = send
  await render(agent, 2); await type("sent text")
  await submit(); await submit(1); expect(send).toHaveBeenCalledTimes(1)
  await type("newer draft", 1); await render(other)
  await act(async () => resolve({ deliveryId: "d" }))
  await render(agent); expect(input().value).toBe("newer draft"); expect(container.textContent).toContain("Prompt sent.")
})

it("discards protected state on session teardown and ignores a late send completion", async () => {
  let resolve!: (value: object) => void
  const pending = new Promise<object>((done) => { resolve = done })
  api.current.prompt = () => Effect.promise(() => pending)
  await render(); await type("private draft"); await submit()
  const entry = session.entry(agent)
  await act(async () => root.render(<p>Logged out</p>))
  expect(session.controller.signal.aborted).toBe(true)
  expect(entry.state).toMatchObject({ draft: "", context: [], status: "ready" }); expect(entry.state.attempt).toBeUndefined()
  await act(async () => resolve({ deliveryId: "late" }))
  expect(entry.state.message).toBe("")
  await render(); expect(input().value).toBe("")
})

it("sends a team message to its actual channel without reading or acknowledging as an agent", async () => {
  await render(team); await type("team direction"); await submit()
  expect(api.current["board.post"]).toHaveBeenCalledWith(expect.objectContaining({ channelId: "c", to: [], reply: "none", text: "team direction" }))
  expect(api.current.prompt).not.toHaveBeenCalled(); expect(container.textContent).toContain("Message posted.")
})

it("sends on Enter, permits Shift+Enter and protects input-method composition", async () => {
  await render(); await type("hello")
  const key = (options: KeyboardEventInit) => input().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", ...options }))
  await act(async () => { key({ shiftKey: true }); key({ isComposing: true }); key({ keyCode: 229 }) })
  expect(api.current.prompt).not.toHaveBeenCalled()
  await act(async () => { key({}) })
  expect(api.current.prompt).toHaveBeenCalledTimes(1); expect(input().value).toBe("")
})

it("searches real identities, reports truncation, cancels without losing @ and applies only the current trigger", async () => {
  const search = vi.fn(() => Effect.succeed({ result: { items: [{ reference: task, label: "<b>TASK-1</b>" }], truncated: true } }))
  api.current["project.context.search"] = search
  await render(); await type("See @")
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)) })
  expect(search).toHaveBeenCalledWith(expect.objectContaining({ ...scope, query: "", limit: 50 }))
  expect(container.textContent).toContain("Refine your search"); expect(container.querySelector("b")).toBeNull()
  await act(async () => button("Cancel").click()); expect(input().value).toBe("See @")
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Add context"]')!.click())
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)) })
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click())
  await act(async () => button("Add selected context").click())
  expect(session.entry(agent).state.context[0]?.reference).toEqual(task)
  // A button-opened picker has no authority to remove an older @ trigger.
  expect(input().value).toBe("See @")
})

it.each(["recovering", "board disabled", "invalid credential"])("keeps the original unknown send through a later explicit %s error", async (reason) => {
  const send = vi.fn().mockReturnValueOnce(Effect.fail({ _tag: "ClientError" }))
    .mockReturnValueOnce(Effect.fail({ _tag: "CommandError", reason })).mockReturnValue(Effect.succeed({ deliveryId: "d" }))
  api.current.prompt = send
  await render(); await type("original unknown body"); await submit()
  const original = send.mock.calls[0]![0]
  await type("newer unsent body")
  await act(async () => button("Recover original send").click())
  expect(session.entry(agent).state.status).toBe("uncertain")
  expect(session.entry(agent).state.attempt).toEqual(original)
  await submit(); expect(send).toHaveBeenCalledTimes(2)
  await act(async () => button("Recover original send").click())
  expect(send.mock.calls.map((row) => row[0])).toEqual([original, original, original])
  expect(input().value).toBe("newer unsent body")
})
