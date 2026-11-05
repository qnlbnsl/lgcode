import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import * as Socket from "effect/socket/Socket"
import { connectWith, type Client } from "./core.ts"
import { ClientError } from "./errors.ts"

export { ClientError }
export type { Client, ClientEnvelope, UnknownEvent } from "./core.ts"
export { waitForAgents } from "./waitForAgents.ts"
export type { WaitOptions, ClientWaitReply } from "./waitForAgents.ts"
export interface ConnectOptions {
  readonly url: string
  readonly attempts?: number | undefined
}

// The browser supplies its HttpOnly session cookie during the upgrade.
export const connect = (options: ConnectOptions): Effect.Effect<Client, ClientError, Scope.Scope> =>
  connectWith({
    attempts: options.attempts,
    makeSocket: () => Socket.makeWebSocket(options.url, { openTimeout: 5_000 }).pipe(
      Effect.provide(Socket.layerWebSocketConstructorGlobal)
    ),
    readPing: { pingInterval: "25 seconds", pingTimeout: "50 seconds" }
  })
