import { EventEnvelope as EventEnvelopeSchema, type AlertSourceRequest, type Event, type EventEnvelope, type PieceNamespace } from "@lgtm/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as SqliteClient from "@lgtm/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { vi } from "vitest";

import { engineLists, type EngineLists } from "../../src/pieces/lists.ts";
import { Redactor } from "../../src/log/Redactor.ts";
import { EventLog } from "../../src/log/EventLog.ts";
import { decodeRowWith, type EventRow } from "../../src/log/subscribe.ts";
import { Restart } from "../../src/recovery/service.ts";
import { buildServices } from "../../src/service.ts";
import { makeFakeRunner, type FakeRunner } from "./fakeRunner.ts";
import { appendSetup, eventOf, makeFakeSecrets, makeRig, removeRig, seedAccount, seedAgent, seedHarness, type Rig } from "./handlerRig.ts";
import { eventually, snapshot } from "./routingRig.ts";

// These two configurable tables are the only new seams requested by 6a's
// tests. They contain fixture declarations, never an alert implementation.
export type SourceResult = import("../../src/client/alerts/reactor.ts").AlertSourceResult;
export type AlertLists = EngineLists;

export const quietLists = (lists: AlertLists = engineLists): AlertLists => {
  const { client: _client, ...reactors } = lists.reactors;
  return { ...lists, reactors };
};

export const alertLog = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const log = yield* EventLog;
  const rows = yield* sql<EventRow>`SELECT sequence, event_id, caller, caller_rule, request_id, agent_id, occurred_at, payload_json FROM events ORDER BY sequence`;
  return yield* Effect.forEach(rows, (row) => decodeRowWith(row, log.lists?.envelope));
});
export const eventsOf = <T extends Event["_tag"]>(tag: T) => alertLog.pipe(Effect.map((rows) =>
  rows.filter((row): row is EventEnvelope & { event: Extract<Event, { _tag: T }> } => row.event._tag === tag)));
export const raised = (key?: string) => eventsOf("client.AlertRaised").pipe(Effect.map((rows) =>
  key === undefined ? rows : rows.filter((row) => row.event.alertKey === key)));
export const cleared = (id?: string) => eventsOf("client.AlertCleared").pipe(Effect.map((rows) =>
  id === undefined ? rows : rows.filter((row) => row.event.alertId === id)));
export const awaitRaised = (key: string, count = 1) => eventually(raised(key), (rows) => rows.length >= count);
export const awaitCleared = (id: string) => eventually(cleared(id), (rows) => rows.length > 0);
export const append = (...events: ReadonlyArray<unknown>) => appendSetup(events.map((event) => eventOf(event)));
export const ownerNeeded = (agentId: string, reason = "unrecognised engine reason") =>
  append({ _tag: "OwnerNeeded", agentId, reason });

export const permission = (agentId = "worker", id = "request-1") => append({
  _tag: "PermissionRequested", agentId, permissionRequestId: id, holder: { _tag: "owner" },
  deliveryId: `delivery-${id}`, toolCallId: `tool-${id}`, description: "Write the output file.",
  options: [{ id: "once", name: "Allow once", kind: "allow_once", level: "ask", persistent: false }], settingsWrite: false,
}, { _tag: "OwnerNeeded", agentId, reason: "request needs the owner", subject: { _tag: "permission", id } });
export const question = (agentId = "worker", id = "question-1") => append({
  _tag: "QuestionAsked", agentId, questionId: id, holder: { _tag: "owner" }, deliveryId: `delivery-${id}`, text: "Which branch?",
}, { _tag: "OwnerNeeded", agentId, reason: "request needs the owner", subject: { _tag: "question", id } });

// A positive source after a negative assertion's input proves that the
// reactor consumed the input. This avoids a passing test for a dead follower.
export const barrier = (id = "barrier") => Effect.gen(function* () {
  yield* seedAgent({ id: "barrier-worker", state: "working" });
  yield* question("barrier-worker", id);
  return yield* awaitRaised(`question:${id}`);
});

