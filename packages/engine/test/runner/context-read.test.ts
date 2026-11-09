import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { accountFor, echoFile, effortOption, framesOf, harnessFor, makeRunnerRig, modeOption, modelOption,
  readEcho, removeRunnerRig, startPayloadFor, withEngine, writeFakeAdapter, type RunnerRig } from "../support/acpRunnerRig.ts";
import { call, ownerCredential, stateOf, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually } from "../support/routingRig.ts";

let rig: RunnerRig;
beforeEach(() => { rig = makeRunnerRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig); });
registerRebuildCheck({ noLog: true });
const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>) => it.live(name, () => test() as Effect.Effect<unknown, unknown, never>, 60_000);
const raw = (update: Record<string, unknown>, sessionId = "${session}") => ({ step: "raw_frame", frame: JSON.stringify({
  jsonrpc: "2.0", method: "session/update", params: { sessionId, update },
}) });
const usage = (used: unknown, size: unknown) => raw({ sessionUpdate: "usage_update", used, size, cost: { amount: 9, currency: "USD" }, _meta: { planted: "untrusted context payload" } });
const read = (agentId: string) => call(ownerCredential, "client.agent.context", { agentId }).pipe(Effect.map((value) => success(value).context));
const config = (agentId: string) => call(ownerCredential, "client.agent.configuration", { agentId }).pipe(Effect.map(success));
const finishFirstPrompt = (echo: string, agentId: string) => Effect.gen(function* () {
  yield* readEcho(echo, (value) => framesOf(value, "session/prompt").length === 1);
  yield* eventually(stateOf(agentId), (state) => state === "idle");
});

live("W05c context: latest valid occupancy is bounded, including zero; model changes and fresh sessions invalidate it", () => {
  const gate = join(rig.root, "old-model-done"), lastGate = join(rig.root, "new-model-done");
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const echo = echoFile(rig);
  const account = accountFor("first", { configOptions: [modeOption(), modelOption(), effortOption()], turns: [
    [usage(12, 100), { step: "wait_for_file", path: gate }],
    [usage(0, 200), { step: "wait_for_file", path: lastGate }],
  ] }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const started = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work)));
    expect(yield* read(started.agentId)).toEqual({ _tag: "unavailable", reason: "not-reported" });
    success(yield* call(ownerCredential, "prompt", { agentId: started.agentId, text: "measure" }));
    const current = yield* eventually(read(started.agentId), (value) => value._tag === "available");
    expect(current).toMatchObject({ _tag: "available", used: 12, window: 100, percent: 12, model: "model-small" });
    expect(Object.keys(current).sort()).toEqual(["_tag", "model", "percent", "reportedAt", "used", "window"]);
    success(yield* call(ownerCredential, "configure", { agentId: started.agentId, model: "model-large" }));
    // The old model is still running its turn, so that report remains qualified with its model.
    expect(yield* read(started.agentId)).toMatchObject({ _tag: "available", model: "model-small" });
    writeFileSync(gate, "finish");
    yield* eventually(config(started.agentId), (value) => value.configuration.status === "applied");
    expect(yield* read(started.agentId)).toEqual({ _tag: "unavailable", reason: "configuration-changed" });
    success(yield* call(ownerCredential, "prompt", { agentId: started.agentId, text: "measure new model" }));
    expect(yield* eventually(read(started.agentId), (value) => value._tag === "available")).toMatchObject({ used: 0, window: 200, percent: 0, model: "model-large" });
    writeFileSync(lastGate, "finish");
    yield* eventually(stateOf(started.agentId), (state) => state === "idle");
    success(yield* call(ownerCredential, "stop", { agentId: started.agentId }));
    expect(yield* read(started.agentId)).toEqual({ _tag: "unavailable", reason: "not-live" });
    success(yield* call(ownerCredential, "resume", { agentId: started.agentId, fresh: true }));
    expect(yield* read(started.agentId)).toEqual({ _tag: "unavailable", reason: "not-reported" });
    expect(framesOf(yield* readEcho(echo), "session/prompt")).toHaveLength(0);
  }));
});

for (const [name, used, size] of [
  ["negative used", -1, 100], ["negative window", 1, -1], ["zero window", 0, 0], ["overflow", 20, 10],
  ["fraction", 0.5, 100], ["unsafe", 1, Number.MAX_SAFE_INTEGER + 1], ["NaN", NaN, 100], ["Infinity", 1, Infinity],
] as const) live(`W05c context: ${name} never creates a percentage`, () => {
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const echo = echoFile(rig);
  const account = accountFor("first", { turns: [[usage(used, size)]] }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const started = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "invalid" })));
    yield* finishFirstPrompt(echo, started.agentId);
    const value = yield* read(started.agentId);
    expect(value._tag).toBe("unavailable");
    expect(value).not.toHaveProperty("percent");
  }));
});

live("W05c context: valid safe-integer counts near the boundary cannot round above 100 percent", () => {
  // Multiplication before division rounds this particular legal count above 100.
  const full = Number.MAX_SAFE_INTEGER - 15;
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const echo = echoFile(rig);
  const account = accountFor("first", { turns: [[usage(full, full)]] }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const started = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "full context" })));
    yield* finishFirstPrompt(echo, started.agentId);
    expect(yield* read(started.agentId)).toMatchObject({ _tag: "available", used: full, window: full, percent: 100 });
  }));
});

live("W05c context: turn token totals and wrong-session reports do not become context occupancy; absent choices stay unavailable", () => {
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const echo = echoFile(rig);
  const account = accountFor("first", { turns: [[
    raw({ sessionUpdate: "usage_update", used: 90, size: 100 }, "another-session"),
    raw({ sessionUpdate: "state_update", state: "idle", stopReason: "end_turn", usage: { inputTokens: 40, outputTokens: 50, totalTokens: 90 } }),
  ]] }, echo);
  return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const started = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { prompt: "no context" })));
    yield* finishFirstPrompt(echo, started.agentId);
    expect(yield* read(started.agentId)).toEqual({ _tag: "unavailable", reason: "not-reported" });
    const choices = yield* config(started.agentId);
    expect(choices.models).toEqual({ source: "unavailable", options: [] });
    expect(choices.efforts).toEqual({ source: "unavailable", options: [] });
  }));
});
