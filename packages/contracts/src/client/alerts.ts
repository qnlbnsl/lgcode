import * as Schema from "effect/Schema"
import { AccountId, AgentId, EpochMilliseconds, EventSequence, PermissionRequestId, QuestionId } from "../ids.ts"
import { pieceNamespaces } from "../namespaces.ts"

export const AlertId = Schema.NonEmptyString.pipe(Schema.brand("AlertId"))
export type AlertId = typeof AlertId.Type
// These components are identifiers, sequences and fixed words, never prose.
export const AlertKey = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]+(?:[.:][A-Za-z0-9_-]+)+$/))
export type AlertKey = typeof AlertKey.Type
export const alertKindNames = [
  "approval", "question", "failure", "merge", "sprint", "account", "other", "client.web-down",
  "board.post", "board.no-answer", "roles.stall", "roles.replace", "roles.runaway", "roles.rule-first-use"
] as const
export const AlertKind = Schema.Literals(alertKindNames)
export type AlertKind = typeof AlertKind.Type
export const alertTitles = {
  approval: "Permission needs your approval", question: "A question needs your answer",
  failure: "An agent needs your attention", account: "An account needs your attention",
  merge: "A merge is ready for your review", sprint: "A sprint is complete",
  other: "Your attention is needed", "client.web-down": "The web server is down",
  "board.post": "A post needs your reply", "board.no-answer": "An agent has not answered your post", "roles.stall": "An agent has stalled",
  "roles.replace": "A worker needs replacement", "roles.runaway": "Work has exceeded its expected length",
  "roles.rule-first-use": "A permission rule was used for the first time"
} as const satisfies Record<AlertKind, string>
export const alertPushDefaults = Object.fromEntries(alertKindNames.map((kind) => [kind, kind !== "roles.runaway" && kind !== "sprint"])) as Record<AlertKind, boolean>

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

export const carrierNames = ["ntfy", "email"] as const
export const CarrierName = Schema.Literals(carrierNames)
export type CarrierName = typeof CarrierName.Type
export const EmailSettings = Schema.TaggedStruct("email", {
  host: Schema.NonEmptyString, port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  security: Schema.Literals(["tls", "starttls", "plain"]), username: Schema.NonEmptyString,
  from: Schema.NonEmptyString, to: Schema.NonEmptyString
})
export const QuietHours = Schema.Struct({
  enabled: Schema.Boolean, start: Schema.String, end: Schema.String,
  timeZone: Schema.NonEmptyString, failureOverride: Schema.Boolean
})
export type QuietHours = typeof QuietHours.Type
export const defaultQuietHours: QuietHours = { enabled: false, start: "22:00", end: "07:00", timeZone: "UTC", failureOverride: true }
export const CarrierSettings = Schema.Union([
  Schema.TaggedStruct("none", {}),
  EmailSettings,
  Schema.TaggedStruct("ntfy", {
    server: Schema.NonEmptyString,
    topic: Schema.String.check(Schema.isPattern(/^[-_A-Za-z0-9]{1,64}$/))
  })
])
export type CarrierSettings = typeof CarrierSettings.Type
export const AlertDeliveryFailure = Schema.Literals(["service missing", "token missing", "carrier delivery failed"])
const deliveryAttempt = { at: Schema.optionalKey(EpochMilliseconds), generation: EventSequence, attempt: Schema.Int.check(Schema.isGreaterThan(0)) }
export const AlertDelivery = Schema.Union([
  Schema.Struct({ status: Schema.Literal("delivered"), ...deliveryAttempt }),
  Schema.Struct({ status: Schema.Literal("failed"), ...deliveryAttempt,
    reason: AlertDeliveryFailure, final: Schema.Boolean })
])
export type AlertDelivery = typeof AlertDelivery.Type
export const CarrierDelivery = Schema.Union([
  Schema.Struct({ status: Schema.Literal("delivered"), ...deliveryAttempt, carrier: CarrierName }),
  Schema.Struct({ status: Schema.Literal("failed"), ...deliveryAttempt, carrier: CarrierName, reason: AlertDeliveryFailure, final: Schema.Boolean })
])
export const Alert = Schema.Struct({
  alertId: AlertId, alertKey: AlertKey, kind: AlertKind,
  agentId: Schema.optionalKey(AgentId), subject: Schema.optionalKey(AlertSubject),
  title: Schema.String, sourceSequence: EventSequence, baseline: Schema.optionalKey(Schema.Boolean),
  status: Schema.Literals(["open", "cleared"]),
  raisedAt: EpochMilliseconds, clearedAt: Schema.optionalKey(EpochMilliseconds),
  held: Schema.optionalKey(Schema.Boolean),
  deliveries: Schema.optionalKey(Schema.Array(CarrierDelivery)),
  delivery: Schema.optionalKey(AlertDelivery)
})
export type Alert = typeof Alert.Type
export const AlertSettings = Schema.Struct({
  kinds: Schema.Array(Schema.Struct({ kind: AlertKind, push: Schema.Boolean })),
  carriers: Schema.optionalKey(Schema.Array(Schema.Struct({ name: CarrierName, enabled: Schema.Boolean, carrier: CarrierSettings, tokenSet: Schema.Boolean }))),
  quiet: Schema.optionalKey(QuietHours),
  carrier: CarrierSettings, tokenSet: Schema.Boolean, pushPromptDismissed: Schema.optionalKey(Schema.Boolean)
})
export type AlertSettings = typeof AlertSettings.Type

// Only this builder may name the carrier's slot; it cannot name account values.
export const CarrierTokenGeneration = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]+$/))
export const carrierTokenReference = (generation: string): string =>
  `secret:client.alerts.carrier.${Schema.decodeUnknownSync(CarrierTokenGeneration)(generation)}`
