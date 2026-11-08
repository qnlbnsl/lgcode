import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { isUnread } from "../../src/board/wake.ts";
import { lifecycleBatch } from "../../src/board/reactor.ts";
import { writePieceBatch } from "../../src/commands/pieceBatch.ts";
import { dispatchQueued } from "../../src/routing/deliveries.ts";
import { rebuild } from "../../src/views/rebuild.ts";
import { agentIdOf, call, headSequence, logAfter, makeRig, readLog, removeRig, success, type Rig } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { agent, appendDelivery, boardState, change, deliveryText, encodedBytes, eventsOf, postAs, provideBoard, queued, seedBoard, snapshot, wakeFor } from "./wakeFixtures.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });

for (const trigger of ["close", "acknowledge", "merge"] as const) {
  it.live(`replacement preserves a read, unacknowledged question after ${trigger}, before any turn end`, () => provideBoard(rig, (runner) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const c = yield* seedBoard();
    const first = yield* postAs(c.lead!, { text: "First question." });
    const second = yield* postAs(c.lead!, { text: "Second question still needs a response." });
    const [original] = yield* queued("worker");
    expect((yield* wakeFor(original!.id)).mustReply).toEqual([first, second]);

    success(yield* call(c.worker!, "board.read", { post: second }));
    const readState = yield* snapshot;
    expect(isUnread(readState, { _tag: "agent", agentId: agentIdOf("worker") }, (yield* boardState).posts[second]!)).toBe(false);
    const taken = (yield* boardState).posts[second]!.takenAt.worker;
    expect(taken).toBeDefined();
    expect(yield* queued("worker")).toEqual([original]);
    const wait = success(yield* call(c.lead!, "wait", { members: ["worker"], mode: "all", block: false }));
    expect(wait.outcome).toBe("opened");
    const before = yield* headSequence;
    let expected: string[];
    if (trigger === "merge") {
      const third = yield* postAs(c.lead!, { text: "Third question." });
      expected = [first, second, third];
    } else {
      success(yield* call(trigger === "close" ? c.lead! : c.worker!, `board.${trigger}`, { postId: first }));
      expected = [second];
    }

    const pending = yield* queued("worker");
    expect(pending).toHaveLength(1);
    const replacement = pending[0]!;
    expect(replacement.id).not.toBe(original!.id);
    expect(yield* wakeFor(replacement.id)).toMatchObject({ carried: expected, mustReply: expected, reminders: [], completions: [] });
    const state = yield* snapshot;
    expect(state.deliveries[original!.id]?.status).toBe("withdrawn");
    expect(state.waits[wait.waitId]?.status).toBe("open");
    expect((yield* boardState).posts[second]).toMatchObject({ status: "open", acknowledged: [], dispositions: {}, takenAt: { worker: taken }, reminderAcceptedAt: {} });
    const batch = yield* logAfter(before);
    expect(eventsOf(batch, "board.AddresseeResolved")).toEqual([]);
    expect(eventsOf(batch, "WaitSatisfied")).toEqual([]);
    expect(eventsOf(yield* readLog, "TurnEnded")).toEqual([]);
    expect(success(yield* call(c.worker!, "board.status", { agentId: "worker" }))).toMatchObject({
      incomingOpen: trigger === "close" ? 1 : trigger === "acknowledge" ? 2 : 3,
      wakeQueued: true, wakeSent: false, holdsIncoming: true,
    });
    expect(yield* rebuild((yield* snapshot).sequence)).toEqual(yield* snapshot);

    const text = deliveryText(replacement);
    expect(text).toContain(second);
    expect(text).toContain("Second question still needs a response.");
    expect(text).toContain("Run board.acknowledge with this post's id when you start responding.");
    expect(encodedBytes(text)).toBeLessThanOrEqual(256 * 1024);
    yield* dispatchQueued(agentIdOf("worker"));
    expect(runner.callsOf("prompt").find((row) => row.input.delivery.id === replacement.id)?.input.delivery.content).toEqual({ _tag: "prompt", text });
  })).pipe(Effect.orDie));
}

