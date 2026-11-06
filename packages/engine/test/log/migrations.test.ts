import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as SqliteClient from "@sheprd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it, vi } from "vitest";
import { migrate } from "../../src/log/migrations.ts";
import { decodeRow } from "../../src/log/subscribe.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
registerRebuildCheck({ noLog: true });

it("1.34 a version-2 database loses only devices, keeps every other row, decodes old callers without a rule and migrates twice", async () => {
  const home = mkdtempSync("/tmp/sheprd-device-migration-");
  vi.stubEnv("SHEPRD_HOME", home);
  try {
    await Effect.runPromise(Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY)`;
      yield* sql`INSERT INTO schema_migrations VALUES (1), (2)`;
      yield* sql`CREATE TABLE events (sequence INTEGER PRIMARY KEY, event_id TEXT, caller TEXT, request_id TEXT, agent_id TEXT, event_type TEXT, occurred_at INTEGER, payload_json TEXT, thread_agent_id TEXT)`;
      yield* sql`CREATE TABLE receipts (caller TEXT, request_id TEXT, body_hash TEXT, result_json TEXT, first_sequence INTEGER, PRIMARY KEY (caller, request_id))`;
      yield* sql`CREATE TABLE devices (device_id TEXT PRIMARY KEY, name TEXT, token_hash TEXT, created_at INTEGER, revoked_at INTEGER)`;
      yield* sql`CREATE TABLE agent_tokens (token_hash TEXT PRIMARY KEY, agent_id TEXT, revoked_at INTEGER)`;
      yield* sql`CREATE TABLE processes (id INTEGER PRIMARY KEY, agent_id TEXT, group_id INTEGER, boot_id TEXT, start_time TEXT, user_id INTEGER, executable TEXT)`;
      yield* sql`CREATE TABLE client_kept (id TEXT)`;
      yield* sql`INSERT INTO client_kept VALUES ('piece-row')`;
      yield* sql`INSERT INTO receipts VALUES ('owner', 'request', 'body', '[]', 1)`;
      yield* sql`INSERT INTO agent_tokens VALUES ('test-only-hash', 'agent', NULL)`;
      yield* sql`INSERT INTO processes VALUES (1, 'agent', 123, 'test-boot', '1', 1000, '/tmp/test-adapter')`;
      yield* sql`INSERT INTO devices VALUES ('old', 'Old device', 'test-only-device-hash', 1, NULL)`;
      const payload = JSON.stringify({ _tag: "AgentGrouped", agentId: "agent", groups: ["kept"] });
      yield* sql`INSERT INTO events VALUES (1, 'event', 'owner', 'request', 'agent', 'AgentGrouped', 1, ${payload}, 'agent')`;
      yield* migrate; yield* migrate;
      expect(yield* sql`SELECT name FROM sqlite_master WHERE name = 'devices'`).toEqual([]);
      for (const name of ["events", "receipts", "agent_tokens", "processes", "client_kept"]) expect(yield* sql.unsafe(`SELECT COUNT(*) AS n FROM ${name}`), name).toEqual([{ n: 1 }]);
      const columns = yield* sql<{ name: string }>`PRAGMA table_info(events)`;
      expect(columns.map((r) => r.name)).toContain("caller_rule");
      const rows = yield* sql<any>`SELECT * FROM events`;
      expect((yield* decodeRow(rows[0])).caller).toEqual({ _tag: "owner" });
      expect(rows[0].payload_json).toBe(payload);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: join(home, "events.sqlite") })), Effect.scoped));
  } finally { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); }
});
