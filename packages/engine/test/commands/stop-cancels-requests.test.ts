import { randomBytes } from "node:crypto";
import { writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import * as Redacted from "effect/Redacted";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import { connect, waitForAgents } from "@lgcode/client";
import { serve } from "../../src/api/server.ts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { beforeEach, afterEach, expect, vi } from "vitest";
import { deliveryRig, spawn, send, waitFor, finish, promptsTo } from "../support/deliveryRig.ts";
import { call, ownerCredential, agentCredential, readLog, makeRig, removeRig, success, type Rig, headSequence, logAfter } from "../support/handlerRig.ts";
import { requestPermission, requestRow, questionRow, snapshot, tagged, eventually, deliveryRow } from "../support/routingRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("LGCODE_HOME", rig.stateFolder); });
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

it.live("stop and resume an asker holding another duty, then complete a real owner wait and drain the old holder queue", () => deliveryRig(rig, (runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const parent = yield* spawn(rig, runner);
  const child = yield* spawn(rig, runner, parent);
  const grandchild = yield* spawn(rig, runner, child);
  const parentWork = yield* send(runner, parent, "Keep the old holder queue busy.");
  yield* send(runner, child, "Keep held duties queued.");
  const own = yield* requestPermission(runner, child);
  success(yield* call(agentCredential(parent.token), "pass-up", { subject: { _tag: "permission", id: own.id } }));
  expect((yield* requestRow(own.id))?.holder).toEqual({ _tag: "owner" });
  const held = yield* requestPermission(runner, grandchild);
  expect(held.row.holder).toEqual({ _tag: "agent", agentId: child.agentId });
  const question = success(yield* call(agentCredential(child.token), "ask", { text: "Which branch?" }));
  const questionNotice = (yield* questionRow(question.questionId))!.deliveryId;
  expect((yield* deliveryRow(questionNotice))?.status).toBe("queued");
  success(yield* call(ownerCredential, "stop", { agentId: child.agentId }));
  expect((yield* requestRow(own.id))?.status).toBe("cancelled");
  const transferred = (yield* requestRow(held.id))!;
  expect(transferred.holder).toEqual({ _tag: "agent", agentId: parent.agentId });
  expect(transferred.deliveryId).not.toBe(held.row.deliveryId);
  expect((yield* questionRow(question.questionId))?.status).toBe("open");
  expect((yield* deliveryRow(questionNotice))?.status).toBe("withdrawn");
  success(yield* call(ownerCredential, "resume", { agentId: child.agentId }));
  const resumed = { ...child, token: Redacted.value(runner.callsOf("load").filter((call) => call.input.agentId === child.agentId).at(-1)!.input.token) };
  // Preserve and assert the open question above, then answer it so it cannot
  // mask stale permissions in the independent owner-wait assertion.
  success(yield* call(ownerCredential, "answer", { kind: "question", id: question.questionId, text: "Use the current branch." }));
  const answer = yield* eventually(snapshot, (state) => Object.values(state.deliveries).some((d) => d.target === child.agentId && d.status === "sent"));
  const answerDelivery = Object.values(answer.deliveries).find((d) => d.target === child.agentId && d.status === "sent")!;
  expect(answerDelivery).toBeDefined();
  yield* finish(runner, resumed, answerDelivery.id);
  const current = yield* send(runner, resumed, "Finish this resumed work.");
  const secret = randomBytes(32);
  chmodSync(rig.stateFolder, 0o700);
  writeFileSync(join(rig.stateFolder, "owner-credential"), secret, { mode: 0o600 });
  yield* serve({ socketPath: join(rig.stateFolder, "engine.sock"), ownerCredential: Redacted.make(secret.toString("base64url")), debug: false });
  const client = yield* connect({ environment: { LGCODE_HOME: rig.stateFolder } });
  const started = yield* Deferred.make<void>();
  const observed = { ...client, "client.snapshot": (payload: any) => client["client.snapshot"](payload).pipe(Effect.tap(() => Deferred.succeed(started, undefined))) };
  let finished = false;
  const waiting = yield* waitForAgents(observed as typeof client, { members: [child.agentId], mode: "all" }).pipe(
    Effect.tap(() => Effect.sync(() => { finished = true; })), Effect.timeout(5_000), Effect.forkScoped);
  yield* Deferred.await(started);
  expect(finished, "the resumed member is still doing real work").toBe(false);
  yield* finish(runner, resumed, current);
  expect(yield* Fiber.join(waiting)).toEqual({ outcome: "satisfied", members: [{ agentId: child.agentId, reason: "settled" }] });
  yield* finish(runner, parent, parentWork);
  const drained = yield* eventually(deliveryRow(transferred.deliveryId), (row) => row?.status === "sent");
  expect(drained?.status).toBe("sent");
  expect(promptsTo(runner, parent).some((call) => call.input.delivery.id === transferred.deliveryId)).toBe(true);
  const sent = runner.callsOf("prompt").map((call) => call.input.delivery.id);
  expect(sent).not.toContain(held.row.deliveryId);
  expect(sent).not.toContain(questionNotice);
  expect(sent).not.toContain(own.row.deliveryId);
})).pipe(Effect.orDie));
