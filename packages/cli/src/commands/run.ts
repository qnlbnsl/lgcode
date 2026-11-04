import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { connect } from "@shephrd/client"
import { waitForAgents } from "@shephrd/client/waitForAgents"
import { exportThread } from "./threadExport.ts"
import { type CommandName } from "./registry.ts"
import { type Parsed } from "./parse.ts"
import { describeFailure, err, formatEvent, out } from "./output.ts"
import { sanitizeJson } from "./sanitize.ts"
import { reportWait } from "./wait.ts"

// SIGTERM or SIGINT interrupts a blocking wait; closing its connection
// cancels the wait on the engine (an Interrupt frame, then the socket).
const cancelled = Effect.sync(() => { process.stderr.write("wait cancelled\n") })

// Sends one RPC and prints its answer. Returns the exit code.
export const runCommand = (
  command: CommandName, parsed: Parsed, environment: Readonly<Record<string, string | undefined>>
): Effect.Effect<number> =>
  Effect.scoped(Effect.gen(function* () {
    const client = yield* connect({ environment })
    if (command === "client.wait") return reportWait(yield* waitForAgents(client, parsed.payload as unknown as Parameters<typeof waitForAgents>[1]).pipe(Effect.onInterrupt(() => cancelled)))
    if (command === "thread.export") {
      yield* exportThread(client, parsed.payload!.agentId as string, parsed.out!)
      return 0
    }
    const call = (client as any)[command] as (payload: unknown) => any
    if (command === "subscribe" || command === "client.subscribe") {
      yield* Stream.runForEach(call(parsed.payload) as Stream.Stream<any, unknown>, (envelope) => Effect.sync(() => out(
        envelope.event === undefined ? `${sanitizeJson(envelope)}\n` : formatEvent(envelope)
      )))
      return 0
    }
    if (command === "wait") {
      const reply = yield* (call(parsed.payload) as Effect.Effect<any, unknown>).pipe(
        parsed.block ? Effect.onInterrupt(() => cancelled) : (effect) => effect
      )
      return reportWait(reply)
    }
    const reply = yield* (call(parsed.payload) as Effect.Effect<any, unknown>)
    out(typeof reply?.data === "string" ? `${reply.data}\n` : `${sanitizeJson(reply, 2)}\n`)
    return 0
  })).pipe(
    // A failure that is not a typed one (an invalid payload, say) is a defect.
    Effect.catchCause((cause) => Effect.sync(() => {
      const failure = cause.reasons.find((reason) => reason._tag === "Fail")
      const defect = cause.reasons.find((reason) => reason._tag === "Die")
      err(`shephrd: ${describeFailure(failure !== undefined ? (failure as { error: unknown }).error : (defect as { defect: unknown } | undefined)?.defect)}\n`)
      return 1
    }))
  )
