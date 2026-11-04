import * as Schema from "effect/Schema"
import { BoardEvent } from "./board/events.ts"
import { ClientEvent } from "./client/events.ts"
import { Account } from "./accounts.ts"
import { HarnessSettings, RunMode } from "./harnesses.ts"
import { AccountId, AgentId, BootId, DeliveryId, EpochMilliseconds, EventId, EventSequence, HarnessId, PermissionRequestId, QuestionId, RequestId, WaitId } from "./ids.ts"
import { PermissionLevel } from "./permission.ts"
import { LifecycleState } from "./stateMachine.ts"
import { RolesEvent } from "./roles/events.ts"

export const Actor = Schema.Union([
  Schema.TaggedStruct("owner", {}),
  Schema.TaggedStruct("agent", { agentId: AgentId })
])
export type Actor = typeof Actor.Type

export const Caller = Schema.Union([
  Actor,
  Schema.TaggedStruct("service", { service: Schema.NonEmptyString, rule: Schema.optionalKey(Schema.NonEmptyString) }),
  Schema.TaggedStruct("piece", { namespace: Schema.Literals(["client", "board", "roles"]) })
])
export type Caller = typeof Caller.Type
export const Sender = Schema.Union([
  Actor,
  Schema.TaggedStruct("service", { service: Schema.NonEmptyString }),
  Schema.TaggedStruct("piece", { namespace: Schema.Literals(["client", "board", "roles"]) })
])
export type Sender = typeof Sender.Type

export const PermissionActionFields = {
  toolKind: Schema.optionalKey(Schema.Literals(["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode", "other"])),
  toolInput: Schema.optionalKey(Schema.Unknown),
  locations: Schema.optionalKey(Schema.Array(Schema.Struct({ path: Schema.String, line: Schema.optionalKey(Schema.Int) }))),
  inputRedacted: Schema.optionalKey(Schema.Boolean),
  inputTruncated: Schema.optionalKey(Schema.Boolean)
}
export type PermissionAction = typeof PermissionAction.Type
export const PermissionAction = Schema.Struct(PermissionActionFields)

export const SessionReference = Schema.Union([
  Schema.TaggedStruct("acp", { sessionId: Schema.NonEmptyString }),
  Schema.TaggedStruct("interactive", { paneId: Schema.NonEmptyString })
])
export type SessionReference = typeof SessionReference.Type

export const Delivery = Schema.Struct({
  id: DeliveryId,
  target: AgentId,
  sender: Sender,
  content: Schema.Union([
    Schema.TaggedStruct("prompt", { text: Schema.String }),
    Schema.TaggedStruct("compact", {}),
    Schema.TaggedStruct("carry-on", { text: Schema.String })
  ]),
  // A moved or cancelled request withdraws its delivery atomically.
  source: Schema.optionalKey(Schema.Union([
    Schema.TaggedStruct("permission", { id: PermissionRequestId }),
    Schema.TaggedStruct("question", { id: QuestionId }),
    Schema.TaggedStruct("wait", { id: WaitId }),
    Schema.TaggedStruct("piece", { namespace: Schema.Literals(["client", "board", "roles"]), id: Schema.NonEmptyString })
  ]))
})
export type Delivery = typeof Delivery.Type

export const PermissionOption = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.String,
  kind: Schema.String,
  level: PermissionLevel,
  persistent: Schema.Boolean
})
export type PermissionOption = typeof PermissionOption.Type

export const WaitMember = Schema.Struct({
  agentId: AgentId,
  reason: Schema.Literals(["settled", "crashed", "stopped", "paused", "interrupted"])
})
export type WaitMember = typeof WaitMember.Type

// Usage is an optional numeric snapshot, never raw adapter metadata. `used`
// is the latest reported context size. Terminal counters retain the adapter's
// scope, which can cover the whole turn. They do not prove last-request usage.
const TokenCount = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
)
export const TurnUsage = Schema.Struct({
  used: Schema.optionalKey(TokenCount),
  inputTokens: Schema.optionalKey(TokenCount),
  cachedReadTokens: Schema.optionalKey(TokenCount),
  cachedWriteTokens: Schema.optionalKey(TokenCount),
  // These normalized request fields are absent unless a source reports them.
  requestStartedAt: Schema.optionalKey(EpochMilliseconds),
  cachedWrite5mTokens: Schema.optionalKey(TokenCount),
  cachedWrite1hTokens: Schema.optionalKey(TokenCount)
})
export type TurnUsage = typeof TurnUsage.Type

