// A disposable service used only by the parent's SIGKILL tests. No adapter or
// credential crosses its IPC boundary. The HTTP peer belongs to the parent.
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as SqliteClient from "@shephrd/t3-node-sqlite/nodeSqliteClient";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import { layer as secrets } from "../../src/accounts/SecretStore.ts";
import * as Redactor from "../../src/log/Redactor.ts";
import { EventLog, LogWriteFailed } from "../../src/log/EventLog.ts";
import { engineLists } from "../../src/pieces/lists.ts";
import { Restart } from "../../src/recovery/service.ts";
import { buildServices } from "../../src/service.ts";
import { makeFakeRunner } from "./fakeRunner.ts";
import { agentCredential, call, ownerCredential, seedAccount, seedAgent, seedHarness, success, type Rig } from "./handlerRig.ts";

const { rig, origin, phase } = JSON.parse(process.argv[2]!) as { rig: Rig; origin: string; phase: string };
// Keep the disposable service alive after its followers stop, until SIGKILL.
process.on("message", () => {});
let reactorStopped = false;
let supervisorStopped = false;
const lists = { ...engineLists, reactors: { ...engineLists.reactors,
  client: engineLists.reactors.client!.pipe(Effect.onExit((exit) => Effect.sync(() => {
    reactorStopped = Exit.isFailure(exit) && exit.cause.reasons.some((reason) =>
      reason._tag === "Fail" && reason.error instanceof LogWriteFailed);
  }))),
} };
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
    const services = buildServices(rig, lists).pipe(Layer.provide(Layer.mergeAll(runner.layer, secrets(rig), Redactor.layer, extra)));
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
        const alertId = (JSON.parse(rows[0]!.payload_json) as { alertId: string }).alertId;
        if (phase === "after-acceptance") {
          while (!reactorStopped || !supervisorStopped) yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));
          // Prove the failure is latched, rather than hitting the trigger twice.
          yield* sql`DROP TRIGGER reject_delivery`;
          const probe = yield* (yield* EventLog).transact(() => Effect.void).pipe(Effect.result);
          const writerLatched = probe._tag === "Failure" && probe.failure instanceof LogWriteFailed;
          process.send?.({ phase, alertId, writerLatched, reactorStopped, supervisorStopped });
          yield* Effect.promise(() => new Promise<void>((resolve) => process.once("message", () => resolve())));
          // Pass both the supervisor's restart interval and every retry delay.
          yield* TestClock.adjust(600_000);
          process.send?.({ phase: "advanced" });
        } else process.send?.({ phase, alertId });
      }
      yield* Effect.never;
    }).pipe(Effect.provide(services), Effect.provide(runner.layer));
  }).pipe(
    Effect.provide(Layer.succeed(Restart, { ready: Effect.succeed(true), whenReady: Effect.void, recover: Effect.void, returnAccount: () => Effect.void })),
    Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })),
    Effect.provide(NodeServices.layer), Effect.provide(Logger.layer([Logger.make((entry) => {
      const line = Logger.formatJson.log(entry);
      if (line.includes("piece reactor stopped: database write failed") && line.includes('"client"')) supervisorStopped = true;
    })])), Effect.provide(TestClock.layer()), Effect.scoped,
  ) as Effect.Effect<unknown, unknown, never>);
} catch { process.send?.({ phase: "failed", reason: "carrier crash fixture could not reach its assigned boundary" }); process.exitCode = 1; }
