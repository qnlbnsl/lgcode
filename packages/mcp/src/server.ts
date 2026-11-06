import { randomUUID } from "node:crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai"
import * as NodeStdio from "@effect/platform-node/NodeStdio"
import { type Client, ClientError, connect } from "@sheprd/client"
import { retryRecoveringEffect } from "./retry.ts"
import { descriptions, inputSchema, toolNames, type ToolName } from "./tools.ts"

export type Environment = Readonly<Record<string, string | undefined>>

const version = "0.0.1"

const failureText = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const tagged = error as { _tag?: unknown; reason?: unknown; message?: unknown }
    if (tagged._tag === "CommandError" && typeof tagged.reason === "string") return `the engine refused the command: ${tagged.reason}`
    if (tagged._tag === "ClientError" && typeof tagged.message === "string") return tagged.message
  }
  return "the Sheprd service could not be reached or answered with an error"
}

// The agent token is read from SHEPRD_TOKEN and nowhere else; a shell
// argument never reaches this process's identity (row 55).
export const tokenProblem = (environment: Environment): string | undefined => {
  const token = environment.SHEPRD_TOKEN
  const socket = environment.SHEPRD_SOCKET
  if (token === undefined || token === "") {
    return "sheprd mcp needs the agent token in SHEPRD_TOKEN (with SHEPRD_SOCKET); it never uses the owner credential"
  }
  if (socket === undefined || socket === "") {
    return "SHEPRD_SOCKET and SHEPRD_TOKEN must be set together for sheprd mcp"
  }
  return undefined
}

// Connects on the first tool call, not at startup, and keeps the connection.
// The connection lives in the scope of the layer this is built in, so
// shutting the server layer down closes it. A failed connect is not kept: the
// next call tries again.
const makeLazyClient = (environment: Environment) => Effect.gen(function* () {
  const scope = yield* Effect.scope
  const lock = yield* Semaphore.make(1)
  let current: Client | undefined
  return lock.withPermit(Effect.suspend(() =>
    current !== undefined ? Effect.succeed(current) : connect({ environment }).pipe(
      Scope.provide(scope),
      Effect.tap((client) => Effect.sync(() => { current = client }))
    )
  ))
})

// The request id is made once per tool call and sent on every retry, so a
// command that committed before a dropped connection is answered from its
// stored receipt and never runs twice. A blocking wait that lost its
// connection is a new wait (the client's own rule), so it takes a new id.
const payloadFor = (name: ToolName, parameters: unknown, requestId: string) => {
  const payload: Record<string, unknown> = { ...(parameters as Record<string, unknown>), requestId }
  // A hand-off continuation is a fresh authorized read, with no receipt.
  // Its original id fixes the encoded selection budget across all pages.
  // MCP callers only supply the cursor, so retain that id on their behalf.
  const cursor = payload.omissions
  if (name === "roles.handoff" && typeof cursor === "object" && cursor !== null
    && "requestId" in cursor && typeof cursor.requestId === "string") {
    return { ...payload, requestId: cursor.requestId }
  }
  return name === "wait" && payload.block === true ? { ...payload, requestId: randomUUID() } : payload
}

const buildToolkit = (environment: Environment) => {
  const tools = toolNames.map((name) => Tool.dynamic(name, {
    description: descriptions[name],
    parameters: inputSchema(name),
    success: Schema.Unknown,
    failure: Schema.Unknown
  }))
  const toolkit = Toolkit.make(...tools)
  const handlers = Effect.gen(function* () {
    const clientFor = yield* makeLazyClient(environment)
    return Object.fromEntries(toolNames.map((name: ToolName) => [
      name,
      (parameters: unknown) => {
        const requestId = randomUUID()
        // The client call is part of this handler's Effect: cancelling the
        // tool call interrupts it, and the client sends the engine an interrupt.
        return retryRecoveringEffect(Effect.suspend(() => clientFor.pipe(
          Effect.flatMap((client) => (client as any)[name](payloadFor(name, parameters, requestId)) as Effect.Effect<unknown, unknown>)
        ))).pipe(
          Effect.map((reply: any) => typeof reply?.data === "string" ? reply.data : reply),
          Effect.mapError((error) => new Error(failureText(error)))
        )
      }
    ]))
  })
  return { toolkit, handlers }
}

export const serverLayer = (environment: Environment) => {
  const { toolkit, handlers } = buildToolkit(environment)
  return McpServer.toolkit(toolkit as never).pipe(
    Layer.provide(toolkit.toLayer(handlers as never) as never),
    Layer.provideMerge(McpServer.layerStdio({
      name: "sheprd", version, protocols: [McpProtocol.v2025_11_25]
    })),
    Layer.provide(NodeStdio.layer),
    // Standard output carries only protocol lines; logs never go there and a
    // failure's cause could hold request text.
    Layer.provide(Logger.layer([]))
  )
}

const stdinClosed = Effect.promise(() => new Promise<void>((resolve) => {
  process.stdin.once("end", () => resolve())
  process.stdin.once("close", () => resolve())
}))

export const runMcp = (options: { readonly environment: Environment }): Effect.Effect<number> => {
  const problem = tokenProblem(options.environment)
  if (problem !== undefined) {
    return Effect.sync(() => { process.stderr.write(`${problem}\n`); return 1 })
  }
  return Effect.raceFirst(
    Layer.launch(serverLayer(options.environment) as unknown as Layer.Layer<never, unknown, never>),
    stdinClosed
  ).pipe(
    Effect.as(0),
    Effect.catchCause(() => Effect.sync(() => { process.stderr.write("sheprd mcp stopped after an error\n"); return 1 }))
  )
}

export { ClientError }
