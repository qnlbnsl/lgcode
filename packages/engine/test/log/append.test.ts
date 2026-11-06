import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import { it } from "@effect/vitest";
import {
  AgentId, BootId, EventEnvelope, RequestId, type Actor, type Event,
} from "@sheprd/contracts";
import * as SqliteClient from "@sheprd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
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
  home = mkdtempSync("/tmp/sheprd-append-");
  vi.stubEnv("SHEPRD_HOME", home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

const owner: Actor = { _tag: "owner" };
const agentId = Schema.decodeUnknownSync(AgentId)("agent-a");
const request = (id: string) => Schema.decodeUnknownSync(RequestId)(id);
const started: Event = {
  _tag: "SessionOpened", agentId, session: { _tag: "acp", sessionId: "session-a" },
  protocolVersion: 1, reloadable: true,
  process: {
    groupId: 42002, bootId: Schema.decodeUnknownSync(BootId)("test-boot"),
    startTime: "123456", userId: 1000, executable: "/tmp/fake-adapter",
  },
};
const sideRows = {
  agentTokens: [{ agentId, tokenHash: "a".repeat(64), revokedAt: null }],
  processes: [{ agentId, ...started.process! }],
};

// Startup migrates before constructing the writer. All three files use the
// copied SQLite client; no in-memory log or replacement SQL service is involved.
const withLog = <A, E>(
  program: Effect.Effect<A, E, EventLog.EventLog | SqlClient.SqlClient>,
  redactor = Redactor.layer,
) => Effect.gen(function* () {
  yield* migrate;
  return yield* Effect.scoped(Effect.gen(function* () {
    yield* registerRebuildCheck();
    return yield* program;
  })).pipe(
    Effect.provide(EventLog.layer.pipe(Layer.provideMerge(Views.layer), Layer.provide(redactor))),
  );
}).pipe(
  Effect.provide(SqliteClient.layer({ filename: join(home, "events.sqlite") })),
  Effect.scoped,
);

it.effect("4.1 sequences: catches resetting the counter per batch or starting at zero", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const sql = yield* SqlClient.SqlClient;
    const first = yield* log.append(owner, request("first"), "1".repeat(64), [
      { _tag: "TurnStarted", agentId }, { _tag: "TurnEnded", agentId, compact: false },
    ], {});
    const second = yield* log.append(owner, request("second"), "2".repeat(64), [
      { _tag: "AgentStopped", agentId },
    ], {});

    expect([...first, ...second].map((row) => row.sequence)).toEqual([1, 2, 3]);
    expect(yield* sql`SELECT sequence FROM events ORDER BY sequence`).toEqual([
      { sequence: 1 }, { sequence: 2 }, { sequence: 3 },
    ]);
    const envelopes = [...first, ...second].map((row) => Schema.decodeUnknownSync(EventEnvelope)(row));
    expect(new Set(envelopes.map((row) => row.eventId)).size).toBe(3);
    expect(envelopes.map((row) => row.caller)).toEqual([owner, owner, owner]);
    expect(envelopes.map((row) => row.requestId)).toEqual(["first", "first", "second"]);
    expect(envelopes.map((row) => row.agentId)).toEqual([agentId, agentId, agentId]);
  })),
);

it.effect("4.1 side rows: catches committing events while silently dropping token or process rows", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const sql = yield* SqlClient.SqlClient;
    const result = yield* log.append(owner, request("spawn"), "3".repeat(64), [started], sideRows);

    expect(result.map((row) => row.sequence)).toEqual([1]);
    expect(yield* sql`SELECT event_type FROM events`).toEqual([{ event_type: "SessionOpened" }]);
    expect(yield* sql`SELECT agent_id, token_hash, revoked_at FROM agent_tokens`).toEqual([
      { agent_id: "agent-a", token_hash: "a".repeat(64), revoked_at: null },
    ]);
    expect(yield* sql`SELECT agent_id, group_id, boot_id, start_time, user_id, executable FROM processes`).toEqual([{
      agent_id: "agent-a", group_id: 42002, boot_id: "test-boot", start_time: "123456",
      user_id: 1000, executable: "/tmp/fake-adapter",
    }]);
  })),
);

