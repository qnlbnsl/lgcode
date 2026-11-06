// Pattern: T3 Code apps/server/src/orchestration-v2/DelegatedCompletionDelivery.test.ts
// and its DelegatedCompletionDelivery.ts (MIT licence): a parent is woken once,
// from durable state, in the transaction that completes its child. The shape
// was reused, no code.
import { randomUUID } from "node:crypto";
import {
  WaitId, holds, reasonOf, waitSatisfied, pieceNamespaces,
  type AgentId, type Event, type EventEnvelope, type WaitMember,
} from "@sheprd/contracts";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";

import { freshRequest, refused, type Input, type Payload, type Plan, type Runtime, type Snapshot } from "../commands/internal.ts";
import { EventLog } from "../log/EventLog.ts";
import { applyWith } from "../views/apply.ts";
import { Views } from "../views/Views.ts";
import { envelope } from "./envelope.ts";
import { freshDelivery, holderAbove } from "./holders.ts";

import { engineLists, type EngineLists } from "../pieces/lists.ts";
import { guardPiece } from "../pieces/guardPiece.ts";

type Wait = Snapshot["waits"][string];

const decodeWaitId = Schema.decodeUnknownSync(WaitId);

// The state a batch leaves behind, before it is written. The envelopes are
// placeholders that only `apply` reads; nothing projected is ever stored.
export const project = (snapshot: Snapshot, events: ReadonlyArray<Event>, lists: EngineLists = engineLists): Snapshot =>
  events.reduce((state, event, index) => applyWith(state, {
    sequence: snapshot.sequence + index + 1, eventId: "projected", occurredAt: 0, caller: { _tag: "owner" }, event,
  } as unknown as EventEnvelope, lists.views), snapshot);

// Every engine notice is the engine's own data, wrapped like agent text.
const notice = (waiter: AgentId, waitId: WaitId, text: string): Event => {
  const id = freshDelivery();
  return { _tag: "DeliveryQueued", delivery: {
    id, target: waiter, sender: { _tag: "owner" }, source: { _tag: "wait", id: waitId },
    content: { _tag: "prompt", text: envelope(id, text) },
  } };
};

const listing = (members: ReadonlyArray<WaitMember>) => members.map((member) => `- agent ${member.agentId}: ${member.reason}`).join("\n");

const check = (state: Snapshot, wait: Wait, lists: EngineLists): ReadonlyArray<Event> => {
  const agentId = wait.agentId;
  const waitId = decodeWaitId(wait.waitId);
  const waiter = state.agents[agentId]?.state._tag;
  if (waiter === undefined) return [];
  if (waiter === "stopped") return [{ _tag: "WaitCancelled", agentId, waitId, reason: "agent stopped" }];
  // Issue 52 and row 67: an open non-blocking wait whose waiter crashed is
  // suspended. It neither resolves nor wakes until `resume`. A blocking wait
  // belongs to a connection the crash ended.
  if (waiter === "crashed") return wait.blocking ? [{ _tag: "WaitCancelled", agentId, waitId, reason: "agent crashed" }] : [];
  // Row 26: level-triggered, so a request already held returns at once.
  if (wait.blocking && (holds(state, agentId) || pieceNamespaces.some((ns) => guardPiece("requestHeld", ns, () => lists.requestHeld[ns](state, agentId, state[ns]), false)))) return [{ _tag: "WaitCancelled", agentId, waitId, reason: "request held" }];
  const recorded = new Map(wait.resolved.map((member) => [member.agentId as string, member.reason]));
  const current = wait.members.flatMap((member): ReadonlyArray<WaitMember> => {
    const held = pieceNamespaces.some((ns) => guardPiece("holdUnsettled", ns, () => lists.holdUnsettled[ns](state, member, state[ns]), true));
    const engineReason = reasonOf(state, member);
    const reason = held && engineReason === "settled" ? undefined : engineReason;
    return reason === undefined ? [] : [{ agentId: member, reason }];
  });
  const events: Array<Event> = current.filter((member) => recorded.get(member.agentId) !== member.reason)
    .map((member) => ({ _tag: "WaitMemberResolved", agentId, waitId, member }));
  // Row 67: a member that went back to working no longer counts.
  if (waitSatisfied(wait.mode, wait.members, current)) {
    events.push({ _tag: "WaitSatisfied", agentId, waitId, members: current });
    // Row 50: a blocking wait creates no delivery.
    if (!wait.blocking) events.push(notice(agentId, waitId, `Wait ${waitId} finished.\n${listing(current)}`));
  } else if (!wait.blocking) {
    for (const member of current) {
      if (member.reason === "crashed" && recorded.get(member.agentId) !== "crashed") {
        events.push(notice(agentId, waitId, `Wait ${waitId} is still open. A member crashed.\n${listing([member])}`));
      }
    }
  }
  return events;
};

