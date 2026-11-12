import { spawn } from "node:child_process"
import { mkdir, mkdtemp, chmod, writeFile, realpath, readFile, readdir } from "node:fs/promises"
import { join, relative, isAbsolute } from "node:path"
import { tmpdir } from "node:os"
import { createInterface } from "node:readline"
import type { HarnessSettings, PermissionLevel } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import * as Logger from "effect/Logger"
import { buildBaseEnvironment } from "../src/runner/baseEnvironment.ts"

interface ScrubContext {
  readonly homeDirectory: string
  readonly workspace: string
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly sessionIds?: ReadonlySet<string>
}

export function scrubText(text: string, context: ScrubContext): string {
  const replacements = new Map<string, string>()
  const add = (value: string, replacement: string) => {
    for (const form of [value, Buffer.from(value).toString("base64"), Buffer.from(value).toString("base64url"),
      Buffer.from(value).toString("hex"), encodeURIComponent(value), JSON.stringify(value).slice(1, -1)]) {
      if (form) replacements.set(form, replacement)
    }
  }
  for (const value of Object.values(context.environment)) if (value && value.length >= 8) add(value, "<redacted>")
  if (context.homeDirectory) add(context.homeDirectory, "<home>")
  if (context.workspace) add(context.workspace, "<workspace>")
  const ordered = [...replacements].sort(([a], [b]) => b.length - a.length)
  const removePem = (value: string) => value.replace(/-----BEGIN ([A-Z0-9][A-Z0-9 -]*)-----[\s\S]*?-----END \1-----/g, "<redacted>")
  const clean = (value: string) => {
    value = removePem(value)
    for (const [secret, replacement] of ordered) value = value.replaceAll(secret, replacement)
    return value
      .replace(/\b(?:sk-ant-[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]+|AKIA[A-Z0-9]{16}|shp_[ad]_[A-Za-z0-9_-]+)\b/g, "<redacted>")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "<redacted>")
      .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer <redacted>")
      .replace(/\b(?:github_pat_[A-Za-z0-9_]+|AIza[A-Za-z0-9_-]+|xox[abpr]-[A-Za-z0-9-]+|key_[A-Za-z0-9_-]{16,})\b/g, "<redacted>")
      .replace(/[0-9a-f]{32,}/gi, "<redacted>")
      .replace(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}/g, "<email>")
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        (id) => context.sessionIds?.has(id) ? id : "<id>")
  }
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") return clean(value)
    if (typeof value === "number") {
      const original = String(value)
      const scrubbed = clean(original)
      return original === scrubbed ? value : scrubbed
    }
    if (Array.isArray(value)) return value.map(walk)
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [clean(key), walk(item)]))
    return value
  }
  return removePem(text).split("\n").map((line) => {
    try { return JSON.stringify(walk(JSON.parse(line))) } catch { return clean(line) }
  }).join("\n")
}

interface ErrorSample {
  readonly harness: string
  readonly kind: string
  readonly text: string
  readonly source: string
  readonly verified?: boolean
}
interface RecordOptions {
  readonly harnesses: ReadonlyArray<{ readonly id: string; readonly settings?: HarnessSettings; readonly accountVariables?: Readonly<Record<string, string>> }>
  readonly outputDirectory: string
  readonly temporaryRoot: string
  readonly homeDirectory: string
  readonly parentEnvironment: Readonly<Record<string, string | undefined>>
  readonly prompt: string
  readonly scenario?: string
  readonly permission?: PermissionLevel
  readonly harness?: string
  /** An explicit filename requires exactly one selected harness. */
  readonly outputPath?: string
  readonly errorSamples?: ReadonlyArray<ErrorSample>
  /** The owner-run entry point also probes authentication with an empty home. */
  readonly captureSignedOut?: boolean
}
interface PhaseFailure { readonly status: "failed"; readonly category: FailureReason }
type RecordResult =
  | { readonly harness: string; readonly status: "recorded"; readonly file: string; readonly workspace: string; readonly droppedExtensionFrames: number; signedOutNotObserved?: boolean; probe?: PhaseFailure; samples?: PhaseFailure }
  | { readonly harness: string; readonly status: "skipped"; readonly reason: string }
  | { readonly harness: string; readonly status: "failed"; readonly reason: FailureReason }
