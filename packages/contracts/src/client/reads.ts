import { ProjectSnapshot } from "../project/commands.ts"
import { StartFailure } from "../startFailure.ts"
import * as Schema from "effect/Schema"
import { Actor, EventEnvelope, PermissionOption, SessionReference } from "../events.ts"
import { AccountId, AgentId, DeliveryId, EpochMilliseconds, EventSequence, HarnessId, WaitId } from "../ids.ts"
import { PermissionLevel } from "../permission.ts"
import { DisplayedState, LifecycleState } from "../stateMachine.ts"
import { Alert } from "./alerts.ts"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const ClientFilter = Schema.Struct({
  agents: Schema.optionalKey(Schema.Array(AgentId).check(Schema.isMinLength(1))),
  groups: Schema.optionalKey(Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1))),
  kinds: Schema.optionalKey(Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)))
})
export type ClientFilter = typeof ClientFilter.Type
export const Checkpoint = Schema.TaggedStruct("client.Checkpoint", { sequence: EventSequence })
export const Oversized = Schema.TaggedStruct("client.Oversized", {
  sequence: EventSequence, tag: Schema.NonEmptyString, agentId: Schema.optionalKey(AgentId),
  bytes: Schema.Int.check(Schema.isGreaterThan(0))
})
export const ClientStreamItem = Schema.Union([EventEnvelope, Checkpoint, Oversized])
export type ClientStreamItem = typeof ClientStreamItem.Type
export const contentOnlyEventTags = ["ThreadItem"] as const

export const RosterEntry = Schema.Struct({
  agentId: AgentId, name: Schema.String, role: Schema.String, groups: Schema.Array(Schema.String),
  parent: Actor, parentName: Schema.optionalKey(Schema.String),
  startFailure: Schema.optionalKey(StartFailure),
  state: LifecycleState, displayedState: DisplayedState,
  openPermissionRequests: Count, openQuestionsAsked: Count,
  harness: HarnessId, account: AccountId,
  model: Schema.optionalKey(Schema.NonEmptyString), effort: Schema.optionalKey(Schema.NonEmptyString),
  permission: PermissionLevel, folder: Schema.String,
  session: Schema.optionalKey(SessionReference), startedAt: EpochMilliseconds
})
export type RosterEntry = typeof RosterEntry.Type

const RowDisplay = Schema.Struct({
  preview: Schema.String, options: Schema.Array(PermissionOption), optionCount: Count,
  settingsWrite: Schema.optionalKey(Schema.Boolean), toolKind: Schema.optionalKey(Schema.Literals(["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode", "other", "unknown"])),
  bytes: Count
})
const IdentityRow = Schema.Struct({
  id: Schema.NonEmptyString, agentId: AgentId, holder: Actor, sourceSequence: EventSequence,
  display: Schema.optionalKey(RowDisplay)
})
export const ClientSnapshot = Schema.Struct({
  sequence: EventSequence,
  agents: Schema.Array(Schema.Struct({
    ...RosterEntry.fields, reloadable: Schema.optionalKey(Schema.Boolean), capacityHeld: Schema.optionalKey(Schema.Boolean)
  })),
  requests: Schema.Array(IdentityRow), questions: Schema.Array(IdentityRow),
  requestsWithoutDisplay: Count, questionsWithoutDisplay: Count,
  accounts: Schema.optionalKey(Schema.Array(Schema.Struct({
    id: AccountId, status: Schema.NonEmptyString, enabled: Schema.Boolean,
    environment: Schema.Array(Schema.Struct({ name: Schema.String, secret: Schema.Boolean }))
  }))),
  alerts: Schema.optionalKey(Schema.Array(Alert)),
  waitState: Schema.optionalKey(Schema.Struct({
    deliveries: Schema.Array(Schema.Struct({
      id: DeliveryId, target: AgentId, status: Schema.Literals(["queued", "sent"]), source: Schema.optionalKey(Schema.String)
    })),
    waits: Schema.Array(Schema.Struct({ agentId: AgentId, waitId: WaitId }))
  })),
  // Each later piece defines its bounded, per-caller section in its own contracts.
  project: Schema.optionalKey(ProjectSnapshot), client: Schema.optionalKey(Schema.Unknown), board: Schema.optionalKey(Schema.Unknown), roles: Schema.optionalKey(Schema.Unknown),
  failedSections: Schema.optionalKey(Schema.Array(Schema.String))
})
export type ClientSnapshot = typeof ClientSnapshot.Type
