import { CommandsRpcGroup, commandAccess, ownerOnlyCommands } from "@lgcode/contracts";
import { afterEach, expect, it } from "vitest";
import { action, roleFile, roleFileContent, roleFileHash } from "../../contracts/test/roles/fixtures.ts";
import {
  agentEnvironment, assertNoSecrets, chunk, cleanupUnit7b, fakeEngine, finishCli, mcpPeer, prepareRoot, serviceEnvironment, startCli, succeed, token,
} from "../../testing/test/support/unit7b.ts";

afterEach(cleanupUnit7b);

const commandWords = (command: string) => command === "debug.compare-views" ? [command] : command.replaceAll(".", " ").split(" ");
const invocations = [...CommandsRpcGroup.requests.keys()].flatMap((command) => [
  { command, words: commandWords(command), form: "spaced" },
  ...(command.includes(".") && command !== "debug.compare-views" ? [{ command, words: [command], form: "dotted" }] : []),
]);

// Inventory comes from the RPC group, never from a second CLI-maintained list.
for (const { command, words, form } of invocations) {
  it(`P01 ${command} ${form} (7.5) catches omitting this RPC's lgcode subcommand/help registration`, async () => {
    const child = startCli(prepareRoot(), [...words, "--help"]);
    expect(await finishCli(child)).toEqual({ code: 0, signal: null });
    expect(child.stdout()).toMatch(/usage|options|arguments/i);
    expect(child.stdout()).toContain(words.join(" "));
    expect(child.stdout()).not.toContain("not built yet");
    assertNoSecrets(child, [token]);
  });
}

