import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { moveHeld } from "../../src/routing/holders.ts";
import { makeFakeRunner } from "../support/fakeRunner.ts";
import {
  agentCredential, agentIdOf, call, headSequence, logAfter, makeFakeSecrets, makeRig, ownerCredential, provideRig,
  removeRig, seedAccount, seedAgent, seedHarness, success, type Fakes, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import {
  acceptDelivery, agent, appendWith, deliveryRow, eventually, questionRow, requestPermission, snapshot, tagged,
} from "../support/routingRig.ts";

// Unit 5c fix round 1, ruling 5 (F-4; row 27): a move withdraws the old
// holder's delivery only while that delivery is still queued, as
// `withdrawQueued` does. A delivery the holder has already taken (sent and
// accepted) is not withdrawn; it stays accepted, and the move queues the new
// holder's delivery as before.

let rig: Rig;
beforeEach(() => {
  rig = makeRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("SHEPHRD_HOME", rig.stateFolder);
});
afterEach(() => {
  vi.unstubAllEnvs();
  removeRig(rig);
});

const withRig = <A, E, R>(body: (fakes: Fakes) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fakes: Fakes = { runner: yield* makeFakeRunner(), secrets: makeFakeSecrets() };
    return yield* provideRig(rig, fakes, Effect.gen(function* () {
      yield* registerRebuildCheck();
      yield* seedAccount();
      yield* seedHarness();
      yield* fakes.runner.subscribed;
      return yield* body(fakes);
    }));
  });

// owner -> grand -> lead -> worker. The lead holds two requests and a
// question from the worker. It has taken the first request's delivery and
// the question's; the second request's delivery is still queued.
const family = (fakes: Fakes) => Effect.gen(function* () {
  yield* seedAgent({ id: "grand" });
  yield* seedAgent({ id: "lead", parent: "grand" });
  const worker = yield* seedAgent({ id: "worker", parent: "lead", state: "working" });
  const taken = yield* requestPermission(fakes.runner, worker);
  const queued = yield* requestPermission(fakes.runner, worker);
  const questionId: string = success(yield* call(agentCredential(worker.token), "ask", { text: "Which branch?" })).questionId;
  const question = (yield* questionRow(questionId))!;
  yield* acceptDelivery("lead", taken.row.deliveryId);
  yield* acceptDelivery("lead", question.deliveryId);
  expect((yield* deliveryRow(taken.row.deliveryId))?.status).toBe("accepted");
  expect((yield* deliveryRow(queued.row.deliveryId))?.status).toBe("queued");
  return { taken, queued, question: { id: questionId, row: question } };
});

it.live("5c fix-1 ruling 5, moveHeld: catches a move that withdraws a delivery its holder already accepted, or no longer withdraws one still queued", () =>
  withRig((fakes) => Effect.gen(function* () {
    const world = yield* family(fakes);
    const events = moveHeld(yield* snapshot, [agentIdOf("lead")]);
    const rows = events.map((event, index) => ({ sequence: index, caller: agent("lead"), requestId: "moves", event }));

    // All three subjects move up to the grand.
    expect(tagged(rows, "PermissionMoved").map((event) => event.permissionRequestId).sort()).toEqual(
      [world.taken.id, world.queued.id].sort(),
    );
    expect(tagged(rows, "QuestionMoved").map((event) => event.questionId)).toEqual([world.question.id]);
    for (const moved of [...tagged(rows, "PermissionMoved"), ...tagged(rows, "QuestionMoved")]) {
      expect(moved).toMatchObject({ from: agent("lead"), to: agent("grand") });
    }
    // Only the queued delivery is withdrawn.
    expect(tagged(rows, "DeliveryWithdrawn")).toEqual([
      expect.objectContaining({ agentId: "lead", deliveryId: world.queued.row.deliveryId }),
    ]);
  })).pipe(Effect.orDie));

for (const cause of ["stop", "crash"] as const) {
  it.live(`5c fix-1 ruling 5, ${cause}: catches the move written with "agent ${cause === "stop" ? "stopped" : "crashed"}" withdrawing a delivery the holder had accepted`, () =>
    withRig((fakes) => Effect.gen(function* () {
      const world = yield* family(fakes);
      const before = yield* headSequence;
      const marker = cause === "stop" ? "AgentStopped" : "AgentCrashed";
      if (cause === "stop") success(yield* call(ownerCredential, "stop", { agentId: "lead" }));
      else yield* fakes.runner.emit({ _tag: "exited", agentId: agentIdOf("lead"), exitCode: 1, signal: null, stderr: "" });
      const written = yield* eventually(logAfter(before), (rows) => rows.some((row) => row.event._tag === marker));
      const batch = appendWith(written, (row) => row.event._tag === marker);
      expect(tagged(batch, marker)).toHaveLength(1);
      expect(tagged(batch, "PermissionMoved")).toHaveLength(2);
      expect(tagged(batch, "QuestionMoved")).toHaveLength(1);

      const withdrawn = tagged(batch, "DeliveryWithdrawn").map((event) => event.deliveryId as string);
      expect(withdrawn).toContain(world.queued.row.deliveryId);
      expect(withdrawn).not.toContain(world.taken.row.deliveryId);
      expect(withdrawn).not.toContain(world.question.row.deliveryId);
      expect((yield* deliveryRow(world.taken.row.deliveryId))?.status).toBe("accepted");
      expect((yield* deliveryRow(world.question.row.deliveryId))?.status).toBe("accepted");
      expect((yield* deliveryRow(world.queued.row.deliveryId))?.status).toBe("withdrawn");
    })).pipe(Effect.orDie));
}
