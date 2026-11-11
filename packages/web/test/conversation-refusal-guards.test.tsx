import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { ContextReference, EventEnvelope, type AgentId, type ChannelId, type ProjectId, type TeamId } from "@lgcode/contracts"
import { ShellDataProvider, useConversation, useShellData } from "../src/data/ShellDataProvider.tsx"
import { Composer } from "../src/thread/composer.tsx"
import { AgentTools } from "../src/thread/agentTools.tsx"
import type { ConversationEntry, ConversationIdentity, ConversationSession } from "../src/thread/conversationState.tsx"
import { adminShellClient } from "./admin-shell-client.ts"

const api = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock("@lgcode/client/browser", async () => {
  const Effect = await import("effect/Effect")
  return { connect: () => Effect.succeed(api.current) }
})
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const eventually = async (check: () => void) => vi.waitFor(async () => { await act(async () => {}); check() })
const agent = { _tag: "agent" as const, agentId: "worker" as AgentId }
const team = { _tag: "team" as const, projectId: "project" as ProjectId, teamId: "team" as TeamId, channelId: "channel" as ChannelId }
const reference = Schema.decodeUnknownSync(ContextReference)({ _tag: "task", projectId: "project", taskId: "task" })
let root: Root, container: HTMLDivElement, entry: ConversationEntry, session: ConversationSession, expire: () => void
function Probe({ identity }: { identity: ConversationIdentity }) {
  const conversation = useConversation(identity); entry = conversation.entry; session = conversation.session
  expire = useShellData().onSessionExpired
  return null
}
const render = async (children: ReactNode) => act(async () => root.render(<ShellDataProvider onSessionExpired={() => {}}>{children}</ShellDataProvider>))
const button = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) => (node.getAttribute("aria-label") ?? node.textContent) === name)!
const tap = async (name: string) => act(async () => button(name).click())
const type = async (text: string) => act(async () => {
  const field = container.querySelector("textarea")!; field.value = text; field.dispatchEvent(new Event("input", { bubbles: true }))
})
const refusal = (command: string, requestId: unknown, sequence = 8) => Schema.decodeUnknownSync(EventEnvelope)({
  sequence, eventId: `refusal-${sequence}`, occurredAt: 1, caller: { _tag: "owner" }, requestId,
  event: { _tag: "CommandRefused", command, reason: "durable refusal" },
})
beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  vi.spyOn(document, "hidden", "get").mockReturnValue(false)
  api.current = { ...adminShellClient(),
    "client.agent.configuration": () => Effect.succeed({ configuration: { status: "applied", desired: { model: "a" }, applied: { model: "a" } }, models: { source: "negotiated", options: [{ id: "a" }, { id: "b" }] }, efforts: { source: "unavailable", options: [] } }),
    "client.agent.context": () => Effect.succeed({ context: { _tag: "unavailable", reason: "not-reported" } }),
  }
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() })

