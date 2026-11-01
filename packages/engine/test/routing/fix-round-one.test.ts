import { it } from "@effect/vitest";
import type { DeliveryId } from "@shepherd/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { makeRedactor } from "../../src/identity/redactor.ts";
import { RunnerRejected } from "../../src/runner/Runner.ts";
import { compareViews } from "../../src/views/compare.ts";
import {
  agentCredential, agentRow, appendSetup, call, eventOf, failureOf, headSequence,
  logAfter, makeFakeSecrets, makeRig, ownerCredential, provideRig, readLog,
  removeRig, seedAccount, seedHarness, startPayload, success, type Rig,
} from "../support/handlerRig.ts";
import { incarnationOf, makeFakeRunner } from "../support/fakeRunner.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import {
  appendWith, deliveryRow, eventually, pause, questionRow, requestPermission,
  requestRow, snapshot, tagged,
} from "../support/routingRig.ts";
import {
  accept, crash, deliveryRig, finish, notice, oneWake, promptsTo, send, spawn,
  waitFor, waitRow,
} from "../support/deliveryRig.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("SHEPHERD_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });
const run = <A, E, R>(body: Parameters<typeof deliveryRig<A, E, R>>[1], redactor?: Parameters<typeof deliveryRig>[2]) =>
  deliveryRig(rig, (runner) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    return yield* body(runner);
  }), redactor).pipe(Effect.orDie);

for (const method of ["prompt", "compact"] as const) {
  it.live(`A1 ${method}: catches a send without the live spawn's incarnation`, () => run((runner) => Effect.gen(function* () {
    const target = yield* spawn(rig, runner);
    success(yield* call(ownerCredential, method, { agentId: target.agentId, ...(method === "prompt" ? { text: "Bound to this process." } : {}) }));
    const calls = yield* eventually(Effect.sync(() => runner.callsOf(method)), (calls) => calls.length === 1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.input.incarnation).toBe(incarnationOf(target.token));
  })));
}

for (const relationship of ["direct child", "inherited grandchild"] as const) {
  it.live(`F1 ${relationship}: catches wait rejecting an effective parent's authorized member`, () => run((runner) => Effect.gen(function* () {
    const caller = yield* spawn(rig, runner);
    const child = yield* spawn(rig, runner, caller);
    const member = relationship === "direct child" ? child : yield* spawn(rig, runner, child);
    if (relationship === "inherited grandchild") {
      const turn = yield* send(runner, child, "Pause before acceptance.");
      yield* notice(runner, child, { _tag: "promptReply", deliveryId: turn, outcome: { _tag: "pause", reason: "signed-out", error: "Signed out." } });
      expect((yield* eventually(agentRow(child.agentId), (row) => row?.state._tag === "paused"))?.state._tag).toBe("paused");
    }
    const before = yield* headSequence;
    const reply = success(yield* waitFor(caller, [member]));
    expect(tagged(yield* logAfter(before), "WaitOpened")).toContainEqual(expect.objectContaining({
      agentId: caller.agentId, waitId: reply.waitId, members: [member.agentId],
    }));
  })));
}

for (const relationship of ["unrelated", "own parent", "sibling", "mixed"] as const) {
  it.live(`F1 ${relationship}: catches wait disclosing a member outside the caller's parent rights`, () => run((runner) => Effect.gen(function* () {
    const parent = yield* spawn(rig, runner);
    const caller = yield* spawn(rig, runner, parent);
    const child = yield* spawn(rig, runner, caller);
    const sibling = yield* spawn(rig, runner, parent);
    const unrelated = yield* spawn(rig, runner);
    const members = relationship === "own parent" ? [parent] : relationship === "sibling" ? [sibling]
      : relationship === "mixed" ? [child, unrelated] : [unrelated];
    const before = yield* headSequence;
    const outcome = yield* waitFor(caller, members);
    // Inspect the durable effect as well as the command's refusal.
    expect(tagged(yield* logAfter(before), "WaitOpened")).toEqual([]);
    expect(failureOf(outcome)).toEqual({ _tag: "CommandRefused", reason: "command refused" });
    expect(Object.values((yield* snapshot).waits).filter((row) => row.agentId === caller.agentId)).toEqual([]);
  })));
}

