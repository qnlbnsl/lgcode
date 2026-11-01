import { loadDeliveries } from "../support/routingModules.ts";
import { loadWaits } from "../support/routingModules.ts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { afterEach, beforeEach, expect, vi } from "vitest";

import {
  agentCredential, agentRow, appendSetup, call, eventOf, headSequence, logAfter,
  makeRig, ownerCredential, readLog, removeRig, success, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { appendWith, deliveryRow, endTurn, eventually, pause, requestPermission, snapshot, tagged } from "../support/routingRig.ts";
import {
  accept, crash, deliveryRig, finish, noWake, notice, oneWake, send, spawn,
  waitFor, waitRow, wakeRows, type Spawned,
} from "../support/deliveryRig.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("SHEPHERD_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });
const run = <A, E, R>(body: Parameters<typeof deliveryRig<A, E, R>>[1]) =>
  deliveryRig(rig, (runner) => Effect.gen(function* () { yield* registerRebuildCheck(); return yield* body(runner); })).pipe(Effect.orDie);
const settled = (member: Spawned) => ({ agentId: member.agentId, reason: "settled" });
const waitsOf = (who: Spawned) => snapshot.pipe(Effect.map((state) => Object.values(state.waits).filter((row) => row.agentId === who.agentId)));

it.live("W01 catches a sent but unaccepted delivery counted as settled, or acceptance mistaken for turn settlement", () => run((runner) => Effect.gen(function* () {
  const waiter = yield* spawn(rig, runner);
  const member = yield* spawn(rig, runner, waiter);
  const id = yield* send(runner, member, "First turn.");
  const reply = success(yield* waitFor(waiter, [member]));
  expect(reply).toMatchObject({ outcome: "opened", members: [] });
  const waitId = reply.waitId;
  yield* noWake(waitId);
  yield* accept(runner, member, id);
  // Acceptance alone is not a settled turn either.
  yield* noWake(waitId);
  yield* endTurn(runner, member);
  yield* oneWake(waitId, waiter, [settled(member)]);
})));

it.live("W02 catches start-with-first-prompt settling before that prompt's accepted turn, or losing its initial delivery", () => run((runner) => Effect.gen(function* () {
  const waiter = yield* spawn(rig, runner);
  const before = yield* headSequence;
  const member = yield* spawn(rig, runner, waiter, { prompt: "Build the parser." });
  const rows = yield* logAfter(before);
  const started = tagged(rows, "AgentStarted").find((event) => event.agentId === member.agentId)!;
  expect(started.firstPromptDelivery).toMatchObject({ target: member.agentId, content: { _tag: "prompt", text: expect.stringContaining("Build the parser.") } });
  const first = started.firstPromptDelivery!.id;
  const waitId = success(yield* waitFor(waiter, [member])).waitId;
  yield* noWake(waitId);
  expect((yield* eventually(deliveryRow(first), (row) => row?.status === "sent"))?.status).toBe("sent");
  yield* finish(runner, member, first);
  yield* oneWake(waitId, waiter, [settled(member)]);
})));

it.live("W03 catches compact treated as settled before its end, or never restoring the previously settled status", () => run((runner) => Effect.gen(function* () {
  const waiter = yield* spawn(rig, runner);
  const member = yield* spawn(rig, runner, waiter);
  const compact = success(yield* call(agentCredential(waiter.token), "compact", { agentId: member.agentId })).deliveryId;
  const waitId = success(yield* waitFor(waiter, [member])).waitId;
  yield* noWake(waitId);
  expect((yield* eventually(deliveryRow(compact), (row) => row?.status === "sent"))?.status).toBe("sent");
  const rows = yield* finish(runner, member, compact);
  expect(tagged(rows, "TurnEnded")).toContainEqual({ _tag: "TurnEnded", agentId: member.agentId, compact: true });
  yield* oneWake(waitId, waiter, [settled(member)]);
})));

