import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { expect, it } from "vitest";
import type WebSocket from "ws";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { freshRequest } from "../support/handlerRig.ts";
import { requestFrame } from "../support/socketClient.ts";
import { connected, eventually, login, pause, upgrade, withWeb } from "../support/webRig.ts";

registerRebuildCheck({ noLog: true });

it("5.11 cap: catches counting only stream connections, rejecting a reconnect at 32, or evicting a connection for an unauthorized upgrade", async () => withWeb((ctx) => Effect.gen(function* () {
  const { cookie } = yield* login(ctx);
  const sockets: WebSocket[] = [];
  // Sixteen pages each open a stream connection and a read connection.
  for (let page = 0; page < 16; page++) {
    const stream = yield* connected(ctx, cookie);
    stream.send(requestFrame(`stream-${page}`, "subscribe", { requestId: freshRequest(), after: 0 }));
    sockets.push(stream, yield* connected(ctx, cookie));
  }
  expect(sockets.every((socket) => socket.readyState === 1)).toBe(true);
  expect((yield* upgrade(ctx)).status).toBe(401);
  expect((yield* upgrade(ctx, { Cookie: cookie, Origin: "https://evil.invalid" })).status).toBe(403);
  yield* pause();
  expect(sockets.every((socket) => socket.readyState === 1), "a refused upgrade evicted a valid connection").toBe(true);
  const newest = yield* connected(ctx, cookie);
  yield* eventually(() => sockets[0]!.readyState, (state) => state === 3, "the 33rd accepted connection must close the oldest");
  expect(sockets.slice(1).every((socket) => socket.readyState === 1)).toBe(true);
  expect(newest.readyState).toBe(1);
})));

it("5.11 missed heartbeats: catches keeping a dead client, closing after only one missed beat, or closing a healthy sibling", async () => withWeb((ctx) => Effect.gen(function* () {
  const { cookie } = yield* login(ctx);
  const dead = yield* connected(ctx, cookie, false);
  const healthy = yield* connected(ctx, cookie);
  yield* pause();
  yield* TestClock.adjust(25_000);
  yield* pause();
  expect(dead.readyState).toBe(1);
  // The first beat has been missed; do not close before two full intervals.
  yield* TestClock.adjust(24_999);
  yield* pause();
  expect(dead.readyState).toBe(1);
  yield* TestClock.adjust(1); yield* pause();
  expect(dead.readyState, "one unanswered heartbeat must not close the client at 50 seconds").toBe(1);
  expect(healthy.readyState).toBe(1);
  yield* TestClock.adjust(25_000); yield* pause();
  yield* eventually(() => dead.readyState, (state) => state === 3, "a client missing two heartbeats stayed open");
  expect(healthy.readyState).toBe(1);
}), { clock: true }));