type Frame = Record<string, any>

type FailureReason = "start" | "initialize" | "read-only mode" | "permission mode" | "prompt" | "timeout" | "other"
class RecordingError extends Error {
  readonly reason: FailureReason | undefined
  constructor(message: string, reason?: FailureReason) { super(message); this.reason = reason }
}

// A leader closing its streams says nothing about descendants in its group.
// Keep the escalation owned by cleanup until no executable group member remains.
async function cleanupGroup(pid: number | undefined, closed: Promise<unknown>): Promise<void> {
  if (pid === undefined) { await closed; return }
  const signal = (name: NodeJS.Signals) => {
    try { process.kill(-pid, name) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw new RecordingError("Unable to terminate recording process group")
    }
  }
  const exists = () => {
    try { process.kill(-pid, 0); return true }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false
      throw new RecordingError("Unable to inspect recording process group")
    }
  }
  const running = async () => {
    if (!exists()) return false
    if (process.platform !== "linux") return true
    // Linux can retain killed orphans as zombies until init reaps them.
    // They cannot execute or hold the workspace. Inspect only state and group.
    for (const entry of await readdir("/proc")) {
      if (!/^\d+$/.test(entry)) continue
      let stat: string
      try { stat = await readFile(`/proc/${entry}/stat`, "utf8") }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error as NodeJS.ErrnoException).code === "ESRCH") continue
        throw new RecordingError("Unable to inspect recording process group")
      }
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
      if (Number(fields[2]) === pid && fields[0] !== "Z" && fields[0] !== "X") return true
    }
    return false
  }
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 25))
  signal("SIGTERM")
  const graceful = Date.now() + 1000
  while (exists() && Date.now() < graceful) await pause()
  if (exists()) signal("SIGKILL")
  await closed
  const forced = Date.now() + 1000
  while (await running()) {
    if (Date.now() >= forced) throw new RecordingError("Recording process group cleanup was not confirmed")
    await pause()
  }
}

// Use the already resolved program, without adapter arguments, a shell or account credentials.
async function cliVersion(settings: HarnessSettings, environment: Record<string, string>, workspace: string,
  scrub: (text: string) => string, signal: AbortSignal): Promise<string | undefined> {
  const child = spawn(settings.adapterPath, ["--version"], { cwd: workspace, env: environment, detached: true, stdio: ["ignore", "pipe", "pipe"] })
  let output = ""
  let failed = false
  const kill = () => {
    failed = true
    if (child.pid !== undefined) { try { process.kill(-child.pid, "SIGKILL") } catch { /* Already exited. */ } }
  }
  child.stdout.on("data", (chunk: Buffer) => {
    if (Buffer.byteLength(output) + chunk.length > 1024 * 1024) kill()
    else output += chunk.toString("utf8")
  })
  child.stderr.resume()
  child.on("error", () => { failed = true })
  signal.addEventListener("abort", kill, { once: true })
  const timer = setTimeout(kill, 10_000)
  if (signal.aborted) kill()
  const closed = new Promise<number | null>((resolve) => child.once("close", resolve))
  try {
    const code = await closed
    if (failed || code !== 0) return undefined
    const line = output.split(/\r?\n/).find((line) => line.trim())
    return line === undefined ? undefined : scrub(line.trim()).trim().slice(0, 100) || undefined
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", kill)
    await cleanupGroup(child.pid, closed)
  }
}

const safeName = (name: string) => /^[a-z][a-z0-9-]*$/.test(name)

