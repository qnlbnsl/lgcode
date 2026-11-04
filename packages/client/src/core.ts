import { CommandsRpcGroup, Event, EventEnvelope, WireCommandsRpcGroup, WireEnvelope, contentOnlyEventTags } from "@shephrd/contracts"
import type * as Duration from "effect/Duration"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"
import type * as SchemaAST from "effect/SchemaAST"
import * as Schedule from "effect/Schedule"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as RpcClient from "effect/rpc/RpcClient"
import type { RpcClientError } from "effect/rpc/RpcClientError"
import type * as Rpc from "effect/rpc/Rpc"
import type * as RpcGroup from "effect/rpc/RpcGroup"
import * as RpcSchema from "effect/rpc/RpcSchema"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as Socket from "effect/socket/Socket"
import { ClientError } from "./errors.ts"

export { ClientError }
type Rpcs = RpcGroup.Rpcs<typeof CommandsRpcGroup>
type DecodedValue<A> = A extends EventEnvelope ? ClientEnvelope
  : A extends string | number | boolean | bigint | symbol | null | undefined ? A
  : A extends ReadonlyArray<infer Item> ? ReadonlyArray<DecodedValue<Item>>
  : A extends object ? { readonly [K in keyof A]: DecodedValue<A[K]> } : A
type DecodedRpc<R extends Rpc.Any> = R extends Rpc.Rpc<infer Tag, infer Payload, infer Success, infer Error, infer Middleware, infer Requires>
  ? Rpc.Rpc<Tag, Payload,
    Success extends RpcSchema.Stream<infer A, infer E> ? RpcSchema.Stream<Schema.Codec<DecodedValue<A["Type"]>>, E>
      : Schema.Codec<DecodedValue<Success["Type"]>>,
    Error, Middleware, Requires> : never
export type Client = RpcClient.RpcClient<DecodedRpc<Rpcs>, RpcClientError | ClientError | Schema.SchemaError>
export type ConnectionKind = "reads" | "stream"
export interface CoreConnectOptions {
  readonly makeSocket: (kind: ConnectionKind) => Effect.Effect<Socket.Socket>
  readonly attempts?: number | undefined
  readonly readPing?: { readonly pingInterval: Duration.Input; readonly pingTimeout: Duration.Input } | undefined
}
interface Connection {
  readonly client: Client
  readonly scope: Scope.Closeable
  users: number
  retired: boolean
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
  parent: Scope.Scope, kind: ConnectionKind, options: CoreConnectOptions
): Effect.Effect<Connection, ClientError> =>
  Effect.gen(function* () {
    const scope = yield* Scope.fork(parent)
    const built = Effect.gen(function* () {
      const socket = yield* options.makeSocket(kind)
      const opened = yield* Deferred.make<void, Socket.SocketError>()
      const watched = Socket.make({
        writer: socket.writer,
        reader: socket.reader.pipe(
          Effect.tap(() => Deferred.succeed(opened, undefined)),
          Effect.tapError((error) => Deferred.fail(opened, error))
        )
      })
      const protocol = yield* RpcClient.makeProtocolSocket({
        retryTransientErrors: false, retryPolicy: Schedule.recurs(0),
        ...(kind === "reads" ? options.readPing : {})
      }).pipe(
        Effect.provideService(Socket.Socket, watched),
        Effect.provide(RpcSerialization.layerJson)
      )
      const client = yield* RpcClient.make(WireCommandsRpcGroup).pipe(Effect.provideService(RpcClient.Protocol, protocol))
      yield* Deferred.await(opened)
      return client as unknown as Client
    }).pipe(Scope.provide(scope))
    return yield* built.pipe(
      Effect.map((client): Connection => ({ client, scope, users: 0, retired: false })),
      Effect.catchIf(
        (error): error is Socket.SocketError => (error as { _tag?: string })._tag === "SocketError",
        (error) => Effect.fail(openFailure(error))
      ),
      Effect.onError(() => Scope.close(scope, Exit.void))
    )
  }) as Effect.Effect<Connection, ClientError>

const isTransport = (error: unknown): error is RpcClientError => (error as { _tag?: string } | null)?._tag === "RpcClientError"
const knownTags = new Set(Event.members.map((member) => String(member.fields._tag.ast.literal)))
export interface UnknownEvent {
  readonly _tag: "UnknownEvent"
  readonly tag: string
  readonly namespace: string
}
export type ClientEnvelope = Omit<WireEnvelope, "event"> & { readonly event: Event | UnknownEvent }