const mount = async (command: "prompt" | "board.post" | "configure") => {
  const identity = command === "board.post" ? team : agent
  const screen = <><Probe identity={identity} /><Composer identity={identity} recipient="Worker" tools={command === "configure" ? <AgentTools agentId={agent.agentId} disabled={false} /> : undefined} /></>
  await render(screen)
  await type("Original complete body.")
  await act(async () => entry.update({ context: [{ reference, label: "TASK" }] }))
  return screen
}
const submit = async (command: "prompt" | "board.post" | "configure") => {
  if (command === "configure") { await tap("Model"); await tap("b") }
  else await act(async () => container.querySelector("form")!.requestSubmit())
}
const variants = ["exact", "other request", "other caller", "other command", "stale sequence", "oversized", "incomplete", "unavailable", "beyond bound", "missing anchor", "stale head"] as const
for (const command of ["prompt", "board.post", "configure"] as const) {
  it.each(variants)(`605 ${command} requires exact bounded durable refusal evidence: %s`, async (variant) => {
    const sent: Array<Record<string, unknown>> = [], reads: number[] = []
    api.current[command] = (payload: Record<string, unknown>) => { sent.push(payload); return Effect.fail({ _tag: "CommandError", reason: "command refused" }) }
    api.current["client.sequence"] = ({ requestId }: { requestId: string }) => !sent.length && variant === "missing anchor" ? Effect.fail({ _tag: "ClientError" })
      : Effect.succeed({ requestId: sent.length && variant === "stale head" ? "old-read" : requestId, sequence: sent.length ? variant === "beyond bound" ? 72 : 8 : 7 })
    api.current["client.event"] = ({ requestId, sequence }: { requestId: string; sequence: number }) => {
      reads.push(sequence)
      if (variant === "unavailable") return Effect.fail({ _tag: "CommandError", reason: "read unavailable" })
      if (variant === "oversized") return Effect.succeed({ requestId, sequence, _tag: "Oversized" })
      const envelope = refusal(command, variant === "other request" || variant === "beyond bound" && sequence !== 72 ? "another-request" : sent[0]!.requestId, sequence)
      return Effect.succeed({ requestId, envelope: {
        ...envelope,
        ...(variant === "stale sequence" ? { sequence: 7 } : {}),
        ...(variant === "other caller" ? { caller: { _tag: "agent", agentId: agent.agentId } } : {}),
        ...(variant === "other command" ? { event: { ...envelope.event, command: command === "configure" ? "prompt" : "configure" } } : {}),
        ...(variant === "incomplete" ? { event: { _tag: "CommandRefused", command } } : {}),
      } })
    }
    const screen = await mount(command)
    await submit(command)
    await eventually(() => expect(command === "configure" ? entry.state.configurationAttempt?.status : entry.state.status).not.toBe("sending"))
    expect(sent).toHaveLength(1)
    expect(entry.state.draft).toBe("Original complete body."); expect(entry.state.context).toEqual([{ reference, label: "TASK" }])
    if (variant === "exact") {
      expect(command === "configure" ? entry.state.configurationAttempt : entry.state.attempt).toBeUndefined()
      expect(command === "configure" ? entry.state.configurationMessage : entry.state.message).toContain("The engine refused")
      expect(container.textContent).not.toContain("Prompt sent."); expect(container.textContent).not.toContain("Selection recorded")
      return
    }
    const original = sent[0]!
    expect(command === "configure" ? entry.state.configurationAttempt?.status : entry.state.status).toBe("uncertain")
    expect(original).not.toHaveProperty("after"); expect(original).not.toHaveProperty("status")
    if (variant === "beyond bound") { expect(reads).toHaveLength(64); expect(reads.at(-1)).toBe(71) }
    await type("Later edited draft.")
    await render(<p>Other route</p>); await render(screen)
    if (command !== "configure") { await act(async () => container.querySelector("form")!.requestSubmit()); expect(sent).toHaveLength(1) }
    await tap(command === "configure" ? "Recover configuration" : "Recover original send")
    await eventually(() => expect(command === "configure" ? entry.state.configurationAttempt?.status : entry.state.status).toBe("uncertain"))
    expect(sent).toEqual([original, original])
    expect(entry.state.draft).toBe("Later edited draft."); expect(entry.state.context).toHaveLength(1)
    expect(command === "configure" ? entry.state.configurationAttempt?.after : entry.state.attemptAfter).toBe(variant === "missing anchor" ? undefined : 7)
  })

  it.each(["navigation", "logout", "expiry"] as const)(`605 ${command} handles late refusal evidence across %s`, async (boundary) => {
    let release!: () => void
    const pending = new Promise<void>((done) => { release = done })
    const sent: Array<Record<string, unknown>> = []
    let reading = false
    api.current[command] = (payload: Record<string, unknown>) => { sent.push(payload); return Effect.fail({ _tag: "CommandError", reason: "command refused" }) }
    api.current["client.sequence"] = ({ requestId }: { requestId: string }) => Effect.succeed({ requestId, sequence: sent.length ? 8 : 7 })
    api.current["client.event"] = ({ requestId }: { requestId: string }) => { reading = true; return Effect.promise(async () => { await pending; return { requestId, envelope: refusal(command, sent[0]!.requestId) } }) }
    const screen = await mount(command)
    await submit(command); await eventually(() => expect(reading).toBe(true))
    const old = entry
    await type("Later private edit.")
    await act(async () => entry.update({ context: [] }))
    if (boundary === "logout") await act(async () => root.render(<p>Logged out</p>))
    else if (boundary === "expiry") await act(async () => expire())
    else await render(<p>Other route</p>)
    await act(async () => release())
    if (boundary === "navigation") {
      await render(screen)
      await eventually(() => expect(command === "configure" ? old.state.configurationAttempt : old.state.attempt).toBeUndefined())
      expect(old.state.draft).toBe("Later private edit."); expect(old.state.context).toEqual([])
      expect(command === "configure" ? old.state.configurationMessage : old.state.message).toContain("The engine refused")
    } else {
      expect(session.controller.signal.aborted).toBe(true)
      expect(old.state).toMatchObject({ draft: "", context: [], status: "ready", message: "" })
      expect(old.state.configurationAttempt).toBeUndefined(); expect(old.state.attempt).toBeUndefined()
      await act(async () => root.render(<p>Fresh owner mount</p>)); await render(screen)
      expect(entry.state.draft).toBe(""); expect(entry.state.configurationMessage).toBeUndefined()
      expect(container.textContent).not.toContain("The engine refused")
    }
    expect(sent).toHaveLength(1)
  })
}
