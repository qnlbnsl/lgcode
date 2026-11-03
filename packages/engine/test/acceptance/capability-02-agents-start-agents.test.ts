// Capability 2: an agent can start another agent, but never with more
// permission than its own. Criteria 8.3 to 8.5.
import { afterEach, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { eventsUntil, isTag, refusal, scenario, stopAllServices, tagged } from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

scenario("2 agents start agents: an agent starts a child at or below its own permission, and the child's parent is that agent (breaks if the child is recorded under the owner or the start is refused)", (w) => Effect.gen(function* () {
  const parent = yield* w.start(w.owner, { name: "Parent", role: "lead", permission: "edit", prompt: "Wait for work." });
  const { token } = yield* w.token(parent);
  const agentClient = yield* w.asAgent(token);
  const before = yield* w.watermark();
  const child = yield* w.start(agentClient, { name: "Child", role: "worker", permission: "edit", groups: ["kids"], prompt: "Child task." });
  const events = yield* eventsUntil(w.owner, before, "the child's first turn", isTag("TurnEnded", child.agentId));
  const started = tagged(events, "AgentStarted", child.agentId);
  expect(started).toHaveLength(1);
  expect(started[0]!.event).toMatchObject({ parent: { _tag: "agent", agentId: parent.agentId }, permission: "edit", groups: ["kids"] });
  expect(started[0]!.caller).toMatchObject({ _tag: "agent", agentId: parent.agentId });
}));

scenario("2 agents start agents: a child with more permission than its parent is refused and nothing starts (breaks if the ceiling is not enforced for read-only, ask or edit parents)", (w) => Effect.gen(function* () {
  const readOnly = yield* w.start(w.owner, { name: "Cautious", permission: "read-only", prompt: "Stay put." });
  const ask = yield* w.start(w.owner, { name: "Asker", permission: "ask", prompt: "Stay put." });
  const edit = yield* w.start(w.owner, { name: "Editor", permission: "edit", prompt: "Stay put." });
  for (const [parent, over, within] of [
    [readOnly, "ask", "read-only"], [ask, "edit", "ask"], [edit, "full", "edit"],
  ] as const) {
    const { token } = yield* w.token(parent);
    const client = yield* w.asAgent(token);
    const before = yield* w.watermark();
    const refused = yield* refusal(w.start(client, { name: `Over ${over}`, permission: over }));
    expect(refused, `a child with ${over} under a parent below it was not refused`).toBeDefined();
    const after = yield* w.watermark();
    const events = after > before ? yield* eventsUntil(w.owner, before, "the refusal to settle", (e) => e.sequence >= after) : [];
    expect(tagged(events, "AgentStarted")).toHaveLength(0);
    const ok = yield* w.start(client, { name: `Within ${within}`, permission: within });
    expect(ok.agentId).toBeDefined();
  }
}));

scenario("2 agents start agents: a grandchild can be started and the owner still sees the whole tree through events (breaks if an agent's child cannot start further children)", (w) => Effect.gen(function* () {
  const top = yield* w.start(w.owner, { name: "Top", permission: "full", prompt: "Go." });
  const topClient = yield* w.asAgent((yield* w.token(top)).token);
  const mid = yield* w.start(topClient, { name: "Mid", permission: "edit", prompt: "Go." });
  const midClient = yield* w.asAgent((yield* w.token(mid)).token);
  const before = yield* w.watermark();
  const leaf = yield* w.start(midClient, { name: "Leaf", permission: "ask", prompt: "Go." });
  const events = yield* eventsUntil(w.owner, before, "the leaf's turn", isTag("TurnEnded", leaf.agentId));
  expect(tagged(events, "AgentStarted", leaf.agentId)[0]!.event).toMatchObject({ parent: { _tag: "agent", agentId: mid.agentId } });
  // Mid cannot raise its child above mid's own permission.
  expect(yield* refusal(w.start(midClient, { name: "Too much", permission: "full" }))).toBeDefined();
}));