for (const close of ["answer", "pass-up at turn end"] as const) {
  it.live(`W04 ${close}: catches a member holding an unanswered request counted as settled`, () => run((runner) => Effect.gen(function* () {
    const waiter = yield* spawn(rig, runner);
    const member = yield* spawn(rig, runner, waiter);
    const child = yield* spawn(rig, runner, member);
    // Keep member working so the routed permission is queued, not accepted.
    const turn = yield* send(runner, member, "Current work.");
    const request = yield* requestPermission(runner, child);
    const waitId = success(yield* waitFor(waiter, [member])).waitId;
    yield* finish(runner, member, turn);
    expect((yield* eventually(deliveryRow(request.row.deliveryId), (row) => row?.status === "sent"))?.status).toBe("sent");
    yield* noWake(waitId);
    yield* accept(runner, member, request.row.deliveryId);
    yield* noWake(waitId);
    if (close === "answer") success(yield* call(agentCredential(member.token), "answer", { kind: "permission", id: request.id, optionId: "once" }));
    yield* endTurn(runner, member);
    yield* oneWake(waitId, waiter, [settled(member)]);
  })));
}

for (const kind of ["permission", "question"] as const) {
  it.live(`W05 ${kind}: catches a member settled while its own request is unanswered`, () => run((runner) => Effect.gen(function* () {
    const waiter = yield* spawn(rig, runner);
    const member = yield* spawn(rig, runner, waiter);
    const turn = yield* send(runner, member, "Need guidance.");
    const subject = kind === "permission"
      ? (yield* requestPermission(runner, member)).id
      : success(yield* call(agentCredential(member.token), "ask", { text: "Which branch?" })).questionId;
    yield* finish(runner, member, turn);
    const waitId = success(yield* waitFor(waiter, [member])).waitId;
    yield* noWake(waitId);
    success(yield* call(ownerCredential, "answer", kind === "permission"
      ? { kind, id: subject, optionId: "once" } : { kind, id: subject, text: "Use the engine branch." }));
    if (kind === "question") {
      const answer = Object.values((yield* snapshot).deliveries).find((row) => row.target === member.agentId && row.source?._tag === "question" && row.source.id === subject)!;
      expect((yield* eventually(deliveryRow(answer.id), (row) => row?.status === "sent"))?.status).toBe("sent");
      yield* finish(runner, member, answer.id);
    }
    yield* oneWake(waitId, waiter, [settled(member)]);
  })));
}

it.live("W06 catches a wait opened after settlement that needs a later event, records no since, or wakes twice on recheck", () => run((runner) => Effect.gen(function* () {
  const waiter = yield* spawn(rig, runner);
  const member = yield* spawn(rig, runner, waiter);
  const id = yield* send(runner, member, "Finish before the wait opens.");
  yield* finish(runner, member, id);
  const before = yield* headSequence;
  const reply = success(yield* waitFor(waiter, [member]));
  expect(reply.outcome).toBe("satisfied");
  const rows = yield* logAfter(before);
  const opened = rows.find((row) => row.event._tag === "WaitOpened")!;
  expect(opened).toBeDefined();
  // `since` is derived from the durable WaitOpened envelope, not wall time.
  expect((yield* waitRow(reply.waitId)) as unknown).toMatchObject({ since: opened.sequence });
  const batch = appendWith(rows, (row) => row.event._tag === "WaitOpened");
  expect(tagged(batch, "WaitSatisfied")).toHaveLength(1);
  yield* oneWake(reply.waitId, waiter, [settled(member)]);
  const { recheckWaits } = yield* loadWaits();
  yield* recheckWaits();
  yield* recheckWaits();
  expect(yield* wakeRows(reply.waitId)).toHaveLength(1);
})));

