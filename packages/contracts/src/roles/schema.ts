import * as Schema from "effect/Schema"

export const rolesMaxima = {
  roleFileBytes: 64 * 1024,
  roleFileEventBytes: 200 * 1024,
  actionPageItems: 500,
  actionPageBytes: 256 * 1024,
  handoffBytes: 64 * 1024,
  snapshotBytes: 128 * 1024,
  snoozes: 200,
  snapshotAgents: 256,
} as const

const bounded = (minimum: number, maximum: number) => Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(minimum), Schema.isLessThanOrEqualTo(maximum),
)
// Decision 73 narrows the original crash-retry maximum to one.
export const RoleLimits = Schema.Struct({
  crashRetries: Schema.optionalKey(bounded(0, 1)),
  capacityRetries: Schema.optionalKey(bounded(0, 12)),
  capacityBackoffMinutes: Schema.optionalKey(bounded(1, 60)),
  stallMinutes: Schema.optionalKey(bounded(5, 240)),
  teamIdleMinutes: Schema.optionalKey(bounded(15, 1440)),
  turnMinutes: Schema.optionalKey(bounded(30, 2880)),
  ageMinutes: Schema.optionalKey(bounded(30, 2880)),
  compactionTokens: Schema.optionalKey(Schema.Union([bounded(20_000, 1_000_000), Schema.Literal("off")])),
  flushLeadMinutes: Schema.optionalKey(bounded(1, 4)),
})
export type RoleLimits = typeof RoleLimits.Type
export const RoleDefinition = Schema.Struct({ advice: Schema.String, limits: RoleLimits })
export const RoleFile = Schema.Struct({
  name: Schema.NonEmptyString,
  roles: Schema.Record(Schema.NonEmptyString, RoleDefinition),
})
export type RoleFile = typeof RoleFile.Type
export const RoleFileHash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))
export const RolesSettings = Schema.Struct({
  stallWatch: Schema.optionalKey(Schema.Boolean),
  assignedStallMinutes: Schema.optionalKey(bounded(1, 120)),
  leadStallMinutes: Schema.optionalKey(bounded(1, 240)),
  standingRules: Schema.optionalKey(Schema.Boolean),
  limits: Schema.optionalKey(RoleLimits),
})
export type RolesSettings = typeof RolesSettings.Type
