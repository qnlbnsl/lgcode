import { afterEach, expect, it } from "@effect/vitest"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import * as Effect from "effect/Effect"
import { makeHarnessPrograms, userHarnessPrefix, recordManagedInstallation, validateManagedProgram } from "../../src/harnesses/programs.ts"
import { guardedRunner } from "../../src/harnesses/guardedRunner.ts"
import { Runner } from "../../src/runner/Runner.ts"
import { makeFakeRunner } from "../support/fakeRunner.ts"
import { harnessSettings } from "../support/handlerRig.ts"
import { linuxProcessReader } from "../../src/recovery/orphans.ts"
const roots: string[] = []
const root = () => { const path = mkdtempSync(join(tmpdir(), "lgtm-trust-")); roots.push(path); return path }
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })
const fixture = () => {
  const home = root(), stateFolder = join(home, "state"), prefix = join(userHarnessPrefix(home), "gemini"), executable = join(prefix, "node_modules", ".bin", "gemini")
  mkdirSync(join(prefix, "node_modules", ".bin"), { recursive: true }); writeFileSync(executable, "#!/bin/sh\necho 0.68.0\n", { mode: 0o700 })
  return { home, stateFolder, prefix, executable }
}
it("records real paths and hashes, refuses changed programs and changed dependency files without running them", async () => {
  const f = fixture(), dependency = join(f.prefix, "dependency.js"), marker = join(f.home, "ran")
  writeFileSync(dependency, "trusted")
  recordManagedInstallation(f.home, "gemini", f.executable, "0.68.0", f.stateFolder)
  expect(() => validateManagedProgram(f.home, f.executable, f.stateFolder)).not.toThrow()
  const programs = makeHarnessPrograms({ home: f.home, path: "", stateFolder: f.stateFolder })
  expect(await programs.inspect("gemini")).toMatchObject({ installed: true, version: "0.68.0" })
  writeFileSync(dependency, "changed")
  expect(() => validateManagedProgram(f.home, f.executable, f.stateFolder)).toThrow()
  expect(await programs.inspect("gemini", undefined, true)).toMatchObject({ installed: false, reason: "The harness executable changed since install." })
  writeFileSync(f.executable, `#!/bin/sh\ntouch '${marker}'\necho 0.68.0\n`)
  expect(await programs.inspect("gemini", undefined, true)).toMatchObject({ installed: false })
  expect(existsSync(marker)).toBe(false)
})
it("rejects symbolic links outside the install prefix, including links that re-enter it", () => {
  const f = fixture(), outside = join(f.home, "outside")
  mkdirSync(outside); symlinkSync(f.prefix, join(outside, "back")); symlinkSync(outside, join(f.prefix, "escape"))
  expect(() => recordManagedInstallation(f.home, "gemini", join(f.prefix, "escape", "back", "node_modules", ".bin", "gemini"), "0.68.0", f.stateFolder)).toThrow()
})
it.live("checks managed integrity before discover, start and load", () => Effect.gen(function* () {
  const f = fixture(), runner = yield* makeFakeRunner()
  recordManagedInstallation(f.home, "gemini", f.executable, "0.68.0", f.stateFolder)
  writeFileSync(f.executable, "changed")
  const guarded = guardedRunner(yield* Runner.pipe(Effect.provide(runner.layer)), { home: f.home, stateFolder: f.stateFolder })
  for (const action of ["discover", "start", "load"] as const) {
    const result = yield* (guarded[action]({ harness: harnessSettings("gemini", { adapterPath: f.executable }), account: { environment: {} } } as any) as Effect.Effect<unknown, unknown>).pipe(Effect.result)
    expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "The harness executable changed since install." } })
  }
  expect(runner.calls).toHaveLength(0)
}))
it("removes the partial tree on a cancelled install without launching npm", async () => {
  const f = fixture(), programs = makeHarnessPrograms({ home: f.home, path: "", stateFolder: f.stateFolder })
  expect(await programs.install("gemini", AbortSignal.abort())).toMatchObject({ ok: false, reason: "The install was cancelled." })
  expect(existsSync(f.prefix)).toBe(false)
})
it("recovers a leftover install group and its grandchild using a durable operation identity", async () => {
  const f = fixture(), operation = randomUUID(), records = join(f.stateFolder, "harness-installations"), pids = join(f.home, "pids")
  mkdirSync(records, { recursive: true })
  writeFileSync(join(records, operation + ".pending.json"), JSON.stringify({ operation, id: "gemini", boot: linuxProcessReader.bootId(), user: process.getuid!() }))
  const child = spawn(process.execPath, ["-e", `const cp=require('node:child_process'),fs=require('node:fs');const c=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pids)},JSON.stringify([process.pid,c.pid]));setInterval(()=>{},1000)`], { detached: true, stdio: "ignore", env: { LGTM_INSTALL_OPERATION: operation } })
  try {
    while (!existsSync(pids)) await new Promise((r) => setTimeout(r, 10))
    await makeHarnessPrograms({ home: f.home, path: "", stateFolder: f.stateFolder }).recover!()
    await new Promise((r) => setTimeout(r, 30))
    for (const pid of JSON.parse(readFileSync(pids, "utf8"))) {
      let state: string | undefined; try { state = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.[0] } catch {}
      expect(state === undefined || state === "Z").toBe(true)
    }
    expect(existsSync(f.prefix)).toBe(false)
    expect(existsSync(join(records, operation + ".pending.json"))).toBe(false)
  } finally { try { process.kill(-child.pid!, "SIGKILL") } catch {} }
})