it.live("F2 accepted error: catches content acceptance swallowing the terminal error or exposing its secret in the sender's return", () => {
  const secret = "accepted-error-key-9ad1e788";
  return run((runner) => Effect.gen(function* () {
    const sender = yield* spawn(rig, runner);
    const target = yield* spawn(rig, runner, sender);
    const id = yield* send(runner, target, "Inspect the build.", sender);
    yield* accept(runner, target, id);
    yield* notice(runner, target, { _tag: "promptReply", deliveryId: id, outcome: { _tag: "error", error: `Rejected key ${secret}.` } });
    const state = yield* eventually(agentRow(target.agentId), (row) => row?.state._tag === "idle");
    expect(state?.state._tag).toBe("idle");
    const rows = yield* readLog;
    const returned = tagged(rows, "DeliveryReturned").filter((event) => event.deliveryId === id);
    expect(returned).toHaveLength(1);
    expect(returned[0]).toMatchObject({ sender: { _tag: "agent", agentId: sender.agentId }, reason: "Rejected key [REDACTED]." });
    const notices = Object.values((yield* snapshot).deliveries).filter((row) => row.target === sender.agentId && JSON.stringify(row.content).includes(id));
    expect(notices).toHaveLength(1);
    expect(JSON.stringify(notices[0]?.content)).toContain("Rejected key [REDACTED].");
    expect((yield* deliveryRow(id))?.status).not.toBe("queued");
    expect(tagged(rows, "DeliveryRequeued").filter((event) => event.deliveryId === id)).toEqual([]);
    expect(JSON.stringify(rows)).not.toContain(secret);
    expect(JSON.stringify(yield* snapshot)).not.toContain(secret);
    expect(JSON.stringify(runner.callsOf("prompt"))).not.toContain(secret);
  }), makeRedactor({ secrets: () => [Redacted.make(secret)], tokenHashes: () => new Set<string>() }).layer);
});

for (const reason of ["out-of-usage", "signed-out"] as const) {
  it.live(`F2 accepted pause ${reason}: catches an accepted turn requeued or paused with midTurn=false`, () => run((runner) => Effect.gen(function* () {
    const target = yield* spawn(rig, runner);
    const id = yield* send(runner, target, "Already producing content.");
    yield* accept(runner, target, id);
    const before = yield* headSequence;
    yield* notice(runner, target, { _tag: "promptReply", deliveryId: id, outcome: { _tag: "pause", reason, error: "Account unavailable." } });
    expect((yield* eventually(agentRow(target.agentId), (row) => row?.state._tag === "paused"))?.state).toEqual({
      _tag: "paused", reason: reason === "out-of-usage" ? "limit" : "signed-out", midTurn: true,
    });
    expect((yield* deliveryRow(id))?.status).toBe("accepted");
    expect(tagged(yield* logAfter(before), "DeliveryRequeued")).toEqual([]);
    expect(promptsTo(runner, target).map((call) => call.input.delivery.id)).toEqual([id]);
  })));
}

for (const terminal of ["error", "pause"] as const) {
  it.live(`F2 duplicate error after accepted ${terminal}: catches a second terminal reply writing another transition or return`, () => run((runner) => Effect.gen(function* () {
    const target = yield* spawn(rig, runner);
    const id = yield* send(runner, target, "Accepted work.");
    yield* accept(runner, target, id);
    yield* notice(runner, target, { _tag: "promptReply", deliveryId: id, outcome: terminal === "error"
      ? { _tag: "error", error: "First failure." }
      : { _tag: "pause", reason: "out-of-usage", error: "Usage limit." } });
    // A content acknowledgement is not a terminal reply; this first terminal
    // reply must take effect before the duplicate can be tested.
    expect((yield* eventually(agentRow(target.agentId), (row) => row?.state._tag === (terminal === "error" ? "idle" : "paused")))?.state._tag)
      .toBe(terminal === "error" ? "idle" : "paused");
    const before = yield* headSequence;
    yield* notice(runner, target, { _tag: "promptReply", deliveryId: id, outcome: { _tag: "error", error: "Duplicate failure." } });
    yield* pause(80);
    expect(yield* logAfter(before)).toEqual([]);
  })));
}

it.live("F2 stale error: catches an older accepted delivery's reply ending the next turn", () => run((runner) => Effect.gen(function* () {
  const target = yield* spawn(rig, runner);
  const first = yield* send(runner, target, "First.");
  const second = success(yield* call(ownerCredential, "prompt", { agentId: target.agentId, text: "Second." })).deliveryId;
  yield* finish(runner, target, first);
  expect((yield* eventually(deliveryRow(second), (row) => row?.status === "sent"))?.status).toBe("sent");
  const before = yield* headSequence;
  yield* notice(runner, target, { _tag: "promptReply", deliveryId: first, outcome: { _tag: "error", error: "Late first failure." } });
  yield* pause(80);
  expect(yield* logAfter(before)).toEqual([]);
  expect((yield* agentRow(target.agentId))?.state._tag).toBe("working");
  expect((yield* deliveryRow(second))?.status).toBe("sent");
})));

