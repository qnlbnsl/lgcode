import { createContext, useCallback, useContext, useEffect, useRef, useState, useMemo, useSyncExternalStore, type ReactNode } from "react"
import type { Alert, ClientRequest, ClientSnapshot, EventSequence } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import { requestId, withClient } from "../thread/client.ts"
import { watchSituation, type ConnectionState } from "../watchSituation.ts"
import { readNavigation, type NavigationData } from "./projectReads.ts"
import { createRequestSources, type RequestSources } from "./requestSources.ts"

import { ConversationSession, conversationKey, type ConversationIdentity } from "../thread/conversationState.tsx"

export interface ShellData {
  readonly conversations: ConversationSession
  readonly snapshot?: ClientSnapshot
  readonly navigation?: NavigationData
  readonly requests?: ReadonlyArray<ClientRequest>
  readonly alerts?: ReadonlyArray<Alert>
  readonly complete: boolean
  readonly connection: ConnectionState | "Offline"
  readonly lastUpdated?: number
  readonly retry: () => void
  readonly onSessionExpired: () => void
  readonly requestSources: RequestSources
}
const ShellContext = createContext<ShellData | undefined>(undefined)
const MutationContext = createContext(false)
export const useMutationDisabled = () => useContext(MutationContext)
export const MutationProvider = MutationContext.Provider
export function useShellData() {
  const value = useContext(ShellContext)
  if (value === undefined) throw new Error("ShellDataProvider is required")
  return value
}

export function useConversation(identity: ConversationIdentity) {
  const session = useShellData().conversations
  const key = conversationKey(identity)
  const entry = useMemo(() => session.entry(identity), [session, key])
  const state = useSyncExternalStore(entry.subscribe, entry.snapshot)
  return { session, entry, state }
}

export function ShellDataProvider({ children, onSessionExpired }: { readonly children: ReactNode; readonly onSessionExpired: () => void }) {
  const [snapshot, setSnapshot] = useState<ClientSnapshot>()
  const [connection, setConnection] = useState<ConnectionState | "Offline">("Connecting")
  const [lastUpdated, setLastUpdated] = useState<number>()
  const [reads, setReads] = useState<{ navigation: NavigationData; requests: ReadonlyArray<ClientRequest>; alerts: ReadonlyArray<Alert> }>()
  const [revision, setRevision] = useState<{ snapshot: ClientSnapshot; generation: number }>()
  const [snapshotGeneration, setSnapshotGeneration] = useState(-1)
  const [generation, setGeneration] = useState(0)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [requestSources] = useState(createRequestSources)
  const [conversations] = useState(() => new ConversationSession())
  const complete = online && revision?.snapshot === snapshot && revision?.generation === generation
  const expired = useRef(onSessionExpired)
  expired.current = onSessionExpired
  const ended = useRef(false)
  const onlineNow = useRef(online)
  const failures = useRef(0)
  const pendingRead = useRef<AbortController | undefined>(undefined)
  const stopRead = useCallback(() => pendingRead.current?.abort(), [])
  const endSession = useCallback(() => {
    ended.current = true
    stopRead()
    requestSources.close(); conversations.dispose()
    expired.current()
  }, [requestSources, conversations, stopRead])
  const retry = useCallback(() => {
    if (ended.current || !onlineNow.current) return
    stopRead()
    setGeneration((value) => value + 1)
  }, [stopRead])
  useEffect(() => () => { ended.current = true; stopRead(); requestSources.close(); conversations.dispose() }, [requestSources, conversations, stopRead])
  useEffect(() => {
    const offline = () => { onlineNow.current = false; stopRead(); setOnline(false); setRevision(undefined); setConnection("Offline") }
    const online = () => {
      if (ended.current) return
      onlineNow.current = true
      retry(); setOnline(true); setRevision(undefined); setConnection("Reconnecting")
    }
    window.addEventListener("offline", offline); window.addEventListener("online", online)
    return () => { window.removeEventListener("offline", offline); window.removeEventListener("online", online) }
  }, [retry, stopRead])
  useEffect(() => {
    if (ended.current) return
    if (!online) { setConnection("Offline"); return }
    const controller = new AbortController()
    setConnection((state) => state === "Connecting" ? state : "Reconnecting")
    void watchSituation({ onSnapshot: (value) => { stopRead(); setSnapshot(value); setSnapshotGeneration(generation); setLastUpdated(Date.now()) }, onConnection: setConnection,
      onEnvelope: requestSources.remember, onSessionExpired: endSession }, controller.signal)
    return () => controller.abort()
  }, [generation, online, requestSources, endSession, stopRead])
  useEffect(() => {
    if (connection !== "Reconnecting") return
    const timer = setTimeout(() => setConnection("Offline"), 30_000)
    return () => clearTimeout(timer)
  }, [connection])
  useEffect(() => {
    if (ended.current || snapshot === undefined || !online || snapshotGeneration !== generation) return
    const controller = new AbortController()
    pendingRead.current = controller
    let recovery: ReturnType<typeof setTimeout> | undefined
    controller.signal.addEventListener("abort", () => clearTimeout(recovery), { once: true })
    setRevision(undefined)
    void withClient((client) => Effect.gen(function* () {
      // All paged reads must belong to this unchanged engine revision. There
      // is no multi-call revision token; a changed log requires another read.
      const initial = snapshot
      const navigation = yield* readNavigation(client, initial)
      const requests: ClientRequest[] = []
      let after = 0 as EventSequence
      for (;;) {
        const page = yield* client["client.requests"]({ requestId: requestId(), after, limit: 200 })
        if (page.sequence !== initial.sequence) return yield* Effect.fail(new Error("Request revision changed"))
        requests.push(...page.items)
        if (page.next === undefined) break
        if (!page.items.length || page.next <= after) return yield* Effect.fail(new Error("Request cursor did not advance"))
        after = page.next
      }
      const alerts: Alert[] = []
      after = 0 as EventSequence
      for (;;) {
        const page = yield* client["client.alerts.list"]({ requestId: requestId(), after, limit: 200 })
        alerts.push(...page.items)
        if (page.next === undefined) break
        if (!page.items.length || page.next <= after) return yield* Effect.fail(new Error("Alert cursor did not advance"))
        after = page.next
      }
      const final = yield* client["client.sequence"]({ requestId: requestId() })
      if (final.sequence !== initial.sequence) return yield* Effect.fail(new Error("Projection revision changed"))
      return { navigation, requests, alerts }
    }), controller.signal).then((value) => {
      if (!controller.signal.aborted) { failures.current = 0; setReads(value); setRevision({ snapshot, generation }) }
    }).catch(() => {
      // Retain the previous complete collections. An unavailable read is never
      // an empty tree, zero requests, or evidence that setup is complete.
      // A quiet stream may never replace an incompatible snapshot. Restart
      // the existing watcher for a fresh anchor, with a bounded backoff.
      if (!controller.signal.aborted && !ended.current && onlineNow.current) {
        const delay = Math.min(250 * 2 ** Math.min(failures.current++, 5), 5_000)
        recovery = setTimeout(() => {
          if (!controller.signal.aborted) retry()
        }, delay)
      }
    })
    return () => controller.abort()
  }, [snapshot, snapshotGeneration, generation, online, retry])
  return <ShellContext.Provider value={{ ...(snapshot === undefined ? {} : { snapshot }), ...reads, complete, connection,
    ...(lastUpdated === undefined ? {} : { lastUpdated }), onSessionExpired: endSession, retry, requestSources, conversations }}>
    <MutationProvider value={!online || connection !== "Live" || !complete}>{children}</MutationProvider>
  </ShellContext.Provider>
}
