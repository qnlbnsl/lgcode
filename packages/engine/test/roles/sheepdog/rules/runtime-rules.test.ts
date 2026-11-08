import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { it } from "@effect/vitest";
import * as SqliteClient from "@lgcode/t3-node-sqlite/nodeSqliteClient";
import type { BoardView } from "@lgcode/contracts/board/view";
import type { RolesActionRecord } from "@lgcode/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";
import { TestClock } from "effect/testing";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { serve } from "../../../../src/api/server.ts";
import { executeService } from "../../../../src/commands/services.ts";
import { refused } from "../../../../src/commands/internal.ts";
import { engineLists, type EngineLists } from "../../../../src/pieces/lists.ts";
import { layer as redactor } from "../../../../src/log/Redactor.ts";
import { buildServices } from "../../../../src/service.ts";
import type { RolesView } from "../../../../src/roles/view.ts";
import { makeSheepdogLoop, type SheepdogRule } from "../../../../src/roles/sheepdog/loop.ts";
import { makeRules } from "../../../../src/roles/sheepdog/rules/runtime.ts";
import { reloadedEvents } from "../../../../src/recovery/reload.ts";
import { callForAction } from "../../../../src/roles/sheepdog/actions.ts";
import { deliveryIsSheepdogTurn, sheepdogCaller } from "../../../../src/roles/sheepdog/notices.ts";
import { actionRequestId } from "../../../../src/roles/sheepdog/requests.ts";
import { alertLog } from "../../../support/alertsRig.ts";
import { fixtureClient } from "../../../support/fixturePiece.ts";
import { makeFakeRunner, sessionFor, type FakeRunner } from "../../../support/fakeRunner.ts";
import { appendSetup, eventOf, makeFakeSecrets, makeRig, removeRig, seedAccount, seedAgent, seedHarness, startPayload, type Rig } from "../../../support/handlerRig.ts";
import { eventually, pause, snapshot } from "../../../support/routingRig.ts";
import { registerRebuildCheck } from "../../../support/rebuildCheck.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("LGCODE_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });
const quiet: EngineLists = { ...engineLists, reactors: {} };
const roles = snapshot.pipe(Effect.map((view) => view.roles as RolesView));
const actions = (tag: string) => roles.pipe(Effect.map((view) => view.actions.filter((action) => action._tag === tag)));
const run = <A, E, R>(lists: EngineLists, body: (runner: FakeRunner) => Effect.Effect<A, E, R>) => Effect.gen(function* () {
  const runner = yield* makeFakeRunner();
  return yield* Effect.scoped(Effect.gen(function* () {
    yield* registerRebuildCheck();
    return yield* body(runner);
  })).pipe(Effect.provide(buildServices(rig, lists).pipe(Layer.provide(Layer.mergeAll(runner.layer, makeFakeSecrets().layer, redactor)))), Effect.provide(runner.layer));
}).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped) as Effect.Effect<A, E>;
const socket = (lists = engineLists) => Effect.gen(function* () {
  const bearer = randomBytes(32).toString("base64url");
  const socketPath = join(rig.stateFolder, "rules.sock");
  yield* serve({ socketPath, ownerCredential: Redacted.make(bearer), debug: true, lists });
  return yield* fixtureClient(socketPath, bearer, lists as any);
});
const setup = Effect.gen(function* () {
  yield* seedAccount(); yield* seedHarness();
  yield* eventually(roles, (view) => view.baseline !== undefined);
});
const rowsOf = (tag: string) => alertLog.pipe(Effect.map((rows) => rows.filter((row) => row.event._tag === tag)));

it.effect("idle groups nudge every top, share one holder notice, and repeat hourly through sheepdog turns", () => run(engineLists, () => Effect.gen(function* () {
  yield* setup;
  yield* seedAgent({ id: "holder", state: "idle" });
  yield* seedAgent({ id: "top-a", parent: "holder", groups: ["build"] });
  yield* seedAgent({ id: "top-b", parent: "holder", groups: ["build"] });
  const client = yield* socket();
  yield* client["roles.snooze"]!({ requestId: "arm", group: "other", until: 0 });
  yield* pause(100);
  yield* TestClock.adjust("60 minutes");
  expect(yield* eventually(actions("roles.TeamIdleReported"), (rows) => rows.length === 2)).toHaveLength(2);
  const posts = (yield* rowsOf("board.PostWritten")).filter((row) => row.event._tag === "board.PostWritten" && row.event.text.includes("team has no running work"));
  expect(posts).toHaveLength(3);
  const targets = (yield* rowsOf("DeliveryQueued")).flatMap((row) => row.event._tag === "DeliveryQueued"
    && row.event.delivery.sender._tag === "service" ? [row.event.delivery.target] : []);
  expect(targets).toEqual([]);
  yield* TestClock.adjust("60 minutes");
  const repeats = yield* eventually(actions("roles.TeamIdleReported"), (rows) => rows.length === 4);
  expect(repeats.map((row) => row.occurrence)).toEqual([1, 1, 2, 2]);
  const repeatedPosts = (yield* rowsOf("board.PostWritten")).filter((row) => row.event._tag === "board.PostWritten" && row.event.text.includes("team has no running work"));
  expect(repeatedPosts).toHaveLength(6);
})));

