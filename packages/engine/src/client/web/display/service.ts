import { createServer, request as httpRequest } from "node:http"
import type { Socket } from "node:net"
import { extname } from "node:path"
import { fingerprint } from "../../../project/artifacts.ts"
import * as Effect from "effect/Effect"
import type { DisplayFrame, DisplayOpen } from "@lgtm/contracts/project/display"
import type { Input } from "../../../commands/internal.ts"
import { designDisplay, mockDisplay, componentDisplay } from "../../../project/display.ts"
import { makeMockRenderer, type DisplayResponse } from "./renderer.ts"
import { displayHeaders, displayRequestAllowed, type DisplayConfiguration } from "./policy.ts"
import { makeDisplaySessions } from "./sessions.ts"
import { readDisplayResource } from "./resources.ts"
import { launchOpenPencil } from "./openPencil.ts"
import { displayUrl } from "./url.ts"

const empty = (status: number): DisplayResponse => ({ status, headers: { "cache-control": "no-store" }, body: new Uint8Array() })
const childResponse = (socketPath: string, path: string, head: boolean) => new Promise<{ bytes: Buffer; contentType: string; status: number }>((resolve, reject) => {
  // Only generated paths reach the private child. No browser headers, cookies,
  // authorization, referrer or session token is forwarded or logged.
  const request = httpRequest({ socketPath, path, method: head ? "HEAD" : "GET", headers: { host: "editor" }, timeout: 10_000 }, (response) => {
    const chunks: Buffer[] = []; let length = 0
    response.on("data", (chunk: Buffer) => {
      length += chunk.length
      if (length > 32 * 1024 * 1024) { request.destroy(); reject(new Error("editor response unavailable")) }
      else chunks.push(chunk)
    })
    response.on("end", () => resolve({ bytes: Buffer.concat(chunks), contentType: response.headers["content-type"] ?? "application/octet-stream", status: response.statusCode ?? 502 }))
    response.on("error", () => reject(new Error("editor response unavailable")))
  })
  request.on("timeout", () => request.destroy())
  request.on("error", () => reject(new Error("editor response unavailable")))
  request.end()
})

