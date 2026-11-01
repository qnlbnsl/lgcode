import { randomUUID } from "node:crypto";

import {
  EventEnvelope, type Actor, type AgentId, type BootId, DeviceId, type Event, type RequestId,
} from "@shepherd/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import { isSqlError, type SqlError } from "effect/sql/SqlError";

import * as Views from "../views/Views.ts";
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

// A device row holds the credential's hash, never the credential.
export interface DeviceRow {
  readonly deviceId: DeviceId;
  readonly name: string;
  readonly tokenHash: string;
  readonly createdAt: number;
  readonly revokedAt: number | null;
}

// Rows written in the same transaction as the batch's events (decision row
// 32, issue 33). Revocations are applied before inserts, so a rotation
// revokes an agent's earlier tokens and then adds its new one. `"all"`
// revokes every agent token, for start-up recovery (decision row 52, step 4).
// A revoked row's `revoked_at` is the batch's `occurredAt`.
export interface SideRows {
  readonly revokeAgentTokens?: ReadonlyArray<AgentId> | "all";
  readonly agentTokens?: ReadonlyArray<AgentTokenRow>;
  readonly revokeDevices?: ReadonlyArray<DeviceId>;
  readonly devices?: ReadonlyArray<DeviceRow>;
  readonly processes?: ReadonlyArray<ProcessRow>;
}

type Append = (
  caller: Actor, requestId: RequestId, bodyHash: string,
  events: ReadonlyArray<Event>, sideRows: SideRows,
  receipt?: false | ((envelopes: ReadonlyArray<EventEnvelope>) => unknown),
) => Effect.Effect<ReadonlyArray<EventEnvelope>, LogWriteFailed | RequestIdReused>;

