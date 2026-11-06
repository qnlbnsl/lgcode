// Unit 1, criterion 1.3: Node.js 26's built-in `node:sqlite` module opens a
// database file under Effect 4.0.5, inside an `@effect/vitest` program.
//
// The pattern is T3 Code's `packages/shared/src/nodeSqliteClient.ts:layer`,
// reduced to what the criterion needs. This file imports only `node:sqlite`,
// `effect` and `@effect/vitest`: the copied T3 SQLite client arrives in unit 2.
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

// A scoped temporary folder under the system temporary directory (`/tmp` on
// Linux), removed when the scope closes (decisions row 54).
const tempDirectory = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "sheprd-sqlite-"))),
  (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
);

class Sqlite extends Context.Service<Sqlite, { readonly database: DatabaseSync }>()(
  "sheprd/test/smoke/Sqlite",
) {}

// The layer opens the file when it is built and closes it when its scope ends.
const sqliteLayer = (filename: string) =>
  Layer.effect(
    Sqlite,
    Effect.acquireRelease(
      Effect.sync(() => new DatabaseSync(filename)),
      (database) => Effect.sync(() => database.close()),
    ).pipe(Effect.map((database) => ({ database }))),
  );

interface NoteRow {
  readonly id: number;
  readonly body: string;
}

const readNotes = (database: DatabaseSync): ReadonlyArray<NoteRow> =>
  database
    .prepare("SELECT id, body FROM notes ORDER BY id")
    .all()
    .map((row) => ({ id: Number(row["id"]), body: String(row["body"]) }));

it.effect(
  "runs on Node.js 26 and exposes node:sqlite's DatabaseSync (breaks if the toolchain falls back to an older Node.js)",
  () =>
    Effect.sync(() => {
      assert.strictEqual(process.versions.node.split(".")[0], "26");
      assert.strictEqual(typeof DatabaseSync, "function");
      assert.strictEqual(typeof process.versions.sqlite, "string");
    }),
);

it.effect(
  "writes a row to a database file under a mkdtemp folder and reads it back (breaks if node:sqlite cannot open a file under Effect 4.0.5)",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* tempDirectory;
        const filename = join(directory, "state.sqlite");

        const rows = yield* Effect.gen(function* () {
          const { database } = yield* Sqlite;
          database.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
          const insert = database.prepare("INSERT INTO notes (body) VALUES (?)");
          insert.run("the sheprd keeps the flock");
          return readNotes(database);
        }).pipe(Effect.provide(sqliteLayer(filename)));

        assert.strictEqual(rows.length, 1);
        assert.strictEqual(rows[0]?.body, "the sheprd keeps the flock");
        assert.strictEqual(rows[0]?.id, 1);
        assert.strictEqual(directory.startsWith(tmpdir()), true);
        assert.strictEqual(existsSync(filename), true);
      }),
    ),
);

it.effect(
  "keeps the row after the layer's scope closes and the file is opened again (breaks if the database lives only in memory or the layer does not close it)",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* tempDirectory;
        const filename = join(directory, "state.sqlite");

        yield* Effect.gen(function* () {
          const { database } = yield* Sqlite;
          database.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
          database.prepare("INSERT INTO notes (body) VALUES (?)").run("first");
        }).pipe(Effect.provide(sqliteLayer(filename)));

        // The first connection is closed now; a second layer reads the same file.
        const rows = yield* Effect.gen(function* () {
          const { database } = yield* Sqlite;
          database.prepare("INSERT INTO notes (body) VALUES (?)").run("second");
          return readNotes(database);
        }).pipe(Effect.provide(sqliteLayer(filename)));

        assert.deepStrictEqual(
          rows.map((row) => row.body),
          ["first", "second"],
        );
      }),
    ),
);
