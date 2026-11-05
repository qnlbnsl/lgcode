import { cacheDeliveryCurrent } from "../commands/cache.ts";
import * as Clock from "effect/Clock";
import { carryOnText } from "../accounts/available.ts";
import { engineLists, type EngineLists } from "../pieces/lists.ts";
import { guardPiece } from "../pieces/guardPiece.ts";
import { canReach } from "./reach.ts";
import { randomUUID } from "node:crypto";
import { AccountId, RunMode, type AgentId, type Delivery, type Event, type EventEnvelope } from "@shephrd/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { freshRequest, type Snapshot } from "../commands/internal.ts";
import { EventLog, LogWriteFailed } from "../log/EventLog.ts";
import { Restart } from "../recovery/service.ts";
import { Runner, type RunnerEvent } from "../runner/Runner.ts";
import { Views } from "../views/Views.ts";
import { envelope } from "./envelope.ts";
import { freshDelivery, moveHeld, passAtTurnEnd } from "./holders.ts";
import { withLane } from "./lanes.ts";
import { project, withWaitChecks } from "./waits.ts";

type Row = Snapshot["deliveries"][string];
const owner = { _tag: "owner" } as const;
const decodeRunMode = Schema.decodeUnknownSync(RunMode);
const decodeAccountId = Schema.decodeUnknownSync(AccountId);
const pending = (row: Row) => row.status === "queued" || row.status === "sent";

export type CapacityHoldCondition = (agentId: AgentId, snapshot: Snapshot) => unknown;

// The log is the source of the per-agent, per-outage retry count. Releases,
// carry-ons and recovery keep it; a completed turn or another error ends it.
export const capacityHoldCount = (snapshot: Snapshot, agentId: AgentId): number => {
  let count = 0;
  let turn: string | undefined;
  for (const { event } of snapshot.threads[agentId] ?? []) {
    switch (event._tag) {
      case "DeliverySent": turn = event.deliveryId; break;
      case "DeliveryHeld": count++; turn = undefined; break;
      case "DeliveryReturned":
        if (event.cause === "capacity" || turn === event.deliveryId) count = 0;
        break;
      case "TurnEnded":
      case "AgentStopped":
      case "AgentCrashed": count = 0; turn = undefined; break;
      case "AgentInterrupted": turn = undefined; break;
      case "StateChanged":
        if (event.state._tag === "paused" && turn !== undefined) count = 0;
        if (event.state._tag !== "working") turn = undefined;
        break;
    }
  }
  return count;
};

const asDelivery = ({ status: _status, method: _method, reason: _reason, ...delivery }: Row): Delivery => delivery;

// Rows 29, 51 and 53: a requeued delivery and a carry-on go first, then the
// queue in the order it was written.
const nextQueued = (snapshot: Snapshot, agentId: string): Row | undefined => {
  const order = new Map<string, number>();
  for (const row of snapshot.threads[agentId] ?? []) {
    if (row.event._tag === "DeliveryQueued") order.set(row.event.delivery.id, row.sequence);
    else if (row.event._tag === "AgentStarted" && row.event.firstPromptDelivery !== undefined) {
      order.set(row.event.firstPromptDelivery.id, row.sequence);
    }
  }
  const rank = (row: Row) => [row.reason === undefined && row.content._tag !== "carry-on" ? 1 : 0, order.get(row.id) ?? Number.MAX_SAFE_INTEGER] as const;
  return Object.values(snapshot.deliveries).filter((row) => row.target === agentId && row.status === "queued")
    .sort((a, b) => rank(a)[0] - rank(b)[0] || rank(a)[1] - rank(b)[1])[0];
};