it.effect("a supported 300 KiB group produces a persisted idle action that pages whole before older normal records", () => run(engineLists, () => Effect.gen(function* () {
  yield* setup;
  const client = yield* socket();
  const started = yield* client.start!({ ...startPayload(rig, { role: "lead", groups: ["normal"] }), requestId: "large-group-start" });
  const agentId = started.agentId as string;
  yield* pause(100);
  yield* TestClock.adjust("60 minutes");
  const normal = yield* eventually(actions("roles.TeamIdleReported"), (rows) => rows.some((row) => row.agentId === agentId));
  expect(normal.filter((row) => row.agentId === agentId)).toHaveLength(1);
  const group = "group-" + "界".repeat(100 * 1024);
  yield* client.group!({ requestId: "large-group-assign", agentId, add: [group], remove: ["normal"] });
  yield* pause(100);
  yield* TestClock.adjust("60 minutes");
  const recorded = yield* eventually(actions("roles.TeamIdleReported"), (rows) => rows.some((row) => row._tag === "roles.TeamIdleReported" && row.group === group));
  const oversized = recorded.find((row) => row._tag === "roles.TeamIdleReported" && row.group === group)!;
  expect(oversized.agentId).toBe(agentId);
  expect(Buffer.byteLength(JSON.stringify(oversized))).toBeGreaterThan(256 * 1024);
  const persisted = (yield* alertLog).find((row) => row.sequence === oversized.sequence);
  expect(persisted?.event._tag).toBe("roles.TeamIdleReported");
  expect(persisted?.event._tag === "roles.TeamIdleReported" && persisted.event.group === group).toBe(true);
  const first = yield* client["roles.actions.list"]!({ requestId: "large-group-page", agentId, limit: 500 });
  expect((first.items as any[])).toHaveLength(1);
  expect((first.items as any[])[0].sequence).toBe(oversized.sequence);
  expect((first.items as any[])[0].group === group).toBe(true);
  expect(first.next).toBe(oversized.sequence);
  const last = yield* client["roles.actions.list"]!({ requestId: "large-group-rest", agentId, after: first.next, limit: 500 });
  expect((last.items as any[]).map((row) => row.sequence)).toEqual(normal.filter((row) => row.agentId === agentId).map((row) => row.sequence).toReversed());
  expect(last).not.toHaveProperty("next");
  expect((yield* client["roles.actions.list"]!({ requestId: "large-group-unrelated", agentId: "unrelated", limit: 500 })).items).toEqual([]);
})));

it.effect("an unknown account reset suppresses idleness and account recovery restarts the whole hour", () => run(engineLists, () => Effect.gen(function* () {
  yield* setup;
  yield* seedAgent({ id: "top", groups: ["build"] });
  yield* pause(100);
  yield* TestClock.adjust("30 minutes");
  yield* appendSetup([eventOf({ _tag: "AccountOutOfUsage", accountId: "primary" })]);
  yield* pause(100);
  yield* TestClock.adjust("90 minutes");
  expect(yield* actions("roles.TeamIdleReported")).toHaveLength(0);
  yield* appendSetup([eventOf({ _tag: "AccountAvailable", accountId: "primary", cause: "owner cleared" })]);
  yield* pause(100);
  yield* TestClock.adjust("59 minutes");
  expect(yield* actions("roles.TeamIdleReported")).toHaveLength(0);
  yield* TestClock.adjust("1 minute");
  expect(yield* eventually(actions("roles.TeamIdleReported"), (rows) => rows.length > 0)).toHaveLength(1);
})));