// Full payload parity has a compact escape hatch: every non-secret RPC accepts
// --input JSON. Friendly wait/subscribe flags are separately exercised.
for (const { command, words, form } of invocations) {
  if (command === "accounts set-secret" || command === "client.alerts.carrier.set-token") continue; // Dedicated tests check stdin-only dispatch.
  it(`P03 ${command} ${form} catches a registered CLI command dispatching the wrong RPC or dropping payload fields`, async () => {
    const root = prepareRoot();
    const payloads: Record<string, Record<string, unknown>> = {
      "client.alerts.list": { after: 0, limit: 1, status: "open" },
      "client.alerts.dismiss": { alertId: "alert-1" },
      "client.alerts.settings": {},
      "client.alerts.settings.set": { kind: "approval", push: false },
      "client.alerts.carrier.set": { carrier: { _tag: "ntfy", server: "https://push.example", topic: "owner_alerts" } },
      "client.alerts.carrier.clear-token": {},
      start: { name: "Parity agent", role: "worker", harness: "fake", account: { _tag: "any" }, permission: "ask", folder: root.work, groups: ["review"], model: "small", effort: "low", prompt: "Check parity." },
      prompt: { agentId: "member", text: "A prompt with spaces." },
      answer: { kind: "question", id: "question", text: "The answer." },
      "pass-up": { subject: { _tag: "question", id: "question" } },
      ask: { text: "A question?" },
      wait: { members: ["member"], mode: "all", block: false },
      release: { agentId: "member" }, stop: { agentId: "member" }, resume: { agentId: "member", fresh: true }, compact: { agentId: "member" },
      group: { agentId: "member", add: ["review"], remove: ["build"] },
      accounts: { operation: "list" }, "accounts mark-available": { accountId: "account" },
      "client.web.settings": {},
      "client.web.settings.set": { settings: { enabled: true, port: 8787, heartbeatSeconds: 25, proxyMode: false } },
      harnesses: { operation: "list" }, subscribe: { after: 100 }, "debug.compare-views": {},
      "client.snapshot": {}, "client.roster": { group: "review", role: "worker", parent: "lead" },
      "client.thread": { agentId: "member", after: 100, limit: 500 },
      "client.event": { sequence: 101 }, "client.sequence": {},
      "client.subscribe": { after: 100, filter: { agents: ["member"], kinds: ["TurnEnded"] } },
      "board.open": { name: "Review", group: "review", anchorAgentId: "member" },
      "board.members": { channelId: "channel", add: ["member"], remove: ["former"] },
      "board.post": { channelId: "channel", text: "Which option?", to: [{ _tag: "agent", agentId: "member" }], reply: "all", replyTo: "earlier-post" },
      "board.close": { postId: "post" },
      "board.acknowledge": { postId: "post" },
      "board.read": { channelId: "channel", after: "cursor", limit: 20 },
      "board.channels": { after: "cursor", limit: 20 },
      "board.status": { agentId: "member" },
      "board.flush": { agentId: "member" },
      "roles.orient": {}, "roles.handoff": { agentId: "member" },
      "roles.role-file.set": { content: roleFileContent }, "roles.role-file.get": {},
      "roles.settings.get": {}, "roles.settings.set": { settings: { sheepdog: true, limits: { stallMinutes: 10 } } },
      "roles.snooze": { group: "review", until: 1_900_000_000_000 },
      "roles.actions.list": { agentId: "member", after: 100, limit: 20 },
      "roles.record": { action: { _tag: "roles.StallSeen", ...action, agentId: "member" } },
    };
    expect(payloads[command], "new RPC needs a command dispatch fixture").toBeDefined();
    const payload = { requestId: `parity-${command}`, ...payloads[command] };
    let expectedReply: unknown;
    const engine = await fakeEngine(root, { onRequest: (frame, socket) => {
      const base = { requestId: frame.payload.requestId };
      const replies: Record<string, unknown> = {
        "client.alerts.list": { ...base, items: [], next: 10 },
        "client.alerts.settings": { ...base, kinds: [{ kind: "approval", push: false }], carrier: { _tag: "none" }, tokenSet: false },
        start: { ...base, agentId: "member" }, prompt: { ...base, deliveryId: "delivery" },
        compact: { ...base, deliveryId: "delivery" }, ask: { ...base, questionId: "question" },
        wait: { ...base, waitId: "wait", members: [{ agentId: "member", reason: "settled" }], outcome: "satisfied" },
        accounts: { ...base, accounts: [] }, harnesses: { ...base, harnesses: [] },
        "client.web.settings": { ...base, enabled: true, port: 8787, heartbeatSeconds: 25, proxyMode: false, serverState: "running" },
        "debug.compare-views": { ...base, sequence: 100, equal: true, differences: [] },
        "client.snapshot": { ...base, sequence: 100, agents: [], requests: [], questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0 },
        "client.roster": { ...base, agents: [] }, "client.thread": { ...base, items: [] },
        "client.sequence": { ...base, sequence: 100 },
        "client.event": { ...base, envelope: { sequence: 101, eventId: "parity-event", occurredAt: 1_800_000_000_000, caller: { _tag: "owner" }, agentId: "member", event: { _tag: "TurnEnded", agentId: "member", compact: false } } },
        "board.open": { ...base, channelId: "channel" },
        "board.members": { ...base, memberCount: 1 },
        "board.post": { ...base, postId: "post" },
        "board.close": { ...base, postId: "post", outcome: "withdrawn" },
        "board.acknowledge": { ...base, postId: "post" },
        "board.read": { ...base, data: `Data from another agent [boundary] (delivery read):\n${JSON.stringify({ items: [{ text: '"\\\n\t🐑' }] })}\nEnd data [boundary]` },
        "board.channels": { ...base, items: [], next: "next-cursor" },
        "board.status": { ...base, agentId: "member", unread: 1, incomingOpen: 1, ownOpen: 0, owed: 0, failedCompletions: 0, wakeQueued: true, wakeSent: false, holdsUnsettled: false, holdsIncoming: true, sequence: 100, disabled: false },
        "board.flush": { ...base, wakeId: "wake" },
        "roles.orient": { ...base, name: "Member", kind: "worker", advice: "Report to your lead." },
        "roles.handoff": { ...base, agentId: "member", text: "Continue the assigned work." },
        "roles.role-file.set": { ...base, roleFileHash }, "roles.role-file.get": { ...base, file: roleFile, roleFileHash },
        "roles.settings.get": { ...base, settings: { sheepdog: true, limits: { stallMinutes: 10 } } },
        "roles.settings.set": base, "roles.snooze": base,
        "roles.actions.list": { ...base, items: [] },
        "roles.record": { ...base, sequence: 101 },
      };
      if (frame.tag === "subscribe" || frame.tag === "client.subscribe") {
        chunk(socket, frame, [{ sequence: 101, eventId: "parity-event", occurredAt: 1_800_000_000_000,
          caller: { _tag: "agent", agentId: "member" }, agentId: "member", event: { _tag: "TurnEnded", agentId: "member", compact: false } }]);
        succeed(socket, frame, undefined);
      } else {
        expectedReply = replies[frame.tag] ?? base;
        succeed(socket, frame, expectedReply);
      }
    } });
    const environment = (commandAccess[command as keyof typeof commandAccess] as ReadonlyArray<string>).includes("agent") ? agentEnvironment(root) : serviceEnvironment(root);
    const child = startCli(root, [...words, "--input", JSON.stringify(payload)], environment);
    expect(await finishCli(child)).toEqual({ code: 0, signal: null });
    expect(engine.requests).toHaveLength(1);
    expect(engine.requests[0]).toMatchObject({ _tag: "Request", tag: command, payload });
    if (command.startsWith("roles.")) expect(JSON.parse(child.stdout())).toEqual(expectedReply);
    if (command === "board.read") expect(child.stdout()).toBe((expectedReply as { data: string }).data + "\n");
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
  const tools = reply.result.tools as Array<{ name: string; description?: string }>;
  for (const tool of tools) {
    expect(tool.description, `${tool.name} must describe its purpose in tools/list`).toBeTypeOf("string");
    expect(tool.description!.trim().length, `${tool.name} purpose must be meaningful`).toBeGreaterThan(10);
  }
  expect(tools.find((tool) => tool.name === "release")?.description).toMatch(/release.*capacity hold/i);
  const names = tools.map((tool) => tool.name);
  // Row 55's explicit allow-list is intentional: adding a new agent command
  // needs review, and the CLI inventory above independently catches additions.
  expect([...names].sort()).toEqual([
    "answer", "ask", "board.acknowledge", "board.channels", "board.close", "board.members",
    "board.open", "board.post", "board.read", "board.status", "client.event", "client.roster", "client.snapshot", "client.thread", "compact", "group", "pass-up", "prompt", "release", "resume", "roles.handoff", "roles.orient", "start", "stop", "wait",
  ]);
  expect(new Set(names).size).toBe(names.length);
  const nonAgent = Object.entries(commandAccess).filter(([, kinds]) => !(kinds as ReadonlyArray<string>).includes("agent")).map(([name]) => name);
  for (const excluded of ["subscribe", "accounts set-secret", "accounts mark-available", "debug.compare-views", "board.flush", "client.alerts.list", "client.alerts.dismiss", "client.alerts.settings", "client.alerts.settings.set", ...ownerOnlyCommands, ...nonAgent]) {
    expect(names).not.toContain(excluded);
  }
  assertNoSecrets(child, [token]);
});

it("board.read MCP forwards the complete labelled data without changing its escapes or boundaries", async () => {
  const root = prepareRoot();
  const data = `Data from piece board [mcp-boundary]\n${JSON.stringify({ items: [{ text: '"\\\n\t🐑' }] })}\nEnd data [mcp-boundary]`;
  const engine = await fakeEngine(root, { onRequest: (frame, socket) => succeed(socket, frame, { requestId: frame.payload.requestId, data }) });
  const child = startCli(root, ["mcp"]);
  const peer = mcpPeer(child);
  await peer.initialize();
  const reply = await peer.request("tools/call", { name: "board.read", arguments: { channelId: "channel", limit: 20 } });
  expect(reply.error).toBeUndefined();
  expect(reply.result.isError ?? false).toBe(false);
  expect(reply.result.content).toEqual([{ type: "text", text: data }]);
  expect(engine.requests).toHaveLength(1);
  expect(engine.requests[0]).toMatchObject({ tag: "board.read", payload: { channelId: "channel", limit: 20 } });
});
