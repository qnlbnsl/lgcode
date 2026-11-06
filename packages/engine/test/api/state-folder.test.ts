// Criterion 7.1 (unit 7a; rows 21, 37, 48, 54, 74): the state folder is
// created 0700 under umask 077; the service refuses to start if the folder is
// a symbolic link, not owned by its user, not 0700, or if the socket path
// exceeds 100 bytes; every regular file in it is 0600; the socket is the
// only listener and there is no TCP listener. Every case runs the real
// service as a child process (`packages/engine/src/service.ts`).
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, chmodSync } from "node:fs";
import { join } from "node:path";

import { afterEach, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import {
  makeServiceRoot, ownerClient, startFakeAgent, startService, stopAllServices, waitFor, waitServing,
  type ServiceProcess,
} from "../support/serviceProcess.ts";

// These cases never open an event log in this process; the service owns it.
registerRebuildCheck({ noLog: true });

// Every requirement is provided inside the test; the cast keeps the missing
// production modules from widening the requirement type.
const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>, timeout: number) =>
  it.live(name, () => test() as Effect.Effect<void, unknown, never>, timeout);
const liveIf = (skip: boolean) => (name: string, test: () => Effect.Effect<unknown, unknown, any>, timeout: number) =>
  it.live.skipIf(skip)(name, () => test() as Effect.Effect<void, unknown, never>, timeout);

afterEach(async () => { await stopAllServices(); });

const failedToStart = (service: ServiceProcess) => Effect.gen(function* () {
  const exit = yield* Effect.promise(() => Promise.race([
    service.exit,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 20_000)),
  ]));
  if (exit === undefined) return yield* Effect.die(new Error(`The service kept running; output:\n${service.output()}`));
  return exit;
});

const modeOf = (path: string) => lstatSync(path).mode & 0o7777;

// The service names each refusal with fixed text (no path), so a crash or a
// missing module can never pass for a refusal.
const expectReason = (service: ServiceProcess, reason: string) => expect(service.output()).toContain(reason);

const walk = (folder: string): Array<string> => readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
  const path = join(folder, entry.name);
  return entry.isDirectory() ? [path, ...walk(path)] : [path];
});

live("7.1 creates the missing state folder 0700 and every regular file in it 0600 even under umask 000 (breaks if the service does not set umask 077 itself, or creates the folder or any file with group or other bits)", () =>
  Effect.gen(function* () {
    const root = makeServiceRoot();
    expect(existsSync(root.state)).toBe(false);
    const service = startService(root, { umask: 0o000 });
    yield* waitServing(root, service);
    yield* Effect.scoped(Effect.gen(function* () {
      const owner = yield* ownerClient(root);
      // A flow that writes the secret store, the log and an agent's files.
      const agent = yield* startFakeAgent(root, owner, owner, {
        script: { turns: [[{ step: "text", text: "hello" }]] }, prompt: "Say hello.",
        secrets: { API_KEY: "planted-secret-value-0123456789" },
      });
      yield* waitFor("the fake agent's first prompt", () => existsSync(agent.echo) && readFileSync(agent.echo, "utf8").includes("session/prompt"));
    }));
    expect(lstatSync(root.state).isDirectory()).toBe(true);
    expect(modeOf(root.state)).toBe(0o700);
    const entries = walk(root.state);
    expect(entries.some((path) => lstatSync(path).isFile()), "the state folder holds no regular file").toBe(true);
    for (const path of entries) {
      const stats = lstatSync(path);
      if (stats.isFile()) expect([path, modeOf(path).toString(8)]).toEqual([path, "600"]);
      else if (stats.isDirectory()) expect([path, (modeOf(path) & 0o077).toString(8)]).toEqual([path, "0"]);
    }
  }), 90_000);

