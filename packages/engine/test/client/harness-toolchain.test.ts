import { afterEach, expect, it } from "@effect/vitest"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from "node:fs"
import { join, dirname, isAbsolute, delimiter } from "node:path"
import { tmpdir } from "node:os"
import { installPlan, installerEnvironment, resolveToolchain, runRecipe, makeHarnessPrograms, userHarnessBin } from "../../src/harnesses/programs.ts"
import { installRecipes } from "../../src/harnesses/recipes.ts"

const roots: string[] = []
const root = () => { const p = mkdtempSync(join(tmpdir(), "lgtm-toolchain-")); roots.push(p); return p }
afterEach(() => { for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true }) })

it("uses the real Node and its adjacent npm, never PATH, for every shipped automatic recipe", async () => {
  const home = root(), evil = join(home, "evil"), marker = join(home, "hijacked")
  for (const folder of [evil, userHarnessBin(home)]) {
    mkdirSync(folder, { recursive: true })
    for (const name of ["npm", "node"]) writeFileSync(join(folder, name), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 })
  }
  const before = { ...process.env }
  try {
    process.env.PATH = `${evil}${delimiter}.${delimiter}${userHarnessBin(home)}`
    process.env.npm_config_registry = "https://attacker.invalid"
    process.env.npm_config_onload_script = join(evil, "npm")
    process.env.NODE_OPTIONS = "--require=attacker"
    const toolchain = resolveToolchain()
    expect(toolchain.node).toBe(realpathSync(process.execPath))
    expect(toolchain.npm).toBe(realpathSync(join(dirname(realpathSync(process.execPath)), "npm")))
    const env = installerEnvironment(home, toolchain)
    expect(env.PATH?.split(delimiter)).toEqual([dirname(toolchain.node), "/usr/bin", "/bin"])
    expect(Object.keys(env).sort()).toEqual(["CI", "HOME", "PATH", "npm_config_cache", "npm_config_globalconfig", "npm_config_userconfig"].sort())
    for (const recipe of installRecipes.filter((r) => r.automatic)) {
      const plan = installPlan(home, recipe, toolchain)
      expect(plan.executable).toBe(toolchain.node)
      expect(plan.args).toEqual([toolchain.npm, "ci", "--prefix", plan.prefix, "--registry", "https://registry.npmjs.org", "--ignore-scripts", "--no-audit", "--no-fund"])
      expect(isAbsolute(plan.prefix)).toBe(true)
      const lock = JSON.parse(readFileSync(new URL(`../../src/harnesses/locks/${recipe.harnessId}/package-lock.json`, import.meta.url), "utf8"))
      expect(lock.lockfileVersion).toBe(3)
      expect(Object.entries(lock.packages[""].dependencies).map(([name, version]) => `${name}@${version}`)).toEqual(recipe.packages)
      for (const [path, pkg] of Object.entries(lock.packages) as [string, any][]) if (path) {
        expect(pkg.resolved).toMatch(/^https:\/\/registry.npmjs.org\//)
        expect(pkg.integrity).toMatch(/^sha512-/)
      }
      expect(makeHarnessPrograms({ home, path: process.env.PATH }).recipe(recipe.harnessId)?.commands).toEqual([plan.command])
    }
    const npmVersion = await runRecipe([{ executable: toolchain.node, args: [toolchain.npm, "--version"] }], { home, timeoutMs: 2000 })
    expect(npmVersion.ok).toBe(true)
    expect(npmVersion.output.trim()).toMatch(/^\d+\.\d+\.\d+$/)
    expect(existsSync(marker)).toBe(false)
  } finally { process.env = before }
})

it("runs with an empty temporary working folder and ignores hostile PATH/configuration", async () => {
  const home = root(), marker = join(home, "hijacked"), evil = join(home, "evil")
  mkdirSync(evil)
  for (const name of ["node", "npm"]) writeFileSync(join(evil, name), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 })
  const before = { ...process.env }
  try {
    process.env.PATH = `${evil}:.`; process.env.npm_config_registry = "https://attacker.invalid"
    const result = await runRecipe([{ executable: realpathSync(process.execPath), args: ["-e", "console.log(JSON.stringify({cwd:process.cwd(),files:require('node:fs').readdirSync('.'),env:process.env}))"] }], { home, timeoutMs: 2000 })
    expect(result.ok).toBe(true)
    const report = JSON.parse(result.output)
    expect(report.cwd).not.toBe(home)
    expect(report.files).toEqual([])
    expect(report.env.PATH.split(delimiter)).toEqual([dirname(realpathSync(process.execPath)), "/usr/bin", "/bin"])
    expect(report.env.npm_config_registry).toBeUndefined()
    expect(existsSync(report.cwd)).toBe(false)
    expect(existsSync(marker)).toBe(false)
  } finally { process.env = before }
})

it("kills the child and grandchild on timeout and on cancellation", async () => {
  const home = root()
  for (const cancel of [false, true]) {
    const pids = join(home, `pids-${cancel}`), controller = new AbortController()
    const running = runRecipe([{ executable: process.execPath, args: ["-e", `const fs=require('node:fs'),cp=require('node:child_process');const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pids)},JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000)`] }], { home, timeoutMs: cancel ? 3000 : 300, signal: controller.signal })
    if (cancel) { while (!existsSync(pids)) await new Promise((r) => setTimeout(r, 10)); controller.abort() }
    const result = await running
    expect(result.reason).toBe(cancel ? "The install was cancelled." : "The install exceeded its time limit.")
    for (const pid of JSON.parse(readFileSync(pids, "utf8"))) {
      // A reaped child is absent; a briefly retained zombie cannot run either.
      let state: string | undefined
      try { state = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.[0] } catch {}
      expect(state === undefined || state === "Z").toBe(true)
    }
  }
})
