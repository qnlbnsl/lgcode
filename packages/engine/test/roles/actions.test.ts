import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { CommandsRpcGroup, rolesMaxima } from "@shephrd/contracts";
import { expect, it } from "vitest";
import { agentCredential, appendSetup, call, failureOf, headSequence, seedAgent } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { read, readOutcome, run as runReadRig } from "../client/support/readRig.ts";
import { action, bytes, owner } from "./fixtures.ts";

const run = <A>(program: Effect.Effect<A, any, any>) => runReadRig(program, registerRebuildCheck());

it("A01 an empty action history returns the request id, no items and no next cursor", async () => run(Effect.gen(function* () {
  expect(yield* read("roles.actions.list", { requestId: "empty-actions" })).toEqual({ requestId: "empty-actions", items: [] });
})));

it("A02 newest-first pages use an exclusive sequence cursor without losing equal-kind records or stopped agents", async () => run(Effect.gen(function* () {
  yield* seedAgent({ id: "worker", state: "stopped" });
  const rows = yield* appendSetup([action("StallSeen"), action("StallSeen", { occurrence: 2 }), action("ReplaceAdvised")]);
  const head = yield* headSequence;
  const first = yield* read("roles.actions.list", { requestId: "actions-page", limit: 2 });
  expect(first.requestId).toBe("actions-page");
  expect(first.items.map((row: any) => [row._tag, row.sequence])).toEqual([
    ["roles.ReplaceAdvised", rows[2]!.sequence], ["roles.StallSeen", rows[1]!.sequence],
  ]);
  expect(first.next).toBe(rows[1]!.sequence);
  const last = yield* read("roles.actions.list", { after: first.next, limit: 2 });
  expect(last.items).toMatchObject([{ _tag: "roles.StallSeen", sequence: rows[0]!.sequence, agentId: "worker", occurrence: 1 }]);
  expect(last.items).toHaveLength(1);
  expect(last).not.toHaveProperty("next");
  expect(yield* headSequence).toBe(head);
})));

it("A03 the agent filter applies before pagination and does not leak unrelated agents into a short page", async () => run(Effect.gen(function* () {
  yield* appendSetup([action("StallSeen"), action("CacheFlushed", { agentId: "other" }), action("StallSeen", { occurrence: 2 })]);
  const first = yield* read("roles.actions.list", { agentId: "worker", limit: 1 });
  const second = yield* read("roles.actions.list", { agentId: "worker", after: first.next, limit: 1 });
  expect(first.items.map((row: any) => [row.agentId, row.occurrence])).toEqual([["worker", 2]]);
  expect(second.items.map((row: any) => [row.agentId, row.occurrence])).toEqual([["worker", 1]]);
  expect(second).not.toHaveProperty("next");
})));

it("A04 a resent action read computes a fresh page instead of returning a stored receipt", async () => run(Effect.gen(function* () {
  yield* appendSetup([action("StallSeen")]);
  const payload = { requestId: "repeat-action-read", limit: 1 };
  const first = yield* read("roles.actions.list", payload);
  yield* appendSetup([action("ReplaceAdvised")]);
  const second = yield* read("roles.actions.list", payload);
  expect(first.items[0]._tag).toBe("roles.StallSeen");
  expect(second.items[0]._tag).toBe("roles.ReplaceAdvised");
  expect(second.items[0].sequence).toBeGreaterThan(first.items[0].sequence);
})));

it("A05 an agent cannot read action history even when filtering to its own agentId", async () => run(Effect.gen(function* () {
  const agent = yield* seedAgent({ id: "worker" });
  yield* appendSetup([action("StallSeen")]);
  const before = yield* headSequence;
  expect(failureOf(yield* call(agentCredential(agent.token), "roles.actions.list", { agentId: "worker" }))?._tag).toBe("CommandRefused");
  const wire = yield* readOutcome("roles.actions.list", { agentId: "worker" }, agentCredential(agent.token));
  expect(wire._tag).toBe("Failure");
  if (wire._tag === "Failure") expect(wire.failure._tag).toBe("CommandError");
  // The owner's positive control prevents a universal refusal from passing.
  expect((yield* read("roles.actions.list")).items).toHaveLength(1);
  expect(yield* headSequence).toBe(before);
})));

