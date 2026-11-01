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
import { writeFileSync } from "node:fs"
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
  | { step: "permission"; toolCallId: string; title: string; options: AcpSchema.PermissionOption[]; locations?: Array<{ path: string }> }
  | { step: "question"; message: string; requestedSchema: Record<string, unknown> }
  | { step: "mode_change"; configId: string; value: string }
  | { step: "config_options"; configOptions: AcpSchema.SessionConfigOption[] }
  | { step: "shepherd_command"; command: string; input: unknown }
  | { step: "end_turn"; stopReason: string }
  | { step: "crash"; exitCode: number }
  // Unit 6c tests: the agent sends itself the signal, so the runner sees a death by signal with no exit code.
  | { step: "kill_self"; signal: "SIGKILL" | "SIGTERM" | "SIGSEGV" | "SIGABRT" }
  | { step: "out_of_usage"; message: string; resetsAt: string }
  | { step: "signed_out"; message: string; via?: "idle" | "rpc" }
  | { step: "slow"; ms: number }
  | { step: "print_env" }
  // Unit 6a. Text in these steps expands ${env:NAME} to the child's own variable, ${env-u:NAME}
  // to the same value written as JSON \u escapes (raw frames only) and ${session} to the session id.
  | { step: "stderr"; text: string }
  // Unit 6c tests: writes the expanded text to stderr as given, with no line end added, so a script can
  // split one line (and a secret in it) across two chunks by putting a `slow` step between two of these.
  | { step: "stderr_part"; text: string }
  | { step: "rpc_error"; message: string; code?: number }
  | { step: "raw_frame"; frame: string }
  | { step: "client_request"; method: string; params: Schema.Json }
  // Unit 6a fix round 2 (F-9): sends a text chunk `ms` milliseconds after the turn's idle state, so it
  // arrives after the session/prompt reply, then the plan, if given. The turn's other steps run first.
  | { step: "text_after_turn"; text: string; ms: number; plan?: AcpSchema.PlanEntry[] }
interface Script {
  protocolVersion?: 1 | 2
  reportVersion?: boolean
  agentInfo?: { name: string; version: string }
  configOptions?: AcpSchema.SessionConfigOption[]
  // Unit 6a: refuse set_config_option for an unknown option or a value the option does not list.
  strictConfigOptions?: boolean
  history?: Array<{ role: "user" | "agent"; text: string }>
  turns: Step[][]
}

const environment = process.env

// Unit 6a: when FAKE_AGENT_ECHO names a file, the agent writes there, after every inbound frame,
// what it was started with (pid, arguments, working folder, environment) and every frame it
// received. Nothing is written without the variable.
const echoPath = environment.FAKE_AGENT_ECHO
const echo = { pid: process.pid, argv: [...process.argv], cwd: process.cwd(), env: { ...environment }, inbound: [] as Array<unknown> }
const writeEcho = () => { if (echoPath !== undefined) writeFileSync(echoPath, JSON.stringify(echo), { mode: 0o600 }) }
writeEcho()

const expand = (text: string, sessionId: string) => text.replace(/\$\{(env|env-u):([A-Za-z_][A-Za-z0-9_]*)\}|\$\{session\}/g, (match, kind, name) => {
  if (match === "${session}") return sessionId
  const value = environment[name] ?? ""
  return kind === "env" ? value : [...value].map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).join("")
})
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

