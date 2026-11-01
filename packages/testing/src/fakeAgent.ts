import * as NodeServices from "@effect/platform-node/NodeServices"
import * as AcpAgent from "@shepherd/t3-effect-acp/agent"
import { AcpRequestError } from "@shepherd/t3-effect-acp/errors"
import type * as AcpSchema from "@shepherd/t3-effect-acp/schema"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import WebSocket from "ws"

type Step =
  | { step: "text"; text: string }
  | { step: "plan"; entries: AcpSchema.PlanEntry[] }
  | { step: "tool_call"; toolCallId: string; title: string; kind: AcpSchema.ToolKind; status: AcpSchema.ToolCallStatus; output: string }
  | { step: "file_change"; toolCallId: string; path: string; operation: string; patch: string }
  | { step: "permission"; toolCallId: string; title: string; options: AcpSchema.PermissionOption[] }
  | { step: "question"; message: string; requestedSchema: Record<string, unknown> }
  | { step: "mode_change"; configId: string; value: string }
  | { step: "config_options"; configOptions: AcpSchema.SessionConfigOption[] }
  | { step: "shepherd_command"; command: string; input: unknown }
  | { step: "end_turn"; stopReason: string }
  | { step: "crash"; exitCode: number }
  | { step: "out_of_usage"; message: string; resetsAt: string }
  | { step: "signed_out"; message: string; via?: "idle" | "rpc" }
  | { step: "slow"; ms: number }
  | { step: "print_env" }
interface Script {
  agentInfo?: { name: string; version: string }
  configOptions?: AcpSchema.SessionConfigOption[]
  history?: Array<{ role: "user" | "agent"; text: string }>
  turns: Step[][]
}

const environment = process.env
let script: Script
try {
  if (environment.FAKE_AGENT_SCRIPT === undefined) throw new Error()
  script = JSON.parse(environment.FAKE_AGENT_SCRIPT) as Script
  if (!Array.isArray(script.turns)) throw new Error()
} catch {
  process.stderr.write("FAKE_AGENT_SCRIPT must contain a JSON script with turns\n")
  process.exit(1)
}

// Drop every diagnostic field, including annotations and causes. Wire logging is never enabled.
const safeLogger = Logger.make(() => { process.stderr.write("[redacted agent diagnostic]\n") })

const shepherdCommand = (command: string, input: unknown) => Effect.callback<string>((resume) => {
  const socket = environment.SHEPHERD_SOCKET
  const token = environment.SHEPHERD_TOKEN
  if (!socket || !token) { resume(Effect.succeed("shepherd_command:failed")); return }
  const connection = new WebSocket(`ws+unix://${socket}:/`, { headers: { Authorization: `Bearer ${token}` } })
  let settled = false
  const finish = (result: string) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    connection.terminate()
    resume(Effect.succeed(result))
  }
  const timer = setTimeout(() => finish("shepherd_command:failed"), 5000)
  connection.on("open", () => connection.send(JSON.stringify({ command, input })))
  connection.on("message", () => finish("shepherd_command:ok"))
  connection.on("error", () => finish("shepherd_command:failed"))
  connection.on("close", () => finish("shepherd_command:failed"))
  return Effect.sync(() => { clearTimeout(timer); connection.terminate() })
})

