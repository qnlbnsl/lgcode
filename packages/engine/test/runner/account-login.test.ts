import { join } from "node:path";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";

import type { RunnerEvent } from "../../src/runner/Runner.ts";
import {
  accountFor, allowListed, deliveryFor, echoFile, harnessFor, makeRunnerRig, peekEcho, readEcho, removeRunnerRig, serviceEnvironment,
  spawnFor, withAcpRunner, writeFakeAdapter, type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

// Fix round 1, A9 (owner choices, 2026-11-03): an account's `home` reaches the
// harness through that harness's own login variable, an account's `secret`
// reaches it through that harness's key variable, and a `home` that disagrees
// with an explicit login variable is refused. The child is the fake agent,
// which writes the environment it was started with to its echo file.

let rig: RunnerRig;
beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("LGTM_HOME", rig.stateFolder);
});
afterEach(() => {
  vi.unstubAllEnvs();
  removeRunnerRig(rig);
});

registerRebuildCheck({ noLog: true });

const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => test() as Effect.Effect<unknown, unknown, never>, 60_000);

const plantedKey = "sk-ant-api03-PLANTEDLOGINSECRET0123456789abcdef";

live("A9 claude home: an account with `home` and no environment gets CLAUDE_CONFIG_DIR set to that home while HOME stays the service's (catches a runner that reads only the account's environment, so two Claude accounts share the default login, or one that moves HOME and hides the keychain login)", () =>
  withAcpRunner(rig, {}, ({ runner }) => Effect.gen(function* () {
    const echo = echoFile(rig);
    const home = join(rig.root, "claude-second");
    const account = { ...accountFor("claude", { turns: [] }, echo), home };
    const spawn = yield* spawnFor(rig, harnessFor("claude", writeFakeAdapter(rig)), account);
    yield* runner.start(spawn.input);
    const seen = yield* readEcho(echo);
    expect(seen.env.CLAUDE_CONFIG_DIR).toBe(home);
    expect(seen.env.HOME).toBe(serviceEnvironment(rig).HOME);
  })));

live("A9 claude home: an account with no `home` gets no CLAUDE_CONFIG_DIR, so the default login stays (catches a runner that always sets the variable)", () =>
  withAcpRunner(rig, {}, ({ runner }) => Effect.gen(function* () {
    const echo = echoFile(rig);
    const spawn = yield* spawnFor(rig, harnessFor("claude", writeFakeAdapter(rig)), accountFor("claude", { turns: [] }, echo));
    yield* runner.start(spawn.input);
    expect((yield* readEcho(echo)).env.CLAUDE_CONFIG_DIR).toBeUndefined();
  })));

live("A9 conflict: a `home` and a different explicit CLAUDE_CONFIG_DIR refuse the start and spawn nothing, while the same path spelled the same way is accepted (catches a runner that lets one value silently win)", () =>
  withAcpRunner(rig, {}, ({ runner }) => Effect.gen(function* () {
    const adapter = writeFakeAdapter(rig);
    const home = join(rig.root, "claude-second");
    const clash = echoFile(rig);
    const refused = yield* runner.start((yield* spawnFor(rig, harnessFor("claude", adapter), {
      ...accountFor("claude", { turns: [] }, clash, { CLAUDE_CONFIG_DIR: join(rig.root, "claude-other") }), home,
    })).input).pipe(Effect.result);
    expect(refused._tag).toBe("Failure");
    if (refused._tag === "Failure") {
      expect(refused.failure._tag).toBe("RunnerRejected");
      expect(refused.failure.reason).toContain("CLAUDE_CONFIG_DIR");
    }
    expect(peekEcho(clash), "the adapter was spawned although the settings disagree").toBeUndefined();
    const agreeing = echoFile(rig);
    yield* runner.start((yield* spawnFor(rig, harnessFor("claude", adapter), {
      ...accountFor("claude", { turns: [] }, agreeing, { CLAUDE_CONFIG_DIR: home }), home,
    })).input);
    expect((yield* readEcho(agreeing)).env.CLAUDE_CONFIG_DIR).toBe(home);
  })));

