import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { it } from "@effect/vitest";
import * as SqliteClient from "@sheprd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { TestClock } from "effect/testing";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { serve } from "../../../src/api/server.ts";
import { refused } from "../../../src/commands/internal.ts";
import { engineLists, type EngineLists } from "../../../src/pieces/lists.ts";
import { executeService } from "../../../src/commands/services.ts";
import { sheepdogCaller } from "../../../src/roles/sheepdog/notices.ts";
import { sheepdogLoop } from "../../../src/roles/sheepdog/loop.ts";
import { stallKey } from "../../../src/roles/sheepdog/stallView.ts";
import type { RolesView } from "../../../src/roles/view.ts";
import { buildServices } from "../../../src/service.ts";
import { Views } from "../../../src/views/Views.ts";
import { LogWriteFailed } from "../../../src/log/EventLog.ts";
import { layer as redactor } from "../../../src/log/Redactor.ts";
import { fixtureClient } from "../../support/fixturePiece.ts";
import { makeFakeRunner } from "../../support/fakeRunner.ts";
import { appendSetup, eventOf, makeFakeSecrets, makeRig, removeRig, seedAccount, seedAgent, seedHarness, startPayload, type Rig } from "../../support/handlerRig.ts";
import { alertLog } from "../../support/alertsRig.ts";
import { eventually, pause } from "../../support/routingRig.ts";
import { registerRebuildCheck } from "../../support/rebuildCheck.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("SHEPRD_HOME", rig.stateFolder); });
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

for (const interruptedOccurrence of [1, 2]) it.effect(`restart recovers a delivered occurrence ${interruptedOccurrence} before its action record`, () => Effect.gen(function* () {
  let postId = "";
  const failing: EngineLists = { ...lists, planners: { ...lists.planners, "roles.record": (input, payload) => {
    const action = payload.action as { _tag: string; occurrence?: number; noticeRecipient?: string };
    return action._tag === "roles.StallSeen" && action.occurrence === interruptedOccurrence && action.noticeRecipient === "worker"
      ? Effect.interrupt : engineLists.planners["roles.record"]!(input, payload);
  } } };
  const finishNudge = Effect.gen(function* () {
    const working = yield* eventually(current, snapshot => snapshot.agents.worker?.state._tag === "working");
    expect(working.agents.worker?.state._tag).toBe("working");
    yield* appendSetup([
      ...Object.values(working.deliveries).filter(row => row.target === "worker" && row.status === "sent")
        .map(row => eventOf({ _tag: "DeliveryAccepted", agentId: "worker", deliveryId: row.id })),
      eventOf({ _tag: "TurnEnded", agentId: "worker", compact: false }),
    ]);
  });
  yield* run(failing, Effect.gen(function* () {
    yield* setup;
    postId = yield* assign(failing);
    if (interruptedOccurrence === 2) {
      yield* TestClock.adjust("10 minutes");
      expect((yield* episode(postId, 1)).stalls[stallKey(postId, "worker")]?.occurrence).toBe(1);
      yield* finishNudge;
    }
    yield* TestClock.adjust("10 minutes");
    yield* finishNudge;
    expect((yield* roles).actions.filter(row => row._tag === "roles.StallSeen" && row.noticeRecipient === "worker")).toHaveLength(interruptedOccurrence - 1);
    const rows = yield* alertLog;
    const pending = rows.findLast(row => row.event._tag === "roles.StallNoticePlanned" && row.event.noticeRecipient === "worker");
    const posted = rows.findLast(row => row.event._tag === "board.PostWritten" && row.event.author._tag === "service");
    expect(pending).toBeDefined();
    expect(pending!.sequence).toBeLessThan(posted!.sequence);
    expect((yield* roles).pendingStallNotices).toMatchObject([{ occurrence: interruptedOccurrence, stalledPostId: postId, noticeRecipient: "worker" }]);
  }));
  // Only the database crosses the service boundary; no action is retained here.
  yield* run(lists, Effect.gen(function* () {
    const recovered = yield* episode(postId, interruptedOccurrence);
    expect(recovered.stalls[stallKey(postId, "worker")]?.occurrence).toBe(interruptedOccurrence);
    expect((yield* eventually(roles, view => view.actions.filter(row => row._tag === "roles.StallSeen").length === (interruptedOccurrence === 1 ? 1 : 3))).actions
      .filter(row => row._tag === "roles.StallSeen").map(row => [row.occurrence, row.noticeRecipient]))
      .toEqual(interruptedOccurrence === 1 ? [[1, "worker"]] : [[1, "worker"], [2, "worker"], [2, "lead"]]);
    yield* TestClock.adjust("10 minutes");
    expect((yield* episode(postId, interruptedOccurrence + 1)).stalls[stallKey(postId, "worker")]?.occurrence).toBe(interruptedOccurrence + 1);
    const rows = yield* alertLog;
    const posts = rows.filter(row => row.event._tag === "board.PostWritten" && row.event.author._tag === "service");
    expect(posts).toHaveLength(interruptedOccurrence === 1 ? 3 : 4);
    const flushes = rows.filter(row => row.event._tag === "board.WakeBuilt");
    expect(flushes).toHaveLength(interruptedOccurrence === 1 ? 4 : 5);
  }));
}));

