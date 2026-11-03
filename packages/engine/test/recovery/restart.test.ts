import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { verifyAgentToken } from "../../src/identity/tokens.ts";
import * as AccountSecrets from "../../src/accounts/SecretStore.ts";
import * as SecretStore from "../../src/commands/SecretStore.ts";
import { RunnerRejected } from "../../src/runner/Runner.ts";
import type * as EventLog from "../../src/log/EventLog.ts";
import * as Views from "../../src/views/Views.ts";
import * as Restart from "../../src/recovery/restart.ts";
import type { ProcessFacts, ProcessReader } from "../../src/recovery/orphans.ts";
import { spawn, send, accept } from "../support/deliveryRig.ts";
import { incarnationOf, makeFakeRunner, sessionFor, type FakeRunner } from "../support/fakeRunner.ts";
import {
  agentCredential, agentIdOf, agentRow, appendSetup, call, failureOf, headSequence, logAfter,
  makeFakeSecrets, makeRig, ownerCredential, readLog, removeRig, rotateToken, seedAccount, seedAgent, seedHarness,
  stateOf, success, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import {
  appendEvents, carryRows, promptsAfter, provideRestart, queued, ready, recover, sent, type RestartOptions,
} from "../support/restartRig.ts";
import { appendWith, deliveryRow, eventually, pause, snapshot, tagged } from "../support/routingRig.ts";

let rig: Rig;
beforeEach(() => {
  rig = makeRig();
  vi.stubEnv("SHEPHRD_HOME", rig.stateFolder);
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("CODEX_HOME", `${rig.home}/.codex`);
});
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });

// The missing recovery module is intentional RED. As in the runner tests,
// all dependencies are provided by these rigs, not by @effect/vitest.
const test = (name: string, body: () => Effect.Effect<unknown, unknown, any>) =>
  it.effect(name, () => body() as Effect.Effect<unknown, unknown, never>);
const live = (name: string, body: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => body() as Effect.Effect<unknown, unknown, never>);

const history = <A, E, R>(body: (runner: FakeRunner) => Effect.Effect<A, E, R>) => Effect.gen(function* () {
  const runner = yield* makeFakeRunner();
  return yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* seedAccount();
    yield* seedHarness();
    yield* runner.subscribed;
    return yield* body(runner);
  }), { recovering: false });
});

const restart = <A, E, R>(runner: FakeRunner, body: Effect.Effect<A, E, R>, options: RestartOptions = {}) =>
  provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* runner.subscribed;
    expect(yield* ready).toBe(false);
    return yield* body;
  }), options);

const runRecovery = <A, E, R>(runner: FakeRunner, body: Effect.Effect<A, E, R>, options: RestartOptions = {}) =>
  restart(runner, Effect.gen(function* () {
    yield* recover;
    expect(yield* ready).toBe(true);
    return yield* body;
  }), options);

const matching: ProcessFacts = { startTime: "5000", userId: 1000, executable: "/tmp/fake-adapter" };
const processRow = (agentId: string, groupId: number, extra: Record<string, unknown> = {}) => ({
  agentId: agentIdOf(agentId), groupId, bootId: "test-boot", ...matching, ...extra,
}) as EventLog.ProcessRow;

test("6.7 R01 step 4: catches revoking only reloadable agents or sweeping before every old token is revoked", () => Effect.gen(function* () {
  const old = yield* history(() => Effect.gen(function* () {
    const active = yield* seedAgent({ id: "active" });
    yield* rotateToken(active.agentId);
    yield* seedAgent({ id: "paused", state: "paused" });
    yield* seedAgent({ id: "unsupported", reloadable: false });
    yield* seedAgent({ id: "stopped", state: "stopped" });
    yield* appendSetup([], { processes: [processRow("active", 4242)] });
    return active;
  }));
  let sawSweep = false;
  const reader: ProcessReader = {
    bootId: () => {
      sawSweep = true;
      const db = new DatabaseSync(rig.database, { readOnly: true });
      try {
        expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
        expect(db.prepare("SELECT COUNT(*) AS count FROM agent_tokens WHERE revoked_at IS NULL").get()).toEqual({ count: 0 });
      } finally { db.close(); }
      return "test-boot";
    }, ownGroupId: () => 100, facts: () => undefined,
  };
  const runner = yield* makeFakeRunner();
  yield* runRecovery(runner, Effect.gen(function* () {
    expect(sawSweep).toBe(true);
    expect(failureOf(yield* call(agentCredential(old.token), "harnesses", { operation: "list" }))).toEqual({ _tag: "CommandRefused", reason: "invalid credential" });
  }), { reader });
}));

