import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { expect, it } from "vitest";
import { settled } from "@shephrd/contracts";
import { snapshot as clientSnapshot } from "../../src/api/snapshot.ts";
import { reloadedEvents } from "../../src/recovery/reload.ts";
import { dispatchQueued } from "../../src/routing/deliveries.ts";
import { project, withWaitChecks } from "../../src/routing/waits.ts";
import { classifyError } from "../../src/runner/classify.ts";
import { accept, crash, notice, promptsTo, send, spawn, waitRow } from "../support/deliveryRig.ts";
import { incarnationOf, makeFakeRunner } from "../support/fakeRunner.ts";
import {
  agentCredential, agentRow, appendSetup, call, eventOf, headSequence, logAfter,
  ownerCredential, success,
} from "../support/handlerRig.ts";
import { capacityCount, capacityReply, eventsNamed, hold, openBlockingWait, runCapacity, startHeld } from "../support/capacityRig.ts";
import { deliveryRow, endTurn, eventually, pause, snapshot } from "../support/routingRig.ts";
import { provideRestart, recover } from "../support/restartRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

// Provider-documented error type, not a claimed live recording. See the sourced
// claude-capacity.json fixture, pinned to claude-agent-acp 0.99.1.
const overload = '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';
registerRebuildCheck({ noLog: true });

it("K01 catches treating Claude's documented overload as usage exhaustion or a generic failure", () => {
  expect(classifyError({ harness: "claude", text: overload })).toBe("capacity");
});
it("K02 catches guessing a capacity class for an unsupported harness or loose successful prose", () => {
  for (const harness of ["claude", "codex", "cursor", "gemini", "unknown"]) {
    for (const text of ["The capacity test passed.", "Added overloaded_error handling.", "The model has capacity.", ""]) {
      expect(classifyError({ harness, text }), `${harness}: ${text}`).toBeUndefined();
    }
    if (harness !== "claude") expect(classifyError({ harness, text: overload })).toBeUndefined();
  }
  expect(classifyError({ harness: "claude", text: "You've hit your limit" })).toBe("out-of-usage");
  expect(classifyError({ harness: "claude", text: "Authentication required" })).toBe("signed-out");
});

it("K03 catches returning or pausing an unaccepted delivery instead of holding its queue idle without ending its turn", async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const { target, deliveryId, rows } = yield* startHeld(rig, runner);
  expect((yield* agentRow(target.agentId))?.state).toEqual({ _tag: "idle" });
  expect((yield* deliveryRow(deliveryId))?.status).toBe("queued");
  expect(eventsNamed(rows, "DeliveryReturned")).toEqual([]);
  expect(eventsNamed(rows, "TurnEnded")).toEqual([]);
  expect((yield* snapshot).accounts.primary?.status).toBe("available");
  const before = yield* headSequence;
  yield* runner.emit({ _tag: "turnEnded", agentId: target.agentId, incarnation: incarnationOf(target.token), deliveryId: deliveryId as never });
  yield* pause(40);
  expect(eventsNamed(yield* logAfter(before), "TurnEnded")).toEqual([]);
  expect(promptsTo(runner, target)).toHaveLength(1);
})));

it("K04 catches repeating accepted work instead of holding one carry-on ahead of later work", async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const target = yield* spawn(rig, runner);
  const original = yield* send(runner, target, "Accepted original work.");
  yield* accept(runner, target, original);
  const later = success(yield* call(ownerCredential, "prompt", { agentId: target.agentId, text: "Later work." })).deliveryId;
  const held = yield* hold(runner, target, original);
  const carries = Object.values((yield* snapshot).deliveries).filter((row) => row.target === target.agentId && row.content._tag === "carry-on");
  expect(carries).toHaveLength(1);
  expect([original, carries[0]!.id]).toContain(eventsNamed(held, "DeliveryHeld")[0]!.deliveryId);
  expect(carries[0]?.status).toBe("queued");
  expect((yield* deliveryRow(original))?.status).toBe("accepted");
  success(yield* call(ownerCredential, "release", { agentId: target.agentId }));
  const calls = yield* eventually(Effect.sync(() => promptsTo(runner, target)), (rows) => rows.length === 2);
  expect(calls.map((row) => row.input.delivery.id)).toEqual([original, carries[0]!.id]);
  expect((yield* deliveryRow(String(later)))?.status).toBe("queued");
})));