async function recordOne(settings: HarnessSettings, environment: Record<string, string>, workspace: string,
  prompt: string, scrub: (text: string, sessionIds?: ReadonlySet<string>) => string, signal: AbortSignal, permission: PermissionLevel, signedOut?: (text: string) => void) {
  // No ACP debug callbacks: these are the actual transport frames, scrubbed before retention.
  const child = spawn(settings.adapterPath, [...settings.adapterArguments], { cwd: workspace, env: environment, detached: true, stdio: ["pipe", "pipe", "pipe"] })
  const terminate = (signal: NodeJS.Signals) => {
    // Each recording owns a new process group, including any harness subprocesses.
    if (child.pid === undefined) return
    try { process.kill(-child.pid, signal) } catch { /* The group has already exited. */ }
  }
  const entries: unknown[] = []
  const sessionIds = new Set<string>()
  let droppedExtensionFrames = 0
  let stage: FailureReason = "initialize"
  let total = 0
  const retain = (type: string, frame: Frame) => {
    const safe = scrub(JSON.stringify({ type, frame }), sessionIds)
    total += Buffer.byteLength(safe)
    if (total > 16 * 1024 * 1024) throw new RecordingError("Recording exceeded the frame limit")
    entries.push(JSON.parse(safe))
  }
  const pending = new Map<number, { resolve: (value: Frame) => void; reject: (error: Error) => void }>()
  let nextId = 0
  let failure: Error | undefined
  let idleResolve: (() => void) | undefined
  let idleReject: ((error: Error) => void) | undefined
  let stderrBytes = 0
  // Drain stderr without retaining it. Even incomplete, split secrets never reach a log.
  child.stderr.on("data", (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 16 * 1024 * 1024) fail(new RecordingError("Adapter stderr exceeded the limit")) })
  const fail = (error: Error) => {
    failure ??= error
    for (const waiter of pending.values()) waiter.reject(failure)
    pending.clear()
    idleReject?.(failure)
  }
  child.on("error", () => fail(new RecordingError("Unable to start adapter", "start")))
  child.stdin.on("error", () => fail(new RecordingError("Adapter input closed")))
  const closed = new Promise<void>((resolve) => child.once("close", () => { fail(new RecordingError("Adapter exited before recording completed")); resolve() }))
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  const send = (frame: Frame) => { retain("expect_outbound", frame); child.stdin.write(JSON.stringify(frame) + "\n") }
  const reader = (async () => {
    try {
      for await (const line of lines) {
        const frame = JSON.parse(line) as Frame
        if (typeof frame.method === "string" && frame.method.startsWith("_")) {
          droppedExtensionFrames++
          continue
        }
        // Session identifiers are protocol references, rather than account identity.
        if (typeof frame.result?.sessionId === "string") sessionIds.add(frame.result.sessionId)
        retain("emit_inbound", frame)
        if (typeof frame.method === "string") {
          if (frame.id !== undefined) {
            const result = frame.method === "session/request_permission" ? { outcome: { outcome: "cancelled" } }
              : frame.method === "elicitation/create" ? { action: "decline" } : undefined
            send(result === undefined
              ? { jsonrpc: "2.0", id: frame.id, error: { code: -32601, message: "Client capability unavailable" } }
              : { jsonrpc: "2.0", id: frame.id, result })
          }
          const update = frame.params?.update
          if (frame.method === "session/update" && update?.sessionUpdate === "state_update" && update.state === "idle") {
            if (update.error?.code === -32000) signedOut?.(scrub(JSON.stringify(update.error)))
            if (update.stopReason === "error" || update.error) fail(new RecordingError("Adapter turn failed"))
            else idleResolve?.()
          }
        } else {
          const waiter = pending.get(frame.id)
          if (waiter) {
            pending.delete(frame.id)
            if (frame.error) {
              if (frame.error.code === -32000) signedOut?.(scrub(JSON.stringify(frame.error)))
              waiter.reject(new RecordingError("Adapter refused a recording request"))
            }
            else waiter.resolve(frame.result ?? {})
          }
        }
      }
    } catch { fail(new RecordingError("Invalid adapter traffic")) }
  })()
  const request = (method: string, params: Frame) => new Promise<Frame>((resolve, reject) => {
    if (failure) { reject(failure); return }
    const id = ++nextId
    pending.set(id, { resolve, reject })
    try { send({ jsonrpc: "2.0", id, method, params }) } catch { fail(new RecordingError("Unable to record adapter request")) }
  })
  const abort = () => { fail(new RecordingError("Recording interrupted")); terminate("SIGTERM") }
  signal.addEventListener("abort", abort, { once: true })
  if (signal.aborted) abort()
  const timer = setTimeout(() => { fail(new RecordingError("Recording timed out", "timeout")); terminate("SIGTERM") }, 60_000)
  try {
    const info = { name: "lgtm-recorder", version: "0.0.1" }
    const initialized = await request("initialize", { protocolVersion: 2, info, clientInfo: info, capabilities: {}, clientCapabilities: {} })
    if (![1, 2].includes(initialized.protocolVersion)) throw new RecordingError("Adapter negotiated an unsupported protocol version")
    // Shipped adapters can report a v1-shaped response even with protocolVersion 2.
    const v2 = initialized.info !== undefined
    stage = permission === "read-only" ? "read-only mode" : "permission mode"
    const session = await request("session/new", { cwd: workspace, mcpServers: [] })
    const mode = (session.configOptions as Array<Frame> | undefined)?.find((option) => option.category === "mode")
    if (!mode) throw new RecordingError("Adapter has no mode configuration option")
    const value = settings.permissionMapping[permission]
    const configId = mode.configId ?? mode.id
    const changed = await request("session/set_config_option", { sessionId: session.sessionId, configId, ...(v2 ? { type: "id" } : {}), value })
    if (!changed.configOptions?.some((option: Frame) => (option.configId ?? option.id) === configId && option.currentValue === value)) {
      throw new RecordingError("Adapter did not confirm the selected permission mode")
    }
    stage = "prompt"
    const idle = v2 ? new Promise<void>((resolve, reject) => { idleResolve = resolve; idleReject = reject }) : Promise.resolve()
    // Attach rejection handling before issuing a prompt: a child exit rejects both waits.
    const prompted = request("session/prompt", { sessionId: session.sessionId, prompt: [{ type: "text", text: prompt }] })
    const [reply] = await Promise.all([prompted, idle])
    if (reply.stopReason === "error") throw new RecordingError("Adapter turn failed")
    const version = [initialized.info?.version, initialized.agentInfo?.version].find((value) => typeof value === "string" && value.trim())
    return { version, protocolVersion: initialized.protocolVersion, entries, sessionIds, droppedExtensionFrames }
  } catch (error) {
    throw new RecordingError("Harness recording failed", error instanceof RecordingError ? error.reason ?? stage : stage)
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", abort)
    idleReject = undefined
    child.stdin.end()
    try { await cleanupGroup(child.pid, closed) }
    finally { await reader; lines.close() }
  }
}