it.effect("a running turn subtracts completed permission holds and reports only once", () => run(engineLists, () => Effect.gen(function* () {
  yield* setup;
  const client = yield* socket();
  const started = yield* client.start!({ ...startPayload(rig, { role: "lead", groups: [] }), requestId: "lead" });
  const agentId = started.agentId as string;
  yield* client.prompt!({ requestId: "work", agentId, text: "Do the assigned work." });
  yield* pause(100);
  yield* TestClock.adjust("60 minutes");
  yield* appendSetup([eventOf({ _tag: "PermissionRequested", agentId, permissionRequestId: "hold", holder: { _tag: "owner" },
    deliveryId: "held-request", toolCallId: "tool", description: "Write a file.", settingsWrite: false,
    options: [{ id: "once", name: "Once", kind: "allow_once", level: "ask", persistent: false }] })]);
  yield* pause(100);
  yield* TestClock.adjust("90 minutes");
  expect(yield* actions("roles.RunawayReported")).toHaveLength(0);
  yield* appendSetup([eventOf({ _tag: "PermissionCancelled", agentId, permissionRequestId: "hold", reason: "test closed" })]);
  yield* pause(100);
  yield* TestClock.adjust("60 minutes");
  expect(yield* actions("roles.RunawayReported")).toHaveLength(0);
  yield* TestClock.adjust(1);
  expect(yield* eventually(actions("roles.RunawayReported"), (rows) => rows.length > 0)).toHaveLength(1);
  yield* TestClock.adjust("180 minutes");
  expect(yield* actions("roles.RunawayReported")).toHaveLength(1);
})));

it.effect("a current crash admits, reloads, carries on, and a second crash gives up without reloading", () => run(engineLists, (runner) => Effect.gen(function* () {
  yield* setup;
  const client = yield* socket();
  const started = yield* client.start!({ ...startPayload(rig, { groups: [] }), requestId: "worker" });
  const agentId = started.agentId as string;
  yield* appendSetup([eventOf({ _tag: "AgentCrashed", agentId, exitCode: 1, signal: null, stderr: "untrusted crash detail" })]);
  expect(yield* eventually(actions("roles.CrashRetried"), (rows) => rows.length > 0)).toHaveLength(1);
  expect(runner.callsOf("load")).toHaveLength(1);
  const rows = yield* alertLog;
  expect(rows.findIndex((row) => row.event._tag === "roles.CrashAdmitted")).toBeLessThan(rows.findLastIndex((row) => row.event._tag === "SessionOpened"));
  expect(rows.filter((row) => row.event._tag === "DeliveryQueued" && row.caller._tag === "service")).toHaveLength(1);
  yield* appendSetup([eventOf({ _tag: "AgentCrashed", agentId, exitCode: 1, signal: null, stderr: "second detail" })]);
  expect(yield* eventually(actions("roles.GaveUp"), (rows) => rows.length > 0)).toHaveLength(1);
  expect(runner.callsOf("load")).toHaveLength(1);
})));

it.effect("switching the sheepdog back on restarts a runaway clock from its new baseline", () => run(engineLists, () => Effect.gen(function* () {
  yield* setup;
  const client = yield* socket();
  const started = yield* client.start!({ ...startPayload(rig, { role: "lead", groups: [] }), requestId: "lead" });
  yield* client.prompt!({ requestId: "work", agentId: started.agentId, text: "Do the assigned work." });
  yield* pause(100);
  yield* TestClock.adjust("90 minutes");
  yield* client["roles.settings.set"]!({ requestId: "off", settings: { sheepdog: false } });
  expect((yield* eventually(roles, (view) => view.baseline?.on === false)).baseline?.on).toBe(false);
  yield* TestClock.adjust("180 minutes");
  expect(yield* actions("roles.RunawayReported")).toHaveLength(0);
  yield* client["roles.settings.set"]!({ requestId: "on", settings: { sheepdog: true } });
  expect((yield* eventually(roles, (view) => view.baseline?.on === true)).baseline?.on).toBe(true);
  yield* pause(100);
  yield* TestClock.adjust("119 minutes");
  expect(yield* actions("roles.RunawayReported")).toHaveLength(0);
  yield* TestClock.adjust(60_001);
  expect(yield* eventually(actions("roles.RunawayReported"), (rows) => rows.length > 0)).toHaveLength(1);
})));

