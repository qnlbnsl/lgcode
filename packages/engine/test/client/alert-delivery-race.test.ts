import { randomUUID } from "node:crypto";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { expect, it } from "vitest";
import { alertDelivery } from "../../src/client/alerts/delivery.ts";
import { alertReactor } from "../../src/client/alerts/reactor.ts";
import { clientView } from "../../src/client/alerts/view.ts";
import { engineLists } from "../../src/pieces/lists.ts";
import { Views } from "../../src/views/Views.ts";
import { eventsOf } from "../support/alertsRig.ts";
import { configure, delivered, failed, ntfyServer, posted, posts, raiseQuestion, setToken, withCarrier } from "../support/carrierRig.ts";
import { eventually, pause } from "../support/routingRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

it.each([
  { attempt: 1, failureOffset: 0, delay: 5_000, attempts: [1] },
  { attempt: 2, failureOffset: 5_000, delay: 30_000, attempts: [1, 2] },
])("a scan held in token cleanup honors same-generation attempt $attempt after reclaiming the key", async ({ attempt, failureOffset, delay, attempts }) => {
  const server = await ntfyServer();
  server.respond(() => {});
  const staleScan = Deferred.makeUnsafe<void>();
  const resumeStale = Deferred.makeUnsafe<void>();
  const selfScan = Deferred.makeUnsafe<void>();
  const resumeSelf = Deferred.makeUnsafe<void>();
  const retryWait = Deferred.makeUnsafe<void>();
  let removals = 0; let holdSelf = false; let claiming = false; let id = "";
  const start = 1_800_000_000_000;
  // Keep every view read real. Pause the worker's self-scan after it has
  // released its key, at the snapshot read where scheduler preemption can
  // also let the cleanup continuation run. No view or delivery mark is forged.
  const scheduledDelivery = Effect.gen(function* () {
    const views = yield* Views;
    const clock = yield* Clock.Clock;
    const snapshot = Effect.gen(function* () {
      const current = yield* views.snapshot;
      if (holdSelf && clientView(current.client).delivery[id]?.attempt === attempt) {
        holdSelf = false;
        yield* Deferred.succeed(selfScan, undefined);
        yield* Deferred.await(resumeSelf);
      }
      return current;
    });
    yield* alertDelivery.pipe(Effect.provideService(Views, { ...views, snapshot }),
      Effect.provideService(Clock.Clock, { ...clock, sleep: (duration) => Effect.gen(function* () {
        if (claiming && Duration.toMillis(duration) === delay) yield* Deferred.succeed(retryWait, undefined);
        yield* clock.sleep(duration);
      }) }));
  });
  const lists = { ...engineLists, reactors: { ...engineLists.reactors,
    client: Effect.all([alertReactor, scheduledDelivery], { concurrency: "unbounded", discard: true }),
  } };
  try {
    await withCarrier(() => Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* configure(server.origin);
      yield* setToken(server.origin, randomUUID(), "before-rotation");
      id = yield* raiseQuestion("cleanup-race");
      expect(yield* posted(server)).toHaveLength(1);
      yield* setToken(server.origin, randomUUID(), "after-rotation");
      yield* Deferred.await(staleScan);
      const generation = (yield* eventsOf("client.AlertCarrierTokenSet")).at(-1)!.sequence;

      // The old-generation send completes. Its self-scan overtakes the
      // follower held in cleanup, removes the same retired token, and starts
      // a send in the new generation, while the follower keeps its old view.
      posts(server)[0]!.response.writeHead(200); posts(server)[0]!.response.end();
      expect(yield* posted(server, 2)).toHaveLength(2);
      expect(removals).toBe(2);
      if (attempt === 2) {
        posts(server)[1]!.response.writeHead(503); posts(server)[1]!.response.end();
        expect(yield* failed(id)).toHaveLength(1);
        yield* TestClock.adjust(5_000);
        expect(yield* posted(server, 3)).toHaveLength(3);
      }
      holdSelf = true;
      posts(server)[attempt]!.response.writeHead(503); posts(server)[attempt]!.response.end();
      yield* Deferred.await(selfScan);
      const failures = yield* failed(id, attempt);
      expect(failures).toHaveLength(attempt);
      expect(failures.at(-1)).toMatchObject({ occurredAt: start + failureOffset, event: { generation, attempt } });

      // The current key is now free. Give the stale follower the claim before
      // the failed worker can self-reconcile. Use the newest failure's delay.
      claiming = true;
      yield* Deferred.succeed(resumeStale, undefined);
      yield* eventually(Deferred.isDone(retryWait), (waiting) => waiting || posts(server).length > attempt + 1);
      expect(posts(server), "a stale claimant sent before the latest failure's deadline").toHaveLength(attempt + 1);
      expect(yield* Deferred.isDone(retryWait)).toBe(true);
      yield* Deferred.succeed(resumeSelf, undefined);
      yield* TestClock.adjust(delay - 1); yield* pause(20);
      expect(posts(server)).toHaveLength(attempt + 1);
      yield* TestClock.adjust(1);
      expect(yield* posted(server, attempt + 2)).toHaveLength(attempt + 2);
      posts(server)[attempt + 1]!.response.writeHead(200); posts(server)[attempt + 1]!.response.end();
      const deliveries = yield* delivered(id, 2);
      expect(deliveries).toHaveLength(2);
      expect(deliveries[0]!.event.generation).toBeLessThan(generation);
      expect(deliveries[1]).toMatchObject({ occurredAt: start + failureOffset + delay, event: { generation, attempt: attempt + 1 } });
      expect((yield* eventsOf("client.AlertDeliveryFailed")).map((row) => row.event.attempt)).toEqual(attempts);
      yield* TestClock.adjust(30_000); yield* pause(20);
      expect(posts(server)).toHaveLength(attempt + 2);
    }), { lists, clockAt: start, decorateStore: (store) => ({ ...store,
      removeCarrierValue: (generation) => Effect.gen(function* () {
        const first = ++removals === 1;
        if (first) {
          yield* Deferred.succeed(staleScan, undefined);
          yield* Deferred.await(resumeStale);
        }
        yield* store.removeCarrierValue!(generation);
      }),
    }) });
  } finally { await server.close(); }
});
