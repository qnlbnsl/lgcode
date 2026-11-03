import { loadDeliveries } from "../support/routingModules.ts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import type * as Layer from "effect/Layer";
import type * as Redactor from "../../src/log/Redactor.ts";
import { makeRedactor } from "../../src/identity/redactor.ts";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { incarnationOf } from "../support/fakeRunner.ts";
import {
  agentCredential, agentRow, appendSetup, call, eventOf, headSequence, logAfter,
  makeRig, ownerCredential, readLog, removeRig, rotateToken, success, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { deliveryRow, endTurn, eventually, pause, questionRow, requestPermission, snapshot, tagged } from "../support/routingRig.ts";
import {
  accept, crash, deliveryRig, finish, notice, promptsTo, send, spawn,
} from "../support/deliveryRig.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("SHEPHRD_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });
const run = <A, E, R>(body: Parameters<typeof deliveryRig<A, E, R>>[1], redactor?: Layer.Layer<Redactor.Redactor>) =>
  deliveryRig(rig, (runner) => Effect.gen(function* () { yield* registerRebuildCheck(); return yield* body(runner); }), redactor).pipe(Effect.orDie);

it.live("D01 catches owner prompts or compacts without distinct durable ids, or sends logged before their queue entries", () => run((runner) => Effect.gen(function* () {
  const target = yield* spawn(rig, runner);
  const id = yield* send(runner, target, "Please inspect the failing build.");
  yield* finish(runner, target, id);
  const compact = success(yield* call(ownerCredential, "compact", { agentId: target.agentId })).deliveryId;
  expect(compact).toBeTypeOf("string");
  expect(compact).not.toBe(id);
  const calls = yield* eventually(Effect.sync(() => runner.callsOf("compact")), (calls) => calls.length === 1);
  expect(calls.map((call) => call.input.delivery.id)).toEqual([compact]);
  const rows = yield* readLog;
  for (const deliveryId of [id, compact]) {
    const queued = rows.find((row) => row.event._tag === "DeliveryQueued" && row.event.delivery.id === deliveryId)!;
    const sent = rows.find((row) => row.event._tag === "DeliverySent" && row.event.deliveryId === deliveryId)!;
    expect(queued.sequence).toBeLessThan(sent.sequence);
    expect((yield* deliveryRow(deliveryId))?.sender).toEqual({ _tag: "owner" });
  }
})));

it.live("D02 catches a send marked accepted before the adapter acknowledges it, or a send that leaves the agent idle", () => run((runner) => Effect.gen(function* () {
  const target = yield* spawn(rig, runner);
  const id = yield* send(runner, target, "Inspect the build.");
  expect((yield* deliveryRow(id))?.status).toBe("sent");
  expect((yield* agentRow(target.agentId))?.state._tag).toBe("working");
  expect(tagged(yield* readLog, "DeliveryAccepted")).toEqual([]);
})));

it.live("D03 catches a successful prompt reply that fails to accept, or duplicate notices that accept twice", () => run((runner) => Effect.gen(function* () {
  const target = yield* spawn(rig, runner);
  const id = yield* send(runner, target, "Inspect the build.");
  yield* notice(runner, target, { _tag: "promptReply", deliveryId: id, outcome: { _tag: "success" } });
  expect((yield* eventually(deliveryRow(id), (row) => row?.status === "accepted"))?.status).toBe("accepted");
  yield* accept(runner, target, id);
  yield* notice(runner, target, { _tag: "promptReply", deliveryId: id, outcome: { _tag: "success" } });
  yield* pause(40);
  expect(tagged(yield* readLog, "DeliveryAccepted").filter((event) => event.deliveryId === id)).toHaveLength(1);
})));

for (const kind of ["message", "plan", "tool-call", "file-change"] as const) {
  it.live(`D04 ${kind}: catches a content update after send that fails to accept its delivery`, () => run((runner) => Effect.gen(function* () {
    const target = yield* spawn(rig, runner);
    const id = yield* send(runner, target, "Inspect the build.");
    yield* notice(runner, target, { _tag: "deliveryUpdate", deliveryId: id, kind, replay: false, text: "Adapter content." });
    expect((yield* eventually(deliveryRow(id), (row) => row?.status === "accepted"))?.status).toBe("accepted");
  })));
}

