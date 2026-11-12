import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { afterEach, beforeEach, expect, vi } from "vitest";

import type * as EventLog from "../../src/log/EventLog.ts";
import * as AcpRunner from "../../src/runner/AcpRunner.ts";
import { Runner } from "../../src/runner/Runner.ts";
import {
  accountFor, echoFile, harnessFor, makeRunnerRig, readEcho, removeRunnerRig,
  serviceEnvironment, startPayloadFor, writeFakeAdapter, type RunnerRig, type RunnerShape,
} from "../support/acpRunnerRig.ts";
import {
  agentRow, call, failureOf, headSequence, logAfter, makeFakeSecrets, ownerCredential, success,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { appendEvents, carryRows, provideRestart, ready, recover } from "../support/restartRig.ts";
import { deliveryRow, eventually, pause, tagged } from "../support/routingRig.ts";
import { withViews } from "../support/withViews.ts";

type Prompt = Parameters<RunnerShape["prompt"]>[0];
type History = Array<{ role: "user" | "agent"; text: string; repeat?: number }>;
let rig: RunnerRig;
beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("LGTM_HOME", rig.stateFolder);
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("CODEX_HOME", `${rig.home}/.codex`);
});
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig); });

const live = (name: string, body: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => body() as Effect.Effect<unknown, unknown, never>, 60_000);

// Keep the real runner and wire protocol. Tap prompts for duplicate detection;
// the optional hold runs only after the real session/load has returned.
const runnerFor = (calls: Array<Prompt>, afterLoad: Effect.Effect<void> = Effect.void) => {
  const secrets = makeFakeSecrets();
  const real = AcpRunner.layer({ socketPath: rig.socket, stateFolder: rig.stateFolder, environment: serviceEnvironment(rig) })
    .pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, secrets.layer)));
  return Layer.effect(Runner, Effect.gen(function* () {
    const runner = yield* Runner;
    return { ...runner,
      prompt: (input: Prompt) => Effect.gen(function* () { calls.push(input); yield* runner.prompt(input); }),
      load: (input: Parameters<RunnerShape["load"]>[0]) => runner.load(input).pipe(Effect.tap(() => afterLoad)),
    };
  })).pipe(Layer.provide(real));
};

// Obtain the pending delivery through start/prompt and the real process, then
// close the first engine. Only the event log survives into recovery.
const interruptedDelivery = (calls: Array<Prompt>, reloadable = true) => Effect.gen(function* () {
  const harness = harnessFor("regression-peer", writeFakeAdapter(rig));
  const echo = echoFile(rig);
  const account = accountFor(harness.id, {
    protocolVersion: 1, reloadable, turns: [[{ step: "slow", ms: 60_000 }]],
  }, echo);
  const old = yield* provideRestart(rig, runnerFor(calls), Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* appendEvents({ _tag: "HarnessChanged", harness }, { _tag: "AccountChanged", accountId: account.id, account });
    const agentId = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work))).agentId as string;
    const delivery = success(yield* call(ownerCredential, "prompt", { agentId, text: "Finish the interrupted task." })).deliveryId as string;
    yield* readEcho(echo, (value) => value.inbound.some((frame) => frame.method === "session/prompt"));
    expect((yield* eventually(deliveryRow(delivery), (row) => row?.status === "sent"))?.status).toBe("sent");
    return { agentId, delivery, session: (yield* agentRow(agentId))!.session };
  }), { recovering: false });
  return { ...old, harness };
});

const installReplay = (harnessId: string, history: History) => Effect.gen(function* () {
  const echo = echoFile(rig);
  const account = accountFor(harnessId, {
    protocolVersion: 1, history, turns: [[{ step: "slow", ms: 60_000 }]],
  }, echo);
  expect(Buffer.byteLength(account.environment!.FAKE_AGENT_SCRIPT!)).toBeLessThan(8 * 1024 * 1024);
  yield* withViews(rig.root, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* appendEvents({ _tag: "AccountChanged", accountId: account.id, account });
  }));
  return echo;
});

