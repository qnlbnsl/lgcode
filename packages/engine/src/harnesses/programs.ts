import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { constants, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs"
import { access, copyFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import type { HarnessInstallation, HarnessRecipe, HarnessSettings } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import { credentialSourceFor, type CredentialRegistry } from "../accounts/credentialSource.ts"
import { linuxProcessReader } from "../recovery/orphans.ts"
import { installRecipes, type RecipeDefinition } from "./recipes.ts"

export interface InstallStep { readonly executable: string; readonly args: ReadonlyArray<string> }
export interface ProcessResult { readonly ok: boolean; readonly output: string; readonly reason?: string }
export interface Toolchain { readonly node: string; readonly npm: string }
const outputLimit = 64 * 1024
export const userHarnessPrefix = (home: string) => join(home, ".local", "share", "lgtm", "harnesses")
export const userHarnessBin = (home: string) => join(userHarnessPrefix(home), "bin")
const receiptFolder = (home: string, state?: string) => join(state ?? join(home, ".local", "state", "lgtm"), "harness-installations")
export const quoteCommand = (words: ReadonlyArray<string>) => words.map((s) => `'${s.replaceAll("'", "'\\''")}'`).join(" ")
export const resolveToolchain = (): Toolchain => {
  const node = realpathSync(process.execPath)
  try {
    const npm = realpathSync(join(dirname(node), "npm"))
    if (!statSync(npm).isFile()) throw new Error()
    return { node, npm }
  } catch { throw new Error("The Node.js installation has no adjacent npm program. Install Node.js with npm, then check again.") }
}
// Never inherit PATH, NODE_OPTIONS, npm_config_*, proxies or provider secrets.
// npm cannot load /dev/null twice under different config roles, so the second
// empty config is a repository-owned file, distinct from /dev/null.
export const installerEnvironment = (home: string, toolchain: Pick<Toolchain, "node"> = { node: realpathSync(process.execPath) }): NodeJS.ProcessEnv => ({
  HOME: home, PATH: [dirname(toolchain.node), "/usr/bin", "/bin"].join(delimiter), CI: "1",
  npm_config_userconfig: fileURLToPath(new URL("empty-npmrc", import.meta.url)), npm_config_globalconfig: "/dev/null",
  npm_config_cache: join(userHarnessPrefix(home), "cache")
})
export const installPlan = (home: string, recipe: RecipeDefinition, toolchain = resolveToolchain()) => {
  const prefix = join(userHarnessPrefix(home), recipe.harnessId)
  const args = [toolchain.npm, "ci", "--prefix", prefix, "--registry", recipe.registry, "--ignore-scripts", "--no-audit", "--no-fund"]
  return { executable: toolchain.node, args, prefix, command: quoteCommand([toolchain.node, ...args]) }
}
interface RunOptions { readonly home: string; readonly timeoutMs: number; readonly signal?: AbortSignal; readonly operation?: string }
const execute = (step: InstallStep, options: RunOptions & { cwd: string }): Promise<ProcessResult> => new Promise((resolveResult) => {
  let timeout = false, oversized = false, output = Buffer.alloc(0), settled = false
  const child = spawn(step.executable, [...step.args], { cwd: options.cwd,
    env: { ...installerEnvironment(options.home), ...(options.operation ? { LGTM_INSTALL_OPERATION: options.operation } : {}) }, shell: false,
    detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] })
  const stop = () => { try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL") } catch {} }
  const abort = () => stop()
  const timer = setTimeout(() => { timeout = true; stop() }, options.timeoutMs)
  const finish = (code: number | null, failed = false) => {
    if (settled) return
    settled = true; clearTimeout(timer); options.signal?.removeEventListener("abort", abort)
    // Also remove any descendants that outlive a normally exiting parent.
    stop()
    const reason = timeout ? "The install exceeded its time limit." : oversized ? "The install produced too much output."
      : options.signal?.aborted ? "The install was cancelled." : !failed && code === 0 ? undefined
      : code !== null ? `The install command exited with code ${code}.` : "The install command could not run."
    resolveResult({ ok: reason === undefined, output: timeout || oversized || options.signal?.aborted || code === null ? "" : output.toString("utf8"), ...(reason === undefined ? {} : { reason }) })
  }
  child.once("error", () => finish(null, true)); child.once("exit", stop); child.once("close", (code) => finish(code))
  const capture = (data: Buffer) => {
    if (oversized) return
    if (output.length + data.length > outputLimit) { oversized = true; output = Buffer.alloc(0); stop() }
    else output = Buffer.concat([output, data])
  }
  child.stdout?.on("data", capture); child.stderr?.on("data", capture)
  options.signal?.addEventListener("abort", abort, { once: true }); if (options.signal?.aborted) abort()
})
export async function runRecipe(steps: ReadonlyArray<InstallStep>, options: RunOptions): Promise<ProcessResult> {
  const cwd = await mkdtemp(join(tmpdir(), "lgtm-install-")), deadline = Date.now() + options.timeoutMs
  try {
    let output = ""
    for (const step of steps) {
      if (options.signal?.aborted) return { ok: false, output: "", reason: "The install was cancelled." }
      const result = await execute(step, { ...options, cwd, timeoutMs: Math.max(1, deadline - Date.now()) })
      output += result.output
      if (Buffer.byteLength(output) > outputLimit) return { ok: false, output: "", reason: "The install produced too much output." }
      if (!result.ok) return { ...result, output: result.output === "" ? "" : output }
    }
    return { ok: true, output }
  } finally { await rm(cwd, { recursive: true, force: true }) }
}
const executableFile = async (path: string) => { try { return (await stat(path)).isFile() && await access(path, constants.X_OK).then(() => true) } catch { return false } }
const inside = (root: string, path: string) => path.startsWith(root + sep)
interface Receipt { readonly path: string; readonly hash: string; readonly version: string; readonly files: Readonly<Record<string, string>> }
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex")
// Check every link, including intermediate links that leave and re-enter the
// prefix. A realpath comparison alone would miss those intermediate escapes.
export function managedIdentity(prefix: string, path: string): { path: string; hash: string } {
  if (!isAbsolute(path) || !inside(prefix, resolve(path)) || realpathSync(prefix) !== prefix) throw new Error("changed since install")
  let part = prefix
  for (const segment of relative(prefix, path).split(sep)) {
    part = join(part, segment)
    lstatSync(part)
    if (!inside(prefix, realpathSync(part))) throw new Error("changed since install")
  }
  const real = realpathSync(path)
  if (!statSync(real).isFile()) throw new Error("changed since install")
  return { path: real, hash: digest(real) }
}
const treeIdentity = (prefix: string): Record<string, string> => {
  const files: Record<string, string> = Object.create(null)
  const visit = (folder: string) => {
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name), info = lstatSync(path), real = realpathSync(path)
      if (!inside(prefix, real)) throw new Error("changed since install")
      if (info.isDirectory()) visit(path)
      else if (info.isSymbolicLink()) {
        // npm creates links for executable files. A linked directory could
        // hide imports or a cycle, and is not required by these npm trees.
        if (!statSync(real).isFile()) throw new Error("changed since install")
        files[relative(prefix, path)] = `link:${real}:${digest(real)}`
      } else if (info.isFile()) files[relative(prefix, path)] = digest(path)
      else throw new Error("changed since install")
    }
  }
  visit(prefix)
  return files
}
export function recordManagedInstallation(home: string, id: string, path: string, version: string, stateFolder?: string): void {
  if (!installRecipes.some((r) => r.harnessId === id)) throw new Error("unknown harness")
  const prefix = join(userHarnessPrefix(home), id), identity = managedIdentity(prefix, path), files = treeIdentity(prefix), records = receiptFolder(home, stateFolder)
  mkdirSync(records, { recursive: true, mode: 0o700 })
  writeFileSync(join(records, id + ".json"), JSON.stringify({ ...identity, version, files }), { mode: 0o600 })
}
export function validateManagedProgram(home: string, path: string, stateFolder?: string): void {
  const root = userHarnessPrefix(home)
  if (!inside(root, resolve(path))) return
  for (const recipe of installRecipes) {
    const prefix = join(root, recipe.harnessId)
    if (!inside(prefix, resolve(path))) continue
    const receipt = JSON.parse(readFileSync(join(receiptFolder(home, stateFolder), recipe.harnessId + ".json"), "utf8")) as Receipt
    const actual = managedIdentity(prefix, path)
    if (actual.path === receipt.path && actual.hash === receipt.hash && JSON.stringify(treeIdentity(prefix)) === JSON.stringify(receipt.files)) return
  }
  throw new Error("The harness executable changed since install.")
}
// Adapter dependencies are resolved from the adapter's own package context,
// matching its resolution under pnpm. No provider process runs for this check.
export function bundledHarness(id: string): { path: string; version: string; adapter: string } | undefined {
  try {
    if (id !== "claude" && id !== "codex") return undefined
    const req = createRequire(import.meta.url), adapterName = `@agentclientprotocol/${id === "claude" ? "claude-agent-acp" : "codex-acp"}`
    const adapter = join(dirname(req.resolve(adapterName + "/package.json")), "dist", "index.js"), adapterRequire = createRequire(adapter)
    if (id === "claude") {
      const sdk = adapterRequire.resolve("@anthropic-ai/claude-agent-sdk"), sdkRequire = createRequire(sdk)
      const musl = process.platform === "linux" && !(process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime
      const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}${musl ? "-musl" : ""}`
      const path = sdkRequire.resolve(`${pkg}/claude${process.platform === "win32" ? ".exe" : ""}`)
      const version = JSON.parse(readFileSync(join(dirname(path), "package.json"), "utf8")).version
      if (!statSync(adapter).isFile() || (statSync(path).mode & 0o111) === 0) return undefined
      return { path, version: `SDK ${version}`, adapter }
    }
    const cli = adapterRequire.resolve("@openai/codex/bin/codex.js"), cliRequire = createRequire(cli)
    const target = `${process.platform === "win32" ? "pc-windows-msvc" : process.platform === "darwin" ? "apple-darwin" : "unknown-linux-musl"}`
    const triple = `${process.arch === "x64" ? "x86_64" : "aarch64"}-${target}`
    const nativePkg = cliRequire.resolve(`@openai/codex-${process.platform}-${process.arch}/package.json`)
    const path = join(dirname(nativePkg), "vendor", triple, "bin", process.platform === "win32" ? "codex.exe" : "codex")
    if (!statSync(path).isFile() || (statSync(path).mode & 0o111) === 0 || !statSync(adapter).isFile()) return undefined
    return { path, version: JSON.parse(readFileSync(join(dirname(cli), "..", "package.json"), "utf8")).version, adapter }
  } catch { return undefined }
}
export interface HarnessPrograms {
  readonly ids: ReadonlyArray<string>
  readonly recipe: (id: string) => HarnessRecipe | undefined
  readonly inspect: (id: string, configured?: HarnessSettings, refresh?: boolean, signal?: AbortSignal) => Promise<HarnessInstallation>
  readonly install: (id: string, signal: AbortSignal) => Promise<ProcessResult>
  readonly defaultSettings: (id: string, path: string) => HarnessSettings | undefined
  readonly recover?: () => Promise<void>
  readonly close?: () => Promise<void>
}
export function makeHarnessPrograms(options: { home: string; path: string; stateFolder?: string; credentials?: CredentialRegistry }): HarnessPrograms {
  const definitions = installRecipes, root = userHarnessPrefix(options.home), records = receiptFolder(options.home, options.stateFolder)
  let toolchain: Toolchain | undefined
  try { toolchain = resolveToolchain() } catch {}
  const find = (id: string) => definitions.find((r) => r.harnessId === id)
  const probes = new Map<string, { signal: AbortSignal; operation: string }>()
  const cache = new Map<string, HarnessInstallation>(), active = new Map<AbortController, Promise<ProcessResult>>()
  const protect = async (id: string) => { if (options.credentials) await Effect.runPromise(options.credentials.open(credentialSourceFor({ harnessId: id, home: options.home, variables: {} }))) }
  const protectAll = async () => {
    if (!options.credentials) return true
    let healthy = true
    for (const id of ["claude", "codex", "gemini"]) try { await protect(id) } catch { healthy = false }
    return options.credentials.healthyAll() && healthy
  }
  const inspect: HarnessPrograms["inspect"] = async (id, configured, refresh = false, signal) => {
    const r = find(id), harnessId = id as HarnessInstallation["harnessId"]
    let readable = true
    try { await protect(id) } catch { readable = false }
    const result = (value: Omit<HarnessInstallation, "harnessId">) => ({ harnessId, ...value, ...(!readable ? { reason: "Cannot read the sign-in state." } : {}) })
    const receiptPath = join(records, id + ".json"), prefix = join(root, id)
    let found: string | undefined
    if (r && existsSync(receiptPath)) {
      try {
        const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as Receipt
        validateManagedProgram(options.home, receipt.path, options.stateFolder)
        if (!refresh) return result(cache.get(id)?.path === receipt.path ? cache.get(id)! : { installed: true, path: receipt.path, version: receipt.version })
        found = receipt.path
      } catch { return result({ installed: false, reason: "The harness executable changed since install." }) }
    }
    const bundled = bundledHarness(id)
    if (!found && bundled) return result({ installed: true, path: bundled.path, version: bundled.version, reason: "The bundled adapter and its vendor runtime are available." })
    if (!found && configured && !inside(root, resolve(configured.adapterPath)) && await executableFile(configured.adapterPath)) found = configured.adapterPath
    if (!found && r) {
      const candidates = id === "cursor" ? [join(options.home, ".local", "bin", "agent")] : options.path.split(delimiter).filter(isAbsolute).map((p) => join(p, r.executable))
      for (const candidate of candidates) {
        if (!await executableFile(candidate)) continue
        const real = realpathSync(candidate)
        const recognized = id === "cursor" ? inside(join(options.home, ".local", "share", "cursor-agent"), real)
          : id === "gemini" ? real.includes(`${sep}node_modules${sep}@google${sep}gemini-cli${sep}`) : false
        if (recognized) { found = real; break }
      }
    }
    if (!found) return result({ installed: false })
    if (id === "cursor" && !inside(join(options.home, ".local", "share", "cursor-agent"), realpathSync(found)))
      return result({ installed: false, reason: "The program is not in a recognized Cursor installation." })
    if (!refresh) return result(cache.get(id)?.path === found ? cache.get(id)! : { installed: r === undefined, path: found, reason: "Found, version unknown. Press Check again." })
    if (!await protectAll()) return result({ ...(cache.get(id) ?? { installed: false, path: found }), reason: "Cannot read the sign-in state needed to redact the version output." })
    if (inside(root, found)) { try { validateManagedProgram(options.home, found, options.stateFolder) } catch { return result({ installed: false, reason: "The harness executable changed since install." }) } }
    const version = await runRecipe([{ executable: found, args: ["--version"] }], { home: options.home, timeoutMs: 2000, ...(signal ? { signal } : {}), ...probes.get(id) })
    const text = version.output.trim(), reported = text.match(/\b\d+\.\d+\.\d+\b/)?.[0]
    const identified = r === undefined || id === "cursor" ? r === undefined || /cursor|^\d{4}\.\d{2}\.\d{2}/i.test(text) : reported !== undefined
    const installation = result({ installed: version.ok && identified, path: found, ...(version.ok ? { version: version.output } : {}),
      ...(!version.ok || !identified ? { reason: "Found, version unknown." } : r?.version && reported !== r.version ? { reason: `Found version ${reported}; the recipe pins ${r.version}.` } : {}) })
    if (!await protectAll()) return result({ installed: false, path: found, reason: "Cannot read the sign-in state needed to redact the version output." })
    cache.set(id, installation)
    return installation
  }
  return {
    ids: definitions.map((r) => r.harnessId), inspect,
    recipe: (id) => {
      const r = find(id)
      if (!r) return undefined
      const automatic = r.automatic && toolchain !== undefined && process.platform === "linux"
      const executable = bundledHarness(id)?.path ?? (id === "cursor" ? join(options.home, ".local", "bin", "agent") : join(root, id, "node_modules", ".bin", r.executable))
      return { harnessId: id as HarnessRecipe["harnessId"], name: r.name, automatic, packages: r.packages, source: r.source, signInSource: r.signInSource, registry: r.registry,
        commands: r.automatic && toolchain ? [installPlan(options.home, r, toolchain).command] : [r.manualCommand ?? ""],
        signInCommand: quoteCommand([executable, ...r.signIn.slice(1)]), signInArguments: r.signIn.slice(1),
        reason: r.reason ?? (!toolchain ? "The Node.js installation has no adjacent npm program." : process.platform !== "linux" ? "Automatic installs require Linux process recovery support." : "The engine first copies the committed package manifest and lockfile into the prefix. Install scripts are disabled. The lockfile fixes the dependency tree and integrity hashes.") }
    },
    install: async (id, signal) => {
      const r = find(id)
      if (!r?.automatic || !toolchain || process.platform !== "linux") return { ok: false, output: "", reason: r?.reason ?? "This harness has no automatic install recipe on this computer." }
      if (!await protectAll()) return { ok: false, output: "", reason: "Cannot read the sign-in state." }
      const controller = new AbortController(), abort = () => controller.abort()
      signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort()
      const operation = randomUUID(), plan = installPlan(options.home, r, toolchain), pending = join(records, operation + ".pending.json")
      const task = (async (): Promise<ProcessResult> => {
        await mkdir(root, { recursive: true, mode: 0o700 }); await mkdir(records, { recursive: true, mode: 0o700 })
        if (realpathSync(root) !== root) return { ok: false, output: "", reason: "The install prefix must not use a symbolic link." }
        // Persist intent before spawn. Recovery scans inherited operation tags,
        // including descendants whose original process-group leader has exited.
        writeFileSync(pending, JSON.stringify({ operation, id, boot: linuxProcessReader.bootId(), user: process.getuid!() }), { mode: 0o600 })
        let result: ProcessResult = { ok: false, output: "", reason: "The install command could not run." }
        try {
          await rm(plan.prefix, { recursive: true, force: true }); await mkdir(plan.prefix, { mode: 0o700 })
          for (const name of ["package.json", "package-lock.json"]) await copyFile(new URL(`locks/${id}/${name}`, import.meta.url), join(plan.prefix, name))
          // Ten minutes accommodates slow downloads; the entire operation has
          // one deadline. Failure removes the partial tree and its receipt.
          result = await runRecipe([plan], { home: options.home, timeoutMs: 600_000, signal: controller.signal, operation })
          if (!result.ok) return result
          recordManagedInstallation(options.home, id, join(plan.prefix, "node_modules", ".bin", r.executable), r.version!, options.stateFolder)
          probes.set(id, { signal: controller.signal, operation })
          const installed = await inspect(id, undefined, true)
          if (!installed.installed || !installed.version || installed.version.match(/\b\d+\.\d+\.\d+\b/)?.[0] !== r.version) return result = { ok: false, output: result.output, reason: installed.reason ?? "The installed executable did not report the pinned version." }
          // Preserve the complete capture for redaction; requests trim it only
          // after redaction. Receipt versions are fixed repository data.
          cache.set(id, installed)
          return result
        } catch {
          result = { ok: false, output: "", reason: "The installed files could not be verified." }
          return result
        } finally {
          if (!result.ok) { await rm(plan.prefix, { recursive: true, force: true }); await rm(join(records, id + ".json"), { force: true }); cache.delete(id) }
          probes.delete(id)
          await rm(pending, { force: true })
        }
      })().catch(() => ({ ok: false, output: "", reason: "The install command could not run." }))
      active.set(controller, task)
      try { return await task } finally { active.delete(controller); signal.removeEventListener("abort", abort) }
    },
    close: async () => { for (const controller of active.keys()) controller.abort(); await Promise.allSettled(active.values()) },
    recover: async () => {
      if (process.platform !== "linux" || !existsSync(records)) return
      for (const name of readdirSync(records).filter((n) => n.endsWith(".pending.json"))) {
        const pending = join(records, name), intent = JSON.parse(readFileSync(pending, "utf8"))
        if (!find(intent.id) || typeof intent.operation !== "string" || intent.user !== process.getuid!()) throw new Error("Install recovery identity is unavailable.")
        if (intent.boot === linuxProcessReader.bootId()) for (const pid of readdirSync("/proc").filter((p) => /^\d+$/.test(p))) {
          let matched = false
          try {
            if (statSync(`/proc/${pid}`).uid !== intent.user) continue
            const beforeText = readFileSync(`/proc/${pid}/stat`, "utf8"), before = beforeText.slice(beforeText.lastIndexOf(")") + 2).split(" ")
            const env = readFileSync(`/proc/${pid}/environ`).toString().split("\0")
            if (!env.includes(`LGTM_INSTALL_OPERATION=${intent.operation}`)) continue
            matched = true
            const text = readFileSync(`/proc/${pid}/stat`, "utf8"), fields = text.slice(text.lastIndexOf(")") + 2).split(" "), group = Number(fields[2])
            if (before[19] !== fields[19] || before[2] !== fields[2] || statSync(`/proc/${pid}`).uid !== intent.user) continue
            if (group > 1 && group !== linuxProcessReader.ownGroupId()) process.kill(-group, "SIGKILL")
          } catch (error) { if (matched && (error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "ESRCH") throw new Error("A leftover install could not be stopped.") }
        }
        await rm(join(root, intent.id), { recursive: true, force: true }); await rm(join(records, intent.id + ".json"), { force: true }); await rm(pending)
      }
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