const ProcessIdentity = Schema.Struct({
  groupId: Schema.Int.check(Schema.isGreaterThanOrEqualTo(2)),
  bootId: BootId,
  startTime: Schema.NonEmptyString,
  userId: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  executable: Schema.NonEmptyString
})

export const ThreadContent = Schema.Union([
  Schema.TaggedStruct("text", { text: Schema.String }),
  Schema.TaggedStruct("plan", { entries: Schema.Array(Schema.Struct({
    content: Schema.String,
    priority: Schema.Literals(["high", "medium", "low"]),
    status: Schema.Literals(["pending", "in_progress", "completed"])
  })) }),
  Schema.TaggedStruct("tool-call", {
    callId: Schema.NonEmptyString,
    title: Schema.String,
    status: Schema.Literals(["pending", "in_progress", "completed", "failed"]),
    // Structured adapter input/output is serialized and redacted by the runner.
    input: Schema.optionalKey(Schema.String),
    output: Schema.optionalKey(Schema.String)
  }),
  Schema.TaggedStruct("file-change", { path: Schema.String, diff: Schema.String })
])

const agent = { agentId: AgentId }
const delivery = { ...agent, deliveryId: DeliveryId }
const permission = { ...agent, permissionRequestId: PermissionRequestId }
const question = { ...agent, questionId: QuestionId }
const wait = { ...agent, waitId: WaitId }
const account = { accountId: AccountId }