test("6.7 R02 step 5: catches reload before a verified leftover group exits, or bypassing row 31 identity guards", () => Effect.gen(function* () {
  yield* history(() => Effect.gen(function* () {
    yield* seedAgent({ id: "reload" });
    yield* appendSetup([], { processes: [
      processRow("reload", 4242),
      processRow("old-boot", 4243, { bootId: "old-boot" }),
      processRow("pid-one", 1), processRow("own-group", 100),
      processRow("reused", 4244, { startTime: "earlier" }),
      processRow("other-user", 4245, { userId: 99 }),
      processRow("other-exe", 4246, { executable: "/tmp/unrelated" }),
      processRow("leader-gone", 4247),
    ] });
  }));
  const groups = new Map([4242, 4243, 1, 100, 4244, 4245, 4246].map((id) => [id, matching]));
  const signals: Array<[number, string]> = [];
  const runner = yield* makeFakeRunner();
  runner.script("load", (input) => Effect.sync(() => {
    expect(signals).toEqual([[4242, "SIGTERM"]]);
    expect(groups.has(4242)).toBe(false);
    return sessionFor(input.agentId);
  }));
  yield* runRecovery(runner, Effect.void, {
    reader: { bootId: () => "test-boot", ownGroupId: () => 100, facts: (id) => groups.get(id) },
    kill: (id, signal) => { signals.push([id, signal]); groups.delete(id); },
  });
  expect(runner.callsOf("load").map((entry) => entry.input.agentId)).toEqual(["reload"]);
  expect(signals).toEqual([[4242, "SIGTERM"]]);
}));

test("6.7 R03 step 5: catches crashing or signalling when the injected host reader throws (row 31; issues 120 and 127)", () => Effect.gen(function* () {
  yield* history(() => Effect.gen(function* () {
    yield* seedAgent({ id: "unsupported-host" });
    yield* appendSetup([], { processes: [processRow("unsupported-host", 4242)] });
  }));
  const signals: Array<number> = [];
  const throws = () => { throw new Error("private-host-diagnostic"); };
  const runner = yield* makeFakeRunner();
  const logLines: Array<string> = [];
  yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* recover;
    expect(yield* ready).toBe(true);
    expect(signals).toEqual([]);
    expect(JSON.stringify([yield* readLog, yield* snapshot, logLines])).not.toContain("private-host-diagnostic");
  }), { reader: { bootId: throws, ownGroupId: throws, facts: throws }, kill: (id) => { signals.push(id); }, logLines });
}));

test("6.7 R04 step 5: catches hanging on a group that survives SIGKILL or signalling a group with no provable leader", () => Effect.gen(function* () {
  yield* history(() => appendSetup([], { processes: [processRow("stuck", 4242), processRow("gone", 4243)] }));
  const signals: Array<[number, string]> = [];
  const runner = yield* makeFakeRunner();
  yield* runRecovery(runner, Effect.void, {
    reader: { bootId: () => "test-boot", ownGroupId: () => 100, facts: (id) => id === 4242 ? matching : undefined },
    kill: (id, signal) => { signals.push([id, signal]); },
  });
  expect(signals).toEqual([[4242, "SIGTERM"], [4242, "SIGKILL"]]);
}));

test("6.7 R05 step 6: catches retaining blocking waits from dead connections, or cancelling nonblocking waits", () => Effect.gen(function* () {
  yield* history(() => Effect.gen(function* () {
    yield* seedAgent({ id: "parent", state: "working" });
    yield* seedAgent({ id: "child", parent: "parent", state: "working" });
    for (const blocking of [true, false]) yield* appendEvents({
      _tag: "WaitOpened", agentId: "parent", waitId: blocking ? "blocking" : "nonblocking", members: ["child"], mode: "all", blocking,
    });
  }));
  const runner = yield* makeFakeRunner();
  yield* restart(runner, Effect.gen(function* () {
    const views = yield* Views.Views;
    runner.script("load", (input) => Effect.gen(function* () {
      const state = yield* views.snapshot;
      expect(state.waits.blocking?.status).toBe("cancelled");
      expect(state.waits.nonblocking?.status).toBe("open");
      return sessionFor(input.agentId);
    }));
    yield* recover;
    expect((yield* snapshot).waits.nonblocking?.status).toBe("open");
    expect(tagged(yield* readLog, "WaitCancelled").map((event) => event.waitId)).toEqual(["blocking"]);
  }));
}));

