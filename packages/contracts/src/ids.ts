import * as Schema from "effect/Schema"

// Opaque identities are distinct even when their wire representations coincide.
export const AgentId = Schema.NonEmptyString.pipe(Schema.brand("AgentId"))
export type AgentId = typeof AgentId.Type
export const EventId = Schema.NonEmptyString.pipe(Schema.brand("EventId"))
export type EventId = typeof EventId.Type
export const RequestId = Schema.NonEmptyString.pipe(Schema.brand("RequestId"))
export type RequestId = typeof RequestId.Type
export const PermissionRequestId = Schema.NonEmptyString.pipe(Schema.brand("PermissionRequestId"))
export type PermissionRequestId = typeof PermissionRequestId.Type
export const QuestionId = Schema.NonEmptyString.pipe(Schema.brand("QuestionId"))
export type QuestionId = typeof QuestionId.Type
export const WaitId = Schema.NonEmptyString.pipe(Schema.brand("WaitId"))
export type WaitId = typeof WaitId.Type
export const DeliveryId = Schema.NonEmptyString.pipe(Schema.brand("DeliveryId"))
export type DeliveryId = typeof DeliveryId.Type
export const DeviceId = Schema.NonEmptyString.pipe(Schema.brand("DeviceId"))
export type DeviceId = typeof DeviceId.Type
export const BootId = Schema.NonEmptyString.pipe(Schema.brand("BootId"))
export type BootId = typeof BootId.Type

// Account and harness names are user-facing slugs, rather than generated ids.
const Slug = Schema.String.check(Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/))
export const AccountId = Slug.pipe(Schema.brand("AccountId"))
export type AccountId = typeof AccountId.Type
export const HarnessId = Slug.pipe(Schema.brand("HarnessId"))
export type HarnessId = typeof HarnessId.Type

// Sequence zero denotes the head before the first event. Stay exact in JSON.
export const EventSequence = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
).pipe(Schema.brand("EventSequence"))
export type EventSequence = typeof EventSequence.Type

// Wall-clock deadlines and event times share one JSON-safe representation.
export const EpochMilliseconds = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
)
export type EpochMilliseconds = typeof EpochMilliseconds.Type
