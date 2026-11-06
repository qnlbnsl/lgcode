import type { EventSequence } from "@sheprd/contracts";
import * as SqliteClient from "@sheprd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import { decodeRowWith, LogReadFailed, PAGE_SIZE, type EventRow } from "../log/subscribe.ts";
import { engineLists, type EngineLists } from "../pieces/lists.ts";
import { applyWith, emptyViews } from "./apply.ts";

// Folds sequence 1 through `upTo` into a fresh state and touches nothing
// else: the live views are neither read nor changed. Sequence zero is the
// empty state.
//
// Row 62: the log is read on a read connection, so a rebuild never waits for
// the writer. `SqliteClient.readOnly` reaches that connection only when the
// SQLite layer sets `readerWorker: true` on a file database, and only when
// the file is already in WAL mode when the first reader opens (issues 39 and
// 45). Otherwise the copied client silently reads on the writer connection.
// Rows up to `upTo` are committed and never change, so reading them in
// separate pages is consistent.
export const rebuild = (upTo: EventSequence, lists: EngineLists = engineLists): Effect.Effect<
  ReturnType<typeof emptyViews>, LogReadFailed, SqlClient.SqlClient
> => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* Stream.paginate(0, (cursor: number) => SqliteClient.readOnly(sql<EventRow>`
    SELECT sequence, event_id, caller, caller_rule, request_id, agent_id, occurred_at, payload_json
    FROM events WHERE sequence > ${cursor} AND sequence <= ${upTo}
    ORDER BY sequence LIMIT ${PAGE_SIZE}`
  ).pipe(Effect.map((page) => [
    page,
    page.length === PAGE_SIZE ? Option.some(page[page.length - 1]!.sequence) : Option.none<number>(),
  ] as const))).pipe(
    Stream.mapEffect((row) => decodeRowWith(row, lists.envelope)),
    Stream.runFold(() => emptyViews(lists.views), (state, envelope) => applyWith(state, envelope, lists.views)),
  );
}).pipe(Effect.mapError((error) => error._tag === "SqlError"
  ? new LogReadFailed({ reason: "database read failed" })
  : error));
