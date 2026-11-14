import { afterEach, expect, it, vi } from "vitest"
import { EventEmitter } from "node:events"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { PassThrough } from "node:stream"
import type { SpawnOptions } from "node:child_process"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { makeHarnessPrograms, quoteCommand, userHarnessBin, userHarnessPrefix } from "../../src/harnesses/programs.ts"
import { installRecipes } from "../../src/harnesses/recipes.ts"

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock("node:child_process", () => ({ spawn }))
registerRebuildCheck({ noLog: true })

const roots: string[] = []
afterEach(() => { spawn.mockReset(); for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })

it("launches every automatic production recipe with absolute tools and refuses manual recipes without a launch", async () => {
  const home = mkdtempSync(join(tmpdir(), "lgtm-spawn-")); roots.push(home)
  const evil = join(home, "earlier"), marker = join(home, "hijacked")
  for (const folder of [evil, userHarnessBin(home)]) {
    mkdirSync(folder, { recursive: true })
    for (const name of ["npm", "node"]) writeFileSync(join(folder, name), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 })
  }
  const before = { ...process.env }
  const launches: { executable: string; args: string[]; options: SpawnOptions; files: string[]; manifest: string; lock: string }[] = []
  // No child is ever created. The real factory still stages its committed
  // manifests and reaches the production spawn call; the fake returns failure.
  spawn.mockImplementation((executable: string, args: string[], options: SpawnOptions) => {
    const prefix = args[args.indexOf("--prefix") + 1]!
    const readStaged = (name: string) => existsSync(join(prefix, name)) ? readFileSync(join(prefix, name), "utf8") : ""
    launches.push({ executable, args, options, files: readdirSync(String(options.cwd)),
      manifest: readStaged("package.json"), lock: readStaged("package-lock.json") })
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true })
    queueMicrotask(() => { child.emit("exit", 7); child.emit("close", 7) })
    return child
  })
  try {
    process.env.PATH = [evil, ".", userHarnessBin(home)].join(delimiter)
    process.env.npm_config_registry = "https://attacker.invalid"
    process.env.npm_config_onload_script = join(evil, "npm")
    process.env.NODE_OPTIONS = "--require=attacker"
    process.env.HTTPS_PROXY = "https://attacker.invalid"
    const programs = makeHarnessPrograms({ home, path: process.env.PATH })
    const node = realpathSync(process.execPath), npm = realpathSync(join(dirname(node), "npm"))
    for (const recipe of installRecipes) {
      const preview = programs.recipe(recipe.harnessId)!
      const count = launches.length
      const result = await programs.install(recipe.harnessId, new AbortController().signal)
      expect(result.ok).toBe(false)
      if (!recipe.automatic) { expect(launches).toHaveLength(count); continue }
      expect(launches).toHaveLength(count + 1)
      const launch = launches.at(-1)!, prefix = join(userHarnessPrefix(home), recipe.harnessId)
      expect(launch.executable).toBe(node)
      expect(launch.args).toEqual([npm, "ci", "--prefix", prefix, "--registry", "https://registry.npmjs.org", "--ignore-scripts", "--no-audit", "--no-fund"])
      expect(preview.commands).toEqual([quoteCommand([launch.executable, ...launch.args])])
      expect(launch.options.shell).toBe(false)
      expect(launch.options.detached).toBe(true)
      expect(launch.options.env).toEqual({ HOME: home, PATH: [dirname(node), "/usr/bin", "/bin"].join(delimiter), CI: "1",
        npm_config_userconfig: expect.stringMatching(/\/harnesses\/empty-npmrc$/), npm_config_globalconfig: "/dev/null",
        npm_config_cache: join(userHarnessPrefix(home), "cache"), LGTM_INSTALL_OPERATION: expect.stringMatching(/^[a-f0-9-]{36}$/) })
      expect(launch.files).toEqual([])
      expect(launch.options.cwd).not.toBe(home)
      expect(existsSync(String(launch.options.cwd))).toBe(false)
      expect(launch.manifest).toBe(readFileSync(new URL(`../../src/harnesses/locks/${recipe.harnessId}/package.json`, import.meta.url), "utf8"))
      expect(launch.lock).toBe(readFileSync(new URL(`../../src/harnesses/locks/${recipe.harnessId}/package-lock.json`, import.meta.url), "utf8"))
      expect(existsSync(prefix)).toBe(false)
    }
    expect(existsSync(marker)).toBe(false)
  } finally { process.env = before }
})
