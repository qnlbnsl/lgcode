import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { it } from "@effect/vitest";
import type { EventEnvelope, RolesAction } from "@lgtm/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import { TestClock } from "effect/testing";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { serve } from "../../../src/api/server.ts";
import { CommandHandler } from "../../../src/commands/CommandHandler.ts";
import { boardReactor } from "../../../src/board/reactor.ts";
import { engineLists, type EngineLists } from "../../../src/pieces/lists.ts";
import { stallWatchLoop, makeStallWatchLoop, type StallWatchRule } from "../../../src/roles/stall-watch/loop.ts";
import { makeRules } from "../../../src/roles/stall-watch/rules/runtime.ts";
import { withinCapacityLimit } from "../../../src/roles/stall-watch/switch.ts";
import { capacityHoldCount } from "../../../src/routing/deliveries.ts";
import type { RolesView } from "../../../src/roles/view.ts";
import { alertLog } from "../../support/alertsRig.ts";
import { hold } from "../../support/capacityRig.ts";
import { notice, send, spawn, type Spawned } from "../../support/deliveryRig.ts";
import { fixtureClient } from "../../support/fixturePiece.ts";
import { makeFakeRunner, incarnationOf, type FakeRunner } from "../../support/fakeRunner.ts";
import { makeRig, removeRig, seedAccount, seedHarness, type Rig } from "../../support/handlerRig.ts";
import { recover, provideRestart } from "../../support/restartRig.ts";
import { eventually, pause, snapshot } from "../../support/routingRig.ts";
import { registerRebuildCheck } from "../../support/rebuildCheck.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("LGTM_HOME", rig.stateFolder); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); removeRig(rig); });
const quiet: EngineLists = { ...engineLists, reactors: {} };
const run = <A, E, R>(lists: EngineLists, restarting: boolean, body: (runner: FakeRunner) => Effect.Effect<A, E, R>) => Effect.gen(function* () {
  const runner = yield* makeFakeRunner();
  return yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck();
    if (restarting) {
      yield* recover;
      yield* boardReactor.pipe(Effect.forkScoped);
    }
    else { yield* seedAccount(); yield* seedHarness(); }
    yield* runner.subscribed;
    return yield* body(runner);
  }), { recovering: restarting, lists, capacityHoldCondition: (id, state) => withinCapacityLimit(state, id, capacityHoldCount(state, id)) });
}) as Effect.Effect<A, E>;
const records = (tag: RolesAction["_tag"]) => snapshot.pipe(Effect.map((state) => (state.roles as RolesView).actions.filter((row) => row._tag === tag)));
const serviceRows = (rows: ReadonlyArray<EventEnvelope>, tag: string) => rows.filter((row) => row.event._tag === tag
  && row.caller._tag === "service" && row.caller.service === "roles.stallWatch");
const ownerClient = Effect.gen(function* () {
  const bearer = randomBytes(32).toString("base64url");
  const socketPath = join(rig.stateFolder, "boundaries.sock");
  yield* serve({ socketPath, ownerCredential: Redacted.make(bearer), debug: true, lists: quiet });
  return yield* fixtureClient(socketPath, bearer, quiet as any);
});
// Stop outside the writer: earlier commands and their receipts have committed.
const cutBefore = (match: (name: string, payload: Record<string, unknown>) => boolean) => Effect.gen(function* () {
  const reached = yield* Deferred.make<void>();
  const wait = yield* Deferred.make<void>();
  const handler = yield* CommandHandler;
  const execute = handler.execute;
  const spy = vi.spyOn(handler, "execute").mockImplementation((caller, name, payload) => Effect.gen(function* () {
    if (caller._tag === "service" && caller.service === "roles.stallWatch" && match(name, payload as Record<string, unknown>)) {
      yield* Deferred.succeed(reached, undefined);
      yield* Deferred.await(wait);
    }
    return yield* execute(caller, name, payload);
  }));
  yield* Effect.addFinalizer(() => Effect.sync(() => spy.mockRestore()));
  return reached;
});
const matchesRecord = (tag: string) => (name: string, payload: Record<string, unknown>) => name === "roles.record"
  && (payload.action as { _tag: string })._tag === tag;

