import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { it } from "@effect/vitest";
import * as SqliteClient from "@shephrd/t3-node-sqlite/nodeSqliteClient";
import { rolesActionKinds, type EventEnvelope, type RolesAction } from "@shephrd/contracts";
import * as Deferred from "effect/Deferred";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Redacted from "effect/Redacted";
import { TestClock } from "effect/testing";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { serve } from "../../../src/api/server.ts";
import { executeService } from "../../../src/commands/services.ts";
import { CommandHandler } from "../../../src/commands/CommandHandler.ts";
import { refused } from "../../../src/commands/internal.ts";
import { engineLists, type EngineLists } from "../../../src/pieces/lists.ts";
import { makeSheepdogLoop, type SheepdogRule } from "../../../src/roles/sheepdog/loop.ts";
import { sendNotice, sheepdogCaller, noticeRecipient, deliveryIsSheepdogTurn, resendUnread, recordAction } from "../../../src/roles/sheepdog/notices.ts";
import { makeRules } from "../../../src/roles/sheepdog/rules/runtime.ts";
import { callForAction } from "../../../src/roles/sheepdog/actions.ts";
import { resolveSettings, roleSettings } from "../../../src/roles/sheepdog/settings.ts";
import { actionRequestId } from "../../../src/roles/sheepdog/requests.ts";
import { withinCapacityLimit } from "../../../src/roles/sheepdog/switch.ts";
import type { RolesView } from "../../../src/roles/view.ts";
import { buildServices } from "../../../src/service.ts";
import { Views } from "../../../src/views/Views.ts";
import { layer as redactor } from "../../../src/log/Redactor.ts";
import { Restart } from "../../../src/recovery/service.ts";
import { LogWriteFailed } from "../../../src/log/EventLog.ts";
import { fixtureClient } from "../../support/fixturePiece.ts";
import { makeFakeRunner, type FakeRunner } from "../../support/fakeRunner.ts";
import { notice, send, spawn } from "../../support/deliveryRig.ts";
import { appendSetup, eventOf, makeFakeSecrets, makeRig, removeRig, seedAccount, seedAgent, seedHarness, type Rig } from "../../support/handlerRig.ts";
import { alertLog } from "../../support/alertsRig.ts";
import { eventually, pause } from "../../support/routingRig.ts";
import { registerRebuildCheck } from "../../support/rebuildCheck.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("SHEPHRD_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });
const quiet: EngineLists = { ...engineLists, reactors: {} };
const listsWith = (rules: ReadonlyArray<SheepdogRule> = []): EngineLists => ({ ...engineLists, reactors: { roles: makeSheepdogLoop(rules) } });
const current = Views.pipe(Effect.flatMap((views) => views.snapshot));
const roles = current.pipe(Effect.map((snapshot) => snapshot.roles as RolesView));
const settled = (position: number) => eventually(roles, (view) => view.baseline !== undefined && view.baseline.position >= position);
const run = <A, E, R>(lists: EngineLists, body: Effect.Effect<A, E, R> | ((runner: FakeRunner) => Effect.Effect<A, E, R>), recovery?: Layer.Layer<Restart>) => {
  let program = Effect.gen(function* () {
    const runner = yield* makeFakeRunner();
    return yield* Effect.scoped(Effect.gen(function* () {
      yield* registerRebuildCheck();
      return yield* typeof body === "function" ? body(runner) : body;
    })).pipe(Effect.provide(buildServices(rig, lists).pipe(
      Layer.provide(Layer.mergeAll(runner.layer, makeFakeSecrets().layer, redactor)),
    )), Effect.provide(runner.layer));
  }).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped);
  if (recovery !== undefined) program = program.pipe(Effect.provide(recovery));
  return program as Effect.Effect<A, E>;
};
const socket = (lists: EngineLists) => Effect.gen(function* () {
  const bearer = randomBytes(32).toString("base64url");
  const socketPath = join(rig.stateFolder, "engine.sock");
  yield* serve({ socketPath, ownerCredential: Redacted.make(bearer), debug: true, lists });
  return yield* fixtureClient(socketPath, bearer, lists as any);
});
const setup = Effect.gen(function* () {
  yield* seedAccount(); yield* seedHarness();
  yield* seedAgent({ id: "lead", state: "idle" });
  yield* seedAgent({ id: "worker", parent: "lead", state: "idle", name: "worker\n/stop <hostile>" });
});
const action = (trigger: EventEnvelope, sourceSequence: number, recipient: RolesAction["noticeRecipient"]): RolesAction => ({
  _tag: "roles.ReplaceAdvised", agentId: "worker" as RolesAction["agentId"], noticeRecipient: recipient,
  triggerSequence: trigger.sequence, sourceSequence: sourceSequence as RolesAction["sourceSequence"], occurrence: 1,
  notice: "board-off",
});
const notifyRule: SheepdogRule = { onEvent: (ctx, envelope) => Effect.gen(function* () {
  if (envelope.event._tag !== "roles.Snoozed" || envelope.event.group !== "trigger") return;
  const { notice: _notice, ...record } = action(envelope, ctx.sourceSequence, noticeRecipient(ctx.snapshot, "worker"));
  yield* sendNotice(record, "test-notice", ctx.lists);
}) };