it("K05 catches a capacity hold satisfying an existing blocking wait or waking the sender", async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const parent = yield* spawn(rig, runner);
  const target = yield* spawn(rig, runner, parent);
  const deliveryId = yield* send(runner, target, "Child work.", parent);
  const waiting = yield* openBlockingWait(parent, target);
  const rows = yield* hold(runner, target, deliveryId);
  expect((yield* waitRow(String(waiting.waitId)))?.status).toBe("open");
  expect(eventsNamed(rows, "WaitSatisfied")).toEqual([]);
  expect(eventsNamed(rows, "DeliveryReturned")).toEqual([]);
  expect(promptsTo(runner, parent)).toEqual([]);
})));

it("K06 catches an absent roles condition silently enabling holds instead of returning capacity to its sender", async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const parent = yield* spawn(rig, runner);
  const target = yield* spawn(rig, runner, parent);
  const deliveryId = yield* send(runner, target, "No sheepdog is installed.", parent);
  const before = yield* headSequence;
  yield* capacityReply(runner, target, deliveryId);
  const rows = yield* eventually(logAfter(before), (rows) => eventsNamed(rows, "DeliveryReturned").length > 0);
  expect(eventsNamed(rows, "DeliveryReturned")).toEqual([expect.objectContaining({ deliveryId, cause: "capacity" })]);
  expect(eventsNamed(rows, "DeliveryHeld")).toEqual([]);
  expect((yield* agentRow(target.agentId))?.state._tag).toBe("idle");
  expect((yield* snapshot).accounts.primary?.status).toBe("available");
  expect((yield* eventually(Effect.sync(() => promptsTo(runner, parent)), (rows) => rows.length > 0))).toHaveLength(1);
}), null));

it("K07 catches a global outage count, a release resetting it, or a spent condition holding forever", async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const { target, deliveryId } = yield* startHeld(rig, runner);
  expect(capacityCount(yield* snapshot, target.agentId)).toBe(1);
  const other = yield* spawn(rig, runner);
  expect(capacityCount(yield* snapshot, other.agentId)).toBe(0);
  success(yield* call(ownerCredential, "release", { agentId: target.agentId }));
  expect((yield* eventually(deliveryRow(deliveryId), (row) => row?.status === "sent"))?.status).toBe("sent");
  yield* hold(runner, target, deliveryId);
  expect(capacityCount(yield* snapshot, target.agentId)).toBe(2);
  success(yield* call(ownerCredential, "release", { agentId: target.agentId }));
  yield* eventually(deliveryRow(deliveryId), (row) => row?.status === "sent");
  const before = yield* headSequence;
  yield* capacityReply(runner, target, deliveryId);
  const rows = yield* eventually(logAfter(before), (rows) => eventsNamed(rows, "DeliveryReturned").length > 0);
  expect(eventsNamed(rows, "DeliveryReturned")).toEqual([expect.objectContaining({ deliveryId, cause: "capacity" })]);
  expect(eventsNamed(rows, "DeliveryHeld")).toEqual([]);
  expect(capacityCount(yield* snapshot, target.agentId)).toBe(0);
}), (id, views) => capacityCount(views, id) < 2));

it("K08 catches carrying an outage count into a successful later turn", async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const { target, deliveryId } = yield* startHeld(rig, runner);
  success(yield* call(ownerCredential, "release", { agentId: target.agentId }));
  yield* eventually(deliveryRow(deliveryId), (row) => row?.status === "sent");
  yield* accept(runner, target, deliveryId);
  yield* endTurn(runner, target);
  expect(capacityCount(yield* snapshot, target.agentId)).toBe(0);
  const next = yield* send(runner, target, "New outage after success.");
  yield* hold(runner, target, next);
  expect(capacityCount(yield* snapshot, target.agentId)).toBe(1);
})));

it("K09 catches dispatching a withdrawn and replaced piece wake through an open queue hold", async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const { target, deliveryId } = yield* startHeld(rig, runner);
  yield* appendSetup([
    eventOf({ _tag: "DeliveryWithdrawn", agentId: target.agentId, deliveryId, reason: "wake replaced" }),
    eventOf({ _tag: "DeliveryQueued", delivery: { id: "replacement", target: target.agentId, sender: { _tag: "piece", namespace: "board" }, source: { _tag: "piece", namespace: "board", id: "wake-2" }, content: { _tag: "prompt", text: "Replacement wake data." } } }),
  ]);
  yield* dispatchQueued(target.agentId);
  yield* pause(40);
  expect((yield* deliveryRow("replacement"))?.status).toBe("queued");
  expect(promptsTo(runner, target)).toHaveLength(1);
})));

