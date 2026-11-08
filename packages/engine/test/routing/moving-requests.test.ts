import { it } from "@effect/vitest";
import type { Actor } from "@lgcode/contracts";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { moveHeld } from "../../src/routing/holders.ts";
import { incarnationOf, makeFakeRunner } from "../support/fakeRunner.ts";
import {
  agentCredential, agentIdOf, appendSetup, call, eventOf, headSequence, logAfter, makeFakeSecrets, makeRig,
  ownerCredential, provideRig, readLog, removeRig, rotateToken, seedAccount, seedAgent, seedHarness, stateOf, success,
  type Fakes, type Logged, type Rig, type SeedState,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import {
  acceptDelivery, agent, appendWith, deliveryRow, endTurn, eventually, owner, pause, questionRow, queuedFor,
  requestPermission, requestRow, snapshot, tagged,
} from "../support/routingRig.ts";

// Criterion 5.6 (decision rows 27, 50, 51, 52, 67): a request or question
// whose holder can no longer act moves up by the holder rule, starting from
// the holder's parent; the move withdraws the old holder's delivery in its
// own transaction; nothing ever moves back down; a holder that ends the turn
// in which it accepted a request's delivery, without answering or passing it
// up, has it passed up in the "turn ended" transaction; nothing times out
// into an answer.
//
// Who writes each move:
//   - a crash (runner `exited`) and `stop`: the engine, in the same
//     transaction as "agent crashed" or "agent stopped";
//   - a pause (unit 6b) and the restart's "re-evaluate holders" step (unit
//     6d, row 52 step 9): those units call `moveHeld` from
//     `src/routing/holders.ts` and append its events. These tests append them
//     the same way, because neither writer exists yet.

let rig: Rig;
beforeEach(() => {
  rig = makeRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("LGCODE_HOME", rig.stateFolder);
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

// owner -> grand -> lead -> worker. The worker, working, has asked for a
// permission and asked a question; the lead holds both.
const family = (fakes: Fakes, states: { readonly grand?: SeedState; readonly lead?: SeedState } = {}) => Effect.gen(function* () {
  const grand = yield* seedAgent({ id: "grand", state: states.grand });
  const lead = yield* seedAgent({ id: "lead", parent: "grand", state: states.lead });
  const worker = yield* seedAgent({ id: "worker", parent: "lead", state: "working" });
  const request = yield* requestPermission(fakes.runner, worker);
  const questionId: string = success(yield* call(agentCredential(worker.token), "ask", { text: "Which branch?" })).questionId;
  const question = (yield* questionRow(questionId))!;
  expect(request.row.holder).toEqual(agent("lead"));
  expect(question.holder).toEqual(agent("lead"));
  return { grand, lead, worker, request, question: { id: questionId, row: question } };
});

type Family = Effect.Success<ReturnType<typeof family>>;

// Both subjects moved from `from` to `to` inside `batch`: each old delivery
// withdrawn, and either a new delivery queued for an agent holder or "owner
// needed" written for the owner.
const expectMovedIn = (batch: ReadonlyArray<Logged>, world: Family, from: Actor, to: Actor) => {
  const permission = tagged(batch, "PermissionMoved");
  const question = tagged(batch, "QuestionMoved");
  expect(permission).toEqual([expect.objectContaining({ agentId: "worker", permissionRequestId: world.request.id, from, to })]);
  expect(question).toEqual([expect.objectContaining({ agentId: "worker", questionId: world.question.id, from, to })]);
  // Compared as a set: unit 5d may also withdraw a stopped target's queue.
  expect(new Set(tagged(batch, "DeliveryWithdrawn").map((event) => event.deliveryId))).toEqual(
    new Set([world.request.row.deliveryId, world.question.row.deliveryId]),
  );
  if (to._tag === "agent") {
    expect(queuedFor(batch, "permission", world.request.id)).toEqual([
      expect.objectContaining({ id: permission[0]!.deliveryId, target: to.agentId }),
    ]);
    expect(queuedFor(batch, "question", world.question.id)).toEqual([
      expect.objectContaining({ id: question[0]!.deliveryId, target: to.agentId }),
    ]);
    expect(tagged(batch, "OwnerNeeded")).toEqual([]);
  } else {
    expect(queuedFor(batch, "permission", world.request.id)).toEqual([]);
    expect(queuedFor(batch, "question", world.question.id)).toEqual([]);
    expect(tagged(batch, "OwnerNeeded").filter((event) => event.subject !== undefined).map((event) => event.subject).sort((a, b) => a!._tag.localeCompare(b!._tag))).toEqual([
      { _tag: "permission", id: world.request.id }, { _tag: "question", id: world.question.id },
    ]);
  }
};

const expectHeldBy = (world: Family, holder: Actor) => Effect.gen(function* () {
  expect(yield* requestRow(world.request.id)).toMatchObject({ status: "open", holder });
  expect(yield* questionRow(world.question.id)).toMatchObject({ status: "open", holder });
  expect((yield* deliveryRow(world.request.row.deliveryId))?.status).toBe("withdrawn");
  expect((yield* deliveryRow(world.question.row.deliveryId))?.status).toBe("withdrawn");
});

// ---------------------------------------------------------------------------
// The holder crashes, stops, pauses or is interrupted
// ---------------------------------------------------------------------------

it.live("5.6 holder crashes: catches a crashed holder that keeps its request and question, or a move written apart from \"agent crashed\" or without withdrawing the old deliveries", () =>
  withRig((fakes) => Effect.gen(function* () {
    const world = yield* family(fakes);
    const before = yield* headSequence;
    yield* fakes.runner.emit({ _tag: "exited", agentId: agentIdOf("lead"), exitCode: 1, signal: null, stderr: "" });
    const written = yield* eventually(logAfter(before), (rows) => rows.some((row) => row.event._tag === "AgentCrashed"));
    const batch = appendWith(written, (row) => row.event._tag === "AgentCrashed");
    expect(tagged(batch, "AgentCrashed")).toHaveLength(1);
    expectMovedIn(batch, world, agent("lead"), agent("grand"));
    yield* expectHeldBy(world, agent("grand"));
  })).pipe(Effect.orDie));

it.live("5.6 holder stops: catches a stopped holder that keeps its request and question, or a move written apart from \"agent stopped\"", () =>
  withRig((fakes) => Effect.gen(function* () {
    const world = yield* family(fakes);
    const before = yield* headSequence;
    success(yield* call(ownerCredential, "stop", { agentId: "lead" }));
    const batch = appendWith(yield* logAfter(before), (row) => row.event._tag === "AgentStopped");
    expect(tagged(batch, "AgentStopped")).toHaveLength(1);
    expectMovedIn(batch, world, agent("lead"), agent("grand"));
    yield* expectHeldBy(world, agent("grand"));
  })).pipe(Effect.orDie));

it.live("5.6 holder pauses (unit 6b's writer): catches moveHeld that leaves a request with an agent about to pause, or moves it to someone other than the next idle ancestor", () =>
  withRig((fakes) => Effect.gen(function* () {
    // Working, so the lead's deliveries stay queued until the move (unit 5d).
    const world = yield* family(fakes, { lead: "working" });
    const moves = moveHeld(yield* snapshot, [agentIdOf("lead")]);
    const before = yield* headSequence;
    yield* appendSetup([
      eventOf({ _tag: "StateChanged", agentId: "lead", state: { _tag: "paused", reason: "limit", midTurn: false } }),
      ...moves,
    ]);
    expectMovedIn(yield* logAfter(before), world, agent("lead"), agent("grand"));
    yield* expectHeldBy(world, agent("grand"));
  })).pipe(Effect.orDie));

it.live("5.6 holder interrupted (row 52 step 9): catches moveHeld that skips a holder left interrupted after recovery", () =>
  withRig((fakes) => Effect.gen(function* () {
    // Working, so the lead's deliveries stay queued until the move (unit 5d).
    const world = yield* family(fakes, { lead: "working" });
    // Step 6 interrupts without moving anything; step 9 re-evaluates once.
    yield* appendSetup([eventOf({ _tag: "AgentInterrupted", agentId: "lead", previous: "idle" })]);
    const moves = moveHeld(yield* snapshot);
    const before = yield* headSequence;
    yield* appendSetup(moves);
    expectMovedIn(yield* logAfter(before), world, agent("lead"), agent("grand"));
    yield* expectHeldBy(world, agent("grand"));
  })).pipe(Effect.orDie));

it.live("5.6 moveHeld control: catches a re-evaluation that moves requests whose holders are idle or working", () =>
  withRig((fakes) => Effect.gen(function* () {
    yield* family(fakes);
    yield* appendSetup([eventOf({ _tag: "StateChanged", agentId: "lead", state: { _tag: "working" } })]);
    expect(moveHeld(yield* snapshot)).toEqual([]);
  })).pipe(Effect.orDie));

it.live("5.6 move to the owner: catches a crash that leaves the request with a paused ancestor, or reaches the owner without \"owner needed\" in the move's transaction", () =>
  withRig((fakes) => Effect.gen(function* () {
    const world = yield* family(fakes, { grand: "paused" });
    const before = yield* headSequence;
    yield* fakes.runner.emit({ _tag: "exited", agentId: agentIdOf("lead"), exitCode: null, signal: "SIGKILL", stderr: "" });
    const written = yield* eventually(logAfter(before), (rows) => rows.some((row) => row.event._tag === "AgentCrashed"));
    const batch = appendWith(written, (row) => row.event._tag === "AgentCrashed");
    expectMovedIn(batch, world, agent("lead"), owner);
    expect(tagged(batch, "OwnerNeeded").filter((event) => event.subject === undefined)).toEqual([
      { _tag: "OwnerNeeded", agentId: "lead", reason: "agent crashed" },
    ]);
    yield* expectHeldBy(world, owner);
  })).pipe(Effect.orDie));

// ---------------------------------------------------------------------------
// Never back down (row 51)
// ---------------------------------------------------------------------------

it.live("5.6 never back down: catches a request that returns to a holder below it once that holder can act again, by re-evaluation, pass-up or a later move", () =>
  withRig((fakes) => Effect.gen(function* () {
    // Working, so the lead's deliveries stay queued until the move (unit 5d).
    const world = yield* family(fakes, { lead: "working" });
    yield* appendSetup([
      eventOf({ _tag: "StateChanged", agentId: "lead", state: { _tag: "paused", reason: "limit", midTurn: false } }),
      ...moveHeld(yield* snapshot, [agentIdOf("lead")]),
    ]);
    // The lead can act again; re-evaluation leaves the moved request where it is.
    yield* appendSetup([eventOf({ _tag: "StateChanged", agentId: "lead", state: { _tag: "idle" } })]);
    expect(moveHeld(yield* snapshot)).toEqual([]);
    yield* expectHeldBy(world, agent("grand"));
    // The grand's own pass-up goes on up, to the owner, never down to the lead.
    success(yield* call(agentCredential(world.grand.token), "pass-up", { subject: { _tag: "permission", id: world.request.id } }));
    expect((yield* requestRow(world.request.id))?.holder).toEqual(owner);
    // The grand stops: its question also goes up to the owner.
    success(yield* call(ownerCredential, "stop", { agentId: "grand" }));
    expect((yield* questionRow(world.question.id))?.holder).toEqual(owner);
    expect(moveHeld(yield* snapshot)).toEqual([]);
  })).pipe(Effect.orDie));

// ---------------------------------------------------------------------------
// Pass-up at the end of the turn (rows 50, 67)
// ---------------------------------------------------------------------------

it.live("5.6 turn end (row 67): catches a holder that ends the turn with an accepted request unanswered and keeps it, or a pass-up written apart from \"turn ended\", or one that also moves a request it never took", () =>
  withRig((fakes) => Effect.gen(function* () {
    yield* seedAgent({ id: "grand" });
    const lead = yield* seedAgent({ id: "lead", parent: "grand" });
    const worker = yield* seedAgent({ id: "worker", parent: "lead", state: "working" });
    const taken = yield* requestPermission(fakes.runner, worker);
    const untaken = yield* requestPermission(fakes.runner, worker);
    // The lead takes the first request's delivery in a turn; the second stays queued.
    yield* acceptDelivery("lead", taken.row.deliveryId);
    expect(yield* stateOf("lead")).toBe("working");

    const written = yield* endTurn(fakes.runner, lead);
    const batch = appendWith(written, (row) => row.event._tag === "TurnEnded");
    expect(tagged(batch, "TurnEnded")).toEqual([expect.objectContaining({ agentId: "lead" })]);
    expect(tagged(batch, "PermissionMoved")).toEqual([
      expect.objectContaining({ permissionRequestId: taken.id, from: agent("lead"), to: agent("grand") }),
    ]);
    // Fix round 1, ruling 5: the lead had accepted this delivery, so the move
    // withdraws nothing; only a queued delivery is withdrawn.
    expect(tagged(batch, "DeliveryWithdrawn")).toEqual([]);
    expect((yield* deliveryRow(taken.row.deliveryId))?.status).toBe("accepted");
    expect(queuedFor(batch, "permission", taken.id).map((delivery) => delivery.target)).toEqual(["grand"]);
    expect(yield* stateOf("lead")).toBe("idle");
    expect((yield* requestRow(taken.id))?.holder).toEqual(agent("grand"));
    expect((yield* requestRow(untaken.id))?.holder).toEqual(agent("lead"));
    expect(tagged(written, "PermissionAnswered")).toEqual([]);
  })).pipe(Effect.orDie));

it.live("5.6 turn end, question: catches a held question that is not passed up at the end of the turn that took it", () =>
  withRig((fakes) => Effect.gen(function* () {
    yield* seedAgent({ id: "grand" });
    const lead = yield* seedAgent({ id: "lead", parent: "grand" });
    const worker = yield* seedAgent({ id: "worker", parent: "lead", state: "working" });
    const questionId: string = success(yield* call(agentCredential(worker.token), "ask", { text: "Which branch?" })).questionId;
    yield* acceptDelivery("lead", (yield* questionRow(questionId))!.deliveryId);
    const batch = appendWith(yield* endTurn(fakes.runner, lead), (row) => row.event._tag === "TurnEnded");
    expect(tagged(batch, "QuestionMoved")).toEqual([
      expect.objectContaining({ questionId, from: agent("lead"), to: agent("grand") }),
    ]);
    expect((yield* questionRow(questionId))).toMatchObject({ status: "open", holder: agent("grand") });
  })).pipe(Effect.orDie));

it.live("5.6 turn end after answering: catches a request answered during the turn being passed up anyway", () =>
  withRig((fakes) => Effect.gen(function* () {
    yield* seedAgent({ id: "grand" });
    const lead = yield* seedAgent({ id: "lead", parent: "grand" });
    const worker = yield* seedAgent({ id: "worker", parent: "lead", state: "working" });
    const { id, row } = yield* requestPermission(fakes.runner, worker);
    yield* acceptDelivery("lead", row.deliveryId);
    success(yield* call(agentCredential(lead.token), "answer", { kind: "permission", id, optionId: "once" }));
    const written = yield* endTurn(fakes.runner, lead);
    expect(tagged(written, "PermissionMoved")).toEqual([]);
    expect((yield* requestRow(id))).toMatchObject({ status: "answered", holder: agent("lead") });
  })).pipe(Effect.orDie));

it.live("5.6 turn end from an earlier incarnation (issue 61): catches a late turn end of an old process that writes \"turn ended\" or passes up for the new one", () =>
  withRig((fakes) => Effect.gen(function* () {
    yield* seedAgent({ id: "grand" });
    const lead = yield* seedAgent({ id: "lead", parent: "grand" });
    const other = yield* seedAgent({ id: "other", state: "working" });
    const worker = yield* seedAgent({ id: "worker", parent: "lead", state: "working" });
    const { id, row } = yield* requestPermission(fakes.runner, worker);
    yield* acceptDelivery("lead", row.deliveryId);
    yield* rotateToken(agentIdOf("lead"));
    const before = yield* headSequence;
    // The old process's turn end goes first; once the other agent's later
    // turn end is written, the first one has been read and must be ignored.
    yield* fakes.runner.emit({ _tag: "turnEnded", agentId: agentIdOf("lead"), incarnation: incarnationOf(lead.token) });
    yield* endTurn(fakes.runner, other);
    const written = yield* logAfter(before);
    expect(tagged(written, "TurnEnded").map((event) => event.agentId)).toEqual(["other"]);
    expect(tagged(written, "PermissionMoved")).toEqual([]);
    expect(yield* stateOf("lead")).toBe("working");
    expect((yield* requestRow(id))?.holder).toEqual(agent("lead"));
  })).pipe(Effect.orDie));

// ---------------------------------------------------------------------------
// Nothing times out into an answer
// ---------------------------------------------------------------------------

it.effect("5.6 no timeout: catches a request or question that is answered, cancelled or moved when it has waited a long time", () =>
  withRig((fakes) => Effect.gen(function* () {
    const world = yield* family(fakes);
    const solo = yield* seedAgent({ id: "solo", state: "working" });
    const ownerHeld = yield* requestPermission(fakes.runner, solo);
    const before = yield* headSequence;
    const callsBefore = fakes.runner.calls.length;
    // Issue 124: a setup delivery can still be dispatched after the watermark, so the runner may
    // receive a prompt for a delivery that was queued before it. Nothing else may reach the runner.
    const queuedBefore = new Set(tagged((yield* readLog).filter((row) => row.sequence <= before), "DeliveryQueued").map((event) => event.delivery.id as string));
    for (const step of ["1 hour", "1 day", "400 days"] as const) {
      yield* TestClock.adjust(step);
      // Real time for any fiber the clock woke.
      yield* pause(100);
    }
    const written = yield* logAfter(before);
    for (const tag of ["PermissionAnswered", "PermissionCancelled", "PermissionMoved", "QuestionAnswered", "QuestionMoved"] as const) {
      expect(tagged(written, tag)).toEqual([]);
    }
    const unexpectedCalls = fakes.runner.calls.slice(callsBefore).filter((entry) =>
      entry.method !== "prompt" || !queuedBefore.has((entry.input as { readonly delivery: { readonly id: string } }).delivery.id));
    expect(unexpectedCalls).toEqual([]);
    expect(yield* requestRow(world.request.id)).toMatchObject({ status: "open", holder: agent("lead") });
    expect(yield* questionRow(world.question.id)).toMatchObject({ status: "open", holder: agent("lead") });
    expect(yield* requestRow(ownerHeld.id)).toMatchObject({ status: "open", holder: owner });
  })).pipe(Effect.orDie));