it.effect("base service entry point refuses every command outside each service's list and closes roles.record's union", () => run(quiet, Effect.gen(function* () {
  for (const service of ["roles.sheepdog", "roles.standing-rules"]) {
    for (const name of engineLists.commands.requests.keys()) {
      if (engineLists.services[service]!.includes(name)) continue;
      const reply = yield* executeService({ _tag: "service", service }, name, { requestId: `deny-${service}-${name}` }).pipe(Effect.result);
      expect(reply._tag, `${service} ${name}`).toBe("Failure");
    }
  }
  for (const tag of ["roles.RuleAdded", "roles.RuleFirstUsed", "roles.SettingsChanged", "AgentStopped"]) {
    expect((yield* executeService(sheepdogCaller, "roles.record", { requestId: tag, action: { _tag: tag, settings: {} } }).pipe(Effect.result))._tag).toBe("Failure");
  }
  const payload = { requestId: "roles:baseline", action: { _tag: "roles.SheepdogBaseline", position: 0, on: true } };
  const first = yield* executeService(sheepdogCaller, "roles.record", payload);
  expect(yield* executeService(sheepdogCaller, "roles.record", payload)).toEqual(first);
  expect((yield* alertLog).filter((row) => row.event._tag === "roles.SheepdogBaseline")).toHaveLength(1);
  expect((yield* executeService(sheepdogCaller, "roles.record", { ...payload, action: { ...payload.action, on: false } }).pipe(Effect.result))._tag).toBe("Failure");
})));

it.effect("socket settings, snooze, notices and read tracking use the composed service and rebuild", () => {
  const lists = listsWith([notifyRule]);
  return run(lists, Effect.gen(function* () {
    yield* setup;
    yield* settled(0);
    const client = yield* socket(lists);
    yield* client["roles.settings.set"]!({ requestId: "limits", settings: { limits: { teamIdleMinutes: 90 }, standingRules: false } });
    expect(yield* client["roles.settings.get"]!({ requestId: "limits-read" })).toMatchObject({ settings: { limits: { teamIdleMinutes: 90 }, standingRules: false } });
    yield* client["roles.snooze"]!({ requestId: "notice-trigger", group: "trigger", until: 3_600_000 });
    const view = yield* eventually(roles, (view) => view.actions.some((record) => record._tag === "roles.ReplaceAdvised"));
    const notice = view.actions.find((record) => record._tag === "roles.ReplaceAdvised")!;
    expect(notice).toMatchObject({ noticeRecipient: "lead", notice: "sent" });
    const rows = yield* alertLog;
    const post = rows.find((row) => row.event._tag === "board.PostWritten" && row.event.postId === notice.postId)!;
    expect(post.caller).toEqual(sheepdogCaller);
    expect(post.event).toMatchObject({ reply: "none", author: sheepdogCaller });
    expect(JSON.stringify(post.event)).not.toContain("/stop");
    expect(JSON.stringify(post.event)).not.toContain("<hostile>");
    expect(rows.some((row) => row.event._tag === "board.WakeBuilt")).toBe(true);
    expect(rows.filter((row) => row.event._tag === "board.PostWritten")).toHaveLength(1);
    const delivery = rows.find((row) => row.event._tag === "DeliveryQueued" && row.event.delivery.source?._tag === "piece");
    expect(delivery?.event._tag).toBe("DeliveryQueued");
    if (delivery?.event._tag === "DeliveryQueued") expect(deliveryIsSheepdogTurn(yield* current, delivery.event.delivery.id)).toBe(true);
    yield* appendSetup([eventOf({ _tag: "board.Read", channelId: (post.event as { channelId: string }).channelId,
      reader: { _tag: "agent", agentId: "lead" }, postIds: [notice.postId] })]);
    expect((yield* roles).actions.find((record) => record.postId === notice.postId)?.noticeRead).toBe(true);
    yield* client["roles.snooze"]!({ requestId: "notice-trigger", group: "trigger", until: 3_600_000 });
    expect((yield* alertLog).filter((row) => row.event._tag === "board.PostWritten")).toHaveLength(1);
  }));
});

it.effect("a board-off notice records board-off without posting and its status remains readable", () => {
  const lists = { ...listsWith([notifyRule]), boardEnabled: false };
  return run(lists, Effect.gen(function* () {
    yield* setup; yield* settled(0);
    const client = yield* socket(lists);
    yield* client["roles.snooze"]!({ requestId: "disabled-trigger", group: "trigger", until: 3_600_000 });
    const view = yield* eventually(roles, (view) => view.actions.length > 0);
    expect(view.actions[0]).toMatchObject({ notice: "board-off", noticeRecipient: "lead" });
    expect((yield* alertLog).filter((row) => row.event._tag === "board.PostWritten")).toEqual([]);
    expect(yield* executeService(sheepdogCaller, "board.status", { requestId: "status" }, lists)).toMatchObject({ disabled: true, holdsIncoming: [], holdsUnsettled: [] });
  }));
});