it("K10 catches release failing to retry the original front delivery exactly once", async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const { target, deliveryId } = yield* startHeld(rig, runner);
  success(yield* call(ownerCredential, "prompt", { agentId: target.agentId, text: "Later work." }));
  const before = yield* headSequence;
  success(yield* call(ownerCredential, "release", { agentId: target.agentId }));
  yield* eventually(Effect.sync(() => promptsTo(runner, target)), (rows) => rows.length === 2);
  yield* pause(40);
  expect(promptsTo(runner, target).map((row) => row.input.delivery.id)).toEqual([deliveryId, deliveryId]);
  expect(eventsNamed(yield* logAfter(before), "DeliveryReleased")).toEqual([expect.objectContaining({ agentId: target.agentId })]);
})));

for (const accepted of [false, true]) it(`K11 ${accepted ? "carry-on" : "unaccepted"}: catches restart leaving a held agent working or dispatching before release`, async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const target = yield* spawn(rig, runner);
  const deliveryId = yield* send(runner, target, "Work before restart.");
  if (accepted) yield* accept(runner, target, deliveryId);
  yield* hold(runner, target, deliveryId);
  return { target, deliveryId };
}), () => true, { afterClose: (rig, old) => Effect.gen(function* () {
  const runner = yield* makeFakeRunner();
  yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* recover;
    expect((yield* agentRow(old.target.agentId))?.state._tag).toBe("idle");
    expect(capacityCount(yield* snapshot, old.target.agentId)).toBe(1);
    yield* dispatchQueued(old.target.agentId, { recovered: true });
    expect(promptsTo(runner, old.target)).toHaveLength(0);
    const carries = Object.values((yield* snapshot).deliveries).filter((row) => row.target === old.target.agentId && row.content._tag === "carry-on");
    expect(carries).toHaveLength(accepted ? 1 : 0);
    expect((yield* deliveryRow(old.deliveryId))?.status).toBe(accepted ? "accepted" : "queued");
    success(yield* call(ownerCredential, "release", { agentId: old.target.agentId }));
    const calls = yield* eventually(Effect.sync(() => promptsTo(runner, old.target)), (rows) => rows.length === 1);
    expect(calls.map((row) => row.input.delivery.id)).toEqual([accepted ? carries[0]!.id : old.deliveryId]);
  }), { capacityHoldCondition: () => true });
}) }));

it("K12 catches an account sign-in return sending a held queue or leaving it working without a send", async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const { target, deliveryId } = yield* startHeld(rig, runner);
  const other = yield* spawn(rig, runner);
  const otherDelivery = yield* send(runner, other, "Discover sign-out on the same account.");
  yield* notice(runner, other, { _tag: "promptReply", deliveryId: otherDelivery, outcome: { _tag: "pause", reason: "signed-out", error: "Authentication required" } });
  yield* eventually(agentRow(target.agentId), (row) => row?.state._tag === "paused");
  success(yield* call(ownerCredential, "accounts mark-available", { accountId: "primary" }));
  expect((yield* eventually(agentRow(target.agentId), (row) => row?.state._tag === "idle"))?.state._tag).toBe("idle");
  expect((yield* deliveryRow(deliveryId))?.status).toBe("queued");
  expect(promptsTo(runner, target)).toHaveLength(1);
  success(yield* call(ownerCredential, "release", { agentId: target.agentId }));
  expect((yield* eventually(Effect.sync(() => promptsTo(runner, target)), (rows) => rows.length === 2))).toHaveLength(2);
})));

for (const [name, condition] of [
  ["throws", () => { throw new Error("Do not expose provider diagnostics."); }],
  ["object", () => ({ hold: true })], ["string", () => "yes"], ["undefined", () => undefined], ["false", () => false],
] as const) it(`K13 ${name}: catches a non-true policy result opening a hold or losing the capacity return`, async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const target = yield* spawn(rig, runner);
  const deliveryId = yield* send(runner, target, "Fail closed policy.");
  const before = yield* headSequence;
  yield* capacityReply(runner, target, deliveryId);
  const rows = yield* eventually(logAfter(before), (rows) => eventsNamed(rows, "DeliveryReturned").length > 0);
  expect(eventsNamed(rows, "DeliveryReturned")).toEqual([expect.objectContaining({ deliveryId, cause: "capacity" })]);
  expect(eventsNamed(rows, "DeliveryHeld")).toEqual([]);
  expect(JSON.stringify(rows)).not.toContain("Do not expose provider diagnostics.");
}), condition));

