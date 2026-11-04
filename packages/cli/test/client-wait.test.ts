import { afterEach, expect, it } from "vitest";
import { snapshot, agentRow, question } from "../../client/test/support/unit3.ts";
import { cleanupUnit7b, prepareRoot, fakeEngine, startCli, finishCli, succeed, chunk, until } from "../../testing/test/support/unit7b.ts";
import { serviceEnvironment } from "../../engine/test/support/serviceProcess.ts";
afterEach(cleanupUnit7b);

for (const [tags, code] of [
  [["idle"], 0], [["crashed"], 1], [["stopped"], 1], [["paused"], 2], [["interrupted"], 2],
  [["paused", "stopped"], 1], [["stopped", "paused"], 1], [["idle", "paused"], 2],
] as const) {
  it(`3.6 client wait --block ${tags.join("+")} exits ${code} using the engine's precedence`, async () => {
    const root = prepareRoot();
    const agents = tags.map((tag, i) => agentRow(`member-${i}`, tag, false));
    const initial = snapshot({ agents });
    const server = await fakeEngine(root, { onRequest: (frame, socket) => {
      if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initial });
      else if (frame.tag === "client.sequence") succeed(socket, frame, { requestId: frame.payload.requestId, sequence: initial.sequence });
    } });
    const cli = startCli(root, ["client", "wait", "--block", "--mode", "all", ...agents.map((row) => row.agentId)], serviceEnvironment(root));
    expect(await finishCli(cli)).toEqual({ code, signal: null });
    expect(server.requests.some((frame) => frame.tag === "client.snapshot"), "client wait must invoke its helper, not just print usage").toBe(true);
    expect(server.requests.some((frame) => frame.tag === "wait"), "the owner's helper does not open an agents-only engine wait").toBe(false);
  });
}
it("3.6 client wait exits 2 promptly on a working member's owner-held question after passing the gate", async () => {
  const root = prepareRoot(); const initial = snapshot({ agents: [agentRow("agent-a", "working")] });
  let gate: { frame: any; socket: any } | undefined;
  await fakeEngine(root, { onRequest: (frame, socket) => {
    if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...initial });
    if (frame.tag === "subscribe") chunk(socket, frame, [question(11)]);
    if (frame.tag === "client.sequence") gate = { frame, socket };
  } });
  const cli = startCli(root, ["client", "wait", "--block", "--mode", "all", "agent-a"], serviceEnvironment(root));
  await until("client wait gate", () => gate || cli.exited());
  expect(cli.exited(), cli.stderr()).toBe(false); expect(gate).toBeDefined();
  succeed(gate!.socket, gate!.frame, { requestId: gate!.frame.payload.requestId, sequence: 11 });
  expect(await finishCli(cli)).toEqual({ code: 2, signal: null });
  expect(cli.stdout() + cli.stderr()).toMatch(/request.held|holding|question/i);
});
