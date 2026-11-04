// A disposable service used only by the parent's SIGKILL tests. No adapter or
// credential crosses its IPC boundary. The HTTP peer belongs to the parent.
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as SqliteClient from "@shephrd/t3-node-sqlite/nodeSqliteClient";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import { layer as secrets } from "../../src/accounts/SecretStore.ts";
import * as Redactor from "../../src/log/Redactor.ts";
import { engineLists } from "../../src/pieces/lists.ts";
import { Restart } from "../../src/recovery/service.ts";
import { buildServices } from "../../src/service.ts";
import { makeFakeRunner } from "./fakeRunner.ts";
import { agentCredential, call, ownerCredential, seedAccount, seedAgent, seedHarness, success, type Rig } from "./handlerRig.ts";

const { rig, origin, phase } = JSON.parse(process.argv[2]!) as { rig: Rig; origin: string; phase: string };
let extra: Layer.Layer<any> | Layer.Layer<never> = Layer.empty;
if (phase === "before-send") {
  const url = new URL("../../src/client/alerts/AlertSender.ts", import.meta.url);
  const { AlertSender } = await import(url.href) as { AlertSender: Context.Key<any, {
    send: (payload: { alertId: string }) => Effect.Effect<void>; clear: () => Effect.Effect<void>;
  }> };
  extra = Layer.succeed(AlertSender, {
    send: (payload) => Effect.sync(() => { process.send?.({ phase: "before-send", alertId: payload.alertId }); }).pipe(Effect.andThen(Effect.never)),
    clear: () => Effect.void,
  });
}

try {
  await Effect.runPromise(Effect.gen(function* () {
    yield* TestClock.setTime(1_800_000_000_000);
    const runner = yield* makeFakeRunner();
    const services = buildServices(rig).pipe(Layer.provide(Layer.mergeAll(runner.layer, secrets(rig), Redactor.layer, extra)));
    yield* Effect.gen(function* () {
      yield* runner.subscribed;
      const sql = yield* SqlClient.SqlClient;
      while ((yield* sql`SELECT sequence FROM events WHERE event_type = 'client.AlertBaseline'`).length === 0) yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));
      yield* seedHarness(); yield* seedAccount();
      success(yield* call(ownerCredential, "client.alerts.carrier.set", { carrier: { _tag: "ntfy", server: origin, topic: "crash_6b" } }));
      if (phase === "after-acceptance") {
        // Acceptance and the durable success record cannot be atomic. Force
        // the latter to fail, so the parent kills in that exact window.
        yield* sql`CREATE TRIGGER reject_delivery BEFORE INSERT ON events WHEN NEW.event_type = 'client.AlertDelivered' BEGIN SELECT RAISE(ABORT, 'injected delivery commit failure'); END`;
      }
      const worker = yield* seedAgent({ id: "worker", state: "working" });
      success(yield* call(agentCredential(worker.token), "ask", { text: "Which branch after restart?" }));
      if (phase !== "before-send") {
        const tag = phase === "backoff" ? "client.AlertDeliveryFailed" : "client.AlertRaised";
        let rows: ReadonlyArray<{ payload_json: string }> = [];
        while (rows.length === 0) {
          rows = yield* sql<{ payload_json: string }>`SELECT payload_json FROM events WHERE event_type = ${tag}`;
          if (rows.length === 0) yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));
        }
        process.send?.({ phase, alertId: (JSON.parse(rows[0]!.payload_json) as { alertId: string }).alertId });
      }
      yield* Effect.never;
    }).pipe(Effect.provide(services), Effect.provide(runner.layer));
  }).pipe(
    Effect.provide(Layer.succeed(Restart, { ready: Effect.succeed(true), whenReady: Effect.void, recover: Effect.void, returnAccount: () => Effect.void })),
    Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })),
    Effect.provide(NodeServices.layer), Effect.provide(Logger.layer([])), Effect.provide(TestClock.layer()), Effect.scoped,
  ) as Effect.Effect<unknown, unknown, never>);
} catch { process.send?.({ phase: "failed", reason: "carrier crash fixture could not reach its assigned boundary" }); process.exitCode = 1; }