it("K15 catches a later usage error preserving the previous capacity outage or losing the normal pause", async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const { target, deliveryId } = yield* startHeld(rig, runner);
  success(yield* call(ownerCredential, "release", { agentId: target.agentId }));
  yield* eventually(deliveryRow(deliveryId), (row) => row?.status === "sent");
  yield* notice(runner, target, { _tag: "promptReply", deliveryId, outcome: { _tag: "pause", reason: "out-of-usage", error: "You've hit your limit", resetAt: 1_900_000_000_000 } });
  expect((yield* eventually(agentRow(target.agentId), (row) => row?.state._tag === "paused"))?.state).toMatchObject({ _tag: "paused", reason: "limit", midTurn: false });
  expect(capacityCount(yield* snapshot, target.agentId)).toBe(0);
})));

it("K16 catches a held wake withdrawal after reload writing a spurious state change or roles event", async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const { target, deliveryId } = yield* startHeld(rig, runner);
  yield* appendSetup(reloadedEvents(yield* snapshot, target.agentId, { session: { _tag: "acp", sessionId: "reload-held" }, protocolVersion: 2, reloadable: true }, false, "Continue."));
  const batch = withWaitChecks(yield* snapshot, [eventOf({ _tag: "DeliveryWithdrawn", agentId: target.agentId, deliveryId, reason: "wake withdrawn" })]);
  expect(batch.map((event) => event._tag)).toEqual(["DeliveryWithdrawn"]);
  yield* appendSetup(batch);
  expect((yield* agentRow(target.agentId))?.state._tag).toBe("idle");
})));

it("K17 catches settling an empty hold, sending later work through it, or dispatching anything when the empty hold is released", async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const parent = yield* spawn(rig, runner);
  const { target, deliveryId } = yield* startHeld(rig, runner, parent);
  const waiting = yield* openBlockingWait(parent, target);
  yield* appendSetup(withWaitChecks(yield* snapshot, [eventOf({ _tag: "DeliveryWithdrawn", agentId: target.agentId, deliveryId, reason: "last wake withdrawn" })]));
  expect(settled(yield* snapshot, target.agentId)).toBe(false);
  expect((yield* waitRow(String(waiting.waitId)))?.status).toBe("open");
  const before = yield* headSequence;
  success(yield* call(ownerCredential, "release", { agentId: target.agentId }));
  expect((yield* eventually(waitRow(String(waiting.waitId)), (row) => row?.status === "satisfied"))?.status).toBe("satisfied");
  expect(settled(yield* snapshot, target.agentId)).toBe(true);
  expect(success(yield* Fiber.join(waiting.fiber))).toMatchObject({ outcome: "satisfied", members: [{ agentId: target.agentId, reason: "settled" }] });
  expect(eventsNamed(yield* logAfter(before), "DeliverySent").filter((event) => event.agentId === target.agentId)).toEqual([]);
  expect(promptsTo(runner, target)).toHaveLength(1);
})));

it("K18 catches stopping an asker closing the target's hold, or release retrying a cancelled request instead of the next delivery", async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const holder = yield* spawn(rig, runner);
  const asker = yield* spawn(rig, runner, holder);
  const asked = success(yield* call(agentCredential(asker.token), "ask", { text: "Which file should I change?" }));
  const request = (yield* snapshot).questions[String(asked.questionId)]!;
  const deliveryId = request.deliveryId;
  expect((yield* eventually(deliveryRow(deliveryId), (row) => row?.status === "sent"))?.status).toBe("sent");
  yield* hold(runner, holder, deliveryId);
  const next = success(yield* call(ownerCredential, "prompt", { agentId: holder.agentId, text: "Unrelated later work." }));
  success(yield* call(ownerCredential, "stop", { agentId: asker.agentId }));
  expect((yield* deliveryRow(deliveryId))?.status).toBe("withdrawn");
  expect(promptsTo(runner, holder)).toHaveLength(1);
  success(yield* call(ownerCredential, "release", { agentId: holder.agentId }));
  expect((yield* eventually(Effect.sync(() => promptsTo(runner, holder).map((row) => row.input.delivery.id)), (rows) => rows.length === 2))).toEqual([deliveryId, next.deliveryId]);
})));

