import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { randomBytes } from "node:crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import { expect, it } from "vitest";
import { SecretStore } from "../../src/commands/SecretStore.ts";
import { rulesFixture, requiredModule, type Rules } from "../support/callerRules.ts";
import { withPersistentRules } from "../support/persistentRules.ts";
import { call, seedAccount, success } from "../support/handlerRig.ts";
import { snapshot } from "../support/routingRig.ts";

type Store = SecretStore["Service"] & { readonly removeCarrierValue?: (generation: string) => Effect.Effect<void, unknown> };
type Collector = { readonly collectSecrets: (view: unknown, lists: Rules) => Effect.Effect<void, unknown, SecretStore> };
const reference = (generation: string) => `secret:client.alerts.carrier.${generation}`;

it("1.39 narrow removal catches deleting an account's in-flight secret while clear and rotation happen", async () => {
  const lists = await rulesFixture();
  const entered = Deferred.makeUnsafe<void>();
  const release = Deferred.makeUnsafe<void>();
  const accountValue = randomBytes(24).toString("hex");
  const oldValue = randomBytes(24).toString("hex");
  const nextValue = randomBytes(24).toString("hex");
  await withPersistentRules(lists, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
    const store = (yield* SecretStore) as Store;
    expect(store.removeCarrierValue, "E27 must remove one generation, never run collection at runtime").toBeTypeOf("function");
    yield* seedAccount();
    yield* store.put(reference("old"), Redacted.make(oldValue));
    const setting = yield* call({ _tag: "owner" }, "accounts set-secret", { accountId: "primary", name: "API_KEY", nonce: "account-write", value: Redacted.make(accountValue) }).pipe(Effect.forkChild);
    yield* Deferred.await(entered);
    try {
      yield* store.removeCarrierValue!("old");
      yield* store.put(reference("new"), Redacted.make(nextValue));
      yield* store.removeCarrierValue!("old");
    } finally { yield* Deferred.succeed(release, undefined); }
    success(yield* Fiber.join(setting));
    const accountReference = (yield* snapshot).accounts.primary?.environment?.API_KEY;
    expect(accountReference).toBeTypeOf("string");
    expect(Redacted.value((yield* store.resolve(accountReference!))!) === accountValue).toBe(true);
    expect(yield* store.resolve(reference("old"))).toBeUndefined();
    expect(Redacted.value((yield* store.resolve(reference("new")))!) === nextValue).toBe(true);
    // Even a malicious generation argument can name only the carrier slot.
    yield* store.removeCarrierValue!(accountReference!);
    expect((yield* store.resolve(accountReference!)) !== undefined).toBe(true);
  }), (real) => ({ ...real, put: (name, value) => real.put(name, value).pipe(Effect.andThen(name.startsWith("secret:client.") ? Effect.void : Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))))) }));
});

for (const throwing of [false, true]) {
  it(`1.39/1.44 startup collection throwing=${throwing}: catches deleting an active piece token or collecting despite a broken keep list`, async () => {
    const { collectSecrets } = await requiredModule<Collector>("accounts/collectSecrets.ts");
    const lists = await rulesFixture();
    lists.secretKeep.client = () => { if (throwing) throw new Error("Untrusted keep-list error."); return [reference("active")]; };
    const value = randomBytes(24).toString("hex");
    await withPersistentRules(lists, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const store = yield* SecretStore;
      for (const name of [reference("active"), reference("abandoned"), "secret:account", "secret:replaced"]) yield* store.put(name, Redacted.make(value));
      yield* seedAccount();
      yield* call({ _tag: "owner" }, "accounts", { operation: "set", account: { id: "primary", harness: "first", displayName: "Primary", enabled: true, environment: { API_KEY: "secret:account" } } });
      yield* collectSecrets(yield* snapshot, lists);
      expect((yield* store.resolve(reference("active"))) !== undefined).toBe(true);
      expect((yield* store.resolve("secret:account")) !== undefined).toBe(true);
      expect((yield* store.resolve(reference("abandoned"))) !== undefined).toBe(throwing);
      expect((yield* store.resolve("secret:replaced")) !== undefined).toBe(throwing);
      success(yield* call({ _tag: "owner" }, "accounts", { operation: "remove", accountId: "primary" }));
      yield* collectSecrets(yield* snapshot, lists);
      expect((yield* store.resolve(reference("active"))) !== undefined).toBe(true);
    }));
  });
}

it("1.39 catches an account reserving a carrier token in its environment", async () => {
  await withPersistentRules(await rulesFixture(), () => Effect.gen(function* () {
      yield* registerRebuildCheck();
    const result = yield* call({ _tag: "owner" }, "accounts", { operation: "add", account: {
      id: "forbidden", harness: "first", displayName: "Forbidden", enabled: true, environment: { CARRIER: reference("active") },
    } });
    expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "CommandRefused" } });
    expect((yield* snapshot).accounts.forbidden).toBeUndefined();
  }));
});
