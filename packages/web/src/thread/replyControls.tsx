import { useConversation } from "../data/ShellDataProvider.tsx"
import type { ClientEnvelope } from "@lgcode/client/browser"
import type { AgentId } from "@lgcode/contracts"
import * as Effect from "effect/Effect"
import { requestId, withClient } from "./client.ts"


export function activeReply(items: ReadonlyArray<ClientEnvelope>, agentId: AgentId) {
  let current: { sequence: number; deliveryId: string } | undefined
  for (const item of [...items].sort((a, b) => a.sequence - b.sequence)) {
    const event = item.event
    if (!("agentId" in event) || event.agentId !== agentId) continue
    if (event._tag === "DeliverySent") current = { sequence: item.sequence, deliveryId: event.deliveryId }
    else if (event._tag === "StateChanged" && event.state._tag !== "working") current = undefined
    else if (["TurnEnded", "AgentStopped", "AgentInterrupted", "AgentCrashed", "AgentReloadFailed"].includes(event._tag)
      || (event._tag === "DeliveryReturned" || event._tag === "DeliveryRequeued") && event.deliveryId === current?.deliveryId) current = undefined
  }
  return current
}
export function ReplyControls({ agentId, items, disabled, compact = false }: { readonly agentId: AgentId; readonly items: ReadonlyArray<ClientEnvelope>; readonly disabled: boolean; readonly compact?: boolean }) {
  const { state, entry, session } = useConversation({ _tag: "agent", agentId })
  const active = activeReply(items, agentId)
  const cancel = async () => {
    if (disabled || !active || session.controller.signal.aborted || entry.state.cancelAttempt?.status === "sending" || entry.state.cancelAttempt?.status === "waiting") return
    const attempt = entry.state.cancelAttempt ?? { requestId: requestId(), sentSequence: active.sequence, status: "sending" as const }
    if (attempt.sentSequence !== active.sequence) return
    entry.update({ cancelAttempt: { ...attempt, status: "sending" }, cancelMessage: "" })
    try {
      const result = await withClient((client) => Effect.result(client["cancel-reply"]({ requestId: attempt.requestId, agentId })), session.controller.signal)
      if (session.controller.signal.aborted || entry.state.cancelAttempt?.sentSequence !== attempt.sentSequence) return
      if (result._tag === "Failure") {
        entry.update({ cancelAttempt: { ...attempt, status: "uncertain" }, cancelMessage: "Could not confirm the stop request." })
      } else entry.update({ cancelAttempt: { ...attempt, status: "waiting" }, cancelMessage: "Stop requested. Waiting for the turn to end." })
    } catch { if (!session.controller.signal.aborted && entry.state.cancelAttempt?.sentSequence === attempt.sentSequence) entry.update({ cancelAttempt: { ...attempt, status: "uncertain" }, cancelMessage: "Could not confirm the stop request." }) }
  }
  return <div className="reply-controls">
    {active && <button type="button" disabled={disabled || state.cancelAttempt?.status === "sending" || state.cancelAttempt?.status === "waiting"} onClick={() => { void cancel() }}>
      {state.cancelAttempt?.status === "uncertain" ? "Recover stop reply" : "Stop reply"}</button>}
    {state.cancelMessage && <p role="status" className={compact ? "visually-hidden" : undefined}>{state.cancelMessage}</p>}
  </div>
}