it.live("replacement keeps completion debt alongside a read original until acceptance", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck();
  const c = yield* seedBoard();
  const completed = yield* postAs(c.worker!, { to: [agent("other")] });
  yield* postAs(c.other!, { replyTo: completed, reply: "none", to: [], text: "Finished." });
  const first = yield* postAs(c.lead!);
  const second = yield* postAs(c.lead!, { text: "Still owed." });
  success(yield* call(c.worker!, "board.read", { post: second }));
  const debt = (yield* boardState).completions[completed];
  expect(debt).toBeDefined();
  success(yield* call(c.lead!, "board.close", { postId: first }));
  const [replacement] = yield* queued("worker");
  expect(yield* wakeFor(replacement!.id)).toMatchObject({ mustReply: [second], completions: [completed], reminders: [] });
  expect((yield* wakeFor(replacement!.id)).carried).toContain(second);
  expect((yield* boardState).completions[completed]).toEqual(debt);
  expect(success(yield* call(c.worker!, "board.status", { agentId: "worker" }))).toMatchObject({ owed: 1, wakeQueued: true });
  yield* appendDelivery("DeliverySent", replacement!.id, "worker");
  yield* appendDelivery("DeliveryAccepted", replacement!.id, "worker");
  expect((yield* boardState).completions[completed]).toBeUndefined();
  expect((yield* boardState).posts[second]).toMatchObject({ status: "open", dispositions: {}, acknowledged: [] });
})).pipe(Effect.orDie));

it.live("replacement does not duplicate a read original reserved by a sent wake", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck();
  const c = yield* seedBoard();
  const first = yield* postAs(c.lead!);
  const second = yield* postAs(c.lead!, { text: "Read but not acknowledged." });
  const [sent] = yield* queued("worker");
  success(yield* call(c.worker!, "board.read", { post: second }));
  yield* appendDelivery("DeliverySent", sent!.id, "worker");
  const third = yield* postAs(c.lead!, { text: "Third question." });
  const fourth = yield* postAs(c.lead!, { text: "Fourth question." });
  const [replacement] = yield* queued("worker");
  expect((yield* snapshot).deliveries[sent!.id]?.status).toBe("sent");
  expect((yield* wakeFor(sent!.id)).mustReply).toEqual([first, second]);
  expect((yield* wakeFor(replacement!.id)).mustReply).toEqual([third, fourth]);
})).pipe(Effect.orDie));

for (const ending of [false, true]) {
  it.live(`replacement in a later reactor transaction preserves a read original after another target's cleanup, turn ended=${ending}`, () => provideBoard(rig, Effect.gen(function* () {
    yield* registerRebuildCheck();
    const c = yield* seedBoard();
    const first = yield* postAs(c.other!, { text: "Question from the departing author." });
    const second = yield* postAs(c.lead!, { text: "Read question still owed." });
    success(yield* call(c.worker!, "board.read", { post: second }));
    const [original] = yield* queued("worker");
    yield* change({ _tag: "AgentStopped", agentId: "other" });
    for (const target of ["other", "worker"]) {
      yield* writePieceBatch({ namespace: "board", kind: "reactor", sourceSequence: (state) => state.sequence,
        build: (state) => lifecycleBatch(state, agentIdOf(target)),
      });
      if (target === "other") {
        expect((yield* snapshot).deliveries[original!.id]?.status).toBe("withdrawn");
        expect(yield* queued("worker")).toEqual([]);
        if (ending) yield* change({ _tag: "TurnEnded", agentId: "worker", compact: false });
      }
    }
    expect((yield* boardState).posts[first]?.status).toBe("closed");
    const pending = yield* queued("worker");
    expect(pending).toHaveLength(1);
    expect(yield* wakeFor(pending[0]!.id)).toMatchObject(ending
      ? { carried: [], mustReply: [], reminders: [second] }
      : { carried: [second], mustReply: [second], reminders: [] });
    expect(eventsOf(yield* readLog, "TurnEnded")).toHaveLength(ending ? 1 : 0);
  })).pipe(Effect.orDie));
}

it.live("a later wake does not repeat an accepted original before an eligible turn end", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck();
  const c = yield* seedBoard();
  const first = yield* postAs(c.lead!);
  const second = yield* postAs(c.lead!);
  const [original] = yield* queued("worker");
  success(yield* call(c.worker!, "board.read", { post: second }));
  success(yield* call(c.lead!, "board.close", { postId: first }));
  const [replacement] = yield* queued("worker");
  yield* appendDelivery("DeliverySent", replacement!.id, "worker");
  yield* appendDelivery("DeliveryAccepted", replacement!.id, "worker");
  const third = yield* postAs(c.lead!);
  const [next] = yield* queued("worker");
  expect((yield* wakeFor(next!.id)).mustReply).toEqual([third]);
  expect((yield* snapshot).deliveries[original!.id]?.status).toBe("withdrawn");
  expect((yield* boardState).posts[second]).toMatchObject({ status: "open", dispositions: {}, acknowledged: [] });
})).pipe(Effect.orDie));
