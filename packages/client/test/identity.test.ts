// 7.9, rows 54/64/71. Socket checks precede any upgrade and credential.
import { chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import {
  agentEnvironment, cleanupUnit7b, fakeEngine, loadClient, ownerCredential, prepareRoot, serviceEnvironment, token,
} from "../../testing/test/support/unit7b.ts";

afterEach(cleanupUnit7b);
const attempt = (effect: Effect.Effect<unknown, unknown, any>) =>
  Effect.runPromise(Effect.exit(Effect.scoped(effect)) as Effect.Effect<Exit.Exit<unknown, unknown>>);
const refusal = (exit: Exit.Exit<unknown, unknown>) => {
  expect(Exit.isFailure(exit), "unsafe identity/socket must be refused").toBe(true);
  const message = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "";
  expect(message.trim().length).toBeGreaterThan(0);
  for (const secret of [token, ownerCredential]) expect(message.includes(secret), "credential leaked in error").toBe(false);
  return message;
};

it("I01 catches owner fallback when an explicit agent token/socket should win", async () => {
  const connect = await loadClient();
  const root = prepareRoot();
  const peer = await fakeEngine(root);
  expect(Exit.isSuccess(await attempt(connect({ environment: agentEnvironment(root) })))).toBe(true);
  expect(peer.upgrades.length).toBe(1);
  expect(peer.upgrades[0]!.authorization === `Bearer ${token}`, "wrong credential source").toBe(true);
  expect(JSON.stringify(peer.requests).includes(token)).toBe(false);
});

it("I02 catches refusing the owner's terminal, or reading the credential as UTF-8 instead of base64url when both variables are absent", async () => {
  const connect = await loadClient();
  const root = prepareRoot();
  const peer = await fakeEngine(root);
  expect(Exit.isSuccess(await attempt(connect({ environment: serviceEnvironment(root) })))).toBe(true);
  expect(peer.upgrades.length).toBe(1);
  expect(peer.upgrades[0]!.authorization === `Bearer ${ownerCredential}`, "owner credential encoding/source").toBe(true);
});

for (const present of ["LGTM_SOCKET", "LGTM_TOKEN"] as const) {
  it(`I03 ${present} alone catches silent owner fallback or a credential sent with incomplete agent identity`, async () => {
    const connect = await loadClient();
    const root = prepareRoot();
    const peer = await fakeEngine(root);
    const environment = { ...serviceEnvironment(root), [present]: present === "LGTM_SOCKET" ? root.socket : token };
    const message = refusal(await attempt(connect({ environment })));
    expect(message).toMatch(/LGTM_SOCKET|LGTM_TOKEN|both|together/i);
    expect(peer.upgrades).toHaveLength(0);
  });
}

for (const mode of [0o770, 0o707, 0o777]) {
  it(`I04 mode ${mode.toString(8)} catches checking only the socket's immediate directory and leaking a credential through a writable ancestor`, async () => {
    const connect = await loadClient();
    const root = prepareRoot();
    const ancestor = join(root.root, "unsafe");
    const folder = join(ancestor, "private");
    mkdirSync(ancestor, { mode: 0o700 });
    mkdirSync(folder, { mode: 0o700 });
    chmodSync(ancestor, mode);
    const socketPath = join(folder, "engine.sock");
    const peer = await fakeEngine(root, { socketPath });
    refusal(await attempt(connect({ environment: { ...agentEnvironment(root), LGTM_SOCKET: socketPath } })));
    expect(peer.upgrades).toHaveLength(0);
  });
}

it("I05 catches checking the symlink spelling instead of every parent of the socket's real path", async () => {
  const connect = await loadClient();
  const root = prepareRoot();
  const ancestor = join(root.root, "unsafe-real");
  const folder = join(ancestor, "private");
  mkdirSync(ancestor, { mode: 0o700 });
  mkdirSync(folder, { mode: 0o700 });
  chmodSync(ancestor, 0o777);
  const realSocket = join(folder, "engine.sock");
  const peer = await fakeEngine(root, { socketPath: realSocket });
  symlinkSync(realSocket, root.socket);
  refusal(await attempt(connect({ environment: agentEnvironment(root) })));
  expect(peer.upgrades).toHaveLength(0);
});

it("I06 catches treating a regular file as a socket and reporting only a transport failure", async () => {
  const connect = await loadClient();
  const root = prepareRoot();
  writeFileSync(root.socket, "not a socket", { mode: 0o600 });
  const message = refusal(await attempt(connect({ environment: agentEnvironment(root) })));
  expect(message).toMatch(/socket/i);
  expect(message).not.toMatch(/ECONNREFUSED|ENOTSOCK/);
});

for (const mode of [0o755, 0o770, 0o1777]) {
  it(`I09 immediate folder ${mode.toString(8)} catches applying an ancestor exception to the socket's own folder instead of requiring user-owned 0700`, async () => {
    const connect = await loadClient();
    const root = prepareRoot();
    const peer = await fakeEngine(root);
    chmodSync(root.state, mode);
    refusal(await attempt(connect({ environment: agentEnvironment(root) })));
    expect(peer.upgrades).toHaveLength(0);
  });
}

// Approved by engine-lead #1105: inject only the stat facts an unprivileged
// test cannot create. The listener and WebSocket connection stay real.
for (const branch of ["foreign parent", "foreign socket", "root socket", "foreign sticky", "root sticky", "root nonsticky", "root safe"] as const) {
  it(`I07 ${branch} catches accepting a foreign owner or applying the sticky-directory exception too broadly`, async () => {
    const connect = await loadClient();
    const root = prepareRoot();
    const ancestor = join(root.root, "ancestor");
    const folder = join(ancestor, "private");
    mkdirSync(ancestor, { mode: 0o700 });
    mkdirSync(folder, { mode: 0o700 });
    const socketPath = join(folder, "engine.sock");
    const peer = await fakeEngine(root, { socketPath });
    const uid = process.getuid!();
    const socketSecurity = {
      uid, realpath: (path: string) => realpathSync(path),
      lstat: (path: string) => {
        const stat = lstatSync(path);
        let owner = stat.uid;
        let mode = stat.mode;
        if (path === ancestor) {
          owner = branch.startsWith("root") ? 0 : uid + 1;
          if (branch.endsWith("sticky") && branch !== "root nonsticky") mode = (mode & ~0o7777) | 0o1777;
          if (branch === "root nonsticky") mode = (mode & ~0o7777) | 0o777;
          if (branch === "foreign socket" || branch === "root socket") owner = uid;
        }
        if (path === socketPath && branch === "foreign socket") owner = uid + 1;
        if (path === socketPath && branch === "root socket") owner = 0;
        return { uid: owner, mode, isDirectory: () => stat.isDirectory(), isSocket: () => stat.isSocket(), isSymbolicLink: () => stat.isSymbolicLink() };
      },
    };
    const exit = await attempt(connect({ environment: { ...agentEnvironment(root), LGTM_SOCKET: socketPath }, socketSecurity }));
    if (branch === "root sticky" || branch === "root safe") {
      expect(Exit.isSuccess(exit)).toBe(true);
      expect(peer.upgrades).toHaveLength(1);
    } else {
      refusal(exit);
      expect(peer.upgrades).toHaveLength(0);
    }
  });
}

it("I08 catches omitting or inventing the caller's process ancestry/start times or process group on upgrade", async () => {
  const connect = await loadClient();
  const root = prepareRoot();
  const peer = await fakeEngine(root);
  expect(Exit.isSuccess(await attempt(connect({ environment: agentEnvironment(root) })))).toBe(true);
  const headers = peer.upgrades[0]!;
  const chain = String(headers["lgtm-ancestors"]).split(",");
  const stat = (pid: number) => {
    const text = readFileSync(`/proc/${pid}/stat`, "utf8");
    return text.slice(text.lastIndexOf(")") + 2).trim().split(/\s+/);
  };
  expect(chain[0]).toBe(`${process.pid}:${stat(process.pid)[19]}`);
  expect(chain[1]).toBe(`${process.ppid}:${stat(process.ppid)[19]}`);
  expect(headers["lgtm-process-group"]).toBe(stat(process.pid)[2]);
  let pid = process.pid;
  for (const pair of chain) {
    const fields = stat(pid);
    expect(pair).toBe(`${pid}:${fields[19]}`);
    pid = Number(fields[1]);
  }
  expect(pid).toBe(0);
});