it.effect("a socket snooze silences its idle group until the clock passes without silencing another group", () => {
  const lists = listsWith();
  return run(lists, Effect.gen(function* () {
    yield* setup; yield* settled(0);
    const client = yield* socket(lists);
    yield* client["roles.snooze"]!({ requestId: "snooze-idle", group: "idle", until: (yield* Clock.currentTimeMillis) + 600_000 });
    const trigger = (yield* current).sequence;
    const idle = { _tag: "roles.TeamIdleReported", agentId: "worker", noticeRecipient: "lead", group: "idle",
      triggerSequence: trigger, sourceSequence: trigger, occurrence: 1 } as const;
    yield* sendNotice(idle as any, "team-idle", lists);
    expect((yield* alertLog).filter((row) => row.event._tag === "board.PostWritten")).toHaveLength(0);
    yield* sendNotice({ ...idle, group: "other" } as any, "team-idle", lists);
    expect((yield* alertLog).filter((row) => row.event._tag === "board.PostWritten")).toHaveLength(1);
    yield* TestClock.adjust("10 minutes");
    yield* sendNotice(idle as any, "team-idle", lists);
    expect((yield* alertLog).filter((row) => row.event._tag === "board.PostWritten")).toHaveLength(2);
    expect((yield* roles).actions.filter((record) => record._tag === "roles.TeamIdleReported")).toHaveLength(2);
  }));
});

it.effect("recovery holds production crash rules at the historical head and admits only a later crash", () => Effect.gen(function* () {
  let historicalHead = 0;
  yield* run(quiet, Effect.gen(function* () {
    yield* setup;
    yield* appendSetup([eventOf({ _tag: "AgentCrashed", agentId: "worker", exitCode: 1, signal: null, stderr: "historical detail" })]);
    historicalHead = (yield* current).sequence;
  }));
  const ready = yield* Deferred.make<void>();
  let calls = 0;
  const recovery = Layer.succeed(Restart, { ready: Deferred.isDone(ready), whenReady: Deferred.await(ready), recover: Effect.void, returnAccount: () => Effect.void });
  const lists = listsWith([...makeRules(), { onStart: () => Effect.sync(() => { calls++; }) }]);
  yield* run(lists, runner => Effect.gen(function* () {
    yield* pause(25);
    expect((yield* roles).baseline).toBeUndefined(); expect(calls).toBe(0);
    yield* Deferred.succeed(ready, undefined);
    const view = yield* settled(historicalHead);
    expect(view.baseline!.position).toBe(historicalHead);
    expect(yield* eventually(Effect.sync(() => calls), count => count === 1)).toBe(1);
    yield* pause(50);
    expect((yield* alertLog).filter(row => row.event._tag === "roles.CrashAdmitted")).toEqual([]);
    expect(runner.callsOf("load")).toHaveLength(0);
    expect((yield* alertLog).filter(row => row.event._tag === "DeliveryQueued")).toEqual([]);
    yield* seedAgent({ id: "later", folder: rig.work });
    const [crash] = yield* appendSetup([eventOf({ _tag: "AgentCrashed", agentId: "later", exitCode: 1, signal: null, stderr: "later detail" })]);
    const after = yield* eventually(roles, view => view.actions.some(row => row._tag === "roles.CrashAdmitted"));
    expect(after.actions.filter(row => row._tag === "roles.CrashAdmitted")).toMatchObject([{ agentId: "later", triggerSequence: crash!.sequence }]);
  }), recovery);
}));

it.effect("lagging off/on switches replay in order and write one baseline with stable request ids", () => Effect.gen(function* () {
  let rows: ReadonlyArray<EventEnvelope> = [];
  yield* run(quiet, Effect.gen(function* () {
    yield* setup;
    yield* executeService(sheepdogCaller, "roles.record", { requestId: "roles:baseline", action: { _tag: "roles.SheepdogBaseline", position: (yield* current).sequence, on: true } });
    yield* appendSetup([
      eventOf({ _tag: "roles.Snoozed", group: "before-off", until: 3_600_000 }),
      eventOf({ _tag: "roles.SettingsChanged", settings: { sheepdog: false } }),
      eventOf({ _tag: "roles.Snoozed", group: "while-off", until: 3_600_000 }),
      eventOf({ _tag: "roles.SettingsChanged", settings: { sheepdog: true } }),
      eventOf({ _tag: "roles.Snoozed", group: "after-on", until: 3_600_000 }),
    ]);
    rows = yield* alertLog;
  }));
  const seen: string[] = [];
  const rule: SheepdogRule = { onEvent: (ctx, row) => Effect.gen(function* () {
    if (row.event._tag !== "roles.Snoozed") return;
    seen.push(row.event.group);
    yield* recordAction({ _tag: "roles.CacheFlushed", agentId: "worker" as RolesAction["agentId"], noticeRecipient: "owner", notice: "sent",
      triggerSequence: row.sequence, sourceSequence: row.sequence, occurrence: 1 }, "switch-observer", ctx.lists);
  }) };
  const lists = listsWith([rule]);
  const afterOn = rows.find(row => row.event._tag === "roles.Snoozed" && row.event.group === "after-on")!.sequence;
  for (let restart = 0; restart < 2; restart++) yield* run(lists, Effect.gen(function* () {
    const onSequence = rows.find((row) => row.event._tag === "roles.SettingsChanged" && row.event.settings.sheepdog === true)!.sequence;
    yield* settled(onSequence);
    expect(yield* eventually(Effect.sync(() => seen.includes("after-on")), Boolean)).toBe(true);
    const [marker] = yield* appendSetup([eventOf({ _tag: "roles.Snoozed", group: `barrier-${restart}`, until: 0 })]);
    const handled = yield* eventually(roles, view => view.actions.some(row => row.triggerSequence === marker!.sequence));
    expect(handled.actions.some(row => row.triggerSequence === marker!.sequence)).toBe(true);
    expect(handled.actions.filter(row => row.triggerSequence === afterOn)).toHaveLength(1);
    const baselines = (yield* alertLog).filter((row) => row.event._tag === "roles.SheepdogBaseline");
    expect(baselines).toHaveLength(3);
    for (const row of baselines.slice(1)) if (row.event._tag === "roles.SheepdogBaseline") expect(row.requestId).toBe(`roles:baseline:${row.event.position}`);
  }));
  expect(seen.filter(group => !group.startsWith("barrier-"))).toEqual(["before-off", "after-on"]);
}));

