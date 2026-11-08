import { randomUUID } from "node:crypto";
import type { AgentId, Delivery, EpochMilliseconds, Event, EventSequence, RequestId } from "@lgcode/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { canRead } from "../board/access.ts";
import { boardView, isUnread } from "../board/wake.ts";
import type { EngineLists } from "../pieces/lists.ts";
import type { RolesView } from "../roles/view.ts";
import { cacheAction } from "../roles/sheepdog/rules/cache.ts";
import { resolveSettings, roleSettings } from "../roles/sheepdog/settings.ts";
import { actionRequestId } from "../roles/sheepdog/requests.ts";
import { withWaitChecks } from "../routing/waits.ts";
import { callerKey } from "../log/EventLog.ts";
import { checkPieceBatch } from "./pieceBatch.ts";
import { refused, type Runtime, type Snapshot } from "./internal.ts";

export interface CacheTarget {
  readonly agentId: string;
  readonly sequence: number;
  readonly session: string;
  readonly expiry: number;
  readonly contextTokens: number;
}
export const sessionOf = (snapshot: Snapshot, agentId: string): string | undefined => {
  const session = snapshot.agents[agentId]?.session;
  return session?._tag === "acp" ? session.sessionId : undefined;
};
export const lastEnd = (snapshot: Snapshot, agentId: string) => snapshot.threads[agentId]?.findLast((row) => row.event._tag === "TurnEnded");
export const cacheActionFor = (snapshot: Snapshot, target: CacheTarget, now: number, lists: EngineLists, deliveryId?: string) => {
  const agent = snapshot.agents[target.agentId];
  const roles = snapshot.roles as RolesView;
  if (agent === undefined || roles.settings.sheepdog === false) return;
  const limits = resolveSettings(roles.settings, roleSettings(roles.file, agent.role));
  const reader = { _tag: "agent", agentId: target.agentId as AgentId } as const;
  return cacheAction({ expiry: target.expiry, now, armed: true, contextTokens: target.contextTokens,
    floor: limits.compactionTokens === "off" ? 150_000 : limits.compactionTokens ?? 150_000,
    compaction: limits.compactionTokens === "off" ? "off" : "on", flushLeadMinutes: limits.flushLeadMinutes,
    unreadPosts: lists.boardEnabled === false ? 0 : Object.values(boardView(snapshot).posts)
      .filter((post) => canRead(snapshot, reader, post.channelId) && isUnread(snapshot, reader, post)).length,
    boardOn: lists.boardEnabled !== false, idle: agent.state._tag === "idle", capacityHold: agent.capacityHeld === true,
    compacting: agent.compacting === true,
    queued: Object.values(snapshot.deliveries).some((row) => row.target === target.agentId && row.id !== deliveryId && row.status === "queued"),
    sent: Object.values(snapshot.deliveries).some((row) => row.target === target.agentId && row.status === "sent"),
    openRequest: Object.values(snapshot.requests).some((row) => row.agentId === target.agentId && row.status === "open"),
    openQuestion: Object.values(snapshot.questions).some((row) => row.agentId === target.agentId && row.status === "open"),
    blockingWait: Object.values(snapshot.waits).some((row) => row.agentId === target.agentId && row.status === "open" && row.blocking),
    newerTurn: lastEnd(snapshot, target.agentId)?.sequence !== target.sequence
      || sessionOf(snapshot, target.agentId) !== target.session
      || (roles.agents[target.agentId]?.turnStartSequence ?? 0) > target.sequence,
  });
};

// Called only through the sheepdog's internal service entry point. Eligibility,
// unread state, planning, and acceptance all share the writer transaction.
export const acceptCache = (runtime: Runtime, lists: EngineLists, target: CacheTarget) => runtime.log.transact((append) => Effect.gen(function* () {
  const snapshot = yield* runtime.views.snapshot;
  const action = cacheActionFor(snapshot, target, yield* Clock.currentTimeMillis, lists);
  if (action === undefined) return;
  const caller = { _tag: "service", service: "roles.sheepdog" } as const;
  const requestId = actionRequestId({ rule: "cache", subject: target.agentId, triggerSequence: target.sequence,
    kind: "accept", recipient: target.agentId, occurrence: 1 }) as RequestId;
  const receipts = yield* runtime.sql<{ request_id: string }>`SELECT request_id FROM receipts WHERE caller = ${callerKey(caller)} AND request_id = ${requestId}`;
  if (receipts.length !== 0) return;
  const command = action === "flush" ? "board.flush" : "compact";
  if (!lists.services[caller.service]?.includes(command) || !lists.access[command]?.includes("service")) return yield* refused();
  const plan = yield* lists.planners[command]!({ runtime, snapshot, actor: caller }, { requestId, agentId: target.agentId });
  const events = action === "flush" ? yield* checkPieceBatch("board", snapshot, plan, caller, lists)
    : withWaitChecks(snapshot, plan.events, lists);
  const sources = new Set(plan.deliveries?.filter((request) => request.target === target.agentId).map((request) => request.sourceId));
  const marked: ReadonlyArray<Event> = events.map((event) => {
    if (event._tag !== "DeliveryQueued" || event.delivery.target !== target.agentId) return event;
    const source = event.delivery.source;
    const automatic = action === "compact" ? event.delivery.content._tag === "compact"
      : source?._tag === "piece" && source.namespace === "board" && sources.has(source.id);
    if (!automatic) return event;
    return { ...event, delivery: { ...event.delivery, cache: { ...target, agentId: target.agentId as AgentId,
      sequence: target.sequence as EventSequence, expiry: target.expiry as EpochMilliseconds, action } } };
  });
  if (!marked.some((event) => event._tag === "DeliveryQueued" && event.delivery.cache !== undefined)) return;
  yield* append(caller, requestId, randomUUID(), marked, plan.sideRows ?? {});
  return action;
})).pipe(
  Effect.catchTag("SqlError", () => Effect.fail(refused("cache acceptance failed"))),
  Effect.catchTag("RequestIdReused", () => Effect.fail(refused("request id reused"))),
);

// Only automatic deliveries carry this evidence. Owner compact/flush keeps its
// ordinary queue semantics. A delayed automatic decision is withdrawn when its
// predicate, expected turn/session, action, or real cache lifetime is obsolete.
export const cacheDeliveryCurrent = (snapshot: Snapshot, delivery: Delivery, now: number, lists: EngineLists): boolean =>
  delivery.cache === undefined || cacheActionFor(snapshot, delivery.cache, now, lists, delivery.id) === delivery.cache.action;
