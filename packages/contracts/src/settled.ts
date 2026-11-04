import type { Actor, EventEnvelope, WaitMember } from "./events.ts"
import { eventEffect } from "./stateMachine.ts"
import type { PieceNamespace } from "./namespaces.ts"

export interface SettledInput {
  readonly agents: Readonly<Record<string, { readonly state: { readonly _tag: string }; readonly reloadable?: boolean }>>
  readonly requests: Readonly<Record<string, { readonly agentId: string; readonly status: string; readonly holder: Actor }>>
  readonly questions: SettledInput["requests"]
  readonly deliveries: Readonly<Record<string, { readonly target: string; readonly status: string }>>
  readonly waits: Readonly<Record<string, { readonly agentId: string; readonly status: string; readonly blocking: boolean }>>
}
export type HoldCondition = (state: SettledInput, agentId: string, pieceView: unknown) => boolean
const never = () => false
export const holdUnsettled = { client: never, board: never, roles: never } satisfies Record<PieceNamespace, HoldCondition>
export const requestHeld = { client: never, board: never, roles: never } satisfies Record<PieceNamespace, HoldCondition>
export const holds = (state: SettledInput, id: string): boolean =>
  [...Object.values(state.requests), ...Object.values(state.questions)].some((row) => row.status === "open" && row.holder._tag === "agent" && row.holder.agentId === id)
export const settled = (state: SettledInput, id: string): boolean =>
  Object.hasOwn(state.agents, id) && state.agents[id]?.state._tag === "idle"
  && !Object.values(state.deliveries).some((row) => row.target === id && (row.status === "queued" || row.status === "sent"))
  && !Object.values(state.requests).some((row) => row.status === "open" && row.agentId === id)
  && !Object.values(state.questions).some((row) => row.status === "open" && row.agentId === id)
  && !holds(state, id)
  && !Object.values(state.waits).some((row) => row.agentId === id && row.status === "open" && !row.blocking)
export const reasonOf = (state: SettledInput, id: string): WaitMember["reason"] | undefined => {
  const agent = Object.hasOwn(state.agents, id) ? state.agents[id] : undefined
  switch (agent?.state._tag) {
    case "crashed": return "crashed"
    case "stopped": return "stopped"
    case "paused": return "paused"
    case "interrupted": return agent.reloadable === true ? undefined : "interrupted"
    case "idle": return settled(state, id) ? "settled" : undefined
    default: return undefined
  }
}
export const waitSatisfied = (mode: "any" | "all", members: ReadonlyArray<string>, current: ReadonlyArray<{ readonly agentId: string }>): boolean => {
  const resolved = new Set(current.map((member) => member.agentId))
  return mode === "any" ? members.some((id) => resolved.has(id)) : members.every((id) => resolved.has(id))
}

// Fold only the bounded wait state shared by the engine and its clients.
// Records are copied with computed keys, including ids such as __proto__.
export const foldSettled = (state: SettledInput, { event }: EventEnvelope): SettledInput => {
  const update = <T>(rows: Readonly<Record<string, T>>, id: string, f: (row: T) => T) =>
    Object.hasOwn(rows, id) ? { ...rows, [id]: f(rows[id]!) } : rows
  let next = state
  if (event._tag === "AgentStarted") {
    next = { ...state, agents: { ...state.agents, [event.agentId]: { state: { _tag: "starting" } } } }
    if (event.firstPromptDelivery !== undefined) next = { ...next, deliveries: { ...next.deliveries, [event.firstPromptDelivery.id]: { target: event.agentId, status: "queued" } } }
  } else if ("agentId" in event) {
    next = { ...next, agents: update(next.agents, event.agentId, (agent) => {
      const effect = eventEffect(agent.state._tag as Parameters<typeof eventEffect>[0], event._tag)
      const tag = effect === "transition" && event._tag === "StateChanged" ? event.state._tag
        : ["starting", "working", "idle", "crashed", "stopped", "interrupted"].includes(effect) ? effect : agent.state._tag
      return { ...agent, state: { _tag: tag }, ...(event._tag === "SessionOpened" ? { reloadable: event.reloadable } : {}) }
    }) }
  }
  switch (event._tag) {
    case "PermissionRequested": return { ...next, requests: { ...next.requests, [event.permissionRequestId]: { agentId: event.agentId, holder: event.holder, status: "open" } } }
    case "PermissionMoved": return { ...next, requests: update(next.requests, event.permissionRequestId, (row) => ({ ...row, holder: event.to })) }
    case "PermissionAnswered": case "PermissionCancelled": return { ...next, requests: update(next.requests, event.permissionRequestId, (row) => ({ ...row, status: event._tag === "PermissionAnswered" ? "answered" : "cancelled" })) }
    case "QuestionAsked": return { ...next, questions: { ...next.questions, [event.questionId]: { agentId: event.agentId, holder: event.holder, status: "open" } } }
    case "QuestionMoved": return { ...next, questions: update(next.questions, event.questionId, (row) => ({ ...row, holder: event.to })) }
    case "QuestionAnswered": return { ...next, questions: update(next.questions, event.questionId, (row) => ({ ...row, status: "answered" })) }
    case "WaitOpened": return { ...next, waits: { ...next.waits, [event.waitId]: { agentId: event.agentId, blocking: event.blocking, status: "open" } } }
    case "WaitSatisfied": case "WaitCancelled": return { ...next, waits: update(next.waits, event.waitId, (row) => ({ ...row, status: event._tag === "WaitSatisfied" ? "satisfied" : "cancelled" })) }
    case "DeliveryQueued": return { ...next, deliveries: { ...next.deliveries, [event.delivery.id]: { target: event.delivery.target, status: "queued" } } }
    case "DeliverySent": case "DeliveryAccepted": case "DeliveryRequeued": case "DeliveryReturned": case "DeliveryWithdrawn": {
      const status = { DeliverySent: "sent", DeliveryAccepted: "accepted", DeliveryRequeued: "queued", DeliveryReturned: "returned", DeliveryWithdrawn: "withdrawn" }[event._tag]
      return { ...next, deliveries: update(next.deliveries, event.deliveryId, (row) => ({ ...row, status })) }
    }
    default: return next
  }
}