test("6.7 R06 step 6: catches losing previous lifecycle states, interrupting paused agents, or reloading them at step 7", () => Effect.gen(function* () {
  yield* history(() => Effect.gen(function* () {
    for (const state of ["starting", "working", "idle", "paused"] as const) yield* seedAgent({ id: state, state });
    yield* appendEvents({ _tag: "AccountOutOfUsage", accountId: "primary" });
  }));
  const runner = yield* makeFakeRunner();
  yield* runRecovery(runner, Effect.gen(function* () {
    const interrupted = tagged(yield* readLog, "AgentInterrupted");
    expect(interrupted).toHaveLength(3);
    expect(interrupted.map((event) => [event.agentId, event.previous])).toEqual(expect.arrayContaining([
      ["starting", "starting"], ["working", "working"], ["idle", "idle"],
    ]));
    expect((yield* agentRow("paused"))?.state).toEqual({ _tag: "paused", reason: "limit", midTurn: false });
    expect(runner.calls.filter((entry) => entry.method === "load" || entry.method === "start").map((entry) => entry.input.agentId)).not.toContain("paused");
  }));
}));

test("6.7 R07 step 6: catches keeping orphan permission requests, replaying committed answers into a new process, or closing questions", () => Effect.gen(function* () {
  yield* history(() => Effect.gen(function* () {
    yield* seedAgent({ id: "asker", state: "working" });
    for (const id of ["open-permission", "answered-permission"]) yield* appendEvents({
      _tag: "PermissionRequested", agentId: "asker", permissionRequestId: id, holder: { _tag: "owner" },
      deliveryId: `delivery-${id}`, toolCallId: `tool-${id}`, description: "Use a tool.",
      options: [{ id: "once", name: "Allow once", kind: "allow_once", level: "ask", persistent: false }], settingsWrite: false,
    });
    yield* appendEvents({ _tag: "PermissionAnswered", agentId: "asker", permissionRequestId: "answered-permission", answeredBy: { _tag: "owner" }, answer: { _tag: "selected", optionId: "once" } },
      { _tag: "QuestionAsked", agentId: "asker", questionId: "question-kept", holder: { _tag: "owner" }, deliveryId: "question-delivery", text: "Which task?" });
  }));
  const runner = yield* makeFakeRunner();
  yield* restart(runner, Effect.gen(function* () {
    const before = yield* headSequence;
    const views = yield* Views.Views;
    runner.script("load", (input) => Effect.gen(function* () {
      expect((yield* views.snapshot).requests["open-permission"]?.status).toBe("cancelled");
      return sessionFor(input.agentId);
    }));
    yield* recover;
    const state = yield* snapshot;
    expect(state.requests["answered-permission"]?.status).toBe("answered");
    expect(state.questions["question-kept"]?.status).toBe("open");
    expect(tagged(yield* logAfter(before), "PermissionCancelled").map((event) => event.permissionRequestId)).toEqual(["open-permission"]);
    expect(tagged(yield* logAfter(before), "OwnerNeeded")).toEqual([]);
    expect(runner.callsOf("answerPermission")).toEqual([]);
  }));
}));

for (const capabilities of [{ loadSession: true, resumeSession: false }, { loadSession: false, resumeSession: true }]) {
  test(`6.7 R08/${capabilities.loadSession ? "load" : "resume"} step 7: catches missing new tokens or treating an advertised reload method as unsupported`, () => Effect.gen(function* () {
    const old = yield* history((runner) => spawn(rig, runner));
    const runner = yield* makeFakeRunner({ capabilities });
    yield* runRecovery(runner, Effect.gen(function* () {
      const calls = runner.callsOf("load");
      expect(calls).toHaveLength(1);
      const raw = Redacted.value(calls[0]!.input.token);
      expect(raw).not.toBe(old.token);
      expect(calls[0]!.input.session).toEqual({ _tag: "acp", sessionId: `fake-session-${old.agentId}` });
      expect(yield* stateOf(old.agentId)).toBe("idle");
      expect(failureOf(yield* call(agentCredential(old.token), "harnesses", { operation: "list" }))).toEqual({ _tag: "CommandRefused", reason: "invalid credential" });
      expect(yield* verifyAgentToken(raw)).toBe(old.agentId);
      expect(JSON.stringify([yield* readLog, yield* snapshot])).not.toContain(raw);
      expect(JSON.stringify([yield* readLog, yield* snapshot])).not.toContain(old.token);
    }));
  }));
}

