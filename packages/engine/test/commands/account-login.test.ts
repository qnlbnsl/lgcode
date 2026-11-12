import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { SecretStore } from "../../src/commands/SecretStore.ts";
import { makeFakeRunner } from "../support/fakeRunner.ts";
import {
  appendSetup, call, eventOf, failureOf, makeFakeSecrets, makeRig, ownerCredential, provideRig, readLog, removeRig, success, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

// Fix round 1, A9 (owner choices, 2026-11-03): an account whose `home` and
// explicit login variable name different folders is refused when it is set,
// with a reason that names the variable, and nothing is stored.

let rig: Rig;
beforeEach(() => {
  rig = makeRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("LGTM_HOME", rig.stateFolder);
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

it.effect("A9 conflict: catches an account with no home being refused for naming a login variable, or a relative explicit path counting as the same folder", () =>
  Effect.gen(function* () {
    const fakes = { runner: yield* makeFakeRunner(), secrets: makeFakeSecrets() };
    yield* provideRig(rig, fakes, Effect.gen(function* () {
      yield* registerRebuildCheck();
      // No home, so the explicit variable is the only login and nothing can clash.
      success(yield* call(ownerCredential, "accounts", { operation: "add", account: account("other", "first", { environment: { CLAUDE_CONFIG_DIR: "/srv/login-b" } }) }));
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

// Fix round 2, F-1: an account whose `home` or `secret` the harness has no
// variable for is refused at add, set and set-secret, with a fixed reason that
// names the field and the harness.
it.effect("A9 F-1 unmapped fields: catches an account `home` on a harness with no home variable, or a `secret` on one with no key variable, being stored by add or set (the test harness, a custom id that runs a Claude adapter, gemini and cursor for home)", () =>
  Effect.gen(function* () {
    const fakes = { runner: yield* makeFakeRunner(), secrets: makeFakeSecrets() };
    yield* provideRig(rig, fakes, Effect.gen(function* () {
      yield* registerRebuildCheck();
      for (const id of ["first", "custom-claude", "gemini", "cursor"]) {
        const added = failureOf(yield* call(ownerCredential, "accounts", { operation: "add", account: account(`${id}-home`, id, { home: "/srv/login-a" }) }));
        expect(added?.reason, id).toBe(`account home is not supported by harness ${id}`);
      }
      for (const id of ["first", "custom-claude"]) {
        const added = failureOf(yield* call(ownerCredential, "accounts", { operation: "add", account: account(`${id}-key`, id, { secret: "secret:some-key" }) }));
        expect(added?.reason, id).toBe(`account secret is not supported by harness ${id}`);
      }
      // Mapped fields are accepted.
      for (const [id, extra] of [["gemini", { secret: "secret:some-key" }], ["cursor", { secret: "secret:some-key" }], ["claude", { home: "/srv/login-a", secret: "secret:some-key" }], ["codex", { home: "/srv/login-a", secret: "secret:some-key" }]] as const) {
        success(yield* call(ownerCredential, "accounts", { operation: "add", account: account(`${id}-ok`, id, extra) }));
      }
      success(yield* call(ownerCredential, "accounts", { operation: "add", account: account("first-plain", "first", {}) }));
      const set = failureOf(yield* call(ownerCredential, "accounts", { operation: "set", account: account("first-plain", "first", { home: "/srv/login-a" }) }));
      expect(set?.reason).toBe("account home is not supported by harness first");
      const stored = (yield* accountEvents).map((row) => (row.event as { accountId: string }).accountId);
      expect(stored).toEqual(["gemini-ok", "cursor-ok", "claude-ok", "codex-ok", "first-plain"]);
    }));
  }).pipe(Effect.orDie));

it.effect("A9 F-1 unmapped fields: catches set-secret on an account that already holds a field its harness cannot apply, so the stored account keeps a login it never uses", () =>
  Effect.gen(function* () {
    const fakes = { runner: yield* makeFakeRunner(), secrets: makeFakeSecrets() };
    yield* provideRig(rig, fakes, Effect.gen(function* () {
      yield* registerRebuildCheck();
      // Written before this rule, so only the log can hold it.
      yield* appendSetup([eventOf({ _tag: "AccountChanged", accountId: "legacy", account: { id: "legacy", harness: "first", home: "/srv/login-a", enabled: true } })]);
      const before = (yield* accountEvents).length;
      const outcome = failureOf(yield* call(ownerCredential, "accounts set-secret", { accountId: "legacy", name: "REGION", nonce: "nonce-1", value: Redacted.make("not-a-secret-0123456789") }));
      expect(outcome?.reason).toBe("account home is not supported by harness first");
      expect((yield* accountEvents).length).toBe(before);
    }));
  }).pipe(Effect.orDie));

// Fix round 2, F-3: the folders are compared by value, through the secret
// store when a reference holds one.
it.effect("A9 F-3 effective values: catches a comparison of the unresolved reference, so equal folders are refused, or a different folder behind a reference, an unresolvable reference, or a different set-secret value being accepted (and any resolved value reaching the reply or the log)", () =>
  Effect.gen(function* () {
    const fakes = { runner: yield* makeFakeRunner(), secrets: makeFakeSecrets() };
    const planted = "/srv/login-planted-other-0123456789";
    // `stored` is read-only, so the references are seeded through the fake's own store.
    yield* Effect.gen(function* () {
      const store = yield* SecretStore;
      yield* store.put("secret:same-home", Redacted.make("/srv/login-a"));
      yield* store.put("secret:other-home", Redacted.make(planted));
    }).pipe(Effect.provide(fakes.secrets.layer));
    yield* provideRig(rig, fakes, Effect.gen(function* () {
      yield* registerRebuildCheck();
      for (const [harness, variable] of [["claude", "CLAUDE_CONFIG_DIR"], ["codex", "CODEX_HOME"]] as const) {
        const outcomes = [];
        success(yield* call(ownerCredential, "accounts", { operation: "add", account: account(`${harness}-ref-same`, harness, { home: "/srv/login-a", environment: { [variable]: "secret:same-home" } }) }));
        for (const [name, reference] of [["other", "secret:other-home"], ["missing", "secret:nowhere"]] as const) {
          const outcome = yield* call(ownerCredential, "accounts", { operation: "add", account: account(`${harness}-ref-${name}`, harness, { home: "/srv/login-a", environment: { [variable]: reference } }) });
          expect(failureOf(outcome)?.reason, `${harness} ${name}`).toBe(`account home differs from ${variable}`);
          outcomes.push(outcome);
        }
        // set-secret compares the supplied value, which the contract makes at least 16 characters long.
        const long = "/srv/login-account-long";
        success(yield* call(ownerCredential, "accounts", { operation: "add", account: account(`${harness}-set`, harness, { home: long }) }));
        success(yield* call(ownerCredential, "accounts set-secret", { accountId: `${harness}-set`, name: variable, nonce: `nonce-same-${harness}`, value: Redacted.make(long) }));
        const different = yield* call(ownerCredential, "accounts set-secret", { accountId: `${harness}-set`, name: variable, nonce: `nonce-other-${harness}`, value: Redacted.make(planted) });
        expect(failureOf(different)?.reason).toBe(`account home differs from ${variable}`);
        outcomes.push(different);
        for (const outcome of outcomes) expect(JSON.stringify(outcome).includes(planted)).toBe(false);
      }
      expect(JSON.stringify(yield* readLog).includes(planted)).toBe(false);
    }));
  }).pipe(Effect.orDie));