it.effect("one loop re-arms persisted event clocks and takes one missed step, dropping expired cache timers", () => Effect.gen(function* () {
  let origin = 0;
  yield* run(listsWith(), Effect.gen(function* () {
    yield* settled(0); yield* setup;
    origin = (yield* appendSetup([eventOf({ _tag: "roles.Snoozed", group: "clock", until: 3_600_000 })]))[0]!.sequence;
  }));
  yield* TestClock.adjust("11 minutes");
  const fired: string[] = [];
  const rule: SheepdogRule = {
    timers: () => ["stall", "team-idle", "capacity", "notice-cache"].map((kind) => ({ key: kind, rule: kind as any, originSequence: origin, delayMillis: 600_000 })),
    onTimer: (_ctx, timer) => Effect.sync(() => { fired.push(timer.key); }),
  };
  yield* run(listsWith([rule]), Effect.gen(function* () {
    yield* eventually(Effect.sync(() => fired.length), (count) => count === 3);
    expect(fired).toEqual(["stall", "team-idle", "capacity"]);
    yield* TestClock.adjust("30 minutes");
    expect(fired).toHaveLength(3);
  }));
}));

it.effect("timer work uses the originating event time and fires under TestClock through a socket-triggered event", () => {
  let origin = 0;
  const fired: number[] = [];
  const rule: SheepdogRule = {
    onEvent: (_ctx, row) => Effect.sync(() => { if (row.event._tag === "roles.Snoozed") origin = row.sequence; }),
    timers: () => origin === 0 ? [] : [{ key: "stall", rule: "stall", originSequence: origin, delayMillis: 600_000 }],
    onTimer: (ctx) => Effect.sync(() => { fired.push(ctx.sourceSequence); }),
  };
  const lists = listsWith([rule]);
  return run(lists, Effect.gen(function* () {
    yield* settled(0);
    const client = yield* socket(lists);
    yield* client["roles.snooze"]!({ requestId: "clock-origin", group: "clock", until: 3_600_000 });
    yield* eventually(Effect.sync(() => origin), (value) => value > 0);
    yield* TestClock.adjust("9 minutes"); expect(fired).toEqual([]);
    yield* TestClock.adjust("1 minute");
    yield* eventually(Effect.sync(() => fired.length), (count) => count === 1);
    expect(fired[0]).toBeGreaterThanOrEqual(origin);
    yield* TestClock.adjust("20 minutes"); expect(fired).toHaveLength(1);
  }));
});

it.effect("board re-enable persists a new board clock without resetting counts or capacity clocks", () => Effect.gen(function* () {
  let origin = 0;
  yield* run(listsWith(), Effect.gen(function* () {
    yield* settled(0); yield* setup;
    origin = (yield* appendSetup([eventOf({ _tag: "roles.Snoozed", group: "clock", until: 3_600_000 })]))[0]!.sequence;
    yield* executeService(sheepdogCaller, "roles.record", { requestId: "prior-stall", action: {
      _tag: "roles.StallSeen", agentId: "worker", noticeRecipient: "owner", triggerSequence: origin,
      sourceSequence: origin, occurrence: 2, notice: "board-off",
    } });
  }));
  yield* run({ ...listsWith(), boardEnabled: false }, Effect.gen(function* () {
    const view = yield* eventually(roles, (view) => view.boardClock?.on === false);
    expect(view.agents.worker!.stallCount).toBe(2);
  }));
  yield* TestClock.adjust("11 minutes");
  const fired: string[] = [];
  const rule: SheepdogRule = {
    timers: () => ["stall", "team-idle", "capacity", "notice-cache"].map((kind) => ({ key: kind, rule: kind as any, originSequence: origin, delayMillis: 600_000 })),
    onTimer: (_ctx, timer) => Effect.sync(() => { fired.push(timer.key); }),
  };
  let boardSequence = 0;
  yield* run(listsWith([rule]), Effect.gen(function* () {
    const view = yield* eventually(roles, (view) => view.boardClock?.on === true);
    boardSequence = view.boardClock!.sequence;
    yield* eventually(Effect.sync(() => fired.length), (count) => count === 1);
    expect(fired).toEqual(["capacity"]);
    expect(view.agents.worker!.stallCount).toBe(2);
    yield* TestClock.adjust("5 minutes");
    expect(fired).toEqual(["capacity"]);
  }));
  fired.length = 0;
  yield* run(listsWith([rule]), Effect.gen(function* () {
    yield* eventually(Effect.sync(() => fired.length), (count) => count === 1);
    expect((yield* roles).boardClock!.sequence).toBe(boardSequence);
    yield* TestClock.adjust("4 minutes"); expect(fired).toEqual(["capacity"]);
    yield* TestClock.adjust("1 minute");
    yield* eventually(Effect.sync(() => fired.length), (count) => count === 4);
    expect(fired).toEqual(["capacity", "stall", "team-idle", "notice-cache"]);
    expect((yield* roles).agents.worker!.stallCount).toBe(2);
  }));
}));