export class EventLog extends Context.Service<
  EventLog,
  {
    readonly append: Append;
    readonly subscribeCommitted: Effect.Effect<PubSub.Subscription<EventEnvelope>, never, Scope.Scope>;
    // Runs an effect while holding the writer's permit, so no batch commits
    // or updates the live views meanwhile. For `compareViews` only.
    readonly withWriterPermit: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
    // Checks and append share the permit and the SQLite transaction. Only
    // use the supplied append inside the callback; publication follows COMMIT.
    readonly transact: <A, E, R>(
      use: (append: Append) => Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | LogWriteFailed, R>;
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
  const views = yield* Views.Views;
  // WAL lets readers run beside this single writer. The mode is stored in the
  // file; setting it again on an already-WAL file changes nothing.
  yield* sql`PRAGMA journal_mode = WAL`;
  const writer = yield* Semaphore.make(1);
  const committedEvents = yield* Effect.acquireRelease(
    PubSub.unbounded<EventEnvelope>(),
    PubSub.shutdown,
  );
  // Called only after COMMIT, while the writer permit still orders batches.
  // The live views are updated first, so a subscriber that sees an event and
  // then reads the views finds the event applied. Neither step can fail.
  const publishCommitted = (envelopes: ReadonlyArray<EventEnvelope>) =>
    views.applyCommitted(envelopes).pipe(
      Effect.andThen(PubSub.publishAll(committedEvents, envelopes)),
      Effect.asVoid,
    );
  // The first write failure, kept for the life of this service. It is read and
  // set only while the writer permit is held.
  let latched: LogWriteFailed | undefined;

  const commit = (
    caller: string, requestId: RequestId, bodyHash: string, events: ReadonlyArray<Event>,
    sideRows: SideRows, actor: Actor, occurredAt: number,
    receiptResult?: false | ((envelopes: ReadonlyArray<EventEnvelope>) => unknown),
  ): Effect.Effect<{
    readonly envelopes: ReadonlyArray<EventEnvelope>;
    readonly isNew: boolean;
  }, RequestIdReused | LogWriteFailed | SqlError> =>
    sql.withTransaction(Effect.gen(function* () {
      const existing = yield* sql<{ body_hash: string; result_json: string }>`
        SELECT body_hash, result_json FROM receipts WHERE caller = ${caller} AND request_id = ${requestId}`;
      const receipt = existing[0];
      if (receipt !== undefined) {
        if (receipt.body_hash !== bodyHash) {
          return yield* Effect.fail(new RequestIdReused({ reason: "request id reused" }));
        }
        const envelopes = yield* Effect.try({
          try: () => {
            const result: unknown = JSON.parse(receipt.result_json);
            return decodeEnvelopes(Array.isArray(result) ? result
              : Schema.decodeUnknownSync(Schema.Struct({ envelopes: Envelopes }))(result).envelopes);
          },
          catch: () => new LogWriteFailed({ reason: "stored receipt is unreadable" }),
        });
        return { envelopes, isNew: false };
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
      if (sideRows.revokeAgentTokens === "all") {
        yield* sql`UPDATE agent_tokens SET revoked_at = ${occurredAt} WHERE revoked_at IS NULL`;
      } else {
        for (const agentId of sideRows.revokeAgentTokens ?? []) {
          yield* sql`UPDATE agent_tokens SET revoked_at = ${occurredAt}
            WHERE agent_id = ${agentId} AND revoked_at IS NULL`;
        }
      }
      for (const token of sideRows.agentTokens ?? []) {
        yield* sql`INSERT INTO agent_tokens (token_hash, agent_id, revoked_at)
          VALUES (${token.tokenHash}, ${token.agentId}, ${token.revokedAt})`;
      }
      for (const deviceId of sideRows.revokeDevices ?? []) {
        yield* sql`UPDATE devices SET revoked_at = ${occurredAt} WHERE device_id = ${deviceId} AND revoked_at IS NULL`;
      }
      for (const device of sideRows.devices ?? []) {
        yield* sql`INSERT INTO devices (device_id, name, token_hash, created_at, revoked_at)
          VALUES (${device.deviceId}, ${device.name}, ${device.tokenHash}, ${device.createdAt}, ${device.revokedAt})`;
      }
      for (const row of sideRows.processes ?? []) {
        yield* sql`INSERT INTO processes (agent_id, group_id, boot_id, start_time, user_id, executable)
          VALUES (${row.agentId}, ${row.groupId}, ${row.bootId}, ${row.startTime}, ${row.userId}, ${row.executable})`;
      }
      if (receiptResult !== false) {
        const result = receiptResult === undefined ? envelopes
          : { envelopes, reply: yield* redactReceipt(receiptResult(envelopes)) };
        yield* sql`INSERT INTO receipts (caller, request_id, body_hash, result_json, first_sequence)
          VALUES (${caller}, ${requestId}, ${bodyHash}, ${JSON.stringify(result)}, ${envelopes[0]?.sequence ?? null})`;
      }
      return { envelopes, isNew: true };
    }));

  // Replies may contain list data as well as identifiers. Keep receipt text
  // behind the same redactor, including nested strings and record keys.
  const redactReceipt = (value: unknown): Effect.Effect<unknown> => Effect.gen(function* () {
    if (typeof value === "string") return yield* redactor.redactText(value);
    if (Array.isArray(value)) return yield* Effect.forEach(value, redactReceipt);
    if (typeof value === "object" && value !== null) {
      const entries = yield* Effect.forEach(Object.entries(value), ([key, item]) => Effect.gen(function* () {
        return [yield* redactor.redactText(key), yield* redactReceipt(item)] as const;
      }));
      return Object.fromEntries(entries);
    }
    return value;
  });

  // Identifiers and token hashes are not free text and are left alone.
  const redactSideRows = (sideRows: SideRows): Effect.Effect<SideRows> => Effect.gen(function* () {
    const devices = yield* Effect.forEach(sideRows.devices ?? [], (device) =>
      Effect.map(redactor.redactText(device.name), (name): DeviceRow => ({ ...device, name })));
    const processes = yield* Effect.forEach(sideRows.processes ?? [], (row) =>
      Effect.map(redactor.redactText(row.executable), (executable): ProcessRow => ({ ...row, executable })));
    return { ...sideRows, devices, processes };
  });

  const transact: Context.Service.Shape<typeof EventLog>["transact"] = (use) =>
    writer.withPermits(1)(Effect.gen(function* () {
      if (latched !== undefined) return yield* Effect.fail(latched);
      const published: Array<EventEnvelope> = [];
      let active = true;
      const append: Context.Service.Shape<typeof EventLog>["append"] = (actor, requestId, bodyHash, events, sideRows, receiptResult) =>
        Effect.gen(function* () {
          if (!active) return yield* new LogWriteFailed({ reason: "writer transaction is closed" });
          const redacted = yield* Effect.forEach(events, (event) => redactor.redact(event));
          const redactedSideRows = yield* redactSideRows(sideRows);
          const occurredAt = yield* Clock.currentTimeMillis;
          const batch = yield* commit(callerKey(actor), requestId, bodyHash, redacted, redactedSideRows, actor, occurredAt, receiptResult).pipe(
            Effect.mapError((error) => error._tag === "SqlError"
              ? new LogWriteFailed({ reason: failureReason(error) }) : error),
          );
          if (batch.isNew) published.push(...batch.envelopes);
          return batch.envelopes;
        });
      return yield* Effect.gen(function* () {
        const result = yield* sql.withTransaction(Effect.suspend(() => use(append))).pipe(
          Effect.ensuring(Effect.sync(() => { active = false; })),
          Effect.mapError((error) => isSqlError(error)
            ? new LogWriteFailed({ reason: failureReason(error) }) : error),
        );
        if (published.length > 0) yield* publishCommitted(published);
        return result;
      }).pipe(
        // A caller's cancellation must not split a successful COMMIT from its
        // publication. Waiting for the writer permit remains interruptible.
        Effect.uninterruptible,
        // A request-id refusal is the caller's mistake, so only a write failure latches.
        Effect.tapError((error) => error instanceof LogWriteFailed
          ? Effect.sync(() => { latched = error; })
          : Effect.void),
      );
    }));

  const append: Context.Service.Shape<typeof EventLog>["append"] = (...args) =>
    transact((write) => write(...args));

  return EventLog.of({
    append,
    transact,
    subscribeCommitted: PubSub.subscribe(committedEvents),
    withWriterPermit: writer.withPermits(1),
  });
}));
