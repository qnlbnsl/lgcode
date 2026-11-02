// Failure rule 5: an account is signed out or out of usage. The runner tells
// the two apart from the adapter's error; a signed-out account needs sign-in
// and the owner is told; an agent out of usage is paused with the reset time;
// new agents asking for any account skip that account until it is usable
// again. Criteria 8.3 to 8.5.
//
// The error text is classified by the harness's name, so these scenarios name
// the fake adapter "claude": the engine then reads "Authentication required"
// as a sign-out and "You've hit your ..." as a usage limit, as it does for the
// real adapter. The fake agent is still the only process that runs.
import { afterEach, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  eventsUntil, isTag, requestId, scenario, since, stopAllServices, tagged, type World,
} from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

// Another agent on an account that already exists (a second `accounts add` of
// the same id is refused).
const alsoOn = (w: World, accountId: string, name: string) => w.owner.start({
  requestId: requestId(), name, role: "worker", harness: "claude", account: { _tag: "named", accountId },
  permission: "ask", folder: w.root.work, runMode: "acp", groups: [], prompt: "Go.",
} as never) as Effect.Effect<{ agentId: string }, unknown>;

const startAny = (w: World, name: string) => w.owner.start({
  requestId: requestId(), name, role: "worker", harness: "claude", account: { _tag: "any" },
  permission: "ask", folder: w.root.work, runMode: "acp", groups: [],
} as never) as Effect.Effect<{ agentId: string }, unknown>;

const accountOf = (events: ReadonlyArray<{ agentId?: string; event: { _tag: string } }>, agentId: string): string =>
  (tagged(events as never, "AgentStarted", agentId)[0]!.event as unknown as { account: string }).account;

// Two agents on the busy account (so the account under test holds the fewest
// agents and "any" would choose it if it were usable), then the one that
// fails on its second turn.
const setup = (w: World, accountId: string, failing: Record<string, unknown>) => Effect.gen(function* () {
  const crowd = yield* w.start(w.owner, { name: "Crowd 1", accountId: "acct-busy", harness: "claude", prompt: "Go." });
  const crowd2 = yield* alsoOn(w, "acct-busy", "Crowd 2");
  const sick = yield* w.start(w.owner, {
    name: "Sick", accountId, harness: "claude", prompt: "Go.",
    script: { turns: [[], [failing]] },
  });
  yield* eventsUntil(w.owner, 0, "the first turns", isTag("TurnEnded", sick.agentId));
  yield* eventsUntil(w.owner, 0, "the first turns", isTag("TurnEnded", crowd.agentId));
  yield* eventsUntil(w.owner, 0, "the first turns", isTag("TurnEnded", crowd2.agentId));
  return { crowd, crowd2, sick };
});

scenario("5 account: a sign-out marks the account as needing sign-in, tells the owner, pauses the agents on it, keeps the message queued, and new any-account agents skip the account until the owner marks it usable (breaks if a sign-out is read as a crash or a usage limit, the owner is not told, the account is still picked, or the queued message is lost)", (w) => Effect.gen(function* () {
  const { crowd, sick } = yield* setup(w, "acct-out", { step: "signed_out", message: "Authentication required: please sign in" });
  const mark = yield* w.watermark();
  const sent = yield* w.owner.prompt({ requestId: requestId(), agentId: sick.agentId, text: "Keep going." } as never) as unknown as Effect.Effect<{ deliveryId: string }>;
  const events = yield* eventsUntil(w.owner, mark, "the agent to pause", (envelope) =>
    envelope.event._tag === "StateChanged" && envelope.agentId === sick.agentId && (envelope.event as unknown as { state: { _tag: string } }).state._tag === "paused");

  expect(tagged(events, "AccountNeedsSignIn"), "the sign-out was not recorded once").toHaveLength(1);
  expect(tagged(events, "AccountNeedsSignIn")[0]!.event).toMatchObject({ accountId: "acct-out" });
  expect(tagged(events, "AccountOutOfUsage"), "a sign-out was read as a usage limit").toHaveLength(0);
  expect(tagged(events, "AgentCrashed"), "a sign-out was read as a crash").toHaveLength(0);
  const paused = tagged(events, "StateChanged", sick.agentId).at(-1)!.event as unknown as { state: unknown };
  expect(paused.state).toMatchObject({ _tag: "paused", reason: "signed-out" });
  // The owner is told, on the agent that hit it.
  expect(tagged(yield* since(w.owner, mark), "OwnerNeeded", sick.agentId).some((envelope) => (envelope.event as unknown as { reason: string }).reason === "account needs sign-in"),
    "the owner was not told the account needs sign-in").toBe(true);
  // The message is put back in the queue, not dropped.
  const requeued = tagged(events, "DeliveryRequeued", sick.agentId);
  expect(requeued.map((envelope) => (envelope.event as unknown as { deliveryId: string }).deliveryId)).toContain(sent.deliveryId);
  // An agent on another account is not paused.
  expect(tagged(yield* since(w.owner, mark), "StateChanged", crowd.agentId).filter((envelope) =>
    (envelope.event as unknown as { state: { _tag: string } }).state._tag === "paused"), "an agent on another account was paused").toHaveLength(0);

  // New agents asking for any account skip it, although it holds the fewest agents.
  const skipper = yield* startAny(w, "Skips the signed-out account");
  const placed = yield* eventsUntil(w.owner, mark, "the new agent to be placed", (envelope) => envelope.event._tag === "AgentStarted" && envelope.agentId === skipper.agentId);
  expect(accountOf(placed, skipper.agentId)).toBe("acct-busy");

  // The owner marks it usable: the account is picked again and the queued message is delivered.
  const clearMark = yield* w.watermark();
  yield* w.owner["accounts mark-available"]({ requestId: requestId(), accountId: "acct-out" } as never);
  const cleared = yield* eventsUntil(w.owner, clearMark, "the queued message to be taken", isTag("DeliveryAccepted", sick.agentId));
  expect(tagged(cleared, "AccountAvailable")[0]!.event).toMatchObject({ accountId: "acct-out" });
  const sentAgain = tagged(cleared, "DeliverySent", sick.agentId).map((envelope) => (envelope.event as unknown as { deliveryId: string }).deliveryId);
  expect(sentAgain, "the queued message was not delivered after the account was cleared").toContain(sent.deliveryId);
  const back = yield* startAny(w, "Uses the cleared account");
  const backEvents = yield* eventsUntil(w.owner, clearMark, "the new agent to be placed", (envelope) => envelope.event._tag === "AgentStarted" && envelope.agentId === back.agentId);
  expect(accountOf(backEvents, back.agentId)).toBe("acct-out");
}));

