import { mkdtempSync, rmSync } from "node:fs";

import { it } from "@effect/vitest";
import { readOnly } from "@lgtm/t3-node-sqlite/nodeSqliteClient";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";

import * as Views from "../../src/views/Views.ts";
import { compareViews } from "../../src/views/compare.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { event, journey, ready } from "../support/viewFixtures.ts";
import { append, sequence, withViews } from "../support/withViews.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync("/tmp/lgtm-compare-");
  vi.stubEnv("LGTM_HOME", home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

it.effect("4.6 clean comparison: catches reporting a false difference or comparing a different head", () =>
  withViews(home, Effect.gen(function* () {
    yield* registerRebuildCheck();
    expect(yield* compareViews(sequence(0))).toEqual({ sequence: 0, differences: [] });
    yield* append("journey", journey);
    expect(yield* compareViews(sequence(journey.length))).toEqual({ sequence: journey.length, differences: [] });
  })),
);

it.effect("4.6 dropped event: catches comparing the live views to themselves or hiding the differing value", () =>
  withViews(home, Effect.gen(function* () {
    yield* registerRebuildCheck({ expectDifference: true });
    const values = [...ready,
      event({ _tag: "AccountChanged", accountId: "phone", account: { id: "phone", harness: "first", displayName: "Phone", enabled: true } }),
      event({ _tag: "AccountChanged", accountId: "phone", account: { id: "phone", harness: "first", displayName: "Phone", enabled: false } }),
      event({ _tag: "AgentGrouped", agentId: "agent-a", groups: ["review"] }),
    ];
    yield* append("drop-revocation", values);
    const views = yield* Views.Views;
    // The mutation drops a middle event, not the head. Both snapshots have N,
    // so a sequence-only comparison cannot detect this corruption.
    expect((yield* views.snapshot).sequence).toBe(values.length);
    expect((yield* views.snapshot).accounts["phone"]).toMatchObject({ enabled: true });
    const result = yield* compareViews();
    expect(result.sequence).toBe(values.length);
    expect(result.differences).toContainEqual({ path: ["accounts", "phone", "enabled"], live: true, rebuilt: false });
    expect(result.differences).toHaveLength(1);
  }), {
    replace: (real) => ({
      ...real,
      applyCommitted: (batch) => real.applyCommitted(batch.filter((row) => !(row.event._tag === "AccountChanged" && row.event.account?.enabled === false))),
    }),
  }),
);

for (const requested of [4, 2]) {
  it.effect(`4c F2 requested head ${requested}: catches comparing or reporting a caller's head that differs from the durable log`, () =>
    withViews(home, Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* append("ready", ready);
      const result = yield* compareViews(sequence(requested)).pipe(Effect.result);
      expect(result._tag).toBe("Failure");
      if (result._tag !== "Failure") throw new Error(`Comparison accepted head ${requested} for a three-event log`);
      expect(result.failure).toMatchObject({ _tag: "CompareHeadMismatch", requested, head: 3 });
    })),
  );
}

it.effect("4c F2 established head: catches requiring a caller's head or failing an explicit matching head", () =>
  withViews(home, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* append("ready", ready);
    expect(yield* compareViews()).toEqual({ sequence: 3, differences: [] });
    expect(yield* compareViews(sequence(3))).toEqual({ sequence: 3, differences: [] });
  })),
);

it.effect("4c F2 stale caller read: catches rebuilding to a head read before a later append committed", () =>
  withViews(home, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* append("ready", ready);
    const sql = yield* SqlClient.SqlClient;
    const oldHead = yield* readOnly(sql<{ head: number }>`SELECT COALESCE(MAX(sequence), 0) AS head FROM events`);
    expect(oldHead).toEqual([{ head: 3 }]);
    yield* append("after-head-read", [event({ _tag: "AccountChanged", accountId: "phone", account: { id: "phone", harness: "first", displayName: "Phone", enabled: true } })]);
    expect(yield* compareViews()).toEqual({ sequence: 4, differences: [] });
  })),
);

