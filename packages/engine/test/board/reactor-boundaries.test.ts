import * as Effect from "effect/Effect";
import { expect, vi } from "vitest";
import { engineLists } from "../../src/pieces/lists.ts";
import { appendSetup, call, headSequence, logAfter, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { event } from "./fixtures.ts";
import { agent, change, eventsOf, postAs, wakeFor } from "./wakeFixtures.ts";
import { acceptWake, catchUp, end, it, pause, pendingWake, reactorRig, startReactor, stopReactor } from "./reactorFixtures.ts";

const { run } = reactorRig(() => registerRebuildCheck());

it.live("a refused replacement cannot roll back another startup target or retry on older cleanup notifications", () => run((c) => Effect.gen(function* () {
  const taken = yield* postAs(c.lead!);
  yield* postAs(c.lead!);
  yield* postAs(c.lead!, { to: [agent("other")] });
  const other = yield* pendingWake("other");
  yield* change({ _tag: "DeliveryWithdrawn", agentId: "other", deliveryId: other.id, reason: "Fixture lost send." });
  yield* appendSetup([event({ _tag: "board.PostAcknowledged", postId: taken, addressee: agent("worker") })]);
  const reach = engineLists.reach.board;
  vi.spyOn(engineLists.reach, "board").mockImplementation((input) => input.target !== "worker" && reach(input));
  const before = yield* headSequence;
  const fiber = yield* startReactor;
  yield* pendingWake("other");
  yield* pause(150);
  const refusals = eventsOf(yield* logAfter(before), "CommandRefused").filter((row) => row.command === "board.reactor");
  expect(refusals).toHaveLength(1);
  const stable = yield* headSequence;
  yield* pause(100);
  expect(yield* headSequence).toBe(stable);
  yield* stopReactor(fiber);
})));

it.live("a later startup target's refusal names the snapshot read by its own transaction", () => run((c) => Effect.gen(function* () {
  yield* postAs(c.lead!);
  yield* postAs(c.lead!, { to: [agent("other")] });
  for (const target of ["worker", "other"]) {
    const wake = yield* pendingWake(target);
    yield* change({ _tag: "DeliveryWithdrawn", agentId: target, deliveryId: wake.id, reason: "Fixture lost send." });
  }
  const reach = engineLists.reach.board;
  vi.spyOn(engineLists.reach, "board").mockImplementation((input) => input.target !== "other" && reach(input));
  const fiber = yield* startReactor;
  yield* pendingWake("worker");
  yield* pause(150);
  const refusals = (yield* readLog).filter((row) => row.event._tag === "CommandRefused" && row.event.command === "board.reactor");
  expect(refusals).toHaveLength(1);
  expect(refusals[0]?.event).toMatchObject({ sourceSequence: refusals[0]!.sequence - 1 });
  yield* stopReactor(fiber);
})));

it.live("cleanup by another target retains an owed reminder while an engine prompt is queued", () => run((c) => Effect.gen(function* () {
  const id = yield* postAs(c.lead!);
  yield* acceptWake((yield* pendingWake()).id);
  yield* end();
  yield* catchUp;
  const extra = yield* postAs(c.lead!);
  success(yield* call(ownerCredential, "prompt", { agentId: "worker", text: "Intervening engine work." }));
  yield* appendSetup([event({ _tag: "board.PostAcknowledged", postId: extra, addressee: agent("worker") })]);
  yield* catchUp;
  expect((yield* wakeFor((yield* pendingWake()).id)).reminders).toEqual([id]);
})));