it("K19 catches a missing hold flag for owner and service snapshots or leaking it into an agent snapshot", async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const { target } = yield* startHeld(rig, runner);
  for (const caller of [{ _tag: "owner" }, { _tag: "service", service: "roles.sheepdog" }] as const) {
    const reply = yield* clientSnapshot(caller);
    expect(reply.agents.find((row) => row.agentId === target.agentId)).toHaveProperty("capacityHeld", true);
  }
  const agent = yield* clientSnapshot({ _tag: "agent", agentId: target.agentId });
  for (const row of agent.agents) expect(row).not.toHaveProperty("capacityHeld");
  success(yield* call(ownerCredential, "release", { agentId: target.agentId }));
  expect((yield* clientSnapshot({ _tag: "owner" })).agents.find((row) => row.agentId === target.agentId)).toHaveProperty("capacityHeld", false);
})));

for (const cause of ["stop", "crash"] as const) it(`K20 ${cause}: catches a terminal target retaining its hold or replay resurrecting it`, async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const { target, deliveryId } = yield* startHeld(rig, runner);
  if (cause === "stop") success(yield* call(ownerCredential, "stop", { agentId: target.agentId }));
  else yield* crash(runner, target);
  expect((yield* deliveryRow(deliveryId))?.status).not.toBe("queued");
  expect((yield* clientSnapshot({ _tag: "owner" })).agents.find((row) => row.agentId === target.agentId)).toHaveProperty("capacityHeld", false);
  expect((yield* call(ownerCredential, "release", { agentId: target.agentId }))._tag).toBe("Failure");
})));

it("K21 catches a later ordinary error retaining the capacity outage count or adding a capacity cause", async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const { target, deliveryId } = yield* startHeld(rig, runner);
  success(yield* call(ownerCredential, "release", { agentId: target.agentId }));
  yield* eventually(deliveryRow(deliveryId), (row) => row?.status === "sent");
  const before = yield* headSequence;
  yield* notice(runner, target, { _tag: "promptReply", deliveryId, outcome: { _tag: "error", error: "file not found" } });
  const rows = yield* eventually(logAfter(before), (rows) => eventsNamed(rows, "DeliveryReturned").length > 0);
  expect(eventsNamed(rows, "DeliveryReturned")).toHaveLength(1);
  expect(eventsNamed(rows, "DeliveryReturned")[0]).not.toHaveProperty("cause");
  expect(capacityCount(yield* snapshot, target.agentId)).toBe(0);
  const next = yield* send(runner, target, "New outage.");
  yield* hold(runner, target, next);
  expect(capacityCount(yield* snapshot, target.agentId)).toBe(1);
})));

it("K22 catches the capacity condition receiving another target or a view older than the current turn's accepted delivery", async () => {
  const observed: Array<{ id: string; status: string | undefined; sequence: number }> = [];
  let original = "";
  await runCapacity((rig, runner) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const target = yield* spawn(rig, runner);
    original = yield* send(runner, target, "Observe this same-transaction state.");
    yield* accept(runner, target, original);
    const before = yield* headSequence;
    yield* hold(runner, target, original);
    expect(observed).toEqual([{ id: target.agentId, status: "accepted", sequence: before }]);
  }), (id, view) => { observed.push({ id, status: view.deliveries[original]?.status, sequence: view.sequence }); return true; });
});

it("K23 catches duplicate terminal capacity replies incrementing the count or creating a second carry-on", async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const target = yield* spawn(rig, runner);
  const deliveryId = yield* send(runner, target, "Accept once.");
  yield* accept(runner, target, deliveryId);
  yield* hold(runner, target, deliveryId);
  const before = yield* headSequence;
  yield* capacityReply(runner, target, deliveryId);
  yield* pause(50);
  expect(eventsNamed(yield* logAfter(before), "DeliveryHeld")).toEqual([]);
  expect(capacityCount(yield* snapshot, target.agentId)).toBe(1);
  expect(Object.values((yield* snapshot).deliveries).filter((row) => row.target === target.agentId && row.content._tag === "carry-on")).toHaveLength(1);
})));

