import { it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { afterEach, beforeEach, expect, vi } from "vitest";

import * as Views from "../../src/views/Views.ts";
import * as Restart from "../../src/recovery/restart.ts";
import { accept, notice, send, spawn, type Spawned } from "../support/deliveryRig.ts";
import { makeFakeRunner, sessionFor, type FakeRunner } from "../support/fakeRunner.ts";
import {
  agentRow, call, headSequence, logAfter, makeRig, ownerCredential, readLog, removeRig,
  seedAccount, seedAgent, seedHarness, stateOf, success, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { appendEvents, carryRows, promptsAfter, provideRestart, queued, ready, recover } from "../support/restartRig.ts";
import { deliveryRow, eventually, pause, snapshot, tagged } from "../support/routingRig.ts";
import { withViews } from "../support/withViews.ts";

let rig: Rig;
beforeEach(() => {
  rig = makeRig();
  vi.stubEnv("LGTM_HOME", rig.stateFolder);
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("CODEX_HOME", `${rig.home}/.codex`);
});
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });

const test = (name: string, body: () => Effect.Effect<unknown, unknown, any>) =>
  it.effect(name, () => body() as Effect.Effect<unknown, unknown, never>);

const history = <A, E, R>(body: (runner: FakeRunner) => Effect.Effect<A, E, R>) => Effect.gen(function* () {
  const runner = yield* makeFakeRunner();
  return yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedAccount();
    yield* seedHarness();
    yield* runner.subscribed;
    return yield* body(runner);
  }), { recovering: false });
});

const pausedTurn = (runner: FakeRunner, reason: "out-of-usage" | "signed-out", midTurn: boolean, resetAt?: number) => Effect.gen(function* () {
  const target = yield* spawn(rig, runner);
  const delivery = yield* send(runner, target, "Work that survives account downtime.");
  if (midTurn) yield* accept(runner, target, delivery);
  yield* notice(runner, target, { _tag: "promptReply", deliveryId: delivery, outcome: {
    _tag: "pause", reason, error: "private-reset-diagnostic", ...(resetAt === undefined ? {} : { resetAt }),
  } });
  expect((yield* eventually(agentRow(target.agentId), (row) => row?.state._tag === "paused"))?.state).toEqual({
    _tag: "paused", reason: reason === "signed-out" ? "signed-out" : "limit", midTurn,
    ...(reason === "out-of-usage" && resetAt !== undefined ? { resetAt } : {}),
  });
  return { target, delivery };
});

const checkOnce = (runner: FakeRunner, watermark: number, target: Spawned, deliveryId: string) => Effect.gen(function* () {
  const calls = yield* eventually(Effect.sync(() => promptsAfter(runner, watermark, target.agentId)), (rows) => rows.length === 1);
  expect(calls.map((entry) => entry.input.delivery.id)).toEqual([deliveryId]);
  yield* TestClock.adjust("5 minutes");
  yield* pause(30);
  expect(promptsAfter(runner, watermark, target.agentId).map((entry) => entry.input.delivery.id)).toEqual([deliveryId]);
});

test("6.10 A01: catches clearing a future usage pause on restart, reloading it at step 7, or forgetting its logged reset deadline", () => Effect.gen(function* () {
  const resetAt = (yield* Clock.currentTimeMillis) + 120_000;
  const old = yield* history((runner) => pausedTurn(runner, "out-of-usage", false, resetAt));
  yield* TestClock.adjust(30_000);
  const runner = yield* makeFakeRunner();
  yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck();
    const watermark = runner.calls.length;
    const before = yield* headSequence;
    yield* recover;
    expect((yield* agentRow(old.target.agentId))?.state).toEqual({ _tag: "paused", reason: "limit", midTurn: false, resetAt });
    expect(runner.callsOf("load")).toEqual([]);
    expect(promptsAfter(runner, watermark, old.target.agentId).map((entry) => entry.input.delivery.id)).toEqual([]);
    yield* TestClock.adjust(89_999);
    expect(yield* stateOf(old.target.agentId)).toBe("paused");
    expect(tagged(yield* logAfter(before), "AccountAvailable")).toEqual([]);
    yield* TestClock.adjust(1);
    yield* checkOnce(runner, watermark, old.target, old.delivery);
    expect(runner.callsOf("load").map((entry) => entry.input.agentId)).toEqual([old.target.agentId]);
    expect(tagged(yield* logAfter(before), "AccountAvailable")).toEqual([{ _tag: "AccountAvailable", accountId: "primary", cause: "usage reset" }]);
    expect(yield* carryRows(old.target.agentId)).toEqual([]);
  }));
}));

