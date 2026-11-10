// Passive metadata for the owned Git browser fixture. No requests, waits, routes,
// retries, credentials, raw frames, console text, file content or draft text.
import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import type { ConsoleMessage, Page, WebSocket } from "@playwright/test"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import type { EngineLists } from "../../engine/src/pieces/lists.ts"

const object = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const correlation = (value: unknown) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? hash(value) : undefined
const operation = (value: unknown) => typeof value === "string" && /^(?:project\.(?:git\.state|changes|history|commit(?:\.files)?|diff|review(?:\.(?:status|prepare|approve))?|stage(?:\.all)?|unstage(?:\.all)?|discard(?:\.plan)?|fetch|pull|push|conflict(?:\.(?:choose|resolve))?|integrate)|client\.(?:snapshot|subscribe))$/.test(value) ? value : "other"
const fixedReasons = new Set(["Git outcome is uncertain; refresh Git state", "recovering", "invalid credential", "request id reused", "database read failed", "database write failed", "database write failed: busy", "database write failed: constraint", "database write failed: disk full", "Git reply exceeds the read budget; select a smaller file or page", "Git operation queue is full; retry shortly", "registered workspace branch changed; restore the registered branch"])
const failure = (value: unknown) => {
  const error = object(value), reason = error.reason
  return { errorTag: ["CommandRefused", "LogWriteFailed", "CommandError", "RpcClientError", "ClientError", "SchemaError", "SocketError", "TimeoutError"].includes(String(error._tag)) ? error._tag : "other",
    reason: typeof reason === "string" && (fixedReasons.has(reason) || /^Git: (?:invalid_path|not_repository|invalid_ref|output_limit|timeout|cancelled|git_unavailable|git_failed|busy|collision|dirty_destination|dirty_source|conflicts|confirmation_required|stale_state|nothing_staged|invalid_message|missing_remote|missing_upstream|authentication_required|network_failed|push_rejected|pull_diverged|base_requires_review|unsupported_conflict|incomplete_choices|owner_required|unsupported_review)$/.test(reason)) ? reason : "other" }
}
const resultMetadata = (value: unknown) => {
  const result = object(object(value).result), metadata: Record<string, unknown> = {}
  if (typeof result.head === "string" && /^[0-9a-f]{40,64}$/.test(result.head)) metadata.head = result.head
  for (const name of ["ahead", "behind", "pending"]) if (typeof result[name] === "number" && Number.isSafeInteger(result[name])) metadata[name] = result[name]
  for (const name of ["truncated", "binary"]) if (typeof result[name] === "boolean") metadata[name] = result[name]
  if (Array.isArray(result.items)) metadata.items = result.items.length
  if (typeof result.patch === "string") metadata.patchBytes = Buffer.byteLength(result.patch)
  return metadata
}

