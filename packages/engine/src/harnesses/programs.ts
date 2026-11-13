import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { access, mkdir, stat } from "node:fs/promises"
import { delimiter, isAbsolute, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { HarnessInstallation, HarnessRecipe, HarnessSettings } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import { credentialSourceFor, type CredentialRegistry } from "../accounts/credentialSource.ts"
import { installRecipes, type RecipeDefinition } from "./recipes.ts"

export interface InstallStep { readonly executable: string; readonly args: ReadonlyArray<string> }
export interface ProcessResult { readonly ok: boolean; readonly output: string; readonly reason?: string }
const outputLimit = 64 * 1024
export const userHarnessPrefix = (home: string) => join(home, ".local", "share", "lgtm", "harnesses")
export const userHarnessBin = (home: string) => join(userHarnessPrefix(home), "bin")
export const quoteCommand = (words: ReadonlyArray<string>) => words.map((s) => `'${s.replaceAll("'", "'\\''")}'`).join(" ")

// A small environment prevents npm configuration and provider credentials from
// becoming installer inputs. In particular, npm's user/project config is disabled.
const environment = (home: string): NodeJS.ProcessEnv => ({ HOME: home,
  PATH: `${userHarnessBin(home)}${delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`,
  ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
  npm_config_userconfig: "/dev/null", npm_config_globalconfig: "/dev/null",
  npm_config_cache: join(userHarnessPrefix(home), "cache"), CI: "1" })

const execute = (step: InstallStep, options: { home: string; timeoutMs: number; signal?: AbortSignal }): Promise<ProcessResult> => new Promise((resolve) => {
  // spawn does not invoke a shell. Killing the process group also stops npm
  // lifecycle children. Its output is bounded before entering the redactor.
  let timeout = false, oversized = false, output = Buffer.alloc(0), settled = false
  const child = spawn(step.executable, [...step.args], { cwd: options.home, env: environment(options.home), shell: false,
    detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] })
  const finish = (code: number | null, failed = false) => {
    if (settled) return
    settled = true; clearTimeout(timer); options.signal?.removeEventListener("abort", abort)
    const reason = timeout ? "The install exceeded its time limit." : oversized ? "The install produced too much output."
      : options.signal?.aborted ? "The install was cancelled." : !failed && code === 0 ? undefined
      : code !== null ? `The install command exited with code ${code}.` : "The install command could not run."
    // Forced termination can cut a secret mid-value. Do not expose an
    // incomplete capture that the full-value redactor could not recognize.
    resolve({ ok: reason === undefined, output: timeout || oversized || options.signal?.aborted || code === null ? "" : output.toString("utf8"), ...(reason === undefined ? {} : { reason }) })
  }
  child.once("error", () => finish(null, true))
  child.once("close", (code) => finish(code))
  const stop = () => { try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL") } catch { child.kill("SIGKILL") } }
  const capture = (data: Buffer) => {
    if (oversized) return
    if (output.length + data.length > outputLimit) { oversized = true; output = Buffer.alloc(0); stop() }
    else output = Buffer.concat([output, data])
  }
  child.stdout?.on("data", capture); child.stderr?.on("data", capture)
  const abort = () => stop()
  const timer = setTimeout(() => { timeout = true; stop() }, options.timeoutMs)
  options.signal?.addEventListener("abort", abort, { once: true })
  if (options.signal?.aborted) abort()
})

export async function runRecipe(steps: ReadonlyArray<InstallStep>, options: { home: string; timeoutMs: number; signal?: AbortSignal }): Promise<ProcessResult> {
  const deadline = Date.now() + options.timeoutMs
  let output = ""
  for (const step of steps) {
    if (options.signal?.aborted) return { ok: false, output, reason: "The install was cancelled." }
    const result = await execute(step, { ...options, timeoutMs: Math.max(1, deadline - Date.now()) })
    output += result.output
    if (Buffer.byteLength(output) > outputLimit) return { ok: false, output: "", reason: "The install produced too much output." }
    if (!result.ok) return { ...result, output: result.output === "" ? "" : output }
  }
  return { ok: true, output }
}
const executableFile = async (path: string) => {
  try { return (await stat(path)).isFile() && await access(path, constants.X_OK).then(() => true) } catch { return false }
}

export interface HarnessPrograms {
  readonly ids: ReadonlyArray<string>
  readonly recipe: (id: string) => HarnessRecipe | undefined
  readonly inspect: (id: string, configured?: HarnessSettings) => Promise<HarnessInstallation>
  readonly install: (id: string, signal: AbortSignal) => Promise<ProcessResult>
  readonly defaultSettings: (id: string, path: string) => HarnessSettings | undefined
}
export function makeHarnessPrograms(options: { home: string; path: string; recipes?: ReadonlyArray<RecipeDefinition>; credentials?: CredentialRegistry }): HarnessPrograms {
  const definitions = options.recipes ?? installRecipes
  const prefix = userHarnessPrefix(options.home)
  const find = (id: string) => definitions.find((r) => r.harnessId === id)
  const protect = async () => {
    if (!options.credentials) return
    for (const harnessId of ["claude", "codex", "gemini"]) await Effect.runPromise(options.credentials.open(credentialSourceFor({ harnessId, home: options.home, variables: {} })))
  }
  const steps = (r: RecipeDefinition): ReadonlyArray<InstallStep> => r.steps ?? [{ executable: "npm", args: ["install", "--global", "--prefix", prefix,
    "--registry", r.registry, "--no-audit", "--no-fund", ...r.packages] }]
  return {
    ids: definitions.map((r) => r.harnessId),
    recipe: (id) => {
      const r = find(id)
      if (!r) return undefined
      return { harnessId: id as HarnessRecipe["harnessId"], name: r.name, automatic: r.automatic, packages: r.packages, source: r.source, registry: r.registry,
        commands: r.automatic ? steps(r).map((s) => quoteCommand([s.executable, ...s.args])) : [r.manualCommand ?? ""],
        signInCommand: quoteCommand([join(userHarnessBin(options.home), r.executable), ...r.signIn.slice(1)]), signInArguments: r.signIn.slice(1),
        ...(r.reason ? { reason: r.reason } : {}) }
    },
    inspect: async (id, configured) => {
      await protect()
      const r = find(id)
      const candidates = r ? [join(userHarnessBin(options.home), r.executable), ...options.path.split(delimiter).filter(isAbsolute).map((p) => join(p, r.executable))] : []
      if (r?.steps && configured) candidates.unshift(configured.adapterPath)
      if (!r && configured) candidates.push(configured.adapterPath)
      const path = (await Promise.all(candidates.map(executableFile))).findIndex(Boolean)
      if (path === -1) return { harnessId: id as HarnessInstallation["harnessId"], installed: false }
      const found = candidates[path]!
      const version = await execute({ executable: found, args: ["--version"] }, { home: options.home, timeoutMs: 2000 })
      // The request redacts this complete capture before extracting a line.
      const text = version.ok ? version.output : undefined
      return { harnessId: id as HarnessInstallation["harnessId"], installed: true, path: found, ...(text ? { version: text } : {}) }
    },
    install: async (id, signal) => {
      await protect()
      const r = find(id)
      if (!r?.automatic) return { ok: false, output: "", reason: r?.reason ?? "This harness has no automatic install recipe." }
      await mkdir(options.home, { recursive: true, mode: 0o700 })
      await mkdir(prefix, { recursive: true, mode: 0o700 })
      return runRecipe(steps(r), { home: options.home, timeoutMs: 120_000, signal })
    },
    defaultSettings: (id, path) => {
      if (!["claude", "codex", "gemini", "cursor"].includes(id)) return undefined
      const mapping = id === "claude" ? ["plan", "default", "acceptEdits", "bypassPermissions"] : id === "codex"
        ? ["read-only", "read-only", "workspace-write", "agent-full-access"] : id === "gemini" ? ["plan", "default", "autoEdit", "yolo"] : ["ask", "ask", "agent", "agent"]
      const adapterPath = id === "claude" || id === "codex" ? fileURLToPath(new URL(`../../node_modules/.bin/${id === "claude" ? "claude-agent-acp" : "codex-acp"}`, import.meta.url)) : path
      const [readOnly, ask, edit, full] = mapping as [string, string, string, string]
      const reportedModes: HarnessSettings["reportedModes"][number][] = []
      for (const [id, level] of [[readOnly, "read-only"], [ask, "ask"], [edit, "edit"], [full, "full"]] as const) {
        if (!reportedModes.some((mode) => mode.id === id)) reportedModes.push({ id, level })
      }
      return { id: id as HarnessSettings["id"], runMode: "acp", adapterPath, adapterArguments: id === "gemini" ? ["--acp"] : id === "cursor" ? ["acp"] : [],
        permissionMapping: { "read-only": readOnly, ask, edit, full }, reportedModes, defaultPermission: "ask", models: [], efforts: [], denyReadMechanism: { _tag: "none" } }
    }
  }
}
