import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { holdUnsettled, requestHeld, type HoldCondition } from "@lgcode/contracts";
import { holdsIncoming, holdsUnsettled } from "@lgcode/contracts/board/conditions";
import type { BoardView } from "@lgcode/contracts/board/view";
import * as Effect from "effect/Effect";
import { expect } from "vitest";

import { engineLists } from "../../src/pieces/lists.ts";
import { withWaitChecks } from "../../src/routing/waits.ts";
import { appendSetup, call, eventOf, ownerCredential, success } from "../support/handlerRig.ts";
import { close, read, resolve } from "./fixtures.ts";
import { agent, appendDelivery, boardState, change, postAs, queued, snapshot } from "./wakeFixtures.ts";
import { acceptWake, catchUp, end, failWake, it, pendingWake, reactorRig, waitOpened } from "./reactorFixtures.ts";

const { run, withoutBoard } = reactorRig(() => registerRebuildCheck());
const waitEvents = (events: ReturnType<typeof withWaitChecks>) => events.filter((event) => event._tag.startsWith("Wait"));

it.live("4.6 registration: the shared and engine tables hold an idle author with an open question", () => run((c) => Effect.gen(function* () {
  yield* postAs(c.worker!, { to: [agent("other")] });
  const state = yield* snapshot;
  const board = state.board as BoardView;
  expect(holdsUnsettled("worker", board, state.deliveries)).toBe(true);
  expect((holdUnsettled.board as HoldCondition)(state, "worker", board)).toBe(true);
  expect(engineLists.holdUnsettled.board(state, "worker", board)).toBe(true);
  expect(waitEvents(withWaitChecks(state, [waitOpened()]))).toEqual([waitOpened()]);
})));

for (const state of ["paused", "crashed"] as const) {
  it.live(`4.6 control: a ${state} author still resolves the engine wait with ${state}`, () => run((c) => Effect.gen(function* () {
    // The author wrote this while alive, before entering the control state.
    yield* postAs(c.worker!, { to: [agent("other")] });
    yield* change(state === "crashed"
      ? { _tag: "AgentCrashed", agentId: "worker", exitCode: 1, signal: null, stderr: "Fixture crash." }
      : { _tag: "StateChanged", agentId: "worker", state: { _tag: "paused", reason: "limit", midTurn: false } });
    const events = withWaitChecks(yield* snapshot, [waitOpened()]);
    expect(events).toContainEqual(expect.objectContaining({ _tag: "WaitSatisfied", members: [{ agentId: "worker", reason: state }] }));
  })));
}

it.live("4.6 an owed completion holds an idle author before a wake has been queued", () => run((c) => Effect.gen(function* () {
  const id = yield* postAs(c.worker!, { to: [agent("other")] });
  yield* appendSetup([close(id, { closer: { _tag: "owner" }, outcome: "withdrawn" })]);
  const state = yield* snapshot;
  expect(engineLists.holdUnsettled.board(state, "worker", state.board)).toBe(true);
  expect(withWaitChecks(state, [waitOpened()]).some((event) => event._tag === "WaitSatisfied")).toBe(false);
})));

for (const state of ["returned", "withdrawn"] as const) {
  it.live(`4.6 the ${state}-to-requeue gap never reports an unread addressee settled`, () => run((c) => Effect.gen(function* () {
    yield* postAs(c.lead!);
    const delivery = yield* pendingWake();
    if (state === "returned") { yield* appendDelivery("DeliverySent", delivery.id, "worker"); yield* failWake(delivery.id); }
    else yield* change({ _tag: "DeliveryWithdrawn", agentId: "worker", deliveryId: delivery.id, reason: "send-time reach check" });
    const before = yield* snapshot;
    expect(holdsUnsettled("worker", before.board as BoardView, before.deliveries)).toBe(true);
    const events = withWaitChecks(before, [waitOpened()]);
    expect(events.some((event) => event._tag === "WaitSatisfied")).toBe(false);
    yield* catchUp;
    expect(yield* queued("worker")).toHaveLength(1);
  })));
}

