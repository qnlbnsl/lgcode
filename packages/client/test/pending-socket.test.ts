import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

const constructorUrl = new URL("../src/nodeSocket.ts", import.meta.url).href;

it.each(["cancel", "timeout", "refuse", "opened"] as const)("Node socket cleanup handles %s without an uncaught error", (mode) => {
  const source = String.raw`
    import { createServer } from "node:http";
    import { createRequire } from "node:module";
    import * as NodeSocket from "@effect/platform-node/NodeSocket";
    import * as Effect from "effect/Effect";
    import * as Fiber from "effect/Fiber";
    import { makeNodeSocket } from ${JSON.stringify(constructorUrl)};
    const { WebSocketServer } = createRequire(${JSON.stringify(constructorUrl)})("ws");
    const mode = ${JSON.stringify(mode)};
    const peers = new Set();
    const server = createServer();
    const upgrades = new WebSocketServer({ noServer: true });
    let reached;
    const pending = new Promise((resolve) => { reached = resolve; });
    let opened;
    const ready = new Promise((resolve) => { opened = resolve; });
    server.on("connection", (peer) => { peers.add(peer); peer.once("close", () => peers.delete(peer)); });
    server.on("upgrade", (request, peer, head) => {
      if (mode === "refuse") peer.end("HTTP/1.1 503 Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      else if (mode === "opened") upgrades.handleUpgrade(request, peer, head, () => {});
      reached();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const socket = await Effect.runPromise(makeNodeSocket("ws://127.0.0.1:" + address.port, { openTimeout: 1_000 }).pipe(Effect.provide(NodeSocket.layerWebSocketConstructorWS)));
    const fiber = Effect.runFork(Effect.scoped(socket.reader.pipe(Effect.tap(() => Effect.sync(opened)), Effect.andThen(Effect.never))));
    await pending;
    if (mode === "opened") await ready;
    if (mode === "cancel" || mode === "opened") await Effect.runPromise(Fiber.interrupt(fiber));
    const exit = await Effect.runPromise(Fiber.await(fiber));
    const failures = exit._tag === "Failure" ? exit.cause.reasons : [];
    const failure = failures.find((entry) => entry._tag === "Fail")?.error;
    const result = { interrupted: failures.some((entry) => entry._tag === "Interrupt"), reason: failure?.reason?._tag, kind: failure?.reason?.kind };
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (const peer of peers) peer.destroy();
    upgrades.close();
    await new Promise((resolve) => server.close(resolve));
    process.stdout.write(JSON.stringify(result));
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: new URL("..", constructorUrl), encoding: "utf8", timeout: 10_000,
  });
  expect(child.error).toBeUndefined();
  expect(child.signal).toBeNull();
  expect(child.stderr).toBe("");
  expect(child.status).toBe(0);
  const result = JSON.parse(child.stdout);
  if (mode === "cancel" || mode === "opened") expect(result).toEqual({ interrupted: true });
  else expect(result).toEqual({ interrupted: false, reason: "SocketOpenError", kind: mode === "timeout" ? "Timeout" : "Unknown" });
});