live("A9 codex conflict: a `home` and a different explicit CODEX_HOME refuse the start and spawn nothing (catches a runner that passes only one of them to the layout)", () =>
  withAcpRunner(rig, {}, ({ runner }) => Effect.gen(function* () {
    const echo = echoFile(rig);
    const refused = yield* runner.start((yield* spawnFor(rig, harnessFor("codex", writeFakeAdapter(rig)), {
      ...accountFor("codex", { turns: [] }, echo, { CODEX_HOME: join(rig.root, "codex-other") }, "codex"), home: join(rig.root, "codex-second"),
    })).input).pipe(Effect.result);
    expect(refused._tag).toBe("Failure");
    if (refused._tag === "Failure") expect(refused.failure.reason).toContain("CODEX_HOME");
    expect(peekEcho(echo)).toBeUndefined();
  })));

live("A9 secret: an account `secret` reaches the child only as the harness's key variable, replaces the inherited key, and is registered with the redactor, so text carrying it is redacted in the runner's events (catches a secret that is never resolved, one that leaks in through the inherited environment, or one the redactor does not know)", () =>
  withAcpRunner(rig, { secrets: { "secret:login-key": plantedKey } }, ({ runner, events, waitFor, eventsAfter }) => Effect.gen(function* () {
    const echo = echoFile(rig);
    const account = {
      ...accountFor("claude", { turns: [[{ step: "text", text: "the key is ${env:ANTHROPIC_API_KEY}" }]] }, echo),
      secret: "secret:login-key" as const,
    };
    const spawn = yield* spawnFor(rig, harnessFor("claude", writeFakeAdapter(rig)), account);
    yield* runner.start(spawn.input);
    const seen = yield* readEcho(echo);
    // Exactly the allow-list, the account's variables, the key and the runner's own two.
    const service = serviceEnvironment(rig);
    const expected: Record<string, string> = {};
    for (const name of allowListed) expected[name] = service[name]!;
    Object.assign(expected, {
      FAKE_AGENT_SCRIPT: account.environment!.FAKE_AGENT_SCRIPT, FAKE_AGENT_ECHO: echo,
      ANTHROPIC_API_KEY: plantedKey, LGTM_SOCKET: rig.socket, LGTM_TOKEN: spawn.token,
    });
    expect(seen.env).toEqual(expected);
    expect(seen.env.ANTHROPIC_API_KEY).not.toBe(service.ANTHROPIC_API_KEY);
    expect(seen.env.OPENAI_API_KEY).toBeUndefined();
    const delivery = deliveryFor(spawn.input.agentId, "go");
    const before = events.length;
    yield* runner.prompt({ sentSequence: 1, agentId: spawn.input.agentId, incarnation: spawn.incarnation, delivery });
    yield* waitFor((event: RunnerEvent) => event._tag === "turnEnded" && event.deliveryId === delivery.id, before);
    const text = eventsAfter(before).flatMap((event) => event._tag === "deliveryUpdate" && event.kind === "message" ? [event.text] : []).join("");
    expect(text).toContain("the key is");
    expect(text.includes(plantedKey), "the runner's events carry the account secret").toBe(false);
  })));

live("A9 secret: a `secret` that cannot be resolved refuses the start and spawns nothing (catches a runner that starts the agent with no key)", () =>
  withAcpRunner(rig, {}, ({ runner }) => Effect.gen(function* () {
    const echo = echoFile(rig);
    const account = { ...accountFor("claude", { turns: [] }, echo), secret: "secret:missing" as const };
    const refused = yield* runner.start((yield* spawnFor(rig, harnessFor("claude", writeFakeAdapter(rig)), account)).input).pipe(Effect.result);
    expect(refused._tag).toBe("Failure");
    if (refused._tag === "Failure") expect(refused.failure.reason).toBe("account secret is unavailable");
    expect(peekEcho(echo)).toBeUndefined();
  })));

live("A9 secret: an explicit environment variable with the key's name is not replaced by the account `secret` (catches a runner that lets the secret field override the more specific setting)", () =>
  withAcpRunner(rig, { secrets: { "secret:login-key": plantedKey, "secret:env-key": "explicit-environment-key-0123456789" } }, ({ runner }) => Effect.gen(function* () {
    const echo = echoFile(rig);
    const account = { ...accountFor("claude", { turns: [] }, echo, { ANTHROPIC_API_KEY: "secret:env-key" }), secret: "secret:login-key" as const };
    yield* runner.start((yield* spawnFor(rig, harnessFor("claude", writeFakeAdapter(rig)), account)).input);
    expect((yield* readEcho(echo)).env.ANTHROPIC_API_KEY).toBe("explicit-environment-key-0123456789");
  })));

