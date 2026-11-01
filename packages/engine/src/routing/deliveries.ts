import { randomUUID } from "node:crypto";
import { RunMode, type AgentId, type Delivery, type Event, type EventEnvelope } from "@shepherd/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";

import { freshRequest, type Snapshot } from "../commands/internal.ts";
import { EventLog } from "../log/EventLog.ts";
import { Runner, type RunnerEvent } from "../runner/Runner.ts";
import { Views } from "../views/Views.ts";
import { envelope } from "./envelope.ts";
import { freshDelivery, moveHeld, passAtTurnEnd } from "./holders.ts";
import { project, withWaitChecks } from "./waits.ts";

type Row = Snapshot["deliveries"][string];
const owner = { _tag: "owner" } as const;
const decodeRunMode = Schema.decodeUnknownSync(RunMode);
const pending = (row: Row) => row.status === "queued" || row.status === "sent";

const asDelivery = ({ status: _status, method: _method, reason: _reason, ...delivery }: Row): Delivery => delivery;

// Rows 29 and 51: a requeued delivery goes first, then the queue in the
// order it was written.
const nextQueued = (snapshot: Snapshot, agentId: string): Row | undefined => {
  const order = new Map<string, number>();
  for (const row of snapshot.threads[agentId] ?? []) {
    if (row.event._tag === "DeliveryQueued") order.set(row.event.delivery.id, row.sequence);
    else if (row.event._tag === "AgentStarted" && row.event.firstPromptDelivery !== undefined) {
      order.set(row.event.firstPromptDelivery.id, row.sequence);
    }
  }
  const rank = (row: Row) => [row.reason === undefined ? 1 : 0, order.get(row.id) ?? Number.MAX_SAFE_INTEGER] as const;
  return Object.values(snapshot.deliveries).filter((row) => row.target === agentId && row.status === "queued")
    .sort((a, b) => rank(a)[0] - rank(b)[0] || rank(a)[1] - rank(b)[1])[0];
};

// Rows 29, 68 and 69: a returned delivery tells an agent sender, in a
// delivery of its own. The owner reads the return from the log.
const returnTo = (snapshot: Snapshot, row: Row, reason: string): ReadonlyArray<Event> => {
  const returned: Event = { _tag: "DeliveryReturned", agentId: row.target, deliveryId: row.id, sender: row.sender, reason };
  if (row.sender._tag !== "agent") return [returned];
  const sender = snapshot.agents[row.sender.agentId]?.state._tag;
  if (sender === undefined || sender === "crashed" || sender === "stopped") return [returned];
  const id = freshDelivery();
  return [returned, { _tag: "DeliveryQueued", delivery: {
    id, target: row.sender.agentId, sender: owner,
    content: { _tag: "prompt", text: envelope(id, `Delivery ${row.id} to agent ${row.target} was returned: ${reason}`) },
  } }];
};

// Row 69 and criterion 5.9: what a stopped or crashed target had not taken
// is withdrawn. A plain delivery is returned to its sender as not delivered.
// A wake is only withdrawn (row 50), and a routed request has already moved.
// Give it the state after the batch's own moves.
export const targetGone = (snapshot: Snapshot, agentId: AgentId, cause: "stopped" | "crashed"): ReadonlyArray<Event> =>
  Object.values(snapshot.deliveries).filter((row) => row.target === agentId && pending(row)).flatMap((row): ReadonlyArray<Event> => [
    { _tag: "DeliveryWithdrawn", agentId, deliveryId: row.id, reason: cause === "stopped" ? "agent stopped" : "agent crashed" },
    ...(row.source === undefined ? returnTo(snapshot, row, "not delivered") : []),
  ]);

// Row 67: whether a turn was a compact turn follows from the delivery that
// started it, the last one sent since the previous turn end.
export const turnEnded = (snapshot: Snapshot, agentId: AgentId): ReadonlyArray<Event> => {
  const thread = snapshot.threads[agentId] ?? [];
  const sent = thread.slice(thread.findLastIndex((row) => row.event._tag === "TurnEnded") + 1)
    .findLast((row): row is EventEnvelope & { readonly event: Extract<Event, { _tag: "DeliverySent" }> } => row.event._tag === "DeliverySent");
  const compact = sent !== undefined && snapshot.deliveries[sent.event.deliveryId]?.content._tag === "compact";
  return [{ _tag: "TurnEnded", agentId, compact }, ...passAtTurnEnd(snapshot, agentId)];
};

const sentTo = (snapshot: Snapshot, agentId: string, deliveryId: string): Row | undefined => {
  const row = snapshot.deliveries[deliveryId];
  return row?.target === agentId && row.status === "sent" ? row : undefined;
};

const accepted = (snapshot: Snapshot, agentId: AgentId, deliveryId: string): ReadonlyArray<Event> => {
  const row = sentTo(snapshot, agentId, deliveryId);
  return row === undefined ? [] : [{ _tag: "DeliveryAccepted", agentId, deliveryId: row.id }];
};

