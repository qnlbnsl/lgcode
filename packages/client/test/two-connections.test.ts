import "./support/clientFixtureGroup.ts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { afterEach, expect, it } from "vitest";
import { cleanupUnit7b } from "../../testing/test/support/unit7b.ts";
import { chunk, clientApiPeer, closeClientApiPeers, known, succeed, until, type RequestFrame } from "./support/clientApiPeer.ts";
import type { WebSocket } from "ws";

afterEach(async () => { await closeClientApiPeers(); await cleanupUnit7b(); });

it.each(["node", "browser"] as const)("2.7 %s opens only one connection for a client that never subscribes", async (transport) => {
  const peer = await clientApiPeer(transport, (frame, socket) => succeed(socket, frame, { requestId: frame.payload.requestId, questionId: "question-a" }));
  const connect = await peer.connect();
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const client = yield* connect;
    yield* client.ask!({ requestId: "one", text: "one" });
    yield* client.ask!({ requestId: "two", text: "two" });
  })));
  expect(peer.connections).toHaveLength(1);
  expect(peer.requests.map(({ connection }) => connection)).toEqual([1, 1]);
  if (transport === "browser") expect(peer.headers.some((headers) => headers.authorization !== undefined)).toBe(false);
});

for (const transport of ["node", "browser"] as const) for (const drop of ["read", "stream"] as const) {
  it(`2.7 ${transport}: a dropped ${drop} connection retries independently and never replaces its sibling`, async () => {
    const subscriptions: Array<{ frame: RequestFrame; socket: WebSocket; connection: number }> = [];
    let unary = 0;
    const peer = await clientApiPeer(transport, (frame, socket, connection) => {
      if (frame.tag === "subscribe") {
        subscriptions.push({ frame, socket, connection });
        chunk(socket, frame, [known(subscriptions.length === 1 ? 1 : 2)]);
      } else if (++unary === 2 && drop === "read") socket.close(1012, "read connection failed");
      else succeed(socket, frame, { requestId: frame.payload.requestId, questionId: "question-a" });
    });
    const connect = await peer.connect();
    const delivered: number[] = [];
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const client = yield* connect;
      yield* client.ask!({ requestId: "before", text: "before" });
      const stream = yield* Effect.forkChild(client.subscribe!({ requestId: "live", after: 0 })
        .pipe(Stream.tap((value: any) => Effect.sync(() => { delivered.push(value.sequence); })), Stream.take(2), Stream.runCollect));
      yield* Effect.promise(() => until("the stream's first event", () => delivered.length === 1));
      expect(peer.connections, "first stream must open a second socket").toHaveLength(2);
      const firstRead = peer.requests.find(({ frame }) => frame.tag === "ask")!;
      expect.soft(subscriptions[0]!.connection, "reads and stream must have independent receive loops").not.toBe(firstRead.connection);
      if (drop === "stream") {
        subscriptions[0]!.socket.close(1012, "stream connection failed");
        yield* Effect.promise(() => until("a resumed stream", () => subscriptions.length === 2));
      }
      yield* client.ask!({ requestId: "during", text: "during" });
      if (drop === "read") chunk(subscriptions[0]!.socket, subscriptions[0]!.frame, [known(2)]);
      yield* Fiber.join(stream);
      yield* client.ask!({ requestId: "after", text: "after" });
      yield* Effect.promise(() => until("last subscription closes its socket", () => subscriptions.at(-1)!.socket.readyState === 3));
    })).pipe(Effect.timeout(5_000)));
    expect(delivered).toEqual([1, 2]);
    const reads = peer.requests.filter(({ frame }) => frame.tag === "ask");
    if (drop === "read") {
      expect(subscriptions).toHaveLength(1);
      expect(reads.map(({ frame }) => frame.payload.requestId)).toEqual(["before", "during", "during", "after"]);
      expect(reads[0]!.connection).not.toBe(reads[2]!.connection);
      expect(reads[2]!.connection).toBe(reads[3]!.connection);
    } else {
      expect(subscriptions.map(({ frame }) => frame.payload.after)).toEqual([0, 1]);
      expect(new Set(reads.map(({ connection }) => connection)).size).toBe(1);
    }
    expect(peer.connections).toHaveLength(3);
  });
}

it.each(["node", "browser"] as const)("2.7 %s shares one stream socket across subscriptions and closes it only after the last consumer leaves", async (transport) => {
  const subscriptions: Array<{ frame: RequestFrame; socket: WebSocket; connection: number }> = [];
  const peer = await clientApiPeer(transport, (frame, socket, connection) => {
    if (frame.tag === "subscribe") {
      subscriptions.push({ frame, socket, connection });
      chunk(socket, frame, [known(1)]);
    } else succeed(socket, frame, { requestId: frame.payload.requestId, questionId: "question-a" });
  });
  const connect = await peer.connect();
  const delivered: number[] = [];
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const client = yield* connect;
    yield* client.ask!({ requestId: "read", text: "read" });
    const consume = (requestId: string) => client.subscribe({ requestId, after: 0 }).pipe(
      Stream.tap((value) => Effect.sync(() => { delivered.push(value.sequence); })), Stream.runDrain);
    const first = yield* Effect.forkChild(consume("first-stream"));
    const second = yield* Effect.forkChild(consume("second-stream"));
    yield* Effect.promise(() => until("both subscriptions receive their first event", () => delivered.length === 2));
    expect(peer.connections, "subscriptions must share the dedicated stream socket").toHaveLength(2);
    expect(subscriptions[0]!.connection).toBe(subscriptions[1]!.connection);
    yield* Fiber.interrupt(first);
    expect(subscriptions[1]!.socket.readyState, "cancelling one subscription must keep the other's socket open").toBe(1);
    chunk(subscriptions[1]!.socket, subscriptions[1]!.frame, [known(2)]);
    yield* Effect.promise(() => until("the remaining subscription advances", () => delivered.length === 3));
    yield* Fiber.interrupt(second);
    yield* Effect.promise(() => until("last subscription releases its socket", () => subscriptions[1]!.socket.readyState === 3));
    yield* client.ask!({ requestId: "read-after", text: "read-after" });
  })).pipe(Effect.timeout(5_000)));
  expect(delivered).toEqual([1, 1, 2]);
  expect(peer.requests.filter(({ frame }) => frame.tag === "ask").map(({ connection }) => connection)).toEqual([1, 1]);
});
