// Capability 3: send an agent a prompt, and the agent knows who sent it.
// Criteria 8.3 to 8.5. The delivery's sender is recorded in the log; the text
// the agent receives is the owner's own words, or an envelope that names the
// delivery and marks the text as data from another agent.
import { afterEach, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { eventsUntil, isTag, peekEcho, promptsOf, refusal, requestId, scenario, stopAllServices, tagged } from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

type Queued = { delivery: { id: string; target: string; sender: { _tag: string; agentId?: string }; content: { _tag: string; text?: string } } };

scenario("3 prompt: an owner prompt and a parent agent's prompt both reach the agent, each with its sender recorded (breaks if the sender is lost or the owner's words are wrapped)", (w) => Effect.gen(function* () {
  const boss = yield* w.start(w.owner, { name: "Boss", role: "lead", permission: "edit", prompt: "Start." });
  yield* eventsUntil(w.owner, 0, "the boss's first turn", isTag("TurnEnded", boss.agentId));
  const bossClient = yield* w.asAgent((yield* w.token(boss)).token);
  const child = yield* w.start(bossClient, { name: "Worker Bee", role: "worker", permission: "edit", prompt: "First." });
  yield* eventsUntil(w.owner, 0, "the child's first turn", isTag("TurnEnded", child.agentId));

  // From an agent.
  const fromAgent = yield* w.watermark();
  const agentReply = yield* bossClient.prompt({ requestId: requestId(), agentId: child.agentId, text: "Please do X." } as never) as unknown as Effect.Effect<{ deliveryId: string }>;
  const agentEvents = yield* eventsUntil(w.owner, fromAgent, "the agent prompt to be accepted", isTag("DeliveryAccepted", child.agentId));
  const queued = tagged(agentEvents, "DeliveryQueued")[0]!.event as unknown as Queued;
  expect(queued.delivery).toMatchObject({ id: agentReply.deliveryId, target: child.agentId, sender: { _tag: "agent", agentId: boss.agentId } });
  expect(tagged(agentEvents, "DeliveryAccepted")[0]!.event).toMatchObject({ deliveryId: agentReply.deliveryId });

  // From the owner.
  const fromOwner = yield* w.watermark();
  const ownerReply = yield* w.owner.prompt({ requestId: requestId(), agentId: child.agentId, text: "Owner says Y." } as never) as unknown as Effect.Effect<{ deliveryId: string }>;
  const ownerEvents = yield* eventsUntil(w.owner, fromOwner, "the owner prompt to be accepted", isTag("DeliveryAccepted", child.agentId));
  const ownerQueued = tagged(ownerEvents, "DeliveryQueued")[0]!.event as unknown as Queued;
  expect(ownerQueued.delivery).toMatchObject({ id: ownerReply.deliveryId, sender: { _tag: "owner" }, content: { text: "Owner says Y." } });

  // What the harness received: the envelope for the agent's text, the owner's words as written.
  const received = promptsOf(peekEcho(child.echo)!);
  expect(received).toHaveLength(3);
  expect(received[1]).toMatch(/^Data from another agent \[[\w-]+\] \(delivery /);
  expect(received[1]).toContain(`(delivery ${agentReply.deliveryId})`);
  expect(received[1]).toContain("Please do X.");
  expect(received[2]).toBe("Owner says Y.");
}));

scenario("3 prompt: an agent that is not the target's parent cannot prompt it (breaks if any agent can prompt any other agent)", (w) => Effect.gen(function* () {
  const a = yield* w.start(w.owner, { name: "Sibling A", permission: "edit", prompt: "Go." });
  const b = yield* w.start(w.owner, { name: "Sibling B", permission: "edit", prompt: "Go." });
  yield* eventsUntil(w.owner, 0, "both turns", (e) => e.event._tag === "TurnEnded" && e.agentId === b.agentId);
  const aClient = yield* w.asAgent((yield* w.token(a)).token);
  const before = yield* w.watermark();
  expect(yield* refusal(aClient.prompt({ requestId: requestId(), agentId: b.agentId, text: "Sneaky." } as never))).toBeDefined();
  const after = yield* w.watermark();
  const events = after > before ? yield* eventsUntil(w.owner, before, "the refusal", (e) => e.sequence >= after) : [];
  expect(tagged(events, "DeliveryQueued")).toHaveLength(0);
  expect(promptsOf(peekEcho(b.echo)!).join("\n")).not.toContain("Sneaky.");
}));
