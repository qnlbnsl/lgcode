// Failure rule 2: Shephrd itself restarts. The service runs as a child process,
// is killed with SIGKILL in the middle of a turn, and is started again on the
// same folder. Agents that were running are marked interrupted, their open
// permission requests close, each session is reloaded without a model turn,
// a message is neither lost nor repeated, and an open wait stays open.
// Criteria 8.3 to 8.5. Spec: "When things fail" rule 2 and "Messages that
// survive a restart" (rows 29, 51, 66).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect } from "@effect/vitest";
import type { EventEnvelope } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import {
  eventsUntil, isTag, peekEcho, promptsOf, requestId, scenario, since, stopAllServices, tagged, waitFor,
  type Client, type World,
} from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

const SIGKILLED = "SIGKILL";

// The service dies by SIGKILL, with no chance to tidy, and starts again.
const crashService = (w: World) => Effect.gen(function* () {
  const exit = yield* w.kill(SIGKILLED);
  expect(exit.signal, "the service did not die by SIGKILL").toBe(SIGKILLED);
  yield* w.boot();
});

const of = (events: ReadonlyArray<EventEnvelope>, tag: string, deliveryId: string): ReadonlyArray<EventEnvelope> =>
  tagged(events, tag).filter((envelope) => (envelope.event as unknown as { deliveryId?: string }).deliveryId === deliveryId);

const request = (toolCallId: string) => ({
  step: "raw_frame",
  frame: JSON.stringify({
    jsonrpc: "2.0", id: 9001, method: "session/request_permission",
    params: {
      sessionId: "${session}", title: "Write the file",
      subject: { type: "tool_call", toolCall: { toolCallId, title: "Write the file" } },
      options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
    },
  }),
});

// A token the restarted service must refuse, either at connection or at the call.
const refusedNow = (w: World, token: string) => Effect.gen(function* () {
  const attempt: Exit.Exit<Client, unknown> = yield* Effect.exit(w.asAgent(token));
  if (Exit.isFailure(attempt)) return true;
  const call = yield* Effect.exit(attempt.value.ask({ requestId: requestId(), text: "Still me?" } as never));
  return Exit.isFailure(call);
});

scenario("2 restart: a message that was sent but not accepted when the service was killed is sent again once and the message queued behind it follows it, in order, once (breaks if the unaccepted message is dropped, sent twice after the restart, or overtaken by the later one)", (w) => Effect.gen(function* () {
  const gate = join(w.root.root, "gate-unaccepted");
  const agent = yield* w.start(w.owner, {
    name: "Worker", permission: "ask", prompt: "Work A.",
    script: { turns: [[{ step: "wait_for_file", path: gate }, { step: "text", text: "done" }], [{ step: "text", text: "second" }]] },
  });
  const sentA = yield* eventsUntil(w.owner, 0, "message A to be sent", isTag("DeliverySent", agent.agentId));
  const idA = (sentA.at(-1)!.event as unknown as { deliveryId: string }).deliveryId;
  const before = yield* w.token(agent);
  const reply = (yield* w.owner.prompt({ requestId: requestId(), agentId: agent.agentId, text: "Message B." } as never)) as { deliveryId: string };
  expect(promptsOf(before.echo)).toEqual(["Work A."]);

  yield* crashService(w);
  yield* w.token(agent, before.pid);
  yield* waitFor("the reloaded agent to receive message A again", () => promptsOf(peekEcho(agent.echo)!).length > 0 ? true : undefined);
  writeFileSync(gate, "go");
  const events = yield* eventsUntil(w.owner, 0, "message B to be accepted", (envelope) => envelope.event._tag === "DeliveryAccepted"
    && (envelope.event as unknown as { deliveryId: string }).deliveryId === reply.deliveryId, 30_000);

  expect(tagged(events, "AgentInterrupted", agent.agentId)).toHaveLength(1);
  expect(tagged(events, "AgentInterrupted", agent.agentId)[0]!.event).toMatchObject({ previous: "working" });
  expect(of(events, "DeliveryRequeued", idA), "message A was not put back in the queue").toHaveLength(1);
  expect(of(events, "DeliverySent", idA), "message A was sent other than once before and once after the restart").toHaveLength(2);
  expect(of(events, "DeliveryAccepted", idA).length).toBeLessThanOrEqual(1);
  expect(of(events, "DeliverySent", reply.deliveryId), "message B was sent other than once").toHaveLength(1);
  expect(of(events, "DeliveryAccepted", reply.deliveryId)).toHaveLength(1);
  const resentA = of(events, "DeliverySent", idA)[1]!;
  expect(resentA.sequence).toBeLessThan(of(events, "DeliverySent", reply.deliveryId)[0]!.sequence);
  // What the adapter itself received, before and after.
  expect(promptsOf(peekEcho(agent.echo)!)).toEqual(["Work A.", "Message B."]);
}));

