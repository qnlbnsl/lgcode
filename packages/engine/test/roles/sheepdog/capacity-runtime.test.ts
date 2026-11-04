import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { it } from "@effect/vitest";
import * as SqliteClient from "@shephrd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { TestClock } from "effect/testing";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { serve } from "../../../src/api/server.ts";
import { layer as redactor } from "../../../src/log/Redactor.ts";
import { engineLists } from "../../../src/pieces/lists.ts";
import { capacityHoldCount } from "../../../src/routing/deliveries.ts";
import type { RolesView } from "../../../src/roles/view.ts";
import { buildServices } from "../../../src/service.ts";
import { capacityReply, hold } from "../../support/capacityRig.ts";
import { send, spawn } from "../../support/deliveryRig.ts";
import { makeFakeRunner, type FakeRunner } from "../../support/fakeRunner.ts";
import { fixtureClient } from "../../support/fixturePiece.ts";
import { makeFakeSecrets, makeRig, removeRig, seedAccount, seedHarness, type Rig } from "../../support/handlerRig.ts";
import { alertLog } from "../../support/alertsRig.ts";
import { eventually, pause, snapshot } from "../../support/routingRig.ts";
import { registerRebuildCheck } from "../../support/rebuildCheck.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("SHEPHRD_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });
const run = <A, E, R>(body: (runner: FakeRunner) => Effect.Effect<A, E, R>, boardEnabled = true, initialize = true) => {
  const lists = { ...engineLists, boardEnabled };
  return Effect.gen(function* () {
    const runner = yield* makeFakeRunner();
    return yield* Effect.scoped(Effect.gen(function* () {
      yield* registerRebuildCheck();
      if (initialize) { yield* seedAccount(); yield* seedHarness(); }
      yield* runner.subscribed;
      return yield* body(runner);
    })).pipe(Effect.provide(buildServices(rig, lists).pipe(
      Layer.provide(Layer.mergeAll(runner.layer, makeFakeSecrets().layer, redactor)),
    )), Effect.provide(runner.layer));
  }).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped) as Effect.Effect<A, E>;
};
const socket = Effect.gen(function* () {
  const bearer = randomBytes(32).toString("base64url");
  const socketPath = join(rig.stateFolder, "engine.sock");
  yield* serve({ socketPath, ownerCredential: Redacted.make(bearer), debug: true, lists: engineLists });
  return yield* fixtureClient(socketPath, bearer, engineLists as any);
});
const gaveUps = snapshot.pipe(Effect.map((state) => (state.roles as RolesView).actions.filter(
  (action) => action._tag === "roles.GaveUp" && action.cause === "capacity",
)));

it.effect("capacity service releases at five minutes twelve times, flushes give-up to the holder, and starts a new outage", () => run((runner) => Effect.gen(function* () {
  const lead = yield* spawn(rig, runner);
  const worker = yield* spawn(rig, runner, lead);
  const deliveryId = yield* send(runner, worker, "Complete the work.");
  for (let attempt = 1; attempt <= 12; attempt++) {
    yield* hold(runner, worker, deliveryId);
    expect(capacityHoldCount(yield* snapshot, worker.agentId)).toBe(attempt);
    yield* pause(30);
    yield* TestClock.adjust("299999 millis");
    expect((yield* snapshot).agents[worker.agentId]!.capacityHeld).toBe(true);
    yield* TestClock.adjust("1 millis");
    const state = yield* eventually(snapshot, (state) => state.deliveries[deliveryId]?.status === "sent");
    expect(state.agents[worker.agentId]!.capacityHeld).toBe(false);
    expect(state.deliveries[deliveryId]?.status).toBe("sent");
  }
  yield* capacityReply(runner, worker, deliveryId);
  const records = yield* eventually(gaveUps, (rows) => rows.length === 1);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ agentId: worker.agentId, noticeRecipient: lead.agentId, notice: "sent" });
  const rows = yield* alertLog;
  expect(rows.filter((row) => row.event._tag === "DeliveryReleased" && row.event.agentId === worker.agentId)).toHaveLength(12);
  const post = rows.find((row) => row.event._tag === "board.PostWritten" && row.event.postId === records[0]!.postId);
  expect(post?.event).toMatchObject({ text: expect.stringContaining("Move the work to another model.") });
  expect(rows.some((row) => row.event._tag === "board.WakeBuilt" && row.event.targetAgentId === lead.agentId)).toBe(true);
  expect(capacityHoldCount(yield* snapshot, worker.agentId)).toBe(0);
  const next = yield* send(runner, worker, "Try again after the outage.");
  yield* hold(runner, worker, next);
  expect(capacityHoldCount(yield* snapshot, worker.agentId)).toBe(1);
  yield* pause(30);
  yield* TestClock.adjust("5 minutes");
  expect((yield* eventually(snapshot, (state) => !state.agents[worker.agentId]!.capacityHeld)).agents[worker.agentId]!.capacityHeld).toBe(false);
  expect(yield* gaveUps).toHaveLength(1);
})), 30_000);

it.effect("socket settings and owner release count toward exhaustion while the board is off", () => run((runner) => Effect.gen(function* () {
  const client = yield* socket;
  yield* client["roles.settings.set"]!({ requestId: "one-retry", settings: { limits: { capacityRetries: 1 } } });
  const worker = yield* spawn(rig, runner);
  const deliveryId = yield* send(runner, worker, "Work through the outage.");
  yield* hold(runner, worker, deliveryId);
  yield* client.release!({ requestId: "owner-release", agentId: worker.agentId });
  expect((yield* eventually(snapshot, (state) => state.deliveries[deliveryId]?.status === "sent")).deliveries[deliveryId]?.status).toBe("sent");
  yield* capacityReply(runner, worker, deliveryId);
  expect(yield* eventually(gaveUps, (rows) => rows.length === 1)).toHaveLength(1);
  expect((yield* alertLog).filter((row) => row.event._tag === "DeliveryHeld")).toHaveLength(1);
  yield* eventually(alertLog, (rows) => rows.some((row) => row.event._tag === "client.AlertRaised" && row.event.kind === "roles.stall"));
  expect((yield* alertLog).some((row) => row.event._tag === "client.AlertRaised" && row.event.kind === "roles.stall")).toBe(true);
  expect((yield* alertLog).filter((row) => row.event._tag === "board.PostWritten")).toHaveLength(0);
}), false), 15_000);

it.effect("a restart releases a persisted hold whose five-minute deadline passed while the service was down", () => Effect.gen(function* () {
  const worker = yield* run((runner) => Effect.gen(function* () {
    const worker = yield* spawn(rig, runner);
    const deliveryId = yield* send(runner, worker, "Resume the held work.");
    yield* hold(runner, worker, deliveryId);
    yield* pause(30);
    return worker;
  }));
  yield* TestClock.adjust("6 minutes");
  yield* run(() => Effect.gen(function* () {
    const rows = yield* eventually(alertLog, (rows) => rows.some((row) => row.event._tag === "DeliveryReleased"));
    expect(rows.filter((row) => row.event._tag === "DeliveryReleased" && row.event.agentId === worker.agentId)).toHaveLength(1);
    expect((yield* snapshot).agents[worker.agentId]!.capacityHeld).toBe(false);
  }), true, false);
}));