for (const method of ["prompt", "compact"] as const) {
it.live(`F3 stop lane ${method}: catches a reserved send reaching the process after stop has returned`, () => run((runner) => Effect.gen(function* () {
  const target = yield* spawn(rig, runner);
  const reached: Array<string> = [];
  runner.script<"prompt" | "compact">(method, (input) => Effect.sync(() => { reached.push(input.delivery.id); }));
  const held = runner.holdNext(method);
  yield* Effect.addFinalizer(() => held.release);
  const id = success(yield* call(ownerCredential, method, { agentId: target.agentId, ...(method === "prompt" ? { text: "Held at the process boundary." } : {}) })).deliveryId;
  yield* held.entered;
  expect((yield* deliveryRow(id))?.status).toBe("sent");
  const stopping = yield* call(ownerCredential, "stop", { agentId: target.agentId }).pipe(Effect.forkChild);
  yield* pause(80);
  const returnedBeforeRelease = stopping.pollUnsafe() !== undefined;
  const reachedAtReturn = reached.length;
  yield* held.release;
  success(yield* Fiber.join(stopping));
  yield* pause(80);
  const methods = runner.calls.filter((call) => call.input.agentId === target.agentId).map((call) => call.method);
  if (returnedBeforeRelease) {
    // An incarnation guard may reject the stale attempt; a successful
    // process send must still never occur after stop.
    expect(reached.length).toBe(reachedAtReturn);
  } else {
    expect(methods.lastIndexOf(method)).toBeLessThan(methods.lastIndexOf("stop"));
    expect(reached).toEqual([id]);
  }
  expect((yield* deliveryRow(id))?.status).not.toBe("sent");
  expect(tagged(yield* readLog, "DeliveryWithdrawn")).toContainEqual(expect.objectContaining({ deliveryId: id }));
  expect((yield* agentRow(target.agentId))?.state._tag).toBe("stopped");
})));
}

it.live("F3 incarnation lane: catches an old reserved prompt acting on a resumed process or reordering the new queue", () => run((runner) => Effect.gen(function* () {
  const target = yield* spawn(rig, runner);
  const successful: Array<{ id: string; incarnation: unknown }> = [];
  runner.script("prompt", (input) => Effect.sync(() => { successful.push({ id: input.delivery.id, incarnation: (input as { incarnation?: string }).incarnation }); }));
  const held = runner.holdNext("prompt");
  yield* Effect.addFinalizer(() => held.release);
  const oldId = success(yield* call(ownerCredential, "prompt", { agentId: target.agentId, text: "Old run." })).deliveryId;
  yield* held.entered;
  const stopping = yield* call(ownerCredential, "stop", { agentId: target.agentId }).pipe(Effect.forkChild);
  yield* pause(80);
  const stopReturned = stopping.pollUnsafe() !== undefined;
  // Both legal designs are supported: lifecycle waits on the send lane, or
  // it invalidates the old incarnation before the held send is released.
  if (!stopReturned) yield* held.release;
  success(yield* Fiber.join(stopping));
  success(yield* call(ownerCredential, "resume", { agentId: target.agentId }));
  const loaded = runner.callsOf("load").at(-1)!;
  const resumed = { agentId: target.agentId, token: Redacted.value(loaded.input.token) };
  // Unit 6a owns SessionOpened after load, as in the existing spawn fixture.
  if ((yield* agentRow(target.agentId))?.state._tag === "starting") {
    yield* appendSetup([eventOf({ _tag: "SessionOpened", agentId: target.agentId, ...{ session: loaded.input.session, protocolVersion: 2, reloadable: true } })]);
  }
  const first = success(yield* call(ownerCredential, "prompt", { agentId: target.agentId, text: "New first." })).deliveryId;
  const second = success(yield* call(ownerCredential, "prompt", { agentId: target.agentId, text: "New second." })).deliveryId;
  if (stopReturned) yield* held.release;
  expect((yield* eventually(deliveryRow(first), (row) => row?.status === "sent"))?.status).toBe("sent");
  yield* pause(80);
  if (stopReturned) expect(successful.some((entry) => entry.id === oldId)).toBe(false);
  expect(successful.filter((entry) => entry.id === first)).toEqual([{ id: first, incarnation: incarnationOf(resumed.token) }]);
  expect((yield* deliveryRow(second))?.status).toBe("queued");
  yield* finish(runner, resumed, first);
  expect((yield* eventually(deliveryRow(second), (row) => row?.status === "sent"))?.status).toBe("sent");
  expect(successful.filter((entry) => entry.id === first || entry.id === second).map((entry) => entry.id)).toEqual([first, second]);
})));