// Rows 25 and 50: the batch plus every wait event it causes, for one append,
// so a resolution and its wake commit with the event that resolves them.
// A closed wait or a wake changes other agents' settled state, so the checks
// repeat on the projected state until nothing more follows.
export const withWaitChecks = (snapshot: Snapshot, events: ReadonlyArray<Event>, lists: EngineLists = engineLists): ReadonlyArray<Event> => {
  const all = [...events];
  let state = project(snapshot, events, lists);
  for (const id of new Set(events.filter((event) => event._tag === "DeliveryWithdrawn").map((event) => event.agentId))) {
    const thread = state.threads[id] ?? [];
    const since = thread.findLastIndex((row) => row.event._tag === "StateChanged" && row.event.state._tag === "working");
    if (state.agents[id]?.state._tag === "working" && since >= 0
      && !thread.slice(since + 1).some((row) => row.event._tag === "DeliverySent")
      && !Object.values(state.deliveries).some((row) => row.target === id && (row.status === "queued" || row.status === "sent"))) {
      const idle: Event = { _tag: "StateChanged", agentId: state.agents[id]!.agentId, state: { _tag: "idle" } };
      all.push(idle); state = project(state, [idle], lists);
    }
  }
  for (let round = 0; round <= Object.keys(state.waits).length; round++) {
    const more = Object.values(state.waits).filter((wait) => wait.status === "open").flatMap((wait) => check(state, wait, lists));
    if (more.length === 0) break;
    all.push(...more);
    state = project(state, more, lists);
  }
  return all;
};

// Recovery's re-check (row 25). It commits what a crashed process left
// unchecked and does nothing to a closed wait, so repeating it is harmless.
export const recheckWaits = () => Effect.gen(function* () {
  const log = yield* EventLog;
  const views = yield* Views;
  yield* log.transact((append) => Effect.gen(function* () {
    const events = withWaitChecks(yield* views.snapshot, [], log.lists);
    if (events.length > 0) yield* append({ _tag: "owner" }, freshRequest(), randomUUID(), events, {});
  }));
});

const outcomeOf = (status: Wait["status"], reason: string | undefined) =>
  status === "satisfied" ? "satisfied" as const
  : status === "open" ? "opened" as const
  : reason === "request held" ? "request-held" as const : "cancelled" as const;

// The `wait` reply, read from the batch that opened the wait.
export const waitReply = (events: ReadonlyArray<Event>): Record<string, unknown> => {
  const opened = events.find((event) => event._tag === "WaitOpened");
  if (opened === undefined) return {};
  const resolved = new Map<string, WaitMember>();
  let status: Wait["status"] = "open";
  let reason: string | undefined;
  for (const event of events) {
    if (!("waitId" in event) || event.waitId !== opened.waitId) continue;
    if (event._tag === "WaitMemberResolved") resolved.set(event.member.agentId, event.member);
    if (event._tag === "WaitSatisfied") { status = "satisfied"; resolved.clear(); for (const member of event.members) resolved.set(member.agentId, member); }
    if (event._tag === "WaitCancelled") { status = "cancelled"; reason = event.reason; }
  }
  return { waitId: opened.waitId, members: [...resolved.values()], outcome: outcomeOf(status, reason) };
};

// A blocking wait holds no writer permit while it waits (row 26). It reads
// the views after each commit, so a commit between its opening and its
// subscription is not missed. The connection closing interrupts it and
// commits "wait cancelled".
//
// Issue 77: CommandHandler runs the opening commit and this effect in one
// uninterruptible region, so the cancellation is registered before any
// interruption can arrive; only the waiting itself is interruptible.
const block = (runtime: Runtime, requestId: string, waitId: WaitId) => Effect.interruptible(Effect.scoped(Effect.gen(function* () {
  const committed = yield* runtime.log.subscribeCommitted;
  for (;;) {
    const row = (yield* runtime.views.snapshot).waits[waitId];
    if (row !== undefined && row.status !== "open") {
      return { requestId, waitId, members: row.resolved, outcome: outcomeOf(row.status, row.reason) } as Record<string, unknown>;
    }
    yield* PubSub.takeAll(committed);
  }
}))).pipe(Effect.onInterrupt(() => runtime.log.transact((append) => Effect.gen(function* () {
  const row = (yield* runtime.views.snapshot).waits[waitId];
  if (row?.status !== "open") return;
  yield* append({ _tag: "agent", agentId: row.agentId }, freshRequest(), randomUUID(), [{
    _tag: "WaitCancelled", agentId: row.agentId, waitId, reason: "connection closed",
  }], {});
})).pipe(Effect.catchCause(() => Effect.logWarning("blocking wait cancellation failed")))));

// Called only inside CommandHandler's writer transaction, which adds the
// checks that may satisfy the wait at once.
export const wait = ({ actor, snapshot, runtime }: Input, payload: Payload<"wait">): Effect.Effect<Plan, ReturnType<typeof refused>> => {
  // A blocking wait is for agents only, by decision row 26.
  if (actor._tag !== "agent") return Effect.fail(refused());
  const members = [...new Set(payload.members)];
  if (members.some((member) => member === actor.agentId || snapshot.agents[member] === undefined)) return Effect.fail(refused());
  // Fix round 1, F1 and row 27: waiting is a parent's right, held by the
  // nearest ancestor that can act. A list with any other member is refused
  // whole.
  if (members.some((member) => {
    const holder = holderAbove(snapshot, member);
    return holder._tag !== "agent" || holder.agentId !== actor.agentId;
  })) return Effect.fail(refused());
  const waitId = decodeWaitId(randomUUID());
  return Effect.succeed({
    events: [{ _tag: "WaitOpened", agentId: actor.agentId, waitId, members, mode: payload.mode, blocking: payload.block }],
    ...(payload.block ? { afterCommit: block(runtime, payload.requestId, waitId) } : {}),
  });
};
