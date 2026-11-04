import type { AgentId } from "../ids.ts"
import type { EventEnvelope } from "../events.ts"

export const rolesAlertTitles = {
  "roles.stall": "An agent needs attention",
  "roles.replace": "An agent needs replacement",
  "roles.runaway": "An agent has run past its limit",
} as const
export type RolesAlertKind = keyof typeof rolesAlertTitles
export type RolesAlertChange =
  | { readonly action: "raise"; readonly kind: RolesAlertKind; readonly key: string; readonly agentId: AgentId }
  | { readonly action: "end"; readonly kind: RolesAlertKind; readonly key: string }

const keyFor = (kind: RolesAlertKind, agentId: AgentId) => `${kind.slice("roles.".length)}:${agentId}`
const raise = ({ event }: EventEnvelope): RolesAlertChange | undefined => {
  let kind: RolesAlertKind
  switch (event._tag) {
    case "roles.StallSeen":
    case "roles.TeamIdleReported": kind = "roles.stall"; break
    case "roles.ReplaceAdvised": kind = "roles.replace"; break
    case "roles.RunawayReported": kind = "roles.runaway"; break
    case "roles.GaveUp":
      if (event.engineAlertOpen || (event.noticeRecipient !== "owner" && event.notice !== "board-off")) return
      return { action: "raise", kind: "roles.stall", key: keyFor("roles.stall", event.agentId), agentId: event.agentId }
    default: return
  }
  if (event.noticeRecipient !== "owner") return
  return { action: "raise", kind, key: keyFor(kind, event.agentId), agentId: event.agentId }
}
const end = (kind: RolesAlertKind, tags: ReadonlyArray<string>) => ({ event }: EventEnvelope): RolesAlertChange | undefined =>
  tags.includes(event._tag) && "agentId" in event
    ? { action: "end", kind, key: keyFor(kind, event.agentId) } : undefined

export const rolesAlertSources: ReadonlyArray<(envelope: EventEnvelope) => RolesAlertChange | undefined> = [
  raise,
  end("roles.stall", ["roles.StallEnded", "AgentStopped"]),
  end("roles.replace", ["AgentStopped"]),
  end("roles.runaway", ["TurnEnded", "AgentStopped"]),
]