live("7.1 refuses a state folder that is a symbolic link, and creates nothing behind it (breaks if the folder check follows the link, as stat does, instead of using lstat)", () =>
  Effect.gen(function* () {
    const root = makeServiceRoot();
    const target = realpathSync(mkdtempSync("/tmp/sh7t-"));
    try {
      chmodSync(target, 0o700);
      symlinkSync(target, root.state);
      const service = startService(root);
      const exit = yield* failedToStart(service);
      expect(exit.signal).toBeNull();
      expect(exit.code).not.toBe(0);
      expectReason(service, "state folder is a symbolic link");
      expect(readdirSync(target), "the service wrote through the link").toEqual([]);
      expect(readlinkSync(root.state)).toBe(target);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  }), 60_000);

live("7.1 refuses a state folder whose mode is not 0700 and leaves its mode as it was (breaks if the mode is repaired with chmod, or only the owner bits are checked)", () =>
  Effect.gen(function* () {
    for (const mode of [0o750, 0o701, 0o1700]) {
      const root = makeServiceRoot();
      mkdirSync(root.state);
      chmodSync(root.state, mode);
      const service = startService(root);
      const exit = yield* failedToStart(service);
      expect([mode.toString(8), exit.code === 0, exit.signal]).toEqual([mode.toString(8), false, null]);
      expectReason(service, "state folder mode is not 0700");
      expect(modeOf(root.state).toString(8)).toBe(mode.toString(8));
      expect(existsSync(root.socket)).toBe(false);
    }
  }), 90_000);

// A folder owned by another user cannot be made without root, so the case
// borrows an existing 0700 folder owned by someone else, read only by lstat.
const foreignFolder = (): string | undefined => {
  if (process.getuid?.() === 0) return undefined;
  const candidates = ["/root", ...(() => { try { return readdirSync("/tmp").filter((name) => name.startsWith("systemd-private-")).map((name) => join("/tmp", name)); } catch { return []; } })()];
  return candidates.find((path) => {
    try { const stats = lstatSync(path); return stats.isDirectory() && stats.uid !== process.getuid?.() && (stats.mode & 0o7777) === 0o700; } catch { return false; }
  });
};

liveIf(foreignFolder() === undefined)("7.1 refuses a 0700 state folder owned by another user (breaks if ownership is not compared with the service's own user id)", () =>
  Effect.gen(function* () {
    const root = makeServiceRoot();
    const folder = foreignFolder()!;
    const service = startService(root, { env: { SHEPRD_HOME: folder } });
    const exit = yield* failedToStart(service);
    expect(exit.signal).toBeNull();
    expect(exit.code).not.toBe(0);
    expectReason(service, "state folder is owned by another user");
  }), 60_000);

live("7.1 starts with a socket path of exactly 100 bytes and refuses one of 101 bytes before creating anything (breaks on an off-by-one limit, a limit counted in characters, or a check made after listening)", () =>
  Effect.gen(function* () {
    const pathFor = (root: string, bytes: number) => {
      const name = "s".repeat(bytes - Buffer.byteLength(`${root}/`) - Buffer.byteLength("/engine.sock"));
      return join(root, name);
    };
    const fits = makeServiceRoot();
    const fitsHome = pathFor(fits.root, 100);
    const fitsSocket = join(fitsHome, "engine.sock");
    expect(Buffer.byteLength(fitsSocket)).toBe(100);
    const accepted = startService(fits, { env: { SHEPRD_HOME: fitsHome } });
    yield* waitServing({ ...fits, state: fitsHome, socket: fitsSocket }, accepted);
    expect(lstatSync(fitsSocket).isSocket()).toBe(true);

    const long = makeServiceRoot();
    const longHome = pathFor(long.root, 101);
    expect(Buffer.byteLength(join(longHome, "engine.sock"))).toBe(101);
    const refused = startService(long, { env: { SHEPRD_HOME: longHome } });
    const exit = yield* failedToStart(refused);
    expect(exit.code).not.toBe(0);
    expectReason(refused, "socket path exceeds 100 bytes");
    expect(exit.signal).toBeNull();
    expect(existsSync(join(longHome, "engine.sock"))).toBe(false);
  }), 90_000);

// The service's own sockets, from its file descriptors, matched against the
// kernel's socket tables by inode.
const socketInodes = (pid: number): Set<string> => {
  const inodes = new Set<string>();
  for (const fd of readdirSync(`/proc/${pid}/fd`)) {
    try {
      const match = /^socket:\[(\d+)\]$/.exec(readlinkSync(`/proc/${pid}/fd/${fd}`));
      if (match !== null) inodes.add(match[1]!);
    } catch { /* closed meanwhile */ }
  }
  return inodes;
};
const inetInodes = (pid: number): Array<{ table: string; line: string }> => ["tcp", "tcp6", "udp", "udp6", "raw", "raw6"].flatMap((table) => {
  let text = "";
  try { text = readFileSync(`/proc/${pid}/net/${table}`, "utf8"); } catch { return []; }
  return text.trim().split("\n").slice(1).map((line) => ({ table, line: line.trim() }));
});
const listeningUnix = (pid: number): Array<{ inode: string; path: string }> =>
  readFileSync(`/proc/${pid}/net/unix`, "utf8").trim().split("\n").slice(1).flatMap((line) => {
    const fields = line.trim().split(/\s+/);
    // Num RefCount Protocol Flags Type St Inode [Path]; flag 0x10000 is __SO_ACCEPTCON, a listener.
    const flags = Number.parseInt(fields[3]!, 16);
    return (flags & 0x10000) !== 0 ? [{ inode: fields[6]!, path: fields[7] ?? "" }] : [];
  });

liveIf(process.platform !== "linux")("7.1 the service's only listening socket is engine.sock and it holds no TCP, UDP or raw socket, with an agent running (breaks on any TCP or loopback listener, or a second Unix listener such as a debug port)", () =>
  Effect.gen(function* () {
    const root = makeServiceRoot();
    const service = startService(root);
    yield* waitServing(root, service);
    yield* Effect.scoped(Effect.gen(function* () {
      const owner = yield* ownerClient(root);
      const agent = yield* startFakeAgent(root, owner, owner, { script: { turns: [[{ step: "slow", ms: 30_000 }]] }, prompt: "Hold the turn open." });
      yield* waitFor("the fake agent's prompt", () => existsSync(agent.echo) && readFileSync(agent.echo, "utf8").includes("session/prompt"));
      const own = socketInodes(service.pid);
      const inet = inetInodes(service.pid).filter(({ line }) => own.has(line.split(/\s+/)[9]!));
      expect(inet, "the service holds an inet socket").toEqual([]);
      const listeners = listeningUnix(service.pid).filter((entry) => own.has(entry.inode));
      expect(listeners.map((entry) => entry.path)).toEqual([root.socket]);
    }));
  }), 90_000);
