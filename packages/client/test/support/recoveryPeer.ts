// A real Unix/WebSocket peer whose HTTP upgrade status can change after a
// successful connection. The older unit7b peer only refuses initial upgrades.
import { chmodSync } from "node:fs";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { bounded, type RequestFrame, type ServiceRoot } from "../../../testing/test/support/unit7b.ts";

const peers: Array<() => Promise<void>> = [];

export const recoveryPeer = async (root: ServiceRoot, onRequest: (frame: RequestFrame, socket: WebSocket, connection: number) => void) => {
  const server = createServer((_request, response) => { response.writeHead(503).end(); });
  const webSockets = new WebSocketServer({ noServer: true });
  const requests: Array<{ frame: RequestFrame; connection: number }> = [];
  const interrupts: Array<{ requestId: string; connection: number }> = [];
  const connections: Array<WebSocket> = [];
  const closed: Array<number> = [];
  const upgrades: Array<{ status: number; at: number }> = [];
  let upgradeStatus = () => 101;
  server.on("upgrade", (request, socket, head) => {
    const status = upgradeStatus();
    upgrades.push({ status, at: Date.now() });
    if (status !== 101) {
      socket.end(`HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : "Service Unavailable"}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
      return;
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      const connection = connections.push(webSocket);
      webSocket.on("error", () => { /* transport failures are intentional */ });
      webSocket.once("close", () => closed.push(connection));
      webSocket.on("message", (data) => {
        const decoded = JSON.parse(data.toString());
        for (const frame of Array.isArray(decoded) ? decoded : [decoded]) {
          if (frame._tag === "Ping") webSocket.send(JSON.stringify({ _tag: "Pong" }));
          else if (frame._tag === "Interrupt") interrupts.push({ requestId: frame.requestId, connection });
          else if (frame._tag === "Request") {
            requests.push({ frame, connection });
            onRequest(frame, webSocket, connection);
          }
        }
      });
    });
  });
  peers.push(async () => {
    for (const socket of webSockets.clients) socket.terminate();
    await bounded("the recovery peer's WebSockets to close", new Promise<void>((resolve) => webSockets.close(() => resolve())));
    server.closeAllConnections();
    await bounded("the recovery peer's listener to close", new Promise<void>((resolve) => server.close(() => resolve())));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(root.socket, resolve);
  });
  chmodSync(root.socket, 0o600);
  return {
    requests, interrupts, connections, closed, upgrades,
    setUpgradeStatus: (status: () => number) => { upgradeStatus = status; },
  };
};

export const closeRecoveryPeers = async () => {
  for (const close of peers.splice(0)) await close();
};
