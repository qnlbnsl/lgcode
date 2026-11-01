import { randomUUID } from "node:crypto";
import { RunMode, type AgentId, type Delivery, type Event, type EventEnvelope } from "@shepherd/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { freshRequest, type Snapshot } from "../commands/internal.ts";
import { EventLog, LogWriteFailed } from "../log/EventLog.ts";
import { Runner, type RunnerEvent } from "../runner/Runner.ts";
import { Views } from "../views/Views.ts";
import { envelope } from "./envelope.ts";
import { freshDelivery, moveHeld, passAtTurnEnd } from "./holders.ts";
import { withLane } from "./lanes.ts";
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

// Fix round 1, F5. A wake is only withdrawn (row 50). A routed permission
// request or question whose subject is still open has already moved with
// `moveHeld`. Every other delivery, such as an answer to a closed question,
// is returned to its sender.
const movedOrWake = (snapshot: Snapshot, row: Row): boolean => {
  switch (row.source?._tag) {
    case "wait": return true;
    case "permission": return snapshot.requests[row.source.id]?.status === "open";
    case "question": return snapshot.questions[row.source.id]?.status === "open";
    default: return false;
  }
};

// Row 69 and criterion 5.9: what a stopped or crashed target had not taken
// is withdrawn, and returned to its sender as not delivered unless it was a
// wake or has moved. Give it the state after the batch's own moves.
export const targetGone = (snapshot: Snapshot, agentId: AgentId, cause: "stopped" | "crashed"): ReadonlyArray<Event> =>
  Object.values(snapshot.deliveries).filter((row) => row.target === agentId && pending(row)).flatMap((row): ReadonlyArray<Event> => [
    { _tag: "DeliveryWithdrawn", agentId, deliveryId: row.id, reason: cause === "stopped" ? "agent stopped" : "agent crashed" },
    ...(movedOrWake(snapshot, row) ? [] : returnTo(snapshot, row, "not delivered")),
  ]);

// The delivery that started the agent's current turn: the last one sent
// since the previous turn end. None while the agent is not working.
const currentTurn = (snapshot: Snapshot, agentId: string): string | undefined => {
  if (snapshot.agents[agentId]?.state._tag !== "working") return undefined;
  const thread = snapshot.threads[agentId] ?? [];
  const sent = thread.slice(thread.findLastIndex((row) => row.event._tag === "TurnEnded") + 1)
    .findLast((row): row is EventEnvelope & { readonly event: Extract<Event, { _tag: "DeliverySent" }> } => row.event._tag === "DeliverySent");
  return sent?.event.deliveryId;
};

