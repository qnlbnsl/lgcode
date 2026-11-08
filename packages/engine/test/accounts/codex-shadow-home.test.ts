import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { layer as persistentSecretStore } from "../../src/accounts/SecretStore.ts";
import { SecretStore } from "../../src/commands/SecretStore.ts";
import {
  accountFor, echoFile, harnessFor, makeRunnerRig, readEcho, removeRunnerRig, serviceEnvironment,
  startPayloadFor, withEngine, writeFakeAdapter, type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { call, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { snapshot } from "../support/routingRig.ts";

let rig: RunnerRig;
beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("LGCODE_HOME", rig.stateFolder);
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("CODEX_HOME", join(rig.home, ".codex"));
});
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig); });

it.effect("6.5 E1: catches a second account sharing the first login, missing shared sessions, or losing its shadow CODEX_HOME at spawn", () => Effect.gen(function* () {
  const shared = join(rig.home, ".codex");
  mkdirSync(join(shared, "sessions"), { recursive: true });
  writeFileSync(join(shared, "auth.json"), '{"account":"first-only"}');
  writeFileSync(join(shared, "config.toml"), 'model = "fixture-model"\n');
  writeFileSync(join(shared, "sessions", "thread.jsonl"), '{"thread":"shared"}\n');
  const originalAuth = readFileSync(join(shared, "auth.json"), "utf8");
  const originalConfig = readFileSync(join(shared, "config.toml"), "utf8");
  const firstEcho = echoFile(rig);
  const secondEcho = echoFile(rig);
  const harness = harnessFor("codex", writeFakeAdapter(rig));
  // The copied managed layout uses "codex" for the direct default home.
  // Extra instances get private authentication and links into that home.
  const first = accountFor("codex", {}, firstEcho, {}, "codex");
  const second = accountFor("codex", {}, secondEcho, {}, "secondary");
  yield* withEngine(rig, { harness, accounts: [first, second] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    success(yield* call(ownerCredential, "start", startPayloadFor(harness, first, rig.work)));
    const firstChild = yield* readEcho(firstEcho);
    expect(firstChild.env.HOME).toBe(rig.home);
    expect(firstChild.env.CODEX_HOME ?? shared).toBe(shared);
    success(yield* call(ownerCredential, "start", startPayloadFor(harness, second, rig.work)));
    const secondChild = yield* readEcho(secondEcho);
    const shadow = secondChild.env.CODEX_HOME;
    expect(shadow, "the second child's effective home must be explicit").toBeDefined();
    if (shadow === undefined) return;
    expect(resolve(shadow)).toBe(shadow);
    expect(relative(rig.stateFolder, shadow)).not.toMatch(/^\.\.(?:\/|$)/);
    expect(shadow).not.toBe(rig.stateFolder);
    expect(shadow).not.toBe(shared);
    expect(secondChild.env.HOME).toBe(rig.home);
    expect(lstatSync(join(shadow, "sessions")).isSymbolicLink()).toBe(true);
    expect(resolve(shadow, readlinkSync(join(shadow, "sessions")))).toBe(join(shared, "sessions"));
    expect(readFileSync(join(shadow, "sessions", "thread.jsonl"), "utf8")).toBe('{"thread":"shared"}\n');
    expect(readFileSync(join(shadow, "config.toml"), "utf8")).toBe(originalConfig);
    expect(existsSync(join(shadow, "auth.json")), "the first account's auth must not be linked or copied").toBe(false);
    writeFileSync(join(shadow, "auth.json"), '{"account":"second-only"}', { mode: 0o600 });
    expect(lstatSync(join(shadow, "auth.json")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(shared, "auth.json"), "utf8")).toBe(originalAuth);
    expect(readFileSync(join(shared, "config.toml"), "utf8")).toBe(originalConfig);
    expect((yield* readEcho(firstEcho)).env.CODEX_HOME).toBe(firstChild.env.CODEX_HOME);
  }));
}).pipe(Effect.orDie));

