import * as Schema from "effect/Schema"
import { AgentId, EventSequence } from "../ids.ts"
import { AlertId, AlertKey, AlertKind, AlertSubject, CarrierSettings, CarrierTokenGeneration } from "./alerts.ts"
import { WebSettings } from "./settings.ts"

export const clientEventTags = [
  "client.AlertBaseline", "client.AlertRaised", "client.AlertDelivered", "client.AlertDeliveryFailed",
  "client.AlertPromptDismissed", "client.AlertCleared", "client.AlertSettingsChanged", "client.AlertCarrierChanged",
  "client.AlertCarrierTokenSet", "client.AlertCarrierTokenCleared", "client.WebSettingsChanged",
  "client.WebServerDown", "client.WebServerUp"
] as const
const attempt = {
  alertId: AlertId, carrier: Schema.Literal("ntfy"), generation: EventSequence,
  attempt: Schema.Int.check(Schema.isGreaterThan(0))
}
export const ClientEvent = Schema.Union([
  Schema.TaggedStruct("client.AlertPromptDismissed", {}),
  Schema.TaggedStruct("client.AlertBaseline", { position: EventSequence }),
  Schema.TaggedStruct("client.AlertRaised", {
    alertId: AlertId, alertKey: AlertKey, kind: AlertKind,
    agentId: Schema.optionalKey(AgentId), subject: Schema.optionalKey(AlertSubject),
    title: Schema.String, sourceSequence: EventSequence, baseline: Schema.optionalKey(Schema.Boolean)
  }),
  Schema.TaggedStruct("client.AlertDelivered", attempt),
  Schema.TaggedStruct("client.AlertDeliveryFailed", { ...attempt, reason: Schema.String, final: Schema.optionalKey(Schema.Boolean) }),
  Schema.TaggedStruct("client.AlertCleared", {
    alertId: AlertId, cause: Schema.NonEmptyString, sourceSequence: Schema.optionalKey(EventSequence)
  }),
  Schema.TaggedStruct("client.AlertSettingsChanged", { kind: AlertKind, push: Schema.Boolean }),
  Schema.TaggedStruct("client.AlertCarrierChanged", { carrier: CarrierSettings }),
  Schema.TaggedStruct("client.AlertCarrierTokenSet", { origin: Schema.NonEmptyString, carrierGeneration: CarrierTokenGeneration }),
  Schema.TaggedStruct("client.AlertCarrierTokenCleared", {}),
  Schema.TaggedStruct("client.WebSettingsChanged", { settings: WebSettings }),
  Schema.TaggedStruct("client.WebServerDown", { reason: Schema.String }),
  Schema.TaggedStruct("client.WebServerUp", {})
])
export type ClientEvent = typeof ClientEvent.Type
export const clientEventVisibility = Object.fromEntries(clientEventTags.map((tag) => [tag, "owner-only"])) as Record<typeof clientEventTags[number], "owner-only">
