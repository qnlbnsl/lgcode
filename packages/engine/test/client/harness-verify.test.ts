import { afterEach, expect, it, vi } from "vitest"
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { makeHarnessPrograms, userHarnessPrefix } from "../../src/harnesses/programs.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"

const fake = vi.hoisted(() => ({ npm: "", mode: "valid", marker: "" }))
vi.mock("node:child_process", async (original) => {
  const real = await original<typeof import("node:child_process")>()
  return { ...real, spawn: vi.fn((file, args, options) => {
    if (args[1] === "ci") return real.spawn(process.execPath, [fake.npm, args[args.indexOf("--prefix") + 1], fake.mode, fake.marker], options)
    // Only the fixture executable may run. No package manager or vendor CLI
    // can be reached through this mock, even if the production plan changes.
    if (!String(file).startsWith(fake.marker.slice(0, fake.marker.lastIndexOf("/")) + "/")) throw new Error("Unexpected subprocess")
    return real.spawn(file, args, options)
  }) }
})
vi.mock("node:fs", async (original) => {
  const real = await original<typeof import("node:fs")>()
  return { ...real, writeFileSync: vi.fn(real.writeFileSync), renameSync: vi.fn(real.renameSync) }
})
registerRebuildCheck({ noLog: true })
const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }) })

function fixture(mode: string) {
  const home = mkdtempSync(join(tmpdir(), "lgtm-verify-")); roots.push(home)
  const stateFolder = join(home, "state"), prefix = join(userHarnessPrefix(home), "gemini")
  fake.npm = join(home, "fake-npm.cjs"); fake.mode = mode; fake.marker = join(home, "executed")
  writeFileSync(fake.npm, `
    const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
    const [prefix,mode,marker]=process.argv.slice(2);
    const lock=JSON.parse(fs.readFileSync(path.join(prefix,'package-lock.json'),'utf8'));
    const packages={...lock.packages};delete packages[''];
    // npm's hidden lock lists only the installed platform variant, not all six.
    for(const [key,entry] of Object.entries(packages))if(entry.os && (entry.os[0]!==process.platform || entry.cpu[0]!==process.arch))delete packages[key];
    fs.mkdirSync(path.join(prefix,'node_modules/@google/gemini-cli'),{recursive:true});
    const target=path.join(prefix,mode==='wrong-target'?'node_modules/payload':'node_modules/@google/gemini-cli','bundle/gemini.js');
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.mkdirSync(path.join(prefix,'node_modules/.bin'),{recursive:true});
    fs.writeFileSync(target,'#!'+process.execPath+'\\n'+(mode==='timeout'?'setInterval(()=>{},1000)':"require('node:fs').writeFileSync("+JSON.stringify(marker)+",'ran');console.log('0.68.0')")+'\\n',{mode:0o700});
    fs.symlinkSync(target,path.join(prefix,'node_modules/.bin/gemini'));
    if(mode==='probe-change') {
      fs.writeFileSync(target,'#!'+process.execPath+'\\n'+"require('node:fs').appendFileSync(__filename,'// changed during probe');console.log('0.68.0')"+'\\n',{mode:0o700});
      Object.assign(packages,lock.packages);delete packages[''];
    }
    if(mode==='extra')packages['node_modules/payload']={version:'1.0.0',resolved:'file:payload',integrity:'sha512-fake'};
    if(mode==='missing-required')delete packages['node_modules/@google/gemini-cli'];
    if(['name','version','resolved','integrity'].includes(mode))packages['node_modules/@google/gemini-cli']={...packages['node_modules/@google/gemini-cli'],[mode]:'attacker'};
    fs.writeFileSync(path.join(prefix,'node_modules/.package-lock.json'),JSON.stringify({lockfileVersion:3,packages}));
    if(mode==='unrestored-swap') {
      // A separate process rewrites both staged inputs and does not restore them.
      // A restored swap is the open same-user limit recorded in SECURITY.md.
      const writer=cp.spawnSync(process.execPath,['-e',\
        "const fs=require('node:fs'),p=require('node:path'),root=process.argv[1];for(const name of ['package.json','package-lock.json'])fs.writeFileSync(p.join(root,name),JSON.stringify({name:'payload',version:'0.68.0',dependencies:{payload:'file:payload'}}));fs.writeFileSync(process.argv[2],String(process.pid))",prefix,marker+'-writer']);
      if(writer.status!==0)process.exit(9);
    }
  `)
  return { home, stateFolder, prefix, programs: makeHarnessPrograms({ home, path: "", stateFolder }) }
}

