import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { agentCredential, appendSetup, seedAgent } from "../support/handlerRig.ts";
import { run as runReadRig, read, permissionFor, questionFor, event } from "./support/readRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

const run = <A>(program: Effect.Effect<A, any, any>) => runReadRig(program, registerRebuildCheck());

const family = Effect.gen(function* () {
  const parent = yield* seedAgent({ id: "parent", groups: ["engine"] });
  yield* seedAgent({ id: "lead", parent: "parent", groups: ["engine"] });
  yield* seedAgent({ id: "worker", parent: "lead", groups: ["web"] });
  yield* seedAgent({ id: "sibling", groups: ["web"] });
  return parent;
});
it("3.2 roster exposes the documented fields, including parent name and open row counts", async () => run(Effect.gen(function* () {
  yield* family;
  yield* appendSetup([permissionFor("p", { agentId: "lead" }), questionFor("q", { agentId: "lead" })]);
  const reply = yield* read("client.roster", { parent: "parent" });
  expect(reply.agents).toHaveLength(1);
  expect(reply.agents[0]).toMatchObject({
    agentId: "lead", name: "name-lead", role: "worker", groups: ["engine"], parent: { _tag: "agent", agentId: "parent" }, parentName: "name-parent",
    state: { _tag: "idle" }, displayedState: expect.anything(), openPermissionRequests: 1, openQuestionsAsked: 1,
    harness: "first", account: "primary", model: "test-model", effort: "high", permission: "ask", folder: expect.any(String),
    session: { _tag: "acp", sessionId: "session-lead" }, startedAt: expect.any(Number),
  });
})));
it.each([
  [{ group: "engine" }, ["parent", "lead"]],
  [{ role: "worker", group: "web" }, ["worker", "sibling"]],
  [{ parent: "lead", group: "web", role: "worker" }, ["worker"]],
  [{ role: "nonexistent" }, []],
] as const)("3.2 roster filter %j intersects group, role and parent", async (filter, ids) => run(Effect.gen(function* () {
  yield* family;
  expect((yield* read("client.roster", filter)).agents.map((row: any) => row.agentId).sort()).toEqual([...ids].sort());
})));
it("3.2 structural and effective-holder visibility changes with the parent's availability and is checked afresh", async () => run(Effect.gen(function* () {
  const parent = yield* family;
  const ids = (reply: any) => reply.agents.map((row: any) => row.agentId).sort();
  expect(ids(yield* read("client.roster", {}, agentCredential(parent.token)))).toEqual(["lead", "parent"]);
  yield* appendSetup([event({ _tag: "StateChanged", agentId: "lead", state: { _tag: "paused", reason: "limit", midTurn: false } })]);
  expect(ids(yield* read("client.roster", {}, agentCredential(parent.token)))).toEqual(["lead", "parent", "worker"]);
  yield* appendSetup([event({ _tag: "StateChanged", agentId: "lead", state: { _tag: "idle" } })]);
  expect(ids(yield* read("client.roster", {}, agentCredential(parent.token)))).toEqual(["lead", "parent"]);
})));
it("3.2 an agent's own entry names its parent without revealing the parent's record", async () => run(Effect.gen(function* () {
  yield* seedAgent({ id: "parent" });
  const child = yield* seedAgent({ id: "child", parent: "parent" });
  const reply = yield* read("client.roster", {}, agentCredential(child.token));
  expect(reply.agents).toHaveLength(1);
  expect(reply.agents[0]).toMatchObject({ agentId: "child", parent: { _tag: "agent", agentId: "parent" }, parentName: "name-parent" });
})));
