import { EventSequence as EventSequenceSchema, type EventSequence } from "@lgcode/contracts";
import * as SqliteClient from "@lgcode/t3-node-sqlite/nodeSqliteClient";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as EventLog from "../log/EventLog.ts";
import { LogReadFailed } from "../log/subscribe.ts";
import { rebuild } from "./rebuild.ts";
import * as Views from "./Views.ts";

interface Difference {
  readonly path: ReadonlyArray<string>;
  readonly live: unknown;
  readonly rebuilt: unknown;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

// A key named `constructor` or `__proto__` is data here, never inherited.
const own = (record: Readonly<Record<string, unknown>>, key: string): unknown =>
  Object.hasOwn(record, key) ? record[key] : undefined;

// Every place the two values differ, as the path to it and both values. An
// absent key and an `undefined` value are the same; arrays are compared by
// index, so a missing last item is one difference.
const diff = (live: unknown, rebuilt: unknown, path: ReadonlyArray<string>, out: Array<Difference>): void => {
  if (Object.is(live, rebuilt)) return;
  if (isRecord(live) && isRecord(rebuilt) && Array.isArray(live) === Array.isArray(rebuilt)) {
    const keys = new Set([...Object.keys(live), ...Object.keys(rebuilt)]);
    for (const key of keys) diff(own(live, key), own(rebuilt, key), [...path, key], out);
    return;
  }
  out.push({ path, live, rebuilt });
};

// The caller named a head that is not the log's durable head.
export class CompareHeadMismatch extends Data.TaggedError("CompareHeadMismatch")<{
  readonly requested: EventSequence;
  readonly head: EventSequence;
}> {}

const decodeSequence = Schema.decodeUnknownSync(EventSequenceSchema);

// Row 62: under one hold of the writer's permit the durable head H is read
// and the live views are copied, so no committed
// batch is half-applied in the copy and H is the head of exactly that copy.
// The permit is released before the rebuild, which reads rows 1 through H on
// a read connection; those rows never change, so later appends cannot move
// it. `expected`, when given, must equal H, or the comparison fails before
// any rebuild. A live projection that lags or runs ahead of H is not a
// mismatch: it shows as a difference, because the views' own sequence differs.
export const compareViews = (expected?: EventSequence): Effect.Effect<
  { readonly sequence: EventSequence; readonly differences: ReadonlyArray<Difference> },
  LogReadFailed | CompareHeadMismatch,
  EventLog.EventLog | Views.Views | SqlClient.SqlClient
> => Effect.gen(function* () {
  const log = yield* EventLog.EventLog;
  const views = yield* Views.Views;
  const sql = yield* SqlClient.SqlClient;
  const { head, live } = yield* log.withWriterPermit(Effect.gen(function* () {
    // The head is read on the read connection: every commit happens under
    // the permit, so a read begun while holding it sees all of them, and it
    // never waits behind a transaction open on the writer connection.
    const rows = yield* SqliteClient.readOnly(sql<{ head: number }>`
      SELECT COALESCE(MAX(sequence), 0) AS head FROM events`);
    return { head: decodeSequence(rows[0]!.head), live: yield* views.snapshot };
  }));
  if (expected !== undefined && expected !== head) {
    return yield* new CompareHeadMismatch({ requested: expected, head });
  }
  const rebuilt = yield* rebuild(head, views.lists);
  const differences: Array<Difference> = [];
  diff(live, rebuilt, [], differences);
  return { sequence: head, differences };
}).pipe(Effect.mapError((error) => error._tag === "SqlError"
  ? new LogReadFailed({ reason: "database read failed" })
  : error));