it.effect("A9 codex home: catches a Codex account whose `home` is ignored, so the child runs on the default login (the default account uses that home directly, another account shares sessions from it under a private login)", () => Effect.gen(function* () {
  const ownHome = join(rig.root, "codex-own");
  mkdirSync(join(ownHome, "sessions"), { recursive: true });
  writeFileSync(join(ownHome, "auth.json"), '{"account":"own"}');
  writeFileSync(join(ownHome, "sessions", "thread.jsonl"), '{"thread":"own"}\n');
  const directEcho = echoFile(rig);
  const sharedEcho = echoFile(rig);
  const harness = harnessFor("codex", writeFakeAdapter(rig));
  const direct = { ...accountFor("codex", {}, directEcho, {}, "codex"), home: ownHome };
  const shared = { ...accountFor("codex", {}, sharedEcho, {}, "secondary"), home: ownHome };
  yield* withEngine(rig, { harness, accounts: [direct, shared] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    success(yield* call(ownerCredential, "start", startPayloadFor(harness, direct, rig.work)));
    const directChild = yield* readEcho(directEcho);
    expect(directChild.env.CODEX_HOME).toBe(ownHome);
    expect(directChild.env.HOME).toBe(rig.home);
    success(yield* call(ownerCredential, "start", startPayloadFor(harness, shared, rig.work)));
    const sharedChild = yield* readEcho(sharedEcho);
    const shadow = sharedChild.env.CODEX_HOME;
    expect(shadow).toBeDefined();
    if (shadow === undefined) return;
    expect(shadow).not.toBe(ownHome);
    expect(relative(rig.stateFolder, shadow)).not.toMatch(/^\.\.(?:\/|$)/);
    expect(resolve(shadow, readlinkSync(join(shadow, "sessions")))).toBe(join(ownHome, "sessions"));
    expect(existsSync(join(shadow, "auth.json")), "the home's own login must not be linked or copied").toBe(false);
  }));
}).pipe(Effect.orDie));

it.effect("6b A4: catches a symlink ancestor moving the shadow home outside the state folder, spawning a child, or writing shared links outside", () => Effect.gen(function* () {
  const outside = join(rig.root, "outside-state");
  const shadow = join(outside, "shadow");
  mkdirSync(shadow, { recursive: true });
  writeFileSync(join(shadow, "keep.txt"), "Outside data must stay untouched.\n");
  const before = readdirSync(outside, { recursive: true }).sort();
  const provider = join(rig.stateFolder, "providers", "codex");
  mkdirSync(provider, { recursive: true });
  symlinkSync(outside, join(provider, "secondary"), "dir");
  const shared = join(rig.home, ".codex");
  mkdirSync(shared);
  writeFileSync(join(shared, "config.toml"), 'model = "fixture-model"\n');

  const echo = echoFile(rig);
  const harness = harnessFor("codex", writeFakeAdapter(rig));
  const account = accountFor("codex", { turns: [] }, echo, {}, "secondary");
  yield* withEngine(rig, { harness, accounts: [account] }, (context) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const reply = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work)));
    expect.soft((yield* snapshot).agents[reply.agentId]?.state._tag).toBe("stopped");
    expect.soft(existsSync(echo), "the escaped home must be refused before spawning the adapter").toBe(false);
    expect.soft(readdirSync(outside, { recursive: true }).sort(), "refusal must leave the outside tree untouched").toEqual(before);
    expect(readFileSync(join(shadow, "keep.txt"), "utf8")).toBe("Outside data must stay untouched.\n");
    const failures = (yield* readLog).filter((row) => row.event._tag === "AgentStartFailed");
    expect(failures.map((row) => row.event)).toEqual([{ _tag: "AgentStartFailed", agentId: reply.agentId, reason: "could-not-start" }]);
    expect(JSON.stringify([failures, context.logLines])).not.toContain(outside);
  }));
}).pipe(Effect.orDie));

