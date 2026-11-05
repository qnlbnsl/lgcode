import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { request } from "node:http"
import { createServer } from "node:https"
import { connect, type AddressInfo, type Socket } from "node:net"
import { join } from "node:path"

// Only the test proxy terminates TLS. The real production web listener stays
// on HTTP loopback, with the browser's public Host and Origin preserved.
export async function httpsProxy(upstreamPort: number, root: string) {
  const folder = mkdtempSync(join(root, "https-proxy-"))
  const key = join(folder, "key.pem")
  const cert = join(folder, "cert.pem")
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=127.0.0.1",
    "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" })
  const sockets = new Set<Socket>()
  const track = (socket: Socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    return socket
  }
  const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (incoming, outgoing) => {
    const upstream = request({ host: "127.0.0.1", port: upstreamPort,
      method: incoming.method, path: incoming.url,
      headers: { ...incoming.headers, "x-forwarded-proto": "https" } }, (response) => {
      outgoing.writeHead(response.statusCode!, response.headers)
      response.pipe(outgoing)
    })
    upstream.on("error", () => { outgoing.writeHead(502); outgoing.end() })
    incoming.pipe(upstream)
  })
  server.on("connection", track)
  server.on("upgrade", (incoming, socket, head) => {
    const upstream = track(connect(upstreamPort, "127.0.0.1"))
    upstream.once("connect", () => {
      const headers = incoming.rawHeaders.reduce<string[]>((lines, value, index, all) => {
        if (index % 2 === 0) lines.push(`${value}: ${all[index + 1]}`)
        return lines
      }, [])
      upstream.write(`${incoming.method} ${incoming.url} HTTP/${incoming.httpVersion}\r\n${headers.join("\r\n")}\r\nx-forwarded-proto: https\r\n\r\n`)
      if (head.length > 0) upstream.write(head)
      upstream.pipe(socket).pipe(upstream)
    })
    upstream.on("error", () => socket.destroy())
    socket.on("error", () => upstream.destroy())
    socket.once("close", () => upstream.destroy())
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  return {
    origin: `https://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(folder, { recursive: true, force: true })
    }
  }
}