for (const boundary of ["receipt-before-hook", "resume-before-prompt", "prompt-before-post", "post-before-flush", "flush-before-record"] as const) {
  it.effect(`production crash recovery completes once after ${boundary}, including two real recovery startups`, () => Effect.gen(function* () {
    const hook = yield* Deferred.make<void>();
    const never = yield* Deferred.make<void>();
    const realResume = quiet.planners.resume!;
    const lists: EngineLists = boundary === "receipt-before-hook" ? { ...quiet, planners: { ...quiet.planners,
      resume: (input, payload) => realResume(input, payload).pipe(Effect.map((plan) => ({ ...plan,
        afterCommit: Deferred.succeed(hook, undefined).pipe(Effect.andThen(Deferred.await(never))),
      }))),
    } } : quiet;
    let worker: Spawned;
    let lead: Spawned;
    let before: ReadonlyArray<EventEnvelope>;
    yield* run(lists, false, (runner) => Effect.gen(function* () {
      lead = yield* spawn(rig, runner, undefined, { role: "lead", groups: [] });
      worker = yield* spawn(rig, runner, lead);
      const reached = boundary === "receipt-before-hook" ? hook : yield* cutBefore(boundary === "resume-before-prompt"
        ? (name) => name === "prompt" : boundary === "prompt-before-post" ? (name) => name === "board.post"
        : boundary === "post-before-flush" ? (name) => name === "board.flush" : matchesRecord("roles.CrashRetried"));
      yield* stallWatchLoop.pipe(Effect.forkScoped);
      yield* eventually(snapshot, (state) => (state.roles as RolesView).baseline !== undefined);
      yield* runner.emit({ _tag: "exited", agentId: worker.agentId, incarnation: incarnationOf(worker.token), exitCode: 1, signal: null, stderr: "test crash" });
      yield* Deferred.await(reached);
      before = yield* alertLog;
      expect(serviceRows(before, "roles.CrashAdmitted")).toHaveLength(1);
      expect(serviceRows(before, "roles.CrashRetried")).toHaveLength(0);
      if (boundary === "receipt-before-hook") {
        expect((yield* snapshot).agents[worker.agentId]!.state._tag).toBe("starting");
        expect(runner.callsOf("load")).toHaveLength(0);
      }
      if (boundary === "post-before-flush" || boundary === "flush-before-record") expect(serviceRows(before, "board.PostWritten")).toHaveLength(1);
      if (boundary === "flush-before-record") expect(serviceRows(before, "board.WakeBuilt")).toHaveLength(1);
    }));
    let completed: ReadonlyArray<EventEnvelope>;
    for (const restart of [1, 2]) yield* run(quiet, true, () => Effect.gen(function* () {
      yield* stallWatchLoop.pipe(Effect.forkScoped);
      expect(yield* eventually(records("roles.CrashRetried"), (rows) => rows.length === 1)).toHaveLength(1);
      yield* pause(30);
      const rows = yield* alertLog;
      const carries = serviceRows(rows, "DeliveryQueued").filter((row) => row.event._tag === "DeliveryQueued"
        && row.event.delivery.target === worker!.agentId && row.event.delivery.content._tag === "prompt"
        && row.event.delivery.content.text.includes("You were resumed after a crash. Carry on with what you were doing."));
      expect(carries).toHaveLength(1);
      expect(serviceRows(rows, "StateChanged").filter((row) => row.event._tag === "StateChanged"
        && row.event.agentId === worker!.agentId && row.event.state._tag === "starting")).toHaveLength(1);
      expect(serviceRows(rows, "roles.CrashAdmitted")).toHaveLength(1);
      expect(serviceRows(rows, "board.PostWritten")).toHaveLength(1);
      expect(serviceRows(rows, "board.WakeBuilt")).toHaveLength(1);
      expect((yield* snapshot).agents[worker!.agentId]!.state._tag).toBe("working");
      expect((yield* snapshot).roles as RolesView).toMatchObject({ agents: { [worker!.agentId]: { crashRetries: 1 } } });
      if (restart === 1) completed = rows;
      else for (const tag of ["DeliveryQueued", "roles.CrashRetried", "board.PostWritten", "board.WakeBuilt"]) {
        expect(serviceRows(rows, tag).map((row) => [row.sequence, row.requestId, row.event]))
          .toEqual(serviceRows(completed!, tag).map((row) => [row.sequence, row.requestId, row.event]));
      }
    }));
  }), 20_000);
}

