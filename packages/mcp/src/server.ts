import { randomUUID } from "node:crypto"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai"
import * as NodeStdio from "@effect/platform-node/NodeStdio"
import { type Client, ClientError, connect } from "@shepherd/client"
import { retryRecovering } from "./retry.ts"
import { descriptions, inputSchema, toolNames, type ToolName } from "./tools.ts"

export type Environment = Readonly<Record<string, string | undefined>>

const version = "0.0.1"

const failureText = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const tagged = error as { _tag?: unknown; reason?: unknown; message?: unknown }
    if (tagged._tag === "CommandError" && typeof tagged.reason === "string") return `the engine refused the command: ${tagged.reason}`
    if (tagged._tag === "ClientError" && typeof tagged.message === "string") return tagged.message
  }
  return "the Shepherd service could not be reached or answered with an error"
}

// Runs an Effect, rejecting with the original failure so a retry can read the
// HTTP status carried on a ClientError.
const runOrThrow = async <A, E>(effect: Effect.Effect<A, E>): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) return exit.value
  const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")
  throw failure !== undefined ? (failure as { error: unknown }).error : new Error("the Shepherd client stopped unexpectedly")
}

// The agent token is read from SHEPHERD_TOKEN and nowhere else; a shell
// argument never reaches this process's identity (row 55).
export const tokenProblem = (environment: Environment): string | undefined => {
  const token = environment.SHEPHERD_TOKEN
  const socket = environment.SHEPHERD_SOCKET
  if (token === undefined || token === "") {
    return "shepherd mcp needs the agent token in SHEPHERD_TOKEN (with SHEPHERD_SOCKET); it never uses the owner credential"
  }
  if (socket === undefined || socket === "") {
    return "SHEPHERD_SOCKET and SHEPHERD_TOKEN must be set together for shepherd mcp"
  }
  return undefined
}

// Connects on the first tool call, not at startup, and keeps the connection.
const lazyClient = (environment: Environment) => {
  const scope = Effect.runSync(Scope.make())
  let pending: Promise<Client> | undefined
  return () => {
    pending ??= retryRecovering(() => runOrThrow(Scope.provide(connect({ environment }), scope))).catch((error) => {
      pending = undefined
      throw error
    })
    return pending
  }
}

const buildToolkit = (environment: Environment) => {
  const clientFor = lazyClient(environment)
  const tools = toolNames.map((name) => Tool.dynamic(name, {
    description: descriptions[name],
    parameters: inputSchema(name),
    success: Schema.Unknown,
    failure: Schema.Unknown
  }))
  const toolkit = Toolkit.make(...tools)
  const handlers = Object.fromEntries(toolNames.map((name: ToolName) => [
    name,
    (parameters: unknown) => Effect.tryPromise({
      try: async () => {
        const client = await clientFor()
        const payload = { ...(parameters as Record<string, unknown>), requestId: randomUUID() }
        return await runOrThrow((client as any)[name](payload) as Effect.Effect<unknown, unknown>)
      },
      catch: (error) => new Error(failureText(error))
    })
  ]))
  return { toolkit, handlers }
}

export const serverLayer = (environment: Environment) => {
  const { toolkit, handlers } = buildToolkit(environment)
  return McpServer.toolkit(toolkit as never).pipe(
    Layer.provide(toolkit.toLayer(handlers as never) as never),
    Layer.provideMerge(McpServer.layerStdio({
      name: "shepherd", version, protocols: [McpProtocol.v2025_11_25]
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
    Effect.catchCause(() => Effect.sync(() => { process.stderr.write("shepherd mcp stopped after an error\n"); return 1 }))
  )
}

export { ClientError }
