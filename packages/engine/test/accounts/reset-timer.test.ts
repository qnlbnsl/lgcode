import { it } from "@effect/vitest";
import { AccountId, HarnessId, type Event, type EventEnvelope } from "@lgcode/contracts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import { expect } from "vitest";

import { startAccountTimers } from "../../src/accounts/timers.ts";
import { EventLog, LogWriteFailed } from "../../src/log/EventLog.ts";
import { emptyViews } from "../../src/views/apply.ts";
import { Views } from "../../src/views/Views.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

// The real timer, with controlled clock, log and view boundaries. No database
// or process is opened; the acceptance cases cover the real service path.
registerRebuildCheck({ noLog: true });

interface Sleep {
  readonly millis: number;
  readonly wake: () => void;
}

const timer = (readings: ReadonlyArray<number>, failRelease = false) => Effect.gen(function* () {
  const sleeps = yield* Queue.unbounded<Sleep>();
  const committed = yield* PubSub.unbounded<EventEnvelope>();
  const accountId = Schema.decodeUnknownSync(AccountId)("primary");
  let state: ReturnType<typeof emptyViews> = {
    ...emptyViews(),
    accounts: {
      [accountId]: {
        id: accountId, harness: Schema.decodeUnknownSync(HarnessId)("fake"), displayName: "Primary", enabled: true,
        status: "out-of-usage", resetAt: 1000,
      },
    },
  };
  let reading = 0;
  let failing = failRelease;
  const available: Array<{ event: Event; at: number }> = [];
  const read = () => readings[Math.min(reading++, readings.length - 1)]!;
  const clock: Clock.Clock = {
    currentTimeMillis: Effect.sync(read), currentTimeMillisUnsafe: read,
    currentTimeNanos: Effect.succeed(0n), currentTimeNanosUnsafe: () => 0n,
    monotonicTimeNanos: Effect.succeed(0n), monotonicTimeNanosUnsafe: () => 0n,
    sleep: (duration) => Effect.callback<void>((resume) => {
      Queue.offerUnsafe(sleeps, { millis: Duration.toMillis(duration), wake: () => resume(Effect.void) });
    }),
  };
  const views = Views.of({
    snapshot: Effect.sync(() => state),
    applyCommitted: () => Effect.die("this timer must write through the log"),
  });
  const append: ReturnType<typeof EventLog.of>["append"] = (_actor, _request, _hash, events) => Effect.suspend(() => {
    if (failing) return Effect.fail(new LogWriteFailed({ reason: "database write failed: disk full" }));
    for (const event of events) {
      if (event._tag !== "AccountAvailable") return Effect.die("unexpected timer event");
      available.push({ event, at: readings[Math.min(reading - 1, readings.length - 1)]! });
      state = { ...state, accounts: { ...state.accounts, [accountId]: { ...state.accounts[accountId]!, status: "available" } } };
    }
    return Effect.succeed([]);
  });
  const log = EventLog.of({
    append, transact: (use) => use(append),
    subscribeCommitted: PubSub.subscribe(committed),
    redactText: Effect.succeed,
    withWriterPermit: (effect) => effect,
  });
  yield* startAccountTimers.pipe(Effect.provideService(Clock.Clock, clock),
    Effect.provideService(Views, views), Effect.provideService(EventLog, log));
  return {
    available, nextSleep: Queue.take(sleeps),
    allowRelease: () => { failing = false; },
  };
});

for (const later of [1000, 1001]) {
  it.effect(`issue 210: a deadline crossed between clock reads (later=${later}) is rechecked immediately`, () => Effect.scoped(Effect.gen(function* () {
    const running = yield* timer([999, later, later, later]);
    const recheck = yield* running.nextSleep;
    expect(running.available, "the account must not return at the first, early reading").toEqual([]);
    expect(recheck.millis, "the newly due deadline must not be parked for a minute").toBe(0);
    recheck.wake();
    yield* running.nextSleep;
    expect(running.available).toEqual([{ event: { _tag: "AccountAvailable", accountId: "primary", cause: "usage reset" }, at: later }]);
  })));
}

it.effect("issue 210: a sleep that wakes one millisecond early rechecks the reset instead of losing it", () => Effect.scoped(Effect.gen(function* () {
  const running = yield* timer([990, 990, 999, 1000, 1000, 1000]);
  const initial = yield* running.nextSleep;
  expect(initial.millis).toBe(10);
  expect(running.available).toEqual([]);
  initial.wake();
  const recheck = yield* running.nextSleep;
  expect(running.available, "the early wake must not release before the reset").toEqual([]);
  expect(recheck.millis, "an early wake must not postpone the reset for a minute").toBe(0);
  recheck.wake();
  yield* running.nextSleep;
  expect(running.available).toEqual([{ event: { _tag: "AccountAvailable", accountId: "primary", cause: "usage reset" }, at: 1000 }]);
})));

it.effect("issue 210: a release that actually failed waits a minute before retrying", () => Effect.scoped(Effect.gen(function* () {
  const running = yield* timer([1000, 1000, 61000, 61000], true);
  const retry = yield* running.nextSleep;
  expect(running.available).toEqual([]);
  expect(retry.millis, "a write failure must not spin on an immediate retry").toBe(60000);
  running.allowRelease();
  retry.wake();
  yield* running.nextSleep;
  expect(running.available).toEqual([{ event: { _tag: "AccountAvailable", accountId: "primary", cause: "usage reset" }, at: 61000 }]);
})));