it.live("W07 catches an orchestrator waking when the lead ends its first turn but still waits for its worker", () => run((runner) => Effect.gen(function* () {
  const orchestrator = yield* spawn(rig, runner);
  const lead = yield* spawn(rig, runner, orchestrator);
  const worker = yield* spawn(rig, runner, lead);
  const leadTurn = yield* send(runner, lead, "Delegate the task.");
  const workerTurn = yield* send(runner, worker, "Build it.");
  const childWait = success(yield* waitFor(lead, [worker])).waitId;
  const parentWait = success(yield* waitFor(orchestrator, [lead])).waitId;
  yield* finish(runner, lead, leadTurn);
  yield* noWake(parentWait);
  yield* finish(runner, worker, workerTurn);
  const wake = yield* oneWake(childWait, lead, [settled(worker)]);
  yield* noWake(parentWait);
  expect((yield* eventually(deliveryRow(wake.id), (row) => row?.status === "sent"))?.status).toBe("sent");
  yield* finish(runner, lead, wake.id);
  yield* oneWake(parentWait, orchestrator, [settled(lead)]);
})));

for (const mode of ["any", "all"] as const) {
  it.live(`W08 ${mode}: catches a wake before the required member settles or a second wake after closure`, () => run((runner) => Effect.gen(function* () {
    const waiter = yield* spawn(rig, runner);
    const first = yield* spawn(rig, runner, waiter);
    const last = yield* spawn(rig, runner, waiter);
    const firstTurn = yield* send(runner, first, "First member.");
    const lastTurn = yield* send(runner, last, "Last member.");
    const waitId = success(yield* waitFor(waiter, [first, last], mode)).waitId;
    yield* finish(runner, first, firstTurn);
    if (mode === "all") yield* noWake(waitId);
    else yield* oneWake(waitId, waiter, [settled(first)]);
    yield* finish(runner, last, lastTurn);
    yield* oneWake(waitId, waiter, mode === "all" ? [settled(first), settled(last)] : [settled(first)]);
  })));
}

it.live("W09 catches member resolution or its wake committed separately from the resolving turn end", () => run((runner) => Effect.gen(function* () {
  const waiter = yield* spawn(rig, runner);
  const member = yield* spawn(rig, runner, waiter);
  const turn = yield* send(runner, member, "Atomic finish.");
  const waitId = success(yield* waitFor(waiter, [member])).waitId;
  const rows = yield* finish(runner, member, turn);
  const batch = appendWith(rows, (row) => row.event._tag === "TurnEnded" && row.event.agentId === member.agentId);
  expect(tagged(batch, "WaitMemberResolved")).toContainEqual({ _tag: "WaitMemberResolved", agentId: waiter.agentId, waitId, member: settled(member) });
  expect(tagged(batch, "WaitSatisfied")).toContainEqual({ _tag: "WaitSatisfied", agentId: waiter.agentId, waitId, members: [settled(member)] });
  expect(tagged(batch, "DeliveryQueued").filter((event) => event.delivery.source?._tag === "wait" && event.delivery.source.id === waitId)).toHaveLength(1);
})));

for (const mode of ["any", "all"] as const) {
  it.live(`W10 crashed member in ${mode}: catches duplicate parent notices, missing immediate notice for an open wait, or a missing final crash reason`, () => run((runner) => Effect.gen(function* () {
    const waiter = yield* spawn(rig, runner);
    const failed = yield* spawn(rig, runner, waiter);
    const other = yield* spawn(rig, runner, waiter);
    yield* send(runner, failed, "Will crash.");
    const otherTurn = yield* send(runner, other, "Will settle later.");
    const waitId = success(yield* waitFor(waiter, [failed, other], mode)).waitId;
    const before = yield* headSequence;
    yield* crash(runner, failed);
    const crashed = { agentId: failed.agentId, reason: "crashed" };
    const rows = yield* logAfter(before);
    const batch = appendWith(rows, (row) => row.event._tag === "AgentCrashed");
    expect(tagged(batch, "WaitMemberResolved")).toContainEqual(expect.objectContaining({ waitId, member: crashed }));
    const notices = tagged(rows, "DeliveryQueued").filter((event) => event.delivery.target === waiter.agentId);
    expect(notices).toHaveLength(1);
    expect(JSON.stringify(notices)).toContain(failed.agentId);
    if (mode === "any") {
      expect(tagged(batch, "WaitSatisfied")).toContainEqual(expect.objectContaining({ waitId, members: [crashed] }));
      yield* oneWake(waitId, waiter, [crashed]);
    } else {
      expect((yield* waitRow(waitId))?.status).toBe("open");
      expect(tagged(rows, "WaitSatisfied")).toEqual([]);
      const beforeFinal = yield* headSequence;
      yield* finish(runner, other, otherTurn);
      expect((yield* eventually(waitRow(waitId), (row) => row?.status === "satisfied"))?.resolved).toEqual([crashed, settled(other)]);
      const final = tagged(yield* logAfter(beforeFinal), "DeliveryQueued").filter((event) => event.delivery.source?._tag === "wait" && event.delivery.source.id === waitId);
      expect(final).toHaveLength(1);
      expect(JSON.stringify(final)).toContain("crashed");
      expect(JSON.stringify(final)).toContain(other.agentId);
    }
  })));
}

