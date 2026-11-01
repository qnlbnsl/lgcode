import { mkdtempSync, rmSync } from "node:fs";

import { it } from "@effect/vitest";
import { readOnly } from "@shepherd/t3-node-sqlite/nodeSqliteClient";
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
  home = mkdtempSync("/tmp/shepherd-compare-");
  vi.stubEnv("SHEPHERD_HOME", home);
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
      event({ _tag: "DeviceAdded", deviceId: "phone", name: "Phone" }),
      event({ _tag: "DeviceRevoked", deviceId: "phone" }),
      event({ _tag: "AgentGrouped", agentId: "agent-a", groups: ["review"] }),
    ];
    yield* append("drop-revocation", values);
    const views = yield* Views.Views;
    // The mutation drops a middle event, not the head. Both snapshots have N,
    // so a sequence-only comparison cannot detect this corruption.
    expect((yield* views.snapshot).sequence).toBe(values.length);
    expect((yield* views.snapshot).devices["phone"]).toMatchObject({ revoked: false });
    const result = yield* compareViews(sequence(values.length));
    expect(result.sequence).toBe(values.length);
    expect(result.differences).toContainEqual({ path: ["devices", "phone", "revoked"], live: false, rebuilt: true });
    expect(result.differences).toHaveLength(1);
  }), {
    replace: (real) => ({
      ...real,
      applyCommitted: (batch) => real.applyCommitted(batch.filter((row) => row.event._tag !== "DeviceRevoked")),
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
      const writing = yield* Effect.forkChild(append("device", [event({ _tag: "DeviceAdded", deviceId: "phone", name: "Phone" })]), { startImmediately: true });
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
  withViews(home, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* append("journey", journey);
    const sql = yield* SqlClient.SqlClient;
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    // Occupy the writer connection in another fiber while leaving the event
    // writer's semaphore free. A real read connection can still fold the log.
    const occupying = yield* Effect.forkChild(sql.withTransaction(Effect.gen(function* () {
      yield* sql`UPDATE receipts SET body_hash = body_hash WHERE 0`;
      yield* Deferred.succeed(entered, undefined);
      yield* Deferred.await(release);
    })), { startImmediately: true });
    yield* Deferred.await(entered);
    const compared = yield* compareViews(sequence(journey.length)).pipe(
      Effect.timeoutOption("3 seconds"),
      Effect.ensuring(Deferred.succeed(release, undefined)),
    );
    yield* Fiber.join(occupying);
    expect(Option.isSome(compared), "comparison blocked behind the occupied writer connection").toBe(true);
    if (Option.isSome(compared)) expect(compared.value).toEqual({ sequence: journey.length, differences: [] });
  })),
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
        event({ _tag: "DeviceAdded", deviceId: "phone", name: "Phone" }),
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
