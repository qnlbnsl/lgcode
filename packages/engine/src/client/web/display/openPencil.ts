import { spawn, execFile } from "node:child_process"
import { chmod, lstat, mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"
import { randomUUID } from "node:crypto"
import type * as Effect from "effect/Effect"
import type { designDisplay } from "../../../project/display.ts"

export const openPencilCommit = "cb717376a6252b0387f95d1e8bf33a0b196eb9bf"
type RegisteredDesign = Effect.Success<ReturnType<typeof designDisplay>>

// Original LGTM Studio launch configuration for the existing pinned browser build
// layout (/srv/editor), inspected in design/openpencil read-only. This module
// copies no upstream launcher code. The image's browser app is OpenPencil's;
// see third_party/open-pencil/README.md. No build, pull or sample fallback.
export const openPencilLaunch = (options: {
  readonly image: string; readonly folder: string; readonly socketDirectory: string
  readonly name: string; readonly uid: number; readonly gid: number
}) => {
  if (options.image !== openPencilImage || !/^lgtm-editor-[a-f0-9-]{36}$/.test(options.name)
    || [options.folder, options.socketDirectory].some((path) => !isAbsolute(path) || /[,\r\n\0]/u.test(path))
    || !Number.isInteger(options.uid) || options.uid <= 0 || !Number.isInteger(options.gid) || options.gid < 0) throw new Error("editor launch configuration refused")
  const config = { admin: { disabled: true, config: { persist: false } }, apps: { http: { servers: { editor: {
    listen: ["unix//run/lgtm/editor.sock|0600"], automatic_https: { disable: true }, routes: [
      { match: [{ path: ["/files/*"] }], handle: [{ handler: "file_server", root: "/" }], terminal: true },
      { handle: [{ handler: "file_server", root: "/srv/editor", index_names: ["index.html"] }] }
    ]
  } } } } }
  return { args: ["run", "--rm", "--pull=never", "--name", options.name, "--network", "none", "--read-only",
    "--cap-drop", "ALL", "--cap-add", "NET_BIND_SERVICE", "--security-opt", "no-new-privileges", "--user", `${options.uid}:${options.gid}`,
    "--pids-limit", "64", "--memory", "256m", "--cpus", "1", "--log-driver", "none",
    "--mount", `type=bind,src=${options.folder},dst=/files,readonly`,
    "--mount", `type=bind,src=${options.socketDirectory},dst=/run/lgtm`,
    "--entrypoint", "caddy", "--interactive", options.image, "run", "--config", "-"], stdin: JSON.stringify(config) }
}

// This function only runs when the eventual authenticated owner handler calls
// it. Module import and source checks launch nothing. The caller must have
// freshly resolved the actual design through designDisplay.
export const launchOpenPencil = async (design: RegisteredDesign, options: { readonly image: string; readonly dockerSocket: string }) => {
  if (process.platform !== "linux" || !isAbsolute(options.dockerSocket) || !(await lstat(options.dockerSocket)).isSocket()
    || await realpath(design.folder) !== design.folder) throw new Error("editor runtime unavailable")
  const directory = await mkdtemp(join(tmpdir(), "lg-editor-"))
  await chmod(directory, 0o700)
  const name = `lgtm-editor-${randomUUID()}`
  const docker = ["--host", `unix://${options.dockerSocket}`]
  const environment = { PATH: "/usr/bin:/bin", HOME: directory, DOCKER_CONFIG: directory }
  let launch: ReturnType<typeof openPencilLaunch>
  try {
    launch = openPencilLaunch({ ...options, folder: design.folder, socketDirectory: directory, name, uid: process.getuid!(), gid: process.getgid!() })
    await new Promise<void>((resolve, reject) => {
      execFile("/usr/bin/docker", [...docker, "image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", options.image],
        { env: environment, timeout: 10_000, maxBuffer: 256 }, (error, stdout) => {
          if (error !== null || stdout.trim() !== "linux/amd64") reject(new Error("editor image unavailable"))
          else resolve()
        })
    })
  }
  catch { await rm(directory, { recursive: true, force: true }); throw new Error("editor launch configuration refused") }
  const child = spawn("/usr/bin/docker", [...docker, ...launch.args], { env: environment, stdio: ["pipe", "ignore", "ignore"] })
  let ended = false, exit: number | null = null, failed = false
  child.once("error", () => { failed = true; ended = true })
  child.once("exit", (code) => { ended = true; exit = code })
  child.stdin.on("error", () => { /* The fixed startup failure is reported below. */ })
  child.stdin.end(launch.stdin)
  let closing: Promise<void> | undefined
  const close = () => closing ??= new Promise<void>((resolve, reject) => {
    execFile("/usr/bin/docker", [...docker, "rm", "--force", name], { env: environment, timeout: 10_000, maxBuffer: 4096 }, (error) => {
      // A normal foreground --rm exit also proves the container has ended.
      // A daemon/transport error does not. Retain its private socket directory
      // on inconclusive cleanup rather than claim that killing a CLI sufficed.
      if (error !== null && !(ended && exit === 0)) { reject(new Error("editor cleanup unconfirmed")); return }
      void rm(directory, { recursive: true, force: true }).then(resolve, () => reject(new Error("editor socket cleanup failed")))
    })
  })
  const socketPath = join(directory, "editor.sock")
  try {
    const deadline = Date.now() + 10_000
    for (;;) {
      if (failed || ended) throw new Error()
      try { if ((await lstat(socketPath)).isSocket()) return { socketPath, close, name, requiredSourceCommit: openPencilCommit } }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
      if (Date.now() >= deadline) throw new Error()
      await new Promise<void>((resolve) => setTimeout(resolve, 50))
    }
  } catch {
    await close()
    throw new Error("editor startup failed")
  }
}
// The owner-selected local name and tag, inspected on every launch. Runtime
// never pulls or substitutes another image. See third_party/open-pencil/BUILD.md.
export const openPencilImage = "lgtm-openpencil:w10b-cb71737-build1"
