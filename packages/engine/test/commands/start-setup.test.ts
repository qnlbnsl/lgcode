import { it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { LogWriteFailed } from "../../src/log/EventLog.ts";
import { preempt, withPreemption } from "../../src/routing/lanes.ts";
import { SETUP_TIMEOUT_MILLIS } from "../../src/recovery/reload.ts";
import { makeFakeRunner } from "../support/fakeRunner.ts";
import {
  agentRow, call, deviceCredential, failureOf, freshRequest, makeFakeSecrets, makeRig, ownerCredential, provideRig,
  readLog, removeRig, seedAccount, seedHarness, startPayload, success, type Fakes, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually, pause, tagged } from "../support/routingRig.ts";

// Fix round 1, A3 (owner's choice, 2026-11-03): the plain `start` setup is
// bounded by the same two minutes as `resume`, and `stop` of a starting agent
// pre-empts a setup that is still running instead of queueing behind it for
// the agent's lane.

let rig: Rig;
beforeEach(() => {
  rig = makeRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPHRD_HOME", rig.stateFolder);
});
afterEach(() => {
  vi.unstubAllEnvs();
  removeRig(rig);
});

const withRig = <A, E, R>(body: (fakes: Fakes) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fakes: Fakes = { runner: yield* makeFakeRunner(), secrets: makeFakeSecrets() };
    return yield* provideRig(rig, fakes, Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAccount();
      yield* seedHarness();
      return yield* body(fakes);
    }));
  });

// The agent id of the one started agent, once the fake runner has been called.
const startedAgent = (fakes: Fakes) => Effect.gen(function* () {
  const calls = yield* eventually(Effect.sync(() => fakes.runner.callsOf("start")), (rows) => rows.length === 1);
  expect(calls).toHaveLength(1);
  return calls[0]!.input.agentId;
});

it.live("A3 stop: catches a stop that queues behind a start whose setup never returns", () =>
  withRig((fakes) => Effect.gen(function* () {
    let interrupted = false;
    fakes.runner.script("start", () => Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => { interrupted = true; }))));
    const starting = yield* call(ownerCredential, "start", startPayload(rig)).pipe(Effect.forkScoped);
    const agentId = yield* startedAgent(fakes);
    expect((yield* agentRow(agentId))?.state._tag).toBe("starting");

    // Well inside the two-minute bound, so only a pre-empting stop passes.
    const outcome = yield* call(ownerCredential, "stop", { agentId }).pipe(
      Effect.timeoutOption(5_000),
    );
    expect(outcome._tag).toBe("Some");
    if (outcome._tag === "Some") success(outcome.value);

    expect((yield* agentRow(agentId))?.state._tag).toBe("stopped");
    expect(interrupted).toBe(true);
    expect(fakes.runner.callsOf("stop").map((entry) => entry.input.agentId)).toContain(agentId);
    // The cancelled start writes no failure of its own: the owner stopped it.
    const rows = yield* readLog;
    expect(tagged(rows, "AgentStartFailed")).toEqual([]);
    expect(tagged(rows, "SessionOpened")).toEqual([]);
    expect(tagged(rows, "AgentStopped")).toHaveLength(1);
    yield* Fiber.join(starting);
    // A stop leaves no second process and no later spawn.
    expect(fakes.runner.callsOf("start")).toHaveLength(1);
  })).pipe(Effect.orDie), 20_000);

it.live("A3 stop: catches a stop from a caller with no right to it that cancels a running setup", () =>
  withRig((fakes) => Effect.gen(function* () {
    let interrupted = false;
    fakes.runner.script("start", () => Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => { interrupted = true; }))));
    yield* call(ownerCredential, "start", startPayload(rig)).pipe(Effect.forkScoped);
    const agentId = yield* startedAgent(fakes);
    // A device credential that was never issued; it queues for the lane and
    // is refused there, and must not have touched the setup.
    yield* call(deviceCredential("shp_d_not-issued"), "stop", { agentId }).pipe(Effect.forkScoped);
    yield* pause(300);
    expect(interrupted).toBe(false);
    expect((yield* agentRow(agentId))?.state._tag).toBe("starting");
    expect(fakes.runner.callsOf("stop")).toEqual([]);
  })).pipe(Effect.orDie), 20_000);

