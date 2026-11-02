// Unit 8c: the fresh service of `pnpm live-check`. The script stops only what
// it started: its own service, and processes whose environment names its own
// random /tmp folder. A process that does not name the folder is never signalled.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { processesNaming, serviceEnvironment, startLiveService, type LiveService } from "../../scripts/live/service.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });

const cleanup: Array<() => void> = [];
afterEach(() => { for (const task of cleanup.splice(0)) task(); });

const alive = (pid: number): boolean => {
  try { const stat = readFileSync(`/proc/${pid}/stat`, "utf8"); return stat.slice(stat.lastIndexOf(")") + 2)[0] !== "Z"; } catch { return false; }
};
const until = async (what: string, ready: () => boolean, limit = 40_000): Promise<void> => {
  const deadline = Date.now() + limit;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 50));
  }
};
const decoy = (env: Record<string, string>): ChildProcess => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { env: { PATH: process.env.PATH ?? "", ...env }, stdio: "ignore" });
  cleanup.push(() => { child.kill("SIGKILL"); });
  return child;
};

describe("the live service", () => {
  it("gives the service the fresh state folder and the owner's login variables, and nothing else of the owner's environment (breaks if the real SHEPHRD_HOME, a key or a token is passed on)", () => {
    const environment = serviceEnvironment({
      HOME: "/home/owner", PATH: "/usr/bin", SHEPHRD_HOME: "/home/owner/real-state", XDG_STATE_HOME: "/home/owner/state",
      ANTHROPIC_API_KEY: "sk-never-passed-0123456789", SHEPHRD_TOKEN: "agent-token-never-passed", CODEX_HOME: "/home/owner/.codex",
    }, "/tmp/shephrd-live-x/state");
    expect(environment).toEqual({
      HOME: "/home/owner", PATH: "/usr/bin", CODEX_HOME: "/home/owner/.codex",
      SHEPHRD_HOME: "/tmp/shephrd-live-x/state", SHEPHRD_TEST_DEBUG: "1", TMPDIR: "/tmp",
    });
  });

  it("starts a real service in its own /tmp folder, then stops it and an adapter that names the folder, spares a process that does not, and removes the folder (breaks if the stop signals an unrelated process or leaves the adapter running)", async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "sh8c-svc-home-")));
    cleanup.push(() => { rmSync(home, { recursive: true, force: true }); });
    const service: LiveService = startLiveService({ HOME: home, PATH: process.env.PATH });
    cleanup.push(() => { void service.stop().then(() => { service.remove(); }); });
    expect(service.root.startsWith("/tmp/shephrd-live-")).toBe(true);
    expect(service.state).toBe(join(service.root, "state"));
    expect(statSync(service.root).mode & 0o777).toBe(0o700);
    await until("the service socket", () => existsSync(join(service.state, "engine.sock")) || service.exited());
    expect(service.exited(), service.output()).toBe(false);

    const adapter = decoy({ SHEPHRD_SOCKET: join(service.state, "engine.sock") });
    const stranger = decoy({ SHEPHRD_SOCKET: "/tmp/someone-elses/engine.sock" });
    await until("the decoys", () => adapter.pid !== undefined && stranger.pid !== undefined);
    expect(processesNaming(service.root)).toContain(adapter.pid);
    expect(processesNaming(service.root)).not.toContain(stranger.pid);

    const killed = await service.stop();
    expect(alive(service.pid)).toBe(false);
    expect(alive(adapter.pid!)).toBe(false);
    expect(alive(stranger.pid!)).toBe(true);
    expect(killed).toEqual([]);
    expect(existsSync(service.logFile)).toBe(true);
    expect(statSync(service.logFile).mode & 0o777).toBe(0o600);
    service.remove();
    expect(existsSync(service.root)).toBe(false);
  }, 90_000);
});
