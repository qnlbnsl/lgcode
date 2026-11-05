import { connect, type Client } from "@shephrd/client/browser"
import type { RequestId } from "@shephrd/contracts"
import * as Effect from "effect/Effect"

export const requestId = () => crypto.randomUUID() as RequestId
export const connectBrowser = () => connect({ url: `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api` })

// Actions own their scope, so navigation or a completed subscription cannot
// leave a button using a retired client. The cookie supplies the identity.
export const withClient = <A, E>(action: (client: Client) => Effect.Effect<A, E>, signal: AbortSignal) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    return yield* action(yield* connectBrowser())
  })), { signal })
