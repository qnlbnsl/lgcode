import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it } from "vitest";
import { carrierTokenReference } from "@sheprd/contracts";
import { SecretStore } from "../../src/commands/SecretStore.ts";
import { collectSecrets } from "../../src/accounts/collectSecrets.ts";
import { engineLists } from "../../src/pieces/lists.ts";
import { makeRedactor } from "../../src/identity/redactor.ts";
import { Redactor } from "../../src/log/Redactor.ts";
import { eventsOf } from "../support/alertsRig.ts";
import { agentCredential, call, eventOf, makeRig, ownerCredential, removeRig, seedAgent, success } from "../support/handlerRig.ts";
import { configure, delivered, failed, ntfyServer, posts, raiseQuestion, setToken, storedValues, withCarrier } from "../support/carrierRig.ts";
import { eventually, snapshot } from "../support/routingRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

it("6.13 only the selected carrier slot resolves, even when its literal token looks like an account reference", async () => {
  const server = await ntfyServer(); const accountValue = randomUUID(); const accountReference = "secret:account-key-6b";
  const resolutions: string[] = [];
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* (yield* SecretStore).put(accountReference, Redacted.make(accountValue));
      yield* configure(server.origin); yield* setToken(server.origin, accountReference);
      const selected = (yield* eventsOf("client.AlertCarrierTokenSet"))[0]!.event.carrierGeneration;
      const id = yield* raiseQuestion(); expect(yield* delivered(id)).toHaveLength(1);
      expect(resolutions).toEqual([carrierTokenReference(selected)]);
      expect(posts(server)[0]!.headers.authorization === `Bearer ${accountReference}`).toBe(true);
      expect(JSON.stringify(server.requests.map(({ headers, body }) => ({ headers, body }))).includes(accountValue), "account key escaped via a reference-shaped token").toBe(false);
    }), { decorateStore: (real) => ({ ...real, resolve: (reference) => { resolutions.push(reference); return real.resolve(reference); } }) });
  } finally { await server.close(); }
});

it("6.13 the client folder resolves secrets only inside the ntfy carrier", () => {
  registerRebuildCheck({ noLog: true });
  const root = "packages/engine/src/client";
  expect(existsSync(`${root}/alerts/carriers/ntfy.ts`), "6b must supply the only permitted secret-resolution path").toBe(true);
  const bad: string[] = [];
  const walk = (path: string) => { for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) { walk(file); continue; }
    if (!entry.name.endsWith(".ts")) continue;
    const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,
      (token) => token.startsWith("//") || token.startsWith("/*") ? " " : token);
    if (file !== `${root}/alerts/carriers/ntfy.ts` && (
      /\.\s*resolve\b|\[\s*["']resolve["']\s*\]/.test(source)
      || /\{[^}]*\bresolve\b[^}]*\}\s*=/.test(source)
    )) bad.push(file);
  } }; walk(root);
  expect(bad).toEqual([]);
});

it("6.14 rotation selects a fresh name and removes only the prior generation, while clear removes the active value", async () => {
  const first = randomUUID(); const next = randomUUID(); const account = randomUUID();
  await withCarrier((rig) => Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* configure("https://push.example");
    yield* (yield* SecretStore).put("secret:account-kept", Redacted.make(account));
    yield* setToken("https://push.example", first, "first");
    const old = (yield* eventsOf("client.AlertCarrierTokenSet"))[0]!.event.carrierGeneration;
    yield* setToken("https://push.example", next, "next");
    const current = (yield* eventsOf("client.AlertCarrierTokenSet"))[1]!.event.carrierGeneration;
    expect(current).not.toBe(old);
    expect(yield* eventually(Effect.sync(() => storedValues(rig)[carrierTokenReference(old)] === undefined), Boolean)).toBe(true);
    expect(storedValues(rig)[carrierTokenReference(current)] === next).toBe(true);
    expect(storedValues(rig)["secret:account-kept"] === account).toBe(true);
    success(yield* call(ownerCredential, "client.alerts.carrier.clear-token", {}));
    expect(yield* eventually(Effect.sync(() => storedValues(rig)[carrierTokenReference(current)] === undefined), Boolean)).toBe(true);
    expect(success(yield* call(ownerCredential, "client.alerts.settings", {})).tokenSet).toBe(false);
    expect(storedValues(rig)["secret:account-kept"] === account).toBe(true);
  }));
});

it.each(["origin", "none"])("6.14 %s carrier change clears the token atomically and never reuses it after restart", async (change) => {
  const rig = makeRig(); const token = randomUUID();
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure("https://push.example"); yield* setToken("https://push.example", token);
      success(yield* call(ownerCredential, "client.alerts.carrier.set", {
        requestId: "change-destination", carrier: change === "none" ? { _tag: "none" } : { _tag: "ntfy", server: "https://new.example", topic: "owner_alerts" },
      }));
      const changed = (yield* eventsOf("client.AlertCarrierChanged")).at(-1)!;
      const cleared = (yield* eventsOf("client.AlertCarrierTokenCleared")).at(-1)!;
      expect(changed.requestId).toBe("change-destination"); expect(cleared.requestId).toBe(changed.requestId);
      expect(Math.abs(changed.sequence - cleared.sequence)).toBe(1);
      expect(success(yield* call(ownerCredential, "client.alerts.settings", {})).tokenSet).toBe(false);
    }), { rig });
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* collectSecrets(yield* snapshot, engineLists);
      yield* configure("https://push.example");
      expect(success(yield* call(ownerCredential, "client.alerts.settings", {})).tokenSet).toBe(false);
      expect(Object.values(storedValues(rig)).includes(token)).toBe(false);
    }), { rig, initialize: false });
  } finally { removeRig(rig); }
});