scenario("2 restart: a message the reloaded conversation already shows is not sent again, the agent is told once to carry on, and the message queued behind it is sent once (breaks if a received message is re-sent, the carry-on is missing or repeated, or the queued message is lost)", (w) => Effect.gen(function* () {
  const boss = yield* w.start(w.owner, { name: "Boss", role: "lead", permission: "edit", prompt: "Start." });
  yield* eventsUntil(w.owner, 0, "the boss's first turn", isTag("TurnEnded", boss.agentId));
  const bossClient = yield* w.asAgent((yield* w.token(boss)).token);
  const gate = join(w.root.root, "gate-shown");
  const child = yield* w.start(bossClient, {
    name: "Child", permission: "ask", prompt: "Init.",
    script: { turns: [[], [{ step: "wait_for_file", path: gate }, { step: "text", text: "x done" }], [{ step: "text", text: "tail" }]] },
  });
  yield* eventsUntil(w.owner, 0, "the child's first turn", isTag("TurnEnded", child.agentId));
  const mark = yield* w.watermark();
  const x = (yield* bossClient.prompt({ requestId: requestId(), agentId: child.agentId, text: "Task X." } as never)) as { deliveryId: string };
  yield* eventsUntil(w.owner, mark, "task X to be sent", (envelope) => envelope.event._tag === "DeliverySent" && (envelope.event as unknown as { deliveryId: string }).deliveryId === x.deliveryId);
  const before = yield* w.token(child);
  const received = promptsOf(before.echo).at(-1)!;
  expect(received).toContain(`(delivery ${x.deliveryId})`);
  const y = (yield* bossClient.prompt({ requestId: requestId(), agentId: child.agentId, text: "Task Y." } as never)) as { deliveryId: string };

  // The restarted adapter's reloaded conversation shows task X, as a real
  // adapter's saved conversation would: the text it received, as a user turn.
  const listing = (yield* w.owner.accounts({ requestId: requestId(), operation: "list" } as never)) as { accounts: ReadonlyArray<{ id: string; environment?: Record<string, string> }> };
  const account = listing.accounts.find((row) => row.id === child.accountId)!;
  const script = JSON.parse(account.environment!.FAKE_AGENT_SCRIPT!) as Record<string, unknown>;
  yield* w.owner.accounts({
    requestId: requestId(), operation: "set",
    account: { ...account, environment: { ...account.environment, FAKE_AGENT_SCRIPT: JSON.stringify({ ...script, history: [{ role: "user", text: received }] }) } },
  } as never);

  yield* crashService(w);
  yield* w.token(child, before.pid);
  writeFileSync(gate, "go");
  const events = yield* eventsUntil(w.owner, 0, "task Y to be accepted", (envelope) => envelope.event._tag === "DeliveryAccepted"
    && (envelope.event as unknown as { deliveryId: string }).deliveryId === y.deliveryId, 30_000);

  expect(of(events, "DeliverySent", x.deliveryId), "task X was sent again although the conversation shows it").toHaveLength(1);
  expect(of(events, "DeliveryRequeued", x.deliveryId)).toHaveLength(0);
  expect(of(events, "DeliveryAccepted", x.deliveryId)).toHaveLength(1);
  const carryOns = tagged(events, "DeliveryQueued").filter((envelope) =>
    (envelope.event as unknown as { delivery: { target: string; content: { _tag: string } } }).delivery.target === child.agentId
    && (envelope.event as unknown as { delivery: { content: { _tag: string } } }).delivery.content._tag === "carry-on");
  expect(carryOns, "the agent was not told to carry on exactly once").toHaveLength(1);
  expect(of(events, "DeliverySent", y.deliveryId)).toHaveLength(1);
  const after = promptsOf(peekEcho(child.echo)!);
  expect(after).toHaveLength(2);
  expect(after[0]).toMatch(/carry on/i);
  expect(after[1]).toContain(`(delivery ${y.deliveryId})`);
  expect(after.join("\n")).not.toContain("Task X.");
}));

