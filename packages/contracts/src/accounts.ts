import * as Schema from "effect/Schema"
import { AccountId, HarnessId } from "./ids.ts"

export const SecretReference = Schema.String.check(Schema.isPattern(/^secret:[a-zA-Z0-9_-]+$/))
export type SecretReference = typeof SecretReference.Type

// Check the whole record: refined record keys would silently remove bad entries.
// The diagnostic names the variable, never its value.
const Environment = Schema.Record(Schema.String, Schema.String).check(Schema.makeFilter((environment) => {
  for (const [name, value] of Object.entries(environment)) {
    if (/token|key|secret|password/i.test(name) && !Schema.is(SecretReference)(value)) {
      return { path: [name], issue: "A secret-looking environment name requires a secret reference" }
    }
  }
  return undefined
}))

export const Account = Schema.Struct({
  id: AccountId,
  harness: HarnessId,
  displayName: Schema.optionalKey(Schema.NonEmptyString),
  home: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^\/.*$/))),
  secret: Schema.optionalKey(SecretReference),
  environment: Schema.optionalKey(Environment),
  enabled: Schema.optionalKey(Schema.Boolean)
})
export type Account = typeof Account.Type
