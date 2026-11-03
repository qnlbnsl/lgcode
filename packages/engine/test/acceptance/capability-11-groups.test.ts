// Capability 11: group agents, the way the Foundry puts agents in tabs.
// Criteria 8.3 to 8.5.
import { afterEach, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { eventsUntil, isTag, refusal, requestId, scenario, since, stopAllServices, tagged } from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

const groupsOf = (events: ReadonlyArray<{ event: { _tag: string } }>): ReadonlyArray<ReadonlyArray<string>> =>
  tagged(events as never, "AgentGrouped").map((envelope) => (envelope.event as unknown as { groups: ReadonlyArray<string> }).groups);

scenario("11 groups: add and remove change the agent's groups and each change is an event, with a repeated add changing nothing twice (breaks if add replaces instead of merging, remove is ignored, or a duplicate group appears)", (w) => Effect.gen(function* () {
  const agent = yield* w.start(w.owner, { name: "Tabbed", groups: ["alpha"], prompt: "Go." });
  yield* eventsUntil(w.owner, 0, "the first turn", isTag("TurnEnded", agent.agentId));
  const group = (add: string[], remove: string[]) =>
    w.owner.group({ requestId: requestId(), agentId: agent.agentId, add, remove } as never);

  const mark = yield* w.watermark();
  yield* group(["beta", "gamma"], []);
  yield* group(["beta"], []);
  yield* group([], ["alpha"]);
  const events = yield* since(w.owner, mark);
  const seen = groupsOf(events);
  expect(seen[0]).toEqual(["alpha", "beta", "gamma"]);
  expect(seen.at(-1)).toEqual(["beta", "gamma"]);
  for (const groups of seen) expect(new Set(groups).size, "a group was listed twice").toBe(groups.length);
  for (const envelope of tagged(events, "AgentGrouped")) expect(envelope.agentId).toBe(agent.agentId);
}));

scenario("11 groups: a parent groups its own child, and an unrelated agent cannot (breaks if any agent can regroup any other agent)", (w) => Effect.gen(function* () {
  const boss = yield* w.start(w.owner, { name: "Boss", role: "lead", permission: "edit", prompt: "Start." });
  yield* eventsUntil(w.owner, 0, "the boss's turn", isTag("TurnEnded", boss.agentId));
  const bossClient = yield* w.asAgent((yield* w.token(boss)).token);
  const child = yield* w.start(bossClient, { name: "Child", permission: "ask", groups: ["tab-1"], prompt: "Go." });
  const stranger = yield* w.start(w.owner, { name: "Stranger", permission: "edit", prompt: "Go." });
  yield* eventsUntil(w.owner, 0, "the child's turn", isTag("TurnEnded", child.agentId));
  yield* eventsUntil(w.owner, 0, "the stranger's turn", isTag("TurnEnded", stranger.agentId));
  const strangerClient = yield* w.asAgent((yield* w.token(stranger)).token);

  const mark = yield* w.watermark();
  expect(yield* refusal(strangerClient.group({ requestId: requestId(), agentId: child.agentId, add: ["stolen"], remove: [] } as never))).toBeDefined();
  expect(tagged(yield* since(w.owner, mark), "AgentGrouped")).toHaveLength(0);
  yield* bossClient.group({ requestId: requestId(), agentId: child.agentId, add: ["tab-2"], remove: ["tab-1"] } as never);
  expect(groupsOf(yield* since(w.owner, mark)).at(-1)).toEqual(["tab-2"]);
}));
