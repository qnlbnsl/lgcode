import * as Schema from "effect/Schema"
import { AccountId, AgentId, EpochMilliseconds, EventSequence, PermissionRequestId, QuestionId } from "../ids.ts"
import { pieceNamespaces } from "../namespaces.ts"

export const AlertId = Schema.NonEmptyString.pipe(Schema.brand("AlertId"))
export type AlertId = typeof AlertId.Type
// These components are identifiers, sequences and fixed words, never prose.
export const AlertKey = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]+(?:[.:][A-Za-z0-9_-]+)+$/))
export type AlertKey = typeof AlertKey.Type
export const alertKindNames = [
  "approval", "question", "failure", "account", "other", "client.web-down",
  "board.post", "board.no-answer", "roles.stall", "roles.replace", "roles.runaway", "roles.rule-first-use"
] as const
export const AlertKind = Schema.Literals(alertKindNames)
export type AlertKind = typeof AlertKind.Type
export const alertTitles = {
  approval: "Permission needs your approval", question: "A question needs your answer",
  failure: "An agent needs your attention", account: "An account needs your attention",
  other: "Your attention is needed", "client.web-down": "The web server is down",
  "board.post": "A post needs your reply", "board.no-answer": "An agent has not answered your post", "roles.stall": "An agent has stalled",
  "roles.replace": "A worker needs replacement", "roles.runaway": "Work has exceeded its expected length",
  "roles.rule-first-use": "A permission rule was used for the first time"
} as const satisfies Record<AlertKind, string>
export const alertPushDefaults = Object.fromEntries(alertKindNames.map((kind) => [kind, kind !== "roles.runaway"])) as Record<AlertKind, boolean>

export const AlertSubject = Schema.Union([
  Schema.TaggedStruct("permission", { id: PermissionRequestId }),
  Schema.TaggedStruct("question", { id: QuestionId }),
  Schema.TaggedStruct("agent", { id: AgentId }),
  Schema.TaggedStruct("account", { id: AccountId }),
  Schema.TaggedStruct("piece", { namespace: Schema.Literals(pieceNamespaces), id: Schema.NonEmptyString })
])
export type AlertSubject = typeof AlertSubject.Type
export const AlertSourceRequest = Schema.Struct({
  kind: AlertKind, key: AlertKey,
  agentId: Schema.optionalKey(AgentId), subject: Schema.optionalKey(AlertSubject)
})
export type AlertSourceRequest = typeof AlertSourceRequest.Type

export const CarrierSettings = Schema.Union([
  Schema.TaggedStruct("none", {}),
  Schema.TaggedStruct("ntfy", {
    server: Schema.NonEmptyString,
    topic: Schema.String.check(Schema.isPattern(/^[-_A-Za-z0-9]{1,64}$/))
  })
])
export type CarrierSettings = typeof CarrierSettings.Type
export const Alert = Schema.Struct({
  alertId: AlertId, alertKey: AlertKey, kind: AlertKind,
  agentId: Schema.optionalKey(AgentId), subject: Schema.optionalKey(AlertSubject),
  title: Schema.String, sourceSequence: EventSequence, baseline: Schema.optionalKey(Schema.Boolean),
  status: Schema.Literals(["open", "cleared"]),
  raisedAt: EpochMilliseconds, clearedAt: Schema.optionalKey(EpochMilliseconds)
})
export type Alert = typeof Alert.Type
export const AlertSettings = Schema.Struct({
  kinds: Schema.Array(Schema.Struct({ kind: AlertKind, push: Schema.Boolean })),
  carrier: CarrierSettings, tokenSet: Schema.Boolean
})
export type AlertSettings = typeof AlertSettings.Type

// Only this builder may name the carrier's slot; it cannot name account values.
export const CarrierTokenGeneration = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]+$/))
export const carrierTokenReference = (generation: string): string =>
  `secret:client.alerts.carrier.${Schema.decodeUnknownSync(CarrierTokenGeneration)(generation)}`
