import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { beforeEach, afterEach, expect, vi } from "vitest";
import { deliveryRig, spawn, send, waitFor } from "../support/deliveryRig.ts";
import { call, ownerCredential, agentCredential, readLog, makeRig, removeRig, success, type Rig, headSequence, logAfter } from "../support/handlerRig.ts";
import { requestPermission, requestRow, questionRow, snapshot, tagged } from "../support/routingRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("SHEPHRD_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });
it.live("1.45 stop cancels all of the asker's permissions with withdrawals in its stop batch, keeps questions, and closes a parent's wait", () => deliveryRig(rig, (runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const parent = yield* spawn(rig, runner);
  const child = yield* spawn(rig, runner, parent);
  yield* send(runner, parent, "Keep routed requests queued.");
  const a = yield* requestPermission(runner, child);
  const b = yield* requestPermission(runner, child);
  const question = success(yield* call(agentCredential(child.token), "ask", { text: "Which branch?" }));
  const wait = success(yield* waitFor(parent, [child]));
  const before = yield* headSequence;
  success(yield* call(ownerCredential, "stop", { agentId: child.agentId }));
  const rows = yield* logAfter(before);
  const stopped = rows.find((row) => row.event._tag === "AgentStopped")!;
  const batch = rows.filter((row) => row.requestId === stopped.requestId);
  expect(tagged(batch, "PermissionCancelled")).toEqual(expect.arrayContaining([
    expect.objectContaining({ permissionRequestId: a.id, reason: "agent stopped" }),
    expect.objectContaining({ permissionRequestId: b.id, reason: "agent stopped" }),
  ]));
  for (const request of [a, b]) {
    expect((yield* requestRow(request.id))?.status).toBe("cancelled");
    expect(tagged(batch, "DeliveryWithdrawn")).toContainEqual(expect.objectContaining({ deliveryId: request.row.deliveryId }));
  }
  expect((yield* questionRow(question.questionId))?.status).toBe("open");
  expect((yield* snapshot).waits[wait.waitId]?.status).toBe("satisfied");
  success(yield* call(ownerCredential, "resume", { agentId: child.agentId }));
  expect(Object.values((yield* snapshot).requests).filter((r) => r.agentId === child.agentId && r.status === "open")).toEqual([]);
})).pipe(Effect.orDie));