for (const fillers of [512, 10_000]) {
  live(`6.7 F1 T-1 ${fillers} replay fillers: catches scanning before the last replay update and sending an already received delivery twice`, () => Effect.gen(function* () {
    const calls: Array<Prompt> = [];
    const old = yield* interruptedDelivery(calls);
    const echo = yield* installReplay(old.harness.id, [
      { role: "agent", text: "x", repeat: fillers },
      { role: "user", text: `(delivery ${old.delivery})` },
    ]);
    // Even expanded to individual wire notifications, the input is below 8 MB.
    const frame = { jsonrpc: "2.0", method: "session/update", params: { sessionId: "fake-session-1",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "x" } } } };
    expect(Buffer.byteLength(JSON.stringify(frame) + "\n") * fillers + 512).toBeLessThan(8 * 1024 * 1024);
    yield* provideRestart(rig, runnerFor(calls), Effect.gen(function* () {
      yield* registerRebuildCheck();
      const before = yield* headSequence;
      const watermark = calls.length;
      yield* recover;
      const wire = yield* readEcho(echo, (value) => value.inbound.some((frame) => frame.method === "session/prompt"));
      expect(wire.inbound.filter((frame) => frame.method === "session/load")).toHaveLength(1);
      const rows = yield* logAfter(before);
      expect(tagged(rows, "DeliveryAccepted").map((event) => event.deliveryId)).toEqual([old.delivery]);
      expect((yield* deliveryRow(old.delivery))?.status).toBe("accepted");
      const carries = yield* carryRows(old.agentId);
      expect(carries).toHaveLength(1);
      const carryId = carries[0]!.id;
      expect(tagged(rows, "DeliveryQueued").map((event) => event.delivery.id)).toEqual([carryId]);
      expect(tagged(rows, "DeliverySent").map((event) => event.deliveryId)).toEqual([carryId]);
      expect(tagged(rows, "ThreadItem")).toEqual([]);
      yield* pause(50);
      expect(calls.slice(watermark).map((input) => input.delivery.id)).toEqual([carryId]);
      const prompts = (yield* readEcho(echo)).inbound.filter((frame) => frame.method === "session/prompt");
      expect(prompts).toHaveLength(1);
      expect(JSON.stringify(prompts[0]!.params)).toContain(carryId);
      expect(JSON.stringify(prompts[0]!.params)).not.toContain(`(delivery ${old.delivery})`);
    }));
  }));
}

const rejectsReplay = (history: (id: string) => History) => Effect.gen(function* () {
  const calls: Array<Prompt> = [];
  const old = yield* interruptedDelivery(calls);
  const echo = yield* installReplay(old.harness.id, history(old.delivery));
  yield* provideRestart(rig, runnerFor(calls), Effect.gen(function* () {
    yield* registerRebuildCheck();
    const before = yield* headSequence;
    const watermark = calls.length;
    yield* recover;
    const wire = yield* readEcho(echo, (value) => value.inbound.some((frame) => frame.method === "session/prompt"));
    const rows = yield* logAfter(before);
    expect(tagged(rows, "DeliveryAccepted")).toEqual([]);
    expect(tagged(rows, "DeliveryRequeued").map((event) => event.deliveryId)).toEqual([old.delivery]);
    expect(tagged(rows, "DeliverySent").map((event) => event.deliveryId)).toEqual([old.delivery]);
    expect((yield* deliveryRow(old.delivery))?.status).toBe("sent");
    expect(yield* carryRows(old.agentId)).toEqual([]);
    yield* pause(50);
    expect(calls.slice(watermark).map((input) => input.delivery.id)).toEqual([old.delivery]);
    const prompts = wire.inbound.filter((frame) => frame.method === "session/prompt");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.params.prompt).toEqual([{ type: "text", text: "Finish the interrupted task." }]);
  }));
});

live("6.7 F1 T-2: catches joining user replay chunks across an agent speaker boundary into a false delivery receipt", () => rejectsReplay((id) => [
  { role: "user", text: `(delivery ${id.slice(0, 14)}` },
  { role: "agent", text: "x" },
  { role: "user", text: `${id.slice(14)})` },
]));

live("6.7 F1 T-3: catches accepting a bare delivery id without the exact delivery marker", () => rejectsReplay((id) => [
  { role: "user", text: `A discussion mentioning ${id} without a delivery marker.` },
]));

