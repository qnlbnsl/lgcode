import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as SqliteClient from "@lgcode/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it } from "vitest";
import { migrate } from "../../src/log/migrations.ts";
import { productionModule, type EngineLists } from "../support/fixturePiece.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
type MigratePieces = (migrations: EngineLists["migrations"]) => Effect.Effect<void, unknown, SqlClient.SqlClient>;
const loadMigrate = async () => (await productionModule<{ migratePieces: MigratePieces }>("log/migrations.ts")).migratePieces;
const withDatabase = async (body: Effect.Effect<unknown, unknown, SqlClient.SqlClient>) => {
  const home = mkdtempSync("/tmp/lgcode-piece-migration-");
  try { await Effect.runPromise(body.pipe(Effect.provide(SqliteClient.layer({ filename: join(home, "events.sqlite") })), Effect.scoped)); }
  finally { rmSync(home, { recursive: true, force: true }); }
};

it("1.8 a namespaced migration runs once, keeps its rows and leaves every engine table intact", async () => {
  const migratePieces = await loadMigrate();
  expect(migratePieces, "E7 must run and validate piece migrations").toBeTypeOf("function");
  const migrations = { client: [{ id: 1, statements: ["CREATE TABLE client_fixture (id TEXT PRIMARY KEY)"] }], board: [], roles: [] };
  await withDatabase(Effect.gen(function* () {
    yield* migrate;
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO receipts VALUES ('owner', 'kept', 'hash', '[]', NULL)`;
    yield* migratePieces(migrations);
    yield* sql`INSERT INTO client_fixture (id) VALUES ('kept')`;
    yield* migratePieces(migrations);
    expect(yield* sql`SELECT id FROM client_fixture`).toEqual([{ id: "kept" }]);
    expect(yield* sql`SELECT request_id FROM receipts`).toEqual([{ request_id: "kept" }]);
    expect(yield* sql`SELECT COUNT(*) AS n FROM events`).toEqual([{ n: 0 }]);
  }));
});

it.each([
  "CREATE TABLE board_intrusion (id TEXT)", "CREATE TABLE intrusion (id TEXT)",
  "DROP TABLE events", "ALTER TABLE receipts ADD COLUMN intrusion TEXT", "DELETE FROM agent_tokens",
])("1.8 a client migration refuses %s before committing any of that migration", async (statement) => {
  const migratePieces = await loadMigrate();
  expect(migratePieces, "E7 must refuse out-of-namespace SQL").toBeTypeOf("function");
  await withDatabase(Effect.gen(function* () {
    yield* migrate;
    const sql = yield* SqlClient.SqlClient;
    const result = yield* migratePieces({ client: [{ id: 1, statements: ["CREATE TABLE client_first (id TEXT)", statement] }], board: [], roles: [] }).pipe(Effect.result);
    expect(result._tag).toBe("Failure");
    expect(yield* sql`SELECT name FROM sqlite_master WHERE name IN ('client_first', 'board_intrusion', 'intrusion')`).toEqual([]);
    expect(yield* sql`SELECT COUNT(*) AS n FROM events`).toEqual([{ n: 0 }]);
    expect((yield* sql<{ name: string }>`PRAGMA table_info(receipts)`).some((row) => row.name === "intrusion")).toBe(false);
  }));
});
