import { it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import type * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { startAccountTimers } from "../../src/accounts/timers.ts";
import type * as EventLog from "../../src/log/EventLog.ts";
import type * as Views from "../../src/views/Views.ts";
import { accept, notice, promptsTo, send, spawn, type Spawned } from "../support/deliveryRig.ts";
import { incarnationOf, makeFakeRunner, type FakeRunner } from "../support/fakeRunner.ts";
import {
  agentCredential, agentRow, call, failureOf, headSequence, logAfter, makeFakeSecrets, makeRig,
  ownerCredential, provideRig, readLog, removeRig, seedAccount, seedHarness, stateOf, success, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { deliveryRow, eventually, pause, snapshot, tagged } from "../support/routingRig.ts";

let rig: Rig;
let logLines: Array<string>;
const timers: Effect.Effect<void, never, Scope.Scope | EventLog.EventLog | Views.Views> = startAccountTimers;
beforeEach(() => {
  rig = makeRig();
  logLines = [];
  vi.stubEnv("SHEPHERD_HOME", rig.stateFolder);
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("CODEX_HOME", `${rig.home}/.codex`);
});
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });

const withAccounts = <A, E, R>(body: (runner: FakeRunner) => Effect.Effect<A, E, R>) => Effect.gen(function* () {
  const runner = yield* makeFakeRunner();
  return yield* provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedAccount();
    yield* seedHarness();
    yield* runner.subscribed;
    // Returns after subscribing and arming logged deadlines, and owns its
    // background fiber in this scope. It does not run full 6d recovery.
    yield* timers;
    return yield* body(runner).pipe(Effect.provide(runner.layer));
  }));
}).pipe(
  Effect.provide(Logger.layer([Logger.make((options) => { logLines.push(Logger.formatJson.log(options)); })])),
  Effect.orDie,
);

const paused = (target: Spawned, reason: "limit" | "signed-out", midTurn: boolean, resetAt?: number) => Effect.gen(function* () {
  const row = yield* eventually(agentRow(target.agentId), (row) => row?.state._tag === "paused");
  expect(row?.state).toEqual({ _tag: "paused", reason, midTurn, ...(resetAt === undefined ? {} : { resetAt }) });
});

const pauseReply = (runner: FakeRunner, target: Spawned, deliveryId: string, reason: "out-of-usage" | "signed-out", resetAt?: number) =>
  notice(runner, target, {
    _tag: "promptReply", deliveryId,
    outcome: { _tag: "pause", reason, error: "private-provider-diagnostic-6b", ...(resetAt === undefined ? {} : { resetAt }) },
  });

const markAvailable = () => call(ownerCredential, "accounts mark-available", { accountId: "primary" });
const carryOns = (target: Spawned) => snapshot.pipe(Effect.map((state) => Object.values(state.deliveries)
  .filter((row) => row.target === target.agentId && row.content._tag === "carry-on")));
const availableEvents = readLog.pipe(Effect.map((rows) => tagged(rows, "AccountAvailable").filter((event) => event.accountId === "primary")));
const waitAvailable = Effect.gen(function* () {
  const account = yield* eventually(snapshot.pipe(Effect.map((state) => state.accounts.primary)), (row) => row?.status === "available");
  expect(account?.status).toBe("available");
});