test("6.7 R09 step 7: catches committing reload state, acceptance or carry-on before load succeeds, or splitting the successful agent transaction", () => Effect.gen(function* () {
  const old = yield* history((runner) => Effect.gen(function* () {
    const target = yield* spawn(rig, runner);
    const delivery = yield* send(runner, target, "A delivery whose first update was lost.");
    return { target, delivery };
  }));
  const runner = yield* makeFakeRunner();
  yield* restart(runner, Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    runner.script("load", (input) => Effect.gen(function* () {
      yield* runner.emitRaw({ _tag: "deliveryUpdate", agentId: input.agentId, incarnation: incarnationOf(Redacted.value(input.token)),
        deliveryId: "replay-only", kind: "message", replay: true, role: "user", text: `(delivery ${old.delivery})` });
      yield* Deferred.succeed(entered, undefined);
      yield* Deferred.await(release);
      return sessionFor(input.agentId);
    }));
    const before = yield* headSequence;
    const watermark = runner.calls.length;
    const fiber = yield* recover.pipe(Effect.forkChild);
    yield* Deferred.await(entered);
    expect(yield* stateOf(old.target.agentId)).toBe("interrupted");
    expect((yield* deliveryRow(old.delivery))?.status).toBe("sent");
    expect(yield* carryRows(old.target.agentId)).toEqual([]);
    expect(promptsAfter(runner, watermark, old.target.agentId).map((entry) => entry.input.delivery.id)).toEqual([]);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(fiber);
    const rows = yield* logAfter(before);
    const tx = appendWith(rows, (row) => row.event._tag === "SessionOpened" && row.event.agentId === old.target.agentId);
    expect(tagged(tx, "DeliveryAccepted").map((event) => event.deliveryId)).toEqual([old.delivery]);
    expect(tagged(tx, "DeliveryQueued").map((event) => event.delivery.content._tag)).toEqual(["carry-on"]);
    const queuedCarry = tagged(tx, "DeliveryQueued")[0]!.delivery;
    expect(tagged(tx, "StateChanged")).toContainEqual({ _tag: "StateChanged", agentId: old.target.agentId, state: { _tag: "working" } });
    expect(promptsAfter(runner, watermark, old.target.agentId).map((entry) => entry.input.delivery.id)).toEqual([queuedCarry.id]);
  }));
}));

for (const replay of ["split-user", "agent", "plan", "tool-call", "file-change", "cross-role", "live-user"] as const) {
  test(`6.7 R10/${replay} step 7: catches accepting replay ids outside joined user-message content or accepting arbitrary replay updates`, () => Effect.gen(function* () {
    const old = yield* history((runner) => Effect.gen(function* () {
      const target = yield* spawn(rig, runner);
      return { target, delivery: yield* send(runner, target, "Unaccepted at the crash.") };
    }));
    const runner = yield* makeFakeRunner();
    yield* restart(runner, Effect.gen(function* () {
      const chunks = replay === "split-user"
        ? [`(delivery ${old.delivery.slice(0, 12)}`, `${old.delivery.slice(12)})`]
        : replay === "cross-role" ? [old.delivery.slice(0, 12), old.delivery.slice(12)] : [old.delivery];
      runner.script("load", (input) => Effect.gen(function* () {
        for (const [index, text] of chunks.entries()) yield* runner.emitRaw({
          _tag: "deliveryUpdate", agentId: input.agentId, incarnation: incarnationOf(Redacted.value(input.token)), deliveryId: "replay-not-a-delivery",
          kind: ["plan", "tool-call", "file-change"].includes(replay) ? replay : "message",
          role: replay === "agent" || (replay === "cross-role" && index === 1) ? "agent" : "user", replay: replay !== "live-user", text,
        });
        return sessionFor(input.agentId);
      }));
      const before = yield* headSequence;
      const watermark = runner.calls.length;
      yield* recover;
      yield* pause(30);
      const rows = yield* logAfter(before);
      expect(tagged(rows, "ThreadItem")).toEqual([]);
      const accepted = tagged(rows, "DeliveryAccepted").map((event) => event.deliveryId);
      const calls = promptsAfter(runner, watermark, old.target.agentId);
      const carries = yield* carryRows(old.target.agentId);
      if (replay === "split-user") {
        expect(accepted).toEqual([old.delivery]);
        expect(carries).toHaveLength(1);
        expect(calls.map((entry) => entry.input.delivery.id)).toEqual([carries[0]!.id]);
      } else {
        expect(accepted).toEqual([]);
        expect(carries).toEqual([]);
        expect(calls.map((entry) => entry.input.delivery.id)).toEqual([old.delivery]);
      }
    }));
  }));
}