it.effect("A3 timeout: catches a plain start whose setup is not bounded at two minutes", () =>
  withRig((fakes) => Effect.gen(function* () {
    fakes.runner.script("start", () => Effect.never);
    const starting = yield* call(ownerCredential, "start", startPayload(rig)).pipe(Effect.forkScoped);
    const agentId = yield* startedAgent(fakes);
    yield* pause(30);

    yield* TestClock.adjust(SETUP_TIMEOUT_MILLIS - 1);
    yield* pause(30);
    expect((yield* agentRow(agentId))?.state._tag).toBe("starting");
    expect(fakes.runner.callsOf("stop")).toEqual([]);

    yield* TestClock.adjust(1);
    yield* eventually(agentRow(agentId), (row) => row?.state._tag === "stopped");
    yield* Fiber.join(starting);

    const rows = yield* readLog;
    // The fixed reason, never the runner's.
    expect(tagged(rows, "AgentStartFailed")).toEqual([{ _tag: "AgentStartFailed", agentId, reason: "agent start failed" }]);
    expect(tagged(rows, "SessionOpened")).toEqual([]);
    expect(fakes.runner.callsOf("stop").map((entry) => entry.input.agentId)).toEqual([agentId]);
    const sql = yield* SqlClient.SqlClient;
    const tokens = yield* sql<{ revoked_at: number | null }>`SELECT revoked_at FROM agent_tokens WHERE agent_id = ${agentId}`;
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.revoked_at).not.toBeNull();
  })).pipe(Effect.orDie));

// Fix round 2, A3 F-1: a stop that cancels a setup may still be refused,
// fail to commit or be interrupted. Whatever happens to the stop, the agent
// must end terminal: by the stop's own commit, or by the cancelled start
// writing `AgentStartFailed` and revoking the token.
type Fault = "none" | "fail" | "hold";
const withFaultyLog = <A, E, R>(fault: { mode: Fault; readonly gate: Deferred.Deferred<void> }, body: (fakes: Fakes) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fakes: Fakes = {
      runner: yield* makeFakeRunner(), secrets: makeFakeSecrets(),
      // The next writer transaction fails, or waits for the gate; it is the stop's.
      wrapLog: (real) => ({ ...real, transact: ((transaction: Parameters<typeof real.transact>[0]) => {
        const mode = fault.mode;
        fault.mode = "none";
        if (mode === "fail") return Effect.fail(new LogWriteFailed({ reason: "test writer failure" }));
        if (mode === "hold") return Deferred.await(fault.gate).pipe(Effect.andThen(real.transact(transaction)));
        return real.transact(transaction);
      }) as typeof real.transact }),
    };
    return yield* provideRig(rig, fakes, Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAccount();
      yield* seedHarness();
      return yield* body(fakes);
    }));
  });

const expectFailedStart = (fakes: Fakes, agentId: string) => Effect.gen(function* () {
  yield* eventually(agentRow(agentId), (row) => row?.state._tag === "stopped");
  expect((yield* agentRow(agentId))?.state._tag).toBe("stopped");
  const rows = yield* readLog;
  expect(tagged(rows, "AgentStartFailed")).toEqual([{ _tag: "AgentStartFailed", agentId, reason: "agent start failed" }]);
  expect(tagged(rows, "SessionOpened")).toEqual([]);
  expect(fakes.runner.callsOf("stop").map((entry) => entry.input.agentId)).toContain(agentId);
  const sql = yield* SqlClient.SqlClient;
  const tokens = yield* sql<{ revoked_at: number | null }>`SELECT revoked_at FROM agent_tokens WHERE agent_id = ${agentId}`;
  expect(tokens).toHaveLength(1);
  expect(tokens[0]!.revoked_at).not.toBeNull();
});