for (const [kind, replay] of [["available_commands_update", false], ["message", true]] as const) {
  it.live(`D05 ${kind}, replay=${replay}: catches an unrelated or replayed update accepting a delivery`, () => run((runner) => Effect.gen(function* () {
    const target = yield* spawn(rig, runner);
    const id = yield* send(runner, target, "Inspect the build.");
    const before = yield* headSequence;
    yield* notice(runner, target, { _tag: "deliveryUpdate", deliveryId: id, kind, replay, text: "Old history or command catalogue." });
    yield* pause(60);
    expect((yield* deliveryRow(id))?.status).toBe("sent");
    expect(tagged(yield* logAfter(before), "DeliveryAccepted")).toEqual([]);
    if (replay) expect(tagged(yield* logAfter(before), "ThreadItem")).toEqual([]);
  })));
}

it.live("D06 catches a content update or successful reply accepting a delivery before it was sent", () => run((runner) => Effect.gen(function* () {
  const target = yield* spawn(rig, runner);
  yield* send(runner, target, "Keep the current turn running.");
  const queued = success(yield* call(ownerCredential, "prompt", { agentId: target.agentId, text: "Queued behind the turn." })).deliveryId;
  yield* notice(runner, target, { _tag: "deliveryUpdate", deliveryId: queued, kind: "message", replay: false, text: "Premature." });
  yield* notice(runner, target, { _tag: "promptReply", deliveryId: queued, outcome: { _tag: "success" } });
  yield* pause(60);
  expect((yield* deliveryRow(queued))?.status).toBe("queued");
  expect(promptsTo(runner, target)).toHaveLength(1);
})));

for (const reason of ["out-of-usage", "signed-out"] as const) {
  it.live(`D07 ${reason}: catches a pause error losing the delivery, retrying while paused, or requeueing behind newer messages`, () => run((runner) => Effect.gen(function* () {
    const target = yield* spawn(rig, runner);
    const first = yield* send(runner, target, "First, paused before acceptance.");
    const second = success(yield* call(ownerCredential, "prompt", { agentId: target.agentId, text: "Second." })).deliveryId;
    yield* notice(runner, target, { _tag: "promptReply", deliveryId: first, outcome: { _tag: "pause", reason, error: "Account unavailable." } });
    expect((yield* eventually(deliveryRow(first), (row) => row?.status === "queued"))?.status).toBe("queued");
    expect((yield* agentRow(target.agentId))?.state._tag).toBe("paused");
    yield* pause(60);
    expect(promptsTo(runner, target).map((call) => call.input.delivery.id)).toEqual([first]);
    expect(tagged(yield* readLog, "DeliveryReturned")).toEqual([]);
    // Account return/reload is unit 6b's entry point; 5d's explicit drain is
    // called only after that owner has committed the successful reload.
    yield* appendSetup([
      eventOf({ _tag: "AccountAvailable", accountId: "primary", cause: "owner cleared" }),
      eventOf({ _tag: "StateChanged", agentId: target.agentId, state: { _tag: "idle" } }),
    ]);
    const { dispatchQueued } = yield* loadDeliveries();
    yield* dispatchQueued(target.agentId);
    expect(promptsTo(runner, target).map((call) => call.input.delivery.id)).toEqual([first, first]);
    yield* finish(runner, target, first);
    expect((yield* eventually(deliveryRow(second), (row) => row?.status === "sent"))?.status).toBe("sent");
    expect(promptsTo(runner, target).map((call) => call.input.delivery.id)).toEqual([first, first, second]);
  })));
}

it.live("D08 catches an ordinary error retrying forever, losing the sender's error, or leaving the target working", () => run((runner) => Effect.gen(function* () {
  const sender = yield* spawn(rig, runner);
  const target = yield* spawn(rig, runner, sender);
  const id = yield* send(runner, target, "Inspect the build.", sender);
  yield* notice(runner, target, { _tag: "promptReply", deliveryId: id, outcome: { _tag: "error", error: "The model rejected this input." } });
  expect((yield* eventually(deliveryRow(id), (row) => row?.status === "returned"))?.status).toBe("returned");
  expect(tagged(yield* readLog, "DeliveryReturned")).toContainEqual(expect.objectContaining({
    deliveryId: id, sender: { _tag: "agent", agentId: sender.agentId }, reason: "The model rejected this input.",
  }));
  expect((yield* agentRow(target.agentId))?.state._tag).toBe("idle");
  yield* pause(60);
  expect(promptsTo(runner, target).filter((call) => call.input.delivery.id === id)).toHaveLength(1);
  const returned = Object.values((yield* snapshot).deliveries).filter((row) => row.target === sender.agentId);
  expect(JSON.stringify(returned)).toContain("The model rejected this input.");
})));