export interface AlertRigOptions {
  readonly rig?: Rig;
  readonly lists?: AlertLists;
  readonly initialize?: boolean;
  readonly recovery?: Layer.Layer<Restart>;
  readonly lines?: string[];
}
export async function withAlerts(
  body: (runner: FakeRunner, rig: Rig) => Effect.Effect<unknown, unknown, any>,
  options: AlertRigOptions = {},
): Promise<void> {
  const rig = options.rig ?? makeRig();
  vi.stubEnv("LGTM_HOME", rig.stateFolder);
  const program = Effect.gen(function* () {
    const runner = yield* makeFakeRunner();
    const dependencies = Layer.mergeAll(runner.layer, makeFakeSecrets().layer, Layer.succeed(Redactor, {
      // No synthetic secrets are used in these tests. Agent prose must be
      // excluded by alert construction even when the redactor leaves it alone.
      redact: (event: Event) => Effect.succeed(event), redactText: (text: string) => Effect.succeed(text),
    }));
    const services = buildServices(rig, options.lists ?? engineLists).pipe(Layer.provide(dependencies));
    return yield* Effect.scoped(Effect.gen(function* () {
      if (options.initialize !== false) { yield* seedHarness(); yield* seedAccount(); }
      yield* runner.subscribed;
      // Once the builder installs the follower, keep live-source scenarios
      // beyond its first scan. Recovery-gate scenarios release their own gate.
      if ((options.lists ?? engineLists).reactors.client !== undefined && options.recovery === undefined) {
        yield* eventually(eventsOf("client.AlertBaseline"), (rows) => rows.length > 0);
      }
      return yield* body(runner, rig);
    })).pipe(Effect.provide(services), Effect.provide(runner.layer));
  }).pipe(
    Effect.provide(options.recovery ?? Layer.succeed(Restart, {
      ready: Effect.succeed(true), whenReady: Effect.void, recover: Effect.void, returnAccount: () => Effect.void,
    })),
    Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })),
    Effect.provide(NodeServices.layer),
    Effect.provide(Logger.layer([Logger.make((entry) => { options.lines?.push(Logger.formatJson.log(entry)); })])),
    Effect.scoped,
  );
  try { await Effect.runPromise(program as Effect.Effect<unknown, unknown, never>); }
  finally { vi.unstubAllEnvs(); if (options.rig === undefined) removeRig(rig); }
}

export const FixtureAlertEvent = Schema.TaggedStruct("board.AlertFixture", {
  id: Schema.String, phase: Schema.Literals(["open", "closed"]), text: Schema.String,
});
export const pieceLists = (): AlertLists => {
  const event = Schema.Union([engineLists.event, FixtureAlertEvent]) as typeof engineLists.event;
  return {
    ...engineLists, event,
    envelope: Schema.Struct({ ...EventEnvelopeSchema.fields, event }) as typeof engineLists.envelope,
    eventGroups: [...engineLists.eventGroups, { namespace: "board", events: FixtureAlertEvent }],
    visibility: { ...engineLists.visibility, "board.AlertFixture": "owner-only" },
    views: { ...engineLists.views, board: {
      empty: () => ({}),
      reduce: (view, e) => e._tag === "board.AlertFixture" ? { ...(view as object), [e.id as string]: e.phase } : view,
    } },
    alertSources: { ...((engineLists as AlertLists).alertSources ?? {}), board: (envelope) => {
      const e = envelope.event as unknown as { _tag: string; id: string; phase: string };
      if (e._tag !== "board.AlertFixture") return undefined;
      return e.phase === "closed" ? { _tag: "end", key: `post:${e.id}` }
        : { _tag: "raise", kind: "board.post", key: `post:${e.id}`, subject: { _tag: "piece", namespace: "board", id: e.id } };
    } },
    openMatters: { ...((engineLists as AlertLists).openMatters ?? {}), board: (views) =>
      Object.entries(views.board as Record<string, string>).filter(([, phase]) => phase === "open").map(([id]) => ({
        kind: "board.post", key: `post:${id}`, subject: { _tag: "piece", namespace: "board", id },
      })) },
  };
};
export const fixtureEvent = (id: string, phase: "open" | "closed" = "open", text = "Fixture prose.") =>
  appendSetup([{ _tag: "board.AlertFixture", id, phase, text } as unknown as Event]);
export const clientView = snapshot.pipe(Effect.map((view) => view.client as Record<string, unknown>));
