import { randomUUID } from "node:crypto";
import type { Event, EventEnvelope } from "@shepherd/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";

import { freshRequest, type Snapshot } from "../commands/internal.ts";
import { EventLog } from "../log/EventLog.ts";
import { freshDelivery } from "../routing/holders.ts";
import { withWaitChecks } from "../routing/waits.ts";
import { Views } from "../views/Views.ts";

type Cause = Extract<Event, { _tag: "AccountAvailable" }>["cause"];
const owner = { _tag: "owner" } as const;

const CARRY_ON = "The pause has ended. Carry on with what you were doing.";

// Rows 28, 29 and 53. What "account available" does to the agents paused on
// the account. The usage timer's cause ("usage reset") clears only usage
// pauses; the owner's ("owner cleared") clears sign-outs as well. A cleared
// agent goes idle. One that was mid-turn is queued a carry-on at the head of
// its queue. One whose delivery had not been accepted already has it queued
// again at the head (promptReply), so it is sent again under its own id, and
// no carry-on is added. An idle agent was paused with nothing to resume.
//
// The plan reads the state it is given and writes only for an agent that is
// still paused, so a second "account available" for the same pause, from the
// owner and the timer meeting, finds nothing to do. An account that has since
// become unusable again returns nothing either: a late event must not clear a
// newer sign-out.
export const returnAgents = (snapshot: Snapshot, accountId: string, cause: Cause): ReadonlyArray<Event> => {
  if (snapshot.accounts[accountId]?.status !== "available") return [];
  return Object.values(snapshot.agents).flatMap((agent): ReadonlyArray<Event> => {
    const state = agent.state;
    if (agent.account !== accountId || state._tag !== "paused" || (cause === "usage reset" && state.reason !== "limit")) return [];
    const { agentId } = agent;
    const id = freshDelivery();
    return [
      { _tag: "StateChanged", agentId, state: { _tag: "idle" } },
      ...(state.midTurn ? [{ _tag: "DeliveryQueued" as const, delivery: {
        id, target: agentId, sender: owner, content: { _tag: "carry-on" as const, text: CARRY_ON },
      } }] : []),
    ];
  });
};

// Applies one logged "account available" in a writer transaction of its own.
export const returnOne = (accountId: string, cause: Cause) => Effect.gen(function* () {
  const log = yield* EventLog;
  const views = yield* Views;
  yield* log.transact((append) => Effect.gen(function* () {
    const snapshot = yield* views.snapshot;
    const events = returnAgents(snapshot, accountId, cause);
    if (events.length > 0) yield* append(owner, freshRequest(), randomUUID(), withWaitChecks(snapshot, events), {});
  })).pipe(Effect.catchTag("RequestIdReused", () => Effect.void));
});

// Follows the log for the life of the service's scope. It subscribes before
// it forks, so no "account available" committed after the call is missed.
// One failed return is logged without content and does not stop it.
export const followAvailability = Effect.gen(function* () {
  const log = yield* EventLog;
  const committed = yield* log.subscribeCommitted;
  const availability = (envelope: EventEnvelope) =>
    envelope.event._tag === "AccountAvailable" ? [envelope.event] : [];
  return yield* Effect.forever(Effect.gen(function* () {
    for (const event of (yield* PubSub.takeAll(committed)).flatMap(availability)) {
      yield* returnOne(event.accountId, event.cause).pipe(Effect.catchCause((cause) => Cause.hasInterrupts(cause)
        ? Effect.failCause(cause)
        : Effect.logWarning("account return failed")));
    }
  })).pipe(Effect.forkScoped);
});