// Event payloads only. Sequence, time and caller belong to the log envelope.
// All text must pass through the engine's redactor before the log writer.
export const EngineEvent = Schema.Union([
  Schema.TaggedStruct("AgentStarted", {
    ...agent,
    name: Schema.NonEmptyString,
    role: Schema.String,
    groups: Schema.Array(Schema.String),
    parent: Actor,
    harness: HarnessId,
    account: AccountId,
    model: Schema.optionalKey(Schema.NonEmptyString),
    effort: Schema.optionalKey(Schema.NonEmptyString),
    permission: PermissionLevel,
    folder: Schema.String.check(Schema.isPattern(/^\/.*$/)),
    runMode: RunMode,
    firstPromptDelivery: Schema.optionalKey(Delivery)
  }),
  Schema.TaggedStruct("AgentStartFailed", { ...agent, reason: Schema.String }),
  Schema.TaggedStruct("SessionOpened", {
    ...agent,
    session: SessionReference,
    protocolVersion: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    process: Schema.optionalKey(ProcessIdentity),
    reloadable: Schema.Boolean
  }),
  Schema.TaggedStruct("PromptSent", { ...delivery, sender: Sender, text: Schema.String }),
  Schema.TaggedStruct("ThreadItem", {
    ...agent, itemId: Schema.NonEmptyString, content: ThreadContent, replay: Schema.Boolean
  }),
  Schema.TaggedStruct("TurnStarted", { ...agent }),
  Schema.TaggedStruct("TurnEnded", { ...agent, compact: Schema.Boolean, usage: Schema.optionalKey(TurnUsage) }),
  Schema.TaggedStruct("StateChanged", { ...agent, state: LifecycleState }),
  Schema.TaggedStruct("ModeChanged", { ...agent, mode: Schema.String, level: PermissionLevel }),
  Schema.TaggedStruct("ModeRefused", { ...agent, mode: Schema.String, ceiling: PermissionLevel, reason: Schema.String }),
  Schema.TaggedStruct("PermissionRequested", {
    ...permission,
    holder: Actor,
    deliveryId: DeliveryId,
    toolCallId: Schema.NonEmptyString,
    description: Schema.String,
    options: Schema.Array(PermissionOption).check(Schema.isMinLength(1)),
    settingsWrite: Schema.Boolean,
    ...PermissionActionFields
  }),
  Schema.TaggedStruct("PermissionAnswered", {
    ...permission,
    answeredBy: Caller,
    answer: Schema.Union([
      Schema.TaggedStruct("selected", { optionId: Schema.NonEmptyString }),
      Schema.TaggedStruct("cancelled", {})
    ])
  }),
  Schema.TaggedStruct("PermissionMoved", { ...permission, from: Actor, to: Actor, deliveryId: DeliveryId }),
  Schema.TaggedStruct("PermissionCancelled", { ...permission, reason: Schema.String }),
  Schema.TaggedStruct("QuestionAsked", { ...question, holder: Actor, deliveryId: DeliveryId, text: Schema.String }),
  Schema.TaggedStruct("QuestionAnswered", { ...question, answeredBy: Actor, text: Schema.String, deliveryId: DeliveryId }),
  Schema.TaggedStruct("QuestionMoved", { ...question, from: Actor, to: Actor, deliveryId: DeliveryId }),
  Schema.TaggedStruct("OwnerNeeded", {
    ...agent,
    reason: Schema.String,
    subject: Schema.optionalKey(Schema.Union([
      Schema.TaggedStruct("permission", { id: PermissionRequestId }),
      Schema.TaggedStruct("question", { id: QuestionId })
    ]))
  }),
  Schema.TaggedStruct("WaitOpened", {
    ...wait, members: Schema.Array(AgentId).check(Schema.isMinLength(1)),
    mode: Schema.Literals(["any", "all"]), blocking: Schema.Boolean
  }),
  Schema.TaggedStruct("WaitMemberResolved", { ...wait, member: WaitMember }),
  Schema.TaggedStruct("WaitSatisfied", { ...wait, members: Schema.Array(WaitMember) }),
  Schema.TaggedStruct("WaitCancelled", { ...wait, reason: Schema.String }),
  Schema.TaggedStruct("DeliveryQueued", { delivery: Delivery }),
  Schema.TaggedStruct("DeliverySent", { ...delivery, method: RunMode }),
  Schema.TaggedStruct("DeliveryAccepted", { ...delivery }),
  Schema.TaggedStruct("DeliveryRequeued", { ...delivery, reason: Schema.String }),
  Schema.TaggedStruct("DeliveryReturned", { ...delivery, sender: Sender, reason: Schema.String }),
  Schema.TaggedStruct("DeliveryWithdrawn", { ...delivery, reason: Schema.String }),
  Schema.TaggedStruct("AgentCrashed", {
    ...agent, exitCode: Schema.NullOr(Schema.Int), signal: Schema.NullOr(Schema.String), stderr: Schema.String
  }),
  Schema.TaggedStruct("AgentInterrupted", { ...agent, previous: Schema.Literals(["starting", "working", "idle"]) }),
  Schema.TaggedStruct("AgentReloadFailed", { ...agent, reason: Schema.String }),
  Schema.TaggedStruct("AgentStopped", { ...agent }),
  Schema.TaggedStruct("AgentGrouped", { ...agent, groups: Schema.Array(Schema.String) }),
  // No account means removal. Values in an account are references, never credentials.
  Schema.TaggedStruct("AccountChanged", { ...account, account: Schema.optionalKey(Account) }),
  Schema.TaggedStruct("AccountNeedsSignIn", { ...account, reason: Schema.String }),
  Schema.TaggedStruct("AccountOutOfUsage", { ...account, resetAt: Schema.optionalKey(EpochMilliseconds) }),
  Schema.TaggedStruct("AccountAvailable", { ...account, cause: Schema.Literals(["usage reset", "owner cleared"]) }),
  Schema.TaggedStruct("HarnessChanged", { harness: HarnessSettings }),
  // Keep this minimal: a refused request may contain a secret-setting value.
  Schema.TaggedStruct("CommandRefused", { command: Schema.NonEmptyString, reason: Schema.String, sourceSequence: Schema.optionalKey(EventSequence) })
])
// Later pieces merge their event unions here, in namespace order.
// Keep each member type while avoiding Effect's tuple-recursion limit as the
// shared event list grows. Engine-only field schemas are exported directly.
const eventMembers: ReadonlyArray<typeof EngineEvent.members[number] | typeof BoardEvent.members[number] | typeof ClientEvent.members[number] | typeof RolesEvent.members[number]> = [
  ...EngineEvent.members, ...BoardEvent.members, ...ClientEvent.members, ...RolesEvent.members
]
export const Event = Schema.Union(eventMembers)
export type Event = typeof Event.Type

export const EventEnvelope = Schema.Struct({
  sequence: EventSequence,
  eventId: EventId,
  occurredAt: EpochMilliseconds,
  caller: Caller,
  requestId: Schema.optionalKey(RequestId),
  agentId: Schema.optionalKey(AgentId),
  event: Event
})
export type EventEnvelope = typeof EventEnvelope.Type

export const eventGroups = [
  { namespace: "engine", events: EngineEvent },
  { namespace: "board", events: BoardEvent },
  { namespace: "client", events: ClientEvent },
  { namespace: "roles", events: RolesEvent }
] as const
