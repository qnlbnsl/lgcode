import * as Schema from "effect/Schema"
import { HarnessId } from "./ids.ts"
import { HarnessSettings } from "./harnesses.ts"

export const HarnessInstallation = Schema.Struct({
  harnessId: HarnessId, installed: Schema.Boolean,
  reason: Schema.optionalKey(Schema.String), version: Schema.optionalKey(Schema.String), path: Schema.optionalKey(Schema.String),
  settings: Schema.optionalKey(HarnessSettings)
})
export type HarnessInstallation = typeof HarnessInstallation.Type
export const HarnessRecipe = Schema.Struct({
  harnessId: HarnessId, name: Schema.String, automatic: Schema.Boolean,
  packages: Schema.Array(Schema.String), registry: Schema.String, source: Schema.String, signInSource: Schema.optionalKey(Schema.String),
  commands: Schema.Array(Schema.String), signInCommand: Schema.String, signInArguments: Schema.Array(Schema.String), reason: Schema.optionalKey(Schema.String)
})
export type HarnessRecipe = typeof HarnessRecipe.Type
export const HarnessInstallResult = Schema.Struct({
  state: Schema.Literals(["installed", "failed"]), installation: HarnessInstallation,
  reason: Schema.optionalKey(Schema.String), output: Schema.String
})
export type HarnessInstallResult = typeof HarnessInstallResult.Type