it.effect("a refused crash admission never resumes the agent", () => {
  const real = engineLists.planners["roles.record"]!;
  const attempts: Array<{ readonly caller: unknown; readonly payload: Record<string, unknown> }> = [];
  const lists: EngineLists = { ...engineLists, planners: { ...engineLists.planners, "roles.record": (input, payload) =>
    (payload.action as { _tag: string })._tag === "roles.CrashAdmitted"
      ? Effect.sync(() => { attempts.push({ caller: input.actor, payload }); }).pipe(Effect.andThen(Effect.fail(refused())))
      : real(input, payload) } };
  return run(lists, (runner) => Effect.gen(function* () {
    yield* setup;
    yield* seedAgent({ id: "worker", state: "idle" });
    const [crash] = yield* appendSetup([eventOf({ _tag: "AgentCrashed", agentId: "worker", exitCode: 1, signal: null, stderr: "detail" })]);
    const requestId = actionRequestId({ rule: "crash", subject: "worker", triggerSequence: crash!.sequence,
      kind: "roles.CrashAdmitted.record", recipient: "owner", occurrence: 1 });
    const refusals = yield* eventually(rowsOf("CommandRefused"), (rows) => rows.some((row) => row.requestId === requestId));
    expect(refusals.filter((row) => row.requestId === requestId)).toMatchObject([
      { caller: sheepdogCaller, event: { _tag: "CommandRefused", command: "roles.record" } },
    ]);
    expect(attempts).toMatchObject([{ caller: sheepdogCaller, payload: { requestId,
      action: { _tag: "roles.CrashAdmitted", agentId: "worker", triggerSequence: crash!.sequence, occurrence: 1 } } }]);
    expect(attempts).toHaveLength(1);
    expect(runner.callsOf("load")).toHaveLength(0);
    expect(yield* actions("roles.CrashAdmitted")).toHaveLength(0);
  }));
});

for (const boundary of ["admitted", "opened", "carried", "stopped", "disabled", "crashed-again"] as const) {
  it.effect(`crash recovery restarts safely after the ${boundary} boundary`, () => Effect.gen(function* () {
    let admission: RolesActionRecord;
    yield* run(quiet, () => Effect.gen(function* () {
      yield* seedAccount(); yield* seedHarness();
      yield* seedAgent({ id: "worker", state: "idle", folder: rig.work });
      const [crash] = yield* appendSetup([eventOf({ _tag: "AgentCrashed", agentId: "worker", exitCode: 1, signal: null, stderr: "detail" })]);
      yield* executeService(sheepdogCaller, "roles.record", { requestId: "baseline", action: { _tag: "roles.SheepdogBaseline", position: crash!.sequence, on: true } });
      yield* executeService(sheepdogCaller, "roles.record", { requestId: "admission", action: { _tag: "roles.CrashAdmitted", agentId: "worker", noticeRecipient: "owner",
        triggerSequence: crash!.sequence, sourceSequence: crash!.sequence, occurrence: 1, notice: "sent" } });
      admission = (yield* roles).agents.worker!.openCrash!;
      if (boundary === "opened" || boundary === "carried") yield* callForAction(admission, "crash", "resume", {}, quiet);
      if (boundary === "carried") yield* callForAction(admission, "crash", "prompt", { text: "You were resumed after a crash. Carry on with what you were doing." }, quiet);
      if (boundary === "stopped") yield* appendSetup([eventOf({ _tag: "AgentStopped", agentId: "worker" })]);
      if (boundary === "crashed-again") {
        yield* callForAction(admission, "crash", "resume", {}, quiet);
        yield* appendSetup([eventOf({ _tag: "AgentCrashed", agentId: "worker", exitCode: 1, signal: null, stderr: "second detail" })]);
      }
      if (boundary === "disabled") yield* executeService(sheepdogCaller, "roles.record", { requestId: "off-baseline", action: { _tag: "roles.SheepdogBaseline", position: (yield* snapshot).sequence, on: false } });
    }));
    yield* run(engineLists, (runner) => Effect.gen(function* () {
      if (boundary === "crashed-again") {
        expect(yield* eventually(actions("roles.GaveUp"), (rows) => rows.length > 0)).toHaveLength(1);
        yield* pause(100);
        expect(yield* actions("roles.GaveUp")).toHaveLength(1);
        expect(runner.callsOf("load")).toHaveLength(0);
        expect((yield* roles).agents.worker!.openCrash).toBeUndefined();
        return;
      }
      if (boundary === "stopped" || boundary === "disabled") {
        yield* pause(200);
        expect(yield* actions("roles.CrashRetried")).toHaveLength(0);
        expect(runner.callsOf("load")).toHaveLength(0);
        return;
      }
      expect(yield* eventually(actions("roles.CrashRetried"), (rows) => rows.length > 0)).toHaveLength(1);
      expect(runner.callsOf("load")).toHaveLength(boundary === "admitted" ? 1 : 0);
      const prompts = (yield* rowsOf("DeliveryQueued")).filter((row) => row.event._tag === "DeliveryQueued" && row.caller._tag === "service");
      expect(prompts).toHaveLength(1);
      expect((yield* roles).agents.worker!.openCrash).toBeUndefined();
    }));
  }));
}

