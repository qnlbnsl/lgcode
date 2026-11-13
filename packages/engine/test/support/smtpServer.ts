import { createServer, type Socket } from "node:net";

// A local SMTP peer exercises the real transport, including authentication and DATA.
export async function smtpServer() {
  const messages: string[] = []; const sockets = new Set<Socket>(); let reject = false; let authAttempts = 0;
  const server = createServer((socket) => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket));
    socket.write("220 local.test ESMTP\r\n"); let buffer = ""; let data: string[] | undefined;
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      for (;;) {
        const end = buffer.indexOf("\r\n"); if (end < 0) break;
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (data) { if (line === ".") { messages.push(data.join("\r\n")); data = undefined; socket.write("250 accepted\r\n"); } else data.push(line); continue; }
        if (/^EHLO/.test(line)) socket.write("250-local.test\r\n250 AUTH PLAIN\r\n");
        else if (/^AUTH/.test(line)) { authAttempts++; socket.write(reject ? "535 private rejection\r\n" : "235 authenticated\r\n"); }
        else if (line === "DATA") { data = []; socket.write("354 send message\r\n"); }
        else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No SMTP port");
  return { messages, authAttempts: () => authAttempts, port: address.port, reject: () => { reject = true; }, close: () => new Promise<void>((resolve) => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()); }) };
}
