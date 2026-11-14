import { afterEach, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { provideBoard } from "../board/wakeFixtures.ts";
import { eventually } from "../support/routingRig.ts";
import { agentCredential, appendSetup, call, eventOf, harnessSettings, makeRig, ownerCredential, readLog, removeRig, seedAccount, seedAgent, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

let rig: ReturnType<typeof makeRig>;
afterEach(() => { if (rig) removeRig(rig); });
const report = { models: { source: "negotiated" as const, options: [{ id: "allowed", label: "Allowed" }, { id: "outside", label: "Outside" }] }, efforts: { source: "negotiated" as const, options: [{ id: "high", label: "High" }] } };
const read = (extra: Record<string, unknown> = {}) => call(ownerCredential, "client.harness.choices", { harnessId: "first", ...extra }).pipe(Effect.map(success));
const setup = (models: string[] = []) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  yield* seedAccount();
  yield* appendSetup([eventOf({ _tag: "HarnessChanged", harness: harnessSettings("first", { models, efforts: [] }) })]);
});

it.live("configuration never discovers under the writer permit, even while a client discovery hangs", () => {
  rig = makeRig();
  return provideBoard(rig, (runner) => Effect.gen(function* () {
    yield* setup();
    yield* seedAgent({ id: "worker", state: "stopped" });
    runner.script("discover", () => Effect.never);
    const reading = yield* read().pipe(Effect.forkScoped);
    yield* eventually(Effect.sync(() => runner.callsOf("discover").length), (n) => n === 1);
    const saving = yield* call(ownerCredential, "configure", { agentId: "worker", model: "unknown" }).pipe(Effect.forkScoped);
    yield* Effect.sleep(30);
    const writing = yield* call(ownerCredential, "accounts", { operation: "add", account: { id: "unrelated", harness: "first", displayName: "Unrelated", enabled: true } }).pipe(Effect.forkScoped);
    expect(yield* eventually(Effect.sync(() => writing.pollUnsafe()), (result) => result !== undefined)).toBeDefined();
    success(yield* Fiber.join(writing));
    expect((yield* Fiber.join(saving))._tag).toBe("Failure");
    expect(runner.callsOf("discover")).toHaveLength(1);
    yield* Fiber.interrupt(reading);
  }));
});

it.live("offline configured choices limit a stopped agent's report and acceptance, and survive unavailable discovery", () => {
  rig = makeRig();
  return provideBoard(rig, (runner) => Effect.gen(function* () {
    yield* setup(["allowed", "configured-unreported"]);
    yield* seedAgent({ id: "worker", state: "stopped" });
    runner.script("discover", () => Effect.succeed(report));
    const choices = success(yield* call(ownerCredential, "client.agent.configuration", { agentId: "worker" }));
    expect(choices.models.options.map((o: any) => o.id)).toEqual(["allowed"]);
    expect((yield* call(ownerCredential, "configure", { agentId: "worker", model: "outside" }))._tag).toBe("Failure");
    success(yield* call(ownerCredential, "configure", { agentId: "worker", model: "allowed" }));
    yield* appendSetup([eventOf({ _tag: "HarnessChanged", harness: harnessSettings("first", { models: ["offline"], adapterPath: "/missing-adapter" }) })]);
    expect(success(yield* call(ownerCredential, "client.agent.configuration", { agentId: "worker" })).models.options.map((o: any) => o.id)).toEqual(["offline"]);
    success(yield* call(ownerCredential, "configure", { agentId: "worker", model: "offline" }));
  }));
});

it.live("same-key requests including refresh share a child and one cancelled waiter does not cancel the others", () => {
  rig = makeRig();
  return provideBoard(rig, (runner) => Effect.gen(function* () {
    yield* setup();
    const release = yield* Deferred.make<void>();
    runner.script("discover", () => Deferred.await(release).pipe(Effect.as(report)));
    const first = yield* read().pipe(Effect.forkScoped);
    yield* eventually(Effect.sync(() => runner.callsOf("discover").length), (n) => n === 1);
    const second = yield* read({ refresh: true }).pipe(Effect.forkScoped);
    yield* Effect.sleep(50);
    expect(runner.callsOf("discover")).toHaveLength(1);
    yield* Fiber.interrupt(first);
    yield* Deferred.succeed(release, undefined);
    expect((yield* Fiber.join(second)).models).toEqual(report.models);
    expect(runner.callsOf("discover")).toHaveLength(1);
  }));
});

it.live("at most two discovery processes run across distinct keys", () => {
  rig = makeRig();
  return provideBoard(rig, (runner) => Effect.gen(function* () {
    yield* setup();
    const release = yield* Deferred.make<void>();
    let active = 0, peak = 0;
    runner.script("discover", () => Effect.sync(() => { active++; peak = Math.max(peak, active); }).pipe(Effect.andThen(Deferred.await(release)), Effect.as(report), Effect.ensuring(Effect.sync(() => { active--; }))));
    const requests = yield* Effect.forEach(["one", "two", "three", "four"], (model) => read({ model }).pipe(Effect.forkScoped));
    yield* eventually(Effect.sync(() => active), (n) => n >= 2);
    yield* Effect.sleep(50);
    expect(active).toBe(2);
    yield* Deferred.succeed(release, undefined);
    yield* Effect.forEach(requests, Fiber.join);
    expect(peak).toBe(2);
    expect(active).toBe(0);
  }));
});