test("6.7 R11 step 7: catches a failed reload becoming idle, retaining its new token, or leaking its error reason", () => Effect.gen(function* () {
  const old = yield* history((runner) => spawn(rig, runner));
  const runner = yield* makeFakeRunner();
  runner.rejectNext("load", "private-reload-secret");
  const lines: Array<string> = [];
  yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck();
    const before = yield* headSequence;
    const watermark = runner.calls.length;
    yield* recover;
    expect(yield* stateOf(old.agentId)).toBe("interrupted");
    expect(tagged(yield* logAfter(before), "AgentReloadFailed")).toEqual([
      { _tag: "AgentReloadFailed", agentId: old.agentId, reason: "agent reload failed" },
    ]);
    expect(tagged(yield* logAfter(before), "SessionOpened")).toEqual([]);
    expect(promptsAfter(runner, watermark, old.agentId).map((entry) => entry.input.delivery.id)).toEqual([]);
    const failedToken = Redacted.value(runner.callsOf("load")[0]!.input.token);
    expect(failureOf(yield* call(agentCredential(failedToken), "harnesses", { operation: "list" }))?.reason).toBe("invalid credential");
    for (const secret of [old.token, failedToken, "private-reload-secret"]) expect(JSON.stringify([yield* readLog, yield* snapshot, lines])).not.toContain(secret);
  }), { logLines: lines });
}));

live("6.7 R12 step 7: catches a stalled adapter holding recovery forever or leaving a live setup token (issue 103)", () => Effect.gen(function* () {
  yield* history(() => seedAgent({ id: "stalled" }));
  const runner = yield* makeFakeRunner();
  runner.script("load", () => Effect.never);
  yield* restart(runner, Effect.gen(function* () {
    const fiber = yield* recover.pipe(Effect.forkChild);
    expect(yield* eventually(ready, Boolean)).toBe(true);
    yield* Fiber.join(fiber);
    expect(yield* stateOf("stalled")).toBe("interrupted");
    expect(tagged(yield* readLog, "AgentReloadFailed").map((event) => event.agentId)).toEqual(["stalled"]);
    expect(runner.callsOf("stop").map((entry) => entry.input.agentId)).toContain("stalled");
  }), { setupTimeoutMillis: 20 });
}));

test("6.7 R13 step 9: catches moving questions before reloads finish, moving a recovered or paused holder, or moving a failed holder twice", () => Effect.gen(function* () {
  yield* history(() => Effect.gen(function* () {
    yield* seedAgent({ id: "grandparent" });
    yield* seedAgent({ id: "holder-ok", parent: "grandparent", state: "working" });
    yield* seedAgent({ id: "holder-failed", parent: "grandparent", state: "working" });
    yield* seedAgent({ id: "holder-paused", parent: "grandparent", state: "paused" });
    yield* appendEvents({ _tag: "AccountOutOfUsage", accountId: "primary" });
    for (const holder of ["holder-ok", "holder-failed", "holder-paused"]) {
      yield* seedAgent({ id: `asker-${holder}`, parent: holder, state: "working" });
      yield* appendEvents(queued(holder, `delivery-${holder}`), {
        _tag: "QuestionAsked", agentId: `asker-${holder}`, questionId: `q-${holder}`, holder: { _tag: "agent", agentId: holder }, deliveryId: `delivery-${holder}`, text: "A retained question.",
      });
    }
  }));
  const runner = yield* makeFakeRunner();
  yield* restart(runner, Effect.gen(function* () {
    const views = yield* Views.Views;
    runner.script("load", (input) => Effect.gen(function* () {
      const state = yield* views.snapshot;
      expect(state.questions["q-holder-failed"]?.holder).toEqual({ _tag: "agent", agentId: "holder-failed" });
      if (input.agentId === "holder-failed") return yield* new RunnerRejected({ reason: "agent reload failed" });
      return sessionFor(input.agentId);
    }));
    const before = yield* headSequence;
    yield* recover;
    const state = yield* snapshot;
    expect(state.questions["q-holder-ok"]?.holder).toEqual({ _tag: "agent", agentId: "holder-ok" });
    expect(state.questions["q-holder-paused"]?.holder).toEqual({ _tag: "agent", agentId: "holder-paused" });
    expect(state.questions["q-holder-failed"]?.holder).toEqual({ _tag: "agent", agentId: "grandparent" });
    expect(tagged(yield* logAfter(before), "QuestionMoved").map((event) => event.questionId)).toEqual(["q-holder-failed"]);
  }));
}));

