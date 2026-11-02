import { afterEach, expect, it } from "vitest";
import { cleanupUnit7b, mcpPeer, prepareRoot, startCli, succeed, until } from "../../testing/test/support/unit7b.ts";
import { closeRecoveryPeers, recoveryPeer } from "../../client/test/support/recoveryPeer.ts";
import { startServerHost, stopServerHosts } from "./support/serverProcess.ts";

afterEach(async () => { await stopServerHosts(); await closeRecoveryPeers(); await cleanupUnit7b(); });
const ask = (text: string) => ({ name: "ask", arguments: { text } });

it("X41 (T-4) catches applying the MCP 503 recovery window only to the initial connection, then losing a later tool call", async () => {
  const root = prepareRoot();
  const engine = await recoveryPeer(root, (frame, socket) => succeed(socket, frame, {
    requestId: frame.payload.requestId, questionId: frame.payload.text,
  }));
  const child = startCli(root, ["mcp"]);
  const peer = mcpPeer(child);
  await peer.initialize();
  const first = await peer.request("tools/call", ask("warmup"));
  expect(first.result.isError ?? false).toBe(false);
  const recoveryEnds = Date.now() + 3_000;
  engine.setUpgradeStatus(() => Date.now() < recoveryEnds ? 503 : 101);
  engine.connections[0]!.close(1012, "engine recovering after an established session");
  await until("the established MCP connection to close", () => engine.closed.includes(1));
  const reply = await peer.request("tools/call", ask("after-recovery"), 15_000);
  expect.soft(reply.error).toBeUndefined();
  expect.soft(reply.result.isError ?? false, "the second tool call must survive the three-second recovery window").toBe(false);
  expect.soft(JSON.stringify(reply.result)).toContain("after-recovery");
  const calls = engine.requests.filter(({ frame }) => frame.payload.text === "after-recovery");
  expect.soft(calls, "the command must reach the recovered engine exactly once").toHaveLength(1);
  if (calls.length === 1) {
    expect(calls[0]!.connection).toBe(2);
    expect(typeof calls[0]!.frame.payload.requestId).toBe("string");
    expect(calls[0]!.frame.payload.requestId.length).toBeGreaterThan(0);
  }
  expect(engine.upgrades.some((upgrade) => upgrade.status === 503 && upgrade.at < recoveryEnds)).toBe(true);
  expect.soft(engine.upgrades.some((upgrade) => upgrade.status === 101 && upgrade.at >= recoveryEnds)).toBe(true);
});

it("X42 (T-4 control) catches retrying a reconnect's HTTP 401 as recovery instead of refusing the tool call promptly", async () => {
  const root = prepareRoot();
  const engine = await recoveryPeer(root, (frame, socket) => succeed(socket, frame, {
    requestId: frame.payload.requestId, questionId: "warmup",
  }));
  const child = startCli(root, ["mcp"]);
  const peer = mcpPeer(child);
  await peer.initialize();
  expect((await peer.request("tools/call", ask("warmup"))).result.isError ?? false).toBe(false);
  engine.setUpgradeStatus(() => 401);
  engine.connections[0]!.close(1012, "new engine refuses the old identity");
  await until("the previous authenticated connection to close", () => engine.closed.includes(1));
  const started = Date.now();
  const reply = await peer.request("tools/call", ask("must-not-be-sent"), 2_000);
  expect(Date.now() - started, "authentication must not consume the recovery deadline").toBeLessThan(1_500);
  expect(reply.error !== undefined || reply.result?.isError === true).toBe(true);
  expect(JSON.stringify(reply)).toMatch(/401|identity|refused|unauthoriz/i);
  expect(engine.requests).toHaveLength(1);
  expect(engine.upgrades.slice(1).every((upgrade) => upgrade.status === 401)).toBe(true);
});

it("X43 (T-4 control) catches omitting the explicit 60-second recovery deadline on a tool call after an earlier success", async () => {
  const root = prepareRoot();
  const engine = await recoveryPeer(root, (frame, socket) => succeed(socket, frame, {
    requestId: frame.payload.requestId, questionId: "warmup",
  }));
  // Uses the exported production retry clock. Network I/O and the tool/server
  // stay real; only the recovery backoff's clock advances without wall time.
  const host = startServerHost(root, true);
  const peer = mcpPeer(host);
  await peer.initialize();
  expect((await peer.request("tools/call", ask("warmup"))).result.isError ?? false).toBe(false);
  engine.setUpgradeStatus(() => 503);
  engine.connections[0]!.close(1012, "recovery never finishes");
  await until("the established connection to close before deadline testing", () => engine.closed.includes(1));
  const reply = await peer.request("tools/call", ask("deadline"), 15_000);
  expect(reply.error !== undefined || reply.result?.isError === true).toBe(true);
  expect.soft(JSON.stringify(reply), "the caller needs an explicit recovery deadline error, not a generic HTTP 503").toMatch(/recovering after 60 seconds|60.second.*deadline|deadline.*60.second/i);
  const clock = host.stderr().split("\n").filter((line) => line.startsWith('{"testRecoveryClock":')).map((line) => JSON.parse(line) as { testRecoveryClock: number; slept: number });
  expect.soft(clock.at(-1)?.testRecoveryClock, "the production recovery clock must reach exactly the 60-second bound").toBe(60_000);
  expect.soft(clock.every((tick) => tick.testRecoveryClock <= 60_000 && tick.slept > 0)).toBe(true);
  expect(engine.requests).toHaveLength(1);
});

