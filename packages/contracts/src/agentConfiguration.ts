import * as Schema from "effect/Schema"
import { EpochMilliseconds, RequestId } from "./ids.ts"

// Identifiers are protocol values, never display labels. Bound every composer read.
export const ChoiceId = Schema.NonEmptyString.check(Schema.isMaxLength(256), Schema.isPattern(/^[^\x00-\x1f\x7f]+$/))
export const AgentChoice = Schema.Struct({ model: Schema.optionalKey(ChoiceId), effort: Schema.optionalKey(ChoiceId) })
export type AgentChoice = typeof AgentChoice.Type
export const ConfigurationStatus = Schema.Literals(["pending", "applied", "refused", "unsupported", "unavailable"])
export const ConfigurationReason = Schema.Literals(["adapter-refused", "not-supported", "not-acknowledged", "not-live", "configuration-unknown"])
export const AgentConfiguration = Schema.Struct({
  revision: Schema.optionalKey(RequestId), desired: AgentChoice, applied: Schema.optionalKey(AgentChoice),
  status: ConfigurationStatus, reason: Schema.optionalKey(ConfigurationReason)
})
export type AgentConfiguration = typeof AgentConfiguration.Type
export const ChoiceList = Schema.Struct({
  source: Schema.Literals(["configured", "negotiated", "unavailable"]),
  options: Schema.Array(Schema.Struct({ id: ChoiceId, label: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(256))) })).check(Schema.isMaxLength(128))
})
export type ChoiceList = typeof ChoiceList.Type
export const AgentChoices = Schema.Struct({ models: ChoiceList, efforts: ChoiceList })
export type AgentChoices = typeof AgentChoices.Type
const Tokens = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER))
export const ContextUsage = Schema.Union([
  Schema.TaggedStruct("available", {
    used: Tokens, window: Tokens.check(Schema.isGreaterThan(0)),
    percent: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100)),
    reportedAt: EpochMilliseconds, model: Schema.optionalKey(ChoiceId)
  }),
  Schema.TaggedStruct("unavailable", { reason: Schema.Literals(["not-reported", "invalid-report", "configuration-changed", "not-live"]) })
])
export type ContextUsage = typeof ContextUsage.Type