it.effect("a missed idle deadline is checked once on restart and then waits another hour", () => Effect.gen(function* () {
  yield* run(quiet, () => Effect.gen(function* () {
    yield* seedAccount(); yield* seedHarness(); yield* seedAgent({ id: "top", groups: ["build"] });
    yield* executeService(sheepdogCaller, "roles.record", { requestId: "idle-baseline", action: {
      _tag: "roles.SheepdogBaseline", position: (yield* snapshot).sequence, on: true,
    } });
  }));
  yield* TestClock.adjust("90 minutes");
  yield* run(engineLists, () => Effect.gen(function* () {
    expect(yield* eventually(actions("roles.TeamIdleReported"), (rows) => rows.length > 0)).toHaveLength(1);
    yield* pause(100);
    expect(yield* actions("roles.TeamIdleReported")).toHaveLength(1);
    yield* TestClock.adjust("59 minutes");
    expect(yield* actions("roles.TeamIdleReported")).toHaveLength(1);
    yield* TestClock.adjust("1 minute");
    expect(yield* eventually(actions("roles.TeamIdleReported"), (rows) => rows.length > 1)).toHaveLength(2);
  }));
}));

it.effect("role advice reports each break kind once through authenticated agent commands and a restart", () => Effect.gen(function* () {
  let bearer: string;
  for (const attempt of [1, 2]) yield* run(engineLists, () => Effect.gen(function* () {
    if (attempt === 1) {
      yield* setup;
      bearer = (yield* seedAgent({ id: "worker", groups: [] })).token;
    }
    const socketPath = join(rig.stateFolder, "advice.sock");
    yield* serve({ socketPath, ownerCredential: Redacted.make(randomBytes(32).toString("base64url")), debug: true, lists: engineLists });
    const client = yield* fixtureClient(socketPath, bearer!, engineLists as any);
    yield* client.start!({ ...startPayload(rig, { groups: [] }), requestId: `child-${attempt}` });
    expect(yield* eventually(actions("roles.RoleAdviceBroken"), (rows) => rows.length > 0)).toHaveLength(1);
    yield* pause(100);
    expect(yield* actions("roles.RoleAdviceBroken")).toHaveLength(1);
  }));
}));

for (const whileOff of [false, true]) {
  for (const kind of ["advice", "crash"] as const) {
    it.effect(`lagging production ${kind} rules ${whileOff ? "skip while-off events after enable" : "finish eligible events before off"}`, () => run(quiet, (runner) => Effect.gen(function* () {
      yield* seedAccount(); yield* seedHarness();
      const worker = yield* seedAgent({ id: "worker", folder: rig.work, groups: [] });
      const client = yield* socket(quiet);
      const agentClient = yield* fixtureClient(join(rig.stateFolder, "rules.sock"), worker.token, quiet as any);
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const finished = yield* Deferred.make<void>();
      // Stop the consumer ahead of the trigger without holding the writer or
      // Views. The production rules must refresh a snapshot past the switch.
      const barrier: SheepdogRule = { onEvent: (_context, envelope) => Effect.gen(function* () {
        if (envelope.event._tag !== "roles.Snoozed" || envelope.event.group !== "hold") return;
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
      }) };
      const observer: SheepdogRule = { onEvent: (_context, envelope) => Effect.gen(function* () {
        if (envelope.event._tag === "roles.Snoozed" && envelope.event.group === "finished") yield* Deferred.succeed(finished, undefined);
      }) };
      const loop = yield* makeSheepdogLoop([barrier, ...makeRules(), observer]).pipe(Effect.forkScoped);
      yield* eventually(roles, (view) => view.baseline !== undefined);
      yield* client["roles.snooze"]!({ requestId: "hold", group: "hold", until: 0 });
      yield* Deferred.await(entered);
      if (whileOff) yield* client["roles.settings.set"]!({ requestId: "off", settings: { sheepdog: false } });
      if (kind === "advice") yield* agentClient.start!({ ...startPayload(rig, { groups: [] }), requestId: "child" });
      else yield* appendSetup([eventOf({ _tag: "AgentCrashed", agentId: worker.agentId, exitCode: 1, signal: null, stderr: "detail" })]);
      const trigger = (yield* alertLog).findLast((row) => kind === "advice"
        ? row.event._tag === "AgentStarted" && row.caller._tag === "agent"
        : row.event._tag === "AgentCrashed")!;
      yield* client["roles.settings.set"]!({ requestId: whileOff ? "on" : "off", settings: { sheepdog: whileOff } });
      expect((yield* roles).settings?.sheepdog).toBe(whileOff);
      yield* Deferred.succeed(release, undefined);
      // A later enabled marker proves all queued events have been consumed.
      if (whileOff) {
        yield* client["roles.snooze"]!({ requestId: "finished", group: "finished", until: 0 });
        yield* Deferred.await(finished);
      } else expect((yield* eventually(roles, (view) => view.baseline?.on === false)).baseline?.on).toBe(false);
      const tag = kind === "advice" ? "roles.RoleAdviceBroken" : "roles.CrashRetried";
      const records = whileOff ? yield* actions(tag) : yield* eventually(actions(tag), (rows) => rows.length > 0);
      expect(records).toHaveLength(whileOff ? 0 : 1);
      if (!whileOff) expect(records[0]).toMatchObject({ agentId: worker.agentId, triggerSequence: trigger.sequence });
      if (kind === "crash") {
        expect(yield* actions("roles.CrashAdmitted")).toHaveLength(whileOff ? 0 : 1);
        expect(runner.callsOf("load")).toHaveLength(whileOff ? 0 : 1);
        const carries = (yield* rowsOf("DeliveryQueued")).filter((row) => row.event._tag === "DeliveryQueued" && row.event.delivery.target === worker.agentId && row.caller._tag === "service");
        expect(carries).toHaveLength(whileOff ? 0 : 1);
      }
      yield* Fiber.interrupt(loop);
    })));
  }
}