// Row 51: only a content update after the send accepts. The command
// catalogue and replayed history never do; replay writes nothing here.
export const deliveryUpdate = (snapshot: Snapshot, event: Extract<RunnerEvent, { _tag: "deliveryUpdate" }>): ReadonlyArray<Event> =>
  event.replay || event.kind === "available_commands_update" ? [] : accepted(snapshot, event.agentId, event.deliveryId);

// Row 68: an unclassified failure returns the delivery and the agent stays
// idle. The reason is already redacted.
const failed = (snapshot: Snapshot, agentId: AgentId, deliveryId: string, reason: string): ReadonlyArray<Event> => {
  const row = sentTo(snapshot, agentId, deliveryId);
  if (row === undefined) return [];
  return [...returnTo(snapshot, row, reason),
    ...(snapshot.agents[agentId]?.state._tag === "working" ? [{ _tag: "StateChanged" as const, agentId, state: { _tag: "idle" as const } }] : [])];
};

// Rows 51 and 68. A classified pause puts the delivery back at the head and
// pauses the agent, which then holds nothing (holders.ts).
export const promptReply = (
  snapshot: Snapshot, event: Extract<RunnerEvent, { _tag: "promptReply" }>, redactText: (text: string) => Effect.Effect<string>,
): Effect.Effect<ReadonlyArray<Event>> => Effect.gen(function* () {
  const { agentId, deliveryId, outcome } = event;
  switch (outcome._tag) {
    case "success": return accepted(snapshot, agentId, deliveryId);
    case "error": return failed(snapshot, agentId, deliveryId, yield* redactText(outcome.error));
    case "pause": {
      if (sentTo(snapshot, agentId, deliveryId) === undefined) return [];
      const paused: ReadonlyArray<Event> = [
        { _tag: "DeliveryRequeued", agentId, deliveryId, reason: "agent paused" },
        ...(snapshot.agents[agentId]?.state._tag === "paused" ? [] : [{ _tag: "StateChanged" as const, agentId, state: {
          _tag: "paused" as const, reason: outcome.reason === "out-of-usage" ? "limit" as const : "signed-out" as const, midTurn: false,
        } }]),
      ];
      return [...paused, ...moveHeld(project(snapshot, paused))];
    }
  }
});

// Sends the head of an idle agent's queue, once: "delivery sent" commits
// first, and only then does the runner get the prompt (row 29). A busy,
// paused, starting, crashed or stopped agent gets nothing. A runner refusal
// returns the delivery like an error reply.
export const dispatchQueued = (agentId: AgentId) => Effect.gen(function* () {
  const log = yield* EventLog;
  const views = yield* Views;
  const runner = yield* Runner;
  const ready = (snapshot: Snapshot) => snapshot.agents[agentId]?.state._tag === "idle" ? nextQueued(snapshot, agentId) : undefined;
  if (ready(yield* views.snapshot) === undefined) return;
  const sent = yield* log.transact((append) => Effect.gen(function* () {
    const snapshot = yield* views.snapshot;
    const row = ready(snapshot);
    if (row === undefined) return undefined;
    yield* append(owner, freshRequest(), randomUUID(), [{
      _tag: "DeliverySent", agentId, deliveryId: row.id, method: decodeRunMode(snapshot.agents[agentId]!.runMode),
    }], {});
    return asDelivery(row);
  }));
  if (sent === undefined) return;
  yield* (sent.content._tag === "compact" ? runner.compact({ agentId, delivery: sent }) : runner.prompt({ agentId, delivery: sent })).pipe(
    Effect.catchTag("RunnerRejected", () => log.transact((append) => Effect.gen(function* () {
      const snapshot = yield* views.snapshot;
      const events = failed(snapshot, agentId, sent.id, "delivery failed");
      if (events.length > 0) yield* append(owner, freshRequest(), randomUUID(), withWaitChecks(snapshot, events), {});
    }))),
  );
});

// The events after which an agent may have something to send: a new queue
// entry, an opened session, a turn end, or a returned or requeued delivery.
// A state change is not one: whoever writes it (a reload, unit 6b) drains.
const readyAfter = (envelope: EventEnvelope): ReadonlyArray<AgentId> => {
  const event = envelope.event;
  switch (event._tag) {
    case "DeliveryQueued": return [event.delivery.target];
    case "SessionOpened":
    case "TurnEnded":
    case "DeliveryReturned":
    case "DeliveryRequeued": return [event.agentId];
    default: return [];
  }
};

// Automatic dispatch for the life of the service's scope. It subscribes
// before it forks, so nothing committed after the call is missed. One failed
// send is logged without content and does not stop it.
export const dispatchCommitted = Effect.gen(function* () {
  const log = yield* EventLog;
  const committed = yield* log.subscribeCommitted;
  return yield* Effect.forever(Effect.gen(function* () {
    const batch = yield* PubSub.takeAll(committed);
    for (const agentId of new Set(batch.flatMap(readyAfter))) {
      yield* dispatchQueued(agentId).pipe(Effect.catchCause((cause) => Cause.hasInterrupts(cause)
        ? Effect.failCause(cause)
        : Effect.logWarning("delivery dispatch failed")));
    }
  })).pipe(Effect.forkScoped);
});
