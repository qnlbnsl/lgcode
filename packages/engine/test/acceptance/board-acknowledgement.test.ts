import { waitForAgents } from "@lgcode/client";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { dispatchQueued } from "../../src/routing/deliveries.ts";
import { compareViews } from "../../src/views/compare.ts";
import { currentIncarnation, type FakeRunner } from "../support/fakeRunner.ts";
import { boardOwnerClient } from "../support/boardWait.ts";
import { agentIdOf, call, headSequence, logAfter, makeRig, ownerCredential, removeRig, success, type Rig } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually, pause } from "../support/routingRig.ts";
import { acceptWake, catchUp, end, pendingWake } from "../board/reactorFixtures.ts";
import { agent, appendDelivery, boardState, eventsOf, postAs, provideBoard, queued, seedBoard, snapshot, wakeFor } from "../board/wakeFixtures.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });
const reply = (runner: FakeRunner, deliveryId: string, outcome: "success" | "error" | "capacity", target = "worker") => Effect.gen(function* () {
  yield* runner.subscribed;
  yield* runner.emit({ _tag: "promptReply", agentId: agentIdOf(target), incarnation: yield* currentIncarnation(target), deliveryId,
    outcome: outcome === "success" ? { _tag: "success" } : { _tag: outcome, error: "Acceptance transport outcome." } });
  const status = outcome === "capacity" ? "queued" : outcome === "error" ? "returned" : "accepted";
  expect((yield* eventually(snapshot, (state) => state.deliveries[deliveryId]?.status === status
    && (outcome === "success" || state.agents[target]?.state._tag === "idle"))).deliveries[deliveryId]?.status).toBe(status);
  if (outcome === "success") {
    yield* runner.emit({ _tag: "turnEnded", agentId: agentIdOf(target), incarnation: yield* currentIncarnation(target) });
    expect((yield* eventually(snapshot, (state) => state.agents[target]?.state._tag === "idle")).agents[target]?.state._tag).toBe("idle");
  }
});

it.live("acknowledging a real sent question never recalls that delivery", () => provideBoard(rig, (runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const c = yield* seedBoard();
  const postId = yield* postAs(c.lead!);
  const delivery = yield* pendingWake();
  yield* dispatchQueued(agentIdOf("worker"));
  expect((yield* snapshot).deliveries[delivery.id]?.status).toBe("sent");
  const before = yield* headSequence;
  success(yield* call(c.worker!, "board.acknowledge", { postId }));
  expect((yield* snapshot).deliveries[delivery.id]?.status).toBe("sent");
  expect(eventsOf(yield* logAfter(before), "DeliveryWithdrawn")).toEqual([]);
  yield* reply(runner, delivery.id, "success");
  yield* catchUp;
  expect((yield* wakeFor((yield* pendingWake()).id)).reminders).toEqual([postId]);
})).pipe(Effect.orDie));

