import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, readlinkSync } from "node:fs";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alive, makeRunnerRig, processGroupOf, removeRunnerRig, writeFakeAdapter, type RunnerRig } from "../support/acpRunnerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import type { ProcessRow } from "../../src/log/EventLog.ts";
import { linuxProcessReader, sweepOrphans, type ProcessFacts, type ProcessReader } from "../../src/recovery/orphans.ts";

// Unit 6c, criterion 6.8 (task 6c.2), rows 31 and 52: the start-up sweep of
// leftover adapter process groups. A recorded group is stopped only when the
// boot id, the start time, the user id and the executable all match, and the
// group id is above 1 and not the engine's own. Facts come from an injected
// reader and signals go to an injected kill function that records its calls,
// so no case below can signal a process the test did not start. The only
// cases that signal a real group use a child the test spawned in its own
// group.

registerRebuildCheck({ noLog: true });

const onLinux = process.platform === "linux";
// The sweep reads Linux process facts; the macOS reader is not run here.
const linuxOnly = it.skipIf(!onLinux);
const reasonToSkip = "Linux only: the leftover sweep's reader uses /proc, and the macOS branch is not run here";

const run = <A>(effect: Effect.Effect<A>): Promise<A> => Effect.runPromise(effect);

const bootNow = "boot-now";
const own = 100;
const matching: ProcessFacts = { startTime: "5000", userId: 1000, executable: "/opt/adapters/agent-adapter" };

const rowFor = (overrides: Omit<Partial<ProcessRow>, "agentId"> & { readonly agentId?: string } = {}): ProcessRow => ({
  agentId: "agent-one", groupId: 4242, bootId: bootNow, ...matching, ...overrides,
} as ProcessRow);

interface Fake {
  readonly reader: ProcessReader;
  readonly groups: Map<number, ProcessFacts>;
  readonly calls: Array<{ readonly groupId: number; readonly signal: string }>;
  readonly kill: (groupId: number, signal: "SIGTERM" | "SIGKILL") => void;
  // What a signal does to the fake host; the default stops the group.
  onSignal: (groupId: number, signal: string) => void;
}

const fakeHost = (groups: ReadonlyArray<readonly [number, ProcessFacts]> = [[4242, matching]], boot = bootNow, ownGroup = own): Fake => {
  const table = new Map<number, ProcessFacts>(groups);
  const calls: Array<{ groupId: number; signal: string }> = [];
  const fake: Fake = {
    groups: table,
    calls,
    reader: { bootId: () => boot, ownGroupId: () => ownGroup, facts: (groupId) => table.get(groupId) },
    kill: (groupId, signal) => { calls.push({ groupId, signal }); fake.onSignal(groupId, signal); },
    onSignal: (groupId) => { table.delete(groupId); },
  };
  return fake;
};

const sweep = (fake: Fake, rows: ReadonlyArray<ProcessRow>, graceMillis = 40) =>
  run(sweepOrphans({ rows, reader: fake.reader, kill: fake.kill, graceMillis }));

