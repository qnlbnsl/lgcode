// Real child processes and an Effect RPC wire peer for unit 7b. This is test
// infrastructure, never an alternative implementation of the client.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "vitest";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import { WebSocketServer, type WebSocket } from "ws";

import { makeServiceRoot, serviceEnvironment, stopAllServices, type ServiceRoot } from "../../../engine/test/support/serviceProcess.ts";
import type { Client } from "../../../engine/test/support/socketClient.ts";

export { makeServiceRoot, serviceEnvironment };
export type { ServiceRoot };

export const token = "shp_a_unit7b_environment_only_0123456789abcdef";
export const ownerBytes = Buffer.alloc(32, 79);
export const ownerCredential = ownerBytes.toString("base64url");

export const prepareRoot = (): ServiceRoot => {
  const root = makeServiceRoot("/tmp/s7b-");
  mkdirSync(root.state, { mode: 0o700 });
  writeFileSync(join(root.state, "owner-credential"), ownerBytes, { mode: 0o600 });
  return root;
};

export const agentEnvironment = (root: ServiceRoot): Record<string, string> => ({
  ...serviceEnvironment(root), SHEPHRD_NODE: process.execPath,
  SHEPHRD_SOCKET: root.socket, SHEPHRD_TOKEN: token,
});

// A timeout guards a named observable condition; a delay alone is never proof.
export const until = async <A>(name: string, condition: () => A | false | undefined | Promise<A | false | undefined>, limit = 10_000): Promise<A> => {
  const deadline = Date.now() + limit;
  for (;;) {
    const result = await condition();
    if (result !== false && result !== undefined) return result;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${name}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
};

export const bounded = async <A>(name: string, promise: Promise<A>, limit = 15_000): Promise<A> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), limit);
    })]);
  } finally { clearTimeout(timer); }
};

export interface Process {
  child: ChildProcessWithoutNullStreams;
  stdout: () => string;
  stderr: () => string;
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  exited: () => boolean;
}

const children: Array<Process> = [];
const listeners: Array<() => Promise<void>> = [];
const shephrd = fileURLToPath(new URL("../../../../bin/shephrd", import.meta.url));

export const startCli = (root: ServiceRoot, args: ReadonlyArray<string>, env: Record<string, string> = agentEnvironment(root)): Process => {
  const child = spawn(shephrd, [...args], { env: { ...env, SHEPHRD_NODE: process.execPath }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  let done = false;
  child.stdout.setEncoding("utf8").on("data", (text: string) => { stdout += text; });
  child.stderr.setEncoding("utf8").on("data", (text: string) => { stderr += text; });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => { done = true; resolve({ code, signal }); });
  });
  const result = { child, stdout: () => stdout, stderr: () => stderr, exit, exited: () => done };
  children.push(result);
  return result;
};

export const finishCli = async (process: Process) => bounded("the shephrd command to exit", process.exit);

export const assertNoSecrets = (process: Process, secrets: ReadonlyArray<string>): void => {
  let commandLine = "";
  try { commandLine = readFileSync(`/proc/${process.child.pid}/cmdline`, "utf8"); } catch { /* already exited */ }
  for (const secret of secrets) {
    // Boolean assertions keep a regression from echoing a planted credential in
    // the test reporter's expected/actual diff.
    expect(process.stdout().includes(secret), "credential reached stdout").toBe(false);
    expect(process.stderr().includes(secret), "credential reached stderr").toBe(false);
    expect(commandLine.includes(secret), "credential reached child arguments").toBe(false);
  }
};

export interface RequestFrame {
  _tag: "Request";
  id: string;
  tag: string;
  payload: Record<string, any>;
  headers: ReadonlyArray<unknown>;
}
export const succeed = (socket: WebSocket, frame: RequestFrame, value: unknown): void => {
  // Effect 4's JSON codec encodes a stream's terminal void as null.
  socket.send(JSON.stringify({ _tag: "Exit", requestId: frame.id, exit: { _tag: "Success", value: value === undefined ? null : value } }));
};
export const refuse = (socket: WebSocket, frame: RequestFrame, reason = "command refused"): void => {
  socket.send(JSON.stringify({ _tag: "Exit", requestId: frame.id, exit: { _tag: "Failure", cause: [{
    _tag: "Fail", error: { _tag: "CommandError", requestId: frame.payload.requestId, reason },
  }] } }));
};
export const chunk = (socket: WebSocket, frame: RequestFrame, values: ReadonlyArray<unknown>): void => {
  socket.send(JSON.stringify({ _tag: "Chunk", requestId: frame.id, values }));
};