it.effect("switch-off releases each open hold once and refuses new holds until enabled", () => Effect.gen(function* () {
  yield* run(quiet, Effect.gen(function* () {
    yield* setup;
    yield* appendSetup([
      eventOf({ _tag: "DeliveryHeld", agentId: "worker", deliveryId: "held", reason: "capacity" }),
      eventOf({ _tag: "roles.SettingsChanged", settings: { sheepdog: false } }),
    ]);
  }));
  for (let attempt = 0; attempt < 2; attempt++) yield* run(listsWith(), Effect.gen(function* () {
    yield* settled(0);
    yield* eventually(current, (snapshot) => !snapshot.agents.worker!.capacityHeld);
    expect(withinCapacityLimit(yield* current, "worker", 0)).toBe(false);
    expect((yield* alertLog).filter((row) => row.event._tag === "DeliveryReleased")).toHaveLength(1);
  }));
}));

it.effect("a failed record stops the loop at its durable position without running later events", () => {
  let reachedLater = false;
  const rule: SheepdogRule = { onEvent: (_ctx, row) => {
    if (row.event._tag === "roles.Snoozed" && row.event.group === "fail") return Effect.fail(new LogWriteFailed({ reason: "database write failed" }));
    if (row.event._tag === "roles.Snoozed") reachedLater = true;
    return Effect.void;
  } };
  return run(quiet, Effect.gen(function* () {
    const fiber = yield* makeSheepdogLoop([rule]).pipe(Effect.forkScoped);
    yield* settled(0);
    const before = (yield* roles).position;
    yield* appendSetup([eventOf({ _tag: "roles.Snoozed", group: "fail", until: 3_600_000 }), eventOf({ _tag: "roles.Snoozed", group: "later", until: 3_600_000 })]);
    const exit = yield* Fiber.await(fiber);
    expect(exit._tag).toBe("Failure"); expect((yield* roles).position).toBe(before); expect(reachedLater).toBe(false);
  }));
});

it.effect("action identities separate repeats, episodes, action kinds and recipients while retries keep the same body", () => run(quiet, Effect.gen(function* () {
  const base = { rule: "stall", subject: "worker", triggerSequence: 9, kind: "nudge", recipient: "lead", occurrence: 1 };
  const id = actionRequestId(base);
  expect(actionRequestId({ ...base })).toBe(id);
  expect(new Set([id, actionRequestId({ ...base, occurrence: 2 }), actionRequestId({ ...base, triggerSequence: 10 }),
    actionRequestId({ ...base, kind: "record" }), actionRequestId({ ...base, recipient: "owner" })]).size).toBe(5);
  expect(actionRequestId({ ...base, subject: "a:b", recipient: "c" })).not.toBe(actionRequestId({ ...base, subject: "a", recipient: "b:c" }));
})));

it.effect("a crash between an engine command, notice post and record repeats none of the commands for every action kind", () => Effect.gen(function* () {
  yield* run(quiet, setup);
  const failing: EngineLists = { ...quiet, planners: { ...quiet.planners,
    "roles.record": () => Effect.fail(new LogWriteFailed({ reason: "database write failed" })),
    "board.flush": () => Effect.fail(refused()),
  } };
  for (const [index, kind] of rolesActionKinds.entries()) {
    let record: RolesAction;
    yield* run(failing, Effect.gen(function* () {
      const rows = yield* appendSetup([
        eventOf({ _tag: "DeliveryHeld", agentId: "worker", deliveryId: `held-${index}`, reason: "capacity" }),
        eventOf({ _tag: "roles.Snoozed", group: "trigger", until: 3_600_000 }),
      ]);
      const trigger = rows[1]!;
      record = { ...action(trigger, trigger.sequence, "lead" as RolesAction["noticeRecipient"]), _tag: `roles.${kind}`, occurrence: index + 1,
        ...(kind === "GaveUp" ? { cause: "crash", engineAlertOpen: false } : {}),
        ...(kind === "TeamIdleReported" ? { group: "team" } : {}),
      } as RolesAction;
      const { notice: _notice, ...notice } = record;
      yield* callForAction(record, "replay", "release", {}, failing);
      expect((yield* sendNotice(notice, "replay", failing).pipe(Effect.result))._tag).toBe("Failure");
    }));
    // LogWriteFailed latches the writer, so resume in a fresh composed service.
    yield* run(quiet, Effect.gen(function* () {
      const { notice: _notice, ...notice } = record!;
      yield* callForAction(record!, "replay", "release", {}, quiet);
      yield* sendNotice(notice, "replay", quiet);
    }));
  }
  yield* run(quiet, Effect.gen(function* () {
    const rows = yield* alertLog;
    expect(rows.filter((row) => row.event._tag === "board.PostWritten")).toHaveLength(rolesActionKinds.length);
    expect(rows.filter((row) => row.event._tag.startsWith("roles.") && row.event._tag !== "roles.Snoozed")).toHaveLength(rolesActionKinds.length);
    expect(rows.filter((row) => row.event._tag === "DeliveryReleased")).toHaveLength(rolesActionKinds.length);
  }));
}));

