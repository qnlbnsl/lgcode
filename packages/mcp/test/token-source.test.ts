import { afterEach, expect, it } from "vitest";
import {
  assertNoSecrets, bounded, cleanupUnit7b, fakeEngine, mcpPeer, prepareRoot, startCli, token,
} from "../../testing/test/support/unit7b.ts";

afterEach(cleanupUnit7b);

it("T01 (7.8) catches omitting the environment token, putting it in RPC payloads/arguments/output, or using the owner token", async () => {
  const root = prepareRoot();
  const engine = await fakeEngine(root);
  const child = startCli(root, ["mcp"]);
  const peer = mcpPeer(child);
  await peer.initialize();
  assertNoSecrets(child, [token]); // inspect /proc while the child is alive
  const reply = await peer.request("tools/call", { name: "ask", arguments: { text: "Use agent identity." } });
  expect(reply.error).toBeUndefined();
  expect(reply.result.isError ?? false).toBe(false);
  expect(engine.upgrades.length).toBe(1);
  expect(engine.upgrades[0]!.authorization === `Bearer ${token}`).toBe(true);
  expect(JSON.stringify(engine.requests).includes(token), "token in a wire request body").toBe(false);
  assertNoSecrets(child, [token]);
});

for (const [label, args] of [
  ["token option", ["--token", "shp_a_argument_must_never_be_sent"]],
  ["positional argument", ["shp_a_positional_must_never_be_sent"]],
] as const) {
  it(`T02 ${label} (7.8) catches an argument overriding the environment token or reaching an engine upgrade`, async () => {
    const root = prepareRoot();
    const engine = await fakeEngine(root);
    const child = startCli(root, ["mcp", ...args]);
    const peer = mcpPeer(child);
    // A refused argument exits non-zero; an ignored argument still answers a
    // real tool call using ONLY the environment token. Both satisfy row 55.
    const result = await bounded("MCP argument rejection or initialize", Promise.race([
      child.exit.then((exit) => ({ kind: "exit" as const, exit })),
      peer.initialize().then(() => ({ kind: "ready" as const })).catch(async (error: unknown) => {
        if (child.exited()) return { kind: "exit" as const, exit: await child.exit };
        throw error;
      }),
    ]));
    if (result.kind === "exit") {
      expect(result.exit.code).not.toBe(0);
      expect(engine.upgrades).toHaveLength(0);
    } else {
      const reply = await peer.request("tools/call", { name: "ask", arguments: { text: "Check token source." } });
      expect(reply.error).toBeUndefined();
      expect(reply.result.isError ?? false).toBe(false);
      expect(engine.upgrades.length).toBe(1);
      expect(engine.upgrades[0]!.authorization === `Bearer ${token}`).toBe(true);
    }
    for (const argument of args.filter((arg) => arg.startsWith("shp_a_"))) {
      expect(JSON.stringify(engine.upgrades).includes(argument), "argument credential sent to engine").toBe(false);
      expect(child.stdout().includes(argument) || child.stderr().includes(argument), "argument credential echoed").toBe(false);
    }
    // The deliberately supplied hostile argument is naturally in this test's
    // own child argv. The valid environment credential must never be there.
    assertNoSecrets(child, [token]);
  });
}
