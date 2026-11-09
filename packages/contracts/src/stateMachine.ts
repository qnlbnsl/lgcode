import * as Schema from "effect/Schema"
import { projectEventTags } from "./project/events.ts"
import { boardEventTags } from "./board/events.ts"
import { clientEventTags } from "./client/events.ts"
import type { Event } from "./events.ts"
import { EpochMilliseconds } from "./ids.ts"

export const lifecycleStateNames = ["starting", "working", "idle", "paused", "interrupted", "crashed", "stopped"] as const
type StateName = typeof lifecycleStateNames[number]
export const LifecycleState = Schema.Union([
  Schema.TaggedStruct("starting", {}),
  Schema.TaggedStruct("working", {}),
  Schema.TaggedStruct("idle", {}),
  Schema.TaggedStruct("paused", {
    reason: Schema.Literals(["limit", "signed-out"]),
    midTurn: Schema.Boolean,
    // Epoch milliseconds, logged so pause timers can be rebuilt after restart.
    resetAt: Schema.optionalKey(EpochMilliseconds)
  }),
  Schema.TaggedStruct("interrupted", { previous: Schema.Literals(["starting", "working", "idle"]) }),
  Schema.TaggedStruct("crashed", {}),
  Schema.TaggedStruct("stopped", {})
])
export type LifecycleState = typeof LifecycleState.Type

export const DisplayedState = Schema.Literals([
  "Stopped", "Crashed", "Interrupted", "Signed out", "Paused for a limit", "Starting",
  "Waiting on a permission", "Waiting on an answer", "Working", "Idle"
])
export type DisplayedState = typeof DisplayedState.Type

export function displayedState(input: {
  readonly state: LifecycleState
  readonly openPermissionRequests: number
  readonly openQuestionsAsked: number
}): DisplayedState {
  switch (input.state._tag) {
    case "stopped": return "Stopped"
    case "crashed": return "Crashed"
    case "interrupted": return "Interrupted"
    case "paused": return input.state.reason === "signed-out" ? "Signed out" : "Paused for a limit"
    case "starting": return "Starting"
    case "working":
    case "idle":
      if (input.openPermissionRequests > 0) return "Waiting on a permission"
      if (input.openQuestionsAsked > 0) return "Waiting on an answer"
      return input.state._tag === "working" ? "Working" : "Idle"
  }
}

type Command = "prompt" | "compact" | "resume" | "stop" | "group"
type Outcome = "allowed" | "queued" | "refused"
// Rows 24, 53 and 62, with the remaining cells confirmed by the lead.
const commandTable: Record<StateName, Record<Command, Outcome>> = {
  starting: { prompt: "queued", compact: "refused", resume: "refused", stop: "allowed", group: "allowed" },
  working: { prompt: "queued", compact: "refused", resume: "refused", stop: "allowed", group: "allowed" },
  idle: { prompt: "allowed", compact: "allowed", resume: "refused", stop: "allowed", group: "allowed" },
  paused: { prompt: "queued", compact: "refused", resume: "refused", stop: "allowed", group: "allowed" },
  interrupted: { prompt: "queued", compact: "refused", resume: "allowed", stop: "allowed", group: "allowed" },
  crashed: { prompt: "refused", compact: "refused", resume: "allowed", stop: "allowed", group: "allowed" },
  stopped: { prompt: "refused", compact: "refused", resume: "allowed", stop: "refused", group: "allowed" }
}
export const commandOutcome = (state: StateName, command: Command): Outcome => commandTable[state][command]

const transitions: Record<StateName, ReadonlyArray<StateName>> = {
  starting: ["idle", "paused", "interrupted", "crashed", "stopped"],
  working: ["idle", "paused", "interrupted", "crashed", "stopped"],
  idle: ["working", "paused", "interrupted", "crashed", "stopped"],
  paused: ["starting", "idle", "working", "crashed", "stopped", "paused"],
  // Row 66 commits the post-reload state directly after successful recovery.
  interrupted: ["starting", "idle", "working", "stopped"],
  crashed: ["starting", "stopped"],
  stopped: ["starting"]
}
export const canTransition = (from: StateName, to: StateName): boolean => transitions[from].includes(to)

type EventEffect = "invalid" | "keep" | "transition" | StateName
const allStates = (effect: EventEffect): Record<StateName, EventEffect> => ({
  starting: effect, working: effect, idle: effect, paused: effect, interrupted: effect, crashed: effect, stopped: effect
})
// Piece events cannot change the engine's lifecycle.
export const keepInEveryState = <const T extends ReadonlyArray<string>>(tags: T): Record<T[number], Record<StateName, EventEffect>> =>
  Object.fromEntries(tags.map((tag) => [tag, allStates("keep")])) as Record<T[number], Record<StateName, EventEffect>>
// Explicit keys make every new event require a decision for all seven states.
const eventTable: Record<Event["_tag"], Record<StateName, EventEffect>> = {
  ...keepInEveryState(boardEventTags),
  ...keepInEveryState(projectEventTags),
  ...keepInEveryState(clientEventTags),
  ...keepInEveryState(rolesEventTags),
  AgentStarted: allStates("invalid"),
  AgentStartFailed: { ...allStates("invalid"), starting: "stopped" },
  SessionOpened: { ...allStates("invalid"), starting: "idle" },
  PromptSent: allStates("keep"),
  ThreadItem: allStates("keep"),
  TurnStarted: { ...allStates("invalid"), working: "keep" },
  TurnEnded: { ...allStates("invalid"), working: "idle" },
  StateChanged: allStates("transition"),
  ModeChanged: allStates("keep"),
  ModeRefused: allStates("keep"),
  PermissionRequested: allStates("keep"),
  PermissionAnswered: allStates("keep"),
  PermissionMoved: allStates("keep"),
  PermissionCancelled: allStates("keep"),
  QuestionAsked: allStates("keep"),
  QuestionAnswered: allStates("keep"),
  QuestionMoved: allStates("keep"),
  OwnerNeeded: allStates("keep"),
  WaitOpened: allStates("keep"),
  WaitMemberResolved: allStates("keep"),
  WaitSatisfied: allStates("keep"),
  WaitCancelled: allStates("keep"),
  DeliveryQueued: { ...allStates("keep"), crashed: "invalid", stopped: "invalid" },
  DeliverySent: { ...allStates("invalid"), idle: "working", working: "keep" },
  DeliveryAccepted: allStates("keep"),
  DeliveryRequeued: allStates("keep"),
  DeliveryHeld: { ...allStates("invalid"), working: "idle" },
  DeliveryReleased: allStates("keep"),
  DeliveryReturned: allStates("keep"),
  DeliveryWithdrawn: allStates("keep"),
  AgentCrashed: { ...allStates("invalid"), starting: "crashed", working: "crashed", idle: "crashed", paused: "crashed" },
  AgentInterrupted: { ...allStates("invalid"), starting: "interrupted", working: "interrupted", idle: "interrupted" },
  AgentReloadFailed: { ...allStates("invalid"), interrupted: "keep", paused: "keep" },
  AgentStopped: { ...allStates("stopped"), stopped: "invalid" },
  AgentGrouped: allStates("keep"),
  AccountChanged: allStates("keep"),
  AccountNeedsSignIn: allStates("keep"),
  AccountOutOfUsage: allStates("keep"),
  AccountAvailable: allStates("keep"),
  HarnessChanged: allStates("keep"),
  CommandRefused: allStates("keep")
}
export const eventEffect = (state: StateName, event: Event["_tag"]): EventEffect => eventTable[event][state]
import { rolesEventTags } from "./roles/events.ts"