it.effect("empty reports are cached for thirty seconds, refresh bypasses them, and the deadline is twenty seconds", () => {
  rig = makeRig();
  return provideBoard(rig, (runner) => Effect.gen(function* () {
    yield* setup();
    runner.script("discover", () => Effect.never);
    const pending = yield* read().pipe(Effect.forkScoped);
    yield* eventually(Effect.sync(() => runner.callsOf("discover").length), (n) => n === 1);
    yield* TestClock.adjust(19_999);
    expect(pending.pollUnsafe()).toBeUndefined();
    yield* TestClock.adjust(1);
    expect((yield* Fiber.join(pending)).reason).toBe("The harness did not report its models in time.");
    runner.script("discover", () => Effect.succeed({ models: { source: "unavailable", options: [] }, efforts: { source: "unavailable", options: [] } }));
    expect((yield* read()).reason).toBe("The harness did not report its models in time.");
    expect(runner.callsOf("discover")).toHaveLength(1);
    expect((yield* read({ refresh: true })).models.options).toEqual([]);
    yield* read();
    expect(runner.callsOf("discover")).toHaveLength(2);
    yield* TestClock.adjust(30_001);
    yield* read();
    expect(runner.callsOf("discover")).toHaveLength(3);
  }));
});

it.live("the result cache holds at most 128 entries", () => {
  rig = makeRig();
  return provideBoard(rig, (runner) => Effect.gen(function* () {
    yield* setup();
    runner.script("discover", () => Effect.succeed(report));
    for (let i = 0; i < 129; i++) yield* read({ model: `model-${i}` });
    yield* read({ model: "model-128" });
    expect(runner.callsOf("discover")).toHaveLength(129);
    yield* read({ model: "model-0" });
    expect(runner.callsOf("discover")).toHaveLength(130);
  }));
});

it.live("the engine handler refuses an agent credential without discovery, and the fake discovery report is independent of configured lists", () => {
  rig = makeRig();
  return provideBoard(rig, (runner) => Effect.gen(function* () {
    yield* setup(["configured-only"]);
    const worker = yield* seedAgent({ id: "worker" });
    expect((yield* call(agentCredential(worker.token), "client.harness.choices", { harnessId: "first" }))._tag).toBe("Failure");
    expect(runner.callsOf("discover")).toHaveLength(0);
    expect((yield* read()).models.options.map((o: any) => o.id)).toEqual(["test-model", "other-model"]);
    runner.script("discover", () => Effect.succeed({ models: { source: "unavailable", options: [] }, efforts: { source: "unavailable", options: [] } }));
    expect((yield* read({ refresh: true })).models.options).toEqual([]);
  }));
});

it.live("permission and mode events for an unregistered discovery id never write or reset a mode", () => {
  rig = makeRig();
  let writerAttempts = 0;
  return provideBoard(rig, (runner) => Effect.gen(function* () {
    yield* setup();
    yield* runner.subscribed;
    writerAttempts = 0;
    const before = yield* readLog;
    yield* runner.emitRaw({ _tag: "permissionRequested", agentId: "discovery-test", incarnation: "unregistered", permissionRequestId: "request", toolCallId: "tool", description: "Tool", options: [{ id: "deny", name: "Deny", kind: "reject_once", level: "read-only", persistent: false }], settingsWrite: false });
    yield* runner.emitRaw({ _tag: "modeReported", agentId: "discovery-test", incarnation: "unregistered", mode: "full-access", ceiling: "read-only" });
    yield* Effect.sleep(50);
    expect(yield* readLog).toEqual(before);
    expect(runner.callsOf("setMode")).toHaveLength(0);
    expect(runner.callsOf("answerPermission")).toHaveLength(0);
    expect(writerAttempts).toBe(0);
  }), [], {}, Effect.sync(() => { writerAttempts++; }));
});

it.live("a new request does not join a cancelled discovery while its last waiter is cleaning up", () => {
  rig = makeRig();
  return provideBoard(rig, (runner) => Effect.gen(function* () {
    yield* setup();
    const closing = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
    let calls = 0;
    runner.script("discover", () => ++calls === 1 ? Effect.never.pipe(Effect.ensuring(
      Deferred.succeed(closing, undefined).pipe(Effect.andThen(Deferred.await(release))),
    )) : Effect.succeed(report));
    const first = yield* read().pipe(Effect.forkScoped);
    expect(yield* eventually(Effect.sync(() => calls), (n) => n === 1)).toBe(1);
    const cancelled = yield* Fiber.interrupt(first).pipe(Effect.forkScoped);
    yield* Deferred.await(closing);
    yield* Effect.gen(function* () {
      const second = yield* read().pipe(Effect.forkScoped);
      yield* Effect.sleep(50);
      expect(runner.callsOf("discover")).toHaveLength(2);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(cancelled);
      expect((yield* Fiber.join(second)).models).toEqual(report.models);
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
  }));
});
