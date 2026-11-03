import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { makeFakeRunner } from "../support/fakeRunner.ts";
import {
  call, failureOf, makeFakeSecrets, makeRig, ownerCredential, provideRig, readLog, removeRig, success, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

// Fix round 1, A9 (owner choices, 2026-11-03): an account whose `home` and
// explicit login variable name different folders is refused when it is set,
// with a reason that names the variable, and nothing is stored.

let rig: Rig;
beforeEach(() => {
  rig = makeRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPHRD_HOME", rig.stateFolder);
});
afterEach(() => {
  vi.unstubAllEnvs();
  removeRig(rig);
});

const account = (id: string, harness: string, extra: Record<string, unknown>) => ({ id, harness, displayName: "Login", enabled: true, ...extra });
const accountEvents = readLog.pipe(Effect.map((rows) => rows.filter((row) => row.event._tag === "AccountChanged")));

it.effect("A9 conflict: catches an account whose `home` and explicit CLAUDE_CONFIG_DIR or CODEX_HOME name different folders being stored (add and set), or a refusal that does not name the variable", () =>
  Effect.gen(function* () {
    const fakes = { runner: yield* makeFakeRunner(), secrets: makeFakeSecrets() };
    yield* provideRig(rig, fakes, Effect.gen(function* () {
      yield* registerRebuildCheck();
      for (const [harness, variable] of [["claude", "CLAUDE_CONFIG_DIR"], ["codex", "CODEX_HOME"]] as const) {
        const clash = account(`${harness}-clash`, harness, { home: "/srv/login-a", environment: { [variable]: "/srv/login-b" } });
        const added = failureOf(yield* call(ownerCredential, "accounts", { operation: "add", account: clash }));
        expect(added?.reason).toContain(variable);
        // The same folder is accepted, with a trailing slash too.
        success(yield* call(ownerCredential, "accounts", { operation: "add", account: account(`${harness}-same`, harness, { home: "/srv/login-a", environment: { [variable]: "/srv/login-a/" } }) }));
        success(yield* call(ownerCredential, "accounts", { operation: "add", account: account(`${harness}-plain`, harness, { home: "/srv/login-a" }) }));
        const set = failureOf(yield* call(ownerCredential, "accounts", { operation: "set", account: { ...clash, id: `${harness}-plain` } }));
        expect(set?.reason).toContain(variable);
      }
      const stored = (yield* accountEvents).map((row) => (row.event as { accountId: string }).accountId);
      expect(stored).toEqual(["claude-same", "claude-plain", "codex-same", "codex-plain"]);
    }));
  }).pipe(Effect.orDie));

it.effect("A9 conflict: catches a harness with no login variables being refused for setting both, or a relative explicit path counting as the same folder", () =>
  Effect.gen(function* () {
    const fakes = { runner: yield* makeFakeRunner(), secrets: makeFakeSecrets() };
    yield* provideRig(rig, fakes, Effect.gen(function* () {
      yield* registerRebuildCheck();
      success(yield* call(ownerCredential, "accounts", { operation: "add", account: account("other", "first", { home: "/srv/login-a", environment: { CLAUDE_CONFIG_DIR: "/srv/login-b" } }) }));
      const relative = failureOf(yield* call(ownerCredential, "accounts", { operation: "add", account: account("relative", "claude", { home: "/srv/login-a", environment: { CLAUDE_CONFIG_DIR: "login-a" } }) }));
      expect(relative?.reason).toContain("CLAUDE_CONFIG_DIR");
    }));
  }).pipe(Effect.orDie));

it.effect("A9 conflict: catches set-secret naming the login variable of an account that has a home, which would store a secret reference as the folder", () =>
  Effect.gen(function* () {
    const fakes = { runner: yield* makeFakeRunner(), secrets: makeFakeSecrets() };
    yield* provideRig(rig, fakes, Effect.gen(function* () {
      yield* registerRebuildCheck();
      success(yield* call(ownerCredential, "accounts", { operation: "add", account: account("homed", "claude", { home: "/srv/login-a" }) }));
      const before = (yield* accountEvents).length;
      const outcome = failureOf(yield* call(ownerCredential, "accounts set-secret", { accountId: "homed", name: "CLAUDE_CONFIG_DIR", nonce: "nonce-1", value: Redacted.make("sk-live-planted-0123456789abcdef") }));
      expect(outcome?.reason).toContain("CLAUDE_CONFIG_DIR");
      expect((yield* accountEvents).length).toBe(before);
    }));
  }).pipe(Effect.orDie));