it("X44 (T-4 receipt control) catches recreating a tool's request id after a committed reply is lost during recovery and executing the command twice", async () => {
  const root = prepareRoot();
  const receipts = new Map<string, { requestId: string; questionId: string }>();
  let commits = 0;
  let recoveryEnds = 0;
  const engine = await recoveryPeer(root, (frame, socket) => {
    if (frame.payload.text === "warmup") {
      succeed(socket, frame, { requestId: frame.payload.requestId, questionId: "warmup" });
      return;
    }
    const requestId = frame.payload.requestId as string;
    const stored = receipts.get(requestId);
    if (stored !== undefined) { succeed(socket, frame, stored); return; }
    commits++;
    receipts.set(requestId, { requestId, questionId: `committed-question-${commits}` });
    if (commits === 1) {
      recoveryEnds = Date.now() + 3_000;
      // The first execution committed, but its reply never reached the client.
      socket.close(1012, "committed reply lost during restart");
    } else succeed(socket, frame, receipts.get(requestId));
  });
  engine.setUpgradeStatus(() => Date.now() < recoveryEnds ? 503 : 101);
  const child = startCli(root, ["mcp"]);
  const peer = mcpPeer(child);
  await peer.initialize();
  expect((await peer.request("tools/call", ask("warmup"))).result.isError ?? false).toBe(false);
  const reply = await peer.request("tools/call", ask("commit-once"), 15_000);
  expect.soft(reply.result.isError ?? false, "the recovery retry must eventually return the stored receipt").toBe(false);
  expect.soft(JSON.stringify(reply.result)).toContain("committed-question-1");
  expect.soft(commits, "a retried tool must not acquire a fresh id and execute twice").toBe(1);
  const calls = engine.requests.filter(({ frame }) => frame.payload.text === "commit-once");
  expect.soft(calls).toHaveLength(2);
  if (calls.length === 2) {
    expect(calls[0]!.connection).toBe(1);
    expect(calls[1]!.connection).toBe(2);
    expect(calls[1]!.frame.payload).toEqual(calls[0]!.frame.payload);
    expect(calls[1]!.frame.payload.requestId).toBe([...receipts.keys()][0]);
  }
});

it("X45 (T-4 blocking-wait control) catches reusing an opened wait receipt across the MCP recovery retry instead of waiting for a final outcome", async () => {
  const root = prepareRoot();
  let firstWaitId: string | undefined;
  let recoveryEnds = 0;
  const engine = await recoveryPeer(root, (frame, socket) => {
    if (frame.tag === "ask") {
      succeed(socket, frame, { requestId: frame.payload.requestId, questionId: "warmup" });
      return;
    }
    if (firstWaitId === undefined) {
      firstWaitId = frame.payload.requestId;
      recoveryEnds = Date.now() + 3_000;
      socket.close(1012, "blocking wait opened before restart");
      return;
    }
    const stale = frame.payload.requestId === firstWaitId;
    succeed(socket, frame, {
      requestId: frame.payload.requestId, waitId: stale ? "old-wait" : "new-wait",
      outcome: stale ? "opened" : "satisfied", members: stale ? [] : [{ agentId: "member", reason: "settled" }],
    });
  });
  engine.setUpgradeStatus(() => Date.now() < recoveryEnds ? 503 : 101);
  const child = startCli(root, ["mcp"]);
  const peer = mcpPeer(child);
  await peer.initialize();
  expect((await peer.request("tools/call", ask("warmup"))).result.isError ?? false).toBe(false);
  const reply = await peer.request("tools/call", { name: "wait", arguments: { members: ["member"], mode: "all", block: true } }, 15_000);
  expect.soft(reply.result.isError ?? false).toBe(false);
  const result = reply.result.structuredContent ?? JSON.parse(reply.result.content[0].text.startsWith("{") ? reply.result.content[0].text : "null");
  expect.soft(result).toMatchObject({ outcome: "satisfied", members: [{ agentId: "member", reason: "settled" }] });
  const waits = engine.requests.filter(({ frame }) => frame.tag === "wait");
  expect.soft(waits).toHaveLength(2);
  if (waits.length === 2) {
    expect(waits[1]!.frame.payload.requestId).not.toBe(firstWaitId);
    expect(waits[1]!.frame.payload).toMatchObject({ members: ["member"], mode: "all", block: true });
  }
});