// Engine-owned listener and editor lifetime. Calling this function binds the
// explicit loopback port. No module import, page render or default server call
// starts it; current runtime and browser grants remain separate.
export const serveDisplay = async (options: {
  readonly configuration: DisplayConfiguration
  readonly image: string
  readonly dockerSocket: string
  readonly input: () => Promise<Input>
  readonly registerSecret: (secret: string) => void
  readonly onCleanupFailure: () => void
}) => {
  const { configuration } = options
  const sessions = makeDisplaySessions(configuration, options.registerSecret)
  const editors = new Map<string, { runtime: Awaited<ReturnType<typeof launchOpenPencil>>; folder: string }>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const pending = new Set<Promise<unknown>>()
  const sockets = new Set<Socket>()
  let closed = false, generation = 0
  let closing: Promise<void> | undefined
  const closeSession = async (id: string) => {
    sessions.revoke(id); clearTimeout(timers.get(id)); timers.delete(id)
    const editor = editors.get(id)
    if (editor !== undefined) { await editor.runtime.close(); editors.delete(id) }
  }
  const track = <A>(operation: Promise<A>) => {
    pending.add(operation)
    void operation.finally(() => pending.delete(operation)).catch(() => {})
    return operation
  }
  const expire = (frame: DisplayFrame) => {
    const timer = setTimeout(() => { void track(closeSession(frame.id)).catch(options.onCleanupFailure) }, Math.max(0, frame.expiresAt - Date.now()))
    timer.unref(); timers.set(frame.id, timer)
  }
  const renderMock = makeMockRenderer({ configuration, sessions, input: options.input })
  const render = async (url: string, method: string, headers: Readonly<Record<string, string | undefined>>): Promise<DisplayResponse> => {
    if (closed || !displayRequestAllowed(configuration, headers, method)) return empty(403)
    const session = sessions.authorize(url, headers.referer)
    if (session?.target.kind === "mock" || session?.target.kind === "component") return renderMock({ url, method, headers })
    try {
      const target = displayUrl(url, configuration.displayOrigin)
      if (target === undefined || target.path === "/api" || target.path.startsWith("/api/") || target.path.startsWith("/files/")) return empty(404)
      if (target.path.startsWith("/session/")) {
        if (session?.target.kind !== "editor") return empty(401)
        const input = await options.input(), current = await Effect.runPromise(designDisplay(input, session.target.selection))
        const editor = editors.get(session.id)
        const parts = target.path.split("/")
        if (editor === undefined || current.folder !== editor.folder || parts[3] !== "files") return empty(404)
        const path = parts.slice(4).join("/")
        const resource = await readDisplayResource(current.folder, path, "editor", (text) => Effect.runPromise(input.runtime.log.redactText(text)))
        const response = await childResponse(editor.runtime.socketPath, "/files/" + path.split("/").map(encodeURIComponent).join("/"), method === "HEAD")
        if (sessions.authorize(url, headers.referer)?.id !== session.id) return empty(401)
        if (response.status !== 200 || method !== "HEAD" && fingerprint(response.bytes) !== resource.fingerprint) return empty(404)
        return { status: 200, headers: { ...displayHeaders(configuration, "editor"), "content-type": resource.contentType }, body: response.bytes }
      }
      // The immutable editor distribution contains no project data. It is
      // public static material, served only while an actual editor is open.
      // Private file reads above never redirect and need no cookie/referrer.
      const editor = editors.values().next().value
      if (editor === undefined) return empty(503)
      if (target.path !== "/" && ![".js", ".mjs", ".css", ".wasm", ".woff", ".woff2", ".ttf", ".png", ".svg", ".ico", ".json", ".webp"].includes(extname(target.path).toLowerCase())) return empty(404)
      const response = await childResponse(editor.runtime.socketPath, target.url.pathname, method === "HEAD")
      return { status: response.status, headers: { ...displayHeaders(configuration, "editor"), "content-type": response.contentType }, body: response.bytes }
    } catch { return empty(404) }
  }
  const server = createServer((request, response) => {
    const headers = Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name, Array.isArray(value) ? value.join(",") : value]))
    void track(render(request.url ?? "", request.method ?? "", headers)).then((result) => {
      if (!response.destroyed) { response.writeHead(result.status, result.headers); response.end(result.body) }
    }).catch(() => { if (!response.destroyed) { response.writeHead(500); response.end() } })
  })
  server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.maxHeadersCount = 32
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)) })
  server.on("upgrade", (_request, socket) => socket.destroy())
  await new Promise<void>((resolve, reject) => {
    const error = () => reject(new Error("isolated display listener unavailable"))
    server.once("error", error)
    server.listen({ host: "127.0.0.1", port: configuration.port }, () => { server.off("error", error); resolve() })
  })
  const revokeAll = async () => {
    generation++; sessions.revokeAll()
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    // A logout/disable also waits for a launch already in progress. Its
    // generation check closes the newly started child instead of issuing a
    // frame after revocation. An HTTP response alone cannot prove cleanup.
    await Promise.allSettled([...pending])
    const results = await Promise.allSettled([...editors.keys()].map(closeSession))
    if (results.some((result) => result.status === "rejected")) throw new Error("editor cleanup unconfirmed")
  }
  return {
    open: (selection: DisplayOpen) => track((async (): Promise<DisplayFrame> => {
      if (closed) throw new Error("isolated display unavailable")
      const openingGeneration = generation, input = await options.input()
      if (selection._tag === "mock" || selection._tag === "component") {
        const current = selection._tag === "component"
          ? await Effect.runPromise(componentDisplay(input, selection))
          : await Effect.runPromise(mockDisplay(input, selection))
        if (closed || openingGeneration !== generation) throw new Error("display session ended")
        const frame = sessions.issue(selection._tag === "component" ? { kind: "component", selection } : { kind: "mock", selection })
        try {
          const result = { id: frame.id, expiresAt: frame.expiresAt, displayOrigin: configuration.displayOrigin, url: frame.mockUrl(current.route) }
          expire(result); return result
        } catch { await closeSession(frame.id); throw new Error("recorded display route unavailable") }
      }
      const current = await Effect.runPromise(designDisplay(input, selection))
      if (closed || openingGeneration !== generation) throw new Error("display session ended")
      const frame = sessions.issue({ kind: "editor", selection: { repoId: current.repoId, projectId: current.projectId, revisionId: current.revisionId } })
      try {
        const runtime = await launchOpenPencil(current, options)
        editors.set(frame.id, { runtime, folder: current.folder })
        if (closed || openingGeneration !== generation) { await closeSession(frame.id); throw new Error("display session ended") }
        const result = { id: frame.id, expiresAt: frame.expiresAt, displayOrigin: configuration.displayOrigin, url: frame.editorUrl(current.file) }
        expire(result); return result
      } catch { await closeSession(frame.id); throw new Error("editor unavailable") }
    })()),
    closeSession,
    revokeAll,
    close: () => closing ??= (async () => {
      closed = true
      server.close(() => {})
      for (const socket of sockets) socket.destroy()
      await Promise.allSettled([...pending])
      await revokeAll()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })()
  }
}
