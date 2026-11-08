import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { verifyAgentToken } from "../../src/identity/tokens.ts";
import * as AcpRunner from "../../src/runner/AcpRunner.ts";
import { Runner } from "../../src/runner/Runner.ts";
import {
  accountFor, echoFile, harnessFor, makeRunnerRig, readEcho, removeRunnerRig,
  serviceEnvironment, startPayloadFor, writeFakeAdapter, type RunnerRig, type RunnerShape,
} from "../support/acpRunnerRig.ts";
import {
  agentCredential, agentRow, call, failureOf, headSequence, logAfter, makeFakeSecrets,
  ownerCredential, readLog, stateOf, success,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { appendEvents, carryRows, provideRestart, recover } from "../support/restartRig.ts";
import { deliveryRow, eventually, pause, snapshot, tagged } from "../support/routingRig.ts";
import { withViews } from "../support/withViews.ts";

let rig: RunnerRig;
beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("LGCODE_HOME", rig.stateFolder);
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("CODEX_HOME", `${rig.home}/.codex`);
});
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig); });

const live = (name: string, body: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => body() as Effect.Effect<unknown, unknown, never>, 60_000);

// Tap the real process boundary; never replace its implementation. A send
// count is always taken after a watermark and checked against the echo too.
const runnerFor = (calls: Array<Parameters<RunnerShape["prompt"]>[0]>) => {
  const secrets = makeFakeSecrets();
  const real = AcpRunner.layer({ socketPath: rig.socket, stateFolder: rig.stateFolder, environment: serviceEnvironment(rig) })
    .pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, secrets.layer)));
  return Layer.effect(Runner, Effect.gen(function* () {
    const runner = yield* Runner;
    return { ...runner, prompt: (input: Parameters<RunnerShape["prompt"]>[0]) => Effect.gen(function* () {
      calls.push(input);
      yield* runner.prompt(input);
    }) };
  })).pipe(Layer.provide(real));
};

