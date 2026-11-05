import * as Schema from "effect/Schema"

export const StartFailure = Schema.Literals([
  "not-signed-in", "private-login-not-signed-in", "model-refused", "effort-refused", "mode-refused", "could-not-start", "timed-out"
])
export type StartFailure = typeof StartFailure.Type
const messages: Record<StartFailure, string> = {
  "not-signed-in": "Not signed in",
  "private-login-not-signed-in": "Not signed in to this account's private login. Extra accounts do not use the default Codex login",
  "model-refused": "Adapter refused the model. Set the model and effort separately",
  "effort-refused": "Adapter refused the effort",
  "mode-refused": "Adapter refused the mode",
  "could-not-start": "Adapter could not start",
  "timed-out": "Timed out",
}
export const startFailureText = (reason: string): string => Object.hasOwn(messages, reason)
  ? messages[reason as StartFailure] : messages["could-not-start"]
// Only these codes may be exposed. Older durable events can contain a generic
// reason, which is normalized here rather than forwarded to a client.
export const safeStartFailure = (reason: unknown): StartFailure => typeof reason === "string" && Object.hasOwn(messages, reason)
  ? reason as StartFailure : "could-not-start"
