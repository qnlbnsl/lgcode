// Failure rule 6: a message is for an agent that cannot take it. A message for
// a busy agent stays queued, in order, and is delivered when the agent can
// take it; it is never dropped. A message for a crashed agent goes back to its
// sender with the reason. Criteria 8.3 to 8.5.
//
// A message for a paused agent is checked in failure-5-account.test.ts, where
// the pause is real (a sign-out and a usage limit), and one for an interrupted
// agent in failure-2-restart.test.ts, where the interruption is a killed
// service.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  alive, eventsUntil, isTag, peekEcho, promptsOf, refusal, requestId, scenario, since, stopAllServices, tagged, waitFor,
} from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

const deliveryOf = (envelope: { event: unknown }): string => (envelope.event as { deliveryId: string }).deliveryId;

scenario("6 undeliverable: messages for a busy agent wait behind its turn, are not sent early, and arrive in the order they were sent with none dropped (breaks if a message interrupts the turn, is dropped, or the queue is delivered in another order)", (w) => Effect.gen(function* () {
  const gate = join(w.root.root, "gate-busy");
  const agent = yield* w.start(w.owner, {
    name: "Busy", permission: "ask", prompt: "Long job.",
    script: { turns: [[{ step: "plan", entries: [] }, { step: "wait_for_file", path: gate }], [], [], []] },
  });
  yield* eventsUntil(w.owner, 0, "the long job to be taken", isTag("DeliveryAccepted", agent.agentId));
  const mark = yield* w.watermark();
  const ids: string[] = [];
  for (const text of ["Second.", "Third.", "Fourth."]) {
    const reply = (yield* w.owner.prompt({ requestId: requestId(), agentId: agent.agentId, text } as never)) as { deliveryId: string };
    ids.push(reply.deliveryId);
  }

  // While the first turn is open, nothing else is sent to the agent.
  const waiting = yield* since(w.owner, mark);
  expect(tagged(waiting, "DeliveryQueued"), "a message was not queued").toHaveLength(3);
  expect(tagged(waiting, "DeliverySent"), "a message was sent into a turn that was still running").toHaveLength(0);
  expect(promptsOf(peekEcho(agent.echo)!)).toHaveLength(1);

  writeFileSync(gate, "go");
  const events = yield* eventsUntil(w.owner, mark, "the last message to be taken", (envelope) =>
    envelope.event._tag === "DeliveryAccepted" && envelope.agentId === agent.agentId && deliveryOf(envelope) === ids[2]);
  expect(tagged(events, "DeliverySent", agent.agentId).map(deliveryOf), "the queue was delivered out of order or dropped a message").toEqual(ids);
  expect(promptsOf(peekEcho(agent.echo)!)).toEqual(["Long job.", "Second.", "Third.", "Fourth."]);
}));

scenario("6 undeliverable: messages still queued for an agent that then crashes go back to their sender as not delivered, the sender is told, the message being worked on is not returned, and a later message is refused (breaks if a crash drops queued messages silently, returns the one already taken, or leaves the sender unaware)", (w) => Effect.gen(function* () {
  const boss = yield* w.start(w.owner, { name: "Boss", role: "lead", permission: "edit", prompt: "Start." });
  yield* eventsUntil(w.owner, 0, "the boss's first turn", isTag("TurnEnded", boss.agentId));
  const bossClient = yield* w.asAgent((yield* w.token(boss)).token);
  const gate = join(w.root.root, "gate-crash-queue");
  const child = yield* w.start(bossClient, {
    name: "Doomed", permission: "ask", prompt: "Work.",
    script: { turns: [[{ step: "plan", entries: [] }, { step: "wait_for_file", path: gate }, { step: "crash", exitCode: 5 }]] },
  });
  const taken = yield* eventsUntil(w.owner, 0, "the work to be taken", isTag("DeliveryAccepted", child.agentId));
  const firstId = deliveryOf(tagged(taken, "DeliverySent", child.agentId)[0]!);
  const { pid } = yield* w.token(child);
  const mark = yield* w.watermark();

  const queued: string[] = [];
  for (const text of ["Queued one.", "Queued two."]) {
    const reply = (yield* bossClient.prompt({ requestId: requestId(), agentId: child.agentId, text } as never)) as { deliveryId: string };
    queued.push(reply.deliveryId);
  }
  writeFileSync(gate, "go");
  yield* eventsUntil(w.owner, mark, "the crash", isTag("AgentCrashed", child.agentId), 30_000);
  yield* waitFor("the crashed process to be gone", () => (alive(pid) ? undefined : true));
  // The boss gets one notice per returned message, each its own delivery, so the first
  // accepted delivery does not mean the second notice has arrived. Wait for the boss's
  // adapter to hold a notice for every queued id before reading what it was told.
  const noticesFor = (): ReadonlyArray<string> => promptsOf(peekEcho(boss.echo)!).filter((text) => text.includes("was returned"));
  const told = yield* waitFor("the boss's adapter to receive a 'was returned' notice for each queued message", () => {
    const notices = noticesFor();
    return queued.every((id) => notices.some((text) => text.includes(id))) ? notices : undefined;
  });
  const settled = yield* since(w.owner, mark);

  const returned = tagged(settled, "DeliveryReturned", child.agentId);
  expect(returned.map(deliveryOf).sort(), "queued messages were not all returned to their sender").toEqual([...queued].sort());
  for (const envelope of returned) {
    expect(envelope.event).toMatchObject({ sender: { _tag: "agent", agentId: boss.agentId }, reason: "not delivered" });
  }
  expect(tagged(settled, "DeliveryReturned").map(deliveryOf), "the message already being worked on was returned").not.toContain(firstId);
  expect(tagged(settled, "DeliveryWithdrawn", child.agentId).map(deliveryOf).sort()).toEqual([...queued].sort());
  // The boss is told, once per message, which delivery came back.
  for (const id of queued) {
    expect(told.some((text) => text.includes(id)), `the boss was not told that ${id} came back`).toBe(true);
    expect(told.filter((text) => text.includes(id)), `the boss was not told exactly once that ${id} came back`).toHaveLength(1);
  }

  // A message for the crashed agent is refused at once, not queued for nobody.
  const after = yield* w.watermark();
  expect(yield* refusal(bossClient.prompt({ requestId: requestId(), agentId: child.agentId, text: "Too late." } as never)), "a message for a crashed agent was accepted").toBeDefined();
  expect(tagged(yield* since(w.owner, after), "DeliveryQueued").filter((envelope) =>
    (envelope.event as unknown as { delivery: { target: string } }).delivery.target === child.agentId)).toHaveLength(0);
}));
