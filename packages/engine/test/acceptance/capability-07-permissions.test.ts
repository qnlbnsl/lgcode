// Capability 7: answer permission requests. Each request goes to the agent that
// started the asker. That agent answers it or passes it up. The owner can
// answer any request. Criteria 8.3 to 8.5.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect } from "@effect/vitest";
import type { EventEnvelope } from "@shephrd/contracts";
import * as Effect from "effect/Effect";

import { eventsUntil, isTag, next, refusal, requestId, scenario, since, stopAllServices, tagged, threadText, type World } from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

const options = [
  { optionId: "allow-once", name: "Allow once", kind: "allow_once" }, { optionId: "reject-once", name: "Reject", kind: "reject_once" },
];
const ask = (id: string) => ({ step: "permission", toolCallId: id, title: `Run ${id}`, options });

type Requested = { permissionRequestId: string; holder: { _tag: string; agentId?: string }; toolCallId: string };
const requestedFor = (toolCallId: string) => (envelope: EventEnvelope): boolean =>
  envelope.event._tag === "PermissionRequested" && (envelope.event as unknown as Requested).toolCallId === toolCallId;
const requestIn = (envelope: EventEnvelope): Requested => envelope.event as unknown as Requested;

// The boss holds a request only while a turn of its own is open: the request
// reaches it as a prompt, and a holder whose turn ends without an answer
// passes the request up (routing/holders.ts passAtTurnEnd). So the boss's
// second turn waits at a gate that the scenario opens last.
const bossHoldingTurn = (w: World) => Effect.gen(function* () {
  const gate = join(w.root.root, "gate-boss");
  const boss = yield* w.start(w.owner, {
    name: "Boss", role: "lead", permission: "edit", prompt: "Start.",
    script: { turns: [[], [{ step: "wait_for_file", path: gate }]] },
  });
  yield* eventsUntil(w.owner, 0, "the boss's first turn", isTag("TurnEnded", boss.agentId));
  const bossClient = yield* w.asAgent((yield* w.token(boss)).token);
  return { boss, bossClient, release: () => writeFileSync(gate, "go") };
});

scenario("7 permissions: the request goes to the agent that started the asker, who answers it, and the asker carries on with that answer (breaks if the request goes to the owner first, or the answer does not reach the harness)", (w) => Effect.gen(function* () {
  const { boss, bossClient, release } = yield* bossHoldingTurn(w);
  const before = yield* w.watermark();
  const child = yield* w.start(bossClient, { name: "Child", permission: "ask", prompt: "Go.", script: { turns: [[ask("one")]] } });
  const requested = requestIn(yield* next(w.owner, before, "the request", requestedFor("one")));
  expect(requested.holder).toEqual({ _tag: "agent", agentId: boss.agentId });

  // Another agent that did not start the asker may not answer it.
  const stranger = yield* w.start(w.owner, { name: "Stranger", permission: "edit", prompt: "Idle." });
  yield* eventsUntil(w.owner, 0, "the stranger's turn", isTag("TurnEnded", stranger.agentId));
  const strangerClient = yield* w.asAgent((yield* w.token(stranger)).token);
  const mark = yield* w.watermark();
  expect(yield* refusal(strangerClient.answer({ requestId: requestId(), kind: "permission", id: requested.permissionRequestId, optionId: "allow-once" } as never))).toBeDefined();
  expect(tagged(yield* since(w.owner, mark), "PermissionAnswered")).toHaveLength(0);

  yield* bossClient.answer({ requestId: requestId(), kind: "permission", id: requested.permissionRequestId, optionId: "allow-once" } as never);
  release();
  const events = yield* eventsUntil(w.owner, before, "the child's turn", isTag("TurnEnded", child.agentId));
  const answered = tagged(events, "PermissionAnswered");
  expect(answered).toHaveLength(1);
  expect(answered[0]!.event).toMatchObject({
    permissionRequestId: requested.permissionRequestId, answeredBy: { _tag: "agent", agentId: boss.agentId }, answer: { _tag: "selected", optionId: "allow-once" },
  });
  expect(threadText(events, child.agentId)).toContain("permission:selected:allow-once");
}));

scenario("7 permissions: passing a request up moves it to the owner, who is told it is needed and whose answer reaches the asker (breaks if pass-up leaves the request with the agent, or the owner is not named as needed)", (w) => Effect.gen(function* () {
  const { boss, bossClient, release } = yield* bossHoldingTurn(w);
  const before = yield* w.watermark();
  const child = yield* w.start(bossClient, { name: "Child", permission: "ask", prompt: "Go.", script: { turns: [[ask("two")]] } });
  const requested = requestIn(yield* next(w.owner, before, "the request", requestedFor("two")));
  const mark = yield* w.watermark();

  yield* bossClient["pass-up"]({ requestId: requestId(), subject: { _tag: "permission", id: requested.permissionRequestId } } as never);
  const moved = yield* eventsUntil(w.owner, mark, "the owner to be told", isTag("OwnerNeeded", child.agentId));
  expect(tagged(moved, "PermissionMoved")[0]!.event).toMatchObject({
    permissionRequestId: requested.permissionRequestId, from: { _tag: "agent", agentId: boss.agentId }, to: { _tag: "owner" },
  });
  expect(tagged(moved, "OwnerNeeded", child.agentId)[0]!.event).toMatchObject({ subject: { _tag: "permission", id: requested.permissionRequestId } });
  // The boss no longer holds it: its own answer is refused now.
  expect(yield* refusal(bossClient.answer({ requestId: requestId(), kind: "permission", id: requested.permissionRequestId, optionId: "allow-once" } as never))).toBeDefined();

  yield* w.owner.answer({ requestId: requestId(), kind: "permission", id: requested.permissionRequestId, optionId: "reject-once" } as never);
  release();
  const events = yield* eventsUntil(w.owner, before, "the child's turn", isTag("TurnEnded", child.agentId));
  expect(tagged(events, "PermissionAnswered")[0]!.event).toMatchObject({ answeredBy: { _tag: "owner" }, answer: { optionId: "reject-once" } });
  expect(threadText(events, child.agentId)).toContain("permission:selected:reject-once");
}));

scenario("7 permissions: the owner can answer a request that another agent still holds (breaks if only the holder may answer)", (w) => Effect.gen(function* () {
  const { boss, bossClient, release } = yield* bossHoldingTurn(w);
  const before = yield* w.watermark();
  const child = yield* w.start(bossClient, { name: "Child", permission: "ask", prompt: "Go.", script: { turns: [[ask("three")]] } });
  const requested = requestIn(yield* next(w.owner, before, "the request", requestedFor("three")));
  expect(requested.holder).toEqual({ _tag: "agent", agentId: boss.agentId });

  yield* w.owner.answer({ requestId: requestId(), kind: "permission", id: requested.permissionRequestId, optionId: "allow-once" } as never);
  release();
  const events = yield* eventsUntil(w.owner, before, "the child's turn", isTag("TurnEnded", child.agentId));
  expect(tagged(events, "PermissionAnswered")[0]!.event).toMatchObject({ answeredBy: { _tag: "owner" }, answer: { optionId: "allow-once" } });
  expect(threadText(events, child.agentId)).toContain("permission:selected:allow-once");
}));
