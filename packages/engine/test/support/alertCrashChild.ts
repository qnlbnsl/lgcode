// Disposable real followers. The parent kills this process while it is parked
// at an observed source-read or inside an uncommitted baseline transaction.
import type { EventEnvelope } from "@sheprd/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as SqliteClient from "@sheprd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as SqlClient from "effect/sql/SqlClient";
import { engineLists } from "../../src/pieces/lists.ts";
import { alertReactor } from "../../src/client/alerts/reactor.ts";
import { EventLog } from "../../src/log/EventLog.ts";
import * as Redactor from "../../src/log/Redactor.ts";
import { Restart } from "../../src/recovery/service.ts";
import { buildServices } from "../../src/service.ts";
import { makeFakeRunner } from "./fakeRunner.ts";
import { agentCredential, call, seedAccount, seedAgent, seedHarness, success, makeFakeSecrets, type Rig } from "./handlerRig.ts";
import { eventsOf } from "./alertsRig.ts";
import { eventually } from "./routingRig.ts";

const rig = JSON.parse(process.argv[2]!) as Rig;
const mode = process.argv[3] ?? "source";
const client = Effect.gen(function* () {
  const log = yield* EventLog;
  const sql = yield* SqlClient.SqlClient;
  yield* alertReactor.pipe(Effect.provideService(EventLog, { ...log,
    transact: (use) => log.transact((append) => use((...args) => append(...args).pipe(Effect.tap((rows) => Effect.gen(function* () {
      if (mode !== "baseline" || !rows.some((row) => (row.event._tag === "client.AlertBaseline" || (row.event._tag === "client.AlertRaised" && row.event.baseline)))) return;
      // This SELECT uses the transaction's writer connection. The parent must
      // see none of these staged rows after SIGKILL rolls the transaction back.
      const staged = yield* sql<{ count: number }>`SELECT COUNT(*) AS count FROM events
        WHERE json_extract(payload_json, '$._tag') IN ('client.AlertBaseline', 'client.AlertRaised')`.pipe(Effect.orDie);
      process.send?.({ phase: "baseline-uncommitted", staged: staged[0]!.count });
      yield* Effect.never;
    }))))),
  }));
});
const lists = { ...engineLists, reactors: { ...engineLists.reactors, client }, alertSources: { ...engineLists.alertSources,
  board: (envelope: EventEnvelope) => {
    if (mode === "source" && envelope.event._tag === "OwnerNeeded" && envelope.event.subject?._tag === "question") {
      process.send?.({ phase: "source-read", questionId: envelope.event.subject.id, sourceSequence: envelope.sequence });
      // Synchronous parking keeps the pure source callback before the batch's
      // append. It does not insert a fake source or replace the real reactor.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    }
    return engineLists.alertSources?.board?.(envelope);
  },
} };
await Effect.runPromise(Effect.gen(function* () {
  const runner = yield* makeFakeRunner();
  const services = buildServices(rig, lists).pipe(Layer.provide(Layer.mergeAll(
    runner.layer, makeFakeSecrets().layer, Redactor.layer,
  )));
  yield* Effect.gen(function* () {
    if (mode === "source") {
      yield* eventually(eventsOf("client.AlertBaseline"), (rows) => rows.length === 1);
      yield* seedHarness(); yield* seedAccount();
      const worker = yield* seedAgent({ id: "worker", state: "working" });
      success(yield* call(agentCredential(worker.token), "ask", { text: "Which branch after restart?" }));
    }
    yield* Effect.never;
  }).pipe(Effect.provide(services), Effect.provide(runner.layer));
}).pipe(
  Effect.provide(Layer.succeed(Restart, { ready: Effect.succeed(true), whenReady: Effect.void, recover: Effect.void, returnAccount: () => Effect.void })),
  Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })),
  Effect.provide(NodeServices.layer), Effect.provide(Logger.layer([])), Effect.scoped,
));