it.each(["unrestored-swap", "extra", "missing-required", "name", "version", "resolved", "integrity", "wrong-target"])("refuses %s before recording a receipt or executing the planted program", async (mode) => {
  const f = fixture(mode)
  const result = await f.programs.install("gemini", new AbortController().signal)
  expect(result).toMatchObject({ ok: false, reason: "The installed tree does not match the committed recipe." })
  expect(existsSync(fake.marker)).toBe(false)
  expect(existsSync(join(f.stateFolder, "harness-installations/gemini.json"))).toBe(false)
  expect(existsSync(f.prefix)).toBe(false)
  if (mode === "unrestored-swap") expect(Number(readFileSync(fake.marker + "-writer", "utf8"))).not.toBe(process.pid)
})

it("accepts one installed platform variant with the other five optional variants absent and atomically publishes its pending intent", async () => {
  const f = fixture("valid")
  expect(await f.programs.install("gemini", new AbortController().signal)).toMatchObject({ ok: true })
  expect(existsSync(fake.marker)).toBe(true)
  const installed = JSON.parse(readFileSync(join(f.prefix, "node_modules/.package-lock.json"), "utf8")).packages
  const committed = JSON.parse(readFileSync(join(f.prefix, "package-lock.json"), "utf8")).packages
  const variants = (packages: Record<string, { os?: string[]; cpu?: string[] }>) => Object.values(packages).filter((entry) => entry.os && entry.cpu)
  expect(variants(committed)).toHaveLength(6)
  expect(variants(installed)).toHaveLength(1)
  expect(vi.mocked(writeFileSync).mock.calls.filter(([path]) => String(path).endsWith(".pending.json"))).toHaveLength(0)
  expect(vi.mocked(renameSync).mock.calls.some(([from, to]) => String(from).endsWith(".pending.json.tmp") && String(to).endsWith(".pending.json"))).toBe(true)
})

it("keeps a verified install on a slow post-install version timeout and uses a longer fixed probe limit", async () => {
  const f = fixture("timeout"), set = globalThis.setTimeout, delays: number[] = []
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: (...args: any[]) => void, delay: number, ...args: any[]) => {
    if (delay <= 30_000) { delays.push(delay); return set(callback, 100, ...args) }
    return set(callback, delay, ...args)
  }) as typeof setTimeout)
  expect(await f.programs.install("gemini", new AbortController().signal)).toMatchObject({ ok: true })
  expect(delays.some((delay) => delay > 2000 && delay <= 30_000)).toBe(true)
  expect(await f.programs.inspect("gemini")).toMatchObject({ installed: true, reason: "Installed, version unknown. Press Check again." })
  expect(existsSync(f.prefix)).toBe(true)
  const restarted = makeHarnessPrograms({ home: f.home, stateFolder: f.stateFolder, path: "" })
  expect(await restarted.inspect("gemini")).toMatchObject({ installed: true, reason: "Installed, version unknown. Press Check again." })
  expect(await restarted.inspect("gemini", undefined, true)).toMatchObject({ installed: true, reason: "Installed, version unknown. Press Check again." })
  expect(existsSync(f.prefix)).toBe(true)
})

it("refuses and removes a tree changed during the version probe instead of recording it again", async () => {
  const f = fixture("probe-change")
  expect(await f.programs.install("gemini", new AbortController().signal)).toMatchObject({ ok: false, reason: "The installed files could not be verified." })
  expect(existsSync(f.prefix)).toBe(false)
  expect(existsSync(join(f.stateFolder, "harness-installations/gemini.json"))).toBe(false)
})