it.live("D09 catches queue drain sending during a turn, changing order, or sending twice after duplicate turn ends", () => run((runner) => Effect.gen(function* () {
  const target = yield* spawn(rig, runner);
  const first = yield* send(runner, target, "First.");
  const second = success(yield* call(ownerCredential, "prompt", { agentId: target.agentId, text: "Second." })).deliveryId;
  const third = success(yield* call(ownerCredential, "prompt", { agentId: target.agentId, text: "Third." })).deliveryId;
  yield* pause(40);
  expect(promptsTo(runner, target).map((call) => call.input.delivery.id)).toEqual([first]);
  yield* finish(runner, target, first);
  expect((yield* eventually(deliveryRow(second), (row) => row?.status === "sent"))?.status).toBe("sent");
  yield* finish(runner, target, second);
  expect((yield* eventually(deliveryRow(third), (row) => row?.status === "sent"))?.status).toBe("sent");
  yield* finish(runner, target, third);
  yield* runner.emit({ _tag: "turnEnded", agentId: target.agentId, incarnation: incarnationOf(target.token), deliveryId: third });
  yield* pause(40);
  expect(tagged(yield* readLog, "TurnEnded").filter((event) => event.agentId === target.agentId)).toHaveLength(3);
  const { dispatchQueued } = yield* loadDeliveries();
  yield* dispatchQueued(target.agentId);
  yield* dispatchQueued(target.agentId);
  expect(promptsTo(runner, target).map((call) => call.input.delivery.id)).toEqual([first, second, third]);
})));

for (const cause of ["stop", "crash"] as const) {
  it.live(`D10 ${cause}: catches queued deliveries swallowed instead of returned to their sender, or later sent to a dead target`, () => run((runner) => Effect.gen(function* () {
    const sender = yield* spawn(rig, runner);
    const target = yield* spawn(rig, runner, sender);
    yield* send(runner, target, "Current turn.", sender);
    const queued = success(yield* call(agentCredential(sender.token), "prompt", { agentId: target.agentId, text: "Never delivered." })).deliveryId;
    const before = yield* headSequence;
    if (cause === "stop") success(yield* call(ownerCredential, "stop", { agentId: target.agentId }));
    else yield* crash(runner, target);
    const events = yield* eventually(logAfter(before), (rows) => tagged(rows, "DeliveryReturned").some((event) => event.deliveryId === queued));
    expect(tagged(events, "DeliveryReturned")).toContainEqual(expect.objectContaining({ deliveryId: queued, sender: { _tag: "agent", agentId: sender.agentId } }));
    if (cause === "stop") {
      expect(tagged(events, "DeliveryWithdrawn")).toContainEqual(expect.objectContaining({ deliveryId: queued }));
      expect(tagged(events, "DeliveryReturned").find((event) => event.deliveryId === queued)?.reason).toBe("not delivered");
    }
    const { dispatchQueued } = yield* loadDeliveries();
    yield* dispatchQueued(target.agentId);
    expect(promptsTo(runner, target).some((call) => call.input.delivery.id === queued)).toBe(false);
  })));
}

for (const kind of ["permission", "question"] as const) {
  it.live(`D11 ${kind}: catches a failed routing delivery returned to its holder instead of the asker (issue 67)`, () => run((runner) => Effect.gen(function* () {
    const holder = yield* spawn(rig, runner);
    const asker = yield* spawn(rig, runner, holder);
    let id: string;
    if (kind === "permission") id = (yield* requestPermission(runner, asker)).row.deliveryId;
    else {
      const questionId = success(yield* call(agentCredential(asker.token), "ask", { text: "Which branch?" })).questionId;
      id = (yield* questionRow(questionId))!.deliveryId;
    }
    expect((yield* eventually(deliveryRow(id), (row) => row?.status === "sent"))?.status).toBe("sent");
    yield* notice(runner, holder, { _tag: "promptReply", deliveryId: id, outcome: { _tag: "error", error: "Delivery failed." } });
    const rows = yield* eventually(readLog, (rows) => tagged(rows, "DeliveryReturned").some((event) => event.deliveryId === id));
    expect(tagged(rows, "DeliveryReturned")).toContainEqual(expect.objectContaining({ deliveryId: id, sender: { _tag: "agent", agentId: asker.agentId } }));
    expect(Object.values((yield* snapshot).deliveries).some((row) => row.target === asker.agentId && JSON.stringify(row.content).includes("Delivery failed."))).toBe(true);
  })));
}

