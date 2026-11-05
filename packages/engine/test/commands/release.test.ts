import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { engineLists } from "../../src/pieces/lists.ts";
import { executeService } from "../../src/commands/services.ts";
import { notice, promptsTo, spawn } from "../support/deliveryRig.ts";
import { eventsNamed, runCapacity, startHeld } from "../support/capacityRig.ts";
import { agentCredential, call, freshRequest, headSequence, logAfter, ownerCredential, success } from "../support/handlerRig.ts";
import { eventually, pause } from "../support/routingRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

it("RL01 catches owner release failing to commit exactly once before dispatch, or a retry releasing twice", async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const { target, deliveryId } = yield* startHeld(rig, runner);
  const before = yield* headSequence;
  const requestId = freshRequest();
  const payload = { requestId, agentId: target.agentId };
  const first = success(yield* call(ownerCredential, "release", payload));
  expect(success(yield* call(ownerCredential, "release", payload))).toEqual(first);
  yield* eventually(Effect.sync(() => promptsTo(runner, target)), (rows) => rows.length === 2);
  const rows = yield* logAfter(before);
  const released = rows.filter((row) => row.event._tag === "DeliveryReleased" as string);
  const sent = rows.filter((row) => row.event._tag === "DeliverySent" && row.event.deliveryId === deliveryId);
  expect(released).toHaveLength(1); expect(sent).toHaveLength(1);
  expect(released[0]!.sequence).toBeLessThan(sent[0]!.sequence);
  expect(released[0]!.caller).toEqual({ _tag: "owner" });
  expect(promptsTo(runner, target)).toHaveLength(2);
})));

it("RL02 catches the effective available holder being refused, or a paused parent being allowed instead of its holder", async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const grandparent = yield* spawn(rig, runner);
  const parent = yield* spawn(rig, runner, grandparent);
  const first = yield* startHeld(rig, runner, parent);
  success(yield* call(agentCredential(parent.token), "release", { agentId: first.target.agentId }));
  expect((yield* eventually(Effect.sync(() => promptsTo(runner, first.target)), (rows) => rows.length === 2))).toHaveLength(2);
  const second = yield* startHeld(rig, runner, parent);
  // Pausing a parent for usage moves management to its next available ancestor.
  const work = success(yield* call(ownerCredential, "prompt", { agentId: parent.agentId, text: "Parent work." }));
  yield* eventually(Effect.sync(() => promptsTo(runner, parent)), (rows) => rows.length > 0);
  yield* notice(runner, parent, { _tag: "promptReply", deliveryId: String(work.deliveryId), outcome: { _tag: "pause", reason: "out-of-usage", error: "usage", resetAt: 1_900_000_000_000 } });
  yield* pause(40);
  expect((yield* call(agentCredential(parent.token), "release", { agentId: second.target.agentId }))._tag).toBe("Failure");
  success(yield* call(agentCredential(grandparent.token), "release", { agentId: second.target.agentId }));
  expect((yield* eventually(Effect.sync(() => promptsTo(runner, second.target)), (rows) => rows.length === 2))).toHaveLength(2);
})));

it("RL03 catches refusing an authorized in-process service or permitting an unlisted service command", async () => {
  const lists = { ...engineLists, services: { ...engineLists.services, "client.capacity-test": ["release"], "client.no-release": [] } };
  await runCapacity((rig, runner) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const { target } = yield* startHeld(rig, runner);
    const payload = { requestId: freshRequest(), agentId: target.agentId };
    expect((yield* executeService({ _tag: "service", service: "client.no-release" }, "release", payload, lists).pipe(Effect.result))._tag).toBe("Failure");
    const before = yield* headSequence;
    const allowed = yield* executeService({ _tag: "service", service: "client.capacity-test" }, "release", payload, lists).pipe(Effect.result);
    expect(allowed._tag).toBe("Success");
    expect(eventsNamed(yield* logAfter(before), "DeliveryReleased")).toHaveLength(1);
    expect((yield* eventually(Effect.sync(() => promptsTo(runner, target)), (rows) => rows.length === 2))).toHaveLength(2);
  }), () => true, { lists });
});

for (const [id, relation] of [["RL04", "sibling"], ["RL05", "child"], ["RL06", "unrelated"]] as const) {
  it(`${id} catches a ${relation} releasing another agent's hold`, async () => runCapacity((rig, runner) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const parent = yield* spawn(rig, runner);
    const { target } = yield* startHeld(rig, runner, parent);
    const caller = yield* spawn(rig, runner, relation === "sibling" ? parent : relation === "child" ? target : undefined);
    const before = yield* headSequence;
    expect((yield* call(agentCredential(caller.token), "release", { agentId: target.agentId }))._tag).toBe("Failure");
    yield* pause(40);
    expect(eventsNamed(yield* logAfter(before), "DeliveryReleased")).toEqual([]);
    expect(promptsTo(runner, target)).toHaveLength(1);
    // Positive control: refusal did not discard or consume the hold.
    success(yield* call(agentCredential(parent.token), "release", { agentId: target.agentId }));
    expect((yield* eventually(Effect.sync(() => promptsTo(runner, target)), (rows) => rows.length === 2))).toHaveLength(2);
  })));
}

it("RL07 catches releasing an agent with no hold, or an unknown id, producing an event or a send", async () => runCapacity((rig, runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const target = yield* spawn(rig, runner);
  const { target: held } = yield* startHeld(rig, runner);
  success(yield* call(ownerCredential, "release", { agentId: held.agentId }));
  const before = yield* headSequence;
  for (const agentId of [target.agentId, held.agentId, "missing-agent"]) {
    expect((yield* call(ownerCredential, "release", { agentId }))._tag).toBe("Failure");
  }
  expect(eventsNamed(yield* logAfter(before), "DeliveryReleased")).toEqual([]);
  expect(promptsTo(runner, target)).toEqual([]);
})));