test("6.10 A02 steps 8-10: catches missing an overdue reset, sending during return reconciliation, or retrying accepted work instead of one carry-on", () => Effect.gen(function* () {
  const resetAt = (yield* Clock.currentTimeMillis) + 60_000;
  const old = yield* history((runner) => Effect.gen(function* () {
    const paused = yield* pausedTurn(runner, "out-of-usage", true, resetAt);
    yield* seedAccount("other");
    const active = yield* spawn(rig, runner, undefined, { account: { _tag: "named", accountId: "other" } });
    return { ...paused, active };
  }));
  yield* TestClock.adjust(180_000);
  const runner = yield* makeFakeRunner();
  yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck();
    const views = yield* Views.Views;
    const service = yield* Restart.Restart;
    const watermark = runner.calls.length;
    runner.script("load", (input) => Effect.gen(function* () {
      // Step 7's ordinary reload precedes step 8. The paused agent's return
      // reload follows the availability commit, while dispatch stays gated.
      expect((yield* views.snapshot).accounts.primary?.status).toBe(input.agentId === old.active.agentId ? "out-of-usage" : "available");
      expect(yield* service.ready).toBe(false);
      expect(promptsAfter(runner, watermark, old.target.agentId).map((entry) => entry.input.delivery.id)).toEqual([]);
      return sessionFor(input.agentId);
    }));
    const before = yield* headSequence;
    yield* recover;
    expect(yield* ready).toBe(true);
    const carry = yield* carryRows(old.target.agentId);
    expect(carry).toHaveLength(1);
    yield* checkOnce(runner, watermark, old.target, carry[0]!.id);
    expect((yield* deliveryRow(old.delivery))?.status).toBe("accepted");
    const written = yield* logAfter(before);
    expect(runner.callsOf("load").filter((entry) => entry.input.agentId === old.target.agentId).map((entry) => entry.input.agentId)).toEqual([old.target.agentId]);
    expect(tagged(written, "AccountAvailable").map((event) => event.cause)).toEqual(["usage reset"]);
    const activeReload = written.find((row) => row.event._tag === "SessionOpened" && row.event.agentId === old.active.agentId)!;
    const available = written.find((row) => row.event._tag === "AccountAvailable")!;
    const sent = written.find((row) => row.event._tag === "DeliverySent" && row.event.deliveryId === carry[0]!.id)!;
    expect(activeReload.sequence).toBeLessThan(available.sequence);
    expect(available.sequence).toBeLessThan(sent.sequence);
  }));
}));

test("6.10 A03 issue 116: catches an available account leaving its agents paused when the service crashed before the return transaction", () => Effect.gen(function* () {
  const resetAt = (yield* Clock.currentTimeMillis) + 60_000;
  const old = yield* history((runner) => pausedTurn(runner, "out-of-usage", true, resetAt));
  // The handler has shut down. Commit only the availability side of the
  // real two-transaction journey; no live follower can complete it here.
  yield* withViews(rig.root, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* appendEvents({ _tag: "AccountAvailable", accountId: "primary", cause: "usage reset" });
    expect(yield* stateOf(old.target.agentId)).toBe("paused");
  }));
  const runner = yield* makeFakeRunner();
  yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck();
    const before = yield* headSequence;
    const watermark = runner.calls.length;
    yield* recover;
    const carry = yield* carryRows(old.target.agentId);
    expect(carry).toHaveLength(1);
    yield* checkOnce(runner, watermark, old.target, carry[0]!.id);
    expect(tagged(yield* logAfter(before), "AccountAvailable")).toEqual([]);
    const settledAt = yield* headSequence;
    const callsAt = runner.calls.length;
    yield* recover;
    expect(yield* logAfter(settledAt)).toEqual([]);
    expect(promptsAfter(runner, callsAt, old.target.agentId).map((entry) => entry.input.delivery.id)).toEqual([]);
  }));
}));

