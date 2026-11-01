import * as Schema from "effect/Schema"
import { HarnessId } from "./ids.ts"
import { PermissionLevel } from "./permission.ts"

export const RunMode = Schema.Literals(["acp", "interactive"])
export type RunMode = typeof RunMode.Type

const PermissionMapping = Schema.Struct({
  "read-only": Schema.NonEmptyString,
  ask: Schema.NonEmptyString,
  edit: Schema.NonEmptyString,
  full: Schema.NonEmptyString
})

const DenyMechanism = Schema.Union([
  Schema.TaggedStruct("none", {}),
  Schema.TaggedStruct("launch-arguments", {
    // Placeholders {stateFolder} and {settingsPath} are resolved at spawn.
    readArguments: Schema.Array(Schema.String),
    writeArguments: Schema.Array(Schema.String)
  })
])

export const HarnessSettings = Schema.Struct({
  id: HarnessId,
  runMode: RunMode,
  adapterPath: Schema.String.check(Schema.isPattern(/^\/.+$/)),
  adapterArguments: Schema.Array(Schema.String),
  permissionMapping: PermissionMapping,
  reportedModes: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString, level: PermissionLevel })),
  defaultModel: Schema.optionalKey(Schema.NonEmptyString),
  defaultEffort: Schema.optionalKey(Schema.NonEmptyString),
  defaultPermission: PermissionLevel,
  models: Schema.Array(Schema.NonEmptyString),
  efforts: Schema.Array(Schema.NonEmptyString),
  denyReadMechanism: DenyMechanism
})
export type HarnessSettings = typeof HarnessSettings.Type