const recordingStdio = Layer.effect(Stdio.Stdio, Effect.gen(function*() {
  const stdio = yield* Stdio.Stdio
  const record = (line: string) => {
    try { echo.inbound.push(JSON.parse(line)) } catch { echo.inbound.push({ unparsable: line.length }) }
    writeEcho()
    return line + "\n"
  }
  return Stdio.make({ ...stdio,
    stdin: stdio.stdin.pipe(Stream.decodeText(), Stream.splitLines, Stream.filter((line) => line.trim().length > 0), Stream.map(record), Stream.encodeText)
  })
}))

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
    // The scripted v1 peer advertises loadSession; its underlying server is v2.
    if (script.protocolVersion === 1 && frame.method === "session/load") {
      frame.method = "session/resume"
      for (const server of frame.params.mcpServers ?? []) server.type ??= "stdio"
    }
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
    if (script.protocolVersion === 1 && frame.result && methods.get(frame.id) === "session/load") {
      frame.result.configOptions = (frame.result.configOptions ?? []).map(({ configId, ...option }: { configId: string }) => ({ ...option, id: configId }))
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
    if (script.strictConfigOptions === true) {
      const option = session.options.find((candidate) => candidate.configId === request.configId) as { options?: Array<{ value?: unknown }> } | undefined
      if (option === undefined || (Array.isArray(option.options) && !option.options.some((choice) => choice.value === request.value))) {
        return Effect.fail(AcpRequestError.invalidParams("Unknown configuration value"))
      }
    }
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
    const afterTurn: Array<{ text: string; ms: number; plan?: AcpSchema.PlanEntry[] }> = []
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
            const toolCall = { toolCallId: step.toolCallId, title: step.title, ...(step.locations === undefined ? {} : { locations: step.locations }) }
            const response = yield* agent.client.requestPermission({ sessionId: request.sessionId, title: step.title, options: step.options, subject: { type: "tool_call", toolCall } })
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
          case "stderr": {
            const line = expand(step.text, request.sessionId) + "\n"
            yield* Effect.callback<void>((resume) => { process.stderr.write(line, () => resume(Effect.void)) })
            break
          }
          case "stderr_part": {
            const part = expand(step.text, request.sessionId)
            yield* Effect.callback<void>((resume) => { process.stderr.write(part, () => resume(Effect.void)) })
            break
          }
          case "rpc_error": return yield* Effect.fail(new AcpRequestError({ code: step.code ?? -32603, errorMessage: expand(step.message, request.sessionId) }))
          case "raw_frame": {
            const line = expand(step.frame, request.sessionId) + "\n"
            yield* Effect.callback<void>((resume) => { process.stdout.write(line, () => resume(Effect.void)) })
            break
          }
          case "client_request": {
            const outcome = yield* agent.raw.request(step.method, step.params).pipe(
              Effect.map(() => "ok"),
              Effect.catch((error) => Effect.succeed(`error:${(error as { code?: unknown }).code ?? "unknown"}`))
            )
            yield* text(`client_request:${step.method}:${outcome}`)
            break
          }
          case "slow": yield* Effect.sleep(step.ms); break
          case "text_after_turn": afterTurn.push(step); break
          case "crash":
            // Flush queued transport writes before simulating an abrupt process exit.
            yield* Effect.sleep(10)
            yield* Effect.callback<void>((resume) => { process.stdout.write("", () => resume(Effect.void)) })
            process.exit(step.exitCode)
          case "kill_self":
            // Flush queued transport writes first, as the crash step does, then die by the signal.
            yield* Effect.sleep(10)
            yield* Effect.callback<void>((resume) => { process.stderr.write("", () => resume(Effect.void)) })
            process.kill(process.pid, step.signal)
            yield* Effect.sleep(5_000)
            continue
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
    for (const late of afterTurn) {
      const plan = late.plan === undefined ? Effect.void
        : update({ sessionUpdate: "plan_update", plan: { type: "items", planId: "late-plan", entries: late.plan } })
      yield* Effect.sleep(late.ms).pipe(Effect.andThen(text(late.text)), Effect.andThen(plan), Effect.ignore, Effect.forkDetach)
    }
    return {}
  }))
  return yield* Effect.never
})

Effect.runPromise(program.pipe(
  // The recorder reads the raw wire, beneath the version adapter.
  Effect.provide(AcpAgent.layerStdio().pipe(Layer.provide(((base) => script.protocolVersion === 1 || script.reportVersion === false ? scriptedStdio.pipe(Layer.provide(base)) : base)(
    echoPath === undefined ? NodeServices.layer : recordingStdio.pipe(Layer.provide(NodeServices.layer)))))),
  Effect.provide(Logger.layer([safeLogger])),
  Effect.scoped
)).catch(() => { process.stderr.write("Fake agent failed\n"); process.exitCode = 1 })