it.live("W11 catches an all-wait retaining a paused member's old reason after that member returns to working", () => run((runner) => Effect.gen(function* () {
  const waiter = yield* spawn(rig, runner);
  const first = yield* spawn(rig, runner, waiter);
  const last = yield* spawn(rig, runner, waiter);
  const firstTurn = yield* send(runner, first, "Pause before acceptance.");
  const lastTurn = yield* send(runner, last, "Still working.");
  const waitId = success(yield* waitFor(waiter, [first, last])).waitId;
  yield* notice(runner, first, { _tag: "promptReply", deliveryId: firstTurn, outcome: { _tag: "pause", reason: "out-of-usage", error: "Usage limit." } });
  expect((yield* eventually(waitRow(waitId), (row) => row?.resolved.some((member) => member.reason === "paused") === true))?.status).toBe("open");
  // Unit 6b owns the reload. This is its committed state before 5d drains.
  yield* appendSetup([eventOf({ _tag: "StateChanged", agentId: first.agentId, state: { _tag: "idle" } })]);
  const { dispatchQueued } = yield* loadDeliveries();
  yield* dispatchQueued(first.agentId);
  expect((yield* agentRow(first.agentId))?.state._tag).toBe("working");
  yield* finish(runner, last, lastTurn);
  yield* noWake(waitId);
  yield* finish(runner, first, firstTurn);
  yield* oneWake(waitId, waiter, [settled(first), settled(last)]);
})));

for (const [state, reloadable, reason] of [
  ["stopped", true, "stopped"], ["paused", true, "paused"], ["interrupted", false, "interrupted"],
] as const) {
  it.live(`W12 ${state}: catches a terminal or unavailable member omitted from the final listing`, () => run((runner) => Effect.gen(function* () {
    const waiter = yield* spawn(rig, runner);
    const member = yield* spawn(rig, runner, waiter);
    if (state === "stopped") success(yield* call(ownerCredential, "stop", { agentId: member.agentId }));
    else {
      yield* appendSetup([eventOf({ _tag: "SessionOpened", agentId: member.agentId, session: { _tag: "acp", sessionId: "state-case" }, protocolVersion: 2, reloadable }),
        eventOf({ _tag: "StateChanged", agentId: member.agentId, state: state === "paused" ? { _tag: state, reason: "limit", midTurn: false } : { _tag: state, previous: "idle" } })]);
    }
    const waitId = success(yield* waitFor(waiter, [member])).waitId;
    yield* oneWake(waitId, waiter, [{ agentId: member.agentId, reason }]);
  })));
}

it.live("W13 catches a reloadable interrupted member resolved as terminal before recovery can restore it", () => run((runner) => Effect.gen(function* () {
  const waiter = yield* spawn(rig, runner);
  const member = yield* spawn(rig, runner, waiter);
  yield* appendSetup([eventOf({ _tag: "AgentInterrupted", agentId: member.agentId, previous: "idle" })]);
  const waitId = success(yield* waitFor(waiter, [member])).waitId;
  yield* noWake(waitId);
  expect((yield* waitRow(waitId))?.resolved).toEqual([]);
})));

