import type { ClientEnvelope } from "@shephrd/client/browser"
import { contentOnlyEventTags, type AgentId, type ClientSnapshot, type EventSequence, type Oversized } from "@shephrd/contracts"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { connectBrowser, requestId } from "./client.ts"
import type { ConnectionState } from "../watchSituation.ts"

export type ThreadItem = ClientEnvelope | typeof Oversized.Type
export interface ThreadState {
  readonly snapshot?: ClientSnapshot
  readonly items: ReadonlyArray<ThreadItem>
  readonly connection: ConnectionState
  readonly loaded: boolean
}

export async function watchThread(
  agentId: AgentId, changed: (state: ThreadState) => void, expired: () => void, signal: AbortSignal
) {
  let snapshot: ClientSnapshot | undefined
  const items = new Map<string, ThreadItem>()
  let after = 0 as EventSequence
  let loaded = false
  let ended = false
  let failures = 0
  const publish = (connection: ConnectionState) => {
    if (!signal.aborted) changed({ ...(snapshot === undefined ? {} : { snapshot }),
      items: [...items.values()].sort((a, b) => a.sequence - b.sequence), loaded, connection })
  }
  const put = (item: ThreadItem) => {
    if ("event" in item) {
      const target = item.event._tag === "DeliveryQueued" ? item.event.delivery.target
        : "agentId" in item.event ? item.event.agentId : item.agentId
      if (target === agentId) items.set(`${item.sequence}:${item.event._tag}`, item)
    } else if (item.agentId === agentId && contentOnlyEventTags.some((tag) => tag === item.tag)
      && !([...items.values()].some((entry) => entry.sequence === item.sequence && "event" in entry))) items.set(`${item.sequence}:${item.tag}`, item)
  }

  await Effect.runPromise(Effect.gen(function* () {
    while (!ended) {
      yield* Effect.scoped(Effect.gen(function* () {
        const client = yield* connectBrowser()
        const refresh = (minimum = 0) => Effect.gen(function* () {
          for (;;) {
            const next = yield* client["client.snapshot"]({ requestId: requestId() })
            if (next.sequence < minimum) { yield* Effect.sleep(25); continue }
            // Snapshot rows are identities, not approval context. Recover each
            // missing request event automatically, including oversized ones.
            for (const row of [...next.requests, ...next.questions]) {
              if (row.agentId !== agentId || [...items.values()].some((entry) => entry.sequence === row.sourceSequence && "event" in entry)) continue
              const reply = yield* client["client.event"]({ requestId: requestId(), sequence: row.sourceSequence })
              if ("envelope" in reply) put(reply.envelope)
            }
            snapshot = next
            return
          }
        })
        if (!loaded) {
          // Anchor the subscription before reading history. Later events in a
          // history page can safely replay, because entries are keyed by sequence.
          const initial = yield* client["client.snapshot"]({ requestId: requestId() })
          snapshot = initial
          after = initial.sequence
          let cursor = 0 as EventSequence
          for (;;) {
            const page = yield* client["client.thread"]({ requestId: requestId(), agentId, after: cursor, limit: 100 })
            if (!("items" in page)) return yield* Effect.fail(new Error("Thread page unavailable"))
            for (const item of page.items) put(item)
            if (page.next === undefined) break
            if (page.next <= cursor) return yield* Effect.fail(new Error("Thread cursor did not advance"))
            cursor = page.next
          }
          yield* refresh(initial.sequence)
          loaded = true
        } else yield* refresh(after)
        failures = 0
        publish("Live")
        yield* client["client.subscribe"]({ requestId: requestId(), after, filter: { agents: [agentId] } }).pipe(
          Stream.runForEach((item) => Effect.gen(function* () {
            if (item.sequence <= after) return
            if ("event" in item) {
              put(item)
              if (item.event._tag !== "ThreadItem" && item.event._tag !== "UnknownEvent") yield* refresh(item.sequence)
            } else if (item._tag === "client.Oversized") {
              if (contentOnlyEventTags.some((tag) => tag === item.tag)) put(item)
              else {
                // Snapshot rows cannot recover closed answers or delivery
                // sources. Read display events by sequence before advancing
                // the stream cursor, including unscoped DeliveryQueued.
                if (item.tag.startsWith("Delivery") || item.tag === "AgentStarted" || item.tag === "QuestionAsked"
                  || item.tag === "PermissionRequested" || item.tag === "QuestionAnswered" || item.tag === "PermissionAnswered") {
                  const reply = yield* client["client.event"]({ requestId: requestId(), sequence: item.sequence })
                  if ("envelope" in reply) put(reply.envelope)
                }
                yield* refresh(item.sequence)
              }
            }
            // A newer snapshot must not move the thread cursor past content
            // that is still queued on the stream connection.
            after = item.sequence
            publish("Live")
          }))
        )
      })).pipe(Effect.catch((error) => Effect.gen(function* () {
        publish("Reconnecting")
        const response = yield* Effect.tryPromise(() => fetch("/api/session", {
          method: "POST", credentials: "same-origin", cache: "no-store", signal
        })).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (response?.status === 401) {
          ended = true
          items.clear()
          snapshot = undefined
          if (!signal.aborted) expired()
        } else if (typeof error === "object" && error !== null && "_tag" in error && error._tag === "CommandError") {
          loaded = false
          items.clear()
          snapshot = undefined
        }
      })))
      if (!ended) {
        publish("Reconnecting")
        yield* Effect.sleep(Math.min(250 * 2 ** Math.min(failures++, 5), 5_000))
      }
    }
  }), { signal }).catch(() => { if (!signal.aborted) publish("Reconnecting") })
}
