// Unit 8c, fix round 1, findings F4 and F10 (issue 204):
// the run signals only processes it started, found by whole path parts and by
// descent from the service child, and `main` says so when it cannot confirm
// that everything it started has stopped.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { main } from "../../scripts/live/run.ts";
import { processesNaming } from "../../scripts/live/service.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { scriptedApi } from "./scripted-api.ts";

registerRebuildCheck({ noLog: true });
const cleanup: Array<() => void> = [];
afterEach(() => { for (const task of cleanup.splice(0)) task(); });

const alive = (pid: number): boolean => {
  try { const stat = readFileSync(`/proc/${pid}/stat`, "utf8"); return stat.slice(stat.lastIndexOf(")") + 2)[0] !== "Z"; } catch { return false; }
};
const decoy = (options: { env?: Record<string, string>; cwd?: string; args?: ReadonlyArray<string> }): ChildProcess => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", ...options.args === undefined ? [] : ["--", ...options.args]], {
    env: { PATH: process.env.PATH ?? "", ...options.env }, stdio: "ignore", ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });
  cleanup.push(() => { child.kill("SIGKILL"); });
  return child;
};
const settle = (milliseconds: number) => new Promise<void>((done) => setTimeout(done, milliseconds));

describe("which processes belong to a run", () => {
  it("counts a process by whole path parts: inside the folder yes, a sibling whose name starts with it no (breaks if the match is a substring; finding F4)", async () => {
    const root = realpathSync(mkdtempSync("/tmp/sh8c-own-"));
    const sibling = `${root}-other`;
    mkdirSync(sibling);
    mkdirSync(join(root, "work"));
    cleanup.push(() => { rmSync(root, { recursive: true, force: true }); rmSync(sibling, { recursive: true, force: true }); });
    const byEnvironment = decoy({ env: { SHEPRD_SOCKET: join(root, "state", "engine.sock") } });
    const byFolder = decoy({ cwd: join(root, "work") });
    const byArgument = decoy({ args: [`--dir=${root}/x`] });
    const byRoot = decoy({ env: { WORK: root } });
    const siblingEnvironment = decoy({ env: { SHEPRD_SOCKET: join(sibling, "state", "engine.sock") } });
    const siblingFolder = decoy({ cwd: sibling });
    const siblingArgument = decoy({ args: [`--dir=${sibling}/x`, `${root}x`] });
    await settle(400);
    const named = processesNaming(root);
    for (const owned of [byEnvironment, byFolder, byArgument, byRoot]) expect(named).toContain(owned.pid);
    for (const stranger of [siblingEnvironment, siblingFolder, siblingArgument]) expect(named).not.toContain(stranger.pid);
  });

  it("counts the descendants of the service child even when they name nothing (breaks if an adapter that changed folder and environment is left running)", async () => {
    const root = realpathSync(mkdtempSync("/tmp/sh8c-own-"));
    cleanup.push(() => { rmSync(root, { recursive: true, force: true }); });
    const parent = decoy({ env: { WORK: root } });
    // A grandchild with a clean environment and a folder outside the root.
    const grandchild = spawn(process.execPath, ["-e", `const { spawn } = require("node:child_process"); const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { env: {}, cwd: "/", stdio: "ignore" }); process.stdout.write(String(c.pid)); setInterval(() => {}, 1000)`],
      { env: { PATH: process.env.PATH ?? "" }, stdio: ["ignore", "pipe", "ignore"] });
    cleanup.push(() => { grandchild.kill("SIGKILL"); });
    const child = Number(await new Promise<string>((done) => grandchild.stdout!.once("data", (chunk: Buffer) => { done(chunk.toString()); })));
    cleanup.push(() => { try { process.kill(child, "SIGKILL"); } catch { /* gone */ } });
    await settle(300);
    expect(processesNaming(root)).not.toContain(child);
    expect(processesNaming(root, [], [grandchild.pid!])).toContain(child);
    expect(processesNaming(root)).toContain(parent.pid);
  });
});

describe("a stop that cannot be confirmed", () => {
  it("fails the run by name, skips the recording, keeps the folder and says the cleanup was not confirmed (breaks if main swallows a failed stop; finding F10)", async () => {
    const fixture = scriptedApi();
    const code = await main([], {
      ...fixture.deps,
      startService: () => ({ ...fixture.service, stop: async () => { throw new Error("cleanup was not confirmed: 4242 still running"); } }),
    });
    const text = fixture.lines.join("\n");
    fixture.dispose();
    expect(code).toBe(1);
    expect(text).toMatch(/FAIL cleanup: .*4242 still running/);
    expect(text).toContain("Cleanup was not confirmed");
    expect(text).toContain("The run's folder is kept at");
    expect(fixture.calls).not.toContain("record");
    expect(fixture.calls).not.toContain("removed");
  });
});

describe("the stop of a real service", () => {
  it("kills a process of the run that ignores the first signal and reports it, and still spares a stranger (breaks if the second signal is skipped)", async () => {
    const { startLiveService } = await import("../../scripts/live/service.ts");
    const { existsSync } = await import("node:fs");
    const service = startLiveService({ HOME: process.env.HOME ?? "/tmp", PATH: process.env.PATH });
    cleanup.push(() => { void service.stop().then(() => { service.remove(); }); });
    const deadline = Date.now() + 40_000;
    while (!existsSync(join(service.state, "engine.sock")) && !service.exited() && Date.now() < deadline) await settle(50);
    const stubborn = spawn(process.execPath, ["-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], {
      env: { PATH: process.env.PATH ?? "", SHEPRD_SOCKET: join(service.state, "engine.sock") }, stdio: "ignore",
    });
    cleanup.push(() => { stubborn.kill("SIGKILL"); });
    const stranger = decoy({ env: { SHEPRD_SOCKET: "/tmp/someone-elses/engine.sock" } });
    await settle(400);
    const killed = await service.stop();
    expect(alive(stubborn.pid!)).toBe(false);
    expect(killed).toContain(stubborn.pid);
    expect(alive(stranger.pid!)).toBe(true);
    service.remove();
  }, 90_000);
});