for (const takenBy of ["accept", "read", "acknowledge"] as const) for (const ending of ["turn", "error"] as const) {
  it.live(`4.6 ${takenBy}/${ending}: unsettled through reminder and no-answer debt, then only the asker stays held`, () => run((c) => Effect.gen(function* () {
    const id = yield* postAs(c.lead!, { to: [agent("worker"), agent("other")] });
    const first = yield* pendingWake();
    if (takenBy === "read") yield* appendSetup([read([id])]);
    if (takenBy === "acknowledge") success(yield* call(c.worker!, "board.acknowledge", { postId: id }));
    // Read and acknowledgement both take the post. Use the real fold of the
    // read mark here; board.read's page handler belongs to unit b4.
    if (takenBy === "acknowledge") {
      yield* change({ _tag: "TurnEnded", agentId: "worker", compact: false });
    } else {
      yield* acceptWake(first.id);
      if (ending === "error") yield* failWake(first.id); else yield* end();
    }
    const state = yield* snapshot;
    expect(holdsUnsettled("worker", state.board as BoardView, state.deliveries)).toBe(true);
    expect(withWaitChecks(state, [waitOpened()]).some((event) => event._tag === "WaitSatisfied")).toBe(false);
    yield* catchUp;
    const reminder = yield* pendingWake();
    yield* acceptWake(reminder.id);
    if (ending === "error") yield* failWake(reminder.id); else yield* end();
    const owing = yield* snapshot;
    expect(withWaitChecks(owing, [waitOpened()]).some((event) => event._tag === "WaitSatisfied")).toBe(false);
    yield* catchUp;
    const resolved = yield* snapshot;
    expect((resolved.board as BoardView).posts[id]?.dispositions.worker).toBe("no-answer");
    expect(holdsUnsettled("worker", resolved.board as BoardView, resolved.deliveries)).toBe(false);
    expect(holdsUnsettled("lead", resolved.board as BoardView, resolved.deliveries)).toBe(true);
    expect(withWaitChecks(resolved, [waitOpened()])).toContainEqual(expect.objectContaining({ _tag: "WaitSatisfied", members: [{ agentId: "worker", reason: "settled" }] }));
  })));
}

for (const when of ["before", "after"] as const) {
  it.live(`4.7 no deadlock: a question ${when} opening a blocking wait cancels it with request held`, () => run((c) => Effect.gen(function* () {
    // worker is busy, so the wait cannot end for an unrelated settled reason.
    yield* change({ _tag: "StateChanged", agentId: "worker", state: { _tag: "working" } });
    if (when === "before") yield* postAs(c.worker!, { to: [agent("lead")] });
    yield* appendSetup(withWaitChecks(yield* snapshot, [waitOpened(["worker"], true)]));
    if (when === "after") yield* postAs(c.worker!, { to: [agent("lead")] });
    const state = yield* snapshot;
    expect(state.waits["board-wait"]).toMatchObject({ status: "cancelled", reason: "request held" });
    expect((requestHeld.board as HoldCondition)(state, "lead", state.board)).toBe(true);
    expect(engineLists.requestHeld.board(state, "lead", state.board)).toBe(true);
  })));
}

for (const disposition of ["no-answer", "removed", "gone", "replied", "undeliverable"] as const) {
  it.live(`4.7 incoming ${disposition}: only no-answer continues cancelling a blocking wait`, () => run((c) => Effect.gen(function* () {
    yield* change({ _tag: "StateChanged", agentId: "worker", state: { _tag: "working" } });
    const id = yield* postAs(c.worker!, { to: [agent("lead"), agent("other")] });
    yield* appendSetup([resolve(id, disposition, { addressee: agent("lead") })]);
    const state = yield* snapshot;
    expect(holdsIncoming("lead", state.board as BoardView)).toBe(disposition === "no-answer");
    expect(engineLists.requestHeld.board(state, "lead", state.board)).toBe(disposition === "no-answer");
    const cancelled = withWaitChecks(state, [waitOpened(["worker"], true)]).filter((event) => event._tag === "WaitCancelled");
    expect(cancelled).toEqual(disposition === "no-answer" ? [expect.objectContaining({ reason: "request held" })] : []);
  })));
}

it.live("4.8 no board state: neither registered condition changes ordinary settled or blocking waits", () => withoutBoard(Effect.gen(function* () {
  const state = yield* snapshot;
  // The log has no board event, rather than just an empty post list.
  expect(Object.keys((state.board as BoardView).posts)).toEqual([]);
  expect(engineLists.holdUnsettled.board(state, "worker", state.board)).toBe(false);
  expect(engineLists.requestHeld.board(state, "lead", state.board)).toBe(false);
  const events = withWaitChecks(state, [waitOpened(["worker"], true)]);
  expect(events).toContainEqual(expect.objectContaining({ _tag: "WaitSatisfied", members: [{ agentId: "worker", reason: "settled" }] }));
  expect(events.some((event) => event._tag === "WaitCancelled")).toBe(false);
})));
