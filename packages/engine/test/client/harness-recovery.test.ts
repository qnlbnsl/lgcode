import { afterEach, expect, it, vi } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { rm } from "node:fs/promises"
import { makeHarnessPrograms, recordManagedInstallation, userHarnessPrefix } from "../../src/harnesses/programs.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"

vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>()
  return { ...real, rm: vi.fn(real.rm) }
})
registerRebuildCheck({ noLog: true })
const roots: string[] = []
afterEach(() => { vi.mocked(rm).mockRestore(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "lgtm-recovery-")); roots.push(home)
  const root = userHarnessPrefix(home), stateFolder = join(home, "state"), records = join(stateFolder, "harness-installations"), pending = join(records, "fixture.pending.json")
  mkdirSync(root, { recursive: true }); mkdirSync(records, { recursive: true })
  const intent = () => writeFileSync(pending, JSON.stringify({ id: "gemini", operation: "fixture", boot: "old-boot", user: process.getuid!() }))
  return { home, root, stateFolder, records, pending, intent, programs: makeHarnessPrograms({ home, stateFolder, path: "" }) }
}
it("recovery refuses a symbolic managed root without removing files and records a warning", async () => {
  const f = fixture(), target = join(f.home, "target"), prefix = join(target, "gemini")
  mkdirSync(prefix, { recursive: true }); writeFileSync(join(prefix, "keep"), "fixture")
  rmSync(f.root, { recursive: true }); symlinkSync(target, f.root); f.intent()
  const warnings = await f.programs.recover!()
  expect(warnings?.length).toBeGreaterThan(0)
  expect(existsSync(join(prefix, "keep"))).toBe(true)
  expect(existsSync(f.pending)).toBe(true)
})
it.each(["valid", "damaged"])("recovery keeps a valid receipted installation despite a planted %s pending file", async (mode) => {
  const f = fixture(), prefix = join(f.root, "gemini"), program = join(prefix, "gemini")
  mkdirSync(prefix); writeFileSync(program, "fixture", { mode: 0o700 })
  recordManagedInstallation(f.home, "gemini", program, "0.68.0", f.stateFolder)
  const receipt = readFileSync(join(f.records, "gemini.json"), "utf8")
  f.intent(); if (mode === "damaged") writeFileSync(f.pending, "{truncated")
  await f.programs.recover!()
  expect(existsSync(program)).toBe(true)
  expect(readFileSync(join(f.records, "gemini.json"), "utf8")).toBe(receipt)
  expect(existsSync(f.pending)).toBe(false)
})
it("an installation-records regular file warns instead of blocking startup", async () => {
  const f = fixture(); rmSync(f.records, { recursive: true }); writeFileSync(f.records, "fixture")
  await expect(f.programs.recover!()).resolves.toEqual(expect.arrayContaining([expect.any(String)]))
})
it("a pending file disappearing before removal does not block startup", async () => {
  const f = fixture(); f.intent()
  const real = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")
  vi.mocked(rm).mockImplementation(async (path, options) => {
    if (path === f.pending) rmSync(f.pending, { force: true })
    return real.rm(path, options)
  })
  await expect(f.programs.recover!()).resolves.toBeDefined()
  expect(existsSync(f.pending)).toBe(false)
})
