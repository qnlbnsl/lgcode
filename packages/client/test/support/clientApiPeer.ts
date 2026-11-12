import { existsSync, chmodSync } from "node:fs";
import { createServer } from "node:http";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";
import { expect, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { agentEnvironment, bounded, prepareRoot, type RequestFrame } from "../../../testing/test/support/unit7b.ts";

export { chunk, succeed, until } from "../../../testing/test/support/unit7b.ts";
export type { RequestFrame };
export interface TestClient {
  ask: (payload: any) => Effect.Effect<any, unknown>;
  subscribe: (payload: any) => Stream.Stream<any, unknown>;
  "client.subscribe": (payload: any) => Stream.Stream<any, unknown>;
}
const cleanup: Array<() => Promise<void>> = [];

export const closeClientApiPeers = async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.unstubAllGlobals();
};

export const clientApiPeer = async (
  transport: "node" | "browser",
  onRequest: (frame: RequestFrame, socket: WebSocket, connection: number) => void,
  onAck?: (socket: WebSocket, connection: number) => void,
) => {
  const root = prepareRoot();
  const server = createServer();
  const sockets = new WebSocketServer({ server });
  const connections: WebSocket[] = [];
  const requests: Array<{ frame: RequestFrame; connection: number }> = [];
  const acks: number[] = [];
  const interrupted: number[] = [];
  const headers: Array<Record<string, unknown>> = [];
  sockets.on("connection", (socket, request) => {
    const connection = connections.push(socket);
    headers.push(request.headers);
    socket.on("error", () => {});
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      for (const frame of Array.isArray(message) ? message : [message]) {
        if (frame._tag === "Ping") socket.send(JSON.stringify({ _tag: "Pong" }));
        if (frame._tag === "Ack") { acks.push(connection); onAck?.(socket, connection); }
        if (frame._tag === "Interrupt") interrupted.push(connection);
        if (frame._tag === "Request") { requests.push({ frame, connection }); onRequest(frame, socket, connection); }
      }
    });
  });
  cleanup.push(async () => {
    for (const socket of connections) socket.terminate();
    await bounded("fixture sockets close", new Promise<void>((resolve) => sockets.close(() => resolve())));
    server.closeAllConnections();
    await bounded("fixture server closes", new Promise<void>((resolve) => server.close(() => resolve())));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    if (transport === "node") server.listen(root.socket, resolve);
    else server.listen(0, "127.0.0.1", resolve);
  });
  if (transport === "node") chmodSync(root.socket, 0o600);
  const connect = async (): Promise<Effect.Effect<TestClient, unknown, Scope.Scope>> => {
    if (transport === "node") {
      const module = await import("@lgtm/client");
      return module.connect({ environment: agentEnvironment(root), attempts: 3 }) as unknown as Effect.Effect<TestClient, unknown, Scope.Scope>;
    }
    const url = new URL("../../src/browser.ts", import.meta.url);
    expect(existsSync(url), "E26 must supply browser.ts with connect({ url, attempts? })").toBe(true);
    vi.stubGlobal("WebSocket", WebSocket);
    const module = await import(/* @vite-ignore */ url.href) as { connect: (options: { url: string; attempts: number }) => Effect.Effect<TestClient, unknown, Scope.Scope> };
    expect(module.connect, "browser public connect").toBeTypeOf("function");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("TCP fixture has no address");
    return module.connect({ url: `ws://127.0.0.1:${address.port}/api`, attempts: 3 });
  };
  return { connect, connections, requests, acks, interrupted, headers };
};

export const known = (sequence: number) => ({
  sequence, eventId: `event-${sequence}`, occurredAt: 1_800_000_000_000 + sequence,
  caller: { _tag: "owner" }, agentId: "agent-a",
  event: { _tag: "TurnEnded", agentId: "agent-a", compact: false },
});