it.live("D12 catches a cancelled request's withdrawn delivery resurrected by queue drain", () => run((runner) => Effect.gen(function* () {
  const holder = yield* spawn(rig, runner);
  const asker = yield* spawn(rig, runner, holder);
  const current = yield* send(runner, holder, "Keep the holder busy.");
  const permission = yield* requestPermission(runner, asker);
  success(yield* call(ownerCredential, "answer", { kind: "permission", id: permission.id, optionId: "once" }));
  expect((yield* deliveryRow(permission.row.deliveryId))?.status).toBe("withdrawn");
  yield* finish(runner, holder, current);
  yield* pause(60);
  expect(promptsTo(runner, holder).some((call) => call.input.delivery.id === permission.row.deliveryId)).toBe(false);
})));

for (const tag of ["deliveryUpdate", "promptReply"] as const) {
  it.live(`D13 ${tag}: catches a stale incarnation accepting or returning the new run's delivery`, () => run((runner) => Effect.gen(function* () {
    const target = yield* spawn(rig, runner);
    const old = incarnationOf(target.token);
    yield* rotateToken(target.agentId);
    const id = yield* send(runner, target, "New incarnation.");
    const before = yield* headSequence;
    if (tag === "deliveryUpdate") yield* runner.emit({ _tag: tag, agentId: target.agentId, incarnation: old, deliveryId: id, kind: "message", replay: false, text: "Late content." });
    else yield* runner.emit({ _tag: tag, agentId: target.agentId, incarnation: old, deliveryId: id, outcome: { _tag: "error", error: "Old error." } });
    yield* pause(60);
    expect((yield* deliveryRow(id))?.status).toBe("sent");
    expect(yield* logAfter(before)).toEqual([]);
  })));
}

it.live("D14 catches a compact delivery whose turn end is hard-coded as compact=false", () => run((runner) => Effect.gen(function* () {
  const target = yield* spawn(rig, runner);
  const id = success(yield* call(ownerCredential, "compact", { agentId: target.agentId })).deliveryId;
  expect((yield* eventually(deliveryRow(id), (row) => row?.status === "sent"))?.status).toBe("sent");
  yield* accept(runner, target, id);
  const rows = yield* endTurn(runner, target);
  expect(tagged(rows, "TurnEnded")).toContainEqual({ _tag: "TurnEnded", agentId: target.agentId, compact: true });
  const ordinary = yield* send(runner, target, "Ordinary turn after compact.");
  const next = yield* finish(runner, target, ordinary);
  expect(tagged(next, "TurnEnded")).toContainEqual({ _tag: "TurnEnded", agentId: target.agentId, compact: false });
})));


it.live("D15 catches an ordinary error's secret leaking through the return event, views, or sender notification", () => {
  const secret = "delivery-error-secret-6fa0739ac124";
  return run((runner) => Effect.gen(function* () {
    const sender = yield* spawn(rig, runner);
    const target = yield* spawn(rig, runner, sender);
    const id = yield* send(runner, target, "Report a redacted failure.", sender);
    yield* notice(runner, target, { _tag: "promptReply", deliveryId: id, outcome: { _tag: "error", error: `Rejected key ${secret}.` } });
    const rows = yield* eventually(readLog, (rows) => tagged(rows, "DeliveryReturned").some((event) => event.deliveryId === id));
    const returned = tagged(rows, "DeliveryReturned").find((event) => event.deliveryId === id)!;
    expect(returned.reason).toContain("[REDACTED]");
    expect(JSON.stringify(rows)).not.toContain(secret);
    expect(JSON.stringify(yield* snapshot)).not.toContain(secret);
    const notification = Object.values((yield* snapshot).deliveries).find((row) => row.target === sender.agentId && JSON.stringify(row.content).includes("Rejected key"));
    expect(notification).toBeDefined();
    expect(JSON.stringify(notification)).toContain("[REDACTED]");
    expect(JSON.stringify(runner.callsOf("prompt").filter((call) => call.input.agentId === sender.agentId))).not.toContain(secret);
  }), makeRedactor({ secrets: () => [Redacted.make(secret)], tokenHashes: () => new Set<string>() }).layer);
});