for (const obstacle of ["returned", "held"] as const) for (const mixed of [false, true]) {
  for (const boardMode of ["any", "all"] as const) for (const waitMode of ["any", "all"] as const) {
    it.live(`PB23 actual acknowledgement: ${obstacle}, mixed=${mixed}, board=${boardMode}, waits=${waitMode}`, () => provideBoard(rig, (runner) => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const c = yield* seedBoard();
      let reminder: string | undefined;
      let completion: string | undefined;
      let noAnswer: string | undefined;
      if (mixed) {
        reminder = yield* postAs(ownerCredential);
        yield* acceptWake((yield* pendingWake()).id); yield* end(); yield* catchUp;
        completion = yield* postAs(c.worker!, { to: [agent("other")] });
        yield* postAs(c.other!, { replyTo: completion, reply: "none", to: [] });
        noAnswer = yield* postAs(c.worker!, { to: [agent("fourth")] });
        yield* acceptWake((yield* pendingWake("fourth")).id, "fourth"); yield* end("fourth"); yield* catchUp;
        yield* acceptWake((yield* pendingWake("fourth")).id, "fourth"); yield* end("fourth"); yield* catchUp;
      }
      const question = yield* postAs(c.lead!, { reply: boardMode, to: [agent("worker"), agent("other")] });
      const original = yield* pendingWake();
      let heldId: string | undefined;
      if (obstacle === "returned") {
        yield* appendDelivery("DeliverySent", original.id, "worker");
        yield* reply(runner, original.id, "error");
        expect((yield* boardState).posts[question]?.takenAt.worker).toBeUndefined();
        yield* catchUp;
      } else {
        heldId = success(yield* call(ownerCredential, "prompt", { agentId: "worker", text: "Independent held engine work." })).deliveryId;
        yield* appendDelivery("DeliverySent", heldId!, "worker");
        yield* reply(runner, heldId!, "capacity");
        expect((yield* snapshot).agents.worker?.capacityHeld).toBe(true);
      }
      const waitingOther = success(yield* call(ownerCredential, "prompt", { agentId: "other", text: "Independent second member turn." })).deliveryId as string;
      yield* appendDelivery("DeliverySent", waitingOther, "other");
      const waitId = String(success(yield* call(c.lead!, "wait", { members: ["worker", "other"], mode: waitMode, block: false })).waitId);
      const client = yield* boardOwnerClient(rig);
      let complete = false;
      const ownerWait = yield* waitForAgents(client, { members: ["worker", "other"], mode: waitMode }).pipe(
        Effect.tap(() => Effect.sync(() => { complete = true; })), Effect.forkScoped);
      const beforeAck = yield* headSequence;
      const oldWake = yield* pendingWake();
      success(yield* call(c.worker!, "board.acknowledge", { postId: question }));
      const state = yield* snapshot;
      expect((state.board as any).posts[question].acknowledged).toContainEqual(agent("worker"));
      expect(state.deliveries[oldWake.id]?.status).toBe("withdrawn");
      const retained = yield* queued("worker");
      expect(retained).toHaveLength(mixed ? 1 : 0);
      if (mixed) expect(yield* wakeFor(retained[0]!.id)).toMatchObject({ mustReply: [], reminders: [reminder], completions: [completion],
        noAnswers: [{ postId: noAnswer, addressee: agent("fourth") }] });
      const ackBatch = yield* logAfter(beforeAck);
      expect(eventsOf(ackBatch, "DeliveryReleased")).toEqual([]);
      expect(state.agents.worker?.capacityHeld === true).toBe(obstacle === "held");
      const settledByAck = !mixed && obstacle === "returned";
      expect(state.waits[waitId]?.status).toBe(settledByAck && waitMode === "any" ? "satisfied" : "open");
      yield* pause(25);
      if (!settledByAck || waitMode === "all") expect(complete).toBe(false);
      const status = success(yield* call(ownerCredential, "board.status", { agentId: "worker" }));
      expect(status).toMatchObject({ sequence: state.sequence, incomingOpen: mixed ? 2 : 1, holdsUnsettled: mixed });
      expect((yield* compareViews()).differences).toEqual([]);
      yield* postAs(c.worker!, { replyTo: question, reply: "none", to: [] });
      expect((yield* boardState).posts[question]?.status).toBe(boardMode === "any" ? "closed" : "open");
      if (mixed) {
        yield* postAs(c.worker!, { replyTo: reminder!, reply: "none", to: [] });
        success(yield* call(c.worker!, "board.close", { postId: noAnswer! }));
      }
      if (obstacle === "held") {
        yield* dispatchQueued(agentIdOf("worker"));
        expect((yield* snapshot).agents.worker?.capacityHeld).toBe(true);
        expect((yield* snapshot).waits[waitId]?.status).toBe("open");
        yield* client.release({ requestId: crypto.randomUUID(), agentId: "worker" } as never);
      }
      for (let attempt = 0; attempt < 6; attempt++) {
        const next = Object.values((yield* snapshot).deliveries).find((row) => row.target === "worker" && row.status === "queued");
        const inFlight = Object.values((yield* snapshot).deliveries).some((row) => row.target === "worker" && row.status === "sent");
        if (next === undefined && !inFlight) break;
        if (!inFlight) yield* dispatchQueued(agentIdOf("worker"));
        const sent = Object.values((yield* snapshot).deliveries).find((row) => row.target === "worker" && row.status === "sent");
        expect(sent).toBeDefined();
        yield* reply(runner, sent!.id, "success");
      }
      expect((yield* snapshot).waits[waitId]?.status).toBe(waitMode === "any" ? "satisfied" : "open");
      if (waitMode === "all") { yield* pause(25); expect(complete).toBe(false); }
      else expect(yield* Fiber.join(ownerWait).pipe(Effect.timeout(4_000))).toEqual({ outcome: "satisfied", members: [{ agentId: "worker", reason: "settled" }] });
      // The second recipient's already-sent work cannot be recalled by the
      // first reply, even when board reply=any closes the collection.
      expect((yield* snapshot).deliveries[waitingOther]?.status).toBe("sent");
      yield* postAs(c.other!, { replyTo: question, reply: "none", to: [] });
      yield* reply(runner, waitingOther, "success", "other");
      if (waitMode === "all") expect(yield* Fiber.join(ownerWait).pipe(Effect.timeout(4_000))).toEqual({ outcome: "satisfied",
        members: [{ agentId: "worker", reason: "settled" }, { agentId: "other", reason: "settled" }] });
      expect((yield* snapshot).waits[waitId]?.status).toBe("satisfied");
      expect((yield* compareViews()).differences).toEqual([]);
    }), [], { capacityHoldCondition: () => true }).pipe(Effect.orDie), 30_000);
  }
}
