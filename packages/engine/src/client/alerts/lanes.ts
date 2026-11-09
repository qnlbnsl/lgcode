import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

// Network operations take their own lane before the writer. Sleeping backoff
// never holds a lane, and different alerts and generations remain independent.
const lanes = new WeakMap<object, Map<string, { semaphore: Semaphore.Semaphore; users: number }>>();
export const withNotificationLane = (engine: object, key: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => Effect.acquireUseRelease(
    Effect.sync(() => {
      let entries = lanes.get(engine);
      if (entries === undefined) lanes.set(engine, entries = new Map());
      let entry = entries.get(key);
      if (entry === undefined) entries.set(key, entry = { semaphore: Semaphore.makeUnsafe(1), users: 0 });
      entry.users++;
      return entry;
    }),
    (entry) => entry.semaphore.withPermit(effect),
    (entry) => Effect.sync(() => { if (--entry.users === 0) lanes.get(engine)?.delete(key); }),
  );
