import type * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";

import type { EventLog } from "../log/EventLog.ts";

// One send lane per agent (fix round 1, F3 and F6). A send to an agent and a
// change to that agent's process (`start`, `stop`, `resume`) take the agent's
// lane, so a send reserved before a stop never reaches the runner after it,
// and a slow send to one agent holds up no other agent.
//
// The order is always the lane first, then the writer's permit. Nothing takes
// a lane while it holds the writer, so the two cannot deadlock.
//
// The lanes belong to one event log, the engine's single writer, and an entry
// is removed when its last user leaves it.
type Log = Context.Service.Shape<typeof EventLog>;

interface Lane {
  readonly semaphore: Semaphore.Semaphore;
  users: number;
}

const registry = new WeakMap<Log, Map<string, Lane>>();

export const withLane = (log: Log, agentId: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => Effect.acquireUseRelease(
    Effect.sync(() => {
      let lanes = registry.get(log);
      if (lanes === undefined) registry.set(log, lanes = new Map());
      let lane = lanes.get(agentId);
      if (lane === undefined) lanes.set(agentId, lane = { semaphore: Semaphore.makeUnsafe(1), users: 0 });
      lane.users += 1;
      return lane;
    }),
    (lane) => lane.semaphore.withPermit(effect),
    (lane) => Effect.sync(() => {
      lane.users -= 1;
      if (lane.users === 0) registry.get(log)?.delete(agentId);
    }),
  );

// Fix round 1, A3: `stop` pre-empts a start whose adapter setup is still
// running, instead of queueing behind it for the lane. The start registers a
// cancel signal for its agent before it asks for the lane and drops it when
// its post-commit step ends. `preempt` completes the signal; the start's
// `cancellable` step then gives up its setup, which interrupts the runner
// call, and returns `none`. Only a start registers one, so `preempt` of any
// other lane holder (a stalled send, flow3 F-5) does nothing.
const cancels = new WeakMap<Log, Map<string, Deferred.Deferred<void>>>();

export interface Preemptible {
  // Runs `effect` unless the signal arrives first; `none` means it was
  // cancelled, before or during the run.
  readonly cancellable: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<Option.Option<A>, E, R>;
}

export const withPreemption = (log: Log, agentId: string) =>
  <A, E, R>(use: (handle: Preemptible) => Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => Effect.acquireUseRelease(
    Effect.sync(() => {
      let signals = cancels.get(log);
      if (signals === undefined) cancels.set(log, signals = new Map());
      const signal = Deferred.makeUnsafe<void>();
      signals.set(agentId, signal);
      return signal;
    }),
    (signal) => use({
      cancellable: (effect) => Deferred.isDone(signal).pipe(Effect.flatMap((done) => done
        ? Effect.succeed(Option.none())
        : Effect.raceFirst(Effect.map(effect, Option.some), Deferred.await(signal).pipe(Effect.as(Option.none()))))),
    }),
    (signal) => Effect.sync(() => {
      const signals = cancels.get(log);
      if (signals?.get(agentId) === signal) signals.delete(agentId);
    }),
  );

export const preempt = (log: Log, agentId: string): Effect.Effect<void> => Effect.suspend(() => {
  const signal = cancels.get(log)?.get(agentId);
  return signal === undefined ? Effect.void : Deferred.succeed(signal, undefined).pipe(Effect.asVoid);
});