test("6.7 R14 steps 9-10: catches skipping open wait checks, treating reloaded mid-turn agents as settled, or sending before all checks finish", () => Effect.gen(function* () {
  yield* history(() => Effect.gen(function* () {
    yield* seedAgent({ id: "waiter" });
    yield* seedAgent({ id: "mid-turn", parent: "waiter", state: "working" });
    yield* seedAgent({ id: "idle", parent: "waiter" });
    for (const member of ["mid-turn", "idle"]) yield* appendEvents({
      _tag: "WaitOpened", agentId: "waiter", waitId: `wait-${member}`, members: [member], mode: "all", blocking: false,
    });
  }));
  const runner = yield* makeFakeRunner();
  yield* restart(runner, Effect.gen(function* () {
    const views = yield* Views.Views;
    const recovery = yield* Restart.Restart;
    let observedSends = 0;
    runner.script("prompt", () => Effect.gen(function* () {
      expect(yield* recovery.ready).toBe(true);
      const state = yield* views.snapshot;
      expect(state.waits["wait-idle"]?.status).toBe("satisfied");
      expect(state.waits["wait-mid-turn"]?.status).toBe("open");
      observedSends++;
    }));
    const watermark = runner.calls.length;
    yield* recover;
    expect((yield* snapshot).waits["wait-idle"]?.status).toBe("satisfied");
    expect((yield* snapshot).waits["wait-mid-turn"]?.status).toBe("open");
    const carry = yield* carryRows("mid-turn");
    expect(carry).toHaveLength(1);
    expect(promptsAfter(runner, watermark, "mid-turn").map((entry) => entry.input.delivery.id)).toEqual([carry[0]!.id]);
    expect(observedSends).toBeGreaterThan(0);
  }));
}));

test("6.7 R15 step 10: catches dispatch during recovery, re-sending behind later work, or creating a carry-on as well as a retry (issue 88)", () => Effect.gen(function* () {
  const old = yield* history((runner) => Effect.gen(function* () {
    const target = yield* spawn(rig, runner);
    const first = yield* send(runner, target, "Retry this delivery.");
    const next = success(yield* call(ownerCredential, "prompt", { agentId: target.agentId, text: "Later queued work." })).deliveryId as string;
    const second = yield* spawn(rig, runner);
    const secondDelivery = yield* send(runner, second, "The second agent also has recovery work.");
    yield* accept(runner, second, secondDelivery);
    return { target, first, next, second };
  }));
  const runner = yield* makeFakeRunner();
  yield* restart(runner, Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let loads = 0;
    runner.script("load", (input) => Effect.gen(function* () {
      if (++loads === 2) { yield* Deferred.succeed(entered, undefined); yield* Deferred.await(release); }
      return sessionFor(input.agentId);
    }));
    const watermark = runner.calls.length;
    const fiber = yield* recover.pipe(Effect.forkChild);
    yield* Deferred.await(entered);
    yield* pause(30);
    expect(runner.calls.slice(watermark).filter((entry) => entry.method === "prompt")).toEqual([]);
    expect(yield* ready).toBe(false);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(fiber);
    yield* pause(30);
    expect(promptsAfter(runner, watermark, old.target.agentId).map((entry) => entry.input.delivery.id)).toEqual([old.first]);
    expect(yield* carryRows(old.target.agentId)).toEqual([]);
    expect((yield* deliveryRow(old.next))?.status).toBe("queued");
    const secondCarry = yield* carryRows(old.second.agentId);
    expect(secondCarry).toHaveLength(1);
    expect(promptsAfter(runner, watermark, old.second.agentId).map((entry) => entry.input.delivery.id)).toEqual([secondCarry[0]!.id]);
  }));
}));

test("6.7 R16 step 10: catches two carry-ons for accepted mid-turn work or placing a carry-on behind later queued deliveries", () => Effect.gen(function* () {
  const old = yield* history((runner) => Effect.gen(function* () {
    const target = yield* spawn(rig, runner);
    const accepted = yield* send(runner, target, "Accepted before the crash.");
    yield* accept(runner, target, accepted);
    const later = success(yield* call(ownerCredential, "prompt", { agentId: target.agentId, text: "After the interrupted turn." })).deliveryId as string;
    return { target, accepted, later };
  }));
  const runner = yield* makeFakeRunner();
  yield* restart(runner, Effect.gen(function* () {
    const watermark = runner.calls.length;
    yield* recover;
    yield* pause(30);
    const carry = yield* carryRows(old.target.agentId);
    expect(carry).toHaveLength(1);
    expect(promptsAfter(runner, watermark, old.target.agentId).map((entry) => entry.input.delivery.id)).toEqual([carry[0]!.id]);
    expect((yield* deliveryRow(old.accepted))?.status).toBe("accepted");
    expect((yield* deliveryRow(old.later))?.status).toBe("queued");
  }));
}));