// Fix round 2, F-1: a field the harness has no variable for is refused, never
// dropped, so the agent cannot run on another login than the account names.
const refusedStart = (harnessId: string, account: ReturnType<typeof accountFor>, secrets: Record<string, string> = {}) =>
  withAcpRunner(rig, { secrets }, ({ runner }) => Effect.gen(function* () {
    const result = yield* runner.start((yield* spawnFor(rig, harnessFor(harnessId, writeFakeAdapter(rig)), account)).input).pipe(Effect.result);
    return result._tag === "Failure" ? { tag: result.failure._tag, reason: result.failure.reason } : undefined;
  }));

live("A9 F-1 unmapped home: an account `home` on a harness with no home variable (the test harness, gemini, cursor, a custom id that runs a Claude adapter) refuses the start with a fixed reason naming the field and the harness, and spawns nothing (catches a runner that drops the field and runs on another login)", () =>
  Effect.gen(function* () {
    for (const id of ["first", "gemini", "cursor", "custom-claude"]) {
      const echo = echoFile(rig);
      const outcome = yield* refusedStart(id, { ...accountFor(id, { turns: [] }, echo), home: join(rig.root, "somewhere") });
      expect(outcome, `${id} was started with an account home it cannot apply`).toEqual({ tag: "RunnerRejected", reason: `account home is not supported by harness ${id}` });
      expect(peekEcho(echo), `${id} was spawned`).toBeUndefined();
    }
  }));

live("A9 F-1 unmapped secret: an account `secret` on a harness with no key variable refuses the start with a fixed reason that holds no secret, and spawns nothing, while gemini and cursor map theirs (catches a runner that drops the secret)", () =>
  Effect.gen(function* () {
    for (const id of ["first", "custom-claude"]) {
      const echo = echoFile(rig);
      const outcome = yield* refusedStart(id, { ...accountFor(id, { turns: [] }, echo), secret: "secret:login-key" as const }, { "secret:login-key": plantedKey });
      expect(outcome).toEqual({ tag: "RunnerRejected", reason: `account secret is not supported by harness ${id}` });
      expect(JSON.stringify(outcome).includes(plantedKey)).toBe(false);
      expect(peekEcho(echo), `${id} was spawned`).toBeUndefined();
    }
    for (const [id, variable] of [["gemini", "GEMINI_API_KEY"], ["cursor", "CURSOR_API_KEY"]] as const) {
      const echo = echoFile(rig);
      const started = yield* refusedStart(id, { ...accountFor(id, { turns: [] }, echo), secret: "secret:login-key" as const }, { "secret:login-key": plantedKey });
      expect(started).toBeUndefined();
      expect((yield* readEcho(echo)).env[variable]).toBe(plantedKey);
    }
  }));

// Fix round 2, F-3: the conflict check compares the values the child would
// get, so a reference to the same folder is no conflict and a reference to
// another folder is one.
live("A9 F-3 spawn: a CLAUDE_CONFIG_DIR given as a secret reference is compared by the folder it resolves to, so the same folder starts, another folder and an unresolvable reference are refused with the fixed text and no resolved value (catches a comparison of the unresolved reference)", () =>
  Effect.gen(function* () {
    const home = join(rig.root, "claude-second");
    const other = join(rig.root, "claude-planted-other-folder");
    const secrets = { "secret:same-home": home, "secret:other-home": other };
    const same = echoFile(rig);
    expect(yield* refusedStart("claude", { ...accountFor("claude", { turns: [] }, same, { CLAUDE_CONFIG_DIR: "secret:same-home" }), home }, secrets)).toBeUndefined();
    expect((yield* readEcho(same)).env.CLAUDE_CONFIG_DIR).toBe(home);
    // An unresolvable reference is refused earlier, as an unavailable secret.
    for (const [reference, reason] of [["secret:other-home", "account home differs from CLAUDE_CONFIG_DIR"], ["secret:nowhere", "account secret is unavailable"]] as const) {
      const echo = echoFile(rig);
      const outcome = yield* refusedStart("claude", { ...accountFor("claude", { turns: [] }, echo, { CLAUDE_CONFIG_DIR: reference }), home }, secrets);
      expect(outcome, reference).toEqual({ tag: "RunnerRejected", reason });
      expect(JSON.stringify(outcome).includes(other)).toBe(false);
      expect(peekEcho(echo)).toBeUndefined();
    }
  }));
