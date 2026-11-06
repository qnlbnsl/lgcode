import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { main } from "../../scripts/live/run.ts";
import { startLiveService, type LiveService } from "../../scripts/live/service.ts";
import { fakeAgentPath } from "../support/serviceProcess.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { scriptedApi } from "./scripted-api.ts";

registerRebuildCheck({ noLog: true });
const fixtures: Array<ReturnType<typeof scriptedApi>> = [];
const services: LiveService[] = [];
const children: Array<{ child: ChildProcess; closed: Promise<void>; isClosed: () => boolean }> = [];
const folders: string[] = [];
const settle = (milliseconds: number) => new Promise<void>((done) => setTimeout(done, milliseconds));
const until = async (what: string, ready: () => boolean): Promise<void> => {
  const end = Date.now() + 20_000;
  while (!ready()) {
    if (Date.now() >= end) throw new Error(`timed out waiting for ${what}`);
    await settle(20);
  }
};

// A zombie has stopped executing, even if Node has not delivered "close" yet.
// Only a missing process counts as gone; other read failures must fail the test.
const stopped = (pid: number): boolean => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z ");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
};

afterEach(async () => {
  vi.restoreAllMocks();
  for (const process of children.splice(0)) {
    if (!process.isClosed()) process.child.kill("SIGKILL");
    await process.closed;
  }
  for (const service of services.splice(0)) { await service.stop(); service.remove(); }
  for (const fixture of fixtures.splice(0)) fixture.dispose();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

// Only unit 8a's fake agent is launched. Keeping stdin open lets the test
// prove that the production cleanup, rather than EOF, stopped the child.
const startFake = (home: string, state: string, echo: string) => {
  const child = spawn(process.execPath, [fakeAgentPath], {
    env: { PATH: process.env.PATH ?? "", HOME: home, SHEPRD_HOME: state, XDG_STATE_HOME: join(home, "xdg"), CODEX_HOME: join(home, "codex"),
      SHEPRD_SOCKET: join(state, "engine.sock"), FAKE_AGENT_ECHO: echo, FAKE_AGENT_SCRIPT: JSON.stringify({ turns: [], outliveStdin: true }) },
    stdio: ["pipe", "ignore", "pipe"],
  });
  child.stderr!.resume();
  let done = false;
  const closed = new Promise<void>((resolve) => { child.once("close", () => { done = true; resolve(); }); });
  const running = { child, closed, isClosed: () => done };
  children.push(running);
  return running;
};

describe("cleanup of an active run", () => {
  it.each(["owner-answer", "time-limit"])("%s stops its real /tmp service and both fake agents before returning, and spares another run (catches cleanup that only handles startup errors or signals unrelated pids)", async (failure) => {
    const fixture = scriptedApi(failure === "owner-answer" ? { step: failure } : { hangAnswer: true });
    fixtures.push(fixture);
    const service = startLiveService(fixture.deps.environment);
    services.push(service);
    const fake1 = startFake(fixture.home, service.state, join(service.root, "echo-one.json"));
    const fake2 = startFake(fixture.home, service.state, join(service.root, "echo-two.json"));
    const other = startFake(fixture.home, fixture.state, join(fixture.root, "other-echo.json"));
    await until("the fake agents and the service socket", () => [join(service.root, "echo-one.json"), join(service.root, "echo-two.json"), join(fixture.root, "other-echo.json"), join(service.state, "engine.sock")].every(existsSync));
    expect(JSON.parse(readFileSync(join(service.root, "echo-one.json"), "utf8")).pid).toBe(fake1.child.pid);
    const owned = new Set([service.pid, fake1.child.pid!, fake2.child.pid!]);
    const signalled: number[] = [];
    const realKill = process.kill.bind(process);
    const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      // Guard before forwarding: this test can never signal a process it did
      // not start, even if a production process-discovery regression occurs.
      if (!owned.has(pid)) throw new Error(`cleanup attempted an unowned pid: ${pid}`);
      signalled.push(pid);
      return realKill(pid, signal);
    });
    const code = await main([], {
      ...fixture.deps,
      // The real service's lifecycle is exercised, while API responses stay
      // controlled and can fail at the exact middle step under test.
      startService: () => ({ ...service, work: fixture.work }),
      config: { ...fixture.deps.config, totalTimeout: failure === "time-limit" ? 150 : 10_000 },
    });
    // Snapshot synchronously at return: waiting for "close" first would hide
    // cleanup that returned while one of its processes was still running.
    const stoppedAtReturn = {
      service: stopped(service.pid), fake1: stopped(fake1.child.pid!), fake2: stopped(fake2.child.pid!),
      other: stopped(other.child.pid!),
    };
    expect(code).toBe(1);
    expect(fixture.lines.some((line) => line.startsWith(`FAIL ${failure}:`))).toBe(true);
    expect(stoppedAtReturn).toEqual({ service: true, fake1: true, fake2: true, other: false });
    await until("the stopped service and both fake agents to deliver close", () => service.exited() && fake1.isClosed() && fake2.isClosed());
    expect(service.exited()).toBe(true);
    expect(fake1.isClosed()).toBe(true);
    expect(fake2.isClosed()).toBe(true);
    expect(other.isClosed()).toBe(false);
    expect(signalled).toEqual(expect.arrayContaining([service.pid, fake1.child.pid, fake2.child.pid]));
    expect(kill.mock.calls.every(([pid]) => owned.has(pid))).toBe(true);
    expect(kill.mock.calls.some(([pid]) => pid === other.child.pid)).toBe(false);
  });

  it("awaits owner-connection finalizers before returning on the total limit (catches aborting the journey without awaiting it; issue 202)", async () => {
    const fixture = scriptedApi({ hangAnswer: true });
    fixtures.push(fixture);
    let opened = 0;
    let closed = 0;
    let pendingFinalizer: Promise<void> = Promise.resolve();
    const code = await main([], {
      ...fixture.deps, config: { ...fixture.deps.config, totalTimeout: 60 },
      connectOwner: (state) => Effect.acquireRelease(
        fixture.deps.connectOwner(state).pipe(Effect.tap(() => Effect.sync(() => { opened += 1; }))),
        () => Effect.promise(() => {
          pendingFinalizer = settle(60).then(() => { closed += 1; });
          return pendingFinalizer;
        }),
      ),
    });
    // Capture at the user-visible return boundary, then allow the real
    // finalizers to finish so a failing assertion leaves no asynchronous work.
    const closedAtReturn = closed;
    const openedAtReturn = opened;
    await settle(300);
    await pendingFinalizer;
    expect(code).toBe(1);
    expect(openedAtReturn).toBeGreaterThan(0);
    expect(closedAtReturn).toBe(openedAtReturn);
  });

  it("spares a fake agent in a sibling folder whose name starts with this run's root (catches substring matching an unrelated run during cleanup; issue 204)", async () => {
    const fixture = scriptedApi({ step: "owner-answer" });
    fixtures.push(fixture);
    const service = startLiveService(fixture.deps.environment);
    services.push(service);
    const sibling = mkdtempSync(`${service.root}-other-`);
    folders.push(sibling);
    const echo = join(sibling, "echo.json");
    const other = startFake(fixture.home, join(sibling, "state"), echo);
    await until("the sibling agent and the service socket", () => existsSync(echo) && existsSync(join(service.state, "engine.sock")));
    const allowed = new Set([service.pid, other.child.pid!]);
    const realKill = process.kill.bind(process);
    const signalled: number[] = [];
    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (!allowed.has(pid)) throw new Error(`cleanup attempted an unowned pid: ${pid}`);
      signalled.push(pid);
      return realKill(pid, signal);
    });
    expect(await main([], { ...fixture.deps, startService: () => ({ ...service, work: fixture.work }) })).toBe(1);
    expect(signalled).not.toContain(other.child.pid);
    expect(other.isClosed()).toBe(false);
  });

  it("cannot start a service after timing out in the startup-hook probe (catches uncancelled preflight work continuing after exit; issue 202)", async () => {
    const fixture = scriptedApi();
    fixtures.push(fixture);
    let release: (answer: boolean) => void = () => undefined;
    const answer = new Promise<boolean>((resolve) => { release = resolve; });
    const code = await main([], {
      ...fixture.deps, config: { ...fixture.deps.config, totalTimeout: 30 },
      hook: { ...fixture.deps.hook, answers: () => answer },
    });
    const returnedLines = fixture.lines.length;
    release(true);
    await until("late work to settle", () => fixture.calls.includes("removed") || fixture.calls.includes("stopped") || fixture.lines.length === returnedLines);
    await settle(100);
    expect(code).toBe(1);
    expect(fixture.calls).not.toContain("service");
    expect(fixture.lines).toHaveLength(returnedLines);
  });
});
