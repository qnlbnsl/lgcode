// A disposable service for the source-COMMIT/alert-write crash window. This
// child reports no credential and starts no real adapter. Its parent sends
// SIGKILL after the real ask planner has committed OwnerNeeded.
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as SqliteClient from "@shephrd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import { engineLists } from "../../src/pieces/lists.ts";
import * as Redactor from "../../src/log/Redactor.ts";
import { Restart } from "../../src/recovery/service.ts";
import { buildServices } from "../../src/service.ts";
import { makeFakeRunner } from "./fakeRunner.ts";
import { agentCredential, appendSetup, call, eventOf, headSequence, makeFakeSecrets, seedAccount, seedAgent, seedHarness, success, type Rig } from "./handlerRig.ts";

const rig = JSON.parse(process.argv[2]!) as Rig;
const { client: _client, ...reactors } = engineLists.reactors;
await Effect.runPromise(Effect.gen(function* () {
  const runner = yield* makeFakeRunner();
  const services = buildServices(rig, { ...engineLists, reactors }).pipe(Layer.provide(Layer.mergeAll(
    runner.layer, makeFakeSecrets().layer, Redactor.layer,
  )));
  yield* Effect.gen(function* () {
    yield* seedHarness(); yield* seedAccount();
    const worker = yield* seedAgent({ id: "worker", state: "working" });
    yield* appendSetup([eventOf({ _tag: "client.AlertBaseline", position: yield* headSequence })]);
    const reply = success(yield* call(agentCredential(worker.token), "ask", { text: "Which branch after restart?" }));
    process.send?.({ phase: "source-committed", questionId: reply.questionId });
    yield* Effect.never;
  }).pipe(Effect.provide(services), Effect.provide(runner.layer));
}).pipe(
  Effect.provide(Layer.succeed(Restart, { ready: Effect.succeed(true), whenReady: Effect.void, recover: Effect.void, returnAccount: () => Effect.void })),
  Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })),
  Effect.provide(NodeServices.layer), Effect.provide(Logger.layer([])), Effect.scoped,
));