test("6.7 R17 step 10: catches abandoning an agent caught starting or loading a session it never opened (issue 62)", () => Effect.gen(function* () {
  yield* history(() => Effect.gen(function* () {
    yield* seedAgent({ id: "starting", state: "starting" });
    yield* appendEvents(queued("starting", "first-prompt"));
  }));
  const runner = yield* makeFakeRunner();
  yield* restart(runner, Effect.gen(function* () {
    const watermark = runner.calls.length;
    yield* recover;
    expect(runner.callsOf("load")).toEqual([]);
    expect(runner.callsOf("start").map((entry) => entry.input.agentId)).toEqual(["starting"]);
    expect(promptsAfter(runner, watermark, "starting").map((entry) => entry.input.delivery.id)).toEqual(["first-prompt"]);
    expect(yield* carryRows("starting")).toEqual([]);
  }));
}));

test("6.7 R18 resume: catches opening a fresh session silently when the interrupted agent cannot reload", () => Effect.gen(function* () {
  yield* history(() => seedAgent({ id: "cannot-reload", reloadable: false, state: "working" }));
  const runner = yield* makeFakeRunner({ capabilities: { loadSession: false, resumeSession: false } });
  yield* runRecovery(runner, Effect.gen(function* () {
    const watermark = runner.calls.length;
    expect(yield* stateOf("cannot-reload")).toBe("interrupted");
    expect(failureOf(yield* call(ownerCredential, "resume", { agentId: "cannot-reload" }))).toEqual({ _tag: "CommandRefused", reason: "cannot reload" });
    expect(runner.calls.slice(watermark)).toEqual([]);
  }));
}));

test("6.7 R19 resume --fresh: catches losing accepted deliveries since the last turn end, replaying older ones, or adding a carry-on", () => Effect.gen(function* () {
  yield* history(() => Effect.gen(function* () {
    yield* seedAgent({ id: "fresh", reloadable: false, state: "working" });
    yield* appendEvents({ _tag: "TurnEnded", agentId: "fresh", compact: false });
    for (const id of ["accepted-first", "accepted-second"]) yield* appendEvents(queued("fresh", id), sent("fresh", id), { _tag: "DeliveryAccepted", agentId: "fresh", deliveryId: id });
  }));
  const runner = yield* makeFakeRunner({ capabilities: { loadSession: false, resumeSession: false } });
  yield* runRecovery(runner, Effect.gen(function* () {
    const before = yield* headSequence;
    const watermark = runner.calls.length;
    success(yield* call(ownerCredential, "resume", { agentId: "fresh", fresh: true }));
    yield* eventually(Effect.sync(() => promptsAfter(runner, watermark, "fresh").length), (count) => count === 1);
    expect(tagged(yield* logAfter(before), "DeliveryRequeued").map((event) => event.deliveryId)).toEqual(["accepted-first", "accepted-second"]);
    expect(promptsAfter(runner, watermark, "fresh").map((entry) => entry.input.delivery.id)).toEqual(["accepted-first"]);
    expect(yield* carryRows("fresh")).toEqual([]);
    const load = runner.callsOf("start")[0]!;
    yield* runner.emit({ _tag: "promptReply", agentId: agentIdOf("fresh"), incarnation: incarnationOf(Redacted.value(load.input.token)), deliveryId: "accepted-first", outcome: { _tag: "success" } });
    yield* runner.emit({ _tag: "turnEnded", agentId: agentIdOf("fresh"), incarnation: incarnationOf(Redacted.value(load.input.token)), deliveryId: "accepted-first" as never });
    yield* eventually(Effect.sync(() => promptsAfter(runner, watermark, "fresh").length), (count) => count === 2);
    expect(promptsAfter(runner, watermark, "fresh").map((entry) => entry.input.delivery.id)).toEqual(["accepted-first", "accepted-second"]);
  }));
}));