const program = Effect.gen(function*() {
  const agent = yield* AcpAgent.AcpAgent
  const sessions = new Map<string, { turn: number; options: AcpSchema.SessionConfigOption[]; cancel?: Deferred.Deferred<void> }>()
  let nextSession = 0
  yield* agent.handleInitialize(() => Effect.succeed({ protocolVersion: 2, info: script.agentInfo ?? { name: "fake-agent", version: "0.0.0" }, capabilities: { session: {} } }))
  yield* agent.handleCreateSession(() => Effect.sync(() => {
    const sessionId = `fake-session-${++nextSession}`
    const options = structuredClone(script.configOptions ?? [])
    sessions.set(sessionId, { turn: 0, options })
    return { sessionId, configOptions: options }
  }))
  yield* agent.handleLoadSession((request) => Effect.gen(function*() {
    const options = structuredClone(script.configOptions ?? [])
    sessions.set(request.sessionId, { turn: 0, options })
    for (const item of script.history ?? []) {
      yield* agent.client.sessionUpdate({ sessionId: request.sessionId, update: {
        sessionUpdate: item.role === "user" ? "user_message_chunk" : "agent_message_chunk",
        content: { type: "text", text: item.text }
      } })
    }
    return { configOptions: options }
  }))
  yield* agent.handleSetSessionConfigOption((request) => Effect.suspend(() => {
    const session = sessions.get(request.sessionId)
    if (!session) return Effect.fail(AcpRequestError.invalidParams("Unknown session"))
    session.options = session.options.map((option) => option.configId === request.configId
      ? { ...option, currentValue: request.value } as AcpSchema.SessionConfigOption : option)
    return Effect.succeed({ configOptions: session.options })
  }))
  yield* agent.handleCancel((request) => {
    const cancel = sessions.get(request.sessionId)?.cancel
    return cancel ? Deferred.succeed(cancel, undefined).pipe(Effect.asVoid) : Effect.void
  })
  yield* agent.handlePrompt((request) => Effect.gen(function*() {
    const session = sessions.get(request.sessionId)
    if (!session) return yield* Effect.fail(AcpRequestError.invalidParams("Unknown session"))
    const cancel = yield* Deferred.make<void>()
    session.cancel = cancel
    const update = (value: AcpSchema.SessionNotification["update"]) => agent.client.sessionUpdate({ sessionId: request.sessionId, update: value })
    const text = (value: string) => update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: value } })
    yield* update({ sessionUpdate: "state_update", state: "running" })
    const steps = script.turns[session.turn++] ?? []
    const run = Effect.gen(function*() {
      for (const step of steps) {
        switch (step.step) {
          case "text": yield* text(step.text); break
          case "plan": yield* update({ sessionUpdate: "plan_update", plan: { type: "items", planId: "script-plan", entries: step.entries } }); break
          case "tool_call": yield* update({ sessionUpdate: "tool_call_update", toolCallId: step.toolCallId, title: step.title, kind: step.kind, status: step.status, content: [{ type: "content", content: { type: "text", text: step.output } }] }); break
          case "file_change": yield* update({ sessionUpdate: "tool_call_update", toolCallId: step.toolCallId, content: [{ type: "diff", changes: [{ operation: step.operation, path: step.path }], patch: { format: "git_patch", text: step.patch } }] } as AcpSchema.SessionNotification["update"]); break
          case "permission": {
            const response = yield* agent.client.requestPermission({ sessionId: request.sessionId, title: step.title, options: step.options, subject: { type: "tool_call", toolCall: { toolCallId: step.toolCallId, title: step.title } } })
            yield* text(response.outcome.outcome === "selected" ? `permission:selected:${response.outcome.optionId}` : "permission:cancelled")
            break
          }
          case "question": {
            const response = yield* agent.client.elicit({ sessionId: request.sessionId, mode: "form", message: step.message, requestedSchema: step.requestedSchema } as AcpSchema.CreateElicitationRequest)
            yield* text(response.action === "accept" ? `question:accept:${JSON.stringify("content" in response ? response.content : {})}` : "question:decline")
            break
          }
          case "mode_change":
            session.options = session.options.map((option) => option.configId === step.configId ? { ...option, currentValue: step.value } as AcpSchema.SessionConfigOption : option)
            yield* update({ sessionUpdate: "config_option_update", configOptions: session.options }); break
          case "config_options": session.options = step.configOptions; yield* update({ sessionUpdate: "config_option_update", configOptions: session.options }); break
          case "shepherd_command": yield* text(yield* shepherdCommand(step.command, step.input)); break
          case "print_env": yield* text(Object.entries(environment).map(([name, value]) => `${name}=${value}`).join("\n")); break
          case "slow": yield* Effect.sleep(step.ms); break
          case "crash":
            // Flush queued transport writes before simulating an abrupt process exit.
            yield* Effect.sleep(10)
            yield* Effect.callback<void>((resume) => { process.stdout.write("", () => resume(Effect.void)) })
            process.exit(step.exitCode)
          case "end_turn": return { stopReason: step.stopReason }
          case "out_of_usage": return { stopReason: "error", error: { code: -32001, message: step.message, data: { resetsAt: step.resetsAt } } }
          case "signed_out":
            if (step.via === "rpc") return yield* Effect.fail(new AcpRequestError({ code: -32000, errorMessage: step.message }))
            return { stopReason: "error", error: { code: -32000, message: step.message } }
        }
      }
      return { stopReason: "end_turn" }
    })
    const result = yield* Effect.raceFirst(run, Deferred.await(cancel).pipe(Effect.as({ stopReason: "cancelled" })))
    yield* update({ sessionUpdate: "state_update", state: "idle", ...result } as AcpSchema.SessionNotification["update"])
    delete session.cancel
    return {}
  }))
  return yield* Effect.never
})

Effect.runPromise(program.pipe(
  Effect.provide(AcpAgent.layerStdio().pipe(Layer.provide(NodeServices.layer))),
  Effect.provide(Logger.layer([safeLogger])),
  Effect.scoped
)).catch(() => { process.stderr.write("Fake agent failed\n"); process.exitCode = 1 })
