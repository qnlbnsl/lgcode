import type { Caller, Event, EventEnvelope } from "@sheprd/contracts";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Redacted from "effect/Redacted";
import { expect } from "vitest";
import { CommandHandler } from "../../../src/commands/CommandHandler.ts";
import { engineLists } from "../../../src/pieces/lists.ts";
import { snapshot } from "../../../src/api/snapshot.ts";
import { serve } from "../../../src/api/server.ts";
import { connect } from "../../support/socketClient.ts";
import { makeFakeRunner } from "../../support/fakeRunner.ts";
import { makeFakeSecrets, makeRig, provideRig, removeRig, seedAccount, seedHarness, freshRequest } from "../../support/handlerRig.ts";
import { registerRebuildCheck } from "../../support/rebuildCheck.ts";
import { event, envelopes, started, opened, permission, question } from "../../support/viewFixtures.ts";

export { event, envelopes, started, opened, permission, question };
export const owner = { _tag: "owner" } as const;
export const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));
const endpoints = new WeakMap<object, { socket: string; bearer: string }>();
export const endpoint = Effect.gen(function* () { return endpoints.get(yield* CommandHandler)!; });
export const run = async <A>(program: Effect.Effect<A, any, any>, rebuildCheck: Effect.Effect<void, any, any> = registerRebuildCheck()): Promise<A> => {
  const rig = makeRig();
  try {
    const runner = await Effect.runPromise(makeFakeRunner());
    return await Effect.runPromise(provideRig(rig, { runner, secrets: makeFakeSecrets() }, Effect.gen(function* () {
      yield* rebuildCheck;
      yield* seedHarness(); yield* seedAccount();
      const endpoint = { socket: join(rig.stateFolder, "read.sock"), bearer: randomBytes(32).toString("base64url") };
      yield* serve({ socketPath: endpoint.socket, ownerCredential: Redacted.make(endpoint.bearer), debug: false });
      endpoints.set(yield* CommandHandler, endpoint);
      return yield* program;
    })) as Effect.Effect<A, any>);
  } finally { removeRig(rig); }
};
export const rpc = (credential: Parameters<CommandHandler["Service"]["execute"]>[0] = owner) => Effect.gen(function* () {
  const handler = yield* CommandHandler;
  const endpoint = endpoints.get(handler)!;
  if (credential._tag === "service") throw new Error("Services use in-process reads, never a wire credential");
  return (yield* connect(endpoint.socket, credential._tag === "owner" ? endpoint.bearer : Redacted.value(credential.token))) as any;
});
export const readOutcome = (name: string, payload: Record<string, unknown> = {}, credential: Parameters<CommandHandler["Service"]["execute"]>[0] = owner) => Effect.gen(function* () {
  const client = yield* rpc(credential);
  expect(client[name], `WS-3 must install ${name} into CommandsRpcGroup with its read handler`).toBeTypeOf("function");
  return yield* (client[name]({ requestId: freshRequest(), ...payload }) as Effect.Effect<any, any>).pipe(Effect.result);
});
export const read = (name: string, payload: Record<string, unknown> = {}, credential: Parameters<CommandHandler["Service"]["execute"]>[0] = owner) =>
  Effect.gen(function* () {
    const result = yield* readOutcome(name, payload, credential);
    expect(result._tag, `${name} must be installed as a working authenticated read; got ${result._tag === "Failure" ? result.failure.reason : "reply"}`).toBe("Success");
    if (result._tag === "Failure") throw new Error("Read refused");
    return result.success as any;
  });
export const stream = (payload: Record<string, unknown>, caller: Caller = owner): Stream.Stream<any, any, any> => {
  const read = engineLists.reads["client.subscribe"];
  expect(read, "WS-3 must register the real client.subscribe read handler").toBeTypeOf("function");
  return Stream.unwrap(Effect.gen(function* () {
  const handler = yield* CommandHandler;
  const input = yield* handler.input(caller);
  return read!(input, { requestId: freshRequest(), ...payload }) as Stream.Stream<any, any, any>;
  }));
};
export const snapshotFor = (caller: Caller = owner) => snapshot(caller) as Effect.Effect<any, any, any>;
export const textItem = (id: string, text: string, agentId = "agent-a"): Event => event({
  _tag: "ThreadItem", agentId, itemId: id, content: { _tag: "text", text }, replay: false,
});
export const permissionFor = (id: string, overrides: Record<string, unknown> = {}): Event => event({
  ...permission, permissionRequestId: id, deliveryId: `delivery-${id}`, ...overrides,
});
export const questionFor = (id: string, overrides: Record<string, unknown> = {}): Event => event({
  ...question, questionId: id, deliveryId: `delivery-${id}`, ...overrides,
});
// Only the three envelope lines are interpreted here. The server owns the
// unpredictable marker; decoded event text remains data throughout the test.
export const unwrap = (reply: { data: string }): any => {
  expect(typeof reply.data).toBe("string");
  const lines = reply.data.split("\n");
  expect(lines).toHaveLength(3);
  const marker = /\[([^\]]+)\]/.exec(lines[0]!)?.[1];
  expect(marker).toBeTruthy();
  expect(lines[2]).toBe(`End data [${marker}]`);
  return JSON.parse(lines[1]!);
};
export const eventSequences = (rows: ReadonlyArray<EventEnvelope>): number[] => rows.map((row) => row.sequence);
