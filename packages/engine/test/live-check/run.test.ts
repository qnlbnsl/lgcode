// Unit 8c: the run of `pnpm live-check` as a whole, with every outside thing
// faked: a failing startup hook, a service that never serves, and a run that
// takes too long. Each must print a FAIL line, print the later steps as
// skipped, exit 1, never record fixtures, and leave nothing running.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it } from "vitest";

import { main, type RunDeps } from "../../scripts/live/run.ts";
import type { LiveService } from "../../scripts/live/service.ts";
import { ALL_STEPS } from "../../scripts/live/steps.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

const folders: Array<string> = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

const fakeService = (exited: boolean): LiveService & { readonly stops: { count: number }; readonly removed: { count: number } } => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sh8c-run-")));
  folders.push(root);
  const stops = { count: 0 };
  const removed = { count: 0 };
  return {
    root, state: join(root, "state"), work: join(root, "work"), pid: 999_999_999, logFile: join(root, "service.log"),
    output: () => "", exited: () => exited, stops, removed,
    stop: async () => { stops.count += 1; return []; },
    remove: () => { removed.count += 1; },
  };
};

const setup = (overrides: Partial<RunDeps> & { hookPasses?: boolean } = {}) => {
  const lines: Array<string> = [];
  const calls: Array<string> = [];
  const state = realpathSync(mkdtempSync(join(tmpdir(), "sh8c-home-")));
  folders.push(state);
  const deps: RunDeps = {
    write: (line) => { lines.push(line); },
    environment: { HOME: state },
    hook: {
      environment: { SHEPHRD_HOME: state },
      listServices: () => overrides.hookPasses === true ? [{ pid: 1, environment: { SHEPHRD_HOME: state } }] : [],
      lockExists: () => false, answers: async () => true, sleep: async () => undefined,
    },
    startService: () => { calls.push("startService"); throw new Error("no service may start"); },
    connectOwner: () => { calls.push("connectOwner"); return Effect.die(new Error("no connection may open")); },
    harnessSettings: async () => { calls.push("harnessSettings"); return []; },
    record: async () => { calls.push("record"); return []; },
    outputDirectory: "/nonexistent",
    config: { leadHarness: "claude", leadAccount: "claude", leadModel: "m", leadEffort: "e", workerHarness: "codex", workerAccount: "codex", workerModel: "m", workerEffort: "e", agentTimeout: 100, totalTimeout: 60_000 },
    clock: Date.now, engineTimeout: 100, settle: 1, serveTimeout: 300,
    ...overrides,
  };
  return { deps, lines, calls };
};

const printedIds = (lines: ReadonlyArray<string>): ReadonlyArray<string> =>
  lines.flatMap((line) => /^(PASS|FAIL|SKIP) ([a-z-]+):/.exec(line)?.[2] ?? []);

describe("the run of pnpm live-check", () => {
  it("stops at a failing startup hook: prints FAIL, skips every later step, starts nothing, records nothing, exits 1 (breaks if the check goes on without the hook, or exits 0)", async () => {
    const { deps, lines, calls } = setup();
    const code = await main([], deps);
    expect(code).toBe(1);
    expect(calls).toEqual([]);
    expect(lines[0]).toMatch(/^FAIL startup-hook: .*no service runs for/);
    expect(printedIds(lines)).toEqual(ALL_STEPS.map((step) => step.id));
    expect(lines.filter((line) => line.startsWith("SKIP "))).toHaveLength(ALL_STEPS.length - 1);
    expect(lines[lines.length - 1]).toMatch(/^live-check: failed \(0 of 24 steps passed\)/);
  });

  it("fails the service step when the fresh service exits before it serves, keeps its folder and says where it is, and stops it (breaks if a dead service passes, its folder is deleted, or it is left running)", async () => {
    const service = fakeService(true);
    const { deps, lines, calls } = setup({ hookPasses: true, startService: () => service });
    const code = await main([], deps);
    expect(code).toBe(1);
    expect(printedIds(lines)).toEqual(ALL_STEPS.map((step) => step.id));
    expect(lines.find((line) => line.startsWith("PASS startup-hook"))).toBeDefined();
    expect(lines.find((line) => line.startsWith("FAIL service"))).toContain("exited before it served");
    expect(calls).not.toContain("record");
    expect(service.stops.count).toBe(1);
    expect(service.removed.count).toBe(0);
    expect(lines.join("\n")).toContain(`The run's folder is kept at ${service.root}`);
    expect(lines.join("\n")).toContain("The real service was not touched");
  });

  it("fails the whole run when it takes longer than its limit, prints FAIL time-limit, and still stops the service (breaks if a hang waits for ever)", async () => {
    const service = fakeService(false);
    let release: () => void = () => undefined;
    const hang = new Promise<void>((resolve) => { release = resolve; });
    const { deps, lines } = setup({
      hookPasses: true, startService: () => service, serveTimeout: 60_000,
      connectOwner: () => Effect.promise(() => hang).pipe(Effect.andThen(Effect.die(new Error("never serves")))),
    });
    const code = await main([], { ...deps, config: { ...deps.config, totalTimeout: 300 } });
    release();
    expect(code).toBe(1);
    expect(lines.find((line) => line.startsWith("FAIL time-limit"))).toContain("the whole run finishes within 0.3 seconds");
    expect(service.stops.count).toBe(1);
    expect(service.removed.count).toBe(0);
  });
});
