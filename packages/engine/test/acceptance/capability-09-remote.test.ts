// Capability 9: talk to any agent remotely. The owner can read and prompt any
// agent's thread from any device. Here a "device" is a second connection with
// the owner credential; device pairing belongs to the client API, a later
// layer. Criteria 8.3 to 8.5.
import { afterEach, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { eventsUntil, isTag, peekEcho, promptsOf, requestId, scenario, stopAllServices, tagged, threadText } from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

scenario("9 remote: the owner, from a second connection, prompts an agent two levels down and reads the answer live (breaks if the owner may only reach direct children, or a second connection sees a different thread)", (w) => Effect.gen(function* () {
  const top = yield* w.start(w.owner, { name: "Top", role: "lead", permission: "full", prompt: "Start." });
  yield* eventsUntil(w.owner, 0, "top's turn", isTag("TurnEnded", top.agentId));
  const topClient = yield* w.asAgent((yield* w.token(top)).token);
  const mid = yield* w.start(topClient, { name: "Mid", role: "lead", permission: "edit", prompt: "Start." });
  yield* eventsUntil(w.owner, 0, "mid's turn", isTag("TurnEnded", mid.agentId));
  const midClient = yield* w.asAgent((yield* w.token(mid)).token);
  const leaf = yield* w.start(midClient, {
    name: "Leaf", permission: "ask", prompt: "Start.",
    script: { turns: [[], [{ step: "text", text: "pong from the leaf" }]] },
  });
  yield* eventsUntil(w.owner, 0, "leaf's turn", isTag("TurnEnded", leaf.agentId));

  const phone = yield* w.reopenOwner();
  const mark = yield* w.watermark();
  const reader = yield* Effect.forkChild(eventsUntil(phone, mark, "the leaf's reply", isTag("TurnEnded", leaf.agentId)));
  const sent = yield* w.owner.prompt({ requestId: requestId(), agentId: leaf.agentId, text: "ping from the owner" } as never) as unknown as Effect.Effect<{ deliveryId: string }>;
  const seen = yield* Fiber.join(reader);
  expect(tagged(seen, "DeliveryQueued")[0]!.event).toMatchObject({ delivery: { id: sent.deliveryId, target: leaf.agentId, sender: { _tag: "owner" } } });
  expect(threadText(seen, leaf.agentId)).toBe("pong from the leaf");
  expect(promptsOf(peekEcho(leaf.echo)!).at(-1)).toBe("ping from the owner");
}));

scenario("9 remote: an agent sees only its own and its children's threads, while the owner sees every agent's (breaks if an agent can read an unrelated agent's thread)", (w) => Effect.gen(function* () {
  const secretive = yield* w.start(w.owner, {
    name: "Secretive", permission: "ask", prompt: "Go.",
    script: { turns: [[{ step: "text", text: "private words of the secretive agent" }]] },
  });
  yield* eventsUntil(w.owner, 0, "the secretive agent's turn", isTag("TurnEnded", secretive.agentId));
  const other = yield* w.start(w.owner, { name: "Other", permission: "ask", prompt: "Go." });
  const otherClient = yield* w.asAgent((yield* w.token(other)).token);
  const visible = yield* eventsUntil(otherClient, 0, "the other agent's own turn", isTag("TurnEnded", other.agentId));
  expect(visible.some((envelope) => envelope.agentId === other.agentId)).toBe(true);
  expect(visible.filter((envelope) => envelope.agentId === secretive.agentId), "an unrelated agent read the secretive agent's events").toHaveLength(0);
  expect(JSON.stringify(visible)).not.toContain("private words of the secretive agent");

  const all = yield* eventsUntil(w.owner, 0, "the owner reading both", isTag("TurnEnded", other.agentId));
  expect(threadText(all, secretive.agentId)).toBe("private words of the secretive agent");
}));
