import { PassThrough } from "node:stream";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { render } from "ink";
import { afterEach, expect, it } from "vitest";
import { connectViewer, readRequestContext } from "../src/index.ts";
import { ViewerApp } from "../src/app.ts";
import { safeText } from "../src/text.ts";
import { agentRow, envelope, permission, snapshot } from "../../client/test/support/unit3.ts";
import {
  agentEnvironment, chunk, cleanupUnit7b, fakeEngine, finishCli, prepareRoot,
  ownerCredential, refuse, serviceEnvironment, startCli, succeed, until, type RequestFrame,
} from "../../testing/test/support/unit7b.ts";
import type { WebSocket } from "ws";

const dispose: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of dispose.splice(0).reverse()) await close();
  await cleanupUnit7b();
});

it("drives live threads, context review, a selected answer and an owner prompt through the real socket client and Ink keys", async () => {
  const root = prepareRoot();
  let subscription: { frame: RequestFrame; socket: WebSocket } | undefined;
  let answered = false;
  const action = { ...permission(9).event,
    options: [
      { id: "once", name: "Allow once", kind: "allow_once", level: "ask", persistent: false },
      { id: "reject", name: "Reject", kind: "reject_once", level: "read-only", persistent: false },
    ],
    toolInput: { command: "inspect configuration", details: Array.from({ length: 20 }, (_, i) => `detail ${i}`) } };
  const initial = envelope(8, { _tag: "ThreadItem", agentId: "agent-a", itemId: "initial", replay: false,
    content: { _tag: "text", text: "Initial thread text" } });
  const peer = await fakeEngine(root, { onRequest: (frame, socket) => {
    if (frame.tag === "client.snapshot") succeed(socket, frame, { requestId: frame.payload.requestId, ...snapshot({
      agents: [agentRow(), agentRow("agent-b")],
      requests: answered ? [] : [{ id: "permission-9", agentId: "agent-a", holder: { _tag: "owner" }, sourceSequence: 9 }],
    }) });
    else if (frame.tag === "client.thread") succeed(socket, frame, { requestId: frame.payload.requestId, items: [initial] });
    else if (frame.tag === "client.subscribe") subscription = { frame, socket };
    else if (frame.tag === "client.event") {
      if (frame.payload.sequence !== 9) refuse(socket, frame, "unexpected request source sequence");
      else succeed(socket, frame, { requestId: frame.payload.requestId, envelope: envelope(9, action) });
    }
    else if (frame.tag === "answer") { answered = true; succeed(socket, frame, { requestId: frame.payload.requestId }); }
    else if (frame.tag === "prompt") succeed(socket, frame, { requestId: frame.payload.requestId, deliveryId: "owner-prompt" });
    else throw new Error(`Unexpected viewer request: ${frame.tag}`);
  } });
  const client = await connectViewer(serviceEnvironment(root));
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => stdin });
  const stdout = Object.assign(new PassThrough(), { columns: 100, rows: 24, isTTY: false });
  let output = "";
  stdout.on("data", (data) => { output += String(data); });
  const app = render(<ViewerApp client={client} />, {
    stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream, debug: true, patchConsole: false, exitOnCtrlC: false,
  });
  dispose.push(async () => { app.unmount(); await app.waitUntilExit(); await client.close(); stdin.destroy(); stdout.destroy(); });
  const key = (text: string) => { stdin.write(text); };
  await until("initial rendered thread and subscription", () => output.includes("Initial thread text") && subscription);
  expect(output).toContain("Name agent-a");
  expect(output).toContain("Name agent-b");
  expect(peer.upgrades.every((headers) => headers.authorization === `Bearer ${ownerCredential}`)).toBe(true);
  expect(peer.upgrades.every((headers) => typeof headers["shephrd-ancestors"] === "string" && typeof headers["shephrd-process-group"] === "string")).toBe(true);
  const live = envelope(11, { _tag: "ThreadItem", agentId: "agent-a", itemId: "live", replay: false,
    content: { _tag: "text", text: "Live left\u001b]52;c;clipboard-data\u0007right" } });
  chunk(subscription!.socket, subscription!.frame, [live]);
  await until("live rendered event", () => output.includes("Live leftright"));
  expect(output).not.toContain("clipboard-data");
  key("a");
  await until("request event read", () => peer.requests.some((frame) => frame.tag === "client.event"));
  expect(peer.requests.filter((frame) => frame.tag === "client.event").map((frame) => frame.payload.sequence)).toEqual([9]);
  await until("first context page", () => output.includes("inspect configuration") && output.includes("Read the context"));
  key("\r");
  key("\u001b[F");
  await until("last context page and answer controls", () => output.includes("Enter: submit"));
  expect(peer.requests.filter((frame) => frame.tag === "answer")).toHaveLength(0);
  expect(peer.requests.findIndex((frame) => frame.tag === "client.event")).toBeGreaterThan(-1);
  key("\u001b[C");
  await until("selected reject option", () => output.includes("Option 2/2"));
  key("\r");
  await until("answered request", () => output.includes("Answered."));
  expect(peer.requests.find((frame) => frame.tag === "answer")?.payload).toMatchObject({
    kind: "permission", id: "permission-9", optionId: "reject",
  });
  expect(peer.requests.filter((frame) => frame.tag === "answer")).toHaveLength(1);
  expect(peer.requests.findIndex((frame) => frame.tag === "client.event")).toBeLessThan(
    peer.requests.findIndex((frame) => frame.tag === "answer"),
  );
  key("p");
  await until("prompt composer", () => output.includes("Owner draft to agent-a"));
  key("\u001b[200~Please inspect\nthis exact text.\u001b[201~");
  await until("pasted draft", () => output.includes("this exact text."));
  expect(peer.requests.filter((frame) => frame.tag === "prompt")).toHaveLength(0);
  key("\r");
  await until("prompt delivered", () => output.includes("Sent."));
  expect(peer.requests.find((frame) => frame.tag === "prompt")?.payload).toMatchObject({ agentId: "agent-a", text: "Please inspect\nthis exact text." });
});