const hungStart = (fakes: Fakes, requestId?: string) => Effect.gen(function* () {
  let interrupted = false;
  fakes.runner.script("start", () => Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => { interrupted = true; }))));
  const starting = yield* call(ownerCredential, "start", startPayload(rig, requestId === undefined ? {} : { requestId })).pipe(Effect.forkScoped);
  const agentId = yield* startedAgent(fakes);
  return { starting, agentId, wasInterrupted: () => interrupted };
});

it.live("A3 refused stop (F-1): catches a stop refused for a reused request id that cancels the setup and leaves the agent starting", () =>
  Effect.gen(function* () {
    const fault = { mode: "none" as Fault, gate: yield* Deferred.make<void>() };
    yield* withFaultyLog(fault, (fakes) => Effect.gen(function* () {
      const requestId = freshRequest();
      const { starting, agentId, wasInterrupted } = yield* hungStart(fakes, requestId);
      const outcome = yield* call(ownerCredential, "stop", { agentId, requestId }).pipe(Effect.timeoutOption(5_000));
      expect(outcome._tag).toBe("Some");
      if (outcome._tag === "Some") expect(failureOf(outcome.value)?.reason).toBe("request id reused");
      expect(wasInterrupted()).toBe(true);
      yield* Fiber.join(starting);
      yield* expectFailedStart(fakes, agentId);
    }));
  }).pipe(Effect.orDie), 20_000);

it.live("A3 failed stop (F-1): catches a stop whose transaction fails to commit after it cancelled the setup, which leaves the agent starting", () =>
  Effect.gen(function* () {
    const fault = { mode: "none" as Fault, gate: yield* Deferred.make<void>() };
    yield* withFaultyLog(fault, (fakes) => Effect.gen(function* () {
      const { starting, agentId, wasInterrupted } = yield* hungStart(fakes);
      fault.mode = "fail";
      const outcome = yield* call(ownerCredential, "stop", { agentId }).pipe(Effect.timeoutOption(5_000));
      expect(outcome._tag).toBe("Some");
      if (outcome._tag === "Some") expect(failureOf(outcome.value)?._tag).toBe("LogWriteFailed");
      expect(wasInterrupted()).toBe(true);
      yield* Fiber.join(starting);
      yield* expectFailedStart(fakes, agentId);
    }));
  }).pipe(Effect.orDie), 20_000);

it.live("A3 interrupted stop (F-1): catches a stop interrupted between its signal and its commit that leaves the agent starting", () =>
  Effect.gen(function* () {
    const fault = { mode: "none" as Fault, gate: yield* Deferred.make<void>() };
    yield* withFaultyLog(fault, (fakes) => Effect.gen(function* () {
      const { starting, agentId, wasInterrupted } = yield* hungStart(fakes);
      fault.mode = "hold";
      const stopping = yield* call(ownerCredential, "stop", { agentId }).pipe(Effect.forkScoped);
      // The setup is cancelled by the signal; the stop waits at its commit.
      yield* eventually(Effect.sync(wasInterrupted), (done) => done);
      expect(wasInterrupted()).toBe(true);
      yield* Fiber.interrupt(stopping);
      yield* Fiber.join(starting);
      yield* expectFailedStart(fakes, agentId);
    }));
  }).pipe(Effect.orDie), 20_000);

// Fix round 2, A3 F-2: a stop's signal must not be lost when it arrives
// before the start has registered its handle.
it.effect("A3 early signal (F-2): catches a stop signal sent before the start registers that is lost", () =>
  Effect.gen(function* () {
    const log = {} as Parameters<typeof withPreemption>[0];
    const settle = yield* preempt(log, "early");
    let ran = false;
    const result = yield* withPreemption(log, "early")((handle) => handle.cancellable(Effect.sync(() => { ran = true; })));
    expect(Option.isNone(result)).toBe(true);
    expect(ran).toBe(false);
    yield* settle;
  }));

it.effect("A3 early signal (F-2): catches a signal from a stop that has already ended that cancels a later start", () =>
  Effect.gen(function* () {
    const log = {} as Parameters<typeof withPreemption>[0];
    yield* (yield* preempt(log, "ended"));
    const result = yield* withPreemption(log, "ended")((handle) => handle.cancellable(Effect.succeed("ran")));
    expect(result).toEqual(Option.some("ran"));
  }));
