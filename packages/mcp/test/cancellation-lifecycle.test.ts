import { afterEach, expect, it } from "vitest";
import { cleanupUnit7b, mcpPeer, prepareRoot, startCli, succeed, until } from "../../testing/test/support/unit7b.ts";
import { closeRecoveryPeers, recoveryPeer } from "../../client/test/support/recoveryPeer.ts";
import { startServerHost, stopServerHosts } from "./support/serverProcess.ts";

afterEach(async () => { await stopServerHosts(); await closeRecoveryPeers(); await cleanupUnit7b(); });

it("X21 (T-2) catches an MCP cancellation leaving its engine RPC pending outside the tool handler's fiber", async () => {
  const root = prepareRoot();
  const engine = await recoveryPeer(root, (frame, socket) => {
    if (frame.tag !== "wait") succeed(socket, frame, { requestId: frame.payload.requestId, questionId: "still-usable" });
  });
  const child = startCli(root, ["mcp"]);
  const peer = mcpPeer(child);
  await peer.initialize();
  child.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 900, method: "tools/call", params: {
    name: "wait", arguments: { members: ["member"], mode: "all", block: true },
  } })}\n`);
  await until("the MCP tool's blocking wait to reach the engine", () => engine.requests.length === 1);
  const pending = engine.requests[0]!;
  expect(pending.frame.tag).toBe("wait");
  child.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 900, reason: "test caller cancelled" } })}\n`);
  const ended = await until("the cancelled MCP tool's RPC interrupt or connection end", () =>
    engine.interrupts.some((interrupt) => interrupt.connection === pending.connection && interrupt.requestId === pending.frame.id) || engine.closed.includes(pending.connection),
  2_000).then(() => true, () => false);
  expect(ended, "notifications/cancelled must reach the held engine RPC before the MCP process or layer stops").toBe(true);
  expect(child.exited()).toBe(false);
  const reply = await peer.request("tools/call", { name: "ask", arguments: { text: "Can another tool still run?" } });
  expect(reply.error).toBeUndefined();
  expect(reply.result.isError ?? false).toBe(false);
  expect(JSON.stringify(reply.result)).toContain("still-usable");
});

it("X22 (T-2) catches server-layer shutdown leaking the lazy client's connection until the whole process exits", async () => {
  const root = prepareRoot();
  const engine = await recoveryPeer(root, (frame, socket) => succeed(socket, frame, {
    requestId: frame.payload.requestId, questionId: "opened-before-shutdown",
  }));
  const host = startServerHost(root);
  const peer = mcpPeer(host);
  await peer.initialize();
  await peer.request("tools/list");
  expect(engine.upgrades).toHaveLength(0);
  const reply = await peer.request("tools/call", { name: "ask", arguments: { text: "Open the lazy connection." } });
  expect(reply.result.isError ?? false).toBe(false);
  expect(engine.connections).toHaveLength(1);
  host.child.stdin.end();
  const stopped = await until("runMcp to return after closing its server layer", () => host.stdout().includes('"testHost":"server-layer-stopped"'), 3_000).then(() => true, () => false);
  expect(stopped, "runMcp must return after stdin closes before we inspect its released resources").toBe(true);
  const closed = await until("the server layer's client connection to close", () => engine.closed.includes(1), 2_000).then(() => true, () => false);
  expect(host.exited(), "the host must stay alive so process exit cannot close a leaked socket for us").toBe(false);
  expect(closed, "closing the server layer must close the lazy client scope").toBe(true);
});