it.live("F6 independent lanes: catches a slow send to A holding up B's automatic dispatch", () => run((runner) => Effect.gen(function* () {
  const a = yield* spawn(rig, runner);
  const b = yield* spawn(rig, runner);
  const held = runner.holdNext("prompt");
  yield* Effect.addFinalizer(() => held.release);
  success(yield* call(ownerCredential, "prompt", { agentId: a.agentId, text: "Slow transport." }));
  yield* held.entered;
  const bId = success(yield* call(ownerCredential, "prompt", { agentId: b.agentId, text: "Independent work." })).deliveryId;
  const row = yield* eventually(deliveryRow(bId), (row) => row?.status === "sent");
  // Capture before release, then release even on assertion failure.
  const sentWhileAHeld = promptsTo(runner, b).map((call) => call.input.delivery.id);
  yield* held.release;
  expect(row?.status).toBe("sent");
  expect(sentWhileAHeld).toEqual([bId]);
})));

it.live("F4 correlated end: catches A's duplicate turn end ending B and dispatching C", () => run((runner) => Effect.gen(function* () {
  const target = yield* spawn(rig, runner);
  const a = yield* send(runner, target, "A.");
  const b = success(yield* call(ownerCredential, "prompt", { agentId: target.agentId, text: "B." })).deliveryId;
  const c = success(yield* call(ownerCredential, "prompt", { agentId: target.agentId, text: "C." })).deliveryId;
  yield* finish(runner, target, a);
  expect((yield* eventually(deliveryRow(b), (row) => row?.status === "sent"))?.status).toBe("sent");
  const before = yield* headSequence;
  yield* runner.emit({ _tag: "turnEnded", agentId: target.agentId, incarnation: incarnationOf(target.token), deliveryId: a as DeliveryId });
  yield* pause(80);
  expect(tagged(yield* logAfter(before), "TurnEnded")).toEqual([]);
  expect((yield* agentRow(target.agentId))?.state._tag).toBe("working");
  expect((yield* deliveryRow(b))?.status).toBe("sent");
  expect((yield* deliveryRow(c))?.status).toBe("queued");
  yield* finish(runner, target, b);
  expect((yield* eventually(deliveryRow(c), (row) => row?.status === "sent"))?.status).toBe("sent");
  expect(promptsTo(runner, target).map((call) => call.input.delivery.id)).toEqual([a, b, c]);
})));

it.live("F4 idle end: catches a duplicate turn end writing after the agent has become idle", () => run((runner) => Effect.gen(function* () {
  const target = yield* spawn(rig, runner);
  const id = yield* send(runner, target, "Only turn.");
  yield* finish(runner, target, id);
  const before = yield* headSequence;
  yield* runner.emit({ _tag: "turnEnded", agentId: target.agentId, incarnation: incarnationOf(target.token), deliveryId: id as DeliveryId });
  yield* pause(80);
  expect(yield* logAfter(before)).toEqual([]);
})));

