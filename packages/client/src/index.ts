import { randomUUID } from "node:crypto"

import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { CommandsRpcGroup } from "@shepherd/contracts"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Schedule from "effect/Schedule"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as RpcClient from "effect/rpc/RpcClient"
import type { RpcClientError } from "effect/rpc/RpcClientError"
import type * as RpcGroup from "effect/rpc/RpcGroup"
import * as RpcSchema from "effect/rpc/RpcSchema"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as Socket from "effect/socket/Socket"

import { ancestryHeaders } from "./ancestry.ts"
import { ClientError } from "./errors.ts"
import { type Environment, resolveIdentity, stateFolder } from "./identity.ts"
import { checkSocket, defaultSocketSecurity, type SocketSecurity } from "./socketCheck.ts"

export { ancestryHeaders, ClientError, resolveIdentity, stateFolder }
export type { Environment, SocketSecurity }

type Rpcs = RpcGroup.Rpcs<typeof CommandsRpcGroup>

// The same typed surface as `RpcClient.make(CommandsRpcGroup)`.
export type Client = RpcClient.RpcClient<Rpcs, RpcClientError>

export interface ConnectOptions {
  readonly environment: Environment
  readonly socketSecurity?: SocketSecurity | undefined
  // How many times a call or subscription is tried across dropped connections.
  readonly attempts?: number | undefined
}

interface Connection {
  readonly client: Client
  readonly scope: Scope.Closeable
}

// A refused upgrade reaches the socket layer as a `ws` error whose message
// names the HTTP status; read the status from it without keeping the cause.
const statusOf = (cause: unknown): number | undefined => {
  const candidates = [cause, (cause as { error?: unknown } | undefined)?.error]
  for (const candidate of candidates) {
    const message = (candidate as { message?: unknown } | undefined)?.message
    const match = typeof message === "string" ? /Unexpected server response: (\d{3})/.exec(message) : null
    if (match !== null) return Number(match[1])
  }
  return undefined
}

const openFailure = (error: Socket.SocketError): ClientError => {
  const reason = error.reason
  const status = reason._tag === "SocketOpenError" ? statusOf(reason.cause) : undefined
  if (status === 401 || status === 403) return new ClientError({ message: `the engine refused this identity (HTTP ${status})`, status })
  if (status !== undefined) return new ClientError({ message: `the engine refused the connection (HTTP ${status})`, status })
  if (reason._tag === "SocketOpenError" && reason.kind === "Timeout") return new ClientError({ message: "the engine did not answer in time" })
  return new ClientError({ message: "the engine socket could not be opened; is the engine running?" })
}

// One connection: a socket, its protocol and a typed client, in a scope of its
// own. The upgrade completes (or fails) before this returns.
const open = (
  parent: Scope.Scope, url: string, headers: Record<string, string>
): Effect.Effect<Connection, ClientError> =>
  Effect.gen(function* () {
    const scope = yield* Scope.fork(parent)
    const built = Effect.gen(function* () {
      const socket = yield* Socket.makeWebSocket(url, { headers, openTimeout: 5_000 }).pipe(
        Effect.provide(NodeSocket.layerWebSocketConstructorWS)
      )
      const opened = yield* Deferred.make<void, Socket.SocketError>()
      const watched = Socket.make({
        writer: socket.writer,
        reader: socket.reader.pipe(
          Effect.tap(() => Deferred.succeed(opened, undefined)),
          Effect.tapError((error) => Deferred.fail(opened, error))
        )
      })
      const protocol = yield* RpcClient.makeProtocolSocket({
        retryTransientErrors: false, retryPolicy: Schedule.recurs(0)
      }).pipe(
        Effect.provideService(Socket.Socket, watched),
        Effect.provide(RpcSerialization.layerJson)
      )
      const client = yield* RpcClient.make(CommandsRpcGroup).pipe(Effect.provideService(RpcClient.Protocol, protocol))
      yield* Deferred.await(opened)
      return client as Client
    }).pipe(Scope.provide(scope))
    return yield* built.pipe(
      Effect.map((client): Connection => ({ client, scope })),
      Effect.catchIf(
        (error): error is Socket.SocketError => (error as { _tag?: string })._tag === "SocketError",
        (error) => Effect.fail(openFailure(error))
      ),
      Effect.tapError(() => Scope.close(scope, Exit.void))
    )
  }) as Effect.Effect<Connection, ClientError>