for (const recovery of ["account", "permission-stop"] as const) it.effect(`a waiting lead gets a fresh full stall interval after ${recovery}, including restart`, () => Effect.gen(function* () {
  let leadId = "";
  let postId = "";
  let originSequence = 0;
  yield* run(lists, Effect.gen(function* () {
    yield* seedAccount(); yield* seedAccount("lead-account"); yield* seedHarness();
    expect((yield* eventually(roles, view => view.baseline !== undefined)).baseline).toBeDefined();
    const client = yield* socket(lists);
    leadId = (yield* client.start!({ ...startPayload(rig, { role: "lead", groups: [], account: { _tag: "named", accountId: "lead-account" } }), requestId: "waiting-lead" })).agentId as string;
    yield* seedAgent({ id: "child", parent: leadId, folder: rig.work });
    postId = (yield* client["board.post"]!({ requestId: "lead-obligation", direct: { _tag: "agent", agentId: leadId },
      to: [{ _tag: "agent", agentId: leadId }], reply: "all", text: "Answer this assignment." })).postId as string;
    const busy = yield* eventually(current, snapshot => snapshot.agents[leadId]?.state._tag === "working");
    expect(busy.agents[leadId]?.state._tag).toBe("working");
    yield* appendSetup([
      ...Object.values(busy.deliveries).filter(row => row.target === leadId && row.status === "sent")
        .map(row => eventOf({ _tag: "DeliveryAccepted", agentId: leadId, deliveryId: row.id })),
      eventOf({ _tag: "TurnEnded", agentId: leadId, compact: false }),
    ]);
    const key = stallKey(postId, leadId);
    const oldOrigin = (yield* roles).stalls[key]!.originSequence;
    expect(oldOrigin).toBeDefined();
    yield* TestClock.adjust("9 minutes");
    if (recovery === "account") yield* appendSetup([eventOf({ _tag: "AccountOutOfUsage", accountId: "primary" })]);
    else yield* appendSetup([eventOf({ _tag: "PermissionRequested", agentId: "child", permissionRequestId: "blocked-child", holder: { _tag: "agent", agentId: leadId },
      deliveryId: "child-question", toolCallId: "write-file", description: "Write a file.", settingsWrite: false,
      options: [{ id: "once", name: "Once", kind: "allow_once", level: "ask", persistent: false }] })]);
    expect((yield* current).agents[leadId]?.state._tag).toBe("idle");
    expect((yield* current).accounts["lead-account"]?.status).toBe("available");
    expect((yield* roles).stalls[key]!.originSequence).toBeUndefined();
    yield* TestClock.adjust("30 minutes"); yield* pause(30);
    expect((yield* roles).actions.filter(row => row._tag === "roles.StallSeen")).toHaveLength(0);
    if (recovery === "account") {
      const [row] = yield* appendSetup([eventOf({ _tag: "AccountAvailable", accountId: "primary", cause: "owner cleared" })]);
      originSequence = row!.sequence;
    } else {
      yield* client.stop!({ requestId: "stop-asker", agentId: "child" });
      const cancellation = (yield* alertLog).find(row => row.event._tag === "PermissionCancelled" && row.event.permissionRequestId === "blocked-child");
      expect(cancellation).toBeDefined();
      expect((yield* current).requests["blocked-child"]?.status).toBe("cancelled");
      expect((yield* current).agents.child?.state._tag).toBe("stopped");
      originSequence = cancellation!.sequence;
    }
    expect((yield* roles).stalls[key]!.originSequence).toBe(originSequence);
    expect(originSequence).toBeGreaterThan(oldOrigin!);
  }));
  yield* run(lists, Effect.gen(function* () {
    expect((yield* roles).stalls[stallKey(postId, leadId)]!.originSequence).toBe(originSequence);
    yield* TestClock.adjust(1_199_999); yield* pause(30);
    expect((yield* roles).actions.filter(row => row._tag === "roles.StallSeen")).toHaveLength(0);
    yield* TestClock.adjust(1);
    const nudged = yield* eventually(roles, view => view.actions.some(row => row._tag === "roles.StallSeen" && row.agentId === leadId));
    expect(nudged.actions.filter(row => row._tag === "roles.StallSeen")).toMatchObject([{ agentId: leadId, stalledPostId: postId, occurrence: 1, triggerSequence: originSequence }]);
  }));
}));

