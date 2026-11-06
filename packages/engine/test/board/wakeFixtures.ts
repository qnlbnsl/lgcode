import type { Event, EventEnvelope } from "@sheprd/contracts";
import type { BoardView } from "@sheprd/contracts/board/view";
import * as SqliteClient from "@sheprd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";
import { expect } from "vitest";

import * as CommandHandler from "../../src/commands/CommandHandler.ts";
import { makeRedactor } from "../../src/identity/redactor.ts";
import * as EventLog from "../../src/log/EventLog.ts";
import { migrate } from "../../src/log/migrations.ts";
import { engineLists } from "../../src/pieces/lists.ts";
import * as Views from "../../src/views/Views.ts";
import { makeFakeRunner, type FakeRunner } from "../support/fakeRunner.ts";
import {
  agentCredential, appendSetup, call, eventOf, freshRequest, makeFakeSecrets, seedAccount,
  seedAgent, seedHarness, success, type Credential, type Rig,
} from "../support/handlerRig.ts";
import { channel, agent, owner } from "./fixtures.ts";

export { agent, owner };
export const snapshot = Effect.gen(function* () { return yield* (yield* Views.Views).snapshot; });
export const boardState = snapshot.pipe(Effect.map((state) => state.board as BoardView));
export const queued = (target?: string) => snapshot.pipe(Effect.map((state) => Object.values(state.deliveries)
  .filter((row) => row.source?._tag === "piece" && row.source.namespace === "board"
    && row.status === "queued" && (target === undefined || row.target === target))));
export const wakeFor = (deliveryId: string) => boardState.pipe(Effect.map((state) =>
  Object.values(state.wakes).find((wake) => wake.deliveryId === deliveryId)!));

// Real SQL writer, folds, handler, redactor and piece-batch checks. Only the
// external harness and secret store are fake. A separate notification channel
// parks the handler's automatic followers; the program still gets the real log
// and can run its dispatcher or reactor explicitly at a chosen boundary.
// The optional observer signals a handler's writer attempt before acquisition.
export const provideBoard = <A, E, R>(
  rig: Rig,
  program: Effect.Effect<A, E, R> | ((runner: FakeRunner) => Effect.Effect<A, E, R>),
  secrets: ReadonlyArray<string> = [],
  options: {
    readonly capacityHoldCondition?: (id: import("@sheprd/contracts").AgentId, snapshot: import("../../src/commands/internal.ts").Snapshot) => unknown;
  } = {},
  beforeHandlerTransaction: Effect.Effect<void> = Effect.void,
) => Effect.gen(function* () {
  const runner = yield* makeFakeRunner();
  const lists = { ...engineLists, services: { ...engineLists.services,
    "test.board": ["board.post", "board.close", "board.status", "board.flush"],
  } };
  const redactor = makeRedactor({ secrets: () => secrets.map((value) => Redacted.make(value)), tokenHashes: () => new Set() });
  const log = EventLog.layer.pipe(Layer.provideMerge(Views.layer), Layer.provide(redactor.layer));
  const quietNotifications = Layer.effect(EventLog.EventLog, Effect.gen(function* () {
    const real = yield* EventLog.EventLog;
    const parked = yield* PubSub.unbounded<EventEnvelope>();
    return { ...real, subscribeCommitted: PubSub.subscribe(parked),
      transact: (use) => beforeHandlerTransaction.pipe(Effect.andThen(real.transact(use))),
    } satisfies typeof real;
  })).pipe(Layer.provide(log));
  const services = CommandHandler.layer({ ...rig, ...options }, lists).pipe(
    Layer.provide(quietNotifications), Layer.provideMerge(log),
    Layer.provide(Layer.merge(runner.layer, makeFakeSecrets().layer)),
  );
  yield* migrate;
  yield* (yield* SqlClient.SqlClient)`PRAGMA journal_mode = WAL`;
  return yield* Effect.scoped(typeof program === "function" ? program(runner) : program).pipe(Effect.provide(services), Effect.provide(runner.layer), Effect.provide(redactor.layer));
}).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped);

export const seedBoard = (states: Readonly<Record<string, "idle" | "paused" | "interrupted" | "crashed" | "stopped">> = {}) => Effect.gen(function* () {
  yield* seedAccount();
  yield* seedHarness();
  const credentials: Record<string, Credential> = {};
  for (const id of ["lead", "worker", "other", "fourth"]) {
    const seeded = yield* seedAgent({ id, ...(id === "lead" ? {} : { parent: "lead" }),
      permission: "edit", state: states[id] ?? "idle", reloadable: states[id] !== "interrupted" });
    credentials[id] = agentCredential(seeded.token);
  }
  yield* appendSetup([channel({ members: [owner, agent("lead"), agent("worker"), agent("other"), agent("fourth")] })]);
  return credentials;
});
export const postAs = (credential: Credential, overrides: Record<string, unknown> = {}) => Effect.gen(function* () {
  const reply = success(yield* call(credential, "board.post", {
    channelId: "room", text: "Please report your result.", to: [agent("worker")], reply: "all", ...overrides,
  }));
  expect(reply.postId, "board.post must return its own committed id").toBeTypeOf("string");
  return reply.postId as string;
});
export const serviceCall = (name: string, payload: Record<string, unknown>) => Effect.gen(function* () {
  const handler = yield* CommandHandler.CommandHandler;
  return yield* handler.execute({ _tag: "service", service: "test.board" }, name,
    { requestId: freshRequest(), ...payload }).pipe(Effect.result);
});
export const change = (...events: ReadonlyArray<Record<string, unknown>>) => appendSetup(events.map((event) => eventOf(event)));
export const deliveryEvent = (tag: "DeliverySent" | "DeliveryAccepted" | "DeliveryRequeued" | "DeliveryReturned", id: string, target: string) => eventOf({
  _tag: tag, agentId: target, deliveryId: id,
  ...(tag === "DeliverySent" ? { method: "acp" } : {}),
  ...(tag === "DeliveryRequeued" ? { reason: "Fixture pause." } : {}),
  ...(tag === "DeliveryReturned" ? { reason: "Fixture return.", sender: { _tag: "piece", namespace: "board" } } : {}),
});
export const appendDelivery = (tag: Parameters<typeof deliveryEvent>[0], id: string, target: string) => appendSetup([deliveryEvent(tag, id, target)]);
export const deliveryText = (delivery: { readonly content: { readonly _tag: string; readonly text?: string } }) => {
  expect(delivery.content._tag).toBe("prompt");
  expect(delivery.content.text).toBeTypeOf("string");
  return delivery.content.text!;
};
export const encodedBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
export const eventsOf = <T extends Event["_tag"]>(events: ReadonlyArray<{ readonly event: Event }>, tag: T) =>
  events.map((row) => row.event).filter((event): event is Extract<Event, { readonly _tag: T }> => event._tag === tag);

export const wakeBody = (delivery: Parameters<typeof deliveryText>[0]) => {
  const lines = deliveryText(delivery).split("\n");
  expect(lines[0]).toMatch(/^Data from piece board \[/);
  expect(lines.at(-1)).toMatch(/^End data \[/);
  return lines.slice(1, -1).join("\n");
};