test("6.10 A04: catches a restart or stale usage timer clearing a signed-out pause before accounts mark-available", () => Effect.gen(function* () {
  const old = yield* history((runner) => pausedTurn(runner, "signed-out", true));
  yield* TestClock.adjust("2 days");
  const runner = yield* makeFakeRunner();
  yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck();
    const before = yield* headSequence;
    const watermark = runner.calls.length;
    yield* recover;
    yield* TestClock.adjust("2 days");
    yield* pause(30);
    expect((yield* agentRow(old.target.agentId))?.state).toEqual({ _tag: "paused", reason: "signed-out", midTurn: true });
    expect((yield* snapshot).accounts.primary?.status).toBe("needs-sign-in");
    expect(runner.callsOf("load")).toEqual([]);
    expect(promptsAfter(runner, watermark, old.target.agentId).map((entry) => entry.input.delivery.id)).toEqual([]);
    expect(tagged(yield* logAfter(before), "AccountAvailable")).toEqual([]);
    success(yield* call(ownerCredential, "accounts mark-available", { accountId: "primary" }));
    const carry = yield* eventually(carryRows(old.target.agentId), (rows) => rows.length === 1);
    expect(carry).toHaveLength(1);
    yield* checkOnce(runner, watermark, old.target, carry[0]!.id);
    expect(runner.callsOf("load").map((entry) => entry.input.agentId)).toEqual([old.target.agentId]);
    expect(tagged(yield* logAfter(before), "AccountAvailable").map((event) => event.cause)).toEqual(["owner cleared"]);
  }));
}));

test("6.7/6.10 A05: catches a failed paused-agent return dropping its pause or sending with a session that never reloaded", () => Effect.gen(function* () {
  const old = yield* history((runner) => pausedTurn(runner, "signed-out", true));
  const runner = yield* makeFakeRunner();
  yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* recover;
    runner.rejectNext("load", "private-return-secret");
    const before = yield* headSequence;
    const watermark = runner.calls.length;
    success(yield* call(ownerCredential, "accounts mark-available", { accountId: "primary" }));
    const written = yield* eventually(logAfter(before), (rows) => tagged(rows, "AgentReloadFailed").length === 1);
    expect(tagged(written, "AgentReloadFailed")).toEqual([{ _tag: "AgentReloadFailed", agentId: old.target.agentId, reason: "agent reload failed" }]);
    expect((yield* agentRow(old.target.agentId))?.state).toEqual({ _tag: "paused", reason: "signed-out", midTurn: true });
    expect(promptsAfter(runner, watermark, old.target.agentId).map((entry) => entry.input.delivery.id)).toEqual([]);
    expect(yield* carryRows(old.target.agentId)).toEqual([]);
    expect(JSON.stringify([yield* readLog, yield* snapshot])).not.toContain("private-return-secret");
  }));
}));

test("6.10 A06 row 53: catches dropping the first prompt or loading a nonexistent session when a pre-session pause clears after restart (issue 115)", () => Effect.gen(function* () {
  const resetAt = (yield* Clock.currentTimeMillis) + 60_000;
  yield* history(() => Effect.gen(function* () {
    yield* seedAgent({ id: "pre-session", state: "starting" });
    yield* appendEvents(queued("pre-session", "first-prompt"),
      { _tag: "AccountOutOfUsage", accountId: "primary", resetAt },
      { _tag: "StateChanged", agentId: "pre-session", state: { _tag: "paused", reason: "limit", midTurn: false, resetAt } });
    expect((yield* agentRow("pre-session"))?.session).toBeUndefined();
  }));
  const runner = yield* makeFakeRunner();
  yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck();
    const watermark = runner.calls.length;
    yield* recover;
    expect(runner.callsOf("start")).toEqual([]);
    expect(runner.callsOf("load")).toEqual([]);
    yield* TestClock.adjust(60_000);
    yield* eventually(Effect.sync(() => promptsAfter(runner, watermark, "pre-session").length), (count) => count === 1);
    expect(runner.callsOf("start").map((entry) => entry.input.agentId)).toEqual(["pre-session"]);
    expect(runner.callsOf("load")).toEqual([]);
    expect(promptsAfter(runner, watermark, "pre-session").map((entry) => entry.input.delivery.id)).toEqual(["first-prompt"]);
    expect(yield* carryRows("pre-session")).toEqual([]);
  }));
}));