it.effect("FR-019 idle tops receive direct board nudges and flushes, independently of shared holder receipts", () => run(engineLists, () => Effect.gen(function* () {
  yield* setup;
  yield* seedAgent({ id: "holder" });
  yield* seedAgent({ id: "top-a", parent: "holder", groups: ["build"] });
  yield* seedAgent({ id: "top-b", parent: "holder", groups: ["build"] });
  yield* seedAgent({ id: "owner-top", groups: ["build"] });
  yield* pause(100);
  yield* TestClock.adjust("60 minutes");
  const reports = yield* eventually(actions("roles.TeamIdleReported"), (rows) => rows.length === 3);
  const posts = (yield* rowsOf("board.PostWritten")).filter((row) => row.event._tag === "board.PostWritten" && row.event.author._tag === "service");
  expect(posts.map((row) => row.event._tag === "board.PostWritten" ? row.event.to : []).flat()
    .map((party) => party._tag === "agent" ? party.agentId : "owner").sort()).toEqual(["holder", "owner-top", "top-a", "top-b"]);
  for (const row of posts) {
    expect(row.event).toMatchObject({ author: sheepdogCaller, reply: "none" });
    if (row.event._tag === "board.PostWritten") expect(((yield* snapshot).board as BoardView).channels[row.event.channelId]?.kind).toBe("direct");
  }
  expect(reports.filter((row) => row.noticeRecipient === "holder").map((row) => row.postId)).toEqual([reports[0]!.postId, reports[0]!.postId]);
  expect(reports.find((row) => row.agentId === "owner-top")).toMatchObject({ noticeRecipient: "owner", notice: "sent" });
  const sql = yield* SqlClient.SqlClient;
  const receipts = yield* sql<{ request_id: string }>`SELECT request_id FROM receipts WHERE request_id LIKE ${"%roles.TeamIdleReported%flush%"}`;
  expect(receipts.filter((row) => row.request_id.includes(".nudge.flush:")).map((row) => row.request_id.split(":").at(-2)).sort()).toEqual(["owner-top", "top-a", "top-b"]);
  expect(receipts.filter((row) => row.request_id.includes(".flush:holder:"))).toHaveLength(1);
  const wakes = yield* eventually(rowsOf("board.WakeBuilt"), (rows) => rows.length === 4);
  expect(wakes.map((row) => row.event._tag === "board.WakeBuilt" ? row.event.targetAgentId : "").sort()).toEqual(["holder", "owner-top", "top-a", "top-b"]);
  const live = yield* snapshot;
  const deliveries = Object.values(live.deliveries).filter((row) => row.source?._tag === "piece" && row.source.namespace === "board");
  expect(deliveries).toHaveLength(4);
  for (const delivery of deliveries) expect(deliveryIsSheepdogTurn(live, delivery.id)).toBe(true);
  expect((yield* rowsOf("DeliveryQueued")).filter((row) => row.event._tag === "DeliveryQueued" && row.event.delivery.sender._tag === "service" && row.event.delivery.sender.service === "roles.sheepdog")).toHaveLength(0);
})));
it.effect("FR-044 an open admission recognizes engine C1 preserved across S2 and a sheepdog restart", () => Effect.gen(function* () {
  let carryId: string;
  yield* run(quiet, () => Effect.gen(function* () {
    yield* seedAccount(); yield* seedHarness();
    const worker = yield* seedAgent({ id: "worker", folder: rig.work });
    const [crash] = yield* appendSetup([eventOf({ _tag: "AgentCrashed", agentId: "worker", exitCode: 1, signal: null, stderr: "detail" })]);
    yield* executeService(sheepdogCaller, "roles.record", { requestId: "baseline-c1", action: { _tag: "roles.SheepdogBaseline", position: crash!.sequence, on: true } });
    yield* executeService(sheepdogCaller, "roles.record", { requestId: "admission-c1", action: { _tag: "roles.CrashAdmitted", agentId: "worker", noticeRecipient: "owner",
      triggerSequence: crash!.sequence, sourceSequence: crash!.sequence, occurrence: 1, notice: "sent" } });
    const admission = (yield* roles).agents.worker!.openCrash!;
    yield* callForAction(admission, "crash", "resume", {}, quiet);
    const client = yield* socket(quiet);
    const prompt = yield* client.prompt!({ requestId: "owner-work-before-closure", agentId: "worker", text: "Continue the assigned work." });
    yield* appendSetup([
      eventOf({ _tag: "DeliverySent", agentId: "worker", deliveryId: prompt.deliveryId, method: "acp" }),
      eventOf({ _tag: "DeliveryAccepted", agentId: "worker", deliveryId: prompt.deliveryId }),
      eventOf({ _tag: "StateChanged", agentId: "worker", state: { _tag: "working" } }),
      eventOf({ _tag: "AgentInterrupted", agentId: "worker", previous: "working" }),
    ]);
    // Use the engine's reload transaction builder, rather than inventing C1.
    yield* appendSetup(reloadedEvents(yield* snapshot, worker.agentId, sessionFor(worker.agentId), true, "Carry on."));
    const first = Object.values((yield* snapshot).deliveries).filter((row) => row.content._tag === "carry-on");
    expect(first).toHaveLength(1);
    carryId = first[0]!.id;
    yield* appendSetup([eventOf({ _tag: "AgentInterrupted", agentId: "worker", previous: "working" })]);
    yield* appendSetup(reloadedEvents(yield* snapshot, worker.agentId, sessionFor(worker.agentId), true, "Carry on."));
    expect(Object.values((yield* snapshot).deliveries).filter((row) => row.content._tag === "carry-on").map((row) => row.id)).toEqual([carryId]);
    expect((yield* roles).agents.worker!.openCrash).toBeDefined();
  }));
  for (let restart = 0; restart < 2; restart++) yield* run(engineLists, () => Effect.gen(function* () {
    expect(yield* eventually(actions("roles.CrashRetried"), (rows) => rows.length > 0)).toHaveLength(1);
    yield* pause(100);
    const queued = (yield* rowsOf("DeliveryQueued")).filter((row) => row.event._tag === "DeliveryQueued" && row.event.delivery.target === "worker");
    expect(queued).toHaveLength(2); // Owner work plus the single engine C1.
    expect(queued.filter((row) => row.caller._tag === "service")).toHaveLength(0);
    expect(Object.values((yield* snapshot).deliveries).filter((row) => row.content._tag === "carry-on").map((row) => row.id)).toEqual([carryId!]);
    expect((yield* roles).agents.worker!.openCrash).toBeUndefined();
  }));
}));