// Fix round 1, F4: a turn end ends the current turn only, so a repeated old
// one writes nothing. Row 67: whether the turn was a compact turn follows
// from the delivery that started it.
export const turnEnded = (snapshot: Snapshot, event: Extract<RunnerEvent, { _tag: "turnEnded" }>): ReadonlyArray<Event> => {
  const { agentId, deliveryId } = event;
  if (currentTurn(snapshot, agentId) !== deliveryId) return [];
  const compact = snapshot.deliveries[deliveryId]?.content._tag === "compact";
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

// Fix round 1, F2: a failure or a pause applies to the delivery that started
// the current turn, sent or already accepted by a content update. A second
// terminal reply, or one for an earlier delivery, finds no such delivery.
const turnDelivery = (snapshot: Snapshot, agentId: AgentId, deliveryId: string): Row | undefined => {
  const row = snapshot.deliveries[deliveryId];
  return currentTurn(snapshot, agentId) === deliveryId && row?.target === agentId
    && (row.status === "sent" || row.status === "accepted") ? row : undefined;
};

// Row 68: an unclassified failure returns the delivery to its sender, and the
// agent goes idle. An accepted delivery is not put back in the queue. The
// reason is already redacted.
const failed = (snapshot: Snapshot, agentId: AgentId, deliveryId: string, reason: string): ReadonlyArray<Event> => {
  const row = turnDelivery(snapshot, agentId, deliveryId);
  if (row === undefined) return [];
  return [...returnTo(snapshot, row, reason), { _tag: "StateChanged", agentId, state: { _tag: "idle" } }];
};

// Rows 51 and 68. A classified pause pauses the agent, which then holds
// nothing (holders.ts). A delivery the agent had not yet accepted goes back
// to the head of its queue. An accepted one stays accepted, and the agent is
// paused mid-turn; carrying on is unit 6b's.
export const promptReply = (
  snapshot: Snapshot, event: Extract<RunnerEvent, { _tag: "promptReply" }>, redactText: (text: string) => Effect.Effect<string>,
): Effect.Effect<ReadonlyArray<Event>> => Effect.gen(function* () {
  const { agentId, deliveryId, outcome } = event;
  switch (outcome._tag) {
    case "success": return accepted(snapshot, agentId, deliveryId);
    case "error": return failed(snapshot, agentId, deliveryId, yield* redactText(outcome.error));
    case "pause": {
      const row = turnDelivery(snapshot, agentId, deliveryId);
      if (row === undefined) return [];
      const midTurn = row.status === "accepted";
      const paused: ReadonlyArray<Event> = [
        ...(midTurn ? [] : [{ _tag: "DeliveryRequeued" as const, agentId, deliveryId, reason: "agent paused" }]),
        { _tag: "StateChanged", agentId, state: {
          _tag: "paused", reason: outcome.reason === "out-of-usage" ? "limit" : "signed-out", midTurn,
        } },
      ];
      return [...paused, ...moveHeld(project(snapshot, paused))];
    }
  }
});

// Sends the head of an idle agent's queue, once: "delivery sent" commits
// first, and only then does the runner get the prompt (row 29). A busy,
// paused, starting, crashed or stopped agent gets nothing. A runner refusal
// returns the delivery like an error reply.
//
// Fix round 1, F3: the agent's lane is held from the reservation through the
// runner call (lanes.ts), and the send names the incarnation it was reserved
// for, the hash of the agent's live token, read in the same transaction.
export const dispatchQueued = (agentId: AgentId) => Effect.gen(function* () {
  const log = yield* EventLog;
  const views = yield* Views;
  const runner = yield* Runner;
  const sql = yield* SqlClient.SqlClient;
  const ready = (snapshot: Snapshot) => snapshot.agents[agentId]?.state._tag === "idle" ? nextQueued(snapshot, agentId) : undefined;
  if (ready(yield* views.snapshot) === undefined) return;
  yield* withLane(log, agentId)(Effect.gen(function* () {
    const reserved = yield* log.transact((append) => Effect.gen(function* () {
      const snapshot = yield* views.snapshot;
      const row = ready(snapshot);
      if (row === undefined) return undefined;
      const tokens = yield* sql<{ token_hash: string }>`
        SELECT token_hash FROM agent_tokens WHERE agent_id = ${agentId} AND revoked_at IS NULL
        ORDER BY rowid DESC LIMIT 1`;
      const incarnation = tokens[0]?.token_hash;
      if (incarnation === undefined) return undefined;
      yield* append(owner, freshRequest(), randomUUID(), [{
        _tag: "DeliverySent", agentId, deliveryId: row.id, method: decodeRunMode(snapshot.agents[agentId]!.runMode),
      }], {});
      return { incarnation, delivery: asDelivery(row) };
    }));
    if (reserved === undefined) return;
    const send = { agentId, ...reserved };
    yield* (reserved.delivery.content._tag === "compact" ? runner.compact(send) : runner.prompt(send)).pipe(
      Effect.catchTag("RunnerRejected", () => log.transact((append) => Effect.gen(function* () {
        const snapshot = yield* views.snapshot;
        const events = failed(snapshot, agentId, reserved.delivery.id, "delivery failed");
        if (events.length > 0) yield* append(owner, freshRequest(), randomUUID(), withWaitChecks(snapshot, events), {});
      }))),
    );
  }));
}).pipe(Effect.catchTag("SqlError", () => Effect.fail(new LogWriteFailed({ reason: "database read failed" }))));

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
// before it forks, so nothing committed after the call is missed.
//
// Fix round 1, F6: each agent's dispatch runs in a fiber of its own, so a
// slow send to one agent never delays another. At most one runs per agent; a
// commit that arrives meanwhile makes it go round once more. The fibers are
// children of the follower and end with it. One failed send is logged
// without content and does not stop it.
export const dispatchCommitted = Effect.gen(function* () {
  const log = yield* EventLog;
  const committed = yield* log.subscribeCommitted;
  const running = new Map<string, { again: boolean }>();
  // The check and the removal happen in one step, so a request that arrives
  // as the fiber finishes is never lost.
  const drain = (agentId: AgentId, entry: { again: boolean }) => Effect.gen(function* () {
    for (;;) {
      entry.again = false;
      yield* dispatchQueued(agentId).pipe(Effect.catchCause((cause) => Cause.hasInterrupts(cause)
        ? Effect.failCause(cause)
        : Effect.logWarning("delivery dispatch failed")));
      if (!entry.again) {
        running.delete(agentId);
        return;
      }
    }
  }).pipe(Effect.onInterrupt(() => Effect.sync(() => {
    if (running.get(agentId) === entry) running.delete(agentId);
  })));
  return yield* Effect.forever(Effect.gen(function* () {
    const batch = yield* PubSub.takeAll(committed);
    for (const agentId of new Set(batch.flatMap(readyAfter))) {
      const entry = running.get(agentId);
      if (entry !== undefined) {
        entry.again = true;
        continue;
      }
      const fresh = { again: false };
      running.set(agentId, fresh);
      yield* Effect.forkChild(drain(agentId, fresh));
    }
  })).pipe(Effect.forkScoped);
});
