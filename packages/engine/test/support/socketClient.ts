import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { CommandsRpcGroup } from "@shepherd/contracts";
import * as Effect from "effect/Effect";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Socket from "effect/socket/Socket";
import WebSocket from "ws";

// A minimal, test-only client for the engine socket (unit 7a). Unit 7b's
// `packages/client` replaces it. It speaks Effect RPC with JSON
// serialization over a WebSocket at a `ws+unix:` address, as row 71 says the
// real client does (`NodeSocket.layerWebSocketConstructorWS`, which passes
// handshake headers to `ws`).
//
// The handshake this file defines, and the server must accept:
// - `Authorization: Bearer <credential>`. The owner's credential is the
//   base64url text of the 32 bytes in `<state folder>/owner-credential`
//   (identity/ownerCredential.ts); an agent token is `shp_a_...`, a device
//   credential `shp_d_...`.
// - Row 64's ancestor chain, sent on every upgrade: `Shepherd-Ancestors`,
//   comma-separated `<pid>:<start time>` pairs from the caller itself up
//   through each parent to the first process that cannot be read (normally
//   up to pid 1), and `Shepherd-Process-Group`, the caller's process group
//   id. The start time is field 22 of `/proc/<pid>/stat`, the value
//   `recovery/orphans.ts` records as a process row's start time.

export const socketUrl = (socketPath: string): string => `ws+unix://${socketPath}:/`;

const statFields = (pid: number): Array<string> => {
  const text = readFileSync(`/proc/${pid}/stat`, "utf8");
  return text.slice(text.lastIndexOf(")") + 2).trim().split(/\s+/);
};

// Row 64's headers for this process, read from /proc.
export const ancestryHeaders = (pid: number = process.pid): Record<string, string> => {
  const chain: Array<string> = [];
  let current = pid;
  for (let depth = 0; depth < 64 && current > 0; depth++) {
    let fields: Array<string>;
    try { fields = statFields(current); } catch { break; }
    chain.push(`${current}:${fields[19]}`);
    current = Number(fields[1]);
  }
  return { "Shepherd-Ancestors": chain.join(","), "Shepherd-Process-Group": statFields(pid)[2]! };
};

export const ownerBearer = (stateFolder: string): string =>
  readFileSync(join(stateFolder, "owner-credential")).toString("base64url");

export const authorization = (bearer: string): Record<string, string> => ({ Authorization: `Bearer ${bearer}` });

// An RPC client for every command in the contracts' group, the debug RPC
// included, connected once. `headers` replaces the default handshake
// headers (the bearer and this process's ancestry) when given.
export const connect = (socketPath: string, bearer: string, options: { readonly headers?: Record<string, string> } = {}) =>
  Effect.gen(function* () {
    const headers = options.headers ?? { ...authorization(bearer), ...ancestryHeaders() };
    const socket = yield* Socket.makeWebSocket(socketUrl(socketPath), { headers, openTimeout: 5_000 }).pipe(
      Effect.provide(NodeSocket.layerWebSocketConstructorWS),
    );
    const protocol = yield* RpcClient.makeProtocolSocket({ retryTransientErrors: false }).pipe(
      Effect.provideService(Socket.Socket, socket),
      Effect.provide(RpcSerialization.layerJson),
    );
    return yield* RpcClient.make(CommandsRpcGroup).pipe(Effect.provideService(RpcClient.Protocol, protocol));
  });

export type Client = Effect.Success<ReturnType<typeof connect>>;

// The raw outcome of one upgrade request: the HTTP status and body of a
// refusal, or the open socket of an accepted upgrade (status 101).
export type Upgrade =
  | { readonly status: number; readonly body: string; readonly socket?: undefined }
  | { readonly status: 101; readonly body: ""; readonly socket: WebSocket };

export const upgrade = (socketPath: string, headers: Record<string, string>, timeoutMillis = 5_000): Promise<Upgrade> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl(socketPath), { headers, handshakeTimeout: timeoutMillis });
    socket.once("open", () => resolve({ status: 101, body: "", socket }));
    socket.once("unexpected-response", (_request, response) => {
      const chunks: Array<Buffer> = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    socket.once("error", (error) => reject(error));
  });

// The upgrade outcome as data that never holds an open socket.
export const upgradeStatus = async (socketPath: string, headers: Record<string, string>): Promise<{ status: number; body: string }> => {
  const outcome = await upgrade(socketPath, headers);
  if (outcome.socket !== undefined) outcome.socket.terminate();
  return { status: outcome.status, body: outcome.body };
};

// A raw RPC request frame (Effect RPC's JSON serialization), for clients
// that must misbehave, such as one that never acknowledges stream chunks.
export const requestFrame = (id: string, tag: string, payload: unknown): string =>
  JSON.stringify({ _tag: "Request", id, tag, payload, headers: [] });
