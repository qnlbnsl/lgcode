import { randomUUID } from "node:crypto";

import {
  EventEnvelope, type Actor, type AgentId, type BootId, type Event, type RequestId,
} from "@shepherd/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import * as Redactor from "./Redactor.ts";

// The reason names the failure and never carries data. It is built from a
// fixed category and nothing else, because SQLite's own message can quote a
// stored value.
export class LogWriteFailed extends Data.TaggedError("LogWriteFailed")<{
  readonly reason: string;
}> {}

export class RequestIdReused extends Data.TaggedError("RequestIdReused")<{
  readonly reason: "request id reused";
}> {}

export interface AgentTokenRow {
  readonly agentId: AgentId;
  readonly tokenHash: string;
  readonly revokedAt: number | null;
}

export interface ProcessRow {
  readonly agentId: AgentId;
  readonly groupId: number;
  readonly bootId: BootId;
  readonly startTime: string;
  readonly userId: number;
  readonly executable: string;
}

export interface SideRows {
  readonly agentTokens?: ReadonlyArray<AgentTokenRow>;
  readonly processes?: ReadonlyArray<ProcessRow>;
}

export class EventLog extends Context.Service<
  EventLog,
  {
    readonly append: (
      caller: Actor,
      requestId: RequestId,
      bodyHash: string,
      events: ReadonlyArray<Event>,
      sideRows: SideRows,
    ) => Effect.Effect<ReadonlyArray<EventEnvelope>, LogWriteFailed | RequestIdReused>;
  }
>()("shepherd/engine/log/EventLog") {}

const Envelopes = Schema.Array(EventEnvelope);
const decodeEnvelopes = Schema.decodeUnknownSync(Envelopes);

// SQLite's primary result code for a full disk.
const SQLITE_FULL = 13;

const failureReason = (error: SqlError): string => {
  const reason = error.reason;
  const errno: unknown = typeof reason.cause === "object" && reason.cause !== null && "errno" in reason.cause
    ? reason.cause.errno
    : undefined;
  if (typeof errno === "number" && (errno & 0xff) === SQLITE_FULL) return "database write failed: disk full";
  switch (reason._tag) {
    case "UniqueViolation":
    case "ConstraintError": return "database write failed: constraint";
    case "LockTimeoutError": return "database write failed: busy";
    default: return "database write failed";
  }
};

// The caller as stored in `events.caller` and `receipts.caller`. It is built
// field by field so the text does not depend on property order or on extra
// runtime properties.
const callerKey = (actor: Actor): string => actor._tag === "owner" ? "owner" : `agent:${actor.agentId}`;

// Pattern: T3 Code apps/server/src/orchestration-v2/EventSink.ts
// (`sql.withTransaction`, lines 716 and 781; MIT licence). The shape was
// reused, no code.
export const layer = Layer.effect(EventLog, Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const redactor = yield* Redactor.Redactor;
  // WAL lets readers run beside this single writer. The mode is stored in the
  // file; setting it again on an already-WAL file changes nothing.
  yield* sql`PRAGMA journal_mode = WAL`;
  const writer = yield* Semaphore.make(1);
  // The first write failure, kept for the life of this service. It is read and
  // set only while the writer permit is held.
  let latched: LogWriteFailed | undefined;

  const commit = (
    caller: string, requestId: RequestId, bodyHash: string, events: ReadonlyArray<Event>,
    sideRows: SideRows, actor: Actor, occurredAt: number,
  ): Effect.Effect<ReadonlyArray<EventEnvelope>, RequestIdReused | LogWriteFailed | SqlError> =>
    sql.withTransaction(Effect.gen(function* () {
      const existing = yield* sql<{ body_hash: string; result_json: string }>`
        SELECT body_hash, result_json FROM receipts WHERE caller = ${caller} AND request_id = ${requestId}`;
      const receipt = existing[0];
      if (receipt !== undefined) {
        if (receipt.body_hash !== bodyHash) {
          return yield* Effect.fail(new RequestIdReused({ reason: "request id reused" }));
        }
        return yield* Effect.try({
          try: () => decodeEnvelopes(JSON.parse(receipt.result_json)),
          catch: () => new LogWriteFailed({ reason: "stored receipt is unreadable" }),
        });
      }

      const envelopes: Array<EventEnvelope> = [];
      for (const event of events) {
        const eventId = randomUUID();
        const agentId = "agentId" in event ? event.agentId : undefined;
        const rows = yield* sql<{ sequence: number }>`
          INSERT INTO events (event_id, caller, request_id, agent_id, event_type, occurred_at, payload_json)
          VALUES (${eventId}, ${caller}, ${requestId}, ${agentId ?? null}, ${event._tag}, ${occurredAt}, ${JSON.stringify(event)})
          RETURNING sequence`;
        const row = rows[0];
        if (row === undefined) return yield* Effect.fail(new LogWriteFailed({ reason: "event insert returned no sequence" }));
        envelopes.push(Schema.decodeUnknownSync(EventEnvelope)({
          sequence: row.sequence, eventId, occurredAt, caller: actor, requestId,
          ...(agentId === undefined ? {} : { agentId }), event,
        }));
      }
      for (const token of sideRows.agentTokens ?? []) {
        yield* sql`INSERT INTO agent_tokens (token_hash, agent_id, revoked_at)
          VALUES (${token.tokenHash}, ${token.agentId}, ${token.revokedAt})`;
      }
      for (const row of sideRows.processes ?? []) {
        yield* sql`INSERT INTO processes (agent_id, group_id, boot_id, start_time, user_id, executable)
          VALUES (${row.agentId}, ${row.groupId}, ${row.bootId}, ${row.startTime}, ${row.userId}, ${row.executable})`;
      }
      yield* sql`INSERT INTO receipts (caller, request_id, body_hash, result_json, first_sequence)
        VALUES (${caller}, ${requestId}, ${bodyHash}, ${JSON.stringify(envelopes)}, ${envelopes[0]?.sequence ?? null})`;
      return envelopes;
    }));

  const append: Context.Service.Shape<typeof EventLog>["append"] = (actor, requestId, bodyHash, events, sideRows) =>
    writer.withPermits(1)(Effect.gen(function* () {
      if (latched !== undefined) return yield* Effect.fail(latched);
      const redacted = yield* Effect.forEach(events, (event) => redactor.redact(event));
      const occurredAt = yield* Clock.currentTimeMillis;
      return yield* commit(callerKey(actor), requestId, bodyHash, redacted, sideRows, actor, occurredAt).pipe(
        Effect.mapError((error) => error._tag === "SqlError"
          ? new LogWriteFailed({ reason: failureReason(error) })
          : error),
        // A request-id refusal is the caller's mistake, so only a write failure latches.
        Effect.tapError((error) => error._tag === "LogWriteFailed"
          ? Effect.sync(() => { latched = error; })
          : Effect.void),
      );
    }));

  return EventLog.of({ append });
}));
