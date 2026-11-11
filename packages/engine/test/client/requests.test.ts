import { it } from "@effect/vitest";
import { Event, type ClientRequest } from "@lgcode/contracts";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { makeRedactor } from "../../src/identity/redactor.ts";
import { deliveryRig, spawn, send } from "../support/deliveryRig.ts";
import { agentCredential, appendSetup, eventOf, call, makeRig, ownerCredential, readLog, removeRig, success, type Rig } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { requestPermission, pause, tagged } from "../support/routingRig.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });
const index = (extra: Record<string, unknown> = {}) => Effect.gen(function* () {
  return success(yield* call(ownerCredential, "client.requests", { after: 0, limit: 200, ...extra }));
});

it.live("request metadata, owner history and actual open/close times survive a fresh engine replay", () => Effect.gen(function* () {
  const secret = "private-request-secret-123456789";
  const redactor = makeRedactor({ secrets: () => [Redacted.make(secret)], tokenHashes: () => new Set() });
  const original = yield* deliveryRig(rig, (runner) => Effect.gen(function* () {
    yield* registerRebuildCheck();
    const lead = yield* spawn(rig, runner);
    const worker = yield* spawn(rig, runner, lead);
    yield* send(runner, lead, "Keep routed deliveries queued.");
    yield* send(runner, worker, "Keep answers queued.");
    yield* appendSetup([
      eventOf({ _tag: "project.Created", projectId: "requests-project", repoId: "requests-repo", worktreeId: "requests-workspace", name: "Requests", goal: "History", machineId: "local", leadAgentId: lead.agentId }),
      eventOf({ _tag: "project.SprintAdded", projectId: "requests-project", sprintId: "sprint-1", label: "SP-1", name: "Requests", goal: "History", phase: "Build", owner: worker.agentId, needs: [] }),
      eventOf({ _tag: "project.TaskAdded", projectId: "requests-project", taskId: "task-1", owner: worker.agentId, teamId: "requests-team", sprintId: "sprint-1", worktreeId: "requests-workspace", state: "active", title: "Decision" }),
    ])
    const metadata = { title: "Choose the layout", recommendation: `Keep the sidebar. ${secret}`,
      proposedAnswer: "Use the sidebar.", taskId: "task-1", sprintId: "sprint-1" };
    const { questionId } = success(yield* call(agentCredential(worker.token), "ask", { text: "Which layout?", ...metadata }));
    const held = (yield* index()).items.find((row: ClientRequest) => row.id === questionId);
    expect(held).toMatchObject({ holder: { _tag: "agent", agentId: lead.agentId }, status: "open", canAnswer: false,
      display: { ...metadata, recommendation: "Keep the sidebar. [REDACTED]" } });
    success(yield* call(agentCredential(lead.token), "pass-up", { subject: { _tag: "question", id: questionId } }));
    expect((yield* index()).items.find((row: ClientRequest) => row.id === questionId).canAnswer).toBe(true);
    yield* pause(10);
    success(yield* call(ownerCredential, "answer", { kind: "question", id: questionId, text: "Use the sidebar." }));
    // A permission's input stays in the redacted event, never in the index.
    const permission = yield* requestPermission(runner, worker, { description: "Review an action.",
      ...{ toolInput: { command: `echo ${secret}` }, inputRedacted: true, inputTruncated: true },
    });
    success(yield* call(ownerCredential, "stop", { agentId: worker.agentId }));
    const page = yield* index();
    const events = yield* (yield* SqlClient.SqlClient)<{ sequence: number; occurred_at: number }>`SELECT sequence, occurred_at FROM events`;
    for (const row of page.items as ClientRequest[]) {
      const open = events.find((event) => event.sequence === row.sourceSequence)!;
      const closed = events.find((event) => event.sequence === row.closedSequence)!;
      expect(row.openedAt).toBe(open.occurred_at);
      expect(row.answeredAt).toBe(closed.occurred_at);
      expect(row.canAnswer).toBe(false);
    }
    expect(page.items.find((row: ClientRequest) => row.id === permission.id)).toMatchObject({ status: "cancelled", reason: "agent stopped", display: { inputAvailable: true, inputRedacted: true, inputTruncated: true } });
    expect(page.items.find((row: ClientRequest) => row.id === questionId)).toMatchObject({ status: "answered", answer: "Use the sidebar." });
    expect(JSON.stringify(page)).not.toContain(secret);
    expect(JSON.stringify(page)).not.toContain("toolInput");
    expect((yield* call(agentCredential(lead.token), "client.requests", { after: 0, limit: 20 }))._tag).toBe("Failure");
    expect((yield* index({ status: "open" })).items).toEqual([]);
    return page.items;
  }), redactor.layer);
  yield* deliveryRig(rig, () => Effect.gen(function* () {
    yield* registerRebuildCheck();
    expect((yield* index()).items).toEqual(original);
    const first = yield* index({ limit: 1 });
    expect(first.items).toEqual(original.slice(0, 1));
    expect((yield* index({ after: first.next, limit: 1 })).items).toEqual(original.slice(1));
  }), redactor.layer);
}).pipe(Effect.orDie));

it.live("old question events remain readable and large decision metadata has bounded previews", () => deliveryRig(rig, (runner) => Effect.gen(function* () {
  yield* registerRebuildCheck();
  const agent = yield* spawn(rig, runner);
  const { questionId } = success(yield* call(agentCredential(agent.token), "ask", {
    text: "A large question", title: "🐑".repeat(1000), recommendation: "x".repeat(100_000), proposedAnswer: "y".repeat(100_000),
  }));
  const page = yield* index();
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(8192);
  const row = page.items.find((row: ClientRequest) => row.id === questionId);
  expect(Buffer.byteLength(row.display.title)).toBeLessThanOrEqual(256);
  expect(row.display.bytes).toBeGreaterThan(200_000);
  const asked = tagged(yield* readLog, "QuestionAsked")[0]!;
  const { title: _title, recommendation: _recommendation, proposedAnswer: _proposedAnswer, ...old } = asked;
  expect(Schema.decodeUnknownSync(Event)(old)).toEqual(old);
})).pipe(Effect.orDie));
