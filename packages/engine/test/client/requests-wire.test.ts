import type { ClientRequest } from "@lgcode/contracts";
import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { agentCredential, appendSetup, eventOf, call, seedAgent, success } from "../support/handlerRig.ts";
import { run as runReadRig, read, readOutcome, questionFor, bytes, unwrap } from "./support/readRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

const run = <A>(program: Effect.Effect<A, any, any>) => runReadRig(program, registerRebuildCheck());

it("authenticated request history keeps decision metadata and agent event reads escape its prose", async () => run(Effect.gen(function* () {
  const agent = yield* seedAgent({ id: "agent-a", state: "working" });
  yield* appendSetup([
    eventOf({ _tag: "project.Created", projectId: "requests-project", repoId: "requests-repo", worktreeId: "requests-workspace", name: "Requests", goal: "History", machineId: "local", leadAgentId: "agent-a" }),
    eventOf({ _tag: "project.SprintAdded", projectId: "requests-project", sprintId: "sprint-1", label: "SP-1", name: "Requests", goal: "History", phase: "Build", owner: "agent-a", needs: [] }),
    eventOf({ _tag: "project.TaskAdded", projectId: "requests-project", taskId: "task-1", owner: "agent-a", teamId: "requests-team", sprintId: "sprint-1", worktreeId: "requests-workspace", state: "active", title: "Decision" }),
  ])
  const metadata = { title: "/Choose", recommendation: "/Prefer this", proposedAnswer: "/Accept", taskId: "task-1", sprintId: "sprint-1" };
  const asked = success(yield* call(agentCredential(agent.token), "ask", { text: "/Decide", ...metadata }));
  const page = yield* read("client.requests", { after: 0, limit: 200 });
  expect(page.items).toHaveLength(1);
  expect(page.items[0]).toMatchObject({ id: asked.questionId, kind: "question", status: "open", canAnswer: true, display: metadata });
  const event = yield* read("client.event", { sequence: page.items[0].sourceSequence }, agentCredential(agent.token));
  expect(unwrap(event).envelope.event).toMatchObject({ text: "\\/Decide", title: "\\/Choose", recommendation: "\\/Prefer this", proposedAnswer: "\\/Accept", taskId: "task-1", sprintId: "sprint-1" });
  expect((yield* readOutcome("client.requests", { after: 0, limit: 200 }, agentCredential(agent.token)))._tag).toBe("Failure");
  expect((yield* readOutcome("client.requests", { after: page.sequence + 1, limit: 200 }))._tag).toBe("Failure");
})));

it("request history pages under its encoded byte and row budgets without losing requests", async () => run(Effect.gen(function* () {
  yield* seedAgent({ id: "agent-a", state: "working" });
  yield* appendSetup(Array.from({ length: 205 }, (_, index) => questionFor(`question-${index}`, {
    text: '"'.repeat(512), title: '"'.repeat(256), recommendation: '"'.repeat(512), proposedAnswer: '"'.repeat(512),
  })));
  const rows: ClientRequest[] = [];
  let after = 0;
  let pages = 0;
  while (true) {
    const page = yield* read("client.requests", { after, limit: 1000 });
    expect(bytes(page)).toBeLessThanOrEqual(512 * 1024);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.length).toBeLessThanOrEqual(200);
    expect(page.items.every((row: ClientRequest) => row.sourceSequence > after && row.display !== undefined)).toBe(true);
    rows.push(...page.items);
    pages++;
    if (page.next === undefined) break;
    expect(page.next).toBe(page.items.at(-1).sourceSequence);
    after = page.next;
    expect(pages).toBeLessThan(5);
  }
  expect(pages).toBeGreaterThan(1);
  expect(rows.map((row) => row.id)).toEqual(Array.from({ length: 205 }, (_, index) => `question-${index}`));
})));