it.effect("6.10 T1: catches sign-out pausing only the reporting agent, losing mid-turn flags, or omitting the owner alert", () => withAccounts((runner) => Effect.gen(function* () {
  const active = yield* spawn(rig, runner);
  const idle = yield* spawn(rig, runner);
  const busySibling = yield* spawn(rig, runner);
  yield* seedAccount("other");
  const other = yield* spawn(rig, runner, undefined, { account: { _tag: "named", accountId: "other" } });
  const firstDelivery = yield* send(runner, active, "Continue the current task.");
  yield* accept(runner, active, firstDelivery);
  const siblingDelivery = yield* send(runner, busySibling, "Sibling task.");
  yield* accept(runner, busySibling, siblingDelivery);
  const before = yield* headSequence;
  const callsBefore = runner.calls.length;
  yield* pauseReply(runner, active, firstDelivery, "signed-out");
  yield* paused(active, "signed-out", true);
  yield* paused(idle, "signed-out", false);
  yield* paused(busySibling, "signed-out", true);
  expect(yield* stateOf(other.agentId)).toBe("idle");
  expect((yield* snapshot).accounts.primary?.status).toBe("needs-sign-in");
  const written = yield* logAfter(before);
  expect(tagged(written, "AccountNeedsSignIn").map((event) => event.accountId)).toEqual(["primary"]);
  expect(tagged(written, "OwnerNeeded").some((event) => event.agentId === active.agentId)).toBe(true);
  expect(JSON.stringify([written, yield* snapshot, logLines])).not.toContain("private-provider-diagnostic-6b");
  expect(runner.calls.slice(callsBefore).filter((entry) => entry.method === "prompt")).toEqual([]);
})));

it.effect("6.10 T2: catches the timer or an agent command clearing sign-out instead of the owner's mark-available", () => withAccounts((runner) => Effect.gen(function* () {
  const target = yield* spawn(rig, runner);
  const delivery = yield* send(runner, target, "A turn that needs authentication.");
  yield* accept(runner, target, delivery);
  // A stray reset hint must never make a signed-out account auto-retry.
  yield* pauseReply(runner, target, delivery, "signed-out", (yield* Clock.currentTimeMillis) + 60_000);
  yield* paused(target, "signed-out", true);
  const before = yield* headSequence;
  const promptsBefore = promptsTo(runner, target).length;
  yield* TestClock.adjust("2 days");
  yield* pause(30);
  expect(yield* stateOf(target.agentId)).toBe("paused");
  expect(tagged(yield* logAfter(before), "AccountAvailable")).toEqual([]);
  expect(promptsTo(runner, target).slice(promptsBefore)).toEqual([]);
  expect(failureOf(yield* call(agentCredential(target.token), "accounts mark-available", { accountId: "primary" }))).toEqual({ _tag: "CommandRefused", reason: "command refused" });
  expect(yield* stateOf(target.agentId)).toBe("paused");
  success(yield* markAvailable());
  yield* waitAvailable;
  const carries = yield* eventually(carryOns(target), (rows) => rows.length === 1);
  expect(carries).toHaveLength(1);
  expect((yield* availableEvents).map((event) => event.cause)).toEqual(["owner cleared"]);
})));

it.effect("6.10 T3: catches discarding the usage reset deadline from the reply, account event or paused state", () => withAccounts((runner) => Effect.gen(function* () {
  const target = yield* spawn(rig, runner);
  const delivery = yield* send(runner, target, "Accepted current turn.");
  yield* accept(runner, target, delivery);
  const resetAt = (yield* Clock.currentTimeMillis) + 120_000;
  const before = yield* headSequence;
  yield* pauseReply(runner, target, delivery, "out-of-usage", resetAt);
  yield* paused(target, "limit", true, resetAt);
  expect((yield* snapshot).accounts.primary).toMatchObject({ status: "out-of-usage", resetAt });
  const written = yield* logAfter(before);
  expect(tagged(written, "AccountOutOfUsage")).toEqual([{ _tag: "AccountOutOfUsage", accountId: "primary", resetAt }]);
  expect(tagged(written, "OwnerNeeded")).toEqual([]);
})));

it.effect("6.10 T4: catches inventing a reset time or silently parking a usage pause with no owner alert", () => withAccounts((runner) => Effect.gen(function* () {
  const target = yield* spawn(rig, runner);
  const delivery = yield* send(runner, target, "No reset deadline is known.");
  const before = yield* headSequence;
  yield* pauseReply(runner, target, delivery, "out-of-usage");
  yield* paused(target, "limit", false);
  const written = yield* logAfter(before);
  expect(tagged(written, "AccountOutOfUsage")).toEqual([{ _tag: "AccountOutOfUsage", accountId: "primary" }]);
  expect(tagged(written, "OwnerNeeded").some((event) => event.agentId === target.agentId)).toBe(true);
  const callsBefore = runner.calls.length;
  yield* TestClock.adjust("2 days");
  yield* pause(30);
  expect(yield* stateOf(target.agentId)).toBe("paused");
  expect(yield* availableEvents).toEqual([]);
  expect(runner.calls.slice(callsBefore).filter((entry) => entry.method === "prompt")).toEqual([]);
})));

