// Capability 10: stop, resume and compact an agent. Criteria 8.3 to 8.5.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  alive, eventsUntil, isTag, peekEcho, promptsOf, refusal, requestId, scenario, since, stopAllServices, tagged, threadText, waitFor,
} from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

scenario("10 stop and resume: stop ends the process and revokes the agent's token, a stopped agent refuses prompts, and resume reopens the session with a new token that works (breaks if stop leaves the process or token alive, or resume reuses the old token)", (w) => Effect.gen(function* () {
  const agent = yield* w.start(w.owner, { name: "Sleeper", permission: "ask", prompt: "Go.", script: { turns: [[{ step: "text", text: "awake" }]] } });
  yield* eventsUntil(w.owner, 0, "the first turn", isTag("TurnEnded", agent.agentId));
  const first = yield* w.token(agent);
  const oldClient = yield* w.asAgent(first.token);
  const mark = yield* w.watermark();

  yield* w.owner.stop({ requestId: requestId(), agentId: agent.agentId } as never);
  expect(tagged(yield* since(w.owner, mark), "AgentStopped", agent.agentId)).toHaveLength(1);
  yield* waitFor("the agent process to exit", () => (alive(first.pid) ? undefined : true));
  expect(yield* refusal(oldClient.ask({ requestId: requestId(), text: "Still there?" } as never)), "the token of a stopped agent still works").toBeDefined();
  expect(yield* refusal(w.owner.prompt({ requestId: requestId(), agentId: agent.agentId, text: "Wake up." } as never))).toBeDefined();
  expect(yield* refusal(w.owner.stop({ requestId: requestId(), agentId: agent.agentId } as never)), "a second stop was accepted").toBeDefined();

  const resumeMark = yield* w.watermark();
  yield* w.owner.resume({ requestId: requestId(), agentId: agent.agentId } as never);
  const reopened = yield* eventsUntil(w.owner, resumeMark, "the session to reopen", isTag("SessionOpened", agent.agentId));
  expect(tagged(reopened, "SessionOpened", agent.agentId)).toHaveLength(1);
  const second = yield* w.token(agent, first.pid);
  expect(second.token).not.toBe(first.token);
  expect(second.pid).not.toBe(first.pid);
  expect(yield* refusal(oldClient.ask({ requestId: requestId(), text: "Old token." } as never)), "the old token works after resume").toBeDefined();

  const promptMark = yield* w.watermark();
  yield* w.owner.prompt({ requestId: requestId(), agentId: agent.agentId, text: "Welcome back." } as never);
  const events = yield* eventsUntil(w.owner, promptMark, "the resumed turn", isTag("TurnEnded", agent.agentId));
  expect(threadText(events, agent.agentId)).toContain("awake");
  expect(promptsOf(peekEcho(agent.echo)!)).toContain("Welcome back.");
}));

scenario("10 stop: a parent stops its own child and an unrelated agent cannot (breaks if any agent can stop any agent, or a parent cannot stop its child)", (w) => Effect.gen(function* () {
  const boss = yield* w.start(w.owner, { name: "Boss", role: "lead", permission: "edit", prompt: "Start." });
  yield* eventsUntil(w.owner, 0, "the boss's turn", isTag("TurnEnded", boss.agentId));
  const bossClient = yield* w.asAgent((yield* w.token(boss)).token);
  const child = yield* w.start(bossClient, { name: "Child", permission: "ask", prompt: "Go." });
  const stranger = yield* w.start(w.owner, { name: "Stranger", permission: "edit", prompt: "Go." });
  yield* eventsUntil(w.owner, 0, "the child's turn", isTag("TurnEnded", child.agentId));
  yield* eventsUntil(w.owner, 0, "the stranger's turn", isTag("TurnEnded", stranger.agentId));
  const strangerClient = yield* w.asAgent((yield* w.token(stranger)).token);

  expect(yield* refusal(strangerClient.stop({ requestId: requestId(), agentId: child.agentId } as never))).toBeDefined();
  const mark = yield* w.watermark();
  expect(tagged(yield* since(w.owner, mark), "AgentStopped")).toHaveLength(0);
  yield* bossClient.stop({ requestId: requestId(), agentId: child.agentId } as never);
  const stopped = yield* since(w.owner, mark);
  expect(tagged(stopped, "AgentStopped")).toHaveLength(1);
  expect(tagged(stopped, "AgentStopped")[0]!.agentId).toBe(child.agentId);
  expect(tagged(stopped, "AgentStopped", boss.agentId)).toHaveLength(0);
}));

// The harness's command catalogue, sent as the first harness's adapter sends
// it (the existing raw_frame step; no fake-agent change is needed). Without a
// "compact" entry the runner rejects a compaction.
const catalogue = (names: ReadonlyArray<string>) => ({
  step: "raw_frame",
  frame: JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "${session}", update: {
    sessionUpdate: "available_commands_update",
    availableCommands: names.map((name) => ({ type: "command", name, description: `The ${name} command` })),
  } } }),
});

scenario("10 compact: an idle agent compacts and its turn ends marked as a compaction, while a working agent refuses (breaks if compact is accepted mid-turn, or the compaction is not marked)", (w) => Effect.gen(function* () {
  const gate = join(w.root.root, "gate-compact");
  const agent = yield* w.start(w.owner, {
    name: "Packer", permission: "ask", prompt: "Work.",
    script: { turns: [[catalogue(["compact"]), { step: "wait_for_file", path: gate }, { step: "text", text: "worked" }], [{ step: "text", text: "compacted" }]] },
  });
  yield* eventsUntil(w.owner, 0, "the work to start", isTag("DeliverySent", agent.agentId));
  expect(yield* refusal(w.owner.compact({ requestId: requestId(), agentId: agent.agentId } as never)), "compact was accepted during a turn").toBeDefined();

  writeFileSync(gate, "go");
  yield* eventsUntil(w.owner, 0, "the turn end", isTag("TurnEnded", agent.agentId));
  const mark = yield* w.watermark();
  const reply = yield* w.owner.compact({ requestId: requestId(), agentId: agent.agentId } as never) as unknown as Effect.Effect<{ deliveryId: string }>;
  const events = yield* eventsUntil(w.owner, mark, "the compaction to end", isTag("TurnEnded", agent.agentId));
  expect(tagged(events, "DeliveryQueued")[0]!.event).toMatchObject({ delivery: { id: reply.deliveryId, content: { _tag: "compact" } } });
  expect(tagged(events, "TurnEnded", agent.agentId)[0]!.event).toMatchObject({ compact: true });
  expect(promptsOf(peekEcho(agent.echo)!).at(-1)).toBe("/compact");
}));
