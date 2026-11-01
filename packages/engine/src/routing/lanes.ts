import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
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
