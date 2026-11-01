import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import { it } from "@effect/vitest";
import {
  AccountId, AgentId, RequestId, type Actor, type Event, type EventEnvelope,
} from "@shepherd/contracts";
import * as SqliteClient from "@shepherd/t3-node-sqlite/nodeSqliteClient";
import * as Deferred from "effect/Deferred";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import { afterEach, beforeEach, expect, vi } from "vitest";

import * as EventLog from "../../src/log/EventLog.ts";
import { migrate } from "../../src/log/migrations.ts";
import * as Redactor from "../../src/log/Redactor.ts";
import * as Subscribe from "../../src/log/subscribe.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync("/tmp/shepherd-subscribe-");
  vi.stubEnv("SHEPHERD_HOME", home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

const owner: Actor = { _tag: "owner" };
const agentId = Schema.decodeUnknownSync(AgentId)("agent-a");
const agent: Actor = { _tag: "agent", agentId };
const accountId = Schema.decodeUnknownSync(AccountId)("account-a");
const request = (id: string) => Schema.decodeUnknownSync(RequestId)(id);
const bodyHash = (body: string) => createHash("sha256").update(body).digest("hex");

// A mix of events with and without a top-level agent id (issue 31), so the
// catch-up read must rebuild both envelope shapes exactly as `append` returned them.
const eventFor = (n: number): Event => n % 5 === 4
  ? { _tag: "AccountNeedsSignIn", accountId, reason: `sign in ${n}` }
  : n % 2 === 0 ? { _tag: "TurnStarted", agentId } : { _tag: "TurnEnded", agentId, compact: n % 3 === 0 };
const callerFor = (batch: number): Actor => batch % 2 === 0 ? owner : agent;

// The writer is the real `EventLog.layer` on the copied SQLite client with its
// reader workers on, so `SqliteClient.readOnly` reaches a separate read-only
// connection (PB-A5). The program gets its own scope, which closes, and with
// it every subscriber fiber, before the log and the database close.
const withLog = <A, E>(
  program: Effect.Effect<A, E, EventLog.EventLog | SqlClient.SqlClient | Scope.Scope>,
) => Effect.gen(function* () {
  yield* migrate;
  return yield* program.pipe(
    Effect.scoped,
    Effect.provide(EventLog.layer.pipe(Layer.provide(Redactor.layer))),
  );
}).pipe(
  Effect.provide(SqliteClient.layer({ filename: join(home, "events.sqlite"), readerWorker: true })),
  Effect.scoped,
);

// One subscriber running in the background. `received` fills as envelopes
// arrive; `done` ends once the envelope numbered `through` has arrived, and
// dies with the last sequence seen if it stalls.
const follow = (after: number, through: number, limit: Duration.Input = "20 seconds") =>
  Effect.gen(function* () {
    const received: Array<EventEnvelope> = [];
    const done = yield* Subscribe.subscribe(after).pipe(
      Stream.tap((envelope) => Effect.sync(() => { received.push(envelope); })),
      Stream.takeUntil((envelope) => envelope.sequence >= through),
      Stream.runDrain,
      Effect.timeoutOrElse({
        duration: limit,
        orElse: () => Effect.die(new Error(
          `subscriber after ${after} stalled before ${through}; last sequence ${received.at(-1)?.sequence ?? "none"}`,
        )),
      }),
      Effect.forkScoped,
    );
    return { received, done };
  });

// Polls a condition on the real clock; correctness never depends on the poll.
const waitUntil = (condition: () => boolean, what: string) =>
  Effect.gen(function* () {
    while (!condition()) yield* Effect.sleep("5 millis");
  }).pipe(Effect.timeoutOrElse({
    duration: "10 seconds",
    orElse: () => Effect.die(new Error(`timed out waiting for ${what}`)),
  }));

// Lets a just-started subscriber finish its catch-up and reach the live tail,
// so the next append is delivered live. The assertions hold either way.
const settle = Effect.sleep("100 millis");

// The first place a delivered list stops being after+1, after+2, ...; null if none.
const firstBreak = (sequences: ReadonlyArray<number>, after: number) => {
  for (let index = 0; index < sequences.length; index++) {
    if (sequences[index] !== after + 1 + index) return { index, expected: after + 1 + index, got: sequences[index] };
  }
  return null;
};
const sequencesOf = (envelopes: ReadonlyArray<EventEnvelope>) => envelopes.map((envelope) => envelope.sequence);

// mulberry32: a small seeded generator, so a failing run can be repeated exactly.
const seeded = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const SEED = 0x4b_2026;
const TOTAL = 10_000;
const SUBSCRIBERS = 5;
const MAX_BATCH = 8;
// Every subscriber starts at least this many events before the writer stops,
// so its catch-up always overlaps writes still to come.
const TAIL = 1_000;

it.live("4.3 gapless: catches an event missed, repeated or reordered at the catch-up-to-live join while 10,000 events are written", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const random = seeded(SEED);
    const startAt = Array.from({ length: SUBSCRIBERS }, () => Math.floor(random() * (TOTAL - TAIL)))
      .sort((left, right) => left - right);
    const written: Array<EventEnvelope> = [];
    const subscribers: Array<{
      readonly after: number;
      readonly startedAtHead: number;
      readonly follower: Effect.Success<ReturnType<typeof follow>>;
    }> = [];
    let head = 0;

    // Starts each subscriber whose point the head has passed, at a seeded
    // `after` between 0 and the head, while the writer keeps writing.
    const startDue = Effect.gen(function* () {
      while (subscribers.length < SUBSCRIBERS && startAt[subscribers.length]! <= head) {
        const after = Math.floor(random() * (head + 1));
        subscribers.push({ after, startedAtHead: head, follower: yield* follow(after, TOTAL, "60 seconds") });
      }
    });

    yield* startDue;
    for (let batch = 0; head < TOTAL; batch++) {
      const size = Math.min(TOTAL - head, 1 + Math.floor(random() * MAX_BATCH));
      const events = Array.from({ length: size }, (_, index) => eventFor(head + index));
      const envelopes = yield* log.append(callerFor(batch), request(`gapless-${batch}`), bodyHash(`gapless-${batch}`), events, {});
      written.push(...envelopes);
      head = envelopes.at(-1)!.sequence;
      yield* startDue;
    }

    // Preconditions: the writer produced 1..TOTAL, and every subscriber
    // started while at least TAIL events were still to be written.
    expect(firstBreak(sequencesOf(written), 0)).toBeNull();
    expect(subscribers).toHaveLength(SUBSCRIBERS);
    for (const subscriber of subscribers) expect(subscriber.startedAtHead).toBeLessThanOrEqual(TOTAL - TAIL);

    for (const { after, follower } of subscribers) {
      yield* Fiber.join(follower.done);
      const label = `seed ${SEED}, after ${after}`;
      expect(firstBreak(sequencesOf(follower.received), after), label).toBeNull();
      expect(follower.received, label).toHaveLength(TOTAL - after);
      // The catch-up part comes from the read connection and the live part
      // from the writer; both must equal what `append` returned.
      expect(follower.received, label).toEqual(written.slice(after));
    }
  })),
  90_000,
);

