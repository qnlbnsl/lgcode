// TEMP-OBSERVE: this entire test-only file is removed before final source.
// Persist only fixed operation/phase labels, numeric correlation, counts and timestamps.
import { writeFileSync } from "node:fs"
import type { Page } from "@playwright/test"
import * as Effect from "effect/Effect"
import type { EngineLists } from "../../engine/src/pieces/lists.ts"

export function observeGit(page: Page, output: string) {
  const started = performance.now(), events: object[] = [], ids = new Map<string, number>(), detach: (() => void)[] = []
  let dropped = 0
  const selected = new Set(["project.git.state", "project.changes", "project.diff", "project.stage.all", "project.unstage.all", "project.discard", "project.commit", "project.fetch", "project.pull", "project.push"])
  const record = (phase: string, detail: object = {}) => { if (events.length < 500) events.push({ phase, ms: performance.now() - started, ...detail }); else dropped++ }
  const correlation = (payload: unknown) => {
    const id = typeof payload === "object" && payload !== null && "requestId" in payload ? payload.requestId : undefined
    if (typeof id !== "string") return undefined
    if (!ids.has(id)) { if (ids.size >= 500) return undefined; ids.set(id, ids.size + 1) }
    return ids.get(id)
  }
  const observe = <A, E, R>(name: string, payload: unknown, effect: Effect.Effect<A, E, R>) => Effect.suspend(() => {
    if (!selected.has(name)) return effect
    const call = correlation(payload); record("handler-entry", { name, call })
    return effect.pipe(Effect.onExit((exit) => Effect.sync(() => record("handler-exit", { name, call, exit: exit._tag }))))
  })
  page.on("websocket", (socket) => {
    const calls = new Map<string, { name: string; call: number | undefined }>()
    const frame = (direction: "sent" | "received") => ({ payload }: { payload: string | Buffer }) => {
      try {
        const raw: unknown = JSON.parse(String(payload))
        for (const value of Array.isArray(raw) ? raw : [raw]) {
          if (typeof value !== "object" || value === null) continue
          if (value._tag === "Request" && selected.has(value.tag)) {
            const detail = { name: value.tag as string, call: correlation(value.payload) }
            calls.set(String(value.id), detail); record("wire-request", detail)
          } else if (value._tag === "Exit") {
            const detail = calls.get(String(value.requestId))
            if (detail) { record("wire-exit", { ...detail, direction, exit: value.exit?._tag === "Success" ? "Success" : "Failure" }); calls.delete(String(value.requestId)) }
          }
        }
      } catch { /* Unparsed frames are never logged. */ }
    }
    const sent = frame("sent"), received = frame("received")
    socket.on("framesent", sent); socket.on("framereceived", received)
    detach.push(() => { socket.off("framesent", sent); socket.off("framereceived", received) })
  })
  return {
    command: observe,
    boundary: (phase: string) => record(phase),
    registeredReads(lists: EngineLists): EngineLists {
      return { ...lists, reads: Object.fromEntries(Object.entries(lists.reads).map(([name, actual]) => [name,
        selected.has(name) ? ((input, payload) => { const result = actual(input, payload); return Effect.isEffect(result) ? observe(name, payload, result) : result }) satisfies EngineLists["reads"][string] : actual
      ])) }
    },
    async dom() {
      try { record("body-exit-dom", await page.locator(".git-workspace").evaluate((root) => {
        const notice = root.querySelector("#git-notice")?.textContent ?? "", alert = root.querySelector('[role="alert"]')?.textContent ?? ""
        const counts = /^(\d+) incoming · (\d+) outgoing/.exec(root.querySelector("#git-sync-state")?.textContent ?? "")
        return { refreshing: [...root.querySelectorAll("button")].some((button) => button.textContent === "Refreshing…"),
          incoming: counts ? Number(counts[1]) : undefined, outgoing: counts ? Number(counts[2]) : undefined,
          staged: root.querySelectorAll('[aria-label="Staged changes"] .source-file').length,
          stageAck: notice === "All available nonconflicting files staged.", pullAck: notice === "pull completed.",
          uncertain: alert.includes("acknowledgment is unconfirmed"), terminal: alert.includes("does not establish") }
      })) } catch { record("dom-unavailable") }
    },
    finish() { detach.forEach((stop) => stop()); try { writeFileSync(output, JSON.stringify({ events, dropped }, null, 2)) } catch { process.stderr.write("TEMP-OBSERVE artifact write failed\n") } }
  }
}
