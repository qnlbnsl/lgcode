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
import { refused } from "../../../src/commands/internal.ts";
import { engineLists, type EngineLists } from "../../../src/pieces/lists.ts";
import { sheepdogLoop } from "../../../src/roles/sheepdog/loop.ts";
import { stallKey } from "../../../src/roles/sheepdog/stallView.ts";
import type { RolesView } from "../../../src/roles/view.ts";
import { buildServices } from "../../../src/service.ts";
import { Views } from "../../../src/views/Views.ts";
import { LogWriteFailed } from "../../../src/log/EventLog.ts";
import { layer as redactor } from "../../../src/log/Redactor.ts";
import { fixtureClient } from "../../support/fixturePiece.ts";
import { makeFakeRunner } from "../../support/fakeRunner.ts";
import { appendSetup, eventOf, makeFakeSecrets, makeRig, removeRig, seedAccount, seedAgent, seedHarness, type Rig } from "../../support/handlerRig.ts";
import { alertLog } from "../../support/alertsRig.ts";
import { eventually, pause } from "../../support/routingRig.ts";
import { registerRebuildCheck } from "../../support/rebuildCheck.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("SHEPHRD_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });
const current = Views.pipe(Effect.flatMap((views) => views.snapshot));
const roles = current.pipe(Effect.map((snapshot) => snapshot.roles as RolesView));
const lists: EngineLists = { ...engineLists, reactors: { roles: sheepdogLoop } };
const noFlush: EngineLists = { ...lists, planners: { ...lists.planners, "board.flush": () => Effect.fail(refused()) } };
const run = <A, E, R>(configured: EngineLists, body: Effect.Effect<A, E, R>) => Effect.gen(function* () {
  const runner = yield* makeFakeRunner();
  return yield* Effect.scoped(Effect.gen(function* () {
    yield* registerRebuildCheck();
    return yield* body;
  })).pipe(Effect.provide(buildServices(rig, configured).pipe(
    Layer.provide(Layer.mergeAll(runner.layer, makeFakeSecrets().layer, redactor)),
  )), Effect.provide(runner.layer));
}).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped) as Effect.Effect<A, E>;
const socket = (configured: EngineLists) => Effect.gen(function* () {
  const bearer = randomBytes(32).toString("base64url");
  const socketPath = join(rig.stateFolder, "stall.sock");
  yield* serve({ socketPath, ownerCredential: Redacted.make(bearer), debug: true, lists: configured });
  return yield* fixtureClient(socketPath, bearer, configured as any);
});
const setup = Effect.gen(function* () {
  yield* seedAccount(); yield* seedHarness();
  yield* seedAgent({ id: "lead" }); yield* seedAgent({ id: "worker", parent: "lead" });
  yield* eventually(roles, (view) => view.baseline !== undefined);
});
const episode = (postId: string, occurrence: number) => eventually(roles, (view) => view.stalls[stallKey(postId, "worker")]?.occurrence === occurrence);
const assign = (configured: EngineLists) => Effect.gen(function* () {
  const client = yield* socket(configured);
  const result = yield* client["board.post"]!({ requestId: "assigned-task", direct: { _tag: "agent", agentId: "worker" },
    to: [{ _tag: "agent", agentId: "worker" }], reply: "all", text: "Finish the assigned task." });
  // board.post immediately delivers an all-reply assignment. Finish that
  // ordinary turn before testing how long its unanswered obligation is idle.
  const working = yield* eventually(current, (snapshot) => snapshot.agents.worker?.state._tag === "working");
  expect(working.agents.worker?.state._tag).toBe("working");
  yield* appendSetup([
    ...Object.values(working.deliveries).filter((row) => row.target === "worker" && row.status === "sent")
      .map((row) => eventOf({ _tag: "DeliveryAccepted", agentId: "worker", deliveryId: row.id })),
    eventOf({ _tag: "TurnEnded", agentId: "worker", compact: false }),
  ]);
  return result.postId as string;
});

