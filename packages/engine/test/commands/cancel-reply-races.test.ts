import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type { Views } from "../../src/views/Views.ts";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { RunnerRejected } from "../../src/runner/Runner.ts";
import { deliveryRig, spawn, send, finish, promptsTo } from "../support/deliveryRig.ts";
import { call, agentCredential, ownerCredential, readLog, success, makeRig, removeRig, type Rig } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { deliveryRow, eventually, snapshot, tagged } from "../support/routingRig.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });

for (const race of [false, true]) {
  it.live(`a ${race ? "naturally ended reply" : "runner refusal"} returns CommandRefused and leaves the writer and later prompts usable`, () => deliveryRig(rig, (runner) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const target = yield* spawn(rig, runner);
    const first = yield* send(runner, target, "The current reply.");
    const queued = success(yield* call(ownerCredential, "prompt", { agentId: target.agentId, text: "The next reply." }));
    const sent = promptsTo(runner, target)[0]!.input;
    const services = yield* Effect.context<Views | SqlClient.SqlClient>();
    runner.script("cancel", () => Effect.gen(function* () {
      if (race) yield* finish(runner, target, first).pipe(Effect.provide(services), Effect.orDie);
      return yield* new RunnerRejected({ reason: "An adapter refusal with private details." });
    }));
    const result = yield* call(ownerCredential, "cancel-reply", { agentId: target.agentId });
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure).toMatchObject({ _tag: "CommandRefused", reason: "reply is no longer active or cancellation failed" });
    expect(runner.callsOf("cancel")[0]!.input).toEqual({ agentId: target.agentId, deliveryId: first, sentSequence: sent.sentSequence });
    success(yield* call(ownerCredential, "group", { agentId: target.agentId, add: ["still-usable"], remove: [] }));
    if (!race) yield* finish(runner, target, first);
    expect((yield* eventually(deliveryRow(queued.deliveryId), (row) => row?.status === "sent"))?.status).toBe("sent");
    expect(promptsTo(runner, target).map((call) => call.input.delivery.id)).toEqual([first, queued.deliveryId]);
    const rows = yield* readLog;
    expect(tagged(rows, "TurnEnded")).toEqual([expect.not.objectContaining({ stopped: true })]);
    expect(tagged(rows, "AgentStopped")).toEqual([]);
    expect(JSON.stringify(rows)).not.toContain("private details");
  })).pipe(Effect.orDie));
}

it.live("only the owner or the current agent holder may cancel, and unrelated questions and waits stay open", () => deliveryRig(rig, (runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const lead = yield* spawn(rig, runner);
  const worker = yield* spawn(rig, runner, lead);
  const unrelated = yield* spawn(rig, runner);
  const member = yield* spawn(rig, runner, worker);
  yield* send(runner, lead, "Keep routed questions queued.");
  yield* send(runner, worker, "Keep working.");
  yield* send(runner, unrelated, "Keep working too.");
  yield* send(runner, member, "Keep the wait open.");
  const question = success(yield* call(agentCredential(worker.token), "ask", { text: "An unrelated open question." }));
  const wait = success(yield* call(agentCredential(worker.token), "wait", { members: [member.agentId], mode: "all", block: false }));
  for (const caller of [agentCredential(unrelated.token), agentCredential(worker.token)]) {
    expect((yield* call(caller, "cancel-reply", { agentId: worker.agentId }))._tag).toBe("Failure");
  }
  expect(runner.callsOf("cancel")).toHaveLength(0);
  success(yield* call(agentCredential(lead.token), "cancel-reply", { agentId: worker.agentId }));
  const state = yield* snapshot;
  expect(state.questions[question.questionId]?.status).toBe("open");
  expect(state.waits[wait.waitId]?.status).toBe("open");
  expect(state.agents[worker.agentId]?.state._tag).toBe("working");
  expect(runner.callsOf("stop")).toHaveLength(0);
})).pipe(Effect.orDie));