it.effect("6.10 T5: catches returning before the reset time, failing to log its cause, or losing a mid-turn carry-on", () => withAccounts((runner) => Effect.gen(function* () {
  const target = yield* spawn(rig, runner);
  const delivery = yield* send(runner, target, "Already accepted work.");
  yield* accept(runner, target, delivery);
  const resetAt = (yield* Clock.currentTimeMillis) + 120_000;
  yield* pauseReply(runner, target, delivery, "out-of-usage", resetAt);
  yield* paused(target, "limit", true, resetAt);
  const promptsBefore = promptsTo(runner, target).length;
  yield* TestClock.adjust(119_999);
  expect(yield* stateOf(target.agentId)).toBe("paused");
  expect(yield* availableEvents).toEqual([]);
  yield* TestClock.adjust(1);
  yield* waitAvailable;
  const sent = yield* eventually(Effect.sync(() => promptsTo(runner, target).slice(promptsBefore)), (rows) => rows.length === 1);
  expect(sent.map((entry) => entry.input.delivery.content._tag)).toEqual(["carry-on"]);
  expect((yield* availableEvents).map((event) => event.cause)).toEqual(["usage reset"]);
  expect(yield* carryOns(target)).toHaveLength(1);
  expect((yield* deliveryRow(delivery))?.status).toBe("accepted");
  yield* TestClock.adjust("5 minutes");
  expect(promptsTo(runner, target).slice(promptsBefore)).toHaveLength(1);
  expect(yield* carryOns(target)).toHaveLength(1);
})));

it.effect("6.10 T6: catches losing an unaccepted delivery, sending it during the pause, adding a carry-on, or sending it twice on return", () => withAccounts((runner) => Effect.gen(function* () {
  const target = yield* spawn(rig, runner);
  const delivery = yield* send(runner, target, "The adapter has not accepted this.");
  const resetAt = (yield* Clock.currentTimeMillis) + 60_000;
  const before = yield* headSequence;
  yield* pauseReply(runner, target, delivery, "out-of-usage", resetAt);
  yield* paused(target, "limit", false, resetAt);
  expect((yield* deliveryRow(delivery))?.status).toBe("queued");
  expect(tagged(yield* logAfter(before), "DeliveryRequeued").map((event) => event.deliveryId)).toEqual([delivery]);
  const queuedReply = success(yield* call(ownerCredential, "prompt", { agentId: target.agentId, text: "Wait behind the retry." }));
  const promptsBefore = promptsTo(runner, target).length;
  yield* pause(30);
  expect(promptsTo(runner, target).slice(promptsBefore)).toEqual([]);
  yield* TestClock.adjust("1 minute");
  yield* waitAvailable;
  const released = yield* eventually(Effect.sync(() => promptsTo(runner, target).slice(promptsBefore)), (rows) => rows.length === 1);
  expect(released.map((entry) => entry.input.delivery.id)).toEqual([delivery]);
  expect(yield* carryOns(target)).toEqual([]);
  // Accept and finish the retried turn so the delivery held behind it can
  // be released too. Both reach the real dispatch path exactly once.
  yield* accept(runner, target, delivery);
  yield* runner.emit({ _tag: "turnEnded", agentId: target.agentId, incarnation: incarnationOf(target.token) });
  const allReleased = yield* eventually(Effect.sync(() => promptsTo(runner, target).slice(promptsBefore)), (rows) => rows.length === 2);
  expect(allReleased.map((entry) => entry.input.delivery.id)).toEqual([delivery, queuedReply.deliveryId]);
  yield* TestClock.adjust("5 minutes");
  expect(promptsTo(runner, target).slice(promptsBefore).map((entry) => entry.input.delivery.id)).toEqual([delivery, queuedReply.deliveryId]);
})));

