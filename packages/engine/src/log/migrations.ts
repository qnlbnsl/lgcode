import { pieceNamespaces, type PieceNamespace, type Event } from "@shephrd/contracts";
import { threadAgent } from "../views/apply.ts";
import type { Migration } from "../pieces/lists.ts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// The one migration list for every table (decision row 32). Later units add
// entries to the end of this list and never edit an applied entry.
//
// Layout pattern: T3 Code `orchestration_v2_events` and
// `orchestration_v2_command_receipts` in
// apps/server/src/persistence/Migrations/055_OrchestrationV2.ts (MIT licence);
// only the shape was reused, no code.
const migrations: ReadonlyArray<{ readonly id: number; readonly statements: ReadonlyArray<string>; readonly backfillThreads?: true }> = [
  {
    id: 1,
    statements: [
      // `caller` holds `owner` or `agent:<agent id>`, as built by callerKey.
      `CREATE TABLE events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        caller TEXT NOT NULL,
        request_id TEXT NOT NULL,
        agent_id TEXT,
        event_type TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        payload_json TEXT NOT NULL
      )`,
      `CREATE INDEX events_agent_sequence_idx ON events(agent_id, sequence)`,
      `CREATE INDEX events_request_idx ON events(caller, request_id)`,
      // first_sequence is null only for a batch that wrote no events.
      `CREATE TABLE receipts (
        caller TEXT NOT NULL,
        request_id TEXT NOT NULL,
        body_hash TEXT NOT NULL,
        result_json TEXT NOT NULL,
        first_sequence INTEGER,
        PRIMARY KEY (caller, request_id)
      )`,
      // A new token is minted for every spawn and the old one revoked, so an
      // agent has many rows over time; the hash is the identity.
      `CREATE TABLE agent_tokens (
        token_hash TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        revoked_at INTEGER
      )`,
      `CREATE INDEX agent_tokens_agent_idx ON agent_tokens(agent_id)`,
      `CREATE TABLE devices (
        device_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      )`,
      // The operational process identity committed with SessionOpened. The
      // event holds the historical snapshot; this row is what a restart sweep
      // reads (decision row 31).
      `CREATE TABLE processes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        group_id INTEGER NOT NULL,
        boot_id TEXT NOT NULL,
        start_time TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        executable TEXT NOT NULL
      )`,
      `CREATE INDEX processes_agent_idx ON processes(agent_id)`,
    ],
  },
  {
    id: 2,
    statements: [
      "ALTER TABLE events ADD COLUMN thread_agent_id TEXT",
      "CREATE INDEX events_thread_agent_sequence_idx ON events(thread_agent_id, sequence)",
    ],
    backfillThreads: true,
  },
];

// Idempotent: each entry runs once, in its own transaction, and is recorded in
// the same transaction, so a crash leaves either all of an entry or none of it.
export const migrate = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY)`;
  for (const migration of migrations) {
    yield* sql.withTransaction(Effect.gen(function* () {
      const applied = yield* sql`SELECT id FROM schema_migrations WHERE id = ${migration.id}`;
      if (applied.length > 0) return;
      for (const statement of migration.statements) yield* sql.unsafe(statement);
      if (migration.backfillThreads) {
        // Decode only membership, rather than requiring a modern payload schema
        // for every old row. threadAgent excludes all non-engine tags.
        let after = 0;
        for (;;) {
          const page = yield* sql<{ sequence: number; payload_json: string }>`SELECT sequence, payload_json FROM events WHERE sequence > ${after} ORDER BY sequence LIMIT 512`;
          for (const row of page) {
            const id = yield* Effect.try({ try: () => threadAgent(JSON.parse(row.payload_json) as Event), catch: () => new PieceMigrationFailed() });
            if (id !== undefined) yield* sql`UPDATE events SET thread_agent_id = ${id} WHERE sequence = ${row.sequence}`;
            after = row.sequence;
          }
          if (page.length < 512) break;
        }
      }
      yield* sql`INSERT INTO schema_migrations (id) VALUES (${migration.id})`;
    }));
  }
});

export class PieceMigrationFailed extends Data.TaggedError("PieceMigrationFailed")<{}> {}

// Migrations deliberately accept a small DDL vocabulary. Reject comments,
// multiple statements, triggers, views and expressions that can name another
// table. Later migrations can extend this grammar with an explicit review.
const validStatement = (namespace: PieceNamespace, statement: string): boolean => {
  if (/--|\/\*|;|\b(?:SELECT|ATTACH|DETACH|PRAGMA|TRIGGER|VIEW|VIRTUAL)\b/i.test(statement)) return false;
  const identifier = `[A-Za-z_][A-Za-z0-9_]*`;
  const table = new RegExp(`^(?:CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?|ALTER\\s+TABLE|DROP\\s+TABLE(?:\\s+IF\\s+EXISTS)?)\\s+(${identifier})\\b`, "i").exec(statement.trim());
  const index = new RegExp(`^CREATE\\s+(?:UNIQUE\\s+)?INDEX(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+(${identifier})\\s+ON\\s+(${identifier})\\b`, "i").exec(statement.trim());
  const owns = (name: string) => name.startsWith(`${namespace}_`) && name.length > namespace.length + 1;
  if (table === null && index === null) return false;
  if (table !== null && !owns(table[1]!)) return false;
  if (index !== null && (!owns(index[1]!) || !owns(index[2]!))) return false;
  // Quoted identifiers are not part of this vocabulary. Single-quoted text
  // is removed before checking references and rename destinations.
  const code = statement.replace(/'(?:''|[^'])*'/g, "''");
  if (/["`\[\]]/.test(code)) return false;
  for (const match of code.matchAll(/\b(?:REFERENCES|RENAME\s+TO)\s+([A-Za-z_][A-Za-z0-9_]*)/gi)) if (!owns(match[1]!)) return false;
  return true;
};
export const migratePieces = (groups: Readonly<Record<PieceNamespace, ReadonlyArray<Migration>>>) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS piece_schema_migrations (namespace TEXT NOT NULL, id INTEGER NOT NULL, PRIMARY KEY(namespace, id))`;
  for (const namespace of pieceNamespaces) for (const migration of groups[namespace]) {
    yield* sql.withTransaction(Effect.gen(function* () {
      if ((yield* sql`SELECT id FROM piece_schema_migrations WHERE namespace = ${namespace} AND id = ${migration.id}`).length > 0) return;
      if (!Number.isSafeInteger(migration.id) || migration.id < 1 || migration.statements.some((statement) => !validStatement(namespace, statement))) return yield* new PieceMigrationFailed();
      for (const statement of migration.statements) yield* sql.unsafe(statement);
      yield* sql`INSERT INTO piece_schema_migrations (namespace, id) VALUES (${namespace}, ${migration.id})`;
    }));
  }
});