it.live("W14 catches a waiter crash cancelling its waits, resolving them while suspended, or resume failing to re-open and re-check", () => run((runner) => Effect.gen(function* () {
  const waiter = yield* spawn(rig, runner);
  const member = yield* spawn(rig, runner, waiter);
  const turn = yield* send(runner, member, "Finish while parent is down.");
  const waitId = success(yield* waitFor(waiter, [member])).waitId;
  yield* crash(runner, waiter);
  // Issue 52: suspended is derived: open wait + crashed waiter. The log's
  // AgentCrashed marker makes it durable without a new contract status.
  expect((yield* waitRow(waitId))?.status).toBe("open");
  expect(tagged(yield* readLog, "WaitCancelled").filter((event) => event.waitId === waitId)).toEqual([]);
  yield* finish(runner, member, turn);
  yield* noWake(waitId);
  expect((yield* waitRow(waitId))?.status).toBe("open");
  success(yield* call(ownerCredential, "resume", { agentId: waiter.agentId }));
  yield* oneWake(waitId, waiter, [settled(member)]);
})));

it.live("W15 catches stop cancelling only one open wait or committing cancellation outside the stop transaction", () => run((runner) => Effect.gen(function* () {
  const waiter = yield* spawn(rig, runner);
  const member = yield* spawn(rig, runner, waiter);
  const turn = yield* send(runner, member, "Still running.");
  const ids = [success(yield* waitFor(waiter, [member])).waitId, success(yield* waitFor(waiter, [member])).waitId];
  const before = yield* headSequence;
  success(yield* call(ownerCredential, "stop", { agentId: waiter.agentId }));
  const batch = appendWith(yield* logAfter(before), (row) => row.event._tag === "AgentStopped");
  expect(tagged(batch, "WaitCancelled").map((event) => event.waitId).sort()).toEqual([...ids].sort());
  yield* finish(runner, member, turn);
  for (const id of ids) { expect((yield* waitRow(id))?.status).toBe("cancelled"); yield* noWake(id); }
})));

for (const cause of ["stop", "crash"] as const) {
  it.live(`W16 ${cause}: catches an already queued wake sent to a stopped or crashed waiter`, () => run((runner) => Effect.gen(function* () {
    const waiter = yield* spawn(rig, runner);
    const member = yield* spawn(rig, runner, waiter);
    yield* send(runner, waiter, "Keep this turn open.");
    const waitId = success(yield* waitFor(waiter, [member])).waitId;
    const wake = yield* oneWake(waitId, waiter, [settled(member)]);
    expect((yield* deliveryRow(wake.id))?.status).toBe("queued");
    if (cause === "stop") success(yield* call(ownerCredential, "stop", { agentId: waiter.agentId }));
    else yield* crash(runner, waiter);
    expect((yield* eventually(deliveryRow(wake.id), (row) => row?.status === "withdrawn"))?.status).toBe("withdrawn");
    expect(runner.callsOf("prompt").some((call) => call.input.delivery.id === wake.id)).toBe(false);
  })));
}

it.live("W17 catches recovery omitting an already settled open wait or emitting duplicate wakes on repeated recovery", () => Effect.gen(function* () {
  let waiter!: Spawned;
  let member!: Spawned;
  let waitId = "";
  yield* run((runner) => Effect.gen(function* () {
    waiter = yield* spawn(rig, runner);
    member = yield* spawn(rig, runner, waiter);
    const turn = yield* send(runner, member, "Committed finish at recovery boundary.");
    waitId = success(yield* waitFor(waiter, [member])).waitId;
    yield* accept(runner, member, turn);
    // Historical log fixture: the resolving event exists but the old process
    // died before checking the wait. Recovery must repair that old prefix.
    yield* appendSetup([eventOf({ _tag: "TurnEnded", agentId: member.agentId, compact: false })]);
    expect((yield* waitRow(waitId))?.status).toBe("open");
  }));
  yield* run(() => Effect.gen(function* () {
    const { recheckWaits } = yield* loadWaits();
    yield* recheckWaits();
    yield* oneWake(waitId, waiter, [settled(member)]);
    yield* recheckWaits();
    expect(yield* wakeRows(waitId)).toHaveLength(1);
  }));
}));