for (const order of ["owner-first", "timer-first", "concurrent"] as const) {
  it.effect(`6.10 T7/${order}: catches duplicate carry-ons and retries when owner clear and the reset timer overlap`, () => withAccounts((runner) => Effect.gen(function* () {
    const midTurn = yield* spawn(rig, runner);
    const retry = yield* spawn(rig, runner);
    const accepted = yield* send(runner, midTurn, "Accepted work needs a carry-on.");
    yield* accept(runner, midTurn, accepted);
    const unaccepted = yield* send(runner, retry, "Unaccepted work needs its original delivery.");
    const resetAt = (yield* Clock.currentTimeMillis) + 60_000;
    yield* pauseReply(runner, retry, unaccepted, "out-of-usage", resetAt);
    yield* paused(retry, "limit", false, resetAt);
    yield* pauseReply(runner, midTurn, accepted, "out-of-usage", resetAt);
    yield* paused(midTurn, "limit", true, resetAt);
    const carriesBefore = promptsTo(runner, midTurn).length;
    const retriesBefore = promptsTo(runner, retry).length;
    if (order === "owner-first") { success(yield* markAvailable()); yield* TestClock.adjust("1 minute"); }
    if (order === "timer-first") { yield* TestClock.adjust("1 minute"); yield* waitAvailable; success(yield* markAvailable()); }
    if (order === "concurrent") yield* Effect.all([markAvailable().pipe(Effect.tap((result) => Effect.sync(() => { success(result); }))), TestClock.adjust("1 minute")], { concurrency: "unbounded" });
    yield* waitAvailable;
    yield* eventually(Effect.sync(() => promptsTo(runner, midTurn).length - carriesBefore), (count) => count === 1);
    yield* eventually(Effect.sync(() => promptsTo(runner, retry).length - retriesBefore), (count) => count === 1);
    yield* TestClock.adjust("5 minutes");
    yield* pause(30);
    expect(promptsTo(runner, midTurn).slice(carriesBefore).map((entry) => entry.input.delivery.content._tag)).toEqual(["carry-on"]);
    expect(promptsTo(runner, retry).slice(retriesBefore).map((entry) => entry.input.delivery.id)).toEqual([unaccepted]);
    expect(yield* carryOns(midTurn)).toHaveLength(1);
    expect(yield* carryOns(retry)).toEqual([]);
  })));
}

it.effect("6.10 T8: catches a cancelled usage timer authenticating an account that signed out before its old deadline", () => withAccounts((runner) => Effect.gen(function* () {
  const target = yield* spawn(rig, runner);
  const delivery = yield* send(runner, target, "Use the old usage allocation.");
  yield* accept(runner, target, delivery);
  const resetAt = (yield* Clock.currentTimeMillis) + 120_000;
  yield* pauseReply(runner, target, delivery, "out-of-usage", resetAt);
  yield* paused(target, "limit", true, resetAt);
  success(yield* markAvailable());
  const carry = yield* eventually(carryOns(target), (rows) => rows.length === 1);
  expect(carry).toHaveLength(1);
  const carryId = carry[0]!.id;
  yield* eventually(deliveryRow(carryId), (row) => row?.status === "sent");
  expect(yield* eventually(Effect.sync(() => promptsTo(runner, target).some((entry) => entry.input.delivery.id === carryId)), Boolean)).toBe(true);
  yield* accept(runner, target, carryId);
  yield* pauseReply(runner, target, carryId, "signed-out");
  yield* paused(target, "signed-out", true);
  const before = yield* headSequence;
  const promptsBefore = promptsTo(runner, target).length;
  yield* TestClock.adjust("10 minutes");
  yield* pause(30);
  expect((yield* snapshot).accounts.primary?.status).toBe("needs-sign-in");
  expect(yield* stateOf(target.agentId)).toBe("paused");
  expect(tagged(yield* logAfter(before), "AccountAvailable")).toEqual([]);
  expect(promptsTo(runner, target).slice(promptsBefore)).toEqual([]);
})));