// The recording itself, apart from Effect, so a caller that owns a cancellation
// signal (`pnpm live-check`) can await the end of the recorder's process-group cleanup.
export const runRecording = async (options: RecordOptions, signal: AbortSignal) => {
    const harnesses = options.harnesses.filter((harness) => options.harness === undefined || harness.id === options.harness)
    if (options.harness !== undefined && harnesses.length === 0) throw new RecordingError("Unknown selected harness")
    if (options.outputPath !== undefined && harnesses.length !== 1) throw new RecordingError("An output filename requires one harness")
    if (options.scenario !== undefined && !safeName(options.scenario)) throw new RecordingError("Invalid scenario name")
    const permission = options.permission ?? "read-only"
    if (!["read-only", "ask", "edit", "full"].includes(permission)) throw new RecordingError("Invalid permission level")
    const lexicalTemporaryPath = relative(tmpdir(), options.temporaryRoot)
    if (lexicalTemporaryPath.startsWith("..") || isAbsolute(lexicalTemporaryPath)) throw new RecordingError("Recording workspaces must be inside the system temporary folder")
    for (const sample of options.errorSamples ?? []) {
      if (!sample.source.trim() || !safeName(sample.harness) || !safeName(sample.kind)) throw new RecordingError("Error samples require a source and safe names")
    }
    if (options.harnesses.some((harness) => !safeName(harness.id))) throw new RecordingError("Invalid harness id")
    await mkdir(options.outputDirectory, { recursive: true, mode: 0o700 })
    await mkdir(options.temporaryRoot, { recursive: true, mode: 0o700 })
    const temporaryPath = relative(await realpath(tmpdir()), await realpath(options.temporaryRoot))
    if (temporaryPath.startsWith("..") || isAbsolute(temporaryPath)) throw new RecordingError("Recording workspaces must be inside the system temporary folder")
    const results: RecordResult[] = []
    const markFailed = (harness: string, error: unknown, phase?: "probe" | "samples") => {
      const index = results.findIndex((result) => result.harness === harness)
      const category = error instanceof RecordingError ? error.reason ?? "other" : "other"
      const result = results[index]
      // A later probe or sample failure does not erase a successfully written fixture.
      if (phase && result?.status === "recorded") { result[phase] = { status: "failed", category }; return }
      const failed: RecordResult = { harness, status: "failed", reason: category }
      if (index < 0) results.push(failed)
      else if (results[index]?.status !== "failed") results[index] = failed
    }
    // Keep every value even when different accounts use the same variable name.
    const allEnvironment: Record<string, string | undefined> = {}
    let secretIndex = 0
    for (const source of [options.parentEnvironment, ...options.harnesses.map((harness) => harness.accountVariables ?? {})]) {
      for (const value of Object.values(source)) allEnvironment[String(secretIndex++)] = value
    }
    for (const harness of harnesses) {
      if (!harness.settings) { results.push({ harness: harness.id, status: "skipped", reason: "Harness is not installed" }); continue }
      try {
        const workspace = await mkdtemp(join(options.temporaryRoot, `${harness.id}-`))
        await chmod(workspace, 0o700)
        const environment = buildBaseEnvironment({ parent: options.parentEnvironment, ...(harness.accountVariables ? { accountVariables: harness.accountVariables } : {}) })
        const scrub = (text: string, sessionIds?: ReadonlySet<string>) => scrubText(text, { homeDirectory: options.homeDirectory, workspace, environment: { ...allEnvironment, ...environment }, ...(sessionIds ? { sessionIds } : {}) })
        const recording = await recordOne(harness.settings, environment, workspace, options.prompt, scrub, signal, permission)
        const fallback = recording.version ? undefined : await cliVersion(harness.settings,
          buildBaseEnvironment({ parent: options.parentEnvironment }), workspace, scrub, signal)
        const version = recording.version ?? fallback ?? "unknown"
        const versionSource = recording.version ? "adapter" : fallback ? "cli" : "unknown"
        const header = { type: "transcript_start", provider: harness.id, protocol: "acp", version, scenario: options.scenario ?? "read-only-greeting", metadata: { protocolVersion: recording.protocolVersion, versionSource } }
        const text = [header, ...recording.entries, { type: "runtime_exit", status: "success" }].map((entry) => scrub(JSON.stringify(entry), recording.sessionIds)).join("\n") + "\n"
        const file = options.outputPath ?? join(options.outputDirectory, `${harness.id}.ndjson`)
        await writeFile(file, text, { mode: 0o600 })
        // The caller owns outputDirectory. Do not echo its private home path in results.
        results.push({ harness: harness.id, status: "recorded", file: scrub(file), workspace, droppedExtensionFrames: recording.droppedExtensionFrames })
      } catch (error) { markFailed(harness.id, error) }
    }
    const samples: ErrorSample[] = (options.errorSamples ?? []).filter((sample) => options.harness === undefined || sample.harness === options.harness)
    if (options.captureSignedOut) {
      for (const harness of harnesses) {
        if (!harness.settings || results.find((result) => result.harness === harness.id)?.status !== "recorded") continue
        try {
          const homeDirectory = await mkdtemp(join(options.temporaryRoot, `${harness.id}-signed-out-home-`))
          const workspace = await mkdtemp(join(options.temporaryRoot, `${harness.id}-signed-out-work-`))
          await chmod(homeDirectory, 0o700)
          await chmod(workspace, 0o700)
          const environment = buildBaseEnvironment({ parent: options.parentEnvironment })
          // No account variables or provider keys are carried into the signed-out probe.
          Object.assign(environment, { HOME: homeDirectory, TMPDIR: homeDirectory, XDG_CONFIG_HOME: homeDirectory,
            CLAUDE_CONFIG_DIR: homeDirectory, CODEX_HOME: homeDirectory, GEMINI_CLI_HOME: homeDirectory, CURSOR_CONFIG_DIR: homeDirectory })
          let captured: string | undefined
          try {
            await recordOne(harness.settings, environment, workspace, options.prompt,
              (text) => scrubText(text, { homeDirectory: options.homeDirectory, workspace, environment: { ...allEnvironment, ...environment } }), signal, permission,
              (text) => { captured = text })
          } catch (error) {
            // An authentication refusal is the expected outcome of this probe.
            if (!captured) markFailed(harness.id, error, "probe")
          }
          if (!captured) {
            const result = results.find((result) => result.harness === harness.id)
            if (result?.status === "recorded") result.signedOutNotObserved = true
            continue
          }
          samples.push({ harness: harness.id, kind: "signed-out", text: captured, source: "Recorded from the installed adapter with an empty temporary home and no account variables", verified: true })
        } catch (error) { markFailed(harness.id, error, "probe") }
      }
    }
    for (const sample of samples) {
      try {
        const directory = join(options.outputDirectory, "errors")
        await mkdir(directory, { recursive: true, mode: 0o700 })
        const text = scrubText(JSON.stringify({ ...sample, verified: sample.verified ?? false }), { homeDirectory: options.homeDirectory, workspace: "", environment: allEnvironment })
        await writeFile(join(directory, `${sample.harness}-${sample.kind}.json`), text + "\n", { mode: 0o600 })
      } catch (error) { markFailed(sample.harness, error, "samples") }
    }
    return results
}

