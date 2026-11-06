import type { Caller, EventEnvelope } from "@sheprd/contracts";
import * as SqliteClient from "@sheprd/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { mayReadAgent, visibleTo } from "../api/visibility.ts";
import { refused } from "../commands/internal.ts";
import { engineLists, type EngineLists } from "../pieces/lists.ts";
import { Views } from "../views/Views.ts";
import { decodeRowWith, LogReadFailed, SubscribeAheadOfHead, SubscribeInvalidCursor, type EventRow } from "./subscribe.ts";

const budget = 900 * 1024;
export const agentRead = (input: { readonly caller: Caller; readonly agentId: string; readonly after: number; readonly limit: number }, lists: EngineLists = engineLists) => Effect.gen(function* () {
  if (!Number.isSafeInteger(input.after) || input.after < 0) return yield* new SubscribeInvalidCursor({ after: input.after });
  const view = yield* (yield* Views).snapshot;
  if (!mayReadAgent(input.caller, input.agentId, view)) return yield* refused();
  const sql = yield* SqlClient.SqlClient;
  const heads = yield* SqliteClient.readOnly(sql<{ head: number }>`SELECT COALESCE(MAX(sequence), 0) AS head FROM events`);
  const head = heads[0]!.head;
  if (input.after > head) return yield* new SubscribeAheadOfHead({ after: input.after, head });
  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(500, Math.floor(input.limit))) : 500;
  const items: EventEnvelope[] = [];
  let bytes = 2; // The JSON array's brackets.
  let cursor = input.after;
  for (;;) {
    const page = yield* SqliteClient.readOnly(sql<EventRow>`
      SELECT sequence, event_id, caller, caller_rule, request_id, agent_id, occurred_at, payload_json FROM events
      WHERE thread_agent_id = ${input.agentId} AND sequence > ${cursor} AND sequence <= ${view.sequence} ORDER BY sequence LIMIT 512`);
    for (const row of page) {
      const envelope = yield* decodeRowWith(row, lists.envelope);
      if (!visibleTo(input.caller, envelope, view, lists)) { cursor = row.sequence; continue; }
      const size = Buffer.byteLength(JSON.stringify(envelope)) + (items.length > 0 ? 1 : 0);
      if (items.length > 0 && (items.length >= limit || bytes + size > budget)) return { items, next: items.at(-1)!.sequence };
      items.push(envelope);
      bytes += size;
      cursor = row.sequence;
    }
    if (page.length < 512) return { items };
  }
}).pipe(Effect.mapError((error) => error._tag === "SqlError" ? new LogReadFailed({ reason: "database read failed" }) : error));
