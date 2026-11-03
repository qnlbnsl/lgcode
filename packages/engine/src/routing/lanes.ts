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

// Fix round 1, A3, and round 2 (F-1, F-2): `stop` pre-empts a start whose
// adapter setup is still running, instead of queueing behind it for the lane.
//
// Each agent has at most one record, shared by its start and by the stops
// that pre-empt it. A stop calls `preempt` before it queues for the lane. The
// call completes the record's cancel signal and returns the stop's `settle`
// step, which the stop runs when its command ends in any way: committed,
// refused, failed or interrupted. The start's `cancellable` step gives up its
// setup on the signal, which interrupts the runner call, and returns `none`.
// The start then leaves the lane and waits for `settled`, so it can see how
// the stop ended; if the agent is still starting it writes the failure
// itself (start.ts). A stop that is refused after it cancelled a setup
// therefore cannot leave the agent without a terminal outcome (round 2, F-1).
//
// Either side may create the record. A stop that signals before the start has
// registered leaves the signal in the record, and the start reads it at
// registration (F-2). A record the start never registered is dropped when its
// last stop settles. Only a start registers one, so `preempt` of any other
// lane holder (a stalled send, flow3 F-5) does nothing.
interface StartRecord {
  readonly cancel: Deferred.Deferred<void>;
  readonly stops: Array<Deferred.Deferred<void>>;
  registered: boolean;
}

const records = new WeakMap<Log, Map<string, StartRecord>>();

const recordFor = (log: Log, agentId: string): StartRecord => {
  let byAgent = records.get(log);
  if (byAgent === undefined) records.set(log, byAgent = new Map());
  let record = byAgent.get(agentId);
  if (record === undefined) byAgent.set(agentId, record = { cancel: Deferred.makeUnsafe<void>(), stops: [], registered: false });
  return record;
};

const forget = (log: Log, agentId: string, record: StartRecord) => {
  const byAgent = records.get(log);
  if (byAgent?.get(agentId) === record) byAgent.delete(agentId);
};

export interface Preemptible {
  // Runs `effect` unless the signal arrives first; `none` means it was
  // cancelled, before or during the run.
  readonly cancellable: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<Option.Option<A>, E, R>;
  // Waits until every stop that signalled has ended, but at most
  // `timeoutMillis`, so a stop that never ends cannot hold the start.
  readonly settled: (timeoutMillis: number) => Effect.Effect<void>;
}

export const withPreemption = (log: Log, agentId: string) =>
  <A, E, R>(use: (handle: Preemptible) => Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => Effect.acquireUseRelease(
    Effect.sync(() => {
      const record = recordFor(log, agentId);
      record.registered = true;
      return record;
    }),
    (record) => use({
      cancellable: (effect) => Deferred.isDone(record.cancel).pipe(Effect.flatMap((done) => done
        ? Effect.succeed(Option.none())
        : Effect.raceFirst(Effect.map(effect, Option.some), Deferred.await(record.cancel).pipe(Effect.as(Option.none()))))),
      settled: (timeoutMillis) => Effect.suspend(() => Effect.forEach(record.stops.slice(), (stop) => Deferred.await(stop), { discard: true })).pipe(
        Effect.timeoutOption(timeoutMillis), Effect.asVoid),
    }),
    (record) => Effect.sync(() => forget(log, agentId, record)),
  );

// Signals the agent's start, if any. The result is the `settle` step: run it
// when the stop command ends, whatever the way (it is idempotent).
export const preempt = (log: Log, agentId: string): Effect.Effect<Effect.Effect<void>> => Effect.sync(() => {
  const record = recordFor(log, agentId);
  const stop = Deferred.makeUnsafe<void>();
  record.stops.push(stop);
  Deferred.doneUnsafe(record.cancel, Effect.void);
  return Effect.sync(() => {
    Deferred.doneUnsafe(stop, Effect.void);
    if (!record.registered && record.stops.every((other) => Deferred.isDoneUnsafe(other))) forget(log, agentId, record);
  });
});