for (const downtime of [30_000, 180_000]) {
  it.effect(`6.10 T9/${downtime}: catches losing the logged pause or ${downtime < 60_000 ? "failing to re-arm a future timer" : "forgetting an overdue reset during recovery"}`, () => Effect.gen(function* () {
    const runner = yield* makeFakeRunner();
    const fakes = { runner, secrets: makeFakeSecrets() };
    const setup = yield* provideRig(rig, fakes, Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAccount();
      yield* seedHarness();
      yield* runner.subscribed;
      yield* timers;
      const target = yield* spawn(rig, runner);
      const delivery = yield* send(runner, target, "A turn paused across service scopes.");
      const resetAt = (yield* Clock.currentTimeMillis) + 120_000;
      yield* pauseReply(runner, target, delivery, "out-of-usage", resetAt);
      yield* paused(target, "limit", false, resetAt);
      return { target, resetAt };
    }).pipe(Effect.provide(runner.layer)));
    // Both the handler and the timer scopes are now closed. The next rig
    // constructs new views from the same SQLite log. Process reload, tokens
    // and other recovery steps belong to unit 6d, so they are not asserted.
    yield* TestClock.adjust(downtime);
    yield* provideRig(rig, fakes, Effect.gen(function* () {
      yield* registerRebuildCheck();
      expect((yield* snapshot).accounts.primary).toMatchObject({ status: "out-of-usage", resetAt: setup.resetAt });
      expect((yield* agentRow(setup.target.agentId))?.state).toEqual({ _tag: "paused", reason: "limit", midTurn: false, resetAt: setup.resetAt });
      const before = yield* headSequence;
      yield* timers;
      if (downtime < 120_000) {
        yield* TestClock.adjust(120_000 - downtime - 1);
        expect(yield* stateOf(setup.target.agentId)).toBe("paused");
        expect(tagged(yield* logAfter(before), "AccountAvailable")).toEqual([]);
        yield* TestClock.adjust(1);
      }
      yield* waitAvailable;
      expect(tagged(yield* logAfter(before), "AccountAvailable").map((event) => event.cause)).toEqual(["usage reset"]);
      expect(yield* eventually(stateOf(setup.target.agentId), (state) => state === "idle" || state === "working")).toMatch(/^(idle|working)$/);
      yield* TestClock.adjust("5 minutes");
      expect(yield* availableEvents).toHaveLength(1);
    }));
  }).pipe(Effect.orDie));
}

it.effect("6.10 T10: catches sleeping only a relative deadline instead of rechecking the wall clock within a minute after host suspension", () => Effect.gen(function* () {
  const underlying = yield* TestClock.testClockWith((clock) => Effect.succeed(clock));
  let wallOffset = 0;
  // Only wall time jumps. Sleep and monotonic time still use Effect's
  // TestClock, modelling a suspended host whose remaining sleep did not run.
  const wallClock: TestClock.TestClock = {
    ...underlying,
    currentTimeMillisUnsafe: () => underlying.currentTimeMillisUnsafe() + wallOffset,
    currentTimeMillis: Effect.sync(() => underlying.currentTimeMillisUnsafe() + wallOffset),
    currentTimeNanosUnsafe: () => underlying.currentTimeNanosUnsafe() + BigInt(wallOffset) * 1_000_000n,
    currentTimeNanos: Effect.sync(() => underlying.currentTimeNanosUnsafe() + BigInt(wallOffset) * 1_000_000n),
  };
  yield* withAccounts((runner) => Effect.gen(function* () {
    const target = yield* spawn(rig, runner);
    const delivery = yield* send(runner, target, "Paused before the host sleeps.");
    const resetAt = (yield* Clock.currentTimeMillis) + 86_400_000;
    yield* pauseReply(runner, target, delivery, "out-of-usage", resetAt);
    yield* paused(target, "limit", false, resetAt);
    wallOffset = 86_405_000;
    yield* TestClock.adjust("1 minute");
    yield* waitAvailable;
    expect((yield* availableEvents).map((event) => event.cause)).toEqual(["usage reset"]);
  })).pipe(Effect.provideService(Clock.Clock, wallClock));
}).pipe(Effect.orDie));