export function observeGit(page: Page | undefined, outputPath: string) {
  const events: Record<string, unknown>[] = [], started = performance.now()
  let dropped = 0, observerErrors = 0, sockets = 0
  const record = (kind: string, detail: Record<string, unknown> = {}) => {
    try { if (events.length < 4000) events.push({ kind, unixMs: Date.now(), elapsedMs: performance.now() - started, ...detail }); else dropped++ }
    catch { observerErrors++ }
  }
  const guard = (body: () => void) => { try { body() } catch { observerErrors++ } }
  const consoleMessage = (message: ConsoleMessage) => guard(() => {
    const text = message.text()
    if (message.type() === "debug" && text.startsWith("W09_GIT_OBSERVATION ")) {
      const input = object(JSON.parse(text.slice(20))), detail: Record<string, unknown> = {}
      for (const name of ["ready", "refreshing", "hasData", "hasNotice", "hasError", "comparisonLoading", "comparisonReadFailed", "comparisonFallback", "changesTruncated", "domSyncPresent", "domSyncParsed", "domRefreshPresent", "domRefreshDisabled", "domRefreshing"])
        if (typeof input[name] === "boolean") detail[name] = input[name]
      for (const name of ["revision", "staged", "changes", "ahead", "behind", "renderedDiffFiles", "browserUnixMs", "browserElapsedMs", "domIncoming", "domOutgoing"])
        if (typeof input[name] === "number" && Number.isFinite(input[name])) detail[name] = input[name]
      if (typeof input.head === "string" && /^[0-9a-f]{40,64}$/.test(input.head)) detail.head = input.head
      for (const name of ["connection", "attempt", "scope", "mode", "workspace", "trigger"])
        if (["Connecting", "Live", "Reconnecting", "none", "pending", "uncertain", "all", "file", "unified", "split", "assigned", "destination", "initial", "session", "dom"].includes(String(input[name]))) detail[name] = input[name]
      record("fixture-view", detail); return
    }
    record("console", { type: message.type(), length: text.length, sha256: hash(text), category: /websocket/i.test(text) ? "websocket" : /content security|\bcsp\b/i.test(text) ? "csp" : /network|fetch|resource/i.test(text) ? "network" : "other" })
  })
  const pageError = (error: Error) => guard(() => record("pageerror", { name: ["Error", "TypeError", "ReferenceError", "SyntaxError", "RangeError"].includes(error.name) ? error.name : "other", length: error.message.length, sha256: hash(error.message) }))
  const detach: Array<() => void> = []
  const websocket = (socket: WebSocket) => guard(() => {
    const url = new URL(socket.url())
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/api") return
    const id = ++sockets, requests = new Map<string, { operation: string; correlation?: string | undefined }>()
    record("socket-open", { socket: id })
    const frame = (direction: "sent" | "received") => ({ payload }: { payload: string | Buffer }) => guard(() => {
      const bytes = Buffer.byteLength(payload)
      if (bytes > 1024 * 1024) { record("frame-unparsed", { socket: id, direction, bytes }); return }
      const decoded: unknown = JSON.parse(typeof payload === "string" ? payload : payload.toString("utf8"))
      for (const value of Array.isArray(decoded) ? decoded : [decoded]) {
        const message = object(value), tag = message._tag
        if (!["Request", "Exit", "Interrupt", "Chunk", "Ack", "Ping", "Pong", "Eof", "Defect"].includes(String(tag))) continue
        const rpcId = String(tag === "Request" ? message.id : message.requestId), detail = tag === "Request"
          ? { operation: operation(message.tag), correlation: correlation(object(message.payload).requestId) } : requests.get(rpcId)
        if (tag === "Request" && detail && requests.size < 1000) requests.set(rpcId, detail)
        const exit = object(message.exit)
        record("wire", { socket: id, direction, tag, bytes, ...detail,
          ...(tag === "Exit" ? { exit: exit._tag === "Success" ? "Success" : "Failure", ...(exit._tag === "Success" ? resultMetadata(exit.value) : {}) } : {}) })
        if (tag === "Exit") requests.delete(rpcId)
      }
    })
    const sent = frame("sent"), received = frame("received")
    const close = () => record("socket-close", { socket: id })
    const error = () => record("socket-error", { socket: id })
    socket.on("framesent", sent); socket.on("framereceived", received); socket.on("close", close); socket.on("socketerror", error)
    detach.push(() => { socket.off("framesent", sent); socket.off("framereceived", received); socket.off("close", close); socket.off("socketerror", error) })
  })
  page?.on("console", consoleMessage); page?.on("pageerror", pageError); page?.on("websocket", websocket)
  const observeEffect = <A, E, R>(kind: "handler" | "read-handler" | "direct-client", name: string, payload: unknown, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.suspend(() => {
      const start = performance.now(), raw = object(payload), detail = { operation: operation(name), correlation: correlation(raw.requestId),
        ...(name === "project.diff" ? { scope: raw.path === undefined ? "all" : "file" } : {}) }
      record(`${kind}-start`, detail)
      return effect.pipe(Effect.onExit((exit) => Effect.sync(() => guard(() => {
        const error = exit._tag === "Failure" ? Cause.findError(exit.cause) : undefined
        record(`${kind}-exit`, { ...detail, durationMs: performance.now() - start, exit: exit._tag,
          ...(exit._tag === "Success" ? resultMetadata(kind === "read-handler" ? object(exit.value).reply : exit.value)
            : { interrupted: Cause.hasInterrupts(exit.cause), defect: Cause.hasDies(exit.cause),
              ...(error?._tag === "Success" ? failure(error.success) : { errorTag: "interrupt-or-defect" }) }) })
      }))))
    })
  return {
    // Test-owned DOM observation only. The production App owns its provider,
    // watcher and GitSession; this neither imports nor reaches into them.
    async installDomObservation() {
      await page?.addInitScript(() => {
        let previous = "", emitted = 0
        const observe = () => {
          try {
            if (emitted >= 4000 || !document.querySelector(".git-workspace")) return
            const sync = document.querySelector("#git-sync-state"), refresh = document.querySelector<HTMLButtonElement>(".git-pane-head > button")
            const counts = /^(\d+) incoming · (\d+) outgoing(?: · No upstream)?$/.exec(sync?.textContent ?? "")
            const detail = { domSyncPresent: !!sync, domSyncParsed: !!counts,
              domIncoming: counts ? Number(counts[1]) : undefined, domOutgoing: counts ? Number(counts[2]) : undefined,
              domRefreshPresent: !!refresh, domRefreshDisabled: refresh?.disabled,
              domRefreshing: refresh?.textContent === "Refreshing…",
              renderedDiffFiles: document.querySelectorAll(".diff-file").length,
              comparisonLoading: !!document.querySelector(".diff-content [role=status]"),
              comparisonReadFailed: [...document.querySelectorAll(".diff-content [role=alert]")].some((element) => element.textContent?.startsWith("The Git read failed.")),
              comparisonFallback: !!document.querySelector(".git-diff-fallback") }
            const serialized = JSON.stringify(detail)
            if (serialized === previous) return
            previous = serialized; emitted++
            console.debug("W09_GIT_OBSERVATION " + JSON.stringify({ ...detail, trigger: "dom", browserUnixMs: Date.now(), browserElapsedMs: performance.now() }))
          } catch { /* Observation must not change application behavior. */ }
        }
        const mutations = new MutationObserver(observe)
        mutations.observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled"] })
      })
    },
    // Wrap the table actually passed to both buildServices and the listener.
    // Every original handler is invoked exactly once. Streams stay untouched.
    registeredReads(lists: EngineLists): EngineLists {
      return { ...lists, reads: Object.fromEntries(Object.entries(lists.reads).map(([name, actual]) => [name,
        operation(name) === "other" ? actual : ((input, payload) => {
          const result = actual(input, payload)
          return Effect.isEffect(result) ? observeEffect("read-handler", name, payload, result) : result
        }) satisfies EngineLists["reads"][string]
      ])) }
    },
    command<A, E, R>(name: string, payload: unknown, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
      return observeEffect("handler", name, payload, effect)
    },
    client<A, E, R>(name: string, payload: unknown, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
      return observeEffect("direct-client", name, payload, effect)
    },
    boundary(name: "fixture-start" | "fixture-prepared" | "body-start" | "body-end" | "fixture-scope-closing" | "fixture-scope-closed" | "rig-cleanup-start" | "rig-cleanup-end" | "direct-call-start" | "direct-call-settled", exit?: "Success" | "Failure") {
      record("boundary", { boundary: name, ...(exit === undefined ? {} : { exit }) })
    },
    finish() {
      page?.off("console", consoleMessage); page?.off("pageerror", pageError); page?.off("websocket", websocket)
      for (const stop of detach) stop()
      // An artifact-write error must not replace the original browser failure.
      try { writeFileSync(outputPath, JSON.stringify({ version: 1, dropped, observerErrors, events }, null, 2) + "\n") }
      catch { process.stderr.write("W09 passive observation artifact could not be written.\n") }
    }
  }
}
