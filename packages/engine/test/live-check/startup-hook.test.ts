// Unit 8c: the startup-hook check of `pnpm live-check` (criterion 8.6). It must
// tell zero, one and two services apart, and a stale lock from no lock, and it
// must only read. The real home is a folder under /tmp, and the process listing
// is injected or is a planted /proc tree, so the test never looks at the
// owner's processes or home.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  checkStartupHook, listServicesFromProc, type ServiceProcess, type StartupHookDeps,
} from "../../../../plugins/herdr/src/startupHook.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

let root: string;
let state: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "sh8c-hook-")));
  state = join(root, "state");
  mkdirSync(state);
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const service = (pid: number, home = state): ServiceProcess => ({ pid, environment: { SHEPRD_HOME: home } });

const deps = (services: ReadonlyArray<ServiceProcess>, extra: Partial<StartupHookDeps> = {}): StartupHookDeps & { readonly calls: { answers: number; sleeps: number } } => {
  const calls = { answers: 0, sleeps: 0 };
  return {
    calls,
    environment: { SHEPRD_HOME: state, HOME: join(root, "home") },
    listServices: () => services,
    lockExists: () => false,
    answers: async () => { calls.answers += 1; return true; },
    sleep: async () => { calls.sleeps += 1; },
    ...extra,
  };
};

describe("the startup-hook check", () => {
  it("passes when exactly one service runs for the real home and its socket answers (breaks if one service is not enough to pass)", async () => {
    const hook = deps([service(4242)]);
    const result = await checkStartupHook(hook);
    expect(result.passed).toBe(true);
    expect(result.reason).toContain("4242");
    expect(result.state).toBe(state);
  });

  it("fails with no service and no lock, and says the hook did not start one (breaks if zero services pass or the reason misleads)", async () => {
    const result = await checkStartupHook(deps([]));
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("there is no engine.lock");
    expect(result.reason).toContain("did not start one");
  });

  it("fails with no service but a lock file, and calls it a stale lock (breaks if a stale lock is read as a running service)", async () => {
    const checked: Array<string> = [];
    const result = await checkStartupHook(deps([], { lockExists: (path) => { checked.push(path); return true; } }));
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("a stale lock");
    expect(checked).toEqual([join(state, "engine.lock")]);
  });

  it("fails with two services for the real home and names both (breaks if two services pass, or the pids are lost)", async () => {
    const result = await checkStartupHook(deps([service(9001), service(9000)]));
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("2 services");
    expect(result.reason).toContain("9000, 9001");
    expect(result.passed ? [] : result.pids).toEqual([9000, 9001]);
  });

  it("does not count a service that runs for another home (breaks if every engine process counts, so the check fails for the wrong reason)", async () => {
    const other = join(root, "elsewhere");
    mkdirSync(other);
    const result = await checkStartupHook(deps([service(1), service(2, other)]));
    expect(result.passed).toBe(true);
    expect(result.passed && result.pid).toBe(1);
  });

  it("finds the home from XDG_STATE_HOME or HOME, as the service does (breaks if only SHEPRD_HOME is read)", async () => {
    const xdg = join(root, "xdg");
    mkdirSync(join(xdg, "sheprd"), { recursive: true });
    const result = await checkStartupHook(deps([{ pid: 7, environment: { XDG_STATE_HOME: xdg } }], { environment: { XDG_STATE_HOME: xdg, HOME: root } }));
    expect(result.passed).toBe(true);
  });

  it("fails when the one service never answers, after a bounded number of tries, without waiting for real (breaks if the probe is unbounded)", async () => {
    const hook = deps([service(55)], { answers: async () => false });
    const result = await checkStartupHook(hook);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("did not answer");
    expect(hook.calls.sleeps).toBe(9);
  });

  it("passes when the socket answers only on a later try (breaks if a service still recovering fails the check)", async () => {
    let tries = 0;
    const result = await checkStartupHook(deps([service(56)], { answers: async () => { tries += 1; return tries === 3; } }));
    expect(result.passed).toBe(true);
    expect(tries).toBe(3);
  });

  it("never prints a secret: the reasons and the state hold only paths and pids (breaks if an environment value is copied into a message)", async () => {
    const secret = "sk-live-0123456789abcdef-NEVER-PRINT";
    const processes: Array<ServiceProcess> = [{ pid: 3, environment: { SHEPRD_HOME: state, ANTHROPIC_API_KEY: secret } }, service(4)];
    const result = await checkStartupHook(deps(processes, { environment: { SHEPRD_HOME: state, ANTHROPIC_API_KEY: secret } }));
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});

describe("the process listing", () => {
  const plant = (proc: string, pid: string, argv: ReadonlyArray<string>, environment: Record<string, string>) => {
    mkdirSync(join(proc, pid), { recursive: true });
    writeFileSync(join(proc, pid, "cmdline"), argv.join("\0") + "\0");
    writeFileSync(join(proc, pid, "environ"), Object.entries(environment).map(([name, value]) => `${name}=${value}`).join("\0") + "\0");
  };

  it("lists the processes that run the engine's service.ts, keeps only the three state variables, and ignores the rest (breaks if another node process counts, or a secret is kept)", () => {
    const proc = join(root, "proc");
    plant(proc, "100", ["node", "/work/packages/engine/src/service.ts"], { SHEPRD_HOME: state, ANTHROPIC_API_KEY: "never-kept-0123456789", HOME: "/home/x" });
    plant(proc, "101", ["node", "/work/packages/engine/src/other.ts"], { SHEPRD_HOME: state });
    plant(proc, "102", ["vim", "service.ts"], { SHEPRD_HOME: state });
    mkdirSync(join(proc, "self"));
    mkdirSync(join(proc, "103"));
    const listed = listServicesFromProc(proc);
    expect(listed).toEqual([{ pid: 100, environment: { SHEPRD_HOME: state, HOME: "/home/x" } }]);
    expect(JSON.stringify(listed)).not.toContain("never-kept");
  });

  it("returns an empty list when the folder cannot be read (breaks if a missing /proc throws)", () => {
    expect(listServicesFromProc(join(root, "absent"))).toEqual([]);
  });
});