it.effect("a refused flush preserves its notice, and an unread notice goes once to the new holder across restart", () => Effect.gen(function* () {
  const lists: EngineLists = { ...quiet, planners: { ...quiet.planners, "board.flush": () => Effect.fail(refused()) } };
  yield* run(lists, Effect.gen(function* () {
    yield* setup;
    const [trigger] = yield* appendSetup([eventOf({ _tag: "roles.Snoozed", group: "trigger", until: 3_600_000 })]);
    const { notice: _notice, ...record } = action(trigger!, trigger!.sequence, "lead" as RolesAction["noticeRecipient"]);
    yield* sendNotice(record, "holder", lists);
    expect((yield* roles).actions[0]).toMatchObject({ notice: "sent", noticeRecipient: "lead", noticeRead: false });
    yield* appendSetup([eventOf({ _tag: "AgentCrashed", agentId: "lead", exitCode: 1, signal: null, stderr: "private error" })]);
    yield* resendUnread((yield* current).sequence, lists);
    expect((yield* roles).actions.map((record) => record.noticeRecipient)).toEqual(["lead", "owner"]);
    expect((yield* alertLog).filter((row) => row.event._tag === "board.PostWritten")).toHaveLength(1);
  }));
  yield* run(quiet, Effect.gen(function* () {
    yield* resendUnread((yield* current).sequence, quiet);
    expect((yield* roles).actions.map((record) => record.noticeRecipient)).toEqual(["lead", "owner"]);
  }));
}));

it.effect("a real sheepdog-only board wake preserves an owner stall alert and a mixed wake clears it", () => run(engineLists, Effect.gen(function* () {
  yield* setup; yield* settled(0);
  const [trigger] = yield* appendSetup([eventOf({ _tag: "roles.Snoozed", group: "trigger", until: 0 })]);
  const { notice: _notice, ...record } = { ...action(trigger!, trigger!.sequence, "owner"), _tag: "roles.StallSeen" as const };
  yield* sendNotice(record, "stall", engineLists);
  const client = yield* socket(engineLists);
  const openAlerts = () => client["client.alerts.list"]!({ requestId: randomBytes(8).toString("hex"), after: 0, limit: 200, status: "open" });
  const reply = yield* eventually(openAlerts(), reply => (reply.items as any[]).some(row => row.alertKey === "stall:worker"));
  const alert = (reply.items as any[]).find(row => row.alertKey === "stall:worker");
  expect(alert).toMatchObject({ kind: "roles.stall", status: "open" });
  yield* executeService(sheepdogCaller, "board.post", { requestId: "sheep-only", direct: { _tag: "agent", agentId: "worker" },
    to: [{ _tag: "agent", agentId: "worker" }], reply: "none", text: "Check the board." });
  yield* executeService(sheepdogCaller, "board.flush", { requestId: "flush-only", agentId: "worker" });
  const working = yield* eventually(current, snapshot => snapshot.agents.worker?.state._tag === "working");
  expect(working.agents.worker?.state._tag).toBe("working");
  const only = Object.values(working.deliveries).findLast(row => row.target === "worker" && row.status === "sent")!;
  expect(deliveryIsSheepdogTurn(working, only.id)).toBe(true);
  yield* pause(50);
  expect((yield* roles).actions.filter(row => row._tag === "roles.StallEnded")).toHaveLength(0);
  expect((yield* openAlerts()).items).toContainEqual(expect.objectContaining({ alertId: alert.alertId, status: "open" }));
  yield* appendSetup([eventOf({ _tag: "DeliveryAccepted", agentId: "worker", deliveryId: only.id }), eventOf({ _tag: "TurnEnded", agentId: "worker", compact: false })]);
  yield* executeService(sheepdogCaller, "board.post", { requestId: "mixed-sheep", direct: { _tag: "agent", agentId: "worker" },
    to: [{ _tag: "agent", agentId: "worker" }], reply: "none", text: "Check the board again." });
  yield* client["board.post"]!({ requestId: "mixed-owner", direct: { _tag: "agent", agentId: "worker" },
    to: [{ _tag: "agent", agentId: "worker" }], reply: "none", text: "Additional work." });
  yield* client["board.flush"]!({ requestId: "flush-mixed", agentId: "worker" });
  const ended = yield* eventually(roles, view => view.actions.some(row => row._tag === "roles.StallEnded"));
  expect(ended.actions.filter(row => row._tag === "roles.StallEnded")).toHaveLength(1);
  expect(ended.agents.worker!.openStall).toBeUndefined();
  const final = yield* eventually(openAlerts(), reply => !(reply.items as any[]).some(row => row.alertId === alert.alertId));
  expect(final.items).not.toContainEqual(expect.objectContaining({ alertId: alert.alertId }));
  const rows = yield* alertLog;
  expect(rows.filter(row => row.event._tag === "client.AlertCleared" && row.event.alertId === alert.alertId)).toHaveLength(1);
  const wakes = rows.filter(row => row.event._tag === "board.WakeBuilt");
  expect(wakes).toHaveLength(2);
  expect(wakes[1]!.event).toMatchObject({ carried: expect.any(Array) });
  if (wakes[1]!.event._tag === "board.WakeBuilt") expect(wakes[1]!.event.carried).toHaveLength(2);
})));