for (const cause of ["stop", "crash"] as const) {
  it.live(`F5 queued answer ${cause}: catches an unsent answer silently discarded when its asker disappears`, () => run((runner) => Effect.gen(function* () {
    const answerer = yield* spawn(rig, runner);
    const asker = yield* spawn(rig, runner, answerer);
    yield* send(runner, asker, "Keep the asker busy.");
    const questionId = success(yield* call(agentCredential(asker.token), "ask", { text: "Which branch?" })).questionId;
    success(yield* call(agentCredential(answerer.token), "answer", { kind: "question", id: questionId, text: "Use the feature branch." }));
    const id = (yield* questionRow(questionId))!.answerDeliveryId!;
    expect((yield* deliveryRow(id))?.status).toBe("queued");
    const before = yield* headSequence;
    if (cause === "stop") success(yield* call(ownerCredential, "stop", { agentId: asker.agentId }));
    else yield* crash(runner, asker);
    const rows = yield* eventually(logAfter(before), (rows) => tagged(rows, "DeliveryReturned").some((event) => event.deliveryId === id));
    expect(tagged(rows, "DeliveryWithdrawn")).toContainEqual(expect.objectContaining({ deliveryId: id }));
    expect(tagged(rows, "DeliveryReturned").filter((event) => event.deliveryId === id)).toEqual([
      { _tag: "DeliveryReturned", agentId: asker.agentId, deliveryId: id, sender: { _tag: "agent", agentId: answerer.agentId }, reason: "not delivered" },
    ]);
    const notifications = Object.values((yield* snapshot).deliveries).filter((row) => row.target === answerer.agentId && JSON.stringify(row.content).includes(id));
    expect(notifications).toHaveLength(1);
    expect(JSON.stringify(notifications[0]?.content)).toContain("not delivered");
    expect(promptsTo(runner, asker).some((call) => call.input.delivery.id === id)).toBe(false);
  })));

  it.live(`F5 routed permission ${cause}: catches returning a still-open permission instead of withdrawing and moving it`, () => run((runner) => Effect.gen(function* () {
    const ancestor = yield* spawn(rig, runner);
    const holder = yield* spawn(rig, runner, ancestor);
    const asker = yield* spawn(rig, runner, holder);
    yield* send(runner, holder, "Keep the holder busy.");
    const permission = yield* requestPermission(runner, asker);
    expect((yield* deliveryRow(permission.row.deliveryId))?.status).toBe("queued");
    const before = yield* headSequence;
    if (cause === "stop") success(yield* call(ownerCredential, "stop", { agentId: holder.agentId }));
    else yield* crash(runner, holder);
    expect((yield* deliveryRow(permission.row.deliveryId))?.status).toBe("withdrawn");
    const moved = yield* requestRow(permission.id);
    expect(moved?.holder).toEqual({ _tag: "agent", agentId: ancestor.agentId });
    expect(moved?.deliveryId).not.toBe(permission.row.deliveryId);
    expect((yield* deliveryRow(moved!.deliveryId))?.target).toBe(ancestor.agentId);
    expect(tagged(yield* logAfter(before), "DeliveryReturned").filter((event) => event.deliveryId === permission.row.deliveryId)).toEqual([]);
  })));

  it.live(`F5 wait wake ${cause}: catches a withdrawn wake generating a spurious return`, () => run((runner) => Effect.gen(function* () {
    const waiter = yield* spawn(rig, runner);
    const member = yield* spawn(rig, runner, waiter);
    yield* send(runner, waiter, "Keep the wake queued.");
    const waitId = success(yield* waitFor(waiter, [member])).waitId;
    const wake = yield* oneWake(waitId, waiter, [{ agentId: member.agentId, reason: "settled" }]);
    expect((yield* deliveryRow(wake.id))?.status).toBe("queued");
    const before = yield* headSequence;
    if (cause === "stop") success(yield* call(ownerCredential, "stop", { agentId: waiter.agentId }));
    else yield* crash(runner, waiter);
    expect((yield* deliveryRow(wake.id))?.status).toBe("withdrawn");
    expect(tagged(yield* logAfter(before), "DeliveryReturned").filter((event) => event.deliveryId === wake.id)).toEqual([]);
  })));
}

for (const [name, whitespace] of [
  ["U+0085", "\u0085"], ["U+00A0", "\u00a0"], ["U+2028", "\u2028"],
  ["U+3000", "\u3000"], ["U+200B", "\u200b"], ["U+FEFF", "\ufeff"],
] as const) {
  for (const route of ["direct", "question", "owner"] as const) {
    it.live(`F7 ${name} ${route}: catches Unicode whitespace bypassing agent slash escaping or changing the owner's prompt`, () => run((runner) => Effect.gen(function* () {
      const parent = yield* spawn(rig, runner);
      const child = yield* spawn(rig, runner, parent);
      const text = `${whitespace}/compact`;
      let id: string;
      if (route === "question") {
        const questionId = success(yield* call(agentCredential(child.token), "ask", { text })).questionId;
        id = (yield* questionRow(questionId))!.deliveryId;
      } else id = yield* send(runner, child, text, route === "direct" ? parent : undefined);
      const target = route === "question" ? parent : child;
      expect((yield* eventually(deliveryRow(id), (row) => row?.status === "sent"))?.status).toBe("sent");
      const content = promptsTo(runner, target).find((call) => call.input.delivery.id === id)!.input.delivery.content;
      expect(content._tag).toBe("prompt");
      if (content._tag !== "prompt") throw new Error("Expected a prompt.");
      if (route === "owner") expect(content.text).toBe(text);
      else {
        expect(content.text).toContain(`${whitespace}\\/compact`);
        expect(content.text).not.toContain(text);
      }
      expect(runner.callsOf("compact")).toEqual([]);
    })));
  }
}

