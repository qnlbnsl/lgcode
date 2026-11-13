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
import { displayedState, type ClientSnapshot, type EventSequence, type RequestId } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as board from "./board.ts"
import { mapConnection, mapOwner, mapSnapshot, type ConnectionStatus, type EngineRecords, type StoreConn, type StoreOwner } from "./mapping.ts"

export type SessionStatus = "checking" | "in" | "out" | "rejected" | "expired" | "unavailable" | "logout-unconfirmed"
export interface StorePatch extends Partial<EngineRecords> {
  readonly chatEvent?: unknown
  readonly session?: { readonly status: SessionStatus; readonly firstRun: boolean }
  readonly conn?: StoreConn
  readonly owner?: StoreOwner
  readonly boardUnread?: Record<string, number>
  readonly boardRevision?: number
  readonly boardDetails?: object
  readonly channels?: ReturnType<typeof board.snapshotChannels>
  readonly posts?: ReadonlyArray<ReturnType<typeof board.mapPost>>
  readonly taskDetails?: object
  readonly boardAgents?: object
  readonly setupData?: object | null
}
export type Write = (patch: StorePatch) => void

// The connection object that design/mock/js/app.js accepts in live mode.
export interface LiveConnection {
  readonly kind: "engine"
  readonly label: string
  readonly board: typeof board
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
  "AgentConfigurationChosen", "AgentConfigurationApplied", "AgentConfigurationRefused", "PermissionCancelled", "PermissionMoved", "QuestionAsked", "QuestionAnswered", "QuestionMoved", "board.PostWritten",
  "AccountChanged", "AccountNeedsSignIn", "AccountAvailable"
])
const needsRefresh = (tag: string) => refreshTags.has(tag) || tag.startsWith("board.") || tag.startsWith("project.") || tag.startsWith("roles.") || tag.startsWith("client.Alert")

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
  let controller: AbortController | undefined
  let offlineTimer: ReturnType<typeof setTimeout> | undefined
  let sessionAttempt = 0
  let closed = false
  let activeClient: Client | undefined
  let boardRevision = 0
  let lastHeard = 0
  let connectionStatus: ConnectionStatus = "reconnecting"

  const setConn = (status: ConnectionStatus) => {
    if (status === "live") {
      clearTimeout(offlineTimer)
      offlineTimer = undefined
      lastHeard = now()
    } else if (connectionStatus === "offline") status = "offline"
    connectionStatus = status
    write({ conn: mapConnection(status, lastHeard) })
    // Retries share one outage deadline, and never count as contact with the service.
    if (status === "reconnecting" && offlineTimer === undefined) offlineTimer = setTimeout(() => setConn("offline"), 30_000)
  }
  const setSession = (status: SessionStatus) => write({ session: { status, firstRun: false } })
  // Records leave the browser when the session ends, so no signed-out page keeps them.
  const forget = () => write({ ...emptyRecords, owner: mapOwner(undefined), channels: [], posts: [], taskDetails: {}, boardAgents: {}, setupData: null, boardUnread: {}, boardRevision: 0, boardDetails: {} })

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
      const records = board.mapBoardRecords(snapshot, mapSnapshot(snapshot, now()))
      if (!signal.aborted) write({ ...records, channels: board.snapshotChannels(snapshot, records), boardUnread: board.mapUnread(snapshot.board), boardRevision, boardDetails: board.mapStalls(snapshot.roles),
        session: { status: "in", firstRun: snapshot.project?.setup !== undefined && snapshot.project.setup.completedAt === undefined } })
    }
    const program = Effect.gen(function* () {
      while (!ended && !signal.aborted) {
        yield* Effect.scoped(Effect.gen(function* () {
          const client: Client = yield* open({ url })
          activeClient = client
          yield* Effect.addFinalizer(() => Effect.sync(() => { if (activeClient === client) activeClient = undefined }))
          // The snapshot is bounded. Page its navigation records when its project
          // section was cut short, and retry if the log changed during that read.
          const hydrate = (snapshot: ClientSnapshot) => Effect.gen(function* () {
            if (!snapshot.project?.truncated) return snapshot
            const pageAll = (tag: "project.repositories" | "project.workspaces" | "project.read", payload: object) => Effect.gen(function* () {
              const items: unknown[] = [], cursors = new Set<string>()
              let after: string | undefined
              for (;;) {
                const reply = yield* client[tag]({ ...payload, requestId: requestId(), limit: 200, ...(after === undefined ? {} : { after }) } as never)
                if (!("items" in reply)) return yield* Effect.fail(new Error("Project records unavailable"))
                items.push(...reply.items)
                if (reply.next === undefined) return items
                if (!reply.items.length || cursors.has(reply.next)) return yield* Effect.fail(new Error("Project cursor did not advance"))
                cursors.add(reply.next); after = reply.next
              }
            })
            const repositories = yield* pageAll("project.repositories", {})
            const workspaces = yield* pageAll("project.workspaces", {})
            const projects = yield* pageAll("project.read", { collection: "projects" })
            const teams = yield* pageAll("project.read", { collection: "teams" })
            const sprints = yield* pageAll("project.read", { collection: "sprints" })
            const tasks = yield* pageAll("project.read", { collection: "tasks" })
            const agents = yield* pageAll("project.read", { collection: "agents" })
            const end = yield* client["client.sequence"]({ requestId: requestId() })
            if (end.sequence !== snapshot.sequence) return undefined
            return { ...snapshot, project: { ...snapshot.project, truncated: false, repositories, workspaces, projects, teams, sprints, tasks, agents } } as ClientSnapshot
          })
          const refresh = (minimum = 0) => Effect.gen(function* () {
            for (;;) {
              const started = clock()
              const snapshot = yield* client["client.snapshot"]({ requestId: requestId() })
              if (timing.snapshotMs === undefined) {
                timing.snapshotMs = clock() - started
                debug(`LGTM Studio: the snapshot took ${timing.snapshotMs.toFixed(1)} ms`)
              }
              if (snapshot.sequence >= minimum) { const complete = yield* hydrate(snapshot); if (complete !== undefined) { publish(complete); return } }
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
          // user.name. Refresh it when settings change as well as on connection.
          const refreshOwner = () => Effect.gen(function* () {
            const settings = yield* client["project.settings"]({ requestId: requestId() }).pipe(Effect.option)
            const name = settings._tag === "Some" ? settings.value.settings?.displayName ?? settings.value.ownerNameSuggestion : undefined
            if (!signal.aborted) write({ owner: mapOwner(name) })
          })
          yield* refreshOwner()
          const subscribed = clock()
          yield* client["client.subscribe"]({ requestId: requestId(), after }).pipe(Stream.runForEach((item) => Effect.gen(function* () {
            if (timing.firstPushMs === undefined) {
              timing.firstPushMs = clock() - subscribed
              timing.firstPushKind = "event" in item ? item.event._tag : item._tag
              if ("event" in item) timing.firstPushDeliveryMs = now() - item.occurredAt
              debug(`LGTM Studio: the first pushed update arrived ${timing.firstPushMs.toFixed(1)} ms after subscribing (${timing.firstPushKind})`
                + (timing.firstPushDeliveryMs === undefined ? "" : `, ${timing.firstPushDeliveryMs} ms after the engine recorded it`))
            }
            if (signal.aborted) return
            setConn("live")
            if (item.sequence <= after) return
            if (!signal.aborted) write({ chatEvent: item })
            if ("event" in item) {
              if (item.event._tag === "project.SettingsChanged") yield* refreshOwner()
              yield* apply(item, refresh)
            }
            else if (item._tag === "client.Oversized" && needsRefresh(item.tag)) yield* refresh(item.sequence)
            after = Math.max(after, item.sequence) as EventSequence
            failures = 0
          })))
        })).pipe(Effect.catch((error) => Effect.gen(function* () {
          if (signal.aborted) return
          activeClient = undefined
          setConn("reconnecting")
          // A browser hides an HTTP refusal of a WebSocket. Ask the session route instead.
          const status = yield* Effect.promise(() => post("/api/session"))
          if (signal.aborted) return
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
      if (event._tag.startsWith("project.") || event._tag.startsWith("board.") && event._tag !== "board.Read") boardRevision++
      if (event._tag === "StateChanged" && current !== undefined && item.sequence > current.sequence) {
        publish({ ...current, sequence: item.sequence, agents: current.agents.map((agent) => {
          if (agent.agentId !== event.agentId) return agent
          const updated = { ...agent, state: event.state }
          return { ...updated, displayedState: displayedState(updated) }
        }) })
      } else if (needsRefresh(event._tag)) yield* refresh(item.sequence)
    })
    void Effect.runPromise(program, { signal }).catch(() => { if (!signal.aborted) setConn("reconnecting") })
  }

  const check = async () => {
    const attempt = ++sessionAttempt
    const status = await post("/api/session")
    if (closed || attempt !== sessionAttempt) return
    if (status === 204) { setSession("in"); follow() }
    else if (status === undefined || status >= 500) setSession("unavailable")
    else setSession("out")
  }

  return {
    kind: "engine",
    label: "the service",
    board,
    async request(tag, payload) {
      const client = activeClient
      if (closed || client === undefined || controller?.signal.aborted) throw new Error("The service is not connected.")
      const method = (client as unknown as Record<string, (payload: object) => Effect.Effect<unknown, unknown>>)[tag]
      if (method === undefined) throw new Error("This request is not available.")
      const result = await Effect.runPromise(Effect.result(method({ ...payload, requestId: requestId() })), { signal: controller!.signal })
      if (result._tag === "Success") return result.success
      const error = result.failure
      throw new Error(typeof error === "object" && error !== null && "reason" in error && typeof error.reason === "string" ? error.reason : "The service could not confirm the request.")
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
      const attempt = ++sessionAttempt
      const status = await post("/api/login", { password })
      if (closed || attempt !== sessionAttempt) return "unavailable"
      if (status === 204) { setSession("in"); follow(); return "in" }
      if (status === undefined || status >= 500) { setSession("unavailable"); return "unavailable" }
      setSession("rejected")
      return "rejected"
    },
    async signOut() {
      const attempt = ++sessionAttempt
      stop()
      clearTimeout(offlineTimer)
      offlineTimer = undefined
      forget()
      setSession("checking")
      const status = await post("/api/logout")
      if (closed || attempt !== sessionAttempt) return
      setSession(status === 204 ? "out" : "logout-unconfirmed")
    },
    reconnect() { if (!closed) void check() },
    close() { closed = true; sessionAttempt++; stop(); clearTimeout(offlineTimer) }
  }
}