it.effect("4c F2 lagging projection: catches treating the live sequence as the durable head or as CompareHeadMismatch", () =>
  withViews(home, Effect.gen(function* () {
    yield* registerRebuildCheck({ expectDifference: true });
    yield* append("ready", ready);
    yield* append("dropped-head", [event({ _tag: "AccountChanged", accountId: "phone", account: { id: "phone", harness: "first", displayName: "Phone", enabled: true } })]);
    const result = yield* compareViews();
    expect(result.sequence).toBe(4);
    expect(result.differences).toContainEqual({ path: ["sequence"], live: 3, rebuilt: 4 });
    expect(result.differences).toContainEqual({
      path: ["accounts", "phone"], live: undefined, rebuilt: { id: "phone", harness: "first", displayName: "Phone", enabled: true, status: "available" },
    });
    expect(result.differences).toHaveLength(2);
  }), {
    replace: (real) => ({
      ...real,
      applyCommitted: (batch) => real.applyCommitted(batch.filter((row) => !(row.event._tag === "AccountChanged" && row.event.accountId !== "primary"))),
    }),
  }),
);

it.effect("4c F2 advanced projection: catches accepting an ahead live sequence as the durable head or rejecting a matching expected head", () =>
  withViews(home, Effect.gen(function* () {
    yield* registerRebuildCheck({ expectDifference: true });
    yield* append("ready", ready);
    for (const result of [yield* compareViews(), yield* compareViews(sequence(3))]) {
      expect(result).toEqual({ sequence: 3, differences: [{ path: ["sequence"], live: 4, rebuilt: 3 }] });
    }
  }), {
    replace: (real) => ({
      ...real,
      snapshot: real.snapshot.pipe(Effect.map((snapshot) => ({ ...snapshot, sequence: sequence(snapshot.sequence + 1) }))),
    }),
  }),
);

it.effect("4c F2 mismatch before rebuild: catches reading event payloads before rejecting an expected head mismatch", () =>
  withViews(home, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* append("ready", ready);
    const sql = yield* SqlClient.SqlClient;
    // Head reads still work, but any attempt to rebuild must fail. Restore
    // the column before the outer rebuild hook runs.
    yield* sql`ALTER TABLE events RENAME COLUMN payload_json TO payload_hidden`;
    const result = yield* compareViews(sequence(4)).pipe(
      Effect.result,
      Effect.ensuring(sql`ALTER TABLE events RENAME COLUMN payload_hidden TO payload_json`.pipe(Effect.orDie)),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag !== "Failure") throw new Error("Comparison accepted a mismatched expected head");
    expect(result.failure).toMatchObject({ _tag: "CompareHeadMismatch", requested: 4, head: 3 });
  })),
);

it.effect("4c F1 comparison lookup: catches reporting an inherited device member instead of an absent live record", () =>
  withViews(home, Effect.gen(function* () {
    yield* registerRebuildCheck({ expectDifference: true });
    yield* append("drop-inherited-device", [
      event({ _tag: "AccountChanged", accountId: "constructor", account: { id: "constructor", harness: "first", displayName: "Phone", enabled: true } }),
      ...ready,
    ]);
    const result = yield* compareViews(sequence(4));
    expect(result.differences).toEqual([{
      path: ["accounts", "constructor"], live: undefined, rebuilt: { id: "constructor", harness: "first", displayName: "Phone", enabled: true, status: "available" },
    }]);
  }), {
    replace: (real) => ({
      ...real,
      applyCommitted: (batch) => real.applyCommitted(batch.filter((row) => !(row.event._tag === "AccountChanged" && row.event.accountId !== "primary"))),
    }),
  }),
);