it("A06 the 500-record page cap leaves a moving cursor and the remainder is still reachable", async () => run(Effect.gen(function* () {
  yield* appendSetup(Array.from({ length: 501 }, (_, index) => action("CacheFlushed", { occurrence: index + 1 })));
  const first = yield* read("roles.actions.list", { limit: 500 });
  expect(first.items).toHaveLength(500);
  expect(first.items[0].occurrence).toBe(501);
  expect(first.items.at(-1).occurrence).toBe(2);
  const last = yield* read("roles.actions.list", { after: first.next, limit: 500 });
  expect(last.items.map((row: any) => row.occurrence)).toEqual([1]);
  expect(last).not.toHaveProperty("next");
})));

it("A08 generic after continuation traverses byte-limited filtered pages once in descending order", async () => run(Effect.gen(function* () {
  const schema = CommandsRpcGroup.requests.get("roles.actions.list")!.payloadSchema;
  expect(Schema.decodeUnknownSync(schema)({ requestId: "cursor-schema", after: 42 })).toHaveProperty("after", 42);
  const written = yield* appendSetup(Array.from({ length: 7 }, (_, index) => action("TeamIdleReported", {
    agentId: index % 2 === 0 ? "worker" : "other", group: `group-${index}-${"界\"\\".repeat(12_000)}`,
  })));
  const expected = written.filter((row) => "agentId" in row.event && row.event.agentId === "worker").toReversed().map((row) => row.sequence);
  const seen: number[] = [];
  let after: number | undefined;
  for (let pages = 0; pages < 5; pages++) {
    const page = yield* read("roles.actions.list", { requestId: "byte-pages", agentId: "worker", ...(after === undefined ? {} : { after }), limit: 500 });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.length).toBeLessThan(500);
    expect(bytes(page)).toBeLessThanOrEqual(rolesMaxima.actionPageBytes);
    expect(page.items.every((row: any) => row.agentId === "worker")).toBe(true);
    seen.push(...page.items.map((row: any) => row.sequence));
    if (page.next === undefined) break;
    expect(page.next).toBe(page.items.at(-1).sequence);
    expect(page.next).toBeLessThan(after ?? Infinity);
    after = page.next;
  }
  expect(seen).toEqual(expected);
  expect(new Set(seen).size).toBe(seen.length);
})));

it.each([-1, 0, 1])("A09 a whole first record crosses the byte boundary without blocking older history (offset %s)", async (offset) => run(Effect.gen(function* () {
  yield* appendSetup([action("CacheFlushed")]);
  const requestId = "boundary-action";
  const [large] = yield* appendSetup([action("TeamIdleReported", { group: "" })]);
  const record = { ...large!.event, sequence: large!.sequence, noticeRead: false };
  const overhead = bytes({ requestId, items: [record], next: large!.sequence });
  const group = "g".repeat(rolesMaxima.actionPageBytes - overhead + offset);
  // Store the exact same sequence-width specimen as a newer record.
  const [stored] = yield* appendSetup([action("TeamIdleReported", { group })]);
  const first = yield* read("roles.actions.list", { requestId, limit: 500 });
  expect(first.items).toHaveLength(1);
  expect(first.items[0]).toMatchObject({ sequence: stored!.sequence, group });
  expect(bytes(first)).toBe(rolesMaxima.actionPageBytes + offset);
  expect(first.next).toBe(stored!.sequence);
  const last = yield* read("roles.actions.list", { after: first.next, limit: 500 });
  expect(last.items.map((row: any) => row._tag)).toEqual(["roles.TeamIdleReported", "roles.CacheFlushed"]);
  expect(last).not.toHaveProperty("next");
})));

it("A07 an overlarge limit is reduced to 500 as the common paged-read contract requires", async () => run(Effect.gen(function* () {
  const schema = CommandsRpcGroup.requests.get("roles.actions.list")!.payloadSchema;
  expect(() => Schema.decodeUnknownSync(schema)({ requestId: "oversized-limit", limit: 1000 }),
    "the payload must admit a larger limit so the handler can reduce it to 500").not.toThrow();
  yield* appendSetup(Array.from({ length: 501 }, (_, index) => action("CacheFlushed", { occurrence: index + 1 })));
  const page = yield* read("roles.actions.list", { limit: 1000 });
  expect(page.items).toHaveLength(500);
  expect(page.next).toBe(page.items.at(-1).sequence);
})));