const isTransport = (error: unknown): error is RpcClientError => (error as { _tag?: string } | null)?._tag === "RpcClientError"

// Builds the client. The first upgrade completes before this returns, so a
// refused identity or a missing engine fails here. A dropped connection is
// replaced by the next call; calls and subscriptions that were in flight are
// retried as the issues 77 and 170 rulings say.
export const connect = (options: ConnectOptions): Effect.Effect<Client, ClientError, Scope.Scope> =>
  Effect.gen(function* () {
    const attempts = options.attempts ?? 3
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

    const parent = yield* Effect.scope
    const lock = yield* Semaphore.make(1)
    let current: Connection | undefined = yield* open(parent, url, headers)

    const ensure = lock.withPermit(Effect.suspend(() =>
      current !== undefined ? Effect.succeed(current) : open(parent, url, headers).pipe(
        Effect.tap((connection) => Effect.sync(() => { current = connection }))
      )
    ))
    const drop = (connection: Connection) => Effect.suspend(() => {
      if (current === connection) current = undefined
      return Scope.close(connection.scope, Exit.void)
    })
    const pause = (attempt: number) => Effect.sleep(100 * attempt)

    const unary = (tag: string) => (payload: any, callOptions?: any) => {
      const run = (attempt: number, request: any): Effect.Effect<unknown, unknown> =>
        ensure.pipe(
          Effect.flatMap((connection) => (connection.client as any)[tag](request, callOptions).pipe(
            Effect.tapError((error) => isTransport(error) ? drop(connection) : Effect.void)
          ) as Effect.Effect<unknown, unknown>),
          Effect.catchIf(
            (error) => (isTransport(error) || error instanceof ClientError) && attempt < attempts,
            () => pause(attempt).pipe(Effect.andThen(() => run(attempt + 1, retryPayload(tag, request))))
          )
        )
      return run(1, payload)
    }

    // A blocking wait that lost its connection is a new wait: the committed
    // request id would only replay the stored "opened" receipt.
    const retryPayload = (tag: string, request: any) =>
      tag === "wait" && request.block === true ? { ...request, requestId: randomUUID() } : request

    // A subscription resumes after the last event it delivered, under a fresh
    // request id because the cursor differs from the committed request's.
    const subscribe = (payload: any, callOptions?: any): Stream.Stream<unknown, unknown> => {
      let after = payload.after
      let first = true
      const from = (failures: number): Stream.Stream<unknown, unknown> =>
        Stream.unwrap(ensure.pipe(Effect.map((connection) => {
          const request = first ? payload : { ...payload, requestId: randomUUID(), after }
          first = false
          return ((connection.client as any).subscribe(request, callOptions) as Stream.Stream<any, unknown>).pipe(
            Stream.tap((event) => Effect.sync(() => { after = event.sequence; failures = 0 })),
            Stream.catchIf(isTransport, (error) =>
              Stream.fromEffect(drop(connection)).pipe(Stream.drain, Stream.concat(
                failures + 1 >= attempts ? Stream.fail(error) :
                  Stream.fromEffect(pause(failures + 1)).pipe(Stream.drain, Stream.concat(Stream.suspend(() => from(failures + 1))))
              )))
          )
        }))).pipe(
          Stream.catchIf(
            (error) => error instanceof ClientError && failures + 1 < attempts,
            () => Stream.fromEffect(pause(failures + 1)).pipe(Stream.drain, Stream.concat(Stream.suspend(() => from(failures + 1))))
          )
        )
      return from(0)
    }

    const client: Record<string, unknown> = {}
    for (const [tag, rpc] of CommandsRpcGroup.requests) {
      client[tag] = RpcSchema.isStreamSchema((rpc as any).successSchema) ? subscribe : unary(tag)
    }
    yield* Effect.addFinalizer(() => Effect.suspend(() => current === undefined ? Effect.void : drop(current)))
    return client as unknown as Client
  })
