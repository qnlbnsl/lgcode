import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { CommandHandler } from "../../src/commands/CommandHandler.ts";
import { engineLists } from "../../src/pieces/lists.ts";
import { agentCredential, appendSetup, seedAgent } from "../support/handlerRig.ts";
import { run as runReadRig, read, readOutcome, event, permissionFor, unwrap, owner } from "./support/readRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

const run = <A>(program: Effect.Effect<A, any, any>) => runReadRig(program, registerRebuildCheck());

it.each(["owner", "service"])("3.8 %s event read returns a whole unscoped event with its original sequence and time", async (kind) => run(Effect.gen(function* () {
  const [source] = yield* appendSetup([event({ _tag: "AccountAvailable", accountId: "primary", cause: "owner cleared" })]);
  let reply: any;
  if (kind === "owner") reply = yield* read("client.event", { sequence: source!.sequence });
  else {
    const handler = yield* CommandHandler;
    const input = yield* handler.input({ _tag: "service", service: "roles.stallWatch" });
    const reader = engineLists.reads["client.event"];
    expect(reader, "client.event must provide an in-process service read").toBeTypeOf("function");
    const result = yield* reader!(input, { requestId: "service-event", sequence: source!.sequence }) as Effect.Effect<any, any, any>;
    reply = result.reply;
  }
  expect(reply.envelope).toEqual(source);
  expect(reply.envelope.occurredAt).toBeGreaterThan(0);
})));
it("3.8 an agent reads a visible child's start and request inside the data envelope", async () => run(Effect.gen(function* () {
  const parent = yield* seedAgent({ id: "parent" });
  yield* seedAgent({ id: "child", parent: "parent" });
  const [request] = yield* appendSetup([permissionFor("child-permission", { agentId: "child", description: "/do-not-execute" })]);
  const credential = agentCredential(parent.token);
  const reply = yield* read("client.event", { sequence: request!.sequence }, credential);
  expect(Object.keys(reply).sort()).toEqual(["data", "requestId"]);
  const recovered = unwrap(reply).envelope;
  expect(recovered).toMatchObject({ sequence: request!.sequence, occurredAt: request!.occurredAt, event: { _tag: "PermissionRequested", description: "\\/do-not-execute" } });
  const page = unwrap(yield* read("client.thread", { agentId: "child", after: 0, limit: 500 }, credential));
  const start = page.items.find((row: any) => row.event._tag === "AgentStarted");
  expect(unwrap(yield* read("client.event", { sequence: start.sequence }, credential)).envelope).toEqual(start);
})));
it("3.8 sibling, unscoped, owner-only and missing sequences have the same refusal without revealing tags or sizes", async () => run(Effect.gen(function* () {
  const a = yield* seedAgent({ id: "agent-a" });
  yield* seedAgent({ id: "sibling" });
  const rows = yield* appendSetup([
    permissionFor("sibling-permission", { agentId: "sibling" }),
    event({ _tag: "AccountAvailable", accountId: "primary", cause: "owner cleared" }),
    event({ _tag: "client.WebServerDown", reason: "Hidden piece detail." }),
  ]);
  const reasons: unknown[] = [];
  for (const sequence of [...rows.map((row) => row.sequence), 999_999]) {
    const result = yield* readOutcome("client.event", { sequence }, agentCredential(a.token));
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") reasons.push(result.failure.reason);
  }
  expect(new Set(reasons).size).toBe(1);
  expect(JSON.stringify(reasons)).not.toMatch(/PermissionRequested|AccountAvailable|WebServerDown|Hidden piece detail|bytes/);
})));
it("3.8 event access is recomputed when a grandchild's parent recovers", async () => run(Effect.gen(function* () {
  const a = yield* seedAgent({ id: "agent-a" });
  yield* seedAgent({ id: "lead", parent: "agent-a", state: "paused" });
  yield* seedAgent({ id: "worker", parent: "lead" });
  const [row] = yield* appendSetup([permissionFor("worker-p", { agentId: "worker" })]);
  expect(unwrap(yield* read("client.event", { sequence: row!.sequence }, agentCredential(a.token))).envelope.sequence).toBe(row!.sequence);
  yield* appendSetup([event({ _tag: "StateChanged", agentId: "lead", state: { _tag: "idle" } })]);
  expect((yield* readOutcome("client.event", { sequence: row!.sequence }, agentCredential(a.token)))._tag).toBe("Failure");
})));
