import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";

import type * as EventLog from "../../src/log/EventLog.ts";
import { compareViews } from "../../src/views/compare.ts";
import type * as Views from "../../src/views/Views.ts";

interface Options {
  // The deliberately corrupted live views of the 4.6 test must differ.
  readonly expectDifference?: boolean;
}

// Row 43: every engine test file registers this, so after each test the
// live views are compared with a rebuild from the stored log, and a
// difference fails the test.
//
// - `registerRebuildCheck()` in a scope that still holds the event log, the
//   live views and the database: it adds a finalizer that runs before they
//   close. `compareViews()` establishes the durable head itself, under the
//   writer's permit, so a live view that lost its last event cannot hide and
//   a racing append cannot cause a false difference.
// - `registerRebuildCheck({ noLog: true })` for a file that never opens an
//   event log: nothing to compare, so nothing is opened or rebuilt.
//
// The rebuild uses the read connection when the fixture's SQLite layer has
// reader workers (issue 39); otherwise the copied client reads on the writer
// connection, which is also correct. The check only reads, so it still works
// after a disk-failure fixture has set `PRAGMA query_only`. A missing
// `events` table fails the check.
export function registerRebuildCheck(options: { readonly noLog: true }): void;
export function registerRebuildCheck(options?: Options): Effect.Effect<
  void, never, Scope.Scope | Views.Views | EventLog.EventLog | SqlClient.SqlClient
>;
export function registerRebuildCheck(options: { readonly noLog?: true } & Options = {}): Effect.Effect<
  void, never, Scope.Scope | Views.Views | EventLog.EventLog | SqlClient.SqlClient
> | void {
  if (options.noLog === true) return;
  return Effect.addFinalizer(() => Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // A lost log table must fail the check: there would be nothing to
    // compare, and a real difference could hide behind it.
    const tables = yield* sql<{ name: string }>`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'events'`;
    if (tables.length === 0) {
      return yield* Effect.die(new Error("The events table is missing, so the live views cannot be compared with the log"));
    }
    const result = yield* compareViews();
    const different = result.differences.length > 0;
    if (different === (options.expectDifference === true)) return;
    return yield* Effect.die(new Error(different
      ? `Live views differ from the rebuild at sequence ${result.sequence}: ${JSON.stringify(result.differences.slice(0, 5))}`
      : `Expected the live views to differ from the rebuild at sequence ${result.sequence}, but they match`));
  }).pipe(Effect.orDie));
}
