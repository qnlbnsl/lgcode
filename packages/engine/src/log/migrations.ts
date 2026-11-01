import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// The one migration list for every table (decision row 32). Later units add
// entries to the end of this list and never edit an applied entry.
//
// Layout pattern: T3 Code `orchestration_v2_events` and
// `orchestration_v2_command_receipts` in
// apps/server/src/persistence/Migrations/055_OrchestrationV2.ts (MIT licence);
// only the shape was reused, no code.
const migrations: ReadonlyArray<{ readonly id: number; readonly statements: ReadonlyArray<string> }> = [
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
      yield* sql`INSERT INTO schema_migrations (id) VALUES (${migration.id})`;
    }));
  }
});
