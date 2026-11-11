import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { call, agentCredential, ownerCredential, readLog, success, agentRow } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { eventually, tagged } from "../support/routingRig.ts";
import { accountFor, alive, echoFile, harnessFor, makeRunnerRig, readEcho, removeRunnerRig,
  startPayloadFor, withEngine, writeFakeAdapter, type RunnerRig } from "../support/acpRunnerRig.ts";

let rig: RunnerRig;
beforeEach(() => { rig = makeRunnerRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig); });

for (const protocolVersion of [1, 2]) for (const permission of [false, true]) {
  it.live(`cancel-reply keeps the process alive and subsequent prompts work, protocol ${protocolVersion}, permission ${permission}`, () => {
    const harness = harnessFor("reply-peer", writeFakeAdapter(rig));
    const echo = echoFile(rig);
    const account = accountFor(harness.id, { protocolVersion, turns: [[
      ...(permission ? [{ step: "permission", toolCallId: "held-tool", title: "Wait for approval",
        options: [{ optionId: "once", name: "Allow once", kind: "allow_once" }] }] : []),
      { step: "slow", ms: 60_000 },
    ], [{ step: "text", text: "The next prompt worked." }]] }, echo);
    return withEngine(rig, { harness, accounts: [account] }, () => Effect.gen(function* () {
      yield* registerRebuildCheck();
      const agentId = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work))).agentId;
      const first = success(yield* call(ownerCredential, "prompt", { agentId, text: "Keep my original prompt." }));
      const process = yield* readEcho(echo, (value) => value.inbound.some((frame) => frame.method === "session/prompt"));
      if (permission) yield* eventually(readLog, (rows) => tagged(rows, "PermissionRequested").length === 1);
      const waiting = success(yield* call(ownerCredential, "prompt", { agentId, text: "This queued prompt must survive." }));
      success(yield* call(ownerCredential, "cancel-reply", { agentId }));
      const rows = yield* eventually(readLog, (rows) => tagged(rows, "TurnEnded").length === 2);
      expect(tagged(rows, "TurnEnded")).toEqual([
        expect.objectContaining({ stopped: true }), expect.not.objectContaining({ stopped: true }),
      ]);
      expect(tagged(rows, "AgentStopped")).toEqual([]);
      expect(tagged(rows, "DeliveryReturned")).toEqual([]);
      expect(tagged(rows, "PromptSent").map((event) => event.text)).toEqual(["Keep my original prompt.", "This queued prompt must survive."]);
      expect(tagged(rows, "DeliveryAccepted").map((event) => event.deliveryId)).toEqual([first.deliveryId, waiting.deliveryId]);
      expect(tagged(rows, "PermissionCancelled")).toHaveLength(permission ? 1 : 0);
      expect(JSON.stringify(tagged(rows, "ThreadItem"))).toContain("The next prompt worked.");
      expect((yield* agentRow(agentId))?.state._tag).toBe("idle");
      expect(alive(process.pid)).toBe(true);
      expect((yield* call(ownerCredential, "cancel-reply", { agentId }))._tag).toBe("Failure");
    })).pipe(Effect.orDie);
  }, 30_000);
}
