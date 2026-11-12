import { it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { afterEach, beforeEach, expect, vi } from "vitest";

import { deliveryRig, notice, send, spawn } from "../support/deliveryRig.ts";
import { sessionFor } from "../support/fakeRunner.ts";
import {
  agentRow, call, makeRig, ownerCredential, readLog, removeRig, startPayload, success, type Rig,
} from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { appendWith, deliveryRow, eventually, pause, snapshot, tagged } from "../support/routingRig.ts";

let rig: Rig;
beforeEach(() => {
  rig = makeRig();
  vi.stubEnv("LGTM_HOME", rig.stateFolder);
  vi.stubEnv("HOME", rig.home);
  vi.stubEnv("CODEX_HOME", `${rig.home}/.codex`);
});
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });

it.effect("6b A2: catches a starting sibling escaping account-wide sign-out, opening idle, or receiving queued work before owner clearance", () => deliveryRig(rig, (runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const reporter = yield* spawn(rig, runner);
  const entered = yield* Deferred.make<Parameters<typeof sessionFor>[0]>();
  const release = yield* Deferred.make<void>();
  runner.script("start", (input) => Effect.gen(function* () {
    yield* Deferred.succeed(entered, input.agentId);
    yield* Deferred.await(release);
    return sessionFor(input.agentId);
  }));
  const starting = yield* call(ownerCredential, "start", startPayload(rig, { prompt: "Sibling work must wait for sign-in." })).pipe(Effect.forkScoped);
  const siblingId = yield* Deferred.await(entered);
  expect((yield* agentRow(siblingId))?.state._tag).toBe("starting");
  const queued = Object.values((yield* snapshot).deliveries).find((row) => row.target === siblingId)!;
  expect(queued.status).toBe("queued");

  const deliveryId = yield* send(runner, reporter, "Check this account's authentication.");
  yield* notice(runner, reporter, {
    _tag: "promptReply", deliveryId,
    outcome: { _tag: "pause", reason: "signed-out", error: "fixture-login-required-A2" },
  });
  const signedOut = yield* eventually(snapshot, (state) => state.accounts.primary?.status === "needs-sign-in");
  expect(signedOut.accounts.primary?.status).toBe("needs-sign-in");
  const stateWhileStarting = signedOut.agents[siblingId]?.state;
  yield* Deferred.succeed(release, undefined);
  expect(success(yield* Fiber.join(starting)).agentId).toBe(siblingId);
  const opened = yield* eventually(agentRow(siblingId), (row) => row?.session !== undefined);
  // Joining start closes its lane. Give the subscribed dispatch follower a
  // chance to run too, so an accidental send cannot hide behind the snapshot.
  yield* pause(40);
  const beforeClearance = yield* snapshot;
  const sessionAppend = appendWith(yield* readLog, (row) => row.event._tag === "SessionOpened" && row.event.agentId === siblingId);
  const pausedState = { _tag: "paused", reason: "signed-out", midTurn: false };
  expect.soft(stateWhileStarting).toEqual(pausedState);
  expect.soft(opened?.session).toEqual({ _tag: "acp", sessionId: `fake-session-${siblingId}` });
  expect.soft(beforeClearance.agents[siblingId]?.state).toEqual(pausedState);
  expect.soft(tagged(sessionAppend, "StateChanged").filter((event) => event.agentId === siblingId).map((event) => event.state)).toEqual([pausedState]);
  expect.soft(runner.callsOf("prompt").filter((entry) => entry.input.agentId === siblingId)).toEqual([]);
  expect.soft(beforeClearance.deliveries[queued.id]?.status).toBe("queued");

  success(yield* call(ownerCredential, "accounts mark-available", { accountId: "primary" }));
  const sent = yield* eventually(Effect.sync(() => runner.callsOf("prompt").filter((entry) => entry.input.agentId === siblingId)), (calls) => calls.length === 1);
  expect(sent.map((entry) => entry.input.delivery.id)).toEqual([queued.id]);
  expect(sent[0]?.input.delivery.content).toMatchObject({ _tag: "prompt", text: expect.stringContaining("Sibling work must wait for sign-in.") });
  expect((yield* deliveryRow(queued.id))?.status).toBe("sent");
  expect(Object.values((yield* snapshot).deliveries).filter((row) => row.target === siblingId && row.content._tag === "carry-on")).toEqual([]);
})).pipe(Effect.orDie));