live("6.7 E01 row 51/PB-A7: catches a real session/load replay losing a chunked user delivery id, re-sending it, leaking history into the thread, or accepting the old token", () => Effect.gen(function* () {
  const adapter = writeFakeAdapter(rig);
  const harness = harnessFor("reload-peer", adapter);
  const echo = echoFile(rig);
  const originalAccount = accountFor(harness.id, { protocolVersion: 1, turns: [[{ step: "slow", ms: 60_000 }]] }, echo);
  const calls: Array<Parameters<RunnerShape["prompt"]>[0]> = [];
  const old = yield* provideRestart(rig, runnerFor(calls), Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* appendEvents({ _tag: "HarnessChanged", harness }, { _tag: "AccountChanged", accountId: originalAccount.id, account: originalAccount });
    const started = success(yield* call(ownerCredential, "start", startPayloadFor(harness, originalAccount, rig.work)));
    const agentId = started.agentId as string;
    const child = yield* readEcho(echo);
    const delivery = success(yield* call(ownerCredential, "prompt", { agentId, text: "Finish the interrupted task." })).deliveryId as string;
    expect((yield* eventually(deliveryRow(delivery), (row) => row?.status === "sent"))?.status).toBe("sent");
    yield* readEcho(echo, (value) => value.inbound.some((frame) => frame.method === "session/prompt"));
    expect((yield* deliveryRow(delivery))?.status).toBe("sent");
    return { agentId, delivery, token: child.env.LGCODE_TOKEN!, session: (yield* agentRow(agentId))!.session };
  }), { recovering: false });
  // New process, same session. Each history item below is one ACP chunk;
  // the id deliberately spans two chunks, as real adapters can emit it.
  const resumedEcho = echoFile(rig);
  const resumedAccount = accountFor(harness.id, {
    protocolVersion: 1,
    history: [{ role: "user", text: `(delivery ${old.delivery.slice(0, 14)}` }, { role: "user", text: `${old.delivery.slice(14)})` },
      { role: "agent", text: "private-replayed-answer-E01" }],
    turns: [[{ step: "slow", ms: 60_000 }]],
  }, resumedEcho);
  yield* withViews(rig.root, Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* appendEvents({ _tag: "AccountChanged", accountId: resumedAccount.id, account: resumedAccount });
  }));
  yield* provideRestart(rig, runnerFor(calls), Effect.gen(function* () {
    yield* registerRebuildCheck();
    const before = yield* headSequence;
    const watermark = calls.length;
    yield* recover;
    const replayed = yield* readEcho(resumedEcho, (value) => value.inbound.some((frame) => frame.method === "session/prompt"));
    const loads = replayed.inbound.filter((frame) => frame.method === "session/load" || frame.method === "session/resume");
    expect(loads).toHaveLength(1);
    expect(loads[0]!.params.sessionId).toBe(old.session!._tag === "acp" ? old.session!.sessionId : "wrong-session-kind");
    const carry = yield* carryRows(old.agentId);
    expect(carry).toHaveLength(1);
    expect(calls.slice(watermark).filter((entry) => entry.agentId === old.agentId).map((entry) => entry.delivery.id)).toEqual([carry[0]!.id]);
    const wirePrompts = replayed.inbound.filter((frame) => frame.method === "session/prompt");
    expect(JSON.stringify(wirePrompts[0]!.params)).toContain(carry[0]!.id);
    expect(JSON.stringify(wirePrompts[0]!.params)).not.toContain(old.delivery);
    expect((yield* deliveryRow(old.delivery))?.status).toBe("accepted");
    const written = yield* logAfter(before);
    expect(tagged(written, "DeliveryAccepted").map((event) => event.deliveryId)).toEqual([old.delivery]);
    expect(tagged(written, "ThreadItem")).toEqual([]);
    expect(failureOf(yield* call(agentCredential(old.token), "harnesses", { operation: "list" }))).toEqual({ _tag: "CommandRefused", reason: "invalid credential" });
    expect(replayed.env.LGCODE_TOKEN).not.toBe(old.token);
    expect(yield* verifyAgentToken(replayed.env.LGCODE_TOKEN!)).toBe(old.agentId);
    for (const secret of [old.token, replayed.env.LGCODE_TOKEN!]) expect(JSON.stringify([yield* readLog, yield* snapshot])).not.toContain(secret);
    // The fake script itself carries the replayed answer in its AccountChanged, so the answer is checked only over what recovery wrote and the threads.
    expect(JSON.stringify([written, (yield* snapshot).threads])).not.toContain("private-replayed-answer-E01");
    yield* pause(50);
    expect(calls.slice(watermark).filter((entry) => entry.agentId === old.agentId).map((entry) => entry.delivery.id)).toEqual([carry[0]!.id]);
  }));
}));

live("6.7 E02: catches reloading a real peer that advertised no reload, silently starting it on resume, or leaving its old token valid", () => Effect.gen(function* () {
  const harness = harnessFor("no-reload-peer", writeFakeAdapter(rig));
  const echo = echoFile(rig);
  const account = accountFor(harness.id, { protocolVersion: 1, reloadable: false, turns: [] }, echo);
  const calls: Array<Parameters<RunnerShape["prompt"]>[0]> = [];
  const old = yield* provideRestart(rig, runnerFor(calls), Effect.gen(function* () {
    yield* registerRebuildCheck();
    yield* appendEvents({ _tag: "HarnessChanged", harness }, { _tag: "AccountChanged", accountId: account.id, account });
    const agentId = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work))).agentId as string;
    expect((yield* agentRow(agentId))?.reloadable).toBe(false);
    const child = yield* readEcho(echo);
    return { agentId, token: child.env.LGCODE_TOKEN!, pid: child.pid, inbound: child.inbound.length };
  }), { recovering: false });
  yield* provideRestart(rig, runnerFor(calls), Effect.gen(function* () {
    yield* registerRebuildCheck();
    const watermark = calls.length;
    yield* recover;
    expect(yield* stateOf(old.agentId)).toBe("interrupted");
    expect(failureOf(yield* call(ownerCredential, "resume", { agentId: old.agentId }))).toEqual({ _tag: "CommandRefused", reason: "cannot reload" });
    expect(failureOf(yield* call(agentCredential(old.token), "harnesses", { operation: "list" }))).toEqual({ _tag: "CommandRefused", reason: "invalid credential" });
    const child = yield* readEcho(echo);
    expect(child.pid).toBe(old.pid);
    expect(child.inbound).toHaveLength(old.inbound);
    expect(calls.slice(watermark).filter((entry) => entry.agentId === old.agentId).map((entry) => entry.delivery.id)).toEqual([]);
  }));
}));
