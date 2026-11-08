import { join } from "node:path";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";

import {
  accountFor, echoFile, framesOf, harnessFor, makeRunnerRig, promptTexts, readEcho,
  removeRunnerRig, startPayloadFor, withEngine, writeFakeAdapter, type RunnerRig,
} from "../support/acpRunnerRig.ts";
import { agentRow, call, ownerCredential, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { deliveryRow, eventually, snapshot } from "../support/routingRig.ts";

let rig: RunnerRig;
beforeEach(() => {
  rig = makeRunnerRig();
  vi.stubEnv("LGCODE_HOME", rig.stateFolder);
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("CODEX_HOME", join(rig.home, ".codex"));
});
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig); });

it.effect("6b A1: catches dispatch passing carry-on content unchanged to the real runner and returning it without a second adapter prompt", () => Effect.gen(function* () {
  const echo = echoFile(rig);
  const harness = harnessFor("first", writeFakeAdapter(rig));
  const account = accountFor(harness.id, { turns: [
    [
      { step: "text", text: "I have begun the task." },
      { step: "signed_out", via: "rpc", message: "fixture-login-required-A1" },
    ],
    [{ step: "text", text: "I am carrying on." }, { step: "end_turn", stopReason: "end_turn" }],
  ] }, echo);
  yield* withEngine(rig, {
    harness, accounts: [account],
    classifyError: ({ text }) => text.includes("fixture-login-required-A1") ? "signed-out" : undefined,
  }, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const started = success(yield* call(ownerCredential, "start", startPayloadFor(harness, account, rig.work)));
    const first = success(yield* call(ownerCredential, "prompt", { agentId: started.agentId, text: "Finish the current task." }));
    const paused = yield* eventually(agentRow(started.agentId), (row) => row?.state._tag === "paused");
    expect(paused?.state).toEqual({ _tag: "paused", reason: "signed-out", midTurn: true });
    expect((yield* deliveryRow(first.deliveryId))?.status).toBe("accepted");

    success(yield* call(ownerCredential, "accounts mark-available", { accountId: account.id }));
    const resumed = yield* readEcho(echo, (child) => framesOf(child, "session/prompt").length === 2);
    const carries = Object.values((yield* snapshot).deliveries)
      .filter((row) => row.target === started.agentId && row.content._tag === "carry-on");
    expect(carries).toHaveLength(1);
    expect.soft(promptTexts(resumed)).toHaveLength(2);
    expect.soft(promptTexts(resumed)[1]).toBe(`The pause has ended. Carry on with what you were doing. (delivery ${carries[0]!.id})`);
    expect.soft(carries[0]?.status).not.toBe("returned");
    const accepted = yield* eventually(deliveryRow(carries[0]!.id), (row) => row?.status === "accepted" || row?.status === "returned");
    expect(accepted?.status).toBe("accepted");
  }));
}).pipe(Effect.orDie));