// Rows 29, 68 and 69: a returned delivery tells an agent sender, in a
// delivery of its own. The owner reads the return from the log.
const returnTo = (snapshot: Snapshot, row: Row, reason: string, cause?: "capacity"): ReadonlyArray<Event> => {
  const returned: Event = { _tag: "DeliveryReturned", agentId: row.target, deliveryId: row.id, sender: row.sender, reason, ...(cause === undefined ? {} : { cause }) };
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
export const targetGone = (snapshot: Snapshot, agentId: AgentId, cause: "stopped" | "crashed", lists: EngineLists = engineLists): ReadonlyArray<Event> =>
  Object.values(snapshot.deliveries).filter((row) => row.target === agentId && pending(row)).flatMap((row): ReadonlyArray<Event> => {
    if (row.source?._tag === "piece") {
      const namespace = row.source.namespace;
      return guardPiece("sourceRules", namespace, () => lists.sourceRules[namespace](), "withdraw") === "return"
        ? returnTo(snapshot, row, "not delivered")
        : [{ _tag: "DeliveryWithdrawn", agentId, deliveryId: row.id, reason: cause === "stopped" ? "agent stopped" : "agent crashed" }];
    }
    return [
      { _tag: "DeliveryWithdrawn", agentId, deliveryId: row.id, reason: cause === "stopped" ? "agent stopped" : "agent crashed" },
      ...(movedOrWake(snapshot, row) ? [] : returnTo(snapshot, row, "not delivered")),
    ];
  });

// The delivery that started the agent's current turn: the last one sent
// since the previous turn end. None while the agent is not working.
const currentSend = (snapshot: Snapshot, agentId: string) => {
  if (snapshot.agents[agentId]?.state._tag !== "working") return undefined;
  const thread = snapshot.threads[agentId] ?? [];
  const sent = thread.slice(thread.findLastIndex((row) => row.event._tag === "TurnEnded") + 1)
    .findLast((row): row is EventEnvelope & { readonly event: Extract<Event, { _tag: "DeliverySent" }> } => row.event._tag === "DeliverySent");
  return sent;
};
const currentTurn = (snapshot: Snapshot, agentId: string): string | undefined => currentSend(snapshot, agentId)?.event.deliveryId;

// Fix round 1, F4: a turn end ends the current turn only, so a repeated old
// one writes nothing. Row 67: whether the turn was a compact turn follows
// from the delivery that started it.
export const turnEnded = (snapshot: Snapshot, event: Extract<RunnerEvent, { _tag: "turnEnded" }>): ReadonlyArray<Event> => {
  const { agentId, deliveryId } = event;
  const sent = currentSend(snapshot, agentId);
  if (sent?.event.deliveryId !== deliveryId || sent.sequence !== event.sentSequence) return [];
  const compact = snapshot.deliveries[deliveryId]?.content._tag === "compact";
  return [{ _tag: "TurnEnded", agentId, compact,
    ...(event.usage === undefined ? {} : { usage: event.usage }),
  }, ...passAtTurnEnd(snapshot, agentId)];
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
  event.replay || event.kind === "available_commands_update" ? [] : [
    ...accepted(snapshot, event.agentId, event.deliveryId),
    ...(event.content === undefined ? [] : [{ _tag: "ThreadItem" as const, agentId: event.agentId, itemId: event.itemId ?? randomUUID(),
      content: event.content, replay: false }]),
  ];

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
const failed = (snapshot: Snapshot, agentId: AgentId, deliveryId: string, reason: string, cause?: "capacity"): ReadonlyArray<Event> => {
  const row = turnDelivery(snapshot, agentId, deliveryId);
  if (row === undefined) return [];
  return [...returnTo(snapshot, row, reason, cause), { _tag: "StateChanged", agentId, state: { _tag: "idle" } }];
};

// What pausing one agent on a paused account writes: a delivery it had sent
// but not yet accepted goes back to the head of its queue (row 29); an
// accepted one stays accepted, and the agent is paused mid-turn so that it
// gets a carry-on on return (row 53). An idle agent is paused with nothing
// to carry on. The pause keeps its reason and, for a usage limit, the reset
// time the provider gave.
const pauseAgent = (
  snapshot: Snapshot, agentId: AgentId, reason: "limit" | "signed-out", resetAt: number | undefined,
): ReadonlyArray<Event> => {
  const state = snapshot.agents[agentId]?.state;
  if (state === undefined) return [];
  const turn = state._tag === "working" ? snapshot.deliveries[currentTurn(snapshot, agentId) ?? ""] : undefined;
  const unaccepted = turn?.status === "sent";
  const midTurn = state._tag === "paused" ? state.midTurn : state._tag === "working" && !unaccepted;
  const requeue: ReadonlyArray<Event> = unaccepted
    ? [{ _tag: "DeliveryRequeued", agentId, deliveryId: turn.id, reason: "agent paused" }] : [];
  return [...requeue, { _tag: "StateChanged", agentId, state: {
    _tag: "paused", reason, midTurn,
    ...(reason === "limit" && resetAt !== undefined ? { resetAt } : {}),
  } }];
};

// Rows 28, 51, 53 and 68. A classified pause is about the account, not about
// one agent. The account is marked unusable, and every agent on it pauses
// (an agent already paused for a limit is moved to a sign-out, which only
// the owner clears). The reporting agent's own delivery decides whether it is
// mid-turn. A sign-out, and a usage limit with no known reset time, tell the
// owner, since no timer will bring the account back. The provider's own
// error text is never written (decision row 40).
export const promptReply = (
  snapshot: Snapshot, event: Extract<RunnerEvent, { _tag: "promptReply" }>, redactText: (text: string) => Effect.Effect<string>,
  capacityHoldCondition?: CapacityHoldCondition,
): Effect.Effect<ReadonlyArray<Event>> => Effect.gen(function* () {
  const { agentId, deliveryId, outcome } = event;
  switch (outcome._tag) {
    case "success": return accepted(snapshot, agentId, deliveryId);
    case "error": return failed(snapshot, agentId, deliveryId, yield* redactText(outcome.error));
    case "capacity": {
      const row = turnDelivery(snapshot, agentId, deliveryId);
      if (row === undefined) return [];
      let hold = false;
      let invalid = false;
      try {
        const result = capacityHoldCondition === undefined ? false : capacityHoldCondition(agentId, snapshot);
        hold = result === true;
        invalid = typeof result !== "boolean";
      } catch {
        invalid = true;
      }
      if (invalid) yield* Effect.logWarning("capacity hold condition failed");
      if (!hold) return failed(snapshot, agentId, deliveryId, yield* redactText(outcome.error), "capacity");
      const id = freshDelivery();
      return [
        ...(row.status === "sent" ? [{ _tag: "DeliveryRequeued" as const, agentId, deliveryId, reason: "model at capacity" }]
          : [{ _tag: "DeliveryQueued" as const, delivery: {
            id, target: agentId, sender: owner,
            content: { _tag: "carry-on" as const, text: carryOnText(id, "Capacity is available again. Carry on with what you were doing.") },
          } }]),
        { _tag: "DeliveryHeld", agentId, deliveryId, reason: "capacity" },
      ];
    }
    case "pause": {
      const row = turnDelivery(snapshot, agentId, deliveryId);
      if (row === undefined) return [];
      const accountId = decodeAccountId(snapshot.agents[agentId]!.account);
      const account = snapshot.accounts[accountId];
      // A sign-out outranks a usage limit: once signed out, only the owner
      // brings the account back.
      const reason = outcome.reason === "signed-out" || account?.status === "needs-sign-in" ? "signed-out" : "limit";
      const resetAt = outcome.resetAt;
      const marked: ReadonlyArray<Event> = account === undefined ? []
        : reason === "signed-out" ? [{ _tag: "AccountNeedsSignIn", accountId, reason: "account needs sign-in" }]
        : [{ _tag: "AccountOutOfUsage", accountId, ...(resetAt === undefined ? {} : { resetAt }) }];
      // Only a sign-out is account-wide. A usage limit pauses the agent that
      // met it; its siblings meet the limit on their own turns.
      const onAccount = reason !== "signed-out" ? [] : Object.values(snapshot.agents).filter((agent) => agent.account === accountId && agent.agentId !== agentId
        && (agent.state._tag === "working" || agent.state._tag === "idle" || agent.state._tag === "starting"
          || (agent.state._tag === "paused" && agent.state.reason === "limit")));
      const paused: ReadonlyArray<Event> = [
        ...marked,
        ...pauseAgent(snapshot, agentId, reason, resetAt),
        ...onAccount.flatMap((agent) => pauseAgent(snapshot, agent.agentId, reason, resetAt)),
        ...(reason === "signed-out" || resetAt === undefined ? [{
          _tag: "OwnerNeeded" as const, agentId,
          reason: reason === "signed-out" ? "account needs sign-in" : "account is out of usage, no reset time known",
        }] : []),
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
//
// Recovery step 10 and row 66 (`recovered`): an agent that a reload left
// working, with a re-sent delivery or a carry-on at the head of its queue,
// sends that head once. It counts as sent once any delivery was sent after
// the reload's "working". `laneHeld` is for a caller that already holds the
// agent's lane, such as `resume`.
export const dispatchQueued = (agentId: AgentId, options: { readonly recovered?: boolean; readonly laneHeld?: boolean; readonly lists?: EngineLists } = {}) => Effect.gen(function* () {
  const log = yield* EventLog;
  const views = yield* Views;
  const runner = yield* Runner;
  const sql = yield* SqlClient.SqlClient;
  const lists = options.lists ?? log.lists ?? engineLists;
  const reloaded = (snapshot: Snapshot) => {
    const thread = snapshot.threads[agentId] ?? [];
    const since = thread.findLastIndex((row) => row.event._tag === "StateChanged" && row.event.state._tag === "working");
    return since >= 0 && !thread.slice(since + 1).some((row) => row.event._tag === "DeliverySent")
      && !Object.values(snapshot.deliveries).some((row) => row.target === agentId && row.status === "sent");
  };
  // Fix round 1, A2: an agent on a signed-out account gets nothing; its
  // queue waits for the owner's "account available".
  const ready = (snapshot: Snapshot) => {
    const agent = snapshot.agents[agentId];
    const state = agent?.state._tag;
    return agent !== undefined && !agent.capacityHeld && snapshot.accounts[agent.account]?.status !== "needs-sign-in"
      && (state === "idle" || (options.recovered === true && state === "working" && reloaded(snapshot)))
      ? nextQueued(snapshot, agentId) : undefined;
  };
  if (ready(yield* views.snapshot) === undefined) return;
  yield* (options.laneHeld === true ? <A, E, R>(effect: Effect.Effect<A, E, R>) => effect : withLane(log, agentId))(Effect.gen(function* () {
    const reserved = yield* log.transact((append) => Effect.gen(function* () {
      let snapshot = yield* views.snapshot;
      let row = ready(snapshot);
      while (row !== undefined) {
        const cacheCurrent = cacheDeliveryCurrent(snapshot, row, yield* Clock.currentTimeMillis, lists);
        if (cacheCurrent && row.source?._tag !== "piece") break;
        const queued = snapshot.threads[agentId]?.find((envelope) => envelope.event._tag === "DeliveryQueued" && envelope.event.delivery.id === row!.id);
        const caller = queued?.caller;
        if (cacheCurrent && row.source?._tag === "piece" && canReach({ ...(caller === undefined || caller._tag === "piece" ? {} : { caller }), target: agentId, deliveryId: row.id, source: row.source, snapshot }, lists)) break;
        const events = withWaitChecks(snapshot, [{ _tag: "DeliveryWithdrawn", agentId, deliveryId: row.id, reason: cacheCurrent ? "delivery no longer reachable" : "automatic cache action obsolete" }], lists);
        yield* append(owner, freshRequest(), randomUUID(), events, {});
        snapshot = project(snapshot, events, lists);
        row = ready(snapshot);
      }
      if (row === undefined) return undefined;
      const tokens = yield* sql<{ token_hash: string }>`
        SELECT token_hash FROM agent_tokens WHERE agent_id = ${agentId} AND revoked_at IS NULL
        ORDER BY rowid DESC LIMIT 1`;
      const incarnation = tokens[0]?.token_hash;
      if (incarnation === undefined) return undefined;
      // The target can read sent text through its own thread. A queued
      // delivery has no top-level agent identity and stays owner-only.
      const sent = yield* append(owner, freshRequest(), randomUUID(), [
        { _tag: "DeliverySent", agentId, deliveryId: row.id, method: decodeRunMode(snapshot.agents[agentId]!.runMode) },
        ...(row.content._tag === "compact" ? [] : [{
          _tag: "PromptSent" as const, agentId, deliveryId: row.id, sender: row.sender, text: row.content.text,
        }]),
      ], {});
      return { incarnation, delivery: asDelivery(row), sentSequence: sent[0]!.sequence };
    }));
    if (reserved === undefined) return;
    const send = { agentId, ...reserved };
    yield* (reserved.delivery.content._tag === "compact" ? runner.compact(send) : runner.prompt(send)).pipe(
      Effect.catchTag("RunnerRejected", () => log.transact((append) => Effect.gen(function* () {
        const snapshot = yield* views.snapshot;
        const events = failed(snapshot, agentId, reserved.delivery.id, "delivery failed");
        if (events.length > 0) yield* append(owner, freshRequest(), randomUUID(), withWaitChecks(snapshot, events, lists), {});
      }))),
    );
  }));
}).pipe(Effect.catchTag("SqlError", () => Effect.fail(new LogWriteFailed({ reason: "database read failed" }))));

// The events after which an agent may have something to send: a new queue
// entry, an opened session, a turn end, or a returned or requeued delivery.
// A state change to idle is one too: an account that came back (unit 6b)
// leaves its agents idle with their requeued deliveries waiting.
const readyAfter = (envelope: EventEnvelope): ReadonlyArray<AgentId> => {
  const event = envelope.event;
  switch (event._tag) {
    case "DeliveryQueued": return [event.delivery.target];
    case "SessionOpened":
    case "TurnEnded":
    case "DeliveryReturned":
    case "DeliveryRequeued":
    case "DeliveryReleased": return [event.agentId];
    case "StateChanged": return event.state._tag === "idle" ? [event.agentId] : [];
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
//
// Issue 88: while restart recovery runs (its layer is present), the follower
// collects commits but sends nothing until recovery's step 9 has finished;
// step 10 then sends what was queued before.
export const dispatchCommitted = Effect.gen(function* () {
  const log = yield* EventLog;
  const recovery = yield* Effect.serviceOption(Restart);
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
    if (Option.isSome(recovery)) yield* recovery.value.whenReady;
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