live("6.7 F1 T-4 interrupted: catches retrying recovery on a poisoned service, revoking tokens again or appending new recovery events", () => Effect.gen(function* () {
  const calls: Array<Prompt> = [];
  const old = yield* interruptedDelivery(calls);
  const echo = yield* installReplay(old.harness.id, []);
  const entered = yield* Deferred.make<void>();
  let held = false;
  const holdOnce = Effect.suspend(() => {
    if (held) return Effect.void;
    held = true;
    return Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never));
  });
  let revocations = 0;
  yield* provideRestart(rig, runnerFor(calls, holdOnce), Effect.gen(function* () {
    yield* registerRebuildCheck();
    const first = yield* recover.pipe(Effect.forkChild);
    yield* Deferred.await(entered).pipe(Effect.timeout(10_000));
    expect((yield* readEcho(echo)).inbound.filter((frame) => frame.method === "session/load")).toHaveLength(1);
    expect((yield* agentRow(old.agentId))?.state._tag).toBe("interrupted");
    expect(yield* ready).toBe(false);
    yield* Fiber.interrupt(first);
    const before = yield* headSequence;
    const revokedBefore = revocations;
    const result = yield* recover.pipe(Effect.result, Effect.timeout(5_000));
    expect(yield* logAfter(before)).toEqual([]);
    expect(revocations).toBe(revokedBefore);
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure).toMatchObject({ reason: "recovery already attempted; start a new engine" });
    expect(yield* ready).toBe(false);
  }), { wrapLog: (real) => ({ ...real, append: (...args) => {
    if (args[4].revokeAgentTokens === "all") revocations++;
    return real.append(...args);
  } }) });
}));

live("6.7 F1 T-4 completed: catches repeating recovery writes or sends after the service has completed recovery", () => Effect.gen(function* () {
  const calls: Array<Prompt> = [];
  const old = yield* interruptedDelivery(calls);
  const echo = yield* installReplay(old.harness.id, []);
  let revocations = 0;
  yield* provideRestart(rig, runnerFor(calls), Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* recover;
    yield* readEcho(echo, (value) => value.inbound.some((frame) => frame.method === "session/prompt"));
    const before = yield* headSequence;
    const watermark = calls.length;
    const revokedBefore = revocations;
    yield* recover;
    expect(yield* ready).toBe(true);
    expect(yield* logAfter(before)).toEqual([]);
    expect(revocations).toBe(revokedBefore);
    expect(calls.slice(watermark)).toEqual([]);
    expect((yield* readEcho(echo)).inbound.filter((frame) => frame.method === "session/load")).toHaveLength(1);
  }), { wrapLog: (real) => ({ ...real, append: (...args) => {
    if (args[4].revokeAgentTokens === "all") revocations++;
    return real.append(...args);
  } }) });
}));

live("6.7 F1 T-5 step 9: catches opening the command gate before recovery finishes its wait re-check", () => Effect.gen(function* () {
  const calls: Array<Prompt> = [];
  const old = yield* interruptedDelivery(calls, false);
  const entered = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();
  let interrupted = false;
  let step9Held = false;
  const wrapLog = (real: EventLog.EventLog["Service"]) => ({ ...real,
    transact: ((use) => Effect.suspend(() => {
      // This non-reloadable peer has no step-7 setup, and no account is paused.
      // After step 6 commits, the next transaction is step 9's re-check.
      const hold = interrupted && !step9Held;
      if (hold) step9Held = true;
      return Effect.gen(function* () {
        if (hold) { yield* Deferred.succeed(entered, undefined); yield* Deferred.await(release); }
        let sawInterrupt = false;
        const result = yield* real.transact((append) => use((...args) => {
          if (args[3].some((event) => event._tag === "AgentInterrupted")) sawInterrupt = true;
          return append(...args);
        }));
        if (sawInterrupt) interrupted = true;
        return result;
      });
    })) as typeof real.transact,
  });
  yield* provideRestart(rig, runnerFor(calls), Effect.gen(function* () {
    yield* registerRebuildCheck();
    const fiber = yield* recover.pipe(Effect.forkChild);
    yield* Deferred.await(entered).pipe(Effect.timeout(10_000));
    const before = yield* headSequence;
    // Keep a bounded failure even if a mutation opens the gate and dispatches.
    const command = yield* call(ownerCredential, "prompt", { agentId: old.agentId, text: "Must wait for recovery." })
      .pipe(Effect.forkChild);
    const result = yield* Fiber.join(command).pipe(Effect.timeout(2_000), Effect.ensuring(Deferred.succeed(release, undefined)));
    expect(failureOf(result)).toEqual({ _tag: "CommandRefused", reason: "recovering" });
    expect(yield* logAfter(before)).toEqual([]);
    yield* Fiber.join(fiber);
    expect(yield* ready).toBe(true);
    success(yield* call(ownerCredential, "harnesses", { operation: "list" }));
  }), { wrapLog });
}));