it.effect("a lagging stall watch cannot revive an admission cancelled by owner stop and manual resume", () => Effect.gen(function* () {
  let worker: Spawned;
  yield* run(quiet, false, (runner) => Effect.gen(function* () {
    worker = yield* spawn(rig, runner);
    const reached = yield* cutBefore((name) => name === "resume");
    const loop = yield* stallWatchLoop.pipe(Effect.forkScoped);
    yield* eventually(snapshot, (state) => (state.roles as RolesView).baseline !== undefined);
    yield* runner.emit({ _tag: "exited", agentId: worker.agentId, incarnation: incarnationOf(worker.token), exitCode: 1, signal: null, stderr: "test crash" });
    yield* Deferred.await(reached);
    expect(yield* records("roles.CrashAdmitted")).toHaveLength(1);
    const client = yield* ownerClient;
    yield* client.stop!({ requestId: "owner-cancels-admission", agentId: worker.agentId });
    yield* client.resume!({ requestId: "owner-resumes-before-catch-up", agentId: worker.agentId });
    expect(runner.callsOf("load")).toHaveLength(1);
    expect((yield* snapshot).agents[worker.agentId]!.state._tag).toBe("idle");
    expect(((yield* snapshot).roles as RolesView).agents[worker.agentId]!.openCrash).toBeUndefined();
    yield* Fiber.interrupt(loop);
  }));
  for (const attempt of [1, 2]) yield* run(quiet, true, () => Effect.gen(function* () {
    const consumed = yield* Deferred.make<void>();
    const observer: StallWatchRule = { onEvent: (_ctx, row) => row.event._tag === "roles.Snoozed" && row.event.group === `caught-up-${attempt}`
      ? Deferred.succeed(consumed, undefined).pipe(Effect.asVoid) : Effect.void };
    yield* makeStallWatchLoop([...makeRules(), observer]).pipe(Effect.forkScoped);
    const client = yield* ownerClient;
    yield* client["roles.snooze"]!({ requestId: `caught-up-${attempt}`, group: `caught-up-${attempt}`, until: 0 });
    yield* Deferred.await(consumed);
    expect(yield* records("roles.CrashRetried")).toHaveLength(0);
    expect(serviceRows(yield* alertLog, "DeliveryQueued")).toHaveLength(0);
    expect((yield* snapshot).agents[worker!.agentId]!.state._tag).toBe("idle");
  }));
}));

it.effect("a released capacity retry completes its missing action once after interruption and rebuild", () => Effect.gen(function* () {
  let worker: Spawned;
  let held: EventEnvelope;
  yield* run(quiet, false, (runner) => Effect.gen(function* () {
    worker = yield* spawn(rig, runner);
    const reached = yield* cutBefore(matchesRecord("roles.CapacityRetried"));
    yield* stallWatchLoop.pipe(Effect.forkScoped);
    yield* eventually(snapshot, (state) => (state.roles as RolesView).baseline !== undefined);
    const delivery = yield* send(runner, worker, "Retry once.");
    yield* hold(runner, worker, delivery);
    held = (yield* alertLog).findLast((row) => row.event._tag === "DeliveryHeld")!;
    yield* pause(30);
    yield* TestClock.adjust("5 minutes");
    yield* Deferred.await(reached);
    expect(serviceRows(yield* alertLog, "DeliveryReleased")).toHaveLength(1);
    expect(yield* records("roles.CapacityRetried")).toHaveLength(0);
  }));
  for (const attempt of [1, 2]) yield* run(quiet, true, () => Effect.gen(function* () {
    yield* stallWatchLoop.pipe(Effect.forkScoped);
    const actions = yield* eventually(records("roles.CapacityRetried"), (rows) => rows.length === 1);
    expect(actions).toMatchObject([{ agentId: worker!.agentId, triggerSequence: held!.sequence, occurrence: 1, noticeRecipient: "owner" }]);
    expect(actions[0]!.sourceSequence).toBeLessThan(actions[0]!.sequence);
    expect(((yield* snapshot).roles as RolesView).agents[worker!.agentId]!.capacityRetries).toBe(1);
    expect(serviceRows(yield* alertLog, "DeliveryReleased")).toHaveLength(1);
    const client = yield* ownerClient;
    const reply = yield* client["roles.actions.list"]!({ requestId: `list-${attempt}`, limit: 200, agentId: worker!.agentId });
    expect((reply.items as RolesAction[]).filter((row) => row._tag === "roles.CapacityRetried")).toHaveLength(1);
  }));
}));

