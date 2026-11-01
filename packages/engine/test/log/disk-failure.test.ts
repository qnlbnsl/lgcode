import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import { it } from "@effect/vitest";
import { AgentId, RequestId, type Actor, type Event } from "@shepherd/contracts";
import * as SqliteClient from "@shepherd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";

import * as EventLog from "../../src/log/EventLog.ts";
import { migrate } from "../../src/log/migrations.ts";
import * as Redactor from "../../src/log/Redactor.ts";

let home: string;
beforeEach(() => {
  home = mkdtempSync("/tmp/shepherd-disk-failure-");
  vi.stubEnv("SHEPHERD_HOME", home);
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
    return yield* program.pipe(
      Effect.provide(EventLog.layer.pipe(Layer.provide(Redactor.layer))),
    );
  }).pipe(
    Effect.provide(SqliteClient.layer({ filename: join(home, "events.sqlite") })),
    Effect.scoped,
  );

it.effect("4.5 write failure: catches swallowing a database error, reporting success, or losing the refusal reason", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const sql = yield* SqlClient.SqlClient;
    yield* log.append(owner, request("before"), "1".repeat(64), [event], {});
    // Make this actual writer connection refuse writes. No permissions trick
    // (which fails when run as root), disk exhaustion, or SQL mock is needed.
    yield* sql`PRAGMA query_only = ON`;
    const failed = yield* log.append(owner, request("cannot-write"), "2".repeat(64), [event], {}).pipe(Effect.result);

    expect(failed._tag).toBe("Failure");
    if (failed._tag !== "Failure") throw new Error("The read-only write unexpectedly succeeded");
    expect(failed.failure).toBeInstanceOf(EventLog.LogWriteFailed);
    expect(failed.failure.reason.trim().length).toBeGreaterThan(0);
    expect(yield* sql`SELECT COUNT(*) AS n FROM events`).toEqual([{ n: 1 }]);
    expect(yield* sql`SELECT COUNT(*) AS n FROM receipts`).toEqual([{ n: 1 }]);
    expect(yield* sql`SELECT COUNT(*) AS n FROM receipts WHERE request_id = 'cannot-write'`).toEqual([{ n: 0 }]);
  })),
);

it.effect("4.5 refusal latch: catches accepting later appends after a write failure or replacing its recorded reason", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA query_only = ON`;
    const failed = yield* log.append(owner, request("cannot-write"), "3".repeat(64), [event], {}).pipe(Effect.result);
    if (failed._tag !== "Failure") throw new Error("The read-only write unexpectedly succeeded");
    expect(failed.failure).toBeInstanceOf(EventLog.LogWriteFailed);
    expect(failed.failure.reason.trim().length).toBeGreaterThan(0);
    yield* sql`PRAGMA query_only = OFF`;
    // Prove the physical fault is gone, using an empty UPDATE that changes no
    // domain data. Refusal must now come from EventLog's failure state.
    yield* sql`UPDATE events SET payload_json = payload_json WHERE 0`;
    const later = yield* log.append(owner, request("after-failure"), "4".repeat(64), [event], {
      agentTokens: [{ agentId, tokenHash: "c".repeat(64), revokedAt: null }],
    }).pipe(Effect.result);

    expect(later._tag).toBe("Failure");
    if (later._tag !== "Failure") throw new Error("The failed writer accepted another append");
    expect(later.failure).toBeInstanceOf(EventLog.LogWriteFailed);
    expect(later.failure.reason).toBe(failed.failure.reason);
    expect(yield* sql`SELECT COUNT(*) AS n FROM events`).toEqual([{ n: 0 }]);
    expect(yield* sql`SELECT COUNT(*) AS n FROM agent_tokens`).toEqual([{ n: 0 }]);
    expect(yield* sql`SELECT COUNT(*) AS n FROM receipts`).toEqual([{ n: 0 }]);
  })),
);
