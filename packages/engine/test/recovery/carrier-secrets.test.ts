import { randomBytes } from "node:crypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as SqliteClient from "@shephrd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { expect, it, vi } from "vitest";
import { layer as persistentStore } from "../../src/accounts/SecretStore.ts";
import { SecretStore } from "../../src/commands/SecretStore.ts";
import * as EventLog from "../../src/log/EventLog.ts";
import { migrate, migratePieces } from "../../src/log/migrations.ts";
import { layer as redactor } from "../../src/log/Redactor.ts";
import * as Views from "../../src/views/Views.ts";
import * as Recovery from "../../src/recovery/restart.ts";
import { Restart } from "../../src/recovery/service.ts";
import type { EngineLists } from "../../src/pieces/lists.ts";
import { makeFakeRunner } from "../support/fakeRunner.ts";
import { emptyHost } from "../support/restartRig.ts";
import { freshRequest, eventOf, makeRig, removeRig } from "../support/handlerRig.ts";
import { rulesFixture, record } from "../support/callerRules.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { asEvent } from "../support/fixturePiece.ts";

it("1.39 actual restart keeps a selected piece token, removes abandoned/replaced secrets, keeps it after account removal and collects it after clear", async () => {
  const rig = makeRig();
  vi.stubEnv("SHEPHRD_HOME", rig.stateFolder);
  const lists = await rulesFixture();
  const reference = "secret:client.alerts.carrier.active";
  lists.secretKeep.client = (view) => (view.client as { records: Array<{ id: string }> }).records.at(-1)?.id === "active" ? [reference] : [];
  const value = randomBytes(24).toString("hex");
  const open = async (recover: boolean, body: Effect.Effect<unknown, unknown, any>) => {
    await Effect.runPromise(Effect.gen(function* () {
      yield* migrate; yield* migratePieces(lists.migrations);
      const runner = yield* makeFakeRunner();
      const base = EventLog.makeLayer(lists as unknown as EngineLists).pipe(Layer.provideMerge(Views.makeLayer(lists as unknown as EngineLists)), Layer.provide(redactor));
      const dependencies = base.pipe(Layer.provideMerge(persistentStore(rig)), Layer.provideMerge(runner.layer));
      const layer = recover ? Recovery.layer({ ...rig, ...emptyHost }).pipe(Layer.provideMerge(dependencies)) : dependencies;
      return yield* Effect.scoped(Effect.gen(function* () {
        yield* registerRebuildCheck();
        if (recover) yield* (yield* Restart).recover;
        return yield* body;
      })).pipe(Effect.provide(layer));
    }).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.provide(NodeServices.layer), Effect.scoped) as Effect.Effect<unknown, unknown, never>);
  };
  const write = (events: Parameters<typeof asEvent>[0][]) => Effect.gen(function* () {
    yield* (yield* EventLog.EventLog).append({ _tag: "owner" }, freshRequest(), randomBytes(16).toString("hex"), events.map(asEvent), {}, false);
  });
  try {
    await open(false, Effect.gen(function* () {
      const store = yield* SecretStore;
      for (const name of [reference, "secret:client.alerts.carrier.abandoned", "secret:account", "secret:replaced"]) yield* store.put(name, Redacted.make(value));
      yield* write([record("active"), eventOf({ _tag: "AccountChanged", accountId: "primary", account: { id: "primary", harness: "first", enabled: true, environment: { API_KEY: "secret:account" } } })]);
    }));
    await open(true, Effect.gen(function* () {
      const store = yield* SecretStore;
      expect((yield* store.resolve(reference)) !== undefined, "the piece keep list must participate in actual recovery").toBe(true);
      expect((yield* store.resolve("secret:account")) !== undefined).toBe(true);
      expect(yield* store.resolve("secret:client.alerts.carrier.abandoned")).toBeUndefined();
      expect(yield* store.resolve("secret:replaced")).toBeUndefined();
      yield* write([eventOf({ _tag: "AccountChanged", accountId: "primary" })]);
    }));
    await open(true, Effect.gen(function* () {
      const store = yield* SecretStore;
      expect((yield* store.resolve(reference)) !== undefined).toBe(true);
      expect(yield* store.resolve("secret:account")).toBeUndefined();
      yield* write([record("cleared")]);
    }));
    await open(true, Effect.gen(function* () { expect(yield* (yield* SecretStore).resolve(reference)).toBeUndefined(); }));
  } finally { vi.unstubAllEnvs(); removeRig(rig); }
});