const isEnvelope = (value: unknown): value is WireEnvelope =>
  typeof value === "object" && value !== null && "event" in value && "sequence" in value && "eventId" in value
const decodeEnvelope = (value: WireEnvelope): Effect.Effect<ClientEnvelope, Schema.SchemaError> => Effect.gen(function* () {
  const raw = value.event as { _tag?: unknown } | null
  const tag = typeof raw?._tag === "string" ? raw._tag : undefined
  if (tag !== undefined && !knownTags.has(tag)) {
    return { ...value, event: { _tag: "UnknownEvent" as const, tag, namespace: tag.includes(".") ? tag.split(".")[0]! : "engine" } }
  }
  // An absent tag, or a malformed known event, must fail before cursor movement.
  const event = yield* Schema.decodeUnknownEffect(Event)(value.event)
  return { ...value, event }
})

// Follow declared envelope positions. Unknown piece sections and arbitrary
// structured text remain data, even when they resemble an envelope.
const decodeReply = (value: any, ast: SchemaAST.AST): Effect.Effect<any, Schema.SchemaError> => {
  if (ast === EventEnvelope.ast) return isEnvelope(value) ? decodeEnvelope(value) : Effect.succeed(value)
  if (ast._tag === "Union") return Effect.reduce(ast.types, () => value, (current, member) => decodeReply(current, member))
  if (ast._tag === "Arrays" && Array.isArray(value)) return Effect.forEach(value, (child, index) => {
    const element = ast.elements[index] ?? ast.rest[0]
    return element === undefined ? Effect.succeed(child) : decodeReply(child, element)
  })
  if (ast._tag === "Objects" && typeof value === "object" && value !== null) {
    return Effect.forEach(ast.propertySignatures, (property) => {
      const key = property.name
      return Object.hasOwn(value, key) ? decodeReply(value[key], property.type).pipe(
        Effect.map((decoded) => [key, decoded] as const)
      ) : Effect.succeed(undefined)
    }).pipe(Effect.map((entries) => Object.assign({}, value, Object.fromEntries(entries.filter((entry) => entry !== undefined)))))
  }
  return Effect.succeed(value)
}