it.effect("6.5 E2: catches inherited provider credentials, unresolved references, missing tilde expansion, or secrets in events, views, replies and service logs", () => Effect.gen(function* () {
  const planted = "account-key-planted-6b-5f38d214";
  const echo = echoFile(rig);
  const harness = harnessFor("claude", writeFakeAdapter(rig));
  const account = accountFor("claude", {}, echo, {
    REGION: "account-region", LANG: "account-locale", CLAUDE_CONFIG_DIR: "~/separate-config",
    HERDR_SOCKET_PATH: join(rig.root, "must-not-reach-child.sock"), HERDR_ENV: "1",
    LGCODE_SOCKET: join(rig.root, "wrong-engine.sock"), LGCODE_TOKEN: "secret:ignored",
    LGCODE_TEST_DEBUG: "1",
  });
  const store = persistentSecretStore({ stateFolder: rig.stateFolder });
  const parent = serviceEnvironment(rig);
  yield* withEngine(rig, {
    harness, accounts: [account], environment: parent, secretStore: store,
    // Seed only the independent redaction registry. The account's value is
    // written by the real owner command into the persistent store below.
    secrets: { "secret:registry-fixture": planted },
  }, (context) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const stored = success(yield* call(ownerCredential, "accounts set-secret", {
      accountId: account.id, name: "ANTHROPIC_API_KEY", nonce: "store-fixture-once", value: Redacted.make(planted),
    }));
    const changed = (yield* snapshot).accounts[account.id]!;
    expect(changed.environment?.ANTHROPIC_API_KEY).toMatch(/^secret:/);
    expect(readFileSync(join(rig.stateFolder, "secrets.json"), "utf8")).toContain(planted);
    expect(statSync(join(rig.stateFolder, "secrets.json")).mode & 0o777).toBe(0o600);
    const started = success(yield* call(ownerCredential, "start", startPayloadFor(harness, changed, rig.work)));
    const child = yield* readEcho(echo);
    expect(child.env).toMatchObject({
      PATH: "/usr/bin:/bin", HOME: rig.home, USER: "lgcode-test", LOGNAME: "lgcode-test", SHELL: "/bin/sh",
      LANG: "account-locale", LC_ALL: "C.UTF-8", LC_CTYPE: "C.UTF-8", TERM: "dumb", TMPDIR: rig.root, TZ: "UTC",
      REGION: "account-region", CLAUDE_CONFIG_DIR: join(rig.home, "separate-config"),
      ANTHROPIC_API_KEY: planted, LGCODE_SOCKET: rig.socket,
    });
    expect(child.env.LGCODE_TOKEN).toMatch(/^shp_a_/);
    expect(child.env.LGCODE_TOKEN).not.toBe(parent.LGCODE_TOKEN);
    expect(Object.keys(child.env).filter((key) => key.startsWith("LGCODE_")).sort()).toEqual(["LGCODE_SOCKET", "LGCODE_TOKEN"]);
    expect(Object.keys(child.env).filter((key) => key.startsWith("HERDR_"))).toEqual([]);
    for (const name of ["OPENAI_API_KEY", "NODE_OPTIONS", "XDG_STATE_HOME"]) expect(child.env[name]).toBeUndefined();
    expect(JSON.stringify(child.env)).not.toContain("secret:");
    const publicData = JSON.stringify([yield* readLog, yield* snapshot, stored, started, context.logLines]);
    for (const secret of [planted, Buffer.from(planted).toString("base64"), child.env.LGCODE_TOKEN!]) expect(publicData).not.toContain(secret);
    // A fresh store layer reads the committed value from disk, rather than
    // borrowing the first layer's map or the redaction fixture.
    const reference = changed.environment!.ANTHROPIC_API_KEY!;
    const reread = yield* Effect.gen(function* () {
      return yield* (yield* SecretStore).resolve(reference);
    }).pipe(Effect.provide(persistentSecretStore({ stateFolder: rig.stateFolder })));
    expect(reread === undefined ? undefined : Redacted.value(reread)).toBe(planted);
  }));
}).pipe(Effect.orDie));

it.effect("6.5 E3: catches a missing secret reference leaking diagnostics or allowing a child to spawn", () => Effect.gen(function* () {
  const echo = echoFile(rig);
  const harness = harnessFor("cursor", writeFakeAdapter(rig));
  const account = accountFor("cursor", {}, echo, { CURSOR_API_KEY: "secret:missing" });
  yield* withEngine(rig, { harness, accounts: [account], secretStore: persistentSecretStore({ stateFolder: rig.stateFolder }) }, (context) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const outcome = yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work));
    // Existing start semantics report the reserved id, then log a fixed
    // AgentStartFailed if the runner cannot resolve the account credential.
    const reply = success(outcome);
    expect((yield* snapshot).agents[reply.agentId]?.state._tag).toBe("stopped");
    expect(existsSync(echo)).toBe(false);
    const failures = (yield* readLog).filter((row) => row.event._tag === "AgentStartFailed");
    expect(failures.map((row) => row.event)).toEqual([{ _tag: "AgentStartFailed", agentId: reply.agentId, reason: "could-not-start" }]);
    expect(JSON.stringify([failures, context.logLines])).not.toContain("secret:missing");
  }));
}).pipe(Effect.orDie));