export const recordFixtures = (options: RecordOptions) => Effect.tryPromise({
  try: (signal) => runRecording(options, signal),
  // Never retain a raw transport, filesystem or child-process error as a cause.
  catch: (error) => error instanceof RecordingError ? error : new RecordingError("Fixture recording failed")
}).pipe(Effect.provide(Logger.layer([Logger.make(() => { process.stderr.write("[redacted recorder diagnostic]\n") })])))

export const hasRecordingFailures = (results: ReadonlyArray<RecordResult>): boolean => results.some((result) =>
  result.status === "failed" || (result.status === "recorded" && (result.probe !== undefined || result.samples !== undefined)))

export const formatReport = (results: ReadonlyArray<RecordResult>): string => {
  const lines = results.map((result) =>
    `${result.harness}: ${result.status}${result.status !== "recorded" ? ` (${result.reason})` : `; droppedExtensionFrames: ${result.droppedExtensionFrames}${result.signedOutNotObserved ? "; signedOutNotObserved" : ""}`}`)
  const failed = results.flatMap((result) => result.status === "failed" ? [`${result.harness}: ${result.reason}`]
    : result.status !== "recorded" ? [] : [
      ...(result.probe ? [`${result.harness} signed-out probe: ${result.probe.category}`] : []),
      ...(result.samples ? [`${result.harness} error samples: ${result.samples.category}`] : [])
    ])
  return [...lines, ...(failed.length ? ["failed:", ...failed] : [])].join("\n")
}
