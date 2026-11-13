// The live website's connection to the engine.
//
// This is the only file in the website that knows how the browser reaches the engine. It
// signs in through the engine's login route, reads `client.snapshot` over the existing
// browser client in @lgtm/client, and follows `client.subscribe`. It turns what it reads
// into the store's shape with the functions in mapping.ts, and hands the result to the
// website through the `open(write)` call that design/mock/js/engine.js describes.
//
// Step 3 of .plans/plans/connect-mock/plan.md replaces this file when the contract moves to
// gRPC. The reconnection loop follows packages/web/src/watchSituation.ts.
import { connect, type Client, type ClientEnvelope } from "@lgtm/client/browser"
import type { ClientSnapshot, EventSequence, RequestId } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { mapConnection, mapOwner, mapSnapshot, type ConnectionStatus, type EngineRecords, type StoreConn, type StoreOwner } from "./mapping.ts"

export type SessionStatus = "checking" | "in" | "out" | "rejected" | "expired" | "unavailable"
export interface StorePatch extends Partial<EngineRecords> {
  readonly chatEvent?: unknown
  readonly session?: { readonly status: SessionStatus; readonly firstRun: boolean }
  readonly conn?: StoreConn
  readonly owner?: StoreOwner
}
export type Write = (patch: StorePatch) => void

// The connection object that design/mock/js/app.js accepts in live mode.
export interface LiveConnection {
  readonly kind: "engine"
  readonly label: string
  request(tag: string, payload: object): Promise<unknown>
  call(tag: string, payload: unknown): void
  push(kind: string, payload: unknown): void
  open(write: Write): void
  signIn(password: string): Promise<"in" | "rejected" | "unavailable">
  signOut(): Promise<void>
  reconnect(): void
  close(): void
}

// The browser timings that step 3 compares before and after the move to gRPC.
export interface Timing {
  // How long the first `client.snapshot` call took, from the call to its decoded reply.
  snapshotMs?: number
  // How long after the subscription began the first pushed item arrived. This includes any
  // quiet time before the engine had something to push.
  firstPushMs?: number
  firstPushKind?: string
  // For the first pushed event: its arrival time less the time the engine recorded it at.
  // The engine and the browser read the same clock only when they run on one computer.
  firstPushDeliveryMs?: number
}

const requestId = () => crypto.randomUUID() as RequestId

// These events change more than one agent's lifecycle label, so a fresh snapshot is read.
// The list is the one packages/web/src/watchSituation.ts uses.
const refreshTags = new Set([
  "AgentStarted", "AgentStartFailed", "SessionOpened", "AgentGrouped", "ModeChanged",
  "TurnStarted", "TurnEnded", "AgentCrashed", "AgentInterrupted", "AgentStopped", "AgentReloadFailed",
  "DeliverySent", "DeliveryHeld", "DeliveryReleased", "PermissionRequested", "PermissionAnswered",
  "PermissionCancelled", "PermissionMoved", "QuestionAsked", "QuestionAnswered", "QuestionMoved", "board.PostWritten"
])
const needsRefresh = (tag: string) => refreshTags.has(tag) || tag.startsWith("project.") || tag.startsWith("client.Alert")

const emptyRecords: EngineRecords = { machines: [], subscriptions: [], repos: [], projects: [], teams: [], agents: [], requests: [], worktrees: [], sprints: [], tasks: [] }

export interface ConnectionOptions {
  // The page's own address. The engine serves the website and its API from one origin.
  readonly location?: Pick<Location, "protocol" | "host">
  readonly fetch?: typeof fetch
  readonly connect?: typeof connect
  readonly now?: () => number
  readonly clock?: () => number
  readonly debug?: (message: string) => void
}