it.live("4.6 writer snapshot: catches reading live views between durable COMMIT and the writer's live-view update", () =>
  Effect.gen(function* () {
    const committed = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let hold = false;
    let snapshotReads = 0;
    yield* withViews(home, Effect.gen(function* () {
    yield* registerRebuildCheck();
      yield* append("ready", ready);
      hold = true;
      const writing = yield* Effect.forkChild(append("device", [event({ _tag: "AccountChanged", accountId: "phone", account: { id: "phone", harness: "first", displayName: "Phone", enabled: true } })]), { startImmediately: true });
      yield* Deferred.await(committed);
      const sql = yield* SqlClient.SqlClient;
      // This query is on a real read connection: prove the event committed
      // before holding back its corresponding live projection.
      expect(yield* sql<{ n: number }>`SELECT COUNT(*) AS n FROM events`.pipe(
        // The fixture uses the copied client's WAL reader pool.
        readOnly,
      )).toEqual([{ n: 4 }]);
      snapshotReads = 0;
      const comparing = yield* Effect.forkChild(compareViews(sequence(4)), { startImmediately: true });
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      // Give an incorrectly unlocked comparison time to finish its SQL head
      // read too; two scheduler yields alone could miss that faulty path.
      yield* Effect.sleep("100 millis");
      expect(snapshotReads).toBe(0);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(writing);
      expect(yield* Fiber.join(comparing)).toEqual({ sequence: 4, differences: [] });
      expect(snapshotReads).toBeGreaterThan(0);
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined))), {
      replace: (real) => ({
        ...real,
        snapshot: Effect.suspend(() => { snapshotReads++; return real.snapshot; }),
        applyCommitted: (batch) => Effect.gen(function* () {
          if (hold) {
            yield* Deferred.succeed(committed, undefined);
            yield* Deferred.await(release);
          }
          yield* real.applyCommitted(batch);
        }),
      }),
    });
  }),
);

it.live("4.6 row 62 reader: catches rebuilding on the occupied writer connection instead of the WAL read connection", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const finished = yield* Deferred.make<void>();
    let occupyOnce = false;
    let occupyWriter: Effect.Effect<void, unknown> = Effect.void;
    yield* withViews(home, Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* append("journey", journey);
      const sql = yield* SqlClient.SqlClient;
      occupyWriter = sql.withTransaction(Effect.gen(function* () {
        yield* sql`UPDATE receipts SET body_hash = body_hash WHERE 0`;
        yield* Deferred.succeed(entered, undefined);
        yield* Deferred.await(release);
      })).pipe(Effect.ensuring(Deferred.succeed(finished, undefined)));
      occupyOnce = true;
      const compared = yield* compareViews(sequence(journey.length)).pipe(
        Effect.timeoutOption("3 seconds"),
        Effect.ensuring(Deferred.succeed(release, undefined)),
      );
      yield* Deferred.await(finished);
      expect(Option.isSome(compared), "comparison blocked behind the occupied writer connection").toBe(true);
      if (Option.isSome(compared)) expect(compared.value).toEqual({ sequence: journey.length, differences: [] });
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined))), {
      replace: (real) => ({
        ...real,
        snapshot: Effect.gen(function* () {
          const snapshot = yield* real.snapshot;
          if (occupyOnce) {
            occupyOnce = false;
            // The durable head has been read before this snapshot. Occupy
            // the writer now, so only the subsequent rebuild needs a reader.
            yield* Effect.forkChild(occupyWriter, { startImmediately: true });
            yield* Deferred.await(entered);
          }
          return snapshot;
        }),
      }),
    });
  }),
);

it.live("4.6 fixed head: catches moving the rebuild bound beyond the head captured with its snapshot", () =>
  Effect.gen(function* () {
    const captured = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let holdOnce = false;
    yield* withViews(home, Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* append("ready", ready);
      holdOnce = true;
      const comparing = yield* Effect.forkChild(compareViews(sequence(3)), { startImmediately: true });
      yield* Deferred.await(captured);
      const writing = yield* Effect.forkChild(append("later-device", [
        event({ _tag: "AccountChanged", accountId: "phone", account: { id: "phone", harness: "first", displayName: "Phone", enabled: true } }),
      ]), { startImmediately: true });
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(comparing)).toEqual({ sequence: 3, differences: [] });
      yield* Fiber.join(writing);
      expect((yield* (yield* Views.Views).snapshot).sequence).toBe(4);
      expect(yield* compareViews(sequence(4))).toEqual({ sequence: 4, differences: [] });
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined))), {
      replace: (real) => ({
        ...real,
        snapshot: Effect.gen(function* () {
          const snapshot = yield* real.snapshot;
          if (holdOnce) {
            holdOnce = false;
            yield* Deferred.succeed(captured, undefined);
            yield* Deferred.await(release);
          }
          return snapshot;
        }),
      }),
    });
  }).pipe(Effect.timeout("5 seconds")),
);
