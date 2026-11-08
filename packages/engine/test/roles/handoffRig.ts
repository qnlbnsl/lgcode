import type { AgentId, Event, EventEnvelope } from "@lgcode/contracts";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { expect } from "vitest";
import { serve } from "../../src/api/server.ts";
import { makeRedactor } from "../../src/identity/redactor.ts";
import { incarnationOf, makeFakeRunner, type FakeRunner } from "../support/fakeRunner.ts";
import {
  agentIdOf, freshRequest, makeFakeSecrets, makeRig, provideRig, removeRig,
  seedAccount, seedHarness, startPayload, stateOf, type Rig,
} from "../support/handlerRig.ts";
import { eventually } from "../support/routingRig.ts";
import { connect, type Client } from "../support/socketClient.ts";
import { unwrap } from "../client/support/readRig.ts";

export type Content = Extract<Event, { _tag: "ThreadItem" }>["content"];
export interface Peer { readonly agentId: AgentId; readonly token: string; readonly client: Client }
export interface Handoff {
  readonly requestId: string;
  readonly agentId: string;
  readonly firstPrompt: string;
  readonly lastExchange: string;
  readonly recent: ReadonlyArray<{ readonly sequence: number; readonly text: string }>;
  readonly omitted: ReadonlyArray<{ readonly from: number; readonly to: number }>;
}
export interface Context { readonly rig: Rig; readonly runner: FakeRunner; readonly owner: Client; readonly socket: string }
export const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");

// The command and tool inventories already expose handoff. Use the real socket
// handler, so a missing implementation is a CommandError, never a missing import.
export const outcome = (client: Client, name: string, payload: Record<string, unknown> = {}) => {
  const command = (client as unknown as Record<string, (payload: unknown) => Effect.Effect<any, any, any>>)[name];
  expect(command, `${name} must be in the public command group`).toBeTypeOf("function");
  return command!({ requestId: freshRequest(), ...payload }).pipe(Effect.result);
};
export const request = (client: Client, name: string, payload: Record<string, unknown> = {}) => Effect.gen(function* () {
  const result = yield* outcome(client, name, payload);
  expect(result._tag, `${name} must succeed; got ${result._tag === "Failure" ? JSON.stringify(result.failure) : "reply"}`).toBe("Success");
  if (result._tag === "Failure") throw new Error("The authenticated read was refused");
  return result.success as any;
});
export const handoff = (client: Client, target: Peer, requestId: string = freshRequest()) => Effect.gen(function* () {
  const wire = yield* request(client, "roles.handoff", { agentId: target.agentId, requestId });
  expect(Object.keys(wire).sort()).toEqual(["data", "requestId"]);
  expect(wire.requestId).toBe(requestId);
  const body = unwrap(wire) as Handoff;
  expect(body.agentId).toBe(target.agentId);
  return { wire, body };
});

export const runHandoff = async <A>(
  check: Effect.Effect<void, any, any>,
  body: (context: Context) => Effect.Effect<A, any, any>,
  redactedFixture?: string,
): Promise<A> => {
  const rig = makeRig();
  try {
    const runner = await Effect.runPromise(makeFakeRunner());
    const redactor = makeRedactor({
      secrets: () => redactedFixture === undefined ? [] : [Redacted.make(redactedFixture)],
      tokenHashes: () => new Set<string>(),
    });
    return await Effect.runPromise(provideRig(rig, { runner, secrets: makeFakeSecrets(), redactor: redactor.layer }, Effect.gen(function* () {
      yield* check;
      yield* seedHarness();
      yield* seedAccount();
      yield* runner.subscribed;
      const socket = join(rig.stateFolder, "handoff.sock");
      const bearer = randomBytes(32).toString("base64url");
      yield* serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false });
      const owner = yield* connect(socket, bearer);
      return yield* body({ rig, runner, owner, socket });
    })) as Effect.Effect<A, any>);
  } finally { removeRig(rig); }
};

export const spawn = (context: Context, parent?: Peer, extra: Record<string, unknown> = {}) => Effect.gen(function* () {
  const reply = yield* request(parent?.client ?? context.owner, "start", startPayload(context.rig, extra));
  const agentId = agentIdOf(reply.agentId);
  const start = context.runner.callsOf("start").find((row) => row.input.agentId === agentId);
  expect(start, "a public start must actually spawn the runner").toBeDefined();
  const token = Redacted.value(start!.input.token);
  const client = yield* connect(context.socket, token);
  // RpcClient construction can return before its WebSocket opens. Complete a
  // permitted self-read so an unused peer cannot be closed mid-handshake when
  // the expected RED assertion unwinds the scope under suite load.
  yield* request(client, "client.thread", { agentId, after: 0, limit: 1 });
  return { agentId, token, client } satisfies Peer;
});