it.live("4.3 join stress: catches reading the head before subscribing to committed events, which loses a batch committed in between", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const last = 1_500;
    const followers: Array<{ readonly after: number; readonly follower: Effect.Success<ReturnType<typeof follow>> }> = [];
    // Single-event batches, and a new subscriber at the current head every 50
    // events: each join races the very next commit.
    for (let sequence = 1; sequence <= last; sequence++) {
      if (sequence % 50 === 1) followers.push({ after: sequence - 1, follower: yield* follow(sequence - 1, last) });
      yield* log.append(owner, request(`join-${sequence}`), bodyHash(`join-${sequence}`), [eventFor(sequence)], {});
    }
    for (const { after, follower } of followers) {
      yield* Fiber.join(follower.done);
      expect(firstBreak(sequencesOf(follower.received), after), `after ${after}`).toBeNull();
      expect(follower.received, `after ${after}`).toHaveLength(last - after);
    }
  })),
  60_000,
);

it.live("4.3 empty log: catches a subscriber at 0 on an empty log that ends, fails or misses the first batch", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const subscriber = yield* follow(0, 2);
    yield* settle;
    const first = yield* log.append(owner, request("first"), bodyHash("first"), [eventFor(0), eventFor(1)], {});
    yield* Fiber.join(subscriber.done);

    expect(sequencesOf(subscriber.received)).toEqual([1, 2]);
    expect(subscriber.received).toEqual(first);
  })),
);

it.live("4.3 at the head: catches redelivering the event numbered `after` or refusing a subscriber that starts exactly at the head", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    yield* log.append(owner, request("before"), bodyHash("before"), [eventFor(0), eventFor(1), eventFor(2)], {});
    const subscriber = yield* follow(3, 5);
    yield* settle;
    const fourth = yield* log.append(owner, request("fourth"), bodyHash("fourth"), [eventFor(3)], {});
    const fifth = yield* log.append(agent, request("fifth"), bodyHash("fifth"), [eventFor(4)], {});
    yield* Fiber.join(subscriber.done);

    expect(sequencesOf(subscriber.received)).toEqual([4, 5]);
    expect(subscriber.received).toEqual([...fourth, ...fifth]);
  })),
);

