import { join } from "node:path";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { envelope } from "../../client/test/support/unit3.ts";
import { cleanupUnit7b, prepareRoot, fakeEngine, startCli, finishCli, succeed, mcpPeer } from "../../testing/test/support/unit7b.ts";
import { serviceEnvironment } from "../../engine/test/support/serviceProcess.ts";
import { parseArguments, UsageError } from "../src/commands/parse.ts";
afterEach(cleanupUnit7b);

const invalidExportArguments = [
  { name: "JSON only", args: ["--input", '{"agentId":"agent-a"}'] },
  { name: "JSON with an output flag", args: ["--input", '{"agentId":"agent-a"}', "--out", "thread.txt"] },
  { name: "JSON with all positional options", args: ["agent-a", "--out", "thread.txt", "--input", '{"agentId":"agent-a"}'] },
  { name: "JSON carrying a local output path", args: ["--input", '{"agentId":"agent-a","out":"thread.txt"}'] },
  { name: "missing output flag", args: ["agent-a"] },
  { name: "missing output value", args: ["agent-a", "--out"] },
  { name: "empty output value", args: ["agent-a", "--out", ""] },
  { name: "empty inline output value", args: ["agent-a", "--out="] },
  { name: "blank output value", args: ["agent-a", "--out", "   "] },
  { name: "missing agent", args: ["--out", "thread.txt"] },
];

it.each(invalidExportArguments)("FR-037 rejects $name as an export usage error", ({ args }) => {
  expect(() => parseArguments("thread.export", args)).toThrow(UsageError);
});

it.each(invalidExportArguments)("FR-037 $name exits with usage status before any connection, RPC or file write", async ({ args }) => {
  const root = prepareRoot();
  const out = join(root.work, "thread.txt");
  writeFileSync(out, "Keep the existing export.");
  const localArgs = args.map((arg) => arg === "thread.txt" ? out : arg);
  const server = await fakeEngine(root, { onRequest: (frame, socket) => succeed(socket, frame, { requestId: frame.payload.requestId, items: [] }) });
  const child = startCli(root, ["thread", "export", ...localArgs], serviceEnvironment(root));
  expect(await finishCli(child)).toEqual({ code: 2, signal: null });
  expect(child.stderr()).toMatch(/thread export|--out/);
  expect(child.stdout()).toBe("");
  expect(server.upgrades).toHaveLength(0);
  expect(server.requests).toHaveLength(0);
  expect(readFileSync(out, "utf8")).toBe("Keep the existing export.");
});

it("FR-037 keeps the positional output path local, including spaces and inline flag syntax", () => {
  expect(parseArguments("thread.export", ["agent-a", "--out=local thread.txt"]))
    .toEqual({ help: false, block: false, out: "local thread.txt", payload: { agentId: "agent-a" } });
});

it("3.7 thread export follows page cursors, writes the caller's file with mode 0600, and sends no output path to the service", async () => {
  const root = prepareRoot(); const out = join(root.work, "caller-thread.txt");
  // An existing permissive file must not retain its former permissions.
  writeFileSync(out, "Old export.", { mode: 0o666 });
  const first = envelope(11, { _tag: "ThreadItem", agentId: "agent-a", itemId: "first", content: { _tag: "text", text: "First unique fixture." }, replay: false });
  const second = envelope(19, { _tag: "ThreadItem", agentId: "agent-a", itemId: "second", content: { _tag: "text", text: "Second unique fixture." }, replay: false });
  const server = await fakeEngine(root, { onRequest: (frame, socket) => {
    if (frame.tag === "client.thread") succeed(socket, frame, { requestId: frame.payload.requestId, items: frame.payload.after === 0 ? [first] : [second], ...(frame.payload.after === 0 ? { next: 11 } : {}) });
  } });
  const cli = startCli(root, ["thread", "export", "agent-a", "--out", out], serviceEnvironment(root));
  expect(await finishCli(cli)).toEqual({ code: 0, signal: null });
  const file = readFileSync(out, "utf8");
  expect(file).not.toContain("Old export.");
  expect(file.indexOf("First unique fixture.")).toBeGreaterThanOrEqual(0);
  expect(file.indexOf("Second unique fixture.")).toBeGreaterThan(file.indexOf("First unique fixture."));
  expect(statSync(out).mode & 0o777).toBe(0o600);
  expect(server.requests.map((frame) => [frame.tag, frame.payload.after])).toEqual([["client.thread", 0], ["client.thread", 11]]);
  expect(JSON.stringify(server.requests)).not.toContain(out);
});
it.each(["cli", "mcp"] as const)("3.3 %s preserves the server's agent data envelope unchanged", async (consumer) => {
  const root = prepareRoot();
  const data = 'Data from another agent [fixture-marker] (delivery read):\n{"requestId":"fixture","items":[]}\nEnd data [fixture-marker]';
  const server = await fakeEngine(root, { onRequest: (frame, socket) => succeed(socket, frame, { requestId: frame.payload.requestId, data }) });
  if (consumer === "cli") {
    const cli = startCli(root, ["client", "thread", "--input", JSON.stringify({ agentId: "agent-a", after: 0, limit: 500 })]);
    expect(await finishCli(cli)).toEqual({ code: 0, signal: null });
    expect(cli.stdout()).toBe(`${data}\n`);
  } else {
    const cli = startCli(root, ["mcp"]); const peer = mcpPeer(cli);
    await peer.initialize();
    const reply = await peer.request("tools/call", { name: "client.thread", arguments: { agentId: "agent-a", after: 0, limit: 500 } });
    expect(reply.error).toBeUndefined();
    expect(reply.result?.content).toEqual([{ type: "text", text: data }]);
    cli.child.stdin.end(); await finishCli(cli);
  }
  expect(server.requests.map((frame) => frame.tag)).toEqual(["client.thread"]);
});