// The two records have separate locks, protocol receive loops and retry state.
// A retired record lives until its pending users have observed their failures.
export const connectWith = (options: CoreConnectOptions): Effect.Effect<Client, ClientError, Scope.Scope> =>
  Effect.gen(function* () {
    const attempts = options.attempts ?? 3
    const parent = yield* Effect.scope
    const pool = (kind: ConnectionKind) => Effect.gen(function* () {
      const lock = yield* Semaphore.make(1)
      let current: Connection | undefined = kind === "reads" ? yield* open(parent, kind, options) : undefined
      const closeIfIdle = (connection: Connection) => connection.retired && connection.users === 0
        ? Scope.close(connection.scope, Exit.void) : Effect.void
      const ensure = lock.withPermit(Effect.suspend(() => {
        const take = (connection: Connection) => Effect.sync(() => { connection.users += 1; return connection })
        return current === undefined ? open(parent, kind, options).pipe(
          Effect.flatMap((connection) => { current = connection; return take(connection) })
        ) : take(current)
      }))
      const release = (connection: Connection) => lock.withPermit(Effect.suspend(() => {
        connection.users -= 1
        if (kind === "stream" && connection.users === 0) {
          if (current === connection) current = undefined
          connection.retired = true
        }
        return closeIfIdle(connection)
      }))
      const drop = (connection: Connection) => lock.withPermit(Effect.suspend(() => {
        if (current === connection) current = undefined
        connection.retired = true
        return closeIfIdle(connection)
      }))
      return { ensure, release, drop }
    })
    const reads = yield* pool("reads")
    const streams = yield* pool("stream")
    const pause = (attempt: number) => Effect.sleep(100 * attempt)
    const retryPayload = (tag: string, request: any) => tag === "wait" && request.block === true
      ? { ...request, requestId: globalThis.crypto.randomUUID() } : request

    const unary = (tag: string, success: Schema.Top) => (payload: any, callOptions?: any) => {
      const run = (attempt: number, request: any): Effect.Effect<unknown, unknown> =>
        Effect.acquireUseRelease(
          reads.ensure,
          (connection) => ((connection.client as any)[tag](request, callOptions) as Effect.Effect<unknown, unknown>).pipe(
            Effect.flatMap((reply) => decodeReply(reply, success.ast)),
            Effect.tapError((error) => isTransport(error) ? reads.drop(connection) : Effect.void)
          ),
          reads.release
        ).pipe(Effect.catchIf(
          (error) => (isTransport(error) || error instanceof ClientError) && attempt < attempts,
          () => pause(attempt).pipe(Effect.andThen(() => run(attempt + 1, retryPayload(tag, request))))
        ))
      return run(1, payload)
    }

    const subscribe = (tag: string, success: Schema.Top) => (payload: any, callOptions?: any): Stream.Stream<unknown, unknown> => Stream.suspend(() => {
      let after = payload.after
      let first = true
      const from = (failures: number): Stream.Stream<unknown, unknown> => Stream.unwrap(
        streams.ensure.pipe(Effect.map((connection) => {
          const request = first ? payload : { ...payload, requestId: globalThis.crypto.randomUUID(), after }
          first = false
          return ((connection.client as any)[tag](request, callOptions) as Stream.Stream<any, unknown>).pipe(
            Stream.mapEffect((item): Effect.Effect<any, unknown> => {
              if (tag !== "client.subscribe" || item._tag !== "client.Oversized"
                || !knownTags.has(item.tag) || (contentOnlyEventTags as ReadonlyArray<string>).includes(item.tag)) {
                return isEnvelope(item) ? decodeEnvelope(item) : decodeReply(item, success.ast)
              }
              const rpc = CommandsRpcGroup.requests.get("client.event")!
              return unary("client.event", rpc.successSchema)({ requestId: globalThis.crypto.randomUUID(), sequence: item.sequence }).pipe(
                Effect.flatMap((reply: any) => Effect.gen(function* () {
                  let value = reply
                  if (typeof reply.data === "string") {
                    value = yield* Effect.try({
                      try: () => {
                        const lines = reply.data.split("\n")
                        const marker = /^Data from another agent \[([^\]]+)\] \(delivery .*\):$/.exec(lines[0] ?? "")?.[1]
                        if (lines.length !== 3 || marker === undefined || lines[2] !== `End data [${marker}]`) throw new Error()
                        return JSON.parse(lines[1]!)
                      },
                      catch: () => new ClientError({ message: "the event recovery reply was invalid" })
                    })
                    const wire = yield* Schema.decodeUnknownEffect(WireEnvelope)(value.envelope)
                    value = { envelope: yield* decodeEnvelope(wire) }
                  }
                  if (!isEnvelope(value.envelope) || value.envelope.sequence !== item.sequence) {
                    return yield* new ClientError({ message: "the event recovery reply was invalid" })
                  }
                  return value.envelope
                })),
                // A refused read can mean that the caller's read rights changed.
                // Reconnect from before this marker and let visibility decide.
                Effect.catch(() => Effect.fail(new ClientError({ message: "the state event could not be recovered" }))),
                // Socket.write queues the Interrupt synchronously. Allow an I/O
                // turn before the enclosing consumer can close the read socket.
                Effect.onInterrupt(() => Effect.promise<void>(() => new Promise((resolve) => setTimeout(resolve, 0))))
              )
            }),
            Stream.tap((item) => Effect.sync(() => { after = item.sequence; failures = 0 })),
            Stream.tapError((error) => isTransport(error) ? streams.drop(connection) : Effect.void),
            Stream.ensuring(streams.release(connection))
          )
        }))
      ).pipe(Stream.catchIf(
        (error) => isTransport(error) || error instanceof ClientError,
        (error) => failures + 1 >= attempts ? Stream.fail(error) : Stream.fromEffect(pause(failures + 1)).pipe(
          Stream.drain, Stream.concat(Stream.suspend(() => from(failures + 1)))
        )
      ))
      return from(0)
    })

    const client: Record<string, unknown> = {}
    for (const [tag, rpc] of CommandsRpcGroup.requests) {
      client[tag] = RpcSchema.isStreamSchema(rpc.successSchema) ? subscribe(tag, rpc.successSchema.success) : unary(tag, rpc.successSchema)
    }
    return client as unknown as Client
  })