it.live("4.3 whole batch: catches dropping, reordering or reshaping the events of a multi-event batch, live or from catch-up", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const live = yield* follow(0, 5);
    yield* settle;
    const batch: ReadonlyArray<Event> = [
      { _tag: "TurnStarted", agentId },
      { _tag: "AccountNeedsSignIn", accountId, reason: "expired" },
      { _tag: "TurnEnded", agentId, compact: true },
      { _tag: "AgentGrouped", agentId, groups: ["reviewers"] },
      { _tag: "AgentStopped", agentId },
    ];
    const appended = yield* log.append(agent, request("batch"), bodyHash("batch"), batch, {});
    yield* Fiber.join(live.done);

    expect(sequencesOf(appended)).toEqual([1, 2, 3, 4, 5]);
    expect(live.received).toEqual(appended);
    // A later subscriber gets the same batch from the catch-up read: the
    // agent caller and the account event's missing agent id must survive it.
    const replayed = yield* follow(0, 5);
    yield* Fiber.join(replayed.done);
    expect(replayed.received).toEqual(appended);
  })),
);

it.live("issue 33 receipt replay: catches publishing a repeated request's stored envelopes as a new batch", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const fromStart = yield* follow(0, 3);
    yield* settle;
    const first = yield* log.append(owner, request("once"), bodyHash("once"), [eventFor(0), eventFor(1)], {});
    yield* waitUntil(() => fromStart.received.length >= 2, "the first batch");
    const fromOne = yield* follow(1, 3);
    yield* settle;

    const repeat = yield* log.append(owner, request("once"), bodyHash("once"), [eventFor(0), eventFor(1)], {});
    expect(repeat).toEqual(first);
    // The next real batch is the marker: anything the replay published would
    // arrive before it.
    yield* log.append(owner, request("next"), bodyHash("next"), [eventFor(2)], {});
    yield* Fiber.join(fromStart.done);
    yield* Fiber.join(fromOne.done);

    expect(sequencesOf(fromStart.received)).toEqual([1, 2, 3]);
    expect(sequencesOf(fromOne.received)).toEqual([2, 3]);
  })),
);

it.live("4.3 failed batch: catches delivering events of a batch whose COMMIT failed and rolled back", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const sql = yield* SqlClient.SqlClient;
    const subscriber = yield* follow(0, 100);
    yield* settle;
    yield* log.append(owner, request("kept"), bodyHash("kept"), [eventFor(0)], {});
    yield* waitUntil(() => subscriber.received.length >= 1, "the kept batch");

    // As in commit-failure.test.ts: every INSERT succeeds and only COMMIT
    // fails, on a deferred foreign key, so a publish anywhere before the
    // commit has already happened when the batch is rolled back.
    yield* sql`PRAGMA foreign_keys = ON`;
    yield* sql`CREATE TABLE subscribe_test_parents (id INTEGER PRIMARY KEY)`;
    yield* sql`CREATE TABLE subscribe_test_children (
      parent_id INTEGER REFERENCES subscribe_test_parents(id) DEFERRABLE INITIALLY DEFERRED
    )`;
    yield* sql`CREATE TRIGGER fail_event_commit AFTER INSERT ON events
      BEGIN INSERT INTO subscribe_test_children (parent_id) VALUES (719); END`;
    const failed = yield* log.append(owner, request("rolled-back"), bodyHash("rolled-back"), [eventFor(1), eventFor(2)], {})
      .pipe(Effect.result);
    expect(failed._tag).toBe("Failure");
    if (failed._tag !== "Failure") throw new Error("The deferred foreign-key violation unexpectedly committed");
    expect(failed.failure).toBeInstanceOf(EventLog.LogWriteFailed);

    // The write failure latches the log, so no marker batch can follow; a
    // wrong publish would already sit in the subscription, and arrives in this wait.
    yield* Effect.sleep("300 millis");
    expect(yield* SqliteClient.readOnly(sql`SELECT COUNT(*) AS n FROM events`)).toEqual([{ n: 1 }]);
    expect(sequencesOf(subscriber.received)).toEqual([1]);
    // A subscriber started now catches up from the database only.
    const later = yield* follow(0, 1);
    yield* Fiber.join(later.done);
    yield* Effect.sleep("100 millis");
    expect(sequencesOf(later.received)).toEqual([1]);
  })),
);