for (const command of ["compact", "board.flush"] as const) {
  it.effect(`production cache ${command} keeps one effect and completes its action after interruption`, () => Effect.gen(function* () {
    const tag = command === "compact" ? "roles.CompactRequested" : "roles.CacheFlushed";
    let worker: Spawned;
    let original: EventEnvelope;
    yield* run(quiet, false, (runner) => Effect.gen(function* () {
      worker = yield* spawn(rig, runner);
      const reached = yield* cutBefore(matchesRecord(tag));
      yield* stallWatchLoop.pipe(Effect.forkScoped);
      yield* eventually(snapshot, (state) => (state.roles as RolesView).baseline !== undefined);
      const deliveryId = yield* send(runner, worker, "Warm the cache.");
      yield* notice(runner, worker, { _tag: "deliveryUpdate", deliveryId, kind: "message", replay: false, text: "Done." });
      yield* eventually(snapshot, (state) => state.deliveries[deliveryId]?.status === "accepted");
      yield* runner.emit({ _tag: "turnEnded", agentId: worker.agentId, incarnation: incarnationOf(worker.token), deliveryId: deliveryId as any,
        usage: { used: 200_000, cachedWrite1hTokens: 10, cachedWrite5mTokens: 0 } });
      yield* eventually(snapshot, (state) => state.agents[worker.agentId]?.state._tag === "idle");
      if (command === "board.flush") {
        const client = yield* ownerClient;
        yield* client["board.post"]!({ requestId: "cache-unread", direct: { _tag: "agent", agentId: worker.agentId },
          to: [{ _tag: "agent", agentId: worker.agentId }], text: "Handle this notice.", reply: "none" });
      }
      yield* pause(30);
      yield* TestClock.adjust("58 minutes");
      yield* Deferred.await(reached);
      const effects = serviceRows(yield* alertLog, command === "compact" ? "DeliveryQueued" : "board.WakeBuilt");
      expect(effects).toHaveLength(1);
      original = effects[0]!;
      if (command === "compact") expect(original.event).toMatchObject({ delivery: { content: { _tag: "compact" } } });
      expect(yield* records(tag)).toHaveLength(0);
    }));
    for (const attempt of [1, 2]) yield* run(quiet, true, () => Effect.gen(function* () {
      yield* stallWatchLoop.pipe(Effect.forkScoped);
      expect(yield* eventually(records(tag), (rows) => rows.length === 1)).toHaveLength(1);
      expect(serviceRows(yield* alertLog, command === "compact" ? "DeliveryQueued" : "board.WakeBuilt")
        .map((row) => [row.sequence, row.requestId, row.event])).toEqual([[original!.sequence, original!.requestId, original!.event]]);
    }));
  }), 15_000);
}

for (const boundary of ["nudge-before-flush", "nudge-before-notice", "notice-before-flush", "notice-before-record"] as const) {
  it.effect(`production team idle board nudge and notice complete once after ${boundary}`, () => Effect.gen(function* () {
    let worker: Spawned;
    let lead: Spawned;
    let nudge: EventEnvelope;
    let originalPosts: ReadonlyArray<EventEnvelope>;
    let originalWakes: ReadonlyArray<EventEnvelope>;
    yield* run(quiet, false, (runner) => Effect.gen(function* () {
      lead = yield* spawn(rig, runner, undefined, { role: "lead", groups: [] });
      worker = yield* spawn(rig, runner, lead, { groups: ["team"] });
      const reached = yield* cutBefore(boundary === "nudge-before-flush"
        ? (name, payload) => name === "board.flush" && payload.agentId === worker.agentId
        : boundary === "nudge-before-notice"
          ? (name, payload) => name === "board.post" && (payload.direct as { agentId?: string } | undefined)?.agentId === lead.agentId
          : boundary === "notice-before-flush"
            ? (name, payload) => name === "board.flush" && payload.agentId === lead.agentId
            : matchesRecord("roles.TeamIdleReported"));
      yield* stallWatchLoop.pipe(Effect.forkScoped);
      yield* eventually(snapshot, (state) => (state.roles as RolesView).baseline !== undefined);
      yield* pause(30);
      yield* TestClock.adjust("60 minutes");
      yield* Deferred.await(reached);
      const rows = yield* alertLog;
      originalPosts = serviceRows(rows, "board.PostWritten");
      originalWakes = serviceRows(rows, "board.WakeBuilt");
      const nudges = originalPosts.filter((row) => row.event._tag === "board.PostWritten"
        && row.event.to.some((to) => to._tag === "agent" && to.agentId === worker.agentId));
      expect(nudges).toHaveLength(1);
      nudge = nudges[0]!;
      expect(nudge.event).toMatchObject({ reply: "none", author: { _tag: "service", service: "roles.stallWatch" } });
      expect(originalPosts).toHaveLength(boundary === "nudge-before-flush" || boundary === "nudge-before-notice" ? 1 : 2);
      expect(originalWakes).toHaveLength(boundary === "nudge-before-flush" ? 0 : boundary === "notice-before-record" ? 2 : 1);
      expect(yield* records("roles.TeamIdleReported")).toHaveLength(0);
    }));
    let completed: ReadonlyArray<EventEnvelope>;
    for (const attempt of [1, 2]) yield* run(quiet, true, () => Effect.gen(function* () {
      yield* stallWatchLoop.pipe(Effect.forkScoped);
      const actions = yield* eventually(records("roles.TeamIdleReported"), (rows) => rows.length === 1);
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({ agentId: worker!.agentId, group: "team", noticeRecipient: lead!.agentId, occurrence: 1 });
      const rows = yield* alertLog;
      const posts = serviceRows(rows, "board.PostWritten");
      const wakes = serviceRows(rows, "board.WakeBuilt");
      expect(posts).toHaveLength(2);
      expect(wakes).toHaveLength(2);
      expect(posts.filter((row) => row.sequence === nudge!.sequence)).toEqual([nudge!]);
      for (const row of originalPosts!) expect(posts).toContainEqual(row);
      for (const row of originalWakes!) expect(wakes).toContainEqual(row);
      expect(serviceRows(rows, "DeliveryQueued").filter((row) => row.event._tag === "DeliveryQueued"
        && row.event.delivery.sender._tag === "service")).toEqual([]);
      if (attempt === 1) completed = rows;
      else for (const tag of ["board.PostWritten", "board.WakeBuilt", "DeliveryQueued", "roles.TeamIdleReported"]) {
        expect(serviceRows(rows, tag).map((row) => [row.sequence, row.requestId, row.event]))
          .toEqual(serviceRows(completed!, tag).map((row) => [row.sequence, row.requestId, row.event]));
      }
    }));
  }), 20_000);
}

