import { agentConfiguration, agentContext } from "./agentConfiguration.ts";
import type { ClientFilter, ClientStreamItem } from "@lgcode/contracts";
import * as SqliteClient from "@lgcode/t3-node-sqlite/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { ReadHandler } from "../../api/reads.ts";
import { snapshot } from "../../api/snapshot.ts";
import { visibleTo } from "../../api/visibility.ts";
import { refused } from "../../commands/internal.ts";
import { agentRead } from "../../log/agentRead.ts";
import { decodeRowWith, LogReadFailed, subscribe, type EventRow } from "../../log/subscribe.ts";
import { envelope, escapeLeadingSlash } from "../../routing/envelope.ts";
import { threadAgent } from "../../views/apply.ts";
import { encodedBytes } from "./display.ts";
import { roster } from "./roster.ts";

// Escape agent prose before JSON encoding. Metadata and identifiers stay
// whole, and the fixed header keeps request id newlines inside the data.
export const agentReadReply = (requestId: unknown, reply: Record<string, unknown>) => ({
  requestId,
  data: envelope("read", JSON.stringify(reply, (key, value) =>
    typeof value === "string" && ["text", "description", "title", "stderr", "prompt"].includes(key) ? escapeLeadingSlash(value) : value)),
});

const filtered: ReadHandler = (input, payload) => Stream.unwrap(Effect.gen(function* () {
  const filter = (payload.filter ?? {}) as ClientFilter;
  if (Object.values(filter).some((list) => !Array.isArray(list) || list.length === 0)) return yield* refused();
  let scanned = payload.after as number;
  let reported = scanned;
  let checkpointDue = false;
  const checkpoint = (): ClientStreamItem | undefined => {
    if (!checkpointDue || scanned <= reported) return undefined;
    checkpointDue = false;
    reported = scanned;
    return { _tag: "client.Checkpoint", sequence: scanned } as ClientStreamItem;
  };
  const events = subscribe(scanned).pipe(Stream.mapEffect((row) => input.runtime.views.snapshot.pipe(Effect.map((view): ClientStreamItem | undefined => {
    scanned = row.sequence;
    if (!visibleTo(input.actor, row, view, input.runtime.lists)) return checkpoint();
    if (filter.kinds !== undefined && !filter.kinds.includes(row.event._tag)) return checkpoint();
    const agent = threadAgent(row.event);
    if (agent !== undefined && (filter.agents !== undefined || filter.groups !== undefined)
      && !filter.agents?.includes(agent)
      && !view.agents[agent]?.groups.some((group) => filter.groups?.includes(group))) return checkpoint();
    reported = scanned;
    checkpointDue = false;
    const bytes = encodedBytes(row);
    return bytes > 256 * 1024 ? {
      _tag: "client.Oversized", sequence: row.sequence, tag: row.event._tag,
      ...(row.agentId === undefined ? {} : { agentId: row.agentId }), bytes,
    } : row;
  }))), Stream.filter((row): row is ClientStreamItem => row !== undefined));
  const checkpoints = Stream.fromEffectRepeat(Effect.sleep(30_000).pipe(Effect.map((): ClientStreamItem | undefined => {
    checkpointDue = true;
    return checkpoint();
  }))).pipe(Stream.filter((row): row is ClientStreamItem => row !== undefined));
  // A one-item chunk also keeps a quiet live stream responsive. The transport
  // measures the encoded wrapper before sending a boundary-size singleton.
  return Stream.merge(events, checkpoints).pipe(Stream.rechunk(1));
}));

export const clientReads = {
  "client.agent.configuration": agentConfiguration,
  "client.agent.context": agentContext,
  "client.snapshot": (input, payload) => snapshot(input.actor, input.runtime.lists).pipe(Effect.map((value) => ({ reply: { requestId: payload.requestId, ...value } }))),
  "client.roster": (input, payload) => input.runtime.views.snapshot.pipe(Effect.map((view) => ({ reply: {
    requestId: payload.requestId, agents: roster(input.actor, view).filter((row) =>
      (payload.group === undefined || row.groups.includes(payload.group as string))
      && (payload.role === undefined || row.role === payload.role)
      && (payload.parent === undefined || row.parent._tag === "agent" && row.parent.agentId === payload.parent)),
  } }))),
  "client.thread": (input, payload) => agentRead({ caller: input.actor, agentId: payload.agentId as string, after: payload.after as number, limit: payload.limit as number }, input.runtime.lists).pipe(
    Effect.map((page) => {
      const reply = { requestId: payload.requestId, ...page };
      return { reply: input.actor._tag === "agent" ? agentReadReply(payload.requestId, reply) : reply };
    }),
  ),
  "client.event": (input, payload) => Effect.gen(function* () {
    const view = yield* input.runtime.views.snapshot;
    const sql = input.runtime.sql;
    const rows = yield* SqliteClient.readOnly(sql<EventRow>`SELECT sequence, event_id, caller, caller_rule, request_id, agent_id, occurred_at, payload_json FROM events WHERE sequence = ${payload.sequence as number}`);
    if (rows.length === 0) return yield* refused();
    const value = yield* decodeRowWith(rows[0]!, input.runtime.lists?.envelope);
    if (!visibleTo(input.actor, value, view, input.runtime.lists)) return yield* refused();
    const reply = { requestId: payload.requestId, envelope: value };
    return { reply: input.actor._tag === "agent" ? agentReadReply(payload.requestId, reply) : reply };
  }).pipe(Effect.mapError((error) => error._tag === "SqlError" ? new LogReadFailed({ reason: "database read failed" }) : error)),
  "client.sequence": (input, payload) => input.actor._tag === "agent" ? Effect.fail(refused()) : input.runtime.views.snapshot.pipe(Effect.map((view) => ({ reply: { requestId: payload.requestId, sequence: view.sequence } }))),
  "client.subscribe": filtered,
} satisfies Record<string, ReadHandler>;
