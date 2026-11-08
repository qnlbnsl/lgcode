import type { AgentId } from "@lgcode/contracts";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import { expect, vi } from "vitest";
import type { Snapshot } from "../../src/commands/internal.ts";
import * as deliveries from "../../src/routing/deliveries.ts";
import { makeFakeRunner, type FakeRunner } from "./fakeRunner.ts";
import { notice, send, spawn, waitFor, type Spawned } from "./deliveryRig.ts";
import {
  headSequence, logAfter, makeFakeSecrets, makeRig, provideRig, removeRig,
  seedAccount, seedHarness, type Logged, type Rig,
} from "./handlerRig.ts";
import { eventually, snapshot } from "./routingRig.ts";

export type CapacityCondition = (agentId: AgentId, snapshot: Snapshot) => unknown;
export const eventsNamed = (rows: ReadonlyArray<Logged>, name: string) => rows
  .filter(({ event }) => event._tag === name)
  .map(({ event }) => event as unknown as Record<string, unknown>);

// Intended WS-7b seam: the engine owns this count, reconstructed from its log,
// not a lagging roles record. The helper does not calculate a substitute count.
export const capacityCount = (snapshot: Snapshot, agentId: AgentId): number => {
  const fn = (deliveries as unknown as {
    capacityHoldCount?: (snapshot: Snapshot, agentId: AgentId) => number;
  }).capacityHoldCount;
  expect(fn, "WS-7b must expose the engine's capacityHoldCount(snapshot, agentId)").toBeTypeOf("function");
  return fn!(snapshot, agentId);
};

export const runCapacity = async <A>(
  body: (rig: Rig, runner: FakeRunner) => Effect.Effect<A, any, any>,
  condition: CapacityCondition | null = () => true,
  options: {
    readonly lists?: import("../../src/pieces/lists.ts").EngineLists;
    readonly afterClose?: (rig: Rig, value: A) => Effect.Effect<void, any, any>;
    readonly logLines?: Array<string>;
  } = {},
): Promise<A> => {
  const rig = makeRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("LGCODE_HOME", rig.stateFolder);
  try {
    const program = Effect.gen(function* () {
      const runner = yield* makeFakeRunner();
      return yield* provideRig(rig, {
        runner, secrets: makeFakeSecrets(),
        ...(condition === null ? {} : { capacityHoldCondition: condition }),
        ...(options.lists === undefined ? {} : { lists: options.lists }),
      }, Effect.gen(function* () {
        yield* seedAccount(); yield* seedHarness(); yield* runner.subscribed;
        return yield* body(rig, runner);
      }));
    }) as Effect.Effect<A, any>;
    const value = await Effect.runPromise(options.logLines === undefined ? program : program.pipe(Effect.provide(
      Logger.layer([Logger.make((entry) => { options.logLines!.push(Logger.formatJson.log(entry)); })]),
    )));
    if (options.afterClose !== undefined) await Effect.runPromise(options.afterClose(rig, value) as Effect.Effect<void, any>);
    return value;
  } finally { vi.unstubAllEnvs(); removeRig(rig); }
};

export const capacityReply = (runner: FakeRunner, target: Spawned, deliveryId: string) =>
  notice(runner, target, { _tag: "promptReply", deliveryId, outcome: { _tag: "capacity", error: "provider temporarily overloaded" } });

export const hold = (runner: FakeRunner, target: Spawned, deliveryId: string) => Effect.gen(function* () {
  const accepted = (yield* snapshot).deliveries[deliveryId]?.status === "accepted";
  const before = yield* headSequence;
  yield* capacityReply(runner, target, deliveryId);
  const rows = yield* eventually(logAfter(before), (rows) => eventsNamed(rows, "DeliveryHeld").length > 0);
  expect(eventsNamed(rows, "DeliveryHeld"), "capacity outcome must open one queue hold through the real handler").toEqual([
    { _tag: "DeliveryHeld", agentId: target.agentId, deliveryId: accepted ? expect.any(String) : deliveryId, reason: "capacity" },
  ]);
  return rows;
});

export const startHeld = (rig: Rig, runner: FakeRunner, parent?: Spawned) => Effect.gen(function* () {
  const target = yield* spawn(rig, runner, parent);
  const deliveryId = yield* send(runner, target, "Original work, which must not be repeated after acceptance.");
  const rows = yield* hold(runner, target, deliveryId);
  return { target, deliveryId, rows };
});

export const openBlockingWait = (waiter: Spawned, target: Spawned) => Effect.gen(function* () {
  const fiber = yield* waitFor(waiter, [target], "all", true).pipe(Effect.forkChild);
  const state = yield* eventually(snapshot, (state) => Object.values(state.waits).some((row) => row.agentId === waiter.agentId && row.status === "open"));
  const row = Object.values(state.waits).find((row) => row.agentId === waiter.agentId && row.status === "open");
  expect(row, "the blocking wait must be durably open before the capacity event").toBeDefined();
  return { fiber, waitId: row!.waitId };
});