export const rows = (context: Context, target: Peer) => Effect.gen(function* () {
  const all: EventEnvelope[] = [];
  let after = 0;
  for (;;) {
    const page = yield* request(context.owner, "client.thread", { agentId: target.agentId, after, limit: 500 });
    all.push(...page.items);
    if (page.next === undefined) return all;
    expect(page.next).toBeGreaterThan(after);
    after = page.next;
  }
});
export const firstRow = (context: Context, target: Peer) => rows(context, target).pipe(Effect.map((all) => {
  const row = all.find((row) => row.event._tag === "AgentStarted");
  expect(row, "public start must write AgentStarted").toBeDefined();
  return row!;
}));

export const sent = (context: Context, target: Peer) => Effect.gen(function* () {
  const calls = () => context.runner.callsOf("prompt").filter((row) => row.input.agentId === target.agentId);
  const observed = yield* eventually(Effect.sync(calls), (calls) => calls.length > 0);
  expect(observed.length, "a prompt must reach the runner before its updates are emitted").toBeGreaterThan(0);
  return observed.at(-1)!.input.delivery.id;
});
export const prompt = (context: Context, target: Peer, text: string) => Effect.gen(function* () {
  const reply = yield* request(context.owner, "prompt", { agentId: target.agentId, text });
  const observed = yield* eventually(Effect.sync(() => context.runner.callsOf("prompt").some((row) => row.input.delivery.id === reply.deliveryId)), Boolean);
  expect(observed, "the queued prompt must be sent").toBe(true);
  return reply.deliveryId as string;
});

// Publish actual, schema-complete runner updates. The engine writes ThreadItem;
// this helper never appends thread events or fabricates PromptSent.
export const updates = (context: Context, target: Peer, deliveryId: string, contents: ReadonlyArray<Content>) => Effect.gen(function* () {
  const before = (yield* rows(context, target)).filter((row) => row.event._tag === "ThreadItem").length;
  for (const content of contents) {
    yield* context.runner.emit({
      _tag: "deliveryUpdate", agentId: target.agentId, incarnation: incarnationOf(target.token), deliveryId,
      kind: content._tag === "text" ? "message" : content._tag,
      replay: false, role: "agent", text: content._tag === "text" ? content.text : "Structured runner update.", content,
    });
  }
  const all = yield* eventually(rows(context, target), (all) => all.filter((row) => row.event._tag === "ThreadItem").length === before + contents.length);
  const items = all.filter((row) => row.event._tag === "ThreadItem");
  expect(items).toHaveLength(before + contents.length);
  return items.slice(before);
});
export const finish = (context: Context, target: Peer) => Effect.gen(function* () {
  const deliveryId = yield* sent(context, target);
  yield* context.runner.emit({ _tag: "turnEnded", agentId: target.agentId, incarnation: incarnationOf(target.token), deliveryId });
  expect(yield* eventually(stateOf(target.agentId), (state) => state === "idle")).toBe("idle");
});
export const text = (value: string): Content => ({ _tag: "text", text: value });
export const tool = (id: string, output: string, input = "Read the work folder."): Content => ({
  _tag: "tool-call", callId: id, title: `Tool ${id}`, status: "completed", input, output,
});
export const file = (id: string, diff: string): Content => ({ _tag: "file-change", path: `src/${id}.ts`, diff });

export const budget = (wire: unknown) => {
  const size = bytes(wire);
  expect(Math.ceil(size / 3), "16,000 estimated tokens include JSON and the data envelope").toBeLessThanOrEqual(16_000);
  expect(size, "the whole encoded reply must fit 64 KiB").toBeLessThanOrEqual(64 * 1024);
};
export const sectionCap = (value: string) => {
  expect(bytes(value)).toBeLessThanOrEqual(20 * 1024);
  // A cut section should fill its allocation. Leave room for a whole Unicode
  // character and the fixed marker, without pinning its exact prose or length.
  expect(bytes(value)).toBeGreaterThan(20 * 1024 - 256);
};
export const cutAt = (value: string, sequence: number) => {
  expect(value, `a cut marker must name sequence ${sequence}`).toMatch(new RegExp(`(?:cut|omitted|truncated)[^\\n]{0,100}\\b${sequence}\\b`, "i"));
};
export const omittedSequences = (value: Handoff): number[] => {
  const numbers: number[] = [];
  let previous = 0;
  for (const range of value.omitted) {
    expect(Number.isSafeInteger(range.from)).toBe(true);
    expect(Number.isSafeInteger(range.to)).toBe(true);
    expect(range.from).toBeGreaterThan(previous);
    expect(range.to).toBeGreaterThanOrEqual(range.from);
    expect(range.to - range.from).toBeLessThan(100_000);
    for (let n = range.from; n <= range.to; n++) numbers.push(n);
    previous = range.to;
  }
  return numbers;
};
