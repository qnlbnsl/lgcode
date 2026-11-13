import * as Schema from "effect/Schema"
import { AgentChoices } from "./agentConfiguration.ts"
import { AccountId, HarnessId } from "./ids.ts"

// A discovery session reports exact protocol identifiers, never guessed defaults.
export const HarnessChoices = Schema.Struct({
  harnessId: HarnessId,
  accountId: Schema.optionalKey(AccountId),
  ...AgentChoices.fields,
  reason: Schema.optionalKey(Schema.NonEmptyString),
  effortReason: Schema.optionalKey(Schema.NonEmptyString)
})
export type HarnessChoices = typeof HarnessChoices.Type