describe.skipIf(!onLinux)(`6.8 the sweep stops a leftover group only when every guard passes [${reasonToSkip}]`, () => {
  it("a row whose boot id, start time, user and executable match, with a group id above 1 that is not the engine's own, gets one SIGTERM to its group and the sweep returns once the group is gone (breaks if the sweep sends no signal, signals a different number, or returns before the group has exited)", async () => {
    const fake = fakeHost();
    fake.onSignal = (groupId) => { setTimeout(() => { fake.groups.delete(groupId); }, 25); };
    const results = await sweep(fake, [rowFor()]);
    expect(fake.calls).toEqual([{ groupId: 4242, signal: "SIGTERM" }]);
    expect(results).toEqual([{ agentId: "agent-one", groupId: 4242, outcome: "stopped", reason: "group stopped" }]);
    expect(fake.groups.has(4242)).toBe(false);
  });

  it("a group that ignores SIGTERM gets SIGKILL after the grace period, and nothing else is signalled (breaks if the sweep gives up after SIGTERM, kills at once without the grace, or signals twice)", async () => {
    const fake = fakeHost();
    fake.onSignal = (groupId, signal) => { if (signal === "SIGKILL") fake.groups.delete(groupId); };
    const results = await sweep(fake, [rowFor()], 30);
    expect(fake.calls).toEqual([{ groupId: 4242, signal: "SIGTERM" }, { groupId: 4242, signal: "SIGKILL" }]);
    expect(results[0]?.outcome).toBe("stopped");
  });

  it("row 31 pid reuse: when the group ends during the grace and another process has taken the same number, the sweep does not send SIGKILL to it (breaks if the escalation does not check the guards again before the second signal)", async () => {
    const fake = fakeHost();
    fake.onSignal = (groupId) => { fake.groups.set(groupId, { ...matching, startTime: "9999" }); };
    const results = await sweep(fake, [rowFor()], 30);
    expect(fake.calls).toEqual([{ groupId: 4242, signal: "SIGTERM" }]);
    expect(results[0]?.outcome).toBe("stopped");
  });

  // Unit 6c fix round 1, F-3: the wait after SIGKILL has a bound (5 seconds by default). The fake host
  // never removes the group, as a process stuck in uninterruptible sleep would behave.
  it("F-3 a group that survives SIGKILL is left alone with the fixed reason 'group did not exit' once the wait after SIGKILL is over, within 8 seconds, and the next row is still swept (breaks if the sweep waits for the group after SIGKILL with no bound)", async () => {
    const fake = fakeHost([[4242, matching], [5252, matching]]);
    fake.onSignal = (groupId, signal) => { if (groupId === 5252 && signal === "SIGTERM") fake.groups.delete(groupId); };
    const started = Date.now();
    const swept = await run(sweepOrphans({
      rows: [rowFor(), rowFor({ agentId: "agent-two", groupId: 5252 })], reader: fake.reader, kill: fake.kill, graceMillis: 30,
    }).pipe(Effect.timeoutOption("8 seconds")));
    const elapsed = Date.now() - started;
    expect(swept._tag, "the sweep must return; it waited for the group after SIGKILL with no bound").toBe("Some");
    if (swept._tag !== "Some") return;
    expect(elapsed).toBeLessThan(8000);
    expect(fake.calls).toEqual([
      { groupId: 4242, signal: "SIGTERM" }, { groupId: 4242, signal: "SIGKILL" }, { groupId: 5252, signal: "SIGTERM" },
    ]);
    expect(swept.value).toEqual([
      { agentId: "agent-one", groupId: 4242, outcome: "left-alone", reason: "group did not exit" },
      { agentId: "agent-two", groupId: 5252, outcome: "stopped", reason: "group stopped" },
    ]);
  });

  // One case per guard. Every other fact matches, so only the named guard can
  // be the reason the group is left alone.
  const guards: ReadonlyArray<{
    readonly name: string;
    readonly row: Partial<ProcessRow>;
    readonly host?: () => Fake;
    readonly reason: string;
  }> = [
    { name: "the boot id in the row is not this boot's", row: { bootId: "boot-before-reboot" as ProcessRow["bootId"] }, reason: "boot id differs" },
    { name: "the group's start time differs from the recorded one", row: {}, host: () => fakeHost([[4242, { ...matching, startTime: "5001" }]]), reason: "start time differs" },
    { name: "the group's user differs from the recorded one", row: {}, host: () => fakeHost([[4242, { ...matching, userId: 0 }]]), reason: "user differs" },
    { name: "the group's executable differs from the recorded one", row: {}, host: () => fakeHost([[4242, { ...matching, executable: "/usr/bin/other" }]]), reason: "executable differs" },
    { name: "the group id is 1", row: { groupId: 1 }, host: () => fakeHost([[1, matching]]), reason: "group id not above 1" },
    { name: "the group id is 0", row: { groupId: 0 }, host: () => fakeHost([[0, matching]]), reason: "group id not above 1" },
    { name: "the group id is negative", row: { groupId: -4242 }, host: () => fakeHost([[-4242, matching], [4242, matching]]), reason: "group id not above 1" },
    { name: "the group id is the engine's own", row: { groupId: own }, host: () => fakeHost([[own, matching]]), reason: "group id is the engine's own" },
    { name: "no process has the group id any more", row: {}, host: () => fakeHost([]), reason: "process not found" },
  ];
  for (const guard of guards) {
    it(`6.8 guard: ${guard.name}, so the group is left alone and nothing is signalled (breaks if this guard is missing from the sweep)`, async () => {
      const fake = (guard.host ?? (() => fakeHost()))();
      const results = await sweep(fake, [rowFor(guard.row)]);
      expect(fake.calls).toEqual([]);
      expect(results).toEqual([{ agentId: "agent-one", groupId: guard.row.groupId ?? 4242, outcome: "left-alone", reason: guard.reason }]);
    });
  }

  it("6.8 one row failing a guard does not stop the sweep: only the two matching groups are signalled, in row order, and each result names its own row (breaks if the sweep stops at the first refusal, or signals a refused row anyway)", async () => {
    const good = [[111, matching], [333, matching]] as const;
    const fake = fakeHost([...good, [222, matching], [1, matching], [own, matching]]);
    const results = await sweep(fake, [
      rowFor({ agentId: "agent-a", groupId: 111 }),
      rowFor({ agentId: "agent-b", groupId: 222, bootId: "boot-old" as ProcessRow["bootId"] }),
      rowFor({ agentId: "agent-c", groupId: 1 }),
      rowFor({ agentId: "agent-d", groupId: own }),
      rowFor({ agentId: "agent-e", groupId: 333 }),
    ]);
    expect(fake.calls).toEqual([{ groupId: 111, signal: "SIGTERM" }, { groupId: 333, signal: "SIGTERM" }]);
    expect(results.map((result) => [result.agentId, result.outcome])).toEqual([
      ["agent-a", "stopped"], ["agent-b", "left-alone"], ["agent-c", "left-alone"], ["agent-d", "left-alone"], ["agent-e", "stopped"],
    ]);
  });

  it("6.8 a row for a group that no longer exists, among live ones, is not a failure of the sweep (breaks if a missing process raises an error that aborts start-up)", async () => {
    const fake = fakeHost([[333, matching]]);
    const results = await sweep(fake, [rowFor({ groupId: 111 }), rowFor({ agentId: "agent-two", groupId: 333 })]);
    expect(results.map((result) => result.outcome)).toEqual(["left-alone", "stopped"]);
    expect(fake.calls).toEqual([{ groupId: 333, signal: "SIGTERM" }]);
  });

  it("6.8 refusal reasons are fixed text: no recorded executable, start time or boot id appears in any result (breaks if a reason or result copies a value from the row or the process)", async () => {
    const planted = "/home/planted-secret-path/adapter";
    const fake = fakeHost([[4242, { ...matching, executable: planted }]]);
    const results = await sweep(fake, [rowFor({ executable: "/home/other-planted/adapter", bootId: "boot-planted-id" as ProcessRow["bootId"] })]);
    const text = JSON.stringify(results);
    expect(text).not.toContain("planted");
    expect(text).not.toContain(matching.startTime);
  });

  it("6.8 with no rows the sweep does nothing and succeeds (breaks if an empty table is treated as an error or reads the host)", async () => {
    const fake = fakeHost();
    expect(await sweep(fake, [])).toEqual([]);
    expect(fake.calls).toEqual([]);
  });
});