it.live("W18 catches a blocking wait counted against its caller's settled status or creating a wake delivery", () => run((runner) => Effect.gen(function* () {
  const parent = yield* spawn(rig, runner);
  const caller = yield* spawn(rig, runner, parent);
  const member = yield* spawn(rig, runner, caller);
  const turn = yield* send(runner, member, "Running.");
  const fiber = yield* waitFor(caller, [member], "all", true).pipe(Effect.forkChild);
  const open = yield* eventually(waitsOf(caller), (rows) => rows.length === 1);
  expect(open).toHaveLength(1);
  const parentWait = success(yield* waitFor(parent, [caller])).waitId;
  yield* oneWake(parentWait, parent, [settled(caller)]);
  yield* finish(runner, member, turn);
  const reply = success(yield* Fiber.join(fiber));
  expect(reply).toMatchObject({ outcome: "satisfied", members: [settled(member)] });
  expect(yield* wakeRows(reply.waitId)).toEqual([]);
})));

for (const timing of ["already held", "arrives while blocked"] as const) {
  it.live(`W19 ${timing}: catches a blocking wait deadlocking on a request routed to its caller`, () => run((runner) => Effect.gen(function* () {
    const caller = yield* spawn(rig, runner);
    const member = yield* spawn(rig, runner, caller);
    yield* send(runner, member, "Need permission.");
    if (timing === "already held") yield* requestPermission(runner, member);
    const fiber = yield* waitFor(caller, [member], "all", true).pipe(Effect.forkChild);
    if (timing === "arrives while blocked") {
      expect(yield* eventually(waitsOf(caller), (rows) => rows.length === 1)).toHaveLength(1);
      yield* requestPermission(runner, member);
    }
    const reply = success(yield* Fiber.join(fiber));
    expect(reply.outcome).toBe("request-held");
    expect(yield* wakeRows(reply.waitId)).toEqual([]);
  })));
}

it.live("W20 catches blocking connection closure leaving a wait open or producing a wake", () => run((runner) => Effect.gen(function* () {
  const caller = yield* spawn(rig, runner);
  const member = yield* spawn(rig, runner, caller);
  yield* send(runner, member, "Not finished.");
  const fiber = yield* waitFor(caller, [member], "all", true).pipe(Effect.forkChild);
  const opened = yield* eventually(waitsOf(caller), (rows) => rows.length === 1);
  expect(opened).toHaveLength(1);
  yield* Fiber.interrupt(fiber);
  expect((yield* eventually(waitRow(opened[0]!.waitId), (row) => row?.status === "cancelled"))?.status).toBe("cancelled");
  expect(tagged(yield* readLog, "WaitCancelled")).toContainEqual(expect.objectContaining({ waitId: opened[0]!.waitId }));
  expect(yield* wakeRows(opened[0]!.waitId)).toEqual([]);
})));


it.live("W21 catches stop leaving a blocking wait open, hanging its caller, or creating a wake", () => run((runner) => Effect.gen(function* () {
  const caller = yield* spawn(rig, runner);
  const member = yield* spawn(rig, runner, caller);
  yield* send(runner, member, "Keep running after the caller stops.");
  const fiber = yield* waitFor(caller, [member], "all", true).pipe(Effect.forkChild);
  const opened = yield* eventually(waitsOf(caller), (rows) => rows.length === 1);
  expect(opened).toHaveLength(1);
  const before = yield* headSequence;
  success(yield* call(ownerCredential, "stop", { agentId: caller.agentId }));
  const reply = success(yield* Fiber.join(fiber));
  expect(reply).toMatchObject({ outcome: "cancelled", waitId: opened[0]!.waitId });
  const batch = appendWith(yield* logAfter(before), (row) => row.event._tag === "AgentStopped");
  expect(tagged(batch, "WaitCancelled")).toContainEqual(expect.objectContaining({ waitId: opened[0]!.waitId }));
  expect(yield* wakeRows(reply.waitId)).toEqual([]);
})));