it.live("F8 compact view: catches a missing live compact flag or a flag retained after its turn end", () => run((runner) => Effect.gen(function* () {
  const target = yield* spawn(rig, runner);
  const id = success(yield* call(ownerCredential, "compact", { agentId: target.agentId })).deliveryId;
  expect((yield* eventually(deliveryRow(id), (row) => row?.status === "sent"))?.status).toBe("sent");
  expect(yield* agentRow(target.agentId)).toHaveProperty("compacting", true);
  expect((yield* compareViews()).differences).toEqual([]);
  yield* finish(runner, target, id);
  expect(yield* agentRow(target.agentId)).toHaveProperty("compacting", false);
})));

it.live("I77 commit interruption: catches blocking wait cancellation registered after an interruptible post-COMMIT window", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner();
  const committed = yield* Deferred.make<string>();
  const release = yield* Deferred.make<void>();
  return yield* provideRig(rig, {
    runner, secrets: makeFakeSecrets(),
    wrapLog: (real) => ({ ...real, transact: (use) => {
      let opened: string | undefined;
      return real.transact((append) => use((...args) => {
        const wait = args[3].find((event) => event._tag === "WaitOpened");
        if (wait?._tag === "WaitOpened") opened = wait.waitId;
        return append(...args);
      })).pipe(Effect.tap(() => opened === undefined ? Effect.void : Effect.gen(function* () {
        yield* Deferred.succeed(committed, opened!);
        yield* Deferred.await(release);
      })));
    } }),
  }, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedAccount(); yield* seedHarness(); yield* runner.subscribed;
    const caller = yield* spawn(rig, runner);
    const member = yield* spawn(rig, runner, caller);
    yield* send(runner, member, "Keep the blocking wait open.");
    const waiting = yield* waitFor(caller, [member], "all", true).pipe(Effect.forkChild);
    const waitId = yield* Deferred.await(committed);
    expect((yield* waitRow(waitId))?.status).toBe("open");
    // Interrupt while the execute fiber is suspended after the real commit,
    // before it can enter the blocking effect. Release also permits a fixed
    // uninterruptible opening/registration step to finish and clean up.
    const interrupting = yield* Fiber.interrupt(waiting).pipe(Effect.forkChild);
    yield* pause(40);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(interrupting);
    expect((yield* waitRow(waitId))?.status).toBe("cancelled");
    expect(tagged(yield* readLog, "WaitCancelled")).toContainEqual(expect.objectContaining({ waitId, reason: "connection closed" }));
  }));
}).pipe(Effect.orDie));

it.live("I78 rejected start: catches an open wait left unresolved outside the AgentStartFailed append", () => run((runner) => Effect.gen(function* () {
  const parent = yield* spawn(rig, runner);
  const release = yield* Deferred.make<void>();
  runner.script("start", () => Deferred.await(release).pipe(Effect.andThen(Effect.fail(new RunnerRejected({ reason: "Adapter refused." })))));
  const starting = yield* call(agentCredential(parent.token), "start", startPayload(rig)).pipe(Effect.forkChild);
  const calls = yield* eventually(Effect.sync(() => runner.callsOf("start")), (calls) => calls.length === 2);
  expect(calls).toHaveLength(2);
  const target = { agentId: calls[1]!.input.agentId, token: Redacted.value(calls[1]!.input.token) };
  const waitId = success(yield* waitFor(parent, [target])).waitId;
  expect((yield* waitRow(waitId))?.status).toBe("open");
  const before = yield* headSequence;
  yield* Deferred.succeed(release, undefined);
  success(yield* Fiber.join(starting));
  const batch = appendWith(yield* logAfter(before), (row) => row.event._tag === "AgentStartFailed");
  expect(tagged(batch, "WaitMemberResolved")).toContainEqual(expect.objectContaining({ waitId, member: { agentId: target.agentId, reason: "crashed" } }));
  expect(tagged(batch, "WaitSatisfied")).toContainEqual(expect.objectContaining({ waitId }));
  expect((yield* waitRow(waitId))?.status).toBe("satisfied");
})));