// Decision for `after` greater than the head: the stream fails at once with
// `SubscribeAheadOfHead`. Waiting would silently skip the events numbered
// head+1..after once they are written, so a client holding a cursor from
// another log would see a gap with no error. Criterion 4.3 (plan line 475)
// promises every later event; the spec's `subscribe` (engine design, line
// 172) sends events after a sequence that exists; the RPC already carries a
// refusal (`subscribe` error `Refused`, packages/contracts/src/commands.ts:131),
// and row 66 already refuses a `subscribe` at its start.
it.live("4.3 after beyond the head: catches waiting silently, or delivering from 1, for a cursor ahead of the log", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const onEmpty = yield* Subscribe.subscribe(1).pipe(Stream.runCollect, Effect.timeout("5 seconds"), Effect.result);
    expect(onEmpty._tag).toBe("Failure");
    if (onEmpty._tag !== "Failure") throw new Error("A cursor ahead of an empty log was accepted");
    expect(onEmpty.failure).toBeInstanceOf(Subscribe.SubscribeAheadOfHead);
    expect(onEmpty.failure).toMatchObject({ _tag: "SubscribeAheadOfHead", after: 1, head: 0 });

    yield* log.append(owner, request("three"), bodyHash("three"), [eventFor(0), eventFor(1), eventFor(2)], {});
    const ahead = yield* Subscribe.subscribe(5).pipe(Stream.runCollect, Effect.timeout("5 seconds"), Effect.result);
    expect(ahead._tag).toBe("Failure");
    if (ahead._tag !== "Failure") throw new Error("A cursor ahead of the log was accepted");
    expect(ahead.failure).toBeInstanceOf(Subscribe.SubscribeAheadOfHead);
    expect(ahead.failure).toMatchObject({ _tag: "SubscribeAheadOfHead", after: 5, head: 3 });
  })),
);

it.live("4.3 stopped subscriber: catches a closed subscription that blocks the writer or ends the stream for the others", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const last = 5_000;
    const ends = yield* follow(0, 3);
    const interrupted = yield* follow(0, last);
    const steady = yield* follow(0, last);
    yield* settle;
    yield* log.append(owner, request("stop-0"), bodyHash("stop-0"), Array.from({ length: 10 }, (_, index) => eventFor(index)), {});
    yield* Fiber.join(ends.done);
    yield* waitUntil(() => interrupted.received.length >= 1, "the interrupted subscriber's first event");
    yield* Fiber.interrupt(interrupted.done);

    // 499 more batches of 10. A subscription left behind by either stopped
    // subscriber, if it can fill, holds the writer here.
    yield* Effect.gen(function* () {
      for (let batch = 1; batch < last / 10; batch++) {
        yield* log.append(owner, request(`stop-${batch}`), bodyHash(`stop-${batch}`),
          Array.from({ length: 10 }, (_, index) => eventFor(batch * 10 + index)), {});
      }
    }).pipe(Effect.timeoutOrElse({
      duration: "20 seconds",
      orElse: () => Effect.die(new Error("the writer stalled after a subscriber stopped")),
    }));
    yield* Fiber.join(steady.done);

    expect(sequencesOf(ends.received)).toEqual([1, 2, 3]);
    expect(firstBreak(sequencesOf(steady.received), 0)).toBeNull();
    expect(steady.received).toHaveLength(last);
  })),
  60_000,
);

it.live("PB-A5 read-only catch-up: catches reading the head or catch-up pages on the writer connection, which stalls behind an open write", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const sql = yield* SqlClient.SqlClient;
    yield* log.append(owner, request("five"), bodyHash("five"), Array.from({ length: 5 }, (_, index) => eventFor(index)), {});
    const holding = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    // An open transaction holds the client's writer connection until released.
    const writer = yield* sql.withTransaction(Effect.gen(function* () {
      yield* sql`SELECT 1`;
      yield* Deferred.succeed(holding, undefined);
      yield* Deferred.await(release);
    })).pipe(Effect.forkScoped);
    yield* Deferred.await(holding);

    const subscriber = yield* follow(0, 5, "5 seconds");
    const caughtUp = yield* Fiber.join(subscriber.done).pipe(Effect.result);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(writer);

    expect(caughtUp._tag).toBe("Success");
    expect(sequencesOf(subscriber.received)).toEqual([1, 2, 3, 4, 5]);
  })),
);
