import { existsSync } from "node:fs";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";

import type { PermissionLevel } from "@lgtm/contracts";
import {
  accountFor, alive, echoFile, effortOption, framesOf, harnessFor, makeRunnerRig, modeOption, modelOption, readEcho,
  removeRunnerRig, spawnFor, startPayloadFor, withAcpRunner, withEngine, writeFakeAdapter, type Echo, type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { call, failureOf, ownerCredential, readLog, stateOf, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually, tagged } from "../support/routingRig.ts";

// Criterion 6.11 (task 6a.4; rows 18, 39, 60, 70): a `harnesses` override
// changes the spawned path and arguments; the permission mapping is applied;
// the model, effort and mode reach the adapter through
// `session/set_config_option` (`model`, then re-read, then `thought_level`;
// `mode`), and the older methods only when negotiated; a value outside the
// harness's recorded options is refused at `start`; a value the adapter
// rejects writes "agent start failed" and the agent stops.
//
// The fake agent's options are found by category, never by id: its effort
// option has the id `effort` and the category `thought_level`.

let rig: RunnerRig;
beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("LGTM_HOME", rig.stateFolder);
});
afterEach(() => {
  vi.unstubAllEnvs();
  removeRunnerRig(rig);
});

registerRebuildCheck({ noLog: true });

// Every requirement is provided inside the test; the cast keeps a missing
// module from widening the requirement type.
const live = (name: string, test: () => Effect.Effect<unknown, unknown, any>) =>
  it.live(name, () => test() as Effect.Effect<unknown, unknown, never>, 60_000);

const configCalls = (echo: Echo) => framesOf(echo, "session/set_config_option").map((frame) => ({
  configId: frame.params.configId as string, value: frame.params.value as string,
}));
const sessionOpened = (echo: Echo) => framesOf(echo, "session/new").length === 1;
const allOptions = [modeOption(), modelOption(), effortOption()];

live("6.11 override: a harnesses set changes the adapter path and arguments the next start spawns (breaks if the runner caches the first settings or ignores the override's arguments)", () =>
  Effect.gen(function* () {
    const echo = echoFile(rig);
    const original = harnessFor("first", writeFakeAdapter(rig, "original-adapter"));
    const account = accountFor("first", { turns: [] }, echo);
    return yield* withEngine(rig, { harness: original, accounts: [account] }, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const replacement = { ...original, adapterPath: writeFakeAdapter(rig, "override-adapter"), adapterArguments: ["--override", "two words"] };
      success(yield* call(ownerCredential, "harnesses", { operation: "set", harness: replacement }));
      success(yield* call(ownerCredential, "start", startPayloadFor(original, account, rig.work)));
      const seen = yield* readEcho(echo, sessionOpened);
      expect(seen.argv[1]).toBe(replacement.adapterPath);
      expect(seen.argv.slice(2)).toEqual(["--override", "two words"]);
    }));
  }));

live("6.11 permission mapping: each starting level is set as the harness's mapped mode through set_config_option on the mode-category option, never set_mode (breaks if the runner sends LGTM Studio's level name, the default mode, or uses session/set_mode on protocol version 2)", () =>
  withAcpRunner(rig, {}, ({ runner }) => Effect.gen(function* () {
    const harness = harnessFor("first", writeFakeAdapter(rig));
    for (const permission of ["read-only", "ask", "edit", "full"] as ReadonlyArray<PermissionLevel>) {
      const echo = echoFile(rig);
      const spawn = yield* spawnFor(rig, harness, accountFor("first", { configOptions: allOptions, strictConfigOptions: true, turns: [] }, echo), { permission });
      yield* runner.start(spawn.input);
      const seen = yield* readEcho(echo, (current) => configCalls(current).some((entry) => entry.configId === "mode"));
      expect(configCalls(seen).filter((entry) => entry.configId === "mode").at(-1), permission).toEqual({ configId: "mode", value: harness.permissionMapping[permission] });
      expect(framesOf(seen, "session/set_mode")).toEqual([]);
    }
  })));