test("6.7 R20 crash during step 7: catches duplicating committed recovery work or a carry-on when recovery is interrupted between two agents", () => Effect.gen(function* () {
  yield* history(() => Effect.gen(function* () {
    yield* seedAgent({ id: "first", state: "working" });
    yield* seedAgent({ id: "second", state: "working" });
  }));
  const dyingRunner = yield* makeFakeRunner();
  const settled = yield* restart(dyingRunner, Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    let calls = 0;
    let firstAgent = "";
    dyingRunner.script("load", (input) => Effect.gen(function* () {
      if (calls === 0) firstAgent = input.agentId;
      if (++calls === 2) { yield* Deferred.succeed(entered, undefined); yield* Effect.never; }
      return sessionFor(input.agentId);
    }));
    const watermark = dyingRunner.calls.length;
    const fiber = yield* recover.pipe(Effect.forkChild);
    yield* Deferred.await(entered);
    const carry = yield* carryRows(firstAgent);
    expect(carry).toHaveLength(1);
    expect(promptsAfter(dyingRunner, watermark, firstAgent).map((entry) => entry.input.delivery.id)).toEqual([]);
    yield* Fiber.interrupt(fiber);
    return { firstAgent, secondAgent: firstAgent === "first" ? "second" : "first", carryId: carry[0]!.id };
  }));
  // A new scope builds new views, a new recovery service and a new runner.
  // Only durable evidence survives, so an in-memory "already recovered" set
  // cannot hide a missing recovery invariant.
  const runner = yield* makeFakeRunner();
  yield* restart(runner, Effect.gen(function* () {
    const watermark = runner.calls.length;
    yield* recover;
    yield* pause(30);
    expect((yield* carryRows(settled.firstAgent)).map((row) => row.id)).toEqual([settled.carryId]);
    expect(promptsAfter(runner, watermark, settled.firstAgent).map((entry) => entry.input.delivery.id)).toEqual([settled.carryId]);
    const secondCarry = yield* carryRows(settled.secondAgent);
    expect(secondCarry).toHaveLength(1);
    expect(promptsAfter(runner, watermark, settled.secondAgent).map((entry) => entry.input.delivery.id)).toEqual([secondCarry[0]!.id]);
    const beforeAgain = yield* headSequence;
    const sentBeforeAgain = runner.calls.length;
    yield* recover;
    yield* pause(30);
    expect(yield* logAfter(beforeAgain)).toEqual([]);
    expect(promptsAfter(runner, sentBeforeAgain, settled.firstAgent).map((entry) => entry.input.delivery.id)).toEqual([]);
    expect(promptsAfter(runner, sentBeforeAgain, settled.secondAgent).map((entry) => entry.input.delivery.id)).toEqual([]);
  }));
}));

test("6.7 R21 resume: catches a successful manual reload failing to re-send its original unaccepted delivery exactly once", () => Effect.gen(function* () {
  const old = yield* history((runner) => Effect.gen(function* () {
    const target = yield* spawn(rig, runner);
    return { target, delivery: yield* send(runner, target, "Retry after a failed automatic reload.") };
  }));
  const runner = yield* makeFakeRunner();
  runner.rejectNext("load", "agent reload failed");
  yield* runRecovery(runner, Effect.gen(function* () {
    expect(yield* stateOf(old.target.agentId)).toBe("interrupted");
    const watermark = runner.calls.length;
    success(yield* call(ownerCredential, "resume", { agentId: old.target.agentId }));
    yield* eventually(Effect.sync(() => promptsAfter(runner, watermark, old.target.agentId).length), (count) => count === 1);
    yield* pause(30);
    expect(promptsAfter(runner, watermark, old.target.agentId).map((entry) => entry.input.delivery.id)).toEqual([old.delivery]);
    expect(yield* carryRows(old.target.agentId)).toEqual([]);
  }));
}));

test("6.7 R22 issue 119: catches retaining abandoned or replaced secrets, or collecting a secret still referenced by the current account views", () => Effect.gen(function* () {
  const secrets = { ...makeFakeSecrets(), layer: AccountSecrets.layer({ stateFolder: rig.stateFolder }) };
  const firstRunner = yield* makeFakeRunner();
  yield* provideRestart(rig, firstRunner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck();
    const store = yield* SecretStore.SecretStore;
    for (const reference of ["secret:abandoned", "secret:replaced", "secret:current", "secret:environment"]) {
      yield* store.put(reference, Redacted.make(`private-value-for-${reference}`));
    }
    yield* appendEvents({ _tag: "AccountChanged", accountId: "primary", account: { id: "primary", harness: "first", secret: "secret:replaced" } },
      { _tag: "AccountChanged", accountId: "primary", account: {
        id: "primary", harness: "first", secret: "secret:current", environment: { API_KEY: "secret:environment" },
      } });
  }), { recovering: false, secrets });
  const runner = yield* makeFakeRunner();
  const lines: Array<string> = [];
  yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* recover;
    const stored = JSON.parse(readFileSync(join(rig.stateFolder, "secrets.json"), "utf8")) as Record<string, string>;
    expect(stored).toEqual({ "secret:current": "private-value-for-secret:current", "secret:environment": "private-value-for-secret:environment" });
    expect(JSON.stringify([yield* readLog, yield* snapshot, lines])).not.toContain("private-value-for-");
  }), { secrets, logLines: lines });
}));
