// Capability 4: know an agent's state, and be told when it changes. The state
// is carried by events on the subscribe stream; a client that connects late
// replays from a sequence and reaches the same state. Criteria 8.3 to 8.5.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect } from "@effect/vitest";
import { eventEffect, type EventEnvelope } from "@sheprd/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { eventsUntil, isTag, requestId, scenario, since, stopAllServices } from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

// What a client does with the stream: fold the agent's events through the
// contracts' event table into its lifecycle state names, one per change.
const states = (events: ReadonlyArray<EventEnvelope>, agentId: string): ReadonlyArray<string> => {
  const seen: string[] = [];
  let current: string | undefined;
  for (const envelope of events) {
    if (envelope.agentId !== agentId) continue;
    const tag = envelope.event._tag;
    const effect = current === undefined ? (tag === "AgentStarted" ? "starting" : "keep") : eventEffect(current as never, tag as never);
    const next = effect === "transition" ? (envelope.event as { state: { _tag: string } }).state._tag
      : ["starting", "working", "idle", "crashed", "stopped"].includes(effect) ? effect : current;
    if (next !== undefined && next !== current) { current = next; seen.push(next); }
  }
  return seen;
};

scenario("4 state: a client sees starting, idle, working, idle and stopped as events, in order, and a late client replaying the log sees the same (breaks if a turn does not mark the agent working, or stop leaves it idle)", (w) => Effect.gen(function* () {
  const gate = join(w.root.root, "gate-state");
  const before = yield* w.watermark();
  const agent = yield* w.start(w.owner, {
    name: "Stately", prompt: "Go.",
    script: { turns: [[{ step: "text", text: "a" }, { step: "wait_for_file", path: gate }, { step: "text", text: "b" }]] },
  });
  // While the turn is held at the gate the agent is working, not idle.
  const running = yield* eventsUntil(w.owner, before, "the prompt to be sent", isTag("DeliverySent", agent.agentId));
  expect(states(running, agent.agentId)).toEqual(["starting", "idle", "working"]);
  expect(running.some(isTag("TurnEnded", agent.agentId))).toBe(false);

  writeFileSync(gate, "go");
  const ended = yield* eventsUntil(w.owner, before, "the turn to end", isTag("TurnEnded", agent.agentId));
  expect(states(ended, agent.agentId)).toEqual(["starting", "idle", "working", "idle"]);

  yield* w.owner.stop({ requestId: requestId(), agentId: agent.agentId } as never);
  const stopped = yield* eventsUntil(w.owner, before, "the stop", isTag("AgentStopped", agent.agentId));
  expect(states(stopped, agent.agentId)).toEqual(["starting", "idle", "working", "idle", "stopped"]);

  // A client that connects now, from the start of the log, reaches the same state.
  const late = yield* since(w.owner, 0);
  expect(states(late, agent.agentId)).toEqual(["starting", "idle", "working", "idle", "stopped"]);
}));

scenario("4 state: a client is told of each change as it happens, without asking again (breaks if the subscribe stream only replays and never delivers new events)", (w) => Effect.gen(function* () {
  const agent = yield* w.start(w.owner, { name: "Live", prompt: "Go." });
  yield* eventsUntil(w.owner, 0, "the first turn", isTag("TurnEnded", agent.agentId));
  const mark = yield* w.watermark();
  // Subscribe first, then cause the change: the stream delivers it live.
  const watcher = yield* Effect.forkChild(eventsUntil(w.owner, mark, "the live prompt", isTag("TurnEnded", agent.agentId)));
  yield* w.owner.prompt({ requestId: requestId(), agentId: agent.agentId, text: "Again." } as never);
  const live = yield* Fiber.join(watcher);
  const tags = live.filter((e) => e.agentId === agent.agentId).map((e) => e.event._tag);
  expect(tags.indexOf("DeliverySent")).toBeGreaterThanOrEqual(0);
  expect(tags.indexOf("TurnEnded")).toBeGreaterThan(tags.indexOf("DeliverySent"));
}));