it("6.14 no server and a mismatched intended origin refuse token writes without storing a value", async () => {
  const token = randomUUID();
  await withCarrier((rig) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const attempt = () => call(ownerCredential, "client.alerts.carrier.set-token", { origin: "https://other.example", nonce: "wrong-origin", value: Redacted.make(token) });
    expect(yield* attempt()).toMatchObject({ _tag: "Failure" });
    yield* configure("https://push.example");
    expect(yield* attempt()).toMatchObject({ _tag: "Failure" });
    expect(yield* eventsOf("client.AlertCarrierTokenSet")).toHaveLength(0);
    expect(Object.values(storedValues(rig)).includes(token)).toBe(false);
  }));
});

it.each(["client.alerts.carrier.set", "client.alerts.carrier.set-token", "client.alerts.carrier.clear-token"])(
  "6.14 %s is owner-only even when an agent knows a valid payload", async (command) => {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure("https://push.example");
      const worker = yield* seedAgent({ id: "worker", state: "working" });
      expect(yield* call(agentCredential(worker.token), command, {
        carrier: { _tag: "none" }, origin: "https://push.example", nonce: "agent-token", value: Redacted.make(randomUUID()),
      })).toMatchObject({ _tag: "Failure", failure: { _tag: "CommandRefused" } });
      expect(yield* eventsOf("client.AlertCarrierTokenSet")).toHaveLength(0);
    }));
  });

it.each([false, true])("6.14 failed token commit during rotation=%s preserves the earlier selection across restart", async (rotation) => {
  const rig = makeRig(); const server = await ntfyServer(); const old = randomUUID(); const uncommitted = randomUUID();
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin);
      if (rotation) yield* setToken(server.origin, old, "old");
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TRIGGER reject_carrier_token BEFORE INSERT ON events WHEN NEW.event_type = 'client.AlertCarrierTokenSet' BEGIN SELECT RAISE(ABORT, 'injected token commit failure'); END`;
      const result = yield* call(ownerCredential, "client.alerts.carrier.set-token", { origin: server.origin, nonce: "uncommitted", value: Redacted.make(uncommitted) });
      expect(result).toMatchObject({ _tag: "Failure" });
      expect((yield* eventsOf("client.AlertCarrierTokenSet")).length).toBe(rotation ? 1 : 0);
      expect(Object.values(storedValues(rig)).includes(uncommitted), "the fault must occur after storing, before committing").toBe(true);
      yield* sql`DROP TRIGGER reject_carrier_token`;
    }), { rig });
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* collectSecrets(yield* snapshot, engineLists);
      const id = yield* raiseQuestion(); expect(yield* delivered(id)).toHaveLength(1);
      expect(posts(server)[0]!.headers.authorization === (rotation ? `Bearer ${old}` : undefined)).toBe(true);
      expect(Object.values(storedValues(rig)).includes(uncommitted)).toBe(false);
    }), { rig, initialize: false });
  } finally { await server.close(); removeRig(rig); }
});

it("6.14 a selected but missing token fails visibly and never falls back to an unauthenticated send", async () => {
  const server = await ntfyServer();
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(server.origin); yield* setToken(server.origin, randomUUID());
      const generation = (yield* eventsOf("client.AlertCarrierTokenSet"))[0]!.event.carrierGeneration;
      yield* (yield* SecretStore).removeCarrierValue!(generation);
      const id = yield* raiseQuestion(); const failures = yield* failed(id);
      expect(failures).toHaveLength(1);
      expect(failures[0]!.event.reason).toMatch(/token missing/i);
      expect(posts(server)).toHaveLength(0);
    }));
  } finally { await server.close(); }
});

it("6.14 changing origins never forwards the first server's token to the second server", async () => {
  const first = await ntfyServer(); const second = await ntfyServer(); const token = randomUUID();
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* configure(first.origin); yield* setToken(first.origin, token);
      const id = yield* raiseQuestion(); expect(yield* delivered(id)).toHaveLength(1);
      yield* configure(second.origin);
      expect(yield* delivered(id, 2)).toHaveLength(2);
      expect(posts(first)[0]!.headers.authorization === `Bearer ${token}`).toBe(true);
      expect(posts(second)).toHaveLength(1);
      expect(posts(second)[0]!.headers.authorization).toBeUndefined();
      expect(JSON.stringify(posts(second).map(({ body, headers }) => ({ body, headers }))).includes(token)).toBe(false);
    }));
  } finally { await first.close(); await second.close(); }
});

it("6b row 201 preserves carrierGeneration as an identity through redaction while still redacting an origin", async () => {
  registerRebuildCheck({ noLog: true });
  const generation = randomUUID();
  const redaction = makeRedactor({ secrets: () => [Redacted.make(generation)], tokenHashes: () => new Set() });
  await Effect.runPromise(Effect.gen(function* () {
    const event = eventOf({ _tag: "client.AlertCarrierTokenSet", origin: `https://${generation}.example`, carrierGeneration: generation });
    const redacted = yield* (yield* Redactor).redact(event);
    expect(redacted).toMatchObject({ carrierGeneration: generation, origin: "https://[REDACTED].example" });
  }).pipe(Effect.provide(redaction.layer)));
});
