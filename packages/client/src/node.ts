import * as NodeSocket from "@effect/platform-node/NodeSocket"
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import * as Socket from "effect/socket/Socket"
import { ancestryHeaders } from "./ancestry.ts"
import { ClientError } from "./errors.ts"
import { connectWith, type Client } from "./core.ts"
import { type Environment, resolveIdentity, stateFolder } from "./identity.ts"
import { checkSocket, defaultSocketSecurity, type SocketSecurity } from "./socketCheck.ts"

export { ancestryHeaders, ClientError, resolveIdentity, stateFolder }
export type { Client, Environment, SocketSecurity }
export type { ClientEnvelope, UnknownEvent } from "./core.ts"
export interface ConnectOptions {
  readonly environment: Environment
  readonly socketSecurity?: SocketSecurity | undefined
  readonly attempts?: number | undefined
}

export const connect = (options: ConnectOptions): Effect.Effect<Client, ClientError, Scope.Scope> =>
  Effect.gen(function* () {
    const identity = yield* Effect.try({
      try: () => resolveIdentity(options.environment),
      catch: (error) => error as ClientError
    })
    // Checks first, credential second: a refused socket never sees the bearer.
    const security = options.socketSecurity ?? defaultSocketSecurity()
    const real = yield* Effect.try({
      try: () => checkSocket(identity.socketPath, security),
      catch: (error) => error as ClientError
    })
    const url = `ws+unix://${real}:/`
    if (real.includes(":") || new URL(url).pathname !== `${real}:/`) {
      return yield* new ClientError({ message: "the socket path holds characters that a socket address cannot carry" })
    }
    const bearer = yield* Effect.try({ try: () => identity.bearer(), catch: (error) => error as ClientError })
    const headers = yield* Effect.try({
      try: () => ({ Authorization: `Bearer ${bearer}`, ...ancestryHeaders() }),
      catch: (error) => error as ClientError
    })

    return yield* connectWith({ attempts: options.attempts, makeSocket: () =>
      Socket.makeWebSocket(url, { headers, openTimeout: 5_000 }).pipe(Effect.provide(NodeSocket.layerWebSocketConstructorWS))
    })
  })