it.effect("limits resolve role defaults and overrides; invalid settings report the failing field", () => run(quiet, Effect.gen(function* () {
  const role = roleSettings(null, "lead:builder");
  expect(resolveSettings({}, role).stallMinutes).toBe(20);
  expect(resolveSettings({ limits: { stallMinutes: 35 } }, role).stallMinutes).toBe(35);
  expect(resolveSettings({ limits: { stallMinutes: 35 } }, { ...role, limits: { stallMinutes: 45 } }).stallMinutes).toBe(45);
  const handler = yield* CommandHandler;
  const invalid = yield* handler.execute({ _tag: "owner" }, "roles.settings.set", { requestId: "bad-limit", settings: { limits: { stallMinutes: 4 } } }).pipe(Effect.result);
  expect(invalid).toMatchObject({ _tag: "Failure", failure: { reason: expect.stringContaining("stallMinutes") } });
})));

it.effect("the composed capacity policy holds while enabled, releases on switch-off, and returns a later capacity error", () => {
  const lists = listsWith();
  return run(lists, (runner) => Effect.gen(function* () {
    yield* seedAccount(); yield* seedHarness(); yield* settled(0);
    const target = yield* spawn(rig, runner);
    const deliveryId = yield* send(runner, target, "Try the assigned work.");
    yield* notice(runner, target, { _tag: "promptReply", deliveryId, outcome: { _tag: "capacity", error: "temporary capacity error" } });
    expect((yield* eventually(current, (snapshot) => snapshot.agents[target.agentId]?.capacityHeld === true)).agents[target.agentId]!.capacityHeld).toBe(true);
    const client = yield* socket(lists);
    yield* client["roles.settings.set"]!({ requestId: "stop-holds", settings: { sheepdog: false } });
    expect((yield* eventually(current, (snapshot) => snapshot.agents[target.agentId]?.capacityHeld === false)).agents[target.agentId]!.capacityHeld).toBe(false);
    yield* notice(runner, target, { _tag: "promptReply", deliveryId, outcome: { _tag: "capacity", error: "another capacity error" } });
    const rows = yield* eventually(alertLog, (rows) => rows.some((row) => row.event._tag === "DeliveryReturned" && row.event.cause === "capacity"));
    expect(rows.filter((row) => row.event._tag === "DeliveryHeld")).toHaveLength(1);
    expect(rows.filter((row) => row.event._tag === "DeliveryReleased")).toHaveLength(1);
  }));
});

it.effect("a sheepdog defect restarts from its position and logs no event or error text", () => {
  const logs: string[] = [];
  const logger = Logger.layer([Logger.make((entry) => { logs.push(Logger.formatJson.log(entry)); })]);
  let attempts = 0;
  const rule: SheepdogRule = { onEvent: (_ctx, row) => {
    if (row.event._tag !== "roles.Snoozed") return Effect.void;
    attempts++;
    return attempts === 1 ? Effect.die(new Error("PRIVATE EVENT AND ERROR TEXT")) : Effect.void;
  } };
  const lists = listsWith([rule]);
  return run(lists, Effect.gen(function* () {
    yield* settled(0);
    const client = yield* socket(lists);
    yield* client["roles.snooze"]!({ requestId: "defect-trigger", group: "trigger", until: 3_600_000 });
    yield* eventually(Effect.sync(() => attempts), (count) => count === 1);
    yield* TestClock.adjust("1 second");
    yield* eventually(Effect.sync(() => attempts), (count) => count === 2);
    expect(attempts).toBe(2);
    expect(logs.some((line) => line.includes("piece reactor failed"))).toBe(true);
    expect(logs.join("\n")).not.toContain("PRIVATE EVENT AND ERROR TEXT");
    expect((yield* alertLog).filter((row) => row.event._tag === "roles.SheepdogBaseline")).toHaveLength(1);
  })).pipe(Effect.provide(logger));
});

it.effect("a refused action record is handled without preventing the next stream event", () => {
  const real = engineLists.planners["roles.record"]!;
  let later = false;
  const rule: SheepdogRule = { onEvent: (ctx, row) => Effect.gen(function* () {
    if (row.event._tag !== "roles.Snoozed") return;
    if (row.event.group === "later") { later = true; return; }
    const { notice: _notice, ...record } = action(row, ctx.sourceSequence, "owner");
    yield* sendNotice(record, "refused", ctx.lists);
  }) };
  const base = listsWith([rule]);
  const lists: EngineLists = { ...base, planners: { ...base.planners, "roles.record": (input, payload) =>
    (payload.action as { _tag: string })._tag === "roles.SheepdogBaseline" ? real(input, payload) : Effect.fail(refused()),
  } };
  return run(lists, Effect.gen(function* () {
    yield* setup; yield* settled(0);
    yield* appendSetup([eventOf({ _tag: "roles.Snoozed", group: "refused", until: 3_600_000 }), eventOf({ _tag: "roles.Snoozed", group: "later", until: 3_600_000 })]);
    yield* eventually(Effect.sync(() => later), Boolean);
    expect(later).toBe(true);
    expect((yield* alertLog).filter((row) => row.event._tag === "CommandRefused" && row.event.command === "roles.record")).toHaveLength(1);
  }));
});

