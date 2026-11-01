import * as NodeServices from "@effect/platform-node/NodeServices"
import * as AcpAgent from "@shepherd/t3-effect-acp/agent"
import { AcpRequestError } from "@shepherd/t3-effect-acp/errors"
import type * as AcpSchema from "@shepherd/t3-effect-acp/schema"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import type * as Schema from "effect/Schema"
import * as Sink from "effect/Sink"
import * as Stdio from "effect/Stdio"
import * as Stream from "effect/Stream"
import { spawn, type ChildProcess } from "node:child_process"
import WebSocket from "ws"

type DiagnosticStep =
  | { type: "ext_notification"; method: string; params: Schema.Json }
  | { type: "stderr_flood"; bytes: number }
  | { type: "spawn_grandchild" }
type StepDiagnostic = DiagnosticStep extends infer D ? D extends { type: infer T } ? Omit<D, "type"> & { step: T } : never : never
type Step = DiagnosticStep | StepDiagnostic
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
  protocolVersion?: 1 | 2
  reportVersion?: boolean
  agentInfo?: { name: string; version: string }
  configOptions?: AcpSchema.SessionConfigOption[]
  history?: Array<{ role: "user" | "agent"; text: string }>
  turns: Step[][]
}

const environment = process.env
if (process.argv.length === 3 && process.argv[2] === "--version") {
  process.stdout.write("fake-agent 0.0.0\n")
  process.exit(0)
}
let script: Script
try {
  if (environment.FAKE_AGENT_SCRIPT === undefined) throw new Error()
  script = JSON.parse(environment.FAKE_AGENT_SCRIPT) as Script
  if (!Array.isArray(script.turns) || (script.protocolVersion !== undefined && script.protocolVersion !== 1 && script.protocolVersion !== 2)) throw new Error()
} catch {
  process.stderr.write("FAKE_AGENT_SCRIPT must contain a JSON script with turns\n")
  process.exit(1)
}

// Drop every diagnostic field, including annotations and causes. Wire logging is never enabled.
const safeLogger = Logger.make(() => { process.stderr.write("[redacted agent diagnostic]\n") })

// Reap diagnostic subprocesses before exiting, including when the recorder kills our group.
const grandchildren = new Map<ChildProcess, Promise<void>>()
process.on("SIGTERM", () => {
  for (const child of grandchildren.keys()) child.kill("SIGTERM")
  void Promise.all(grandchildren.values()).then(() => process.exit(0))
})
const spawnGrandchild = () => Effect.callback<number, AcpRequestError>((resume) => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000)"], { env: environment, stdio: "ignore" })
  const closed = new Promise<void>((resolve) => child.once("close", () => { grandchildren.delete(child); resolve() }))
  grandchildren.set(child, closed)
  child.once("spawn", () => resume(Effect.succeed(child.pid!)))
  child.once("error", () => resume(Effect.fail(AcpRequestError.internalError("Unable to start diagnostic child"))))
})
const floodStderr = (bytes: number) => Effect.callback<void, AcpRequestError>((resume) => {
  if (!Number.isSafeInteger(bytes) || bytes < 0) { resume(Effect.fail(AcpRequestError.invalidParams("Invalid stderr byte count"))); return }
  const write = (remaining: number) => {
    if (remaining === 0) { resume(Effect.void); return }
    const count = Math.min(remaining, 65536)
    process.stderr.write(Buffer.alloc(count, 120), (error) => {
      if (error) resume(Effect.fail(AcpRequestError.internalError("Unable to write diagnostic stderr")))
      else write(remaining - count)
    })
  }
  write(bytes)
})

// Adapt the v2 server's wire output for scripts with v1 responses or no version.
const scriptedStdio = Layer.effect(Stdio.Stdio, Effect.gen(function*() {
  const stdio = yield* Stdio.Stdio
  const methods = new Map<string | number, string>()
  const stops = new Map<string, string>()
  const inbound = (line: string) => {
    const frame = JSON.parse(line)
    if (frame.id !== undefined && typeof frame.method === "string") methods.set(frame.id, frame.method)
    if (frame.method === "initialize") frame.params = { ...frame.params, info: frame.params.info ?? frame.params.clientInfo, capabilities: frame.params.capabilities ?? frame.params.clientCapabilities ?? {} }
    if (frame.method === "session/set_config_option") frame.params.type ??= "id"
    return JSON.stringify(frame) + "\n"
  }
  const outbound = (chunk: string | Uint8Array) => Buffer.from(chunk).toString().split("\n").filter(Boolean).map((line) => {
    const frame = JSON.parse(line)
    const update = frame.params?.update
    if (update?.sessionUpdate === "state_update" && update.state === "idle") stops.set(frame.params.sessionId, update.stopReason)
    if (frame.result && methods.get(frame.id) === "initialize") {
      if (script.reportVersion === false) delete frame.result.info.version
      if (script.protocolVersion === 1) frame.result = { protocolVersion: 1, agentInfo: frame.result.info, agentCapabilities: { loadSession: true }, authMethods: [] }
    }
    if (script.protocolVersion === 1 && frame.result && methods.get(frame.id) === "session/prompt") frame.result.stopReason = [...stops.values()].at(-1) ?? "end_turn"
    if (frame.id !== undefined && frame.method === undefined) methods.delete(frame.id)
    return JSON.stringify(frame) + "\n"
  }).join("")
  return Stdio.make({ ...stdio,
    stdin: stdio.stdin.pipe(Stream.decodeText(), Stream.splitLines, Stream.filter((line) => line.trim().length > 0), Stream.map(inbound), Stream.encodeText),
    stdout: (options) => Sink.mapInput(stdio.stdout(options), outbound)
  })
}))

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
        const diagnostic = "type" in step ? { ...step, step: step.type } as StepDiagnostic : step
        switch (diagnostic.step) {
          case "ext_notification": yield* agent.client.extNotification(diagnostic.method, diagnostic.params); continue
          case "stderr_flood": yield* floodStderr(diagnostic.bytes); continue
          case "spawn_grandchild": yield* text(`grandchild pid: ${yield* spawnGrandchild()}`); continue
        }
        if ("type" in step) continue
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
  Effect.provide(AcpAgent.layerStdio().pipe(Layer.provide(script.protocolVersion === 1 || script.reportVersion === false ? scriptedStdio.pipe(Layer.provide(NodeServices.layer)) : NodeServices.layer))),
  Effect.provide(Logger.layer([safeLogger])),
  Effect.scoped
)).catch(() => { process.stderr.write("Fake agent failed\n"); process.exitCode = 1 })
