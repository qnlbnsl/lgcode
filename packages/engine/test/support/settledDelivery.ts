import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { engineLists } from "../../src/pieces/lists.ts";
import { alertDelivery } from "../../src/client/alerts/delivery.ts";
import { alertReactor } from "../../src/client/alerts/reactor.ts";
import { EventLog } from "../../src/log/EventLog.ts";
import { Views } from "../../src/views/Views.ts";
import { append } from "./alertsRig.ts";

// Observe the real follower and its real workers through existing services.
// A marker scan plus joining every worker is a completion boundary, including
// workers suspended in a delay before send. Scope cancellation is not a join.
export const settledDelivery = () => {
  const workers = new Set<Fiber.Fiber<unknown, unknown>>();
  const scanned = Deferred.makeUnsafe<void>();
  let marker = Infinity;
  const delivery = Effect.gen(function* () {
    const views = yield* Views; const log = yield* EventLog; const clock = yield* Clock.Clock;
    const main = yield* Effect.fiber;
    let follower: Fiber.Fiber<unknown, unknown> | undefined;
    const observe = Effect.withFiber((fiber) => Effect.sync(() => {
      if (fiber !== main && fiber !== follower) workers.add(fiber);
      return fiber;
    }));
    yield* alertDelivery.pipe(
      Effect.provideService(EventLog, { ...log, subscribeCommitted: Effect.gen(function* () {
        follower = yield* Effect.fiber;
        return yield* log.subscribeCommitted;
      }) }),
      Effect.provideService(Views, { ...views, snapshot: Effect.gen(function* () {
        const fiber = yield* observe;
        const snapshot = yield* views.snapshot;
        if (fiber === follower && snapshot.sequence >= marker) yield* Deferred.succeed(scanned, undefined);
        return snapshot;
      }) }),
      Effect.provideService(Clock.Clock, Object.assign(Object.create(clock) as Clock.Clock, {
        sleep: (duration: Parameters<Clock.Clock["sleep"]>[0]) => observe.pipe(Effect.andThen(clock.sleep(duration))),
      })),
    );
  });
  return {
    lists: { ...engineLists, reactors: { ...engineLists.reactors,
      client: Effect.all([alertReactor, delivery], { concurrency: "unbounded", discard: true }),
    } },
    settle: Effect.gen(function* () {
      // The writer publishes before append returns, so install the expected
      // sequence before issuing the marker. Any later snapshot scans all rows.
      marker = (yield* (yield* Views).snapshot).sequence + 1;
      yield* append({ _tag: "client.AlertSettingsChanged", kind: "question", push: true });
      yield* Deferred.await(scanned);
      // Drain queued starts before collecting handles. All worker paths first
      // read Views, or suspend through Clock if a delayed-work fault is present.
      yield* Effect.withFiber((fiber) => Effect.sync(() => fiber.currentDispatcher.flush()));
      for (;;) {
        const pending = [...workers].filter((fiber) => fiber.pollUnsafe() === undefined);
        if (pending.length === 0) return;
        yield* Fiber.awaitAll(pending);
        yield* Effect.withFiber((fiber) => Effect.sync(() => fiber.currentDispatcher.flush()));
      }
    }).pipe(Effect.timeout(5_000)),
  };
};