scenario("5 account: a usage limit pauses the agent with the reset time the adapter gave, is not read as a sign-out, queues later messages in order, and new any-account agents skip the account (breaks if the reset time is lost or changed, a limit is read as a sign-out, messages sent while paused are dropped or delivered out of order, or the account is still picked)", (w) => Effect.gen(function* () {
  const resetsAt = new Date(Date.now() + 3_600_000).toISOString();
  const { sick } = yield* setup(w, "acct-limit", { step: "out_of_usage", message: "You've hit your usage limit", resetsAt });
  const mark = yield* w.watermark();
  const first = yield* w.owner.prompt({ requestId: requestId(), agentId: sick.agentId, text: "Before the limit." } as never) as unknown as Effect.Effect<{ deliveryId: string }>;
  const events = yield* eventsUntil(w.owner, mark, "the agent to pause", (envelope) =>
    envelope.event._tag === "StateChanged" && envelope.agentId === sick.agentId && (envelope.event as unknown as { state: { _tag: string } }).state._tag === "paused");

  const limit = tagged(events, "AccountOutOfUsage");
  expect(limit, "the limit was not recorded once").toHaveLength(1);
  expect(limit[0]!.event).toMatchObject({ accountId: "acct-limit", resetAt: Date.parse(resetsAt) });
  expect(tagged(events, "AccountNeedsSignIn"), "a usage limit was read as a sign-out").toHaveLength(0);
  const state = (tagged(events, "StateChanged", sick.agentId).at(-1)!.event as unknown as { state: unknown }).state;
  expect(state).toMatchObject({ _tag: "paused", reason: "limit", resetAt: Date.parse(resetsAt) });

  // A message sent while paused is accepted and kept behind the first.
  const second = yield* w.owner.prompt({ requestId: requestId(), agentId: sick.agentId, text: "While paused." } as never) as unknown as Effect.Effect<{ deliveryId: string }>;
  const sentWhilePaused = tagged(yield* since(w.owner, mark), "DeliverySent", sick.agentId);
  expect(sentWhilePaused.filter((envelope) => (envelope.event as unknown as { deliveryId: string }).deliveryId === second.deliveryId),
    "a message was sent to a paused agent").toHaveLength(0);

  const skipper = yield* startAny(w, "Skips the limited account");
  const placed = yield* eventsUntil(w.owner, mark, "the new agent to be placed", (envelope) => envelope.event._tag === "AgentStarted" && envelope.agentId === skipper.agentId);
  expect(accountOf(placed, skipper.agentId)).toBe("acct-busy");

  const clearMark = yield* w.watermark();
  yield* w.owner["accounts mark-available"]({ requestId: requestId(), accountId: "acct-limit" } as never);
  const after = yield* eventsUntil(w.owner, clearMark, "both messages to be taken", (envelope) =>
    envelope.event._tag === "DeliveryAccepted" && envelope.agentId === sick.agentId
    && (envelope.event as unknown as { deliveryId: string }).deliveryId === second.deliveryId);
  const order = tagged(after, "DeliverySent", sick.agentId).map((envelope) => (envelope.event as unknown as { deliveryId: string }).deliveryId);
  expect(order, "the messages were delivered out of order or one was dropped").toEqual([first.deliveryId, second.deliveryId]);
  expect(tagged(after, "AccountAvailable")[0]!.event).toMatchObject({ accountId: "acct-limit", cause: "owner cleared" });

  const back = yield* startAny(w, "Uses the cleared account");
  const backEvents = yield* eventsUntil(w.owner, clearMark, "the new agent to be placed", (envelope) => envelope.event._tag === "AgentStarted" && envelope.agentId === back.agentId);
  expect(accountOf(backEvents, back.agentId)).toBe("acct-limit");
}));