it.effect("a reciprocal idle wait group stays live until the production team-idle timer reports its full hour", () => Effect.gen(function* () {
  let obligations: string[] = [];
  const cycleLists = { ...lists, planners: { ...lists.planners, "board.flush": () => Effect.fail(refused()) } };
  yield* run(cycleLists, Effect.gen(function* () {
    yield* seedAccount(); yield* seedHarness();
    yield* seedAgent({ id: "a", groups: ["cycle"], folder: rig.work });
    yield* seedAgent({ id: "b", groups: ["cycle"], folder: rig.work });
    const client = yield* socket(cycleLists);
    for (const [author, target] of [["a", "b"], ["b", "a"]]) {
      const row = yield* appendSetup([eventOf({ _tag: "board.ChannelOpened", channelId: `from-${author}`, name: `From-${author}`, kind: "plain",
        opener: { _tag: "owner" }, manager: { _tag: "owner" }, members: [{ _tag: "agent", agentId: author }, { _tag: "agent", agentId: target }] }),
        eventOf({ _tag: "board.PostWritten", postId: `owed-${target}`, channelId: `from-${author}`, author: { _tag: "agent", agentId: author },
          to: [{ _tag: "agent", agentId: target }], reply: "all", text: "Please answer." })]);
      obligations.push((row[1]!.event as { postId: string }).postId);
    }
    // Stall notices do not remove either obligation or count as new work.
    yield* client["roles.snooze"]!({ requestId: "arm-cycle", group: "other", until: 0 });
    yield* pause(50);
    yield* TestClock.adjust("30 minutes");
    expect((yield* roles).actions.filter(row => row._tag === "roles.TeamIdleReported")).toHaveLength(0);
  }));
  yield* run(cycleLists, Effect.gen(function* () {
    yield* TestClock.adjust("29 minutes"); yield* pause(30);
    expect((yield* roles).actions.filter(row => row._tag === "roles.TeamIdleReported")).toHaveLength(0);
    yield* TestClock.adjust("1 minute");
    const reported = yield* eventually(roles, view => view.actions.filter(row => row._tag === "roles.TeamIdleReported").length === 2);
    expect(reported.actions.filter(row => row._tag === "roles.TeamIdleReported").map(row => row.agentId).sort()).toEqual(["a", "b"]);
    const board = (yield* current).board as { posts: Record<string, { status: string }> };
    expect(obligations.map(id => board.posts[id]?.status)).toEqual(["open", "open"]);
  }));
}));
