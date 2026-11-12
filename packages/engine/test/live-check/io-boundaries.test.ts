import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Instrument the OS boundary, rather than inferring "no reads" from an empty
// directory. Only paths under this test's /tmp root are tracked or blocked.
const io = vi.hoisted(() => ({ root: "", calls: [] as Array<{ operation: string; path: string }> }));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  const instrumented: Record<string, unknown> = { ...fs };
  for (const name of Object.keys(fs)) {
    const value = Reflect.get(fs, name);
    if (typeof value !== "function" || !/(Sync$|Stream$|^(?:read|write|append|open|mkdir|rm|unlink|rename|truncate|chmod|chown|link|symlink|copy|stat|lstat|realpath|access|exists))/.test(name)) continue;
    instrumented[name] = (...args: unknown[]) => {
      const path = String(args[0] ?? "");
      if (io.root !== "" && path.startsWith(io.root)) io.calls.push({ operation: name, path });
      return Reflect.apply(value, fs, args);
    };
  }
  return instrumented;
});
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  const instrumented: Record<string, unknown> = { ...fs };
  for (const name of Object.keys(fs)) {
    const value = Reflect.get(fs, name);
    if (typeof value !== "function") continue;
    instrumented[name] = (...args: unknown[]) => {
      const path = String(args[0] ?? "");
      if (io.root !== "" && path.startsWith(io.root)) io.calls.push({ operation: name, path });
      return Reflect.apply(value, fs, args);
    };
  }
  return instrumented;
});
vi.mock("node:child_process", async (original) => {
  const childProcess = await original<typeof import("node:child_process")>();
  return { ...childProcess, ...Object.fromEntries(["spawn", "spawnSync", "fork", "exec", "execSync", "execFile", "execFileSync"].map((name) =>
    [name, vi.fn(() => { throw new Error(`dry-run cannot call ${name}`); })])) };
});
vi.mock("node:net", { spy: true });
vi.mock("node:http", { spy: true });

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as childProcess from "node:child_process";
import * as net from "node:net";
import * as http from "node:http";
import { main, realDeps } from "../../scripts/live/run.ts";
import { checkStartupHook, realStartupHookDeps } from "../../../../plugins/herdr/src/startupHook.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
const roots: string[] = [];
const rootFor = () => { const root = mkdtempSync("/tmp/sh8ct-io-"); roots.push(root); return root; };
afterEach(() => {
  io.root = "";
  io.calls.length = 0;
  vi.clearAllMocks();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("the read-only startup-hook boundary", () => {
  it.each([0, 1, 2])("with %i listed services never opens the lock, signals a process, or writes under the home (catches lock-descriptor side effects or a probe that repairs state)", async (count) => {
    const root = rootFor();
    const state = join(root, "state");
    const proc = join(root, "proc");
    mkdirSync(state);
    mkdirSync(proc);
    const lock = join(state, "engine.lock");
    writeFileSync(lock, "lock must stay untouched");
    for (let index = 0; index < count; index += 1) {
      const folder = join(proc, String(index + 4000));
      mkdirSync(folder);
      writeFileSync(join(folder, "cmdline"), "node\0/work/packages/engine/src/service.ts\0");
      writeFileSync(join(folder, "environ"), `LGTM_HOME=${state}\0HOME=${root}/home\0`);
    }
    const kill = vi.spyOn(process, "kill").mockImplementation(() => { throw new Error("startup-hook must not signal"); });
    io.root = root;
    const hook = realStartupHookDeps({ LGTM_HOME: state, HOME: join(root, "home"), XDG_STATE_HOME: join(root, "xdg"), CODEX_HOME: join(root, "codex") }, proc);
    const probes: string[] = [];
    const result = await checkStartupHook({ ...hook, answers: async (path) => { probes.push(path); return false; }, sleep: async () => undefined });
    expect(result.passed).toBe(false);
    expect(result.reason).toContain(count === 0 ? "stale lock" : count === 1 ? "did not answer" : "2 services");
    expect(probes).toEqual(count === 1 ? Array(10).fill(join(state, "engine.sock")) : []);
    expect(kill).not.toHaveBeenCalled();
    expect(io.calls.filter((call) => /^(open|readFile|createReadStream)/.test(call.operation) && call.path === lock)).toEqual([]);
    expect(io.calls.filter((call) => /^(write|append|mkdir|rm|unlink|rename|truncate|chmod|chown|link|symlink|copy|createWrite)/.test(call.operation))).toEqual([]);
    // Positive controls: the spy really observed the read-only path checks.
    expect(io.calls.some((call) => call.operation === "readdirSync" && call.path === proc)).toBe(true);
    io.root = "";
    expect(readFileSync(lock, "utf8")).toBe("lock must stay untouched");
  });
});

describe("dry-run I/O isolation", () => {
  it.each([{ argv: ["--dry-run"] }, { argv: ["--help"] }, { argv: ["--unknown"] }])("$argv through realDeps performs no home I/O, process start, socket open, or signal (catches work hidden in real dependency construction)", async ({ argv }) => {
    const root = rootFor();
    const spawn = vi.mocked(childProcess.spawn).mockImplementation(() => { throw new Error("no process may start"); });
    const connect = vi.mocked(net.connect).mockImplementation(() => { throw new Error("no socket may open"); });
    const request = vi.mocked(http.request).mockImplementation(() => { throw new Error("no HTTP probe may run"); });
    const kill = vi.spyOn(process, "kill").mockImplementation(() => { throw new Error("no process may be signalled"); });
    const lines: string[] = [];
    io.root = root;
    const deps = realDeps({ HOME: join(root, "home"), LGTM_HOME: join(root, "state"), XDG_STATE_HOME: join(root, "xdg"), CODEX_HOME: join(root, "codex"), PATH: "" }, (line) => { lines.push(line); });
    expect(await main(argv, deps)).toBe(argv[0] === "--unknown" ? 2 : 0);
    expect(io.calls).toEqual([]);
    expect(spawn).not.toHaveBeenCalled();
    for (const name of ["spawnSync", "fork", "exec", "execSync", "execFile", "execFileSync"] as const) expect(childProcess[name]).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("--dry-run");
  });

  it.each(["--help", "-h"])("an unknown argument alongside %s still exits nonzero (catches help overriding argument validation; issue 203)", async (help) => {
    const root = rootFor();
    const lines: string[] = [];
    io.root = root;
    const deps = realDeps({ HOME: join(root, "home"), LGTM_HOME: join(root, "state"), XDG_STATE_HOME: join(root, "xdg"), CODEX_HOME: join(root, "codex") }, (line) => { lines.push(line); });
    expect(await main(["--unknown", help], deps)).not.toBe(0);
    expect(io.calls).toEqual([]);
    expect(lines.join("\n")).toContain("Unknown argument");
  });
});