// The real reader and a real group. Only the child this test spawns, in its
// own group, is ever signalled.
describe.skipIf(!onLinux)(`6.8 the Linux reader and a real leftover group [${reasonToSkip}]`, () => {
  let rig: RunnerRig;
  let child: ChildProcess | undefined;
  beforeEach(() => {
    rig = makeRunnerRig();
    vi.stubEnv("HOME", rig.home);
    vi.stubEnv("LGCODE_HOME", rig.stateFolder);
  });
  afterEach(() => {
    if (child?.pid !== undefined) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } }
    child = undefined;
    vi.unstubAllEnvs();
    removeRunnerRig(rig);
  });

  // The fake agent as a leftover: detached, so it leads its own group, with
  // its pipes open so it idles waiting for a protocol frame.
  const startLeftover = async (): Promise<number> => {
    child = spawn(writeFakeAdapter(rig), [], { detached: true, stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "", HOME: rig.home } });
    const pid = child.pid;
    if (pid === undefined) throw new Error("The leftover child did not start");
    for (let attempt = 0; attempt < 200; attempt++) {
      if (linuxProcessReader.facts(pid) !== undefined && readlinkSync(`/proc/${pid}/exe`) !== "") return pid;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("The leftover child never showed in /proc");
  };
  const exitOf = (target: ChildProcess) => new Promise<void>((resolve) => {
    if (target.exitCode !== null || target.signalCode !== null) { resolve(); return; }
    target.once("exit", () => { resolve(); });
  });
  // Signals only the one group the test started, whatever the sweep asks.
  const killOnly = (pid: number, calls: Array<{ groupId: number; signal: string }>) => (groupId: number, signal: "SIGTERM" | "SIGKILL") => {
    calls.push({ groupId, signal });
    if (groupId !== pid) throw new Error(`The sweep tried to signal group ${groupId}, not the test's child ${pid}`);
    process.kill(-groupId, signal);
  };

  linuxOnly(`the reader reports this boot's id, the engine's own group, and a live group's start time, user and executable as /proc shows them (breaks if the reader reads another field, another file, or the wrong process) [${reasonToSkip}]`, async () => {
    const pid = await startLeftover();
    expect(linuxProcessReader.bootId()).toBe(readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim());
    expect(linuxProcessReader.ownGroupId()).toBe(processGroupOf(process.pid));
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const startTicks = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    expect(linuxProcessReader.facts(pid)).toEqual({
      startTime: startTicks, userId: process.getuid?.(), executable: readlinkSync(`/proc/${pid}/exe`),
    });
    expect(processGroupOf(pid)).toBe(pid);
  });

  linuxOnly(`the reader reports nothing for a process that has exited (breaks if a finished child is still described, which would make the sweep wait for it forever) [${reasonToSkip}]`, async () => {
    const done = spawn("true", [], { detached: true, stdio: "ignore" });
    const pid = done.pid;
    await exitOf(done);
    expect(pid).toBeDefined();
    expect(linuxProcessReader.facts(pid as number)).toBeUndefined();
  });

  linuxOnly(`a recorded row for the test's own leftover child is stopped for real and the child is gone afterwards (breaks if the real reader's facts never equal the recorded ones, or the sweep returns while the group still runs) [${reasonToSkip}]`, async () => {
    const pid = await startLeftover();
    const facts = linuxProcessReader.facts(pid) as ProcessFacts;
    const calls: Array<{ groupId: number; signal: string }> = [];
    const row = rowFor({ groupId: pid, bootId: linuxProcessReader.bootId() as ProcessRow["bootId"], ...facts });
    const results = await run(sweepOrphans({ rows: [row], reader: linuxProcessReader, kill: killOnly(pid, calls), graceMillis: 3000 }));
    expect(results.map((result) => result.outcome)).toEqual(["stopped"]);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.every((call) => call.groupId === pid)).toBe(true);
    await exitOf(child as ChildProcess);
    expect(alive(pid)).toBe(false);
    expect(linuxProcessReader.facts(pid)).toBeUndefined();
  });

  for (const tamper of [
    { name: "a start time that is off by one", change: (facts: ProcessFacts): Partial<ProcessRow> => ({ startTime: String(Number(facts.startTime) + 1) }) },
    { name: "a different executable", change: (): Partial<ProcessRow> => ({ executable: "/usr/bin/not-the-adapter" }) },
    { name: "a different user", change: (facts: ProcessFacts): Partial<ProcessRow> => ({ userId: facts.userId + 1 }) },
    { name: "another boot's id", change: (): Partial<ProcessRow> => ({ bootId: "00000000-0000-0000-0000-000000000000" as ProcessRow["bootId"] }) },
  ]) {
    linuxOnly(`a row for the test's real child with ${tamper.name} leaves the child running and sends no signal (breaks if the sweep trusts the group id alone) [${reasonToSkip}]`, async () => {
      const pid = await startLeftover();
      const facts = linuxProcessReader.facts(pid) as ProcessFacts;
      const calls: Array<{ groupId: number; signal: string }> = [];
      const row = rowFor({ groupId: pid, bootId: linuxProcessReader.bootId() as ProcessRow["bootId"], ...facts, ...tamper.change(facts) });
      const results = await run(sweepOrphans({ rows: [row], reader: linuxProcessReader, kill: killOnly(pid, calls), graceMillis: 50 }));
      expect(results.map((result) => result.outcome)).toEqual(["left-alone"]);
      expect(calls).toEqual([]);
      expect(alive(pid)).toBe(true);
    });
  }

  linuxOnly(`a row naming the engine's own real group is never signalled, even when every other fact is read from the engine itself (breaks if the own-group guard is missing, which would stop the engine and its tests) [${reasonToSkip}]`, async () => {
    const ownGroup = linuxProcessReader.ownGroupId();
    const facts = linuxProcessReader.facts(ownGroup);
    const calls: Array<{ groupId: number; signal: string }> = [];
    const row = rowFor({ groupId: ownGroup, bootId: linuxProcessReader.bootId() as ProcessRow["bootId"], ...(facts ?? matching) });
    const results = await run(sweepOrphans({ rows: [row], reader: linuxProcessReader, kill: (groupId, signal) => { calls.push({ groupId, signal }); }, graceMillis: 20 }));
    expect(calls).toEqual([]);
    expect(results.map((result) => result.outcome)).toEqual(["left-alone"]);
  });
});
