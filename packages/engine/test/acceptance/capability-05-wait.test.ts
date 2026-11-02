// Capability 5: wait without polling. A waiting agent is woken once, when one
// agent or every agent in a set finishes its turn. Issue 75: the owner has no
// waiter, so the waiter here is always an agent, and an owner `wait` is refused
// (asserted in the last scenario). Criteria 8.3 to 8.5.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import {
  eventsUntil, isTag, peekEcho, promptsOf, refusal, requestId, scenario, since, stopAllServices, tagged, type World,
} from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

type Queued = { delivery: { target: string; source?: { _tag: string; id: string } } };

// A boss with two children whose turns each hold at a gate file.
const team = (w: World) => Effect.gen(function* () {
  const boss = yield* w.start(w.owner, { name: "Boss", role: "lead", permission: "edit", prompt: "Start." });
  yield* eventsUntil(w.owner, 0, "the boss's first turn", isTag("TurnEnded", boss.agentId));
  const bossClient = yield* w.asAgent((yield* w.token(boss)).token);
  const gates = [join(w.root.root, "gate-a"), join(w.root.root, "gate-b")];
  const members = [];
  for (const [index, gate] of gates.entries()) {
    members.push(yield* w.start(bossClient, {
      name: `Member ${index}`, permission: "edit", prompt: "Work.",
      script: { turns: [[{ step: "wait_for_file", path: gate }, { step: "text", text: `done ${index}` }]] },
    }));
  }
  return { boss, bossClient, members, gates };
});

const wakes = (events: ReadonlyArray<{ event: { _tag: string } }>, boss: string) =>
  tagged(events as never, "DeliveryQueued").filter((envelope) => {
    const delivery = (envelope.event as unknown as Queued).delivery;
    return delivery.target === boss && delivery.source?._tag === "wait";
  });

scenario("5 wait (all): the waiting agent is woken once, only after the last member ends its turn (breaks if the wake fires on the first member, twice, or never)", (w) => Effect.gen(function* () {
  const { boss, bossClient, members, gates } = yield* team(w);
  const mark = yield* w.watermark();
  const opened = yield* bossClient.wait({
    requestId: requestId(), members: members.map((member) => member.agentId), mode: "all", block: false,
  } as never) as unknown as Effect.Effect<{ waitId: string; outcome: string }>;
  expect(opened.outcome).toBe("opened");

  writeFileSync(gates[0]!, "go");
  const firstDone = yield* eventsUntil(w.owner, mark, "the first member to finish", isTag("TurnEnded", members[0]!.agentId));
  expect(wakes(firstDone, boss.agentId), "woken after one of two members").toHaveLength(0);
  expect(tagged(firstDone, "WaitSatisfied")).toHaveLength(0);

  writeFileSync(gates[1]!, "go");
  const woken = yield* eventsUntil(w.owner, mark, "the boss to take the wake prompt", isTag("DeliveryAccepted", boss.agentId));
  const settled = yield* since(w.owner, mark);
  expect(wakes(settled, boss.agentId)).toHaveLength(1);
  expect(tagged(settled, "WaitSatisfied")).toHaveLength(1);
  expect(tagged(settled, "WaitSatisfied")[0]!.event).toMatchObject({ waitId: opened.waitId });
  expect(woken.length).toBeGreaterThan(0);
  // The boss's harness got exactly one more prompt than before.
  expect(promptsOf(peekEcho(boss.echo)!)).toHaveLength(2);
}));

scenario("5 wait (any): the waiting agent is woken once, when the first member ends, and the second member's end does not wake it again (breaks if 'any' waits for all, or wakes per member)", (w) => Effect.gen(function* () {
  const { boss, bossClient, members, gates } = yield* team(w);
  const mark = yield* w.watermark();
  yield* bossClient.wait({
    requestId: requestId(), members: members.map((member) => member.agentId), mode: "any", block: false,
  } as never);

  writeFileSync(gates[1]!, "go");
  yield* eventsUntil(w.owner, mark, "the boss to take the wake prompt", isTag("DeliveryAccepted", boss.agentId));
  writeFileSync(gates[0]!, "go");
  yield* eventsUntil(w.owner, mark, "the other member to finish", isTag("TurnEnded", members[0]!.agentId));

  const settled = yield* since(w.owner, mark);
  expect(wakes(settled, boss.agentId), "the boss was woken more than once for one wait").toHaveLength(1);
  expect(tagged(settled, "WaitSatisfied")).toHaveLength(1);
  expect(promptsOf(peekEcho(boss.echo)!)).toHaveLength(2);
}));

scenario("5 wait (blocking): a blocking wait returns when the member finishes and queues no wake prompt (breaks if a blocking wait also wakes its caller, or returns before the member ends)", (w) => Effect.gen(function* () {
  const { boss, bossClient, members, gates } = yield* team(w);
  const mark = yield* w.watermark();
  const call = yield* Effect.forkChild(bossClient.wait({
    requestId: requestId(), members: [members[0]!.agentId], mode: "all", block: true,
  } as never) as unknown as Effect.Effect<{ outcome: string }>);
  yield* eventsUntil(w.owner, mark, "the blocking wait to open", isTag("WaitOpened"));
  const pending = call.pollUnsafe();
  expect(pending, "the blocking wait returned before its member finished").toBeUndefined();

  writeFileSync(gates[0]!, "go");
  const reply = yield* Fiber.join(call);
  expect(reply.outcome).toBe("satisfied");
  yield* eventsUntil(w.owner, mark, "the member's turn", isTag("TurnEnded", members[0]!.agentId));
  const settled = yield* since(w.owner, mark);
  expect(wakes(settled, boss.agentId)).toHaveLength(0);
  expect(promptsOf(peekEcho(boss.echo)!)).toHaveLength(1);
}));

scenario("5 wait: the owner has no waiter and an agent cannot wait on an agent it does not hold (breaks if either wait is accepted, issue 75)", (w) => Effect.gen(function* () {
  const { members } = yield* team(w);
  const stranger = yield* w.start(w.owner, { name: "Stranger", permission: "edit", prompt: "Idle." });
  yield* eventsUntil(w.owner, 0, "the stranger's turn", isTag("TurnEnded", stranger.agentId));
  const strangerClient = yield* w.asAgent((yield* w.token(stranger)).token);
  expect(yield* refusal(w.owner.wait({ requestId: requestId(), members: [members[0]!.agentId], mode: "all", block: true } as never))).toBeDefined();
  expect(yield* refusal(strangerClient.wait({ requestId: requestId(), members: [members[0]!.agentId], mode: "all", block: false } as never))).toBeDefined();
}));