scenario("2 restart: an agent in the middle of a turn is marked interrupted, its open permission request is cancelled and unanswered, it is told once to carry on, and its old token stops working (breaks if the interrupted state is not recorded, the dead process's request stays open or is answered, the carry-on is missing, or the old token survives)", (w) => Effect.gen(function* () {
  const gate = join(w.root.root, "gate-midturn");
  const agent = yield* w.start(w.owner, {
    name: "Midturn", permission: "ask", prompt: "Work.",
    script: { turns: [[request("call-restart"), { step: "plan", entries: [] }, { step: "wait_for_file", path: gate }, { step: "text", text: "done" }]] },
  });
  const started = yield* eventsUntil(w.owner, 0, "the permission request", isTag("PermissionRequested", agent.agentId));
  const first = (started.at(-1)!.event as unknown as { permissionRequestId: string }).permissionRequestId;
  yield* eventsUntil(w.owner, 0, "the work to be accepted", isTag("DeliveryAccepted", agent.agentId));
  const before = yield* w.token(agent);

  yield* crashService(w);
  expect(yield* refusedNow(w, before.token), "the old token still works after the restart").toBe(true);
  const after = yield* w.token(agent, before.pid);
  expect(after.token).not.toBe(before.token);
  writeFileSync(gate, "go");
  // The first run never ended its turn, so this turn end is the carry-on turn's.
  const events = yield* eventsUntil(w.owner, 0, "the carry-on turn to end", isTag("TurnEnded", agent.agentId), 30_000);
  expect(tagged(events, "AgentInterrupted", agent.agentId)).toHaveLength(1);
  expect(tagged(events, "AgentInterrupted", agent.agentId)[0]!.event).toMatchObject({ previous: "working" });
  const cancelled = tagged(events, "PermissionCancelled", agent.agentId).filter((envelope) =>
    (envelope.event as unknown as { permissionRequestId: string }).permissionRequestId === first);
  expect(cancelled, "the dead process's request was not cancelled exactly once").toHaveLength(1);
  expect(tagged(events, "PermissionAnswered", agent.agentId).filter((envelope) =>
    (envelope.event as unknown as { permissionRequestId: string }).permissionRequestId === first)).toHaveLength(0);
  const carryOns = tagged(events, "DeliveryQueued").filter((envelope) =>
    (envelope.event as unknown as { delivery: { target: string; content: { _tag: string } } }).delivery.content._tag === "carry-on");
  expect(carryOns).toHaveLength(1);
  expect(promptsOf(peekEcho(agent.echo)!).join("\n")).toMatch(/carry on/i);
  expect(promptsOf(peekEcho(agent.echo)!)).toHaveLength(1);
}));

scenario("2 restart: a wait that was open when the service was killed is still open afterwards and wakes its waiter exactly once, when the member finishes (breaks if the restart drops the wait, wakes the waiter early, or wakes it twice)", (w) => Effect.gen(function* () {
  const boss = yield* w.start(w.owner, { name: "Boss", role: "lead", permission: "edit", prompt: "Start." });
  yield* eventsUntil(w.owner, 0, "the boss's first turn", isTag("TurnEnded", boss.agentId));
  const bossBefore = yield* w.token(boss);
  const bossClient = yield* w.asAgent(bossBefore.token);
  const gate = join(w.root.root, "gate-wait");
  const member = yield* w.start(bossClient, {
    name: "Member", permission: "ask", prompt: "Work.",
    script: { turns: [[{ step: "plan", entries: [] }, { step: "wait_for_file", path: gate }, { step: "text", text: "done" }]] },
  });
  yield* eventsUntil(w.owner, 0, "the member's work to be accepted", isTag("DeliveryAccepted", member.agentId));
  const opened = (yield* bossClient.wait({ requestId: requestId(), members: [member.agentId], mode: "all", block: false } as never)) as { outcome: string };
  expect(opened.outcome).toBe("opened");
  const memberBefore = yield* w.token(member);
  const mark = yield* w.watermark();

  yield* crashService(w);
  yield* w.token(member, memberBefore.pid);
  yield* w.token(boss, bossBefore.pid);
  const early = yield* since(w.owner, mark);
  expect(tagged(early, "WaitSatisfied"), "the restart satisfied the wait early").toHaveLength(0);
  expect(tagged(early, "WaitCancelled"), "the restart cancelled the wait").toHaveLength(0);

  writeFileSync(gate, "go");
  const restartEnd = early.at(-1)?.sequence ?? mark;
  yield* eventsUntil(w.owner, mark, "the waiter to take the wake", (envelope) => envelope.event._tag === "DeliveryAccepted"
    && envelope.agentId === boss.agentId && envelope.sequence > restartEnd, 30_000);
  const settled = yield* since(w.owner, mark);
  expect(tagged(settled, "WaitSatisfied")).toHaveLength(1);
  const wakes = tagged(settled, "DeliveryQueued").filter((envelope) => {
    const delivery = (envelope.event as unknown as { delivery: { target: string; source?: { _tag: string } } }).delivery;
    return delivery.target === boss.agentId && delivery.source?._tag === "wait";
  });
  expect(wakes, "the waiter was not woken exactly once").toHaveLength(1);
}));
