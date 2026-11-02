import { afterEach, expect, it } from "vitest";
import {
  assertNoSecrets, cleanupUnit7b, fakeEngine, mcpPeer, prepareRoot, startCli, token,
} from "../../testing/test/support/unit7b.ts";

afterEach(cleanupUnit7b);

it("L01 (7.8) catches opening the engine socket at startup/initialize/tools-list instead of on the first tool call", async () => {
  const root = prepareRoot();
  const engine = await fakeEngine(root);
  const child = startCli(root, ["mcp"]);
  const peer = mcpPeer(child);
  await peer.initialize();
  const listed = await peer.request("tools/list");
  expect(listed.error).toBeUndefined();
  expect(listed.result.tools.length).toBeGreaterThan(0);
  expect(engine.upgrades).toHaveLength(0);
  const reply = await peer.request("tools/call", { name: "ask", arguments: { text: "Which task is next?" } });
  expect(reply.error).toBeUndefined();
  expect(reply.result.isError ?? false).toBe(false);
  expect(JSON.stringify(reply.result)).toContain("question-7b");
  expect(engine.upgrades).toHaveLength(1);
  expect(engine.requests).toHaveLength(1);
  expect(engine.requests[0]).toMatchObject({ _tag: "Request", tag: "ask", payload: { text: "Which task is next?" } });
  expect(typeof engine.requests[0]!.payload.requestId).toBe("string");
  assertNoSecrets(child, [token]);
});

it("L02 (7.8) catches treating HTTP 503 recovering as permanent failure or consuming the tool call before recovery opens", async () => {
  const root = prepareRoot();
  const engine = await fakeEngine(root, { recovering: 3 });
  const child = startCli(root, ["mcp"]);
  const peer = mcpPeer(child);
  await peer.initialize();
  const reply = await peer.request("tools/call", { name: "ask", arguments: { text: "Recovery finished?" } }, 30_000);
  expect(reply.error).toBeUndefined();
  expect(reply.result.isError ?? false).toBe(false);
  expect(JSON.stringify(reply.result)).toContain("question-7b");
  expect(engine.upgrades).toHaveLength(4);
  expect(engine.upgrades.every((headers) => headers.authorization === `Bearer ${token}`)).toBe(true);
  expect(engine.requests).toHaveLength(1);
  expect(engine.requests[0]!.tag).toBe("ask");
  assertNoSecrets(child, [token]);
});

// One small clock seam keeps the exact production deadline test under a
// second. L02 independently proves the real stdio child uses recovery retries.
const loadRetry = async () => {
  const module = await import("@shepherd/mcp") as unknown as {
    retryRecovering: <A>(attempt: () => Promise<A>, clock: {
      now: () => number; sleep: (milliseconds: number) => Promise<void>;
    }) => Promise<A>;
  };
  expect(typeof module.retryRecovering, "export the recovery retry used by the MCP connector with an injectable clock").toBe("function");
  return module.retryRecovering;
};

it("L03 (7.8) catches retrying beyond 60 seconds or giving up before the production recovery deadline", async () => {
  const retry = await loadRetry();
  let now = 0;
  const attempts: Array<number> = [];
  const result = retry(async () => {
    attempts.push(now);
    if (attempts.length > 10_000) throw new Error("unbounded retry");
    throw Object.assign(new Error("recovering"), { status: 503 });
  }, {
    now: () => now,
    sleep: async (milliseconds) => {
      expect(milliseconds).toBeGreaterThan(0);
      now += milliseconds;
      expect(now, "retry slept past the 60-second deadline").toBeLessThanOrEqual(60_000);
    },
  });
  await expect(result).rejects.toThrow(/recover|60|deadline|timed out/i);
  expect(attempts.length).toBeGreaterThan(1);
  expect(now).toBe(60_000);
  expect(attempts.every((time) => time <= 60_000)).toBe(true);
});

it("L04 catches retrying an authentication refusal as if the service were recovering", async () => {
  const retry = await loadRetry();
  let calls = 0;
  const refusal = Object.assign(new Error("unauthorized"), { status: 401 });
  await expect(retry(async () => { calls++; throw refusal; }, {
    now: () => 0,
    sleep: async () => { throw new Error("must not retry authentication"); },
  })).rejects.toBe(refusal);
  expect(calls).toBe(1);
});