it("finds the actual tool-call schema beyond the first thread page and retains fixed warnings for partial input", async () => {
  const calls: Array<number> = [];
  const client = {
    event: async () => ({ envelope: { event: { _tag: "PermissionRequested", locations: [{ path: "settings.json" }] } } }),
    thread: async ({ after }: { after: number }) => {
      calls.push(after);
      return after === 0 ? { items: [{ event: { _tag: "ThreadItem", content: { _tag: "tool-call", callId: "other", title: "Unrelated" } } }], next: 100 }
        : { items: [{ event: { _tag: "ThreadItem", content: { _tag: "tool-call", callId: "matching", title: "Edit config", input: "full diff" } } }] };
    },
  };
  const request = { agentId: "agent-a", sequence: 9, toolCallId: "matching" };
  const context = await readRequestContext(client, request);
  expect(calls).toEqual([0, 100]);
  expect(context).toContain("full diff");
  expect(context).not.toContain("Unrelated");
  expect(context).not.toContain("not visible");
  const partial = await readRequestContext({ ...client, event: async () => ({ envelope: { event: {
    toolInput: { command: "partial" }, inputRedacted: true, inputTruncated: true,
  } } }) }, request);
  expect(partial).toContain("Part of the action's input is hidden");
  expect(partial).toContain("The action's input is cut at 8 KiB.");
});

it("strips every terminal string family including C1 payloads while preserving ordinary Unicode", () => {
  expect(safeText("left\u001b[2J\u001b[31mred\u001b[0m\u001b]0;window-title\u001b\\right\n\t漢字🙂")).toBe("leftredright\n\t漢字🙂");
  for (const open of ["\u001bP", "\u001bX", "\u001b^", "\u001b_", "\u0090", "\u0098", "\u009e", "\u009f"])
    expect(safeText(`left${open}payload\u009cright`)).toBe("leftright");
  expect(safeText("left\u009d52;c;payload\u0007right")).toBe("leftright");
});

it("runs the Node launcher and opens the declared pane without granting an agent an owner action", async () => {
  const root = prepareRoot();
  await fakeEngine(root);
  const binary = join(root.root, "fake-herdr");
  const args = join(root.root, "pane-arguments");
  writeFileSync(binary, `#!/bin/sh\nprintf '%s\\n' "$@" > '${args}'\n`);
  chmodSync(binary, 0o700);
  const environment = { ...serviceEnvironment(root), HERDR_BIN_PATH: binary };
  const action = startCli(root, ["view", "--open-pane"], environment);
  expect((await finishCli(action)).code).toBe(0);
  expect(readFileSync(args, "utf8").trim().split("\n")).toEqual(["plugin", "pane", "open", "--plugin", "shephrd", "--entrypoint", "view"]);
  const agent = startCli(root, ["view", "--open-pane"], { ...agentEnvironment(root), HERDR_BIN_PATH: binary });
  expect((await finishCli(agent)).code).toBe(1);
  // Importing the terminal app in Node must work without a JSX transform.
  const nonTerminal = startCli(root, ["view"], environment);
  expect((await finishCli(nonTerminal)).code).toBe(1);
  expect(nonTerminal.stderr()).toContain("the viewer needs an owner terminal");
  expect(nonTerminal.stderr()).not.toContain("unexpectedly");
});

it("refuses a pane action when the engine rejects its process identity, before invoking Herdr", async () => {
  const root = prepareRoot();
  const server = createServer();
  let refused = false;
  server.on("upgrade", (_request, socket) => {
    refused = true;
    socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
  });
  await new Promise<void>((resolve) => server.listen(root.socket, resolve));
  chmodSync(root.socket, 0o600);
  dispose.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const binary = join(root.root, "must-not-run");
  const marker = join(root.root, "invoked");
  writeFileSync(marker, "no");
  writeFileSync(binary, `#!/bin/sh\nprintf yes > '${marker}'\n`);
  chmodSync(binary, 0o700);
  const action = startCli(root, ["view", "--open-pane"], { ...serviceEnvironment(root), HERDR_BIN_PATH: binary });
  expect((await finishCli(action)).code).toBe(1);
  expect(refused).toBe(true);
  expect(readFileSync(marker, "utf8")).toBe("no");
  expect(action.stderr()).toContain("owner viewer pane could not be opened");
});
