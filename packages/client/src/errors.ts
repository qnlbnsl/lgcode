import * as Data from "effect/Data"

// A client-side refusal or connection failure. The message never holds a
// credential, a token or a secret; `status` is the HTTP status of a refused
// upgrade, so a caller can tell a recovering engine (503) from a bad
// credential (401).
export class ClientError extends Data.TaggedError("ClientError")<{
  readonly message: string
  readonly status?: number | undefined
}> {}
