import { EventEnvelope } from "@lgtm/contracts";
import * as SqliteClient from "@lgtm/t3-node-sqlite/nodeSqliteClient";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as EventLog from "./EventLog.ts";

export class SubscribeAheadOfHead extends Data.TaggedError("SubscribeAheadOfHead")<{
  readonly after: number;
  readonly head: number;
}> {}

export class SubscribeInvalidCursor extends Data.TaggedError("SubscribeInvalidCursor")<{
  readonly after: number;
}> {}

export class LogReadFailed extends Data.TaggedError("LogReadFailed")<{
  readonly reason: "stored event is unreadable" | "database read failed";
}> {}

export interface EventRow {
  readonly sequence: number;
  readonly event_id: string;
  readonly caller: string;
  readonly caller_rule?: string | null;
  readonly request_id: string;
  readonly agent_id: string | null;
  readonly occurred_at: number;
  readonly payload_json: string;
}

export const decodeRowWith = (row: EventRow, envelope: Schema.Codec<EventEnvelope, unknown> = EventEnvelope) => Effect.try({
  try: () => {
    const caller = row.caller === "owner" ? { _tag: "owner" }
      : row.caller.startsWith("agent:") ? { _tag: "agent", agentId: row.caller.slice(6) }
      : row.caller.startsWith("service:") ? { _tag: "service", service: row.caller.slice(8), ...(row.caller_rule == null ? {} : { rule: row.caller_rule }) }
      : row.caller.startsWith("piece:") ? { _tag: "piece", namespace: row.caller.slice(6) } : undefined;
    if (caller === undefined) throw new Error("invalid caller");
    return Schema.decodeUnknownSync(envelope)({
      sequence: row.sequence,
      eventId: row.event_id,
      occurredAt: row.occurred_at,
      caller,
      requestId: row.request_id,
      ...(row.agent_id === null ? {} : { agentId: row.agent_id }),
      event: JSON.parse(row.payload_json),
    }) as EventEnvelope;
  },
  // Decode errors can include stored values, so expose only a fixed reason.
  catch: () => new LogReadFailed({ reason: "stored event is unreadable" }),
});

export const decodeRow = (row: EventRow) => decodeRowWith(row);

export const PAGE_SIZE = 512;

// Pattern: T3 Code apps/server/src/persistence/OrchestrationEventStore.ts,
// streamProjectedApplicationEvents (MIT licence). Only the ordering idea is
// reused: subscribe first, capture a head, replay, then drop overlap at the join.
export const subscribe = (after: number): Stream.Stream<
  EventEnvelope,
  SubscribeAheadOfHead | SubscribeInvalidCursor | LogReadFailed,
  EventLog.EventLog | SqlClient.SqlClient
> => Stream.unwrap(Effect.gen(function* () {
  if (!Number.isSafeInteger(after) || after < 0) {
    return yield* Effect.fail(new SubscribeInvalidCursor({ after }));
  }
  const log = yield* EventLog.EventLog;
  const sql = yield* SqlClient.SqlClient;
  // Stream.unwrap owns this subscription's scope, including failure and cancellation.
  const subscription = yield* log.subscribeCommitted;

  // PB-A5: both the head and every catch-up page deliberately use readOnly.
  // The file database's SqliteClient.layer MUST set readerWorker: true, or the
  // copied client silently routes these reads to the writer (issue 39), as it
  // also does when the reader pool is unavailable.
  const rows = yield* SqliteClient.readOnly(sql<{ head: number }>`
    SELECT COALESCE(MAX(sequence), 0) AS head FROM events`);
  const head = rows[0]!.head;
  if (after > head) return yield* Effect.fail(new SubscribeAheadOfHead({ after, head }));

  // A fixed upper bound keeps replay finite while the writer continues. Pages
  // release the reader between reads, and bound the memory used by catch-up.
  const catchUp = Stream.paginate(after, (cursor) => SqliteClient.readOnly(sql<EventRow>`
    SELECT sequence, event_id, caller, caller_rule, request_id, agent_id, occurred_at, payload_json
    FROM events WHERE sequence > ${cursor} AND sequence <= ${head}
    ORDER BY sequence LIMIT ${PAGE_SIZE}`
  ).pipe(Effect.map((page) => [
    page,
    page.length === PAGE_SIZE ? Option.some(page[page.length - 1]!.sequence) : Option.none<number>(),
  ] as const))).pipe(Stream.mapEffect((row) => decodeRowWith(row, log.lists?.envelope)));

  // Anything committed before the head read belongs to replay, including
  // events already buffered by the subscription. Later publishes are ordered
  // by the writer permit, so only this fixed overlap needs to be removed.
  const live = Stream.fromSubscription(subscription).pipe(Stream.filter((event) => event.sequence > head));
  return Stream.concat(catchUp, live);
})).pipe(Stream.mapError((error) => error._tag === "SqlError"
  ? new LogReadFailed({ reason: "database read failed" })
  : error));