it.effect("owner notices reach the real alert list with the fixed title and no subject", () => run(engineLists, Effect.gen(function* () {
  yield* setup; yield* settled(0);
  const [trigger] = yield* appendSetup([eventOf({ _tag: "roles.Snoozed", group: "owner", until: 3_600_000 })]);
  const { notice: _notice, ...record } = action(trigger!, trigger!.sequence, "owner");
  yield* sendNotice(record, "owner", engineLists);
  yield* eventually(alertLog, (rows) => rows.some((row) => row.event._tag === "client.AlertRaised" && row.event.kind === "roles.replace"));
  const client = yield* socket(engineLists);
  const reply = yield* client["client.alerts.list"]!({ requestId: "owner-alerts", after: 0, limit: 200, status: "open" });
  const items = reply.items as ReadonlyArray<Record<string, unknown>>;
  const alert = items.find((row) => row.kind === "roles.replace")!;
  expect(alert).toMatchObject({ alertKey: "replace:worker", agentId: "worker", title: "A worker needs replacement" });
  expect(alert.subject).toBeUndefined();
  expect((yield* alertLog).filter((row) => row.event._tag === "board.PostWritten")).toEqual([]);
})));

it.effect("two idle groups sharing a top agent keep distinct receipts and each unread notice is rerouted once", () => {
  const lists: EngineLists = { ...quiet, planners: { ...quiet.planners, "board.flush": () => Effect.fail(refused()) } };
  return run(lists, Effect.gen(function* () {
    yield* setup;
    const [trigger] = yield* appendSetup([eventOf({ _tag: "roles.Snoozed", group: "trigger", until: 3_600_000 })]);
    for (const group of ["first", "second"]) {
      const { notice: _notice, ...record } = action(trigger!, trigger!.sequence, "lead" as RolesAction["noticeRecipient"]);
      yield* sendNotice({ ...record, _tag: "roles.TeamIdleReported", group }, "team-idle", lists);
    }
    expect((yield* roles).actions).toHaveLength(2);
    const posts = (yield* alertLog).filter((row) => row.event._tag === "board.PostWritten");
    expect(posts).toHaveLength(2);
    expect(new Set(posts.map((row) => row.requestId)).size).toBe(2);
    yield* appendSetup([eventOf({ _tag: "AgentCrashed", agentId: "lead", exitCode: 1, signal: null, stderr: "private error" })]);
    yield* resendUnread((yield* current).sequence, lists);
    yield* resendUnread((yield* current).sequence, lists);
    const records = (yield* roles).actions;
    expect(records).toHaveLength(4);
    expect(records.filter((row) => row.noticeRecipient === "owner").map((row) => row._tag === "roles.TeamIdleReported" ? row.group : undefined)).toEqual(["first", "second"]);
  }));
});

for (const consumption of ["read", "accepted", "unread"] as const) it.effect(`a ${consumption} notice interrupted before recording reroutes only if unread`, () => Effect.gen(function* () {
  let triggerSequence = 0;
  const interrupted: EngineLists = { ...quiet, planners: { ...quiet.planners, "roles.record": () => Effect.interrupt } };
  yield* run(interrupted, Effect.gen(function* () {
    yield* setup;
    const [trigger] = yield* appendSetup([eventOf({ _tag: "roles.Snoozed", group: "late-record", until: 0 })]);
    triggerSequence = trigger!.sequence;
    const { notice: _notice, ...record } = action(trigger!, trigger!.sequence, "lead" as RolesAction["noticeRecipient"]);
    const fiber = yield* sendNotice(record, "late", interrupted).pipe(Effect.forkScoped);
    expect((yield* Fiber.await(fiber))._tag).toBe("Failure");
    const post = (yield* alertLog).find(row => row.event._tag === "board.PostWritten")!;
    expect(post.event._tag).toBe("board.PostWritten");
    if (post.event._tag !== "board.PostWritten") return;
    if (consumption === "read") yield* appendSetup([eventOf({ _tag: "board.Read", channelId: post.event.channelId,
      reader: { _tag: "agent", agentId: "lead" }, postIds: [post.event.postId] })]);
    if (consumption === "accepted") {
      const wake = (yield* alertLog).find(row => row.event._tag === "DeliveryQueued")!;
      expect(wake.event._tag).toBe("DeliveryQueued");
      if (wake.event._tag === "DeliveryQueued") yield* appendSetup([eventOf({ _tag: "DeliveryAccepted", agentId: "lead", deliveryId: wake.event.delivery.id })]);
    }
    expect((yield* roles).actions).toHaveLength(0);
  }));
  yield* run(quiet, Effect.gen(function* () {
    const trigger = (yield* alertLog).find(row => row.sequence === triggerSequence)!;
    const { notice: _notice, ...record } = action(trigger, trigger.sequence, "lead" as RolesAction["noticeRecipient"]);
    yield* sendNotice(record, "late", quiet);
    expect((yield* roles).actions[0]?.noticeRead).toBe(consumption !== "unread");
    yield* appendSetup([eventOf({ _tag: "AgentCrashed", agentId: "lead", exitCode: 1, signal: null, stderr: "detail" })]);
    yield* resendUnread((yield* current).sequence, quiet);
    yield* resendUnread((yield* current).sequence, quiet);
    expect((yield* roles).actions.map(row => row.noticeRecipient)).toEqual(consumption === "unread" ? ["lead", "owner"] : ["lead"]);
    expect((yield* alertLog).filter(row => row.event._tag === "board.PostWritten")).toHaveLength(1);
  }));
}));