it.effect("socket assignments emit two complete nudges, persist the holder notice across restart, then advise handoff once", () => Effect.gen(function* () {
  let postId = "";
  yield* run(noFlush, Effect.gen(function* () {
    yield* setup;
    postId = yield* assign(noFlush);
    const initial = yield* episode(postId, 0);
    expect(initial.stalls[stallKey(postId, "worker")]).toHaveProperty("originSequence");
    yield* TestClock.adjust("9 minutes"); yield* pause(30);
    expect((yield* roles).actions.filter((row) => row._tag === "roles.StallSeen")).toHaveLength(0);
    yield* TestClock.adjust("1 minute");
    const first = yield* episode(postId, 1);
    expect(first.stalls[stallKey(postId, "worker")]?.occurrence).toBe(1);
    yield* TestClock.adjust("10 minutes"); yield* episode(postId, 2);
    yield* eventually(roles, (view) => view.actions.filter((row) => row._tag === "roles.StallSeen").length === 3);
    expect((yield* roles).actions.filter((row) => row._tag === "roles.StallSeen").map((row) => [row.occurrence, row.noticeRecipient])).toEqual([
      [1, "worker"], [2, "worker"], [2, "lead"],
    ]);
    const holderNotice = (yield* roles).actions.find((row) => row._tag === "roles.StallSeen" && row.noticeRecipient === "lead");
    expect((yield* alertLog).find((row) => row.event._tag === "board.PostWritten" && row.event.postId === holderNotice?.postId)?.event)
      .toMatchObject({ text: expect.stringContaining("stalled twice on the same open post") });
  }));
  yield* run(noFlush, Effect.gen(function* () {
    expect((yield* roles).stalls[stallKey(postId, "worker")]?.occurrence).toBe(2);
    yield* TestClock.adjust("10 minutes"); yield* episode(postId, 3);
    const rows = yield* alertLog;
    expect(rows.filter((row) => row.event._tag === "roles.ReplaceAdvised")).toHaveLength(1);
    const notices = rows.filter((row) => row.event._tag === "board.PostWritten" && row.event.author._tag === "service");
    expect(notices).toHaveLength(4);
    expect(notices.at(-1)?.event).toMatchObject({ reply: "none", text: expect.stringContaining("roles.handoff") });
    yield* TestClock.adjust("60 minutes"); yield* pause(30);
    expect((yield* alertLog).filter((row) => row.event._tag === "roles.ReplaceAdvised")).toHaveLength(1);
  }));
}));

it.effect("a delivered sheepdog nudge stops its own clock until TurnEnded and does not reset the occurrence", () => run(lists, Effect.gen(function* () {
  yield* setup;
  const postId = yield* assign(lists);
  yield* episode(postId, 0);
  yield* TestClock.adjust("10 minutes"); yield* episode(postId, 1);
  yield* eventually(current, (snapshot) => snapshot.agents.worker?.state._tag === "working");
  expect((yield* roles).stalls[stallKey(postId, "worker")]?.originSequence).toBeUndefined();
  yield* TestClock.adjust("30 minutes"); yield* pause(30);
  expect((yield* roles).stalls[stallKey(postId, "worker")]?.occurrence).toBe(1);
  const working = yield* current;
  yield* appendSetup([
    ...Object.values(working.deliveries).filter((row) => row.target === "worker" && row.status === "sent")
      .map((row) => eventOf({ _tag: "DeliveryAccepted", agentId: "worker", deliveryId: row.id })),
    eventOf({ _tag: "TurnEnded", agentId: "worker", compact: false }),
  ]);
  const clock = (yield* roles).stalls[stallKey(postId, "worker")]!;
  expect(clock.occurrence).toBe(1);
  expect(clock.originSequence).toBeDefined();
  yield* TestClock.adjust("9 minutes"); yield* pause(30);
  expect((yield* roles).stalls[stallKey(postId, "worker")]?.occurrence).toBe(1);
  yield* TestClock.adjust("1 minute"); yield* episode(postId, 2);
})));


it.effect("a restart completes the second episode's holder notice after its record failed without reposting it", () => Effect.gen(function* () {
  let postId = "";
  const failing: EngineLists = { ...noFlush, planners: { ...noFlush.planners, "roles.record": (input, payload) => {
    const action = payload.action as { _tag: string; occurrence?: number; noticeRecipient?: string };
    return action._tag === "roles.StallSeen" && action.occurrence === 2 && action.noticeRecipient === "lead"
      ? Effect.fail(new LogWriteFailed({ reason: "database write failed" })) : engineLists.planners["roles.record"]!(input, payload);
  } } };
  yield* run(failing, Effect.gen(function* () {
    yield* setup;
    postId = yield* assign(failing);
    yield* TestClock.adjust("10 minutes"); yield* episode(postId, 1);
    yield* TestClock.adjust("10 minutes"); yield* episode(postId, 2);
    const rows = yield* eventually(alertLog, (rows) => rows.filter((row) => row.event._tag === "board.PostWritten" && row.event.author._tag === "service").length === 3);
    expect(rows.filter((row) => row.event._tag === "roles.StallSeen")).toHaveLength(2);
    yield* pause(30);
  }));
  yield* run(noFlush, Effect.gen(function* () {
    const view = yield* eventually(roles, (view) => view.actions.filter((row) => row._tag === "roles.StallSeen").length === 3);
    expect(view.actions.filter((row) => row._tag === "roles.StallSeen").map((row) => [row.occurrence, row.noticeRecipient])).toEqual([
      [1, "worker"], [2, "worker"], [2, "lead"],
    ]);
    expect((yield* alertLog).filter((row) => row.event._tag === "board.PostWritten" && row.event.author._tag === "service")).toHaveLength(3);
  }));
}));