live("6.11 model and effort: the model is set first, then the effort on the thought_level option, both through set_config_option and never set_model on version 2 (breaks if effort is set before the model, by option id instead of category, or through session/set_model)", () =>
  withAcpRunner(rig, {}, ({ runner }) => Effect.gen(function* () {
    const echo = echoFile(rig);
    const harness = harnessFor("first", writeFakeAdapter(rig), { models: ["model-small", "model-large"], efforts: ["low", "high"] });
    const spawn = yield* spawnFor(rig, harness, accountFor("first", { configOptions: allOptions, strictConfigOptions: true, turns: [] }, echo), { model: "model-large", effort: "high" });
    yield* runner.start(spawn.input);
    const seen = yield* readEcho(echo, (current) => configCalls(current).some((entry) => entry.configId === "effort"));
    const calls = configCalls(seen).filter((entry) => entry.configId !== "mode");
    expect(calls).toEqual([{ configId: "model", value: "model-large" }, { configId: "effort", value: "high" }]);
    expect(framesOf(seen, "session/set_model")).toEqual([]);
    expect(framesOf(seen, "session/set_mode")).toEqual([]);
  })));

live("6.11 no model or effort requested: nothing but the mode is set (breaks if the runner sets the adapter's first listed model or effort by itself)", () =>
  withAcpRunner(rig, {}, ({ runner }) => Effect.gen(function* () {
    const echo = echoFile(rig);
    const spawn = yield* spawnFor(rig, harnessFor("first", writeFakeAdapter(rig)), accountFor("first", { configOptions: allOptions, turns: [] }, echo));
    yield* runner.start(spawn.input);
    const seen = yield* readEcho(echo, (current) => configCalls(current).length > 0);
    expect(configCalls(seen).map((entry) => entry.configId)).toEqual(["mode"]);
  })));

live("6.11 cannot set: an effort requested of an adapter with no thought_level option fails the start with a reason (breaks if the runner drops the effort silently, row 60)", () =>
  withAcpRunner(rig, {}, ({ runner }) => Effect.gen(function* () {
    const echo = echoFile(rig);
    const spawn = yield* spawnFor(rig, harnessFor("first", writeFakeAdapter(rig)), accountFor("first", { configOptions: [modeOption(), modelOption()], turns: [] }, echo), { effort: "high" });
    const result = yield* runner.start(spawn.input).pipe(Effect.result);
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure.reason.length).toBeGreaterThan(0);
  })));

live("6.11 recorded options: a model outside the harness's recorded models is refused at start and no adapter is spawned (breaks if the engine passes an unrecorded model to the runner)", () =>
  Effect.gen(function* () {
    const echo = echoFile(rig);
    const harness = harnessFor("first", writeFakeAdapter(rig), { models: ["model-small", "model-large"], efforts: ["low", "high"] });
    const account = accountFor("first", { configOptions: allOptions, turns: [] }, echo);
    return yield* withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const outcome = yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { model: "model-huge" }));
      expect(failureOf(outcome)?._tag).toBe("CommandRefused");
      expect(tagged(yield* readLog, "AgentStarted")).toEqual([]);
      expect(existsSync(echo)).toBe(false);
    }));
  }));

live("6.11 row 70: a value the adapter rejects writes AgentStartFailed with a reason, the agent stops, its token is revoked and its adapter is gone (breaks if the runner ignores a set_config_option error and opens the session anyway)", () =>
  Effect.gen(function* () {
    const echo = echoFile(rig);
    // The harness records no models, so the engine passes any model on, and the adapter refuses it.
    const harness = harnessFor("first", writeFakeAdapter(rig));
    const account = accountFor("first", { configOptions: allOptions, strictConfigOptions: true, turns: [] }, echo);
    return yield* withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const reply = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, { model: "model-the-adapter-lacks" })));
      const rows = yield* eventually(readLog, (current) => tagged(current, "AgentStartFailed").length > 0);
      const failed = tagged(rows, "AgentStartFailed");
      expect(failed).toHaveLength(1);
      expect(failed[0]!.reason.length).toBeGreaterThan(0);
      expect(tagged(rows, "SessionOpened")).toEqual([]);
      expect(yield* stateOf(reply.agentId)).toBe("stopped");
      const sql = yield* SqlClient.SqlClient;
      const tokens = yield* sql<{ revoked_at: number | null }>`SELECT revoked_at FROM agent_tokens WHERE agent_id = ${reply.agentId}`;
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.every((row) => row.revoked_at !== null)).toBe(true);
      const pid = (yield* readEcho(echo)).pid;
      const gone = yield* eventually(Effect.sync(() => alive(pid)), (running) => !running);
      expect(gone).toBe(false);
    }));
  }));
