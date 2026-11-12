import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { it } from "@effect/vitest";
import * as SqliteClient from "@lgtm/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Clock from "effect/Clock";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { TestClock } from "effect/testing";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { serve } from "../../../src/api/server.ts";
import { layer as redactor } from "../../../src/log/Redactor.ts";
import { engineLists, type EngineLists } from "../../../src/pieces/lists.ts";
import { CommandHandler } from "../../../src/commands/CommandHandler.ts";
import { refused } from "../../../src/commands/internal.ts";
import { capacityRule } from "../../../src/roles/sheepdog/rules/capacity.ts";
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
import { unwrap } from "../../client/support/readRig.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("LGTM_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });
const run = <A, E, R>(body: (runner: FakeRunner) => Effect.Effect<A, E, R>, boardEnabled = true, initialize = true, override?: EngineLists) => {
  const lists = override ?? { ...engineLists, boardEnabled };
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

it.effect("a selected old capacity timer cannot release a newer hold of the same delivery", () => {
  const lists = { ...engineLists, reactors: {} };
  return run((runner) => Effect.gen(function* () {
    const worker = yield* spawn(rig, runner);
    const deliveryId = yield* send(runner, worker, "Keep the newer hold.");
    yield* hold(runner, worker, deliveryId);
    const selected = yield* snapshot;
    const origin = capacityRule.timers!({ snapshot: selected, lists, sourceSequence: selected.sequence, firstStart: false, baselinePosition: 0 })[0]!;
    yield* TestClock.adjust("5 minutes");
    const now = yield* Clock.currentTimeMillis;
    const handler = yield* CommandHandler;
    const execute = handler.execute;
    const entered = yield* Deferred.make<void>();
    const proceed = yield* Deferred.make<void>();
    const spy = vi.spyOn(handler, "execute").mockImplementation((caller, name, payload) => Effect.gen(function* () {
      if (caller._tag === "service" && name === "release") {
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(proceed);
      }
      return yield* execute(caller, name, payload);
    }));
    const old = yield* capacityRule.onTimer!({ snapshot: selected, lists, sourceSequence: selected.sequence, firstStart: false, baselinePosition: 0 },
      { ...origin, dueAt: now }).pipe(Effect.forkChild);
    yield* Deferred.await(entered);
    yield* handler.execute({ _tag: "owner" }, "release", { requestId: "manual-old-release", agentId: worker.agentId });
    yield* eventually(snapshot, (view) => view.deliveries[deliveryId]?.status === "sent");
    yield* hold(runner, worker, deliveryId);
    yield* Deferred.succeed(proceed, undefined);
    yield* Fiber.join(old);
    spy.mockRestore();
    expect((yield* snapshot).agents[worker.agentId]!.capacityHeld).toBe(true);
    expect(capacityHoldCount(yield* snapshot, worker.agentId)).toBe(2);
    expect(((yield* snapshot).roles as RolesView).agents[worker.agentId]!.capacityRetries).toBe(0);
    expect((yield* alertLog).filter((row) => row.event._tag === "DeliveryReleased")).toHaveLength(1);
    const current = yield* snapshot;
    const next = capacityRule.timers!({ snapshot: current, lists, sourceSequence: current.sequence, firstStart: false, baselinePosition: 0 })[0]!;
    const ctx = { snapshot: current, lists, sourceSequence: current.sequence, firstStart: false, baselinePosition: 0 };
    yield* capacityRule.onTimer!(ctx, { ...next, dueAt: now + 300_000 });
    expect((yield* snapshot).agents[worker.agentId]!.capacityHeld).toBe(true);
    yield* TestClock.adjust("5 minutes");
    yield* capacityRule.onTimer!(ctx, { ...next, dueAt: now + 300_000 });
    expect((yield* snapshot).agents[worker.agentId]!.capacityHeld).toBe(false);
    const released = (yield* alertLog).findLast((row) => row.event._tag === "DeliveryReleased")!;
    yield* capacityRule.onEvent!({ ...ctx, snapshot: yield* snapshot }, released);
    const roles = (yield* snapshot).roles as RolesView;
    expect(roles.agents[worker.agentId]!.capacityRetries).toBe(2);
    expect(roles.actions.filter((action) => action._tag === "roles.CapacityRetried"))
      .toMatchObject([{ triggerSequence: next.originSequence, occurrence: 2 }]);
  }), true, true, lists);
});

it.effect("a refused automatic release does not record or count a successful capacity retry", () => {
  const real = engineLists.planners.release!;
  const lists: EngineLists = { ...engineLists, planners: { ...engineLists.planners,
    release: (input, payload) => input.actor._tag === "service" ? Effect.fail(refused()) : real(input, payload),
  } };
  return run((runner) => Effect.gen(function* () {
    const worker = yield* spawn(rig, runner);
    const delivery = yield* send(runner, worker, "Stay held after refusal.");
    yield* hold(runner, worker, delivery);
    yield* pause(30);
    yield* TestClock.adjust("5 minutes");
    const rows = yield* eventually(alertLog, (rows) => rows.some((row) => row.event._tag === "CommandRefused" && row.event.command === "release"));
    expect(rows.filter((row) => row.event._tag === "CommandRefused" && row.event.command === "release")).toHaveLength(1);
    expect(rows.filter((row) => row.event._tag === "roles.CapacityRetried")).toHaveLength(0);
    expect(((yield* snapshot).roles as RolesView).agents[worker.agentId]!.capacityRetries).toBe(0);
    expect((yield* snapshot).agents[worker.agentId]!.capacityHeld).toBe(true);
  }), true, true, lists);
});

for (const role of ["chef:builder", ":builder", "worker:builder"]) {
  it.effect(`loaded named limits preserve generic admission and advice for ${role}`, () => run((runner) => Effect.gen(function* () {
    const client = yield* socket;
    yield* client["roles.role-file.set"]!({ requestId: "named-limits", content: JSON.stringify({ name: "Team", roles: {
      builder: { advice: "Custom builder advice.", limits: { capacityRetries: 0, stallMinutes: 25, ageMinutes: 60 } },
    } }) });
    const worker = yield* spawn(rig, runner, undefined, { role });
    const agent = yield* fixtureClient(join(rig.stateFolder, "engine.sock"), worker.token, engineLists as any);
    const reply = yield* agent["roles.orient"]!({ requestId: "read-advice" });
    expect(reply.data).toBeTypeOf("string");
    const orient = unwrap({ data: String(reply.data) });
    expect(orient.kind).toBe("worker");
    expect(orient.advice).toBe(role === "worker:builder" ? "Custom builder advice." : "Report your work and questions to your lead. Do not start agents. Do not ask the owner. Run board.acknowledge when starting to respond to a post.");
    const delivery = yield* send(runner, worker, "Use the appropriate capacity policy.");
    yield* capacityReply(runner, worker, delivery);
    const rows = yield* eventually(alertLog, (rows) => rows.some((row) => row.event._tag === (role === "worker:builder" ? "DeliveryReturned" : "DeliveryHeld")));
    expect(rows.filter((row) => row.event._tag === "DeliveryHeld")).toHaveLength(role === "worker:builder" ? 0 : 1);
    expect((yield* snapshot).agents[worker.agentId]!.capacityHeld).toBe(role !== "worker:builder");
  })));
}

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
    const recorded = yield* eventually(snapshot, (view) => (view.roles as RolesView).agents[worker.agentId]!.capacityRetries === attempt);
    expect((recorded.roles as RolesView).agents[worker.agentId]!.capacityRetries).toBe(attempt);
  }
  yield* capacityReply(runner, worker, deliveryId);
  const records = yield* eventually(gaveUps, (rows) => rows.length === 1);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ agentId: worker.agentId, noticeRecipient: lead.agentId, notice: "sent" });
  const rows = yield* alertLog;
  expect(rows.filter((row) => row.event._tag === "DeliveryReleased" && row.event.agentId === worker.agentId)).toHaveLength(12);
  expect(rows.filter((row) => row.event._tag === "roles.CapacityRetried").map((row) =>
    row.event._tag === "roles.CapacityRetried" && row.event.occurrence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
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

it.effect("lowering the retry setting does not strand an existing hold or admit another one", () => run((runner) => Effect.gen(function* () {
  const client = yield* socket;
  const worker = yield* spawn(rig, runner);
  const deliveryId = yield* send(runner, worker, "Finish the admitted attempt.");
  yield* hold(runner, worker, deliveryId);
  yield* client["roles.settings.set"]!({ requestId: "disable-future-retries", settings: { limits: { capacityRetries: 0 } } });
  yield* pause(30);
  yield* TestClock.adjust("5 minutes");
  expect((yield* eventually(snapshot, (state) => state.deliveries[deliveryId]?.status === "sent")).agents[worker.agentId]!.capacityHeld).toBe(false);
  yield* capacityReply(runner, worker, deliveryId);
  expect(yield* eventually(gaveUps, (rows) => rows.length === 1)).toHaveLength(1);
  expect((yield* alertLog).filter((row) => row.event._tag === "DeliveryHeld")).toHaveLength(1);
}), false));