export const fakeEngine = async (root: ServiceRoot, options: {
  socketPath?: string;
  recovering?: number;
  onRequest?: (frame: RequestFrame, socket: WebSocket, connection: number) => void;
  onAck?: (socket: WebSocket, connection: number) => void;
} = {}) => {
  const server = createServer((_request, response) => { response.writeHead(503); response.end("recovering"); });
  const webSockets = new WebSocketServer({ noServer: true });
  const upgrades: Array<IncomingHttpHeaders> = [];
  const requests: Array<RequestFrame> = [];
  const malformed: Array<unknown> = [];
  let accepted = 0;
  server.on("upgrade", (request, socket, head) => {
    upgrades.push(request.headers);
    if (upgrades.length <= (options.recovering ?? 0)) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nContent-Length: 10\r\nConnection: close\r\n\r\nrecovering");
      return;
    }
    const connection = ++accepted;
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSocket.on("error", () => { /* disconnects are part of these tests */ });
      webSocket.on("message", (data) => {
        let decoded: unknown;
        try { decoded = JSON.parse(data.toString()); }
        catch { malformed.push("invalid JSON frame"); return; }
        for (const frame of (Array.isArray(decoded) ? decoded : [decoded]) as Array<any>) {
          if (frame._tag === "Ping") { webSocket.send(JSON.stringify({ _tag: "Pong" })); continue; }
          if (frame._tag === "Ack") { options.onAck?.(webSocket, connection); continue; }
          if (frame._tag === "Interrupt") continue;
          if (frame._tag !== "Request") { malformed.push(frame); continue; }
          requests.push(frame as RequestFrame);
          if (options.onRequest !== undefined) options.onRequest(frame as RequestFrame, webSocket, connection);
          else succeed(webSocket, frame as RequestFrame, { requestId: frame.payload.requestId, questionId: "question-7b" });
        }
      });
    });
  });
  listeners.push(async () => {
    for (const socket of webSockets.clients) socket.terminate();
    await new Promise<void>((resolve) => webSockets.close(() => resolve()));
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.socketPath ?? root.socket, resolve);
  });
  chmodSync(options.socketPath ?? root.socket, 0o600);
  return { upgrades, requests, malformed };
};

export interface McpReply {
  jsonrpc: string;
  id: number;
  result?: any;
  error?: { code: number; message: string };
}

export const mcpPeer = (process: Process) => {
  let id = 0;
  let pendingText = "";
  const replies = new Map<number, McpReply>();
  const malformed: Array<string> = [];
  process.child.stdout.on("data", (text: string) => {
    pendingText += text;
    for (;;) {
      const end = pendingText.indexOf("\n");
      if (end < 0) break;
      const line = pendingText.slice(0, end);
      pendingText = pendingText.slice(end + 1);
      if (line.trim() === "") continue;
      try { const reply = JSON.parse(line) as McpReply; if (reply.id !== undefined) replies.set(reply.id, reply); }
      catch { malformed.push(line); }
    }
  });
  const request = async (method: string, params: unknown = {}, limit = 10_000): Promise<McpReply> => {
    const requestId = ++id;
    if (process.exited()) throw new Error("shephrd mcp exited before answering JSON-RPC");
    process.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`);
    return until(`MCP ${method} reply`, () => {
      if (malformed.length > 0) throw new Error("shephrd mcp printed non-JSON protocol output");
      const reply = replies.get(requestId);
      if (reply !== undefined) return reply;
      if (process.exited()) throw new Error(`shephrd mcp exited before ${method} replied`);
      return undefined;
    }, limit);
  };
  const initialize = async () => {
    const reply = await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "unit7b-test", version: "1" } });
    expect(reply.error).toBeUndefined();
    expect(reply.result?.serverInfo?.name).toBeTruthy();
    process.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  };
  return { request, initialize };
};

export const loadClient = async () => {
  const module = await import("@shephrd/client") as unknown as {
    connect: (options: {
      environment: Readonly<Record<string, string | undefined>>;
      socketSecurity?: {
        uid: number;
        realpath: (path: string) => string;
        lstat: (path: string) => {
          uid: number; mode: number;
          isDirectory: () => boolean; isSocket: () => boolean; isSymbolicLink: () => boolean;
        };
      };
    }) => Effect.Effect<Client, unknown, Scope.Scope>;
  };
  expect(typeof module.connect, "unit 7b must export connect({ environment }) from @shephrd/client").toBe("function");
  return module.connect;
};

export const cleanupUnit7b = async (): Promise<void> => {
  for (const child of children.splice(0)) {
    if (!child.exited()) {
      child.child.kill("SIGTERM");
      try { await bounded("owned command to stop", child.exit, 2_000); }
      catch { child.child.kill("SIGKILL"); }
    }
    await child.exit;
  }
  for (const close of listeners.splice(0)) await close();
  await stopAllServices();
};