it.effect("FR-019 idle board nudges respect snooze and restart without duplicate posts", () => Effect.gen(function* () {
  yield* run(engineLists, () => Effect.gen(function* () {
    yield* setup;
    yield* seedAgent({ id: "top", groups: ["build"] });
    const client = yield* socket();
    yield* client["roles.snooze"]!({ requestId: "snooze-build", group: "build", until: 2 * 60 * 60_000 });
    yield* pause(100);
    yield* TestClock.adjust("60 minutes");
    expect(yield* actions("roles.TeamIdleReported")).toHaveLength(0);
    expect(yield* rowsOf("board.PostWritten")).toHaveLength(0);
    yield* TestClock.adjust("60 minutes");
    expect(yield* eventually(actions("roles.TeamIdleReported"), (rows) => rows.length > 0)).toHaveLength(1);
    expect(yield* rowsOf("board.PostWritten")).toHaveLength(1);
    expect(yield* rowsOf("board.WakeBuilt")).toHaveLength(1);
  }));
  yield* run(engineLists, () => Effect.gen(function* () {
    yield* pause(100);
    expect(yield* actions("roles.TeamIdleReported")).toHaveLength(1);
    expect(yield* rowsOf("board.PostWritten")).toHaveLength(1);
    expect(yield* rowsOf("board.WakeBuilt")).toHaveLength(1);
    yield* TestClock.adjust("60 minutes");
    expect(yield* eventually(actions("roles.TeamIdleReported"), (rows) => rows.length > 1)).toHaveLength(2);
    expect(yield* rowsOf("board.PostWritten")).toHaveLength(2);
  }));
}));
it.effect("FR-019 disabled board suppresses both top nudges and holder reports", () => run({ ...engineLists, boardEnabled: false }, () => Effect.gen(function* () {
  yield* setup;
  yield* seedAgent({ id: "holder" });
  yield* seedAgent({ id: "top", parent: "holder", groups: ["build"] });
  yield* pause(100);
  yield* TestClock.adjust("120 minutes");
  yield* pause(100);
  expect(yield* actions("roles.TeamIdleReported")).toHaveLength(0);
  expect(yield* rowsOf("board.PostWritten")).toHaveLength(0);
  expect(yield* rowsOf("board.WakeBuilt")).toHaveLength(0);
  expect(yield* rowsOf("DeliveryQueued")).toHaveLength(0);
})));
it.effect("advice deduplication reconstructs agent/kind keys while distinct workers and kinds stay eligible", () => Effect.gen(function* () {
  const tokens: Record<string, string> = {};
  for (const attempt of [1, 2, 3]) {
    const marker = `advice-finished-${attempt}`;
    let finished = false;
    const observer: SheepdogRule = { onEvent: (_context, envelope) => Effect.sync(() => {
      if (envelope.event._tag === "roles.Snoozed" && envelope.event.group === marker) finished = true;
    }) };
    const configured = { ...engineLists, reactors: { ...engineLists.reactors, roles: makeSheepdogLoop([...makeRules(), observer]) } };
    yield* run(configured, () => Effect.gen(function* () {
      if (attempt === 1) {
        yield* setup;
        tokens.worker = (yield* seedAgent({ id: "worker", folder: rig.work, groups: [] })).token;
        tokens.asker = (yield* seedAgent({ id: "asker", parent: "worker", folder: rig.work, groups: [] })).token;
      }
      if (attempt === 2) tokens.other = (yield* seedAgent({ id: "other", folder: rig.work, groups: [] })).token;
      const socketPath = join(rig.stateFolder, "advice-matrix.sock");
      yield* serve({ socketPath, ownerCredential: Redacted.make(randomBytes(32).toString("base64url")), debug: true, lists: engineLists });
      const worker = yield* fixtureClient(socketPath, tokens.worker!, engineLists as any);
      const asker = yield* fixtureClient(socketPath, tokens.asker!, engineLists as any);
      const before = attempt === 1 ? 0 : attempt === 2 ? 2 : 5;
      yield* worker.start!({ ...startPayload(rig, { groups: [] }), requestId: `matrix-child-${attempt}` });
      yield* worker["board.post"]!({ requestId: `matrix-owner-${attempt}`, direct: { _tag: "owner" }, to: [{ _tag: "owner" }], reply: "none", text: "A progress report." });
      expect(yield* eventually(actions("roles.RoleAdviceBroken"), rows => rows.length >= 2)).toHaveLength(before === 0 ? 2 : before);
      if (attempt >= 2) {
        const question = yield* asker.ask!({ requestId: `matrix-ask-${attempt}`, text: "Which task?" });
        yield* worker["pass-up"]!({ requestId: `matrix-pass-${attempt}`, subject: { _tag: "question", id: question.questionId } });
        const other = yield* fixtureClient(socketPath, tokens.other!, engineLists as any);
        yield* other.start!({ ...startPayload(rig, { groups: [] }), requestId: `other-child-${attempt}` });
        yield* other["board.post"]!({ requestId: `other-owner-${attempt}`, direct: { _tag: "owner" }, to: [{ _tag: "owner" }], reply: "none", text: "Another report." });
        const rows = yield* eventually(actions("roles.RoleAdviceBroken"), rows => rows.length === 5);
        expect(rows.map(row => row.agentId)).toEqual(["worker", "worker", "worker", "other", "other"]);
      }
      // The production consumer must pass this marker before checking absence.
      const owner = yield* socket();
      yield* owner["roles.snooze"]!({ requestId: marker, group: marker, until: 0 });
      expect(yield* eventually(Effect.sync(() => finished), Boolean)).toBe(true);
      expect(yield* actions("roles.RoleAdviceBroken")).toHaveLength(attempt === 1 ? 2 : 5);
    }));
  }
}));