for (const scenario of ["runaway", "role-advice", "gave-up", "stall"] as const) {
  it.effect(`production ${scenario} notice and successful flush survive interruption before its record`, () => Effect.gen(function* () {
    const tag = scenario === "runaway" ? "roles.RunawayReported" : scenario === "role-advice" ? "roles.RoleAdviceBroken"
      : scenario === "gave-up" ? "roles.GaveUp" : "roles.StallSeen";
    let post: EventEnvelope;
    yield* run(quiet, false, (runner) => Effect.gen(function* () {
      const lead = yield* spawn(rig, runner, undefined, { role: "lead", groups: [] });
      const worker = yield* spawn(rig, runner, lead, { groups: [] });
      const reached = yield* cutBefore(matchesRecord(tag));
      yield* stallWatchLoop.pipe(Effect.forkScoped);
      yield* eventually(snapshot, (state) => (state.roles as RolesView).baseline !== undefined);
      const client = yield* ownerClient;
      if (scenario === "runaway") {
        yield* pause(30);
        yield* TestClock.adjust(120 * 60_000 + 1);
      } else if (scenario === "role-advice") {
        yield* spawn(rig, runner, worker, { groups: [] });
      } else if (scenario === "gave-up") {
        yield* client["roles.settings.set"]!({ requestId: "no-crash-retry", settings: { limits: { crashRetries: 0 } } });
        yield* runner.emit({ _tag: "exited", agentId: worker.agentId, incarnation: incarnationOf(worker.token), exitCode: 1, signal: null, stderr: "test crash" });
      } else {
        yield* client["board.post"]!({ requestId: "unanswered-assignment", direct: { _tag: "agent", agentId: worker.agentId },
          to: [{ _tag: "agent", agentId: worker.agentId }], reply: "all", text: "Complete the assignment." });
        const state = yield* eventually(snapshot, (state) => state.agents[worker.agentId]?.state._tag === "working");
        const delivery = Object.values(state.deliveries).find((row) => row.target === worker.agentId && row.status === "sent")!;
        yield* notice(runner, worker, { _tag: "deliveryUpdate", deliveryId: delivery.id, kind: "message", replay: false, text: "Reading the assignment." });
        yield* eventually(snapshot, (state) => state.deliveries[delivery.id]?.status === "accepted");
        yield* runner.emit({ _tag: "turnEnded", agentId: worker.agentId, incarnation: incarnationOf(worker.token), deliveryId: delivery.id });
        yield* eventually(snapshot, (state) => state.agents[worker.agentId]?.state._tag === "idle");
        yield* pause(30);
        yield* TestClock.adjust("10 minutes");
      }
      yield* Deferred.await(reached);
      const posts = serviceRows(yield* alertLog, "board.PostWritten");
      expect(posts).toHaveLength(1);
      post = posts[0]!;
      expect(yield* records(tag)).toHaveLength(0);
      if (scenario !== "role-advice") expect(serviceRows(yield* alertLog, "board.WakeBuilt")).toHaveLength(1);
    }));
    for (const attempt of [1, 2]) yield* run(quiet, true, () => Effect.gen(function* () {
      yield* stallWatchLoop.pipe(Effect.forkScoped);
      expect(yield* eventually(records(tag), (rows) => rows.length === 1)).toHaveLength(1);
      expect(serviceRows(yield* alertLog, "board.PostWritten").map((row) => [row.sequence, row.requestId, row.event]))
        .toEqual([[post!.sequence, post!.requestId, post!.event]]);
      if (scenario !== "role-advice") expect(serviceRows(yield* alertLog, "board.WakeBuilt")).toHaveLength(1);
    }));
  }), 20_000);
}

