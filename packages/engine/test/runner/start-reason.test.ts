import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { accountFor, echoFile, harnessFor, makeRunnerRig, modeOption, modelOption, removeRunnerRig, startPayloadFor, withEngine, writeFakeAdapter, type RunnerRig } from "../support/acpRunnerRig.ts";
import { call, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { eventually, tagged } from "../support/routingRig.ts";
let rig: RunnerRig;
beforeEach(() => { rig = makeRunnerRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("SHEPHRD_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig); });
for (const [reason, script, fields] of [
  ["not-signed-in", { sessionError: "Authentication required PRIVATE_ERROR_123" }, {}],
  ["could-not-start", { sessionError: "Unexpected PRIVATE_ERROR_123" }, {}],
  ["model-refused", { strictConfigOptions: true, configOptions: [modeOption(), modelOption()] }, { model: "not-a-model" }],
  ["effort-refused", { configOptions: [modeOption()] }, { effort: "not-an-effort" }],
  ["mode-refused", { strictConfigOptions: true, configOptions: [] }, {}],
] as const) {
  it.live(`records the safe ${reason} start reason in history, roster and a refused prompt`, () => {
    const harness = harnessFor("first", writeFakeAdapter(rig));
    const account = accountFor("first", { ...script, turns: [] }, echoFile(rig));
    return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
    const started = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work, fields)));
      const rows = yield* eventually(readLog, (rows) => tagged(rows, "AgentStartFailed").length === 1);
      expect(tagged(rows, "AgentStartFailed")[0]?.reason).toBe(reason);
      expect(JSON.stringify(rows.filter((row) => row.event._tag !== "AccountChanged"))).not.toContain("PRIVATE_ERROR_123");
      const roster = yield* call(ownerCredential, "client.roster", {});
      expect(JSON.stringify(roster)).toContain(`"startFailure":"${reason}"`);
      const refused = yield* call(ownerCredential, "prompt", { agentId: started.agentId, text: "try again" });
      expect(JSON.stringify(refused)).toContain("Failed to start:");
      expect(JSON.stringify(refused)).not.toContain("PRIVATE_ERROR_123");
    })).pipe(Effect.orDie);
  });
}
