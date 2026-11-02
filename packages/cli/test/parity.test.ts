import { CommandsRpcGroup, ownerOnlyCommands } from "@shephrd/contracts";
import { afterEach, expect, it } from "vitest";
import {
  agentEnvironment, assertNoSecrets, chunk, cleanupUnit7b, fakeEngine, finishCli, mcpPeer, prepareRoot, serviceEnvironment, startCli, succeed, token,
} from "../../testing/test/support/unit7b.ts";

afterEach(cleanupUnit7b);

// Inventory comes from the RPC group, never from a second CLI-maintained list.
for (const command of CommandsRpcGroup.requests.keys()) {
  it(`P01 ${command} (7.5) catches omitting this RPC's shephrd subcommand/help registration`, async () => {
    const child = startCli(prepareRoot(), [...command.split(" "), "--help"]);
    expect(await finishCli(child)).toEqual({ code: 0, signal: null });
    expect(child.stdout()).toMatch(/usage|options|arguments/i);
    expect(child.stdout()).toContain(command);
    expect(child.stdout()).not.toContain("not built yet");
    assertNoSecrets(child, [token]);
  });
}

// Full payload parity has a compact escape hatch: every non-secret RPC accepts
// --input JSON. Friendly wait/subscribe flags are separately exercised.
for (const command of CommandsRpcGroup.requests.keys()) {
  if (command === "accounts set-secret") continue; // S01 checks its stdin-only dispatch.
  it(`P03 ${command} catches a registered CLI command dispatching the wrong RPC or dropping payload fields`, async () => {
    const root = prepareRoot();
    const payloads: Record<string, Record<string, unknown>> = {
      start: { name: "Parity agent", role: "worker", harness: "fake", account: { _tag: "any" }, permission: "ask", folder: root.work, groups: ["review"], model: "small", effort: "low", prompt: "Check parity." },
      prompt: { agentId: "member", text: "A prompt with spaces." },
      answer: { kind: "question", id: "question", text: "The answer." },
      "pass-up": { subject: { _tag: "question", id: "question" } },
      ask: { text: "A question?" },
      wait: { members: ["member"], mode: "all", block: false },
      stop: { agentId: "member" }, resume: { agentId: "member", fresh: true }, compact: { agentId: "member" },
      group: { agentId: "member", add: ["review"], remove: ["build"] },
      accounts: { operation: "list" }, "accounts mark-available": { accountId: "account" },
      harnesses: { operation: "list" }, subscribe: { after: 100 }, "debug.compare-views": {},
    };
    expect(payloads[command], "new RPC needs a command dispatch fixture").toBeDefined();
    const payload = { requestId: `parity-${command}`, ...payloads[command] };
    const engine = await fakeEngine(root, { onRequest: (frame, socket) => {
      const base = { requestId: frame.payload.requestId };
      const replies: Record<string, unknown> = {
        start: { ...base, agentId: "member" }, prompt: { ...base, deliveryId: "delivery" },
        compact: { ...base, deliveryId: "delivery" }, ask: { ...base, questionId: "question" },
        wait: { ...base, waitId: "wait", members: [{ agentId: "member", reason: "settled" }], outcome: "satisfied" },
        accounts: { ...base, accounts: [] }, harnesses: { ...base, harnesses: [] },
        "debug.compare-views": { ...base, sequence: 100, equal: true, differences: [] },
      };
      if (frame.tag === "subscribe") {
        chunk(socket, frame, [{ sequence: 101, eventId: "parity-event", occurredAt: 1_800_000_000_000,
          caller: { _tag: "agent", agentId: "member" }, agentId: "member", event: { _tag: "TurnEnded", agentId: "member", compact: false } }]);
        succeed(socket, frame, undefined);
      } else succeed(socket, frame, replies[frame.tag] ?? base);
    } });
    const environment = (ownerOnlyCommands as ReadonlyArray<string>).includes(command) ? serviceEnvironment(root) : agentEnvironment(root);
    const child = startCli(root, [...command.split(" "), "--input", JSON.stringify(payload)], environment);
    expect(await finishCli(child)).toEqual({ code: 0, signal: null });
    expect(engine.requests).toHaveLength(1);
    expect(engine.requests[0]).toMatchObject({ _tag: "Request", tag: command, payload });
    assertNoSecrets(child, [token]);
  });
}

it("P02 (7.5) catches MCP omitting an agent command, adding an unreviewed/owner/stream/secret tool, or listing duplicates", async () => {
  const root = prepareRoot();
  await fakeEngine(root);
  const child = startCli(root, ["mcp"]);
  const peer = mcpPeer(child);
  await peer.initialize();
  const reply = await peer.request("tools/list");
  expect(reply.error).toBeUndefined();
  const names = (reply.result.tools as Array<{ name: string }>).map((tool) => tool.name);
  // Row 55's explicit allow-list is intentional: adding a new agent command
  // needs review, and the CLI inventory above independently catches additions.
  expect([...names].sort()).toEqual([
    "answer", "ask", "compact", "group", "pass-up", "prompt", "resume", "start", "stop", "wait",
  ]);
  expect(new Set(names).size).toBe(names.length);
  for (const excluded of ["subscribe", "accounts set-secret", "accounts mark-available", "debug.compare-views", ...ownerOnlyCommands]) {
    expect(names).not.toContain(excluded);
  }
  assertNoSecrets(child, [token]);
});
