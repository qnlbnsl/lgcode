import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import { it } from "@effect/vitest";
import { AgentId, RequestId, type Actor, type Event } from "@lgcode/contracts";
import * as SqliteClient from "@lgcode/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";

import * as EventLog from "../../src/log/EventLog.ts";
import * as Views from "../../src/views/Views.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { migrate } from "../../src/log/migrations.ts";
import * as Redactor from "../../src/log/Redactor.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync("/tmp/lgcode-commit-failure-");
  vi.stubEnv("LGCODE_HOME", home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

const owner: Actor = { _tag: "owner" };
const agentId = Schema.decodeUnknownSync(AgentId)("agent-a");
const request = (id: string) => Schema.decodeUnknownSync(RequestId)(id);
const event: Event = { _tag: "TurnStarted", agentId };

const withLog = <A, E>(program: Effect.Effect<A, E, EventLog.EventLog | SqlClient.SqlClient>) =>
  Effect.gen(function* () {
    yield* migrate;
    return yield* Effect.scoped(Effect.gen(function* () {
      yield* registerRebuildCheck();
      return yield* program;
    })).pipe(
      Effect.provide(EventLog.layer.pipe(Layer.provideMerge(Views.layer), Layer.provide(Redactor.layer))),
    );
  }).pipe(
    Effect.provide(SqliteClient.layer({ filename: join(home, "events.sqlite") })),
    Effect.scoped,
  );

it.effect("D2 failed commit: catches leaving event and receipt writes in an open transaction or clearing the log's refusal latch", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA foreign_keys = ON`;
    expect(yield* sql`PRAGMA foreign_keys`).toEqual([{ foreign_keys: 1 }]);
    yield* sql`CREATE TABLE commit_test_parents (id INTEGER PRIMARY KEY)`;
    yield* sql`CREATE TABLE commit_test_children (
      parent_id INTEGER REFERENCES commit_test_parents(id) DEFERRABLE INITIALLY DEFERRED
    )`;
    // The event INSERT and receipt INSERT both succeed. Only COMMIT checks
    // this deferred constraint, so statement-failure rollback cannot pass.
    yield* sql`CREATE TRIGGER fail_event_commit AFTER INSERT ON events
      BEGIN INSERT INTO commit_test_children (parent_id) VALUES (719); END`;
    const failed = yield* log.append(owner, request("commit-fails"), "7".repeat(64), [event], {})
      .pipe(Effect.result);

    expect(failed._tag).toBe("Failure");
    if (failed._tag !== "Failure") throw new Error("The deferred foreign-key violation unexpectedly committed");
    expect(failed.failure).toBeInstanceOf(EventLog.LogWriteFailed);
    // Soft assertions let all three required consequences run against a
    // broken client, including BEGIN on this same shared connection.
    expect.soft(yield* sql`SELECT COUNT(*) AS n FROM events`).toEqual([{ n: 0 }]);
    expect.soft(yield* sql`SELECT COUNT(*) AS n FROM receipts`).toEqual([{ n: 0 }]);
    const following = yield* sql.withTransaction(sql`SELECT 1`).pipe(Effect.result);
    expect.soft(following._tag).toBe("Success");

    yield* sql`DROP TRIGGER fail_event_commit`;
    const later = yield* log.append(owner, request("after-commit-failure"), "8".repeat(64), [event], {})
      .pipe(Effect.result);
    expect(later._tag).toBe("Failure");
    if (later._tag !== "Failure") throw new Error("The log forgot its commit-failure latch");
    expect(later.failure).toBeInstanceOf(EventLog.LogWriteFailed);
    expect(later.failure.reason).toBe(failed.failure.reason);
    expect.soft(yield* sql`SELECT COUNT(*) AS n FROM events`).toEqual([{ n: 0 }]);
    expect.soft(yield* sql`SELECT COUNT(*) AS n FROM receipts`).toEqual([{ n: 0 }]);
  })),
);