it("K24 catches a later delivery bypassing a hold whose original queue has become empty", async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const { target, deliveryId } = yield* startHeld(rig, runner);
  yield* appendSetup(withWaitChecks(yield* snapshot, [eventOf({ _tag: "DeliveryWithdrawn", agentId: target.agentId, deliveryId, reason: "last delivery withdrawn" })]));
  const later = success(yield* call(ownerCredential, "prompt", { agentId: target.agentId, text: "Work arriving during an empty hold." }));
  yield* dispatchQueued(target.agentId);
  expect((yield* deliveryRow(String(later.deliveryId)))?.status).toBe("queued");
  expect(promptsTo(runner, target)).toHaveLength(1);
  success(yield* call(ownerCredential, "release", { agentId: target.agentId }));
  expect((yield* eventually(Effect.sync(() => promptsTo(runner, target).map((row) => row.input.delivery.id)), (rows) => rows.length === 2))).toEqual([deliveryId, later.deliveryId]);
})));

it("K16 after release: catches withdrawing a reloaded wake without idling its target in the withdrawal batch", async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const { target, deliveryId } = yield* startHeld(rig, runner);
  // Exercise the reload and withdrawal planners on their transaction view;
  // automatic dispatch cannot race this projected complete-state boundary.
  const released = project(yield* snapshot, [eventOf({ _tag: "DeliveryReleased", agentId: target.agentId }), eventOf({ _tag: "AgentInterrupted", agentId: target.agentId, previous: "idle" })]);
  const loaded = project(released, reloadedEvents(released, target.agentId, { session: { _tag: "acp", sessionId: "reload-after-release" }, protocolVersion: 2, reloadable: true }, false, "Continue."));
  expect(loaded.agents[target.agentId]?.state._tag).toBe("working");
  const batch = withWaitChecks(loaded, [eventOf({ _tag: "DeliveryWithdrawn", agentId: target.agentId, deliveryId, reason: "wake withdrawn after release" })]);
  expect(batch.map((event) => event._tag)).toEqual(["DeliveryWithdrawn", "StateChanged"]);
  expect(batch[1]).toEqual({ _tag: "StateChanged", agentId: target.agentId, state: { _tag: "idle" } });
})));

it("K25 catches a holder's release or a carry-on starting a new count within the same capacity outage", async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const parent = yield* spawn(rig, runner);
  const target = yield* spawn(rig, runner, parent);
  const original = yield* send(runner, target, "Accepted work.");
  yield* accept(runner, target, original);
  yield* hold(runner, target, original);
  expect(capacityCount(yield* snapshot, target.agentId)).toBe(1);
  success(yield* call(agentCredential(parent.token), "release", { agentId: target.agentId }));
  const carry = Object.values((yield* snapshot).deliveries).find((row) => row.target === target.agentId && row.content._tag === "carry-on")!;
  expect((yield* eventually(deliveryRow(carry.id), (row) => row?.status === "sent"))?.status).toBe("sent");
  yield* hold(runner, target, carry.id);
  expect(capacityCount(yield* snapshot, target.agentId)).toBe(2);
  expect((yield* deliveryRow(original))?.status).toBe("accepted");
})));

it("K13 logging: catches a throwing capacity policy exposing its message or provider text in runtime logs", async () => {
  const logLines: string[] = [];
  await runCapacity((rig, runner) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const target = yield* spawn(rig, runner);
    const deliveryId = yield* send(runner, target, "Ordinary work.");
    const before = yield* headSequence;
    yield* notice(runner, target, { _tag: "promptReply", deliveryId, outcome: { _tag: "capacity", error: "capacity-provider-diagnostic-canary" } });
    const rows = yield* eventually(logAfter(before), (rows) => eventsNamed(rows, "DeliveryReturned").length > 0);
    expect(eventsNamed(rows, "DeliveryReturned")).toEqual([expect.objectContaining({ deliveryId, cause: "capacity" })]);
    expect(logLines.length, "a failed policy must emit a content-free diagnostic").toBeGreaterThan(0);
    expect(logLines.join("\n")).not.toMatch(/capacity-policy-message-canary|capacity-provider-diagnostic-canary/);
  }), () => { throw new TypeError("capacity-policy-message-canary"); }, { logLines });
});