export function engineConnection(options: ConnectionOptions = {}): LiveConnection {
  const where = options.location ?? location
  const http = options.fetch ?? ((input, init) => fetch(input, init))
  const open = options.connect ?? connect
  const now = options.now ?? Date.now
  const clock = options.clock ?? (() => performance.now())
  const debug = options.debug ?? ((message) => console.debug(message))
  const url = `${where.protocol === "https:" ? "wss:" : "ws:"}//${where.host}/api`
  const timing: Timing = {}

  let write: Write = () => {}
  let activeClient: Client | undefined
  let controller: AbortController | undefined
  let offlineTimer: ReturnType<typeof setTimeout> | undefined
  let closed = false

  const setConn = (status: ConnectionStatus) => {
    clearTimeout(offlineTimer)
    write({ conn: mapConnection(status, now()) })
    // A connection that stays down for 30 seconds is shown as offline, as on the old page.
    if (status === "reconnecting") offlineTimer = setTimeout(() => write({ conn: mapConnection("offline", now()) }), 30_000)
  }
  const setSession = (status: SessionStatus) => write({ session: { status, firstRun: false } })
  // Records leave the browser when the session ends, so no signed-out page keeps them.
  const forget = () => write({ ...emptyRecords, owner: mapOwner(undefined) })

  const post = async (path: string, body?: unknown): Promise<number | undefined> => {
    try {
      const response = await http(path, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      })
      return response.status
    } catch { return undefined }
  }

  const stop = () => { activeClient = undefined; controller?.abort(); controller = undefined }

  // Reads the snapshot, then follows the stream, until the session ends or the page closes.
  const follow = () => {
    stop()
    const signal = (controller = new AbortController()).signal
    let current: ClientSnapshot | undefined
    let after = 0 as EventSequence
    let ended = false
    let failures = 0
    const publish = (snapshot: ClientSnapshot) => {
      current = snapshot
      if (!signal.aborted) write(mapSnapshot(snapshot, now()))
    }
    const program = Effect.gen(function* () {
      while (!ended && !signal.aborted) {
        yield* Effect.scoped(Effect.gen(function* () {
          const client: Client = yield* open({ url })
          activeClient = client
          yield* Effect.addFinalizer(() => Effect.sync(() => { if (activeClient === client) activeClient = undefined }))
          const refresh = (minimum = 0) => Effect.gen(function* () {
            for (;;) {
              const started = clock()
              const snapshot = yield* client["client.snapshot"]({ requestId: requestId() })
              if (timing.snapshotMs === undefined) {
                timing.snapshotMs = clock() - started
                debug(`LGTM Studio: the snapshot took ${timing.snapshotMs.toFixed(1)} ms`)
              }
              if (snapshot.sequence >= minimum) { publish(snapshot); return }
              // Publication may lag the log. Read again until the snapshot holds the event.
              yield* Effect.sleep(25)
            }
          })
          if (current === undefined) {
            yield* refresh()
            after = (current as ClientSnapshot | undefined)?.sequence ?? after
          }
          if (!signal.aborted) setConn("live")
          // The owner's name is the one saved in the engine's settings, or else Git's
          // user.name, read once for each connection. The current page reads it the same way.
          const settings = yield* client["project.settings"]({ requestId: requestId() }).pipe(Effect.option)
          const name = settings._tag === "Some" ? settings.value.settings?.displayName ?? settings.value.ownerNameSuggestion : undefined
          if (!signal.aborted) write({ owner: mapOwner(name) })
          const subscribed = clock()
          yield* client["client.subscribe"]({ requestId: requestId(), after }).pipe(Stream.runForEach((item) => Effect.gen(function* () {
            if (timing.firstPushMs === undefined) {
              timing.firstPushMs = clock() - subscribed
              timing.firstPushKind = "event" in item ? item.event._tag : item._tag
              if ("event" in item) timing.firstPushDeliveryMs = now() - item.occurredAt
              debug(`LGTM Studio: the first pushed update arrived ${timing.firstPushMs.toFixed(1)} ms after subscribing (${timing.firstPushKind})`
                + (timing.firstPushDeliveryMs === undefined ? "" : `, ${timing.firstPushDeliveryMs} ms after the engine recorded it`))
            }
            if (item.sequence <= after) return
            if (!signal.aborted) write({ chatEvent: item })
            if ("event" in item) yield* apply(item, refresh)
            else if (item._tag === "client.Oversized" && needsRefresh(item.tag)) yield* refresh(item.sequence)
            after = Math.max(after, item.sequence) as EventSequence
            failures = 0
          })))
        })).pipe(Effect.catch((error) => Effect.gen(function* () {
          if (signal.aborted) return
          setConn("reconnecting")
          // A browser hides an HTTP refusal of a WebSocket. Ask the session route instead.
          const status = yield* Effect.promise(() => post("/api/session"))
          if (status === 401) { ended = true; current = undefined; forget(); setSession("expired") }
          // A refused cursor needs a fresh snapshot to anchor the stream again.
          if (typeof error === "object" && error !== null && "_tag" in error && error._tag === "CommandError") current = undefined
        })))
        if (!ended && !signal.aborted) yield* Effect.sleep(Math.min(250 * 2 ** Math.min(failures++, 5), 5_000))
      }
    })
    // A pushed event either changes one agent's state in place or asks for a fresh snapshot.
    const apply = (item: ClientEnvelope, refresh: (minimum?: number) => Effect.Effect<void, unknown>) => Effect.gen(function* () {
      const event = item.event
      if (event._tag === "StateChanged" && current !== undefined && item.sequence > current.sequence) {
        publish({ ...current, sequence: item.sequence, agents: current.agents.map((agent) => agent.agentId === event.agentId ? { ...agent, state: event.state } : agent) })
      } else if (needsRefresh(event._tag)) yield* refresh(item.sequence)
    })
    void Effect.runPromise(program, { signal }).catch(() => { if (!signal.aborted) setConn("reconnecting") })
  }

  const check = async () => {
    const status = await post("/api/session")
    if (closed) return
    if (status === 204) { setSession("in"); follow() }
    else if (status === undefined || status >= 500) setSession("unavailable")
    else setSession("out")
  }

  return {
    kind: "engine",
    label: "the service",
    // Sending changes to the engine is step 2 of the plan. Until then the website refuses
    // each action before it reaches this point.
    async request(tag, payload) {
      if (closed || activeClient === undefined || controller === undefined || controller.signal.aborted) throw new Error("The service is not connected.")
      const signal = controller.signal
      const client = activeClient
      try {
        return await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const method = (client as unknown as Record<string, (payload: object) => Effect.Effect<unknown, { reason?: string }>>)[tag]
          if (typeof method !== "function") return yield* Effect.fail(new Error(`Unknown request: ${tag}`))
          return yield* method({ ...payload, requestId: requestId() }).pipe(Effect.mapError((error) => new Error(error.reason ?? String(error))))
        })), { signal })
      } catch (error) { throw error instanceof Error ? error : new Error(String(error)) }
    },
    call() {},
    push() {},
    open(next) {
      write = next
      setSession("checking")
      setConn("reconnecting")
      void check()
    },
    async signIn(password) {
      const status = await post("/api/login", { password })
      if (status === 204) { setSession("in"); follow(); return "in" }
      if (status === undefined || status >= 500) { setSession("unavailable"); return "unavailable" }
      setSession("rejected")
      return "rejected"
    },
    async signOut() {
      stop()
      await post("/api/logout")
      forget()
      setSession("out")
    },
    reconnect() { if (!closed) void check() },
    close() { closed = true; stop(); clearTimeout(offlineTimer) }
  }
}
