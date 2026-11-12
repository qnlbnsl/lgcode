import * as SqliteClient from "@lgtm/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { vi } from "vitest";
import { buildServices } from "../../src/service.ts";
import { layer as persistentSecrets } from "../../src/accounts/SecretStore.ts";
import { SecretStore } from "../../src/commands/SecretStore.ts";
import { layer as redactor } from "../../src/log/Redactor.ts";
import { makeFakeRunner, type FakeRunner } from "./fakeRunner.ts";
import { makeRig, removeRig, type Rig } from "./handlerRig.ts";
import { registerRebuildCheck } from "./rebuildCheck.ts";
import type { Rules } from "./callerRules.ts";
import type { EngineLists } from "../../src/pieces/lists.ts";

export async function withPersistentRules(lists: Rules, body: (rig: Rig, runner: FakeRunner) => Effect.Effect<unknown, unknown, any>, decorate?: (real: SecretStore["Service"]) => SecretStore["Service"]) {
  const rig = makeRig();
  vi.stubEnv("LGTM_HOME", rig.stateFolder);
  try {
    await Effect.runPromise(Effect.gen(function* () {
      const runner = yield* makeFakeRunner();
      const base = persistentSecrets(rig);
      const store = decorate === undefined ? base : Layer.effect(SecretStore, Effect.map(SecretStore, decorate)).pipe(Layer.provide(base));
      const services = buildServices(rig, lists as unknown as EngineLists).pipe(Layer.provideMerge(store), Layer.provide(Layer.merge(runner.layer, redactor)));
      return yield* Effect.scoped(Effect.gen(function* () { yield* registerRebuildCheck(); return yield* body(rig, runner); })).pipe(Effect.provide(services), Effect.provide(runner.layer));
    }).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped) as Effect.Effect<unknown, unknown, never>);
  } finally { vi.unstubAllEnvs(); removeRig(rig); }
}
