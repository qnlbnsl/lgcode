import * as NodeServices from "@effect/platform-node/NodeServices";
import type { Event } from "@shepherd/contracts";
import * as SqliteClient from "@shepherd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as SqlClient from "effect/sql/SqlClient";

import * as CommandHandler from "../../src/commands/CommandHandler.ts";
import * as EventLog from "../../src/log/EventLog.ts";
import { migrate } from "../../src/log/migrations.ts";
import * as Redactor from "../../src/log/Redactor.ts";
import * as Restart from "../../src/recovery/restart.ts";
import type { ProcessReader } from "../../src/recovery/orphans.ts";
import type { Runner } from "../../src/runner/Runner.ts";
import * as Views from "../../src/views/Views.ts";
import { appendSetup, eventOf, makeFakeSecrets, type FakeSecrets, type Fakes, type Rig } from "./handlerRig.ts";
import type { RunnerRig } from "./acpRunnerRig.ts";
import type { FakeRunner, RunnerCall } from "./fakeRunner.ts";
import { snapshot } from "./routingRig.ts";

// Only process identity and signalling are fake. Neither the real process
// reader nor process.kill is used by any recovery test through this helper.
export const emptyHost = {
  reader: { bootId: () => "test-boot", ownGroupId: () => 100, facts: () => undefined } satisfies ProcessReader,
  kill: (_groupId: number, _signal: "SIGTERM" | "SIGKILL"): void => { throw new Error("Unexpected signal"); },
  graceMillis: 0,
  killWaitMillis: 0,
};

export interface RestartOptions {
  readonly reader?: ProcessReader;
  readonly kill?: (groupId: number, signal: "SIGTERM" | "SIGKILL") => void;
  readonly graceMillis?: number;
  readonly killWaitMillis?: number;
  readonly setupTimeoutMillis?: number;
}

// The production seam is deliberately small: Restart.layer is built before
// the handler, and its Restart service exposes recover and ready. The handler
// must gate dispatch and account returns while ready is false (issue 88).
export const provideRestart = <A, E, R>(
  rig: Rig | RunnerRig,
  runner: Layer.Layer<Runner>,
  program: Effect.Effect<A, E, R>,
  options: RestartOptions & {
    readonly recovering?: boolean;
    readonly secrets?: FakeSecrets;
    readonly wrapLog?: Fakes["wrapLog"];
    readonly logLines?: Array<string>;
  } = {},
) => {
  const secrets = options.secrets ?? makeFakeSecrets();
  const base = EventLog.layer.pipe(Layer.provideMerge(Views.layer), Layer.provide(Redactor.layer));
  const log = options.wrapLog === undefined ? base : Layer.effect(EventLog.EventLog,
    Effect.map(EventLog.EventLog, options.wrapLog),
  ).pipe(Layer.provideMerge(base));
  const dependencies = log.pipe(Layer.provideMerge(runner), Layer.provideMerge(secrets.layer));
  const recovery = options.recovering === false ? dependencies : Restart.layer({
    home: rig.home, stateFolder: rig.stateFolder, pluginRoot: rig.pluginRoot,
    ...emptyHost, ...options,
  }).pipe(Layer.provideMerge(dependencies));
  const handler = CommandHandler.layer({
    home: rig.home, stateFolder: rig.stateFolder, pluginRoot: rig.pluginRoot,
  }).pipe(Layer.provideMerge(recovery));
  return Effect.gen(function* () {
    yield* migrate;
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA journal_mode = WAL`;
    return yield* Effect.scoped(program).pipe(Effect.provide(handler));
  }).pipe(
    Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })),
    Effect.provide(NodeServices.layer),
    Effect.provide(Logger.layer([Logger.make((entry) => { options.logLines?.push(Logger.formatJson.log(entry)); })])),
    Effect.scoped,
  );
};

export const recover = Effect.gen(function* () {
  const restart = yield* Restart.Restart;
  yield* restart.recover;
});
export const ready = Effect.gen(function* () {
  const restart = yield* Restart.Restart;
  return yield* restart.ready;
});

export const promptsAfter = (runner: FakeRunner, watermark: number, agentId: string) =>
  runner.calls.slice(watermark).filter((entry): entry is RunnerCall<"prompt"> =>
    entry.method === "prompt" && entry.input.agentId === agentId);

export const carryRows = (agentId: string) => snapshot.pipe(Effect.map((state) =>
  Object.values(state.deliveries).filter((row) => row.target === agentId && row.content._tag === "carry-on")));

// Durable crash-window fixtures. They append the events the real writer
// would have committed; they never fill a view or mutate a database row.
export const appendEvents = (...events: ReadonlyArray<unknown>) => appendSetup(events.map((event) => eventOf(event)));
export const queued = (agentId: string, id: string, text = "Queued work.") => eventOf({
  _tag: "DeliveryQueued", delivery: { id, target: agentId, sender: { _tag: "owner" }, content: { _tag: "prompt", text } },
});
export const sent = (agentId: string, id: string): Event => eventOf({ _tag: "DeliverySent", agentId, deliveryId: id, method: "acp" });
