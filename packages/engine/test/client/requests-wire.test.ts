import type { ClientRequest } from "@lgcode/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { expect, it } from "vitest";
import { agentCredential, appendSetup, call, seedAgent, success } from "../support/handlerRig.ts";
import { run as runReadRig, read, readOutcome, questionFor, bytes, unwrap, snapshotFor } from "./support/readRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

const run = <A>(program: Effect.Effect<A, any, any>) => runReadRig(program, registerRebuildCheck());

it("authenticated request history keeps decision metadata and agent event reads escape its prose", async () => run(Effect.gen(function* () {
  const agent = yield* seedAgent({ id: "agent-a", state: "working" });
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

it("bounds the final empty client request reply through the authenticated handler and socket", async () => run(Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const before = { state: yield* snapshotFor(), receipts: yield* sql`SELECT * FROM receipts`, events: yield* sql`SELECT * FROM events ORDER BY sequence` };
  const controlId = '"'.repeat(140000);
  const control = yield* read("client.requests", { after: 0, limit: 200, requestId: controlId });
  expect(control).toEqual({ requestId: controlId, sequence: before.state.sequence, items: [] });
  expect(bytes(control)).toBeGreaterThan(256 * 1024);
  expect(bytes(control)).toBeLessThanOrEqual(512 * 1024);
  const payload = { after: 0, limit: 200, requestId: '"'.repeat(270000) };
  const direct = yield* call({ _tag: "owner" }, "client.requests", payload);
  const wire = yield* readOutcome("client.requests", payload);
  for (const [path, result] of [["handler", direct], ["socket", wire]] as const) {
    console.log("empty-client-budget", path, result._tag, result._tag === "Success" ? bytes(result.success) : result.failure.reason);
  }
  expect({ state: yield* snapshotFor(), receipts: yield* sql`SELECT * FROM receipts`, events: yield* sql`SELECT * FROM events ORDER BY sequence` }).toEqual(before);
  expect(direct._tag === "Failure" && direct.failure.reason).toBe("request identity exceeds page limit");
  expect(wire._tag === "Failure" && wire.failure).toMatchObject({ _tag: "CommandError", requestId: payload.requestId, reason: "command refused" });
})));

it("bounds filtered and exhausted request pages while preserving owner-only access and source pagination", async () => run(Effect.gen(function* () {
  const agent = yield* seedAgent({ id: "agent-a", state: "working" });
  const credential = agentCredential(agent.token);
  const first = success(yield* call(credential, "ask", { text: "/First decision" }));
  success(yield* call(credential, "ask", { text: "Second decision" }));
  const sql = yield* SqlClient.SqlClient;
  const before = { state: yield* snapshotFor(), receipts: yield* sql`SELECT * FROM receipts`, events: yield* sql`SELECT * FROM events ORDER BY sequence` };
  const page = yield* read("client.requests", { after: 0, limit: 1 });
  expect(page.items).toHaveLength(1);
  expect(page.items[0]).toMatchObject({ id: first.questionId, canAnswer: true });
  expect(page.next).toBe(page.items[0].sourceSequence);
  const last = yield* read("client.requests", { after: page.next, limit: 1 });
  expect(last.items).toHaveLength(1);
  expect(last.items[0].sourceSequence).toBeGreaterThan(page.next);
  expect(last.next).toBeUndefined();
  for (const fields of [{ status: "answered" }, { agentId: "missing" }, { kind: "permission" }, { after: last.items[0].sourceSequence }, { after: page.sequence }]) {
    const payload = { after: 0, limit: 200, ...fields };
    const control = yield* read("client.requests", payload);
    expect(control.items).toEqual([]);
    expect(control.next).toBeUndefined();
    const requestId = '"'.repeat(270000);
    const refused = yield* readOutcome("client.requests", { ...payload, requestId });
    expect(refused._tag === "Failure" && refused.failure).toMatchObject({ requestId, reason: "command refused" });
  }
  expect((yield* readOutcome("client.requests", { after: 0, limit: 200 }, credential))._tag).toBe("Failure");
  const ahead = yield* call({ _tag: "owner" }, "client.requests", { after: page.sequence + 1, limit: 200, requestId: '"'.repeat(270000) });
  expect(ahead._tag === "Failure" && ahead.failure.reason).toBe("cursor ahead of snapshot");
  expect({ state: yield* snapshotFor(), receipts: yield* sql`SELECT * FROM receipts`, events: yield* sql`SELECT * FROM events ORDER BY sequence` }).toEqual(before);
})));