it.effect("4.1 rollback: catches autocommitting the first insert or writing side rows outside the batch transaction", () =>
  withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const sql = yield* SqlClient.SqlClient;
    // The first event really inserts. Only the second insert aborts; SQLite
    // RAISE(ABORT) rolls back that statement, so the writer must roll back the batch.
    yield* sql`CREATE TRIGGER fail_second_event BEFORE INSERT ON events
      WHEN (SELECT COUNT(*) FROM events) = 1
      BEGIN SELECT RAISE(ABORT, 'injected failure after first insert'); END`;
    const outcome = yield* log.append(owner, request("broken-spawn"), "4".repeat(64), [
      started, { _tag: "TurnStarted", agentId },
    ], sideRows).pipe(Effect.result);

    expect(Result.isFailure(outcome)).toBe(true);
    if (!Result.isFailure(outcome)) throw new Error("The injected write unexpectedly succeeded");
    expect(outcome.failure).toBeInstanceOf(EventLog.LogWriteFailed);
    expect(outcome.failure.reason.length).toBeGreaterThan(0);
    expect(yield* sql`SELECT COUNT(*) AS n FROM events`).toEqual([{ n: 0 }]);
    expect(yield* sql`SELECT COUNT(*) AS n FROM agent_tokens`).toEqual([{ n: 0 }]);
    expect(yield* sql`SELECT COUNT(*) AS n FROM processes`).toEqual([{ n: 0 }]);
    expect(yield* sql`SELECT COUNT(*) AS n FROM receipts`).toEqual([{ n: 0 }]);
  })),
);

it.effect.each(["agent_tokens", "processes"] as const)(
  "4.1 side-row rollback: catches committing events or earlier side rows before a failing %s insert",
  (table) => withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const sql = yield* SqlClient.SqlClient;
    // Fixed, test-owned identifiers. Failing after this side insert also catches
    // a writer that transacts events alone, then writes side rows separately.
    yield* sql.unsafe(`CREATE TRIGGER fail_side_row AFTER INSERT ON ${table}
      BEGIN SELECT RAISE(ABORT, 'injected side-row failure'); END`);
    const outcome = yield* log.append(owner, request("broken-side-row"), "6".repeat(64), [started], sideRows)
      .pipe(Effect.result);
    expect(Result.isFailure(outcome)).toBe(true);
    if (!Result.isFailure(outcome)) throw new Error("The injected side-row write unexpectedly succeeded");
    expect(outcome.failure).toBeInstanceOf(EventLog.LogWriteFailed);
    expect(yield* sql`SELECT COUNT(*) AS n FROM events`).toEqual([{ n: 0 }]);
    expect(yield* sql`SELECT COUNT(*) AS n FROM agent_tokens`).toEqual([{ n: 0 }]);
    expect(yield* sql`SELECT COUNT(*) AS n FROM processes`).toEqual([{ n: 0 }]);
    expect(yield* sql`SELECT COUNT(*) AS n FROM receipts`).toEqual([{ n: 0 }]);
  })),
);

it.effect("4.1 redaction: catches bypassing the Redactor or redacting only the first event in a batch", () => {
  const markingRedactor = Layer.succeed(Redactor.Redactor, {
    redactText: (text: string) => Effect.succeed(text),
    redact: (event: Event) => Effect.succeed(event._tag === "AgentStartFailed"
      ? { ...event, reason: "[redacted]" } : event),
  });
  return withLog(Effect.gen(function* () {
    const log = yield* EventLog.EventLog;
    const sql = yield* SqlClient.SqlClient;
    const result = yield* log.append(owner, request("redact"), "5".repeat(64), [
      { _tag: "AgentStartFailed", agentId, reason: "planted-secret-one" },
      { _tag: "AgentStartFailed", agentId, reason: "planted-secret-two" },
    ], {});
    const rows = yield* sql<{ payload_json: string }>`SELECT payload_json FROM events ORDER BY sequence`;
    expect(rows.map((row) => JSON.parse(row.payload_json))).toEqual([
      { _tag: "AgentStartFailed", agentId: "agent-a", reason: "[redacted]" },
      { _tag: "AgentStartFailed", agentId: "agent-a", reason: "[redacted]" },
    ]);
    expect(result.map((row) => row.event)).toEqual(rows.map((row) => JSON.parse(row.payload_json)));
    const receipts = yield* sql<{ result_json: string }>`SELECT result_json FROM receipts`;
    expect(JSON.stringify([...rows, ...receipts])).not.toContain("planted-secret");
  }), markingRedactor);
});

it.effect("4.1 startup: catches leaving the event database in rollback-journal mode or omitting the devices migration", () =>
  withLog(Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    expect(yield* sql`PRAGMA journal_mode`).toEqual([{ journal_mode: "wal" }]);
  })),
);