for (const scenario of ["replacement", "stall-ended"] as const) {
  it.effect(`production ${scenario} action completes once across its final record boundary`, () => Effect.gen(function* () {
    const tag = scenario === "replacement" ? "roles.ReplaceAdvised" : "roles.StallEnded";
    let notices: ReadonlyArray<EventEnvelope>;
    yield* run(quiet, false, (runner) => Effect.gen(function* () {
      const lead = yield* spawn(rig, runner, undefined, { role: "lead", groups: [] });
      const worker = yield* spawn(rig, runner, lead, { groups: [] });
      const reached = yield* cutBefore(matchesRecord(tag));
      yield* stallWatchLoop.pipe(Effect.forkScoped);
      yield* eventually(snapshot, (state) => (state.roles as RolesView).baseline !== undefined);
      const client = yield* ownerClient;
      const finish = (who: Spawned) => Effect.gen(function* () {
        const state = yield* snapshot;
        const delivery = Object.values(state.deliveries).find((row) => row.target === who.agentId && row.status === "sent");
        if (delivery === undefined) return;
        yield* notice(runner, who, { _tag: "deliveryUpdate", deliveryId: delivery.id, kind: "message", replay: false, text: "Read." });
        yield* eventually(snapshot, (state) => state.deliveries[delivery.id]?.status === "accepted");
        yield* runner.emit({ _tag: "turnEnded", agentId: who.agentId, incarnation: incarnationOf(who.token), deliveryId: delivery.id });
        yield* eventually(snapshot, (state) => state.agents[who.agentId]?.state._tag === "idle");
      });
      yield* client["board.post"]!({ requestId: "assigned-work", direct: { _tag: "agent", agentId: worker.agentId },
        to: [{ _tag: "agent", agentId: worker.agentId }], reply: "all", text: "Finish this work." });
      yield* eventually(snapshot, (state) => state.agents[worker.agentId]?.state._tag === "working");
      yield* finish(worker);
      for (const episode of scenario === "replacement" ? [1, 2] : [1]) {
        yield* pause(30);
        yield* TestClock.adjust("10 minutes");
        expect(yield* eventually(records("roles.StallSeen"), (rows) => rows.length === (episode === 1 ? 1 : 3)))
          .toHaveLength(episode === 1 ? 1 : 3);
        yield* finish(worker);
        yield* finish(lead);
      }
      if (scenario === "replacement") { yield* pause(30); yield* TestClock.adjust("10 minutes"); }
      else yield* client.prompt!({ requestId: "ordinary-work-ends-stall", agentId: worker.agentId, text: "Continue the work." });
      yield* Deferred.await(reached);
      notices = serviceRows(yield* alertLog, "board.PostWritten");
      expect(notices).toHaveLength(scenario === "replacement" ? 4 : 1);
      expect(yield* records(tag)).toHaveLength(0);
    }));
    for (const attempt of [1, 2]) yield* run(quiet, true, () => Effect.gen(function* () {
      yield* stallWatchLoop.pipe(Effect.forkScoped);
      expect(yield* eventually(records(tag), (rows) => rows.length === 1)).toHaveLength(1);
      expect(serviceRows(yield* alertLog, "board.PostWritten").map((row) => [row.sequence, row.requestId, row.event]))
        .toEqual(notices!.map((row) => [row.sequence, row.requestId, row.event]));
    }));
  }), 20_000);
}
