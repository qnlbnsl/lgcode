import { connect } from "@lgcode/client/browser"
import { displayedState, type ClientSnapshot, type EventSequence, type RequestId } from "@lgcode/contracts"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

export type ConnectionState = "Connecting" | "Live" | "Reconnecting"
interface Observer {
  readonly onSnapshot: (snapshot: ClientSnapshot) => void
  readonly onConnection: (state: ConnectionState) => void
  readonly onSessionExpired: () => void
}
const requestId = () => crypto.randomUUID() as RequestId

// These changes affect more than a lifecycle label. Read a coherent snapshot
// for their counts, request holders and bounded roster fields instead of keeping
// a second implementation of the engine's projections in the browser.
const refreshTags = new Set([
  "AgentStarted", "AgentStartFailed", "SessionOpened", "AgentGrouped", "ModeChanged",
  "TurnStarted", "TurnEnded", "AgentCrashed", "AgentInterrupted", "AgentStopped", "AgentReloadFailed",
  "DeliverySent", "DeliveryHeld", "DeliveryReleased", "PermissionRequested", "PermissionAnswered",
  "PermissionCancelled", "PermissionMoved", "QuestionAsked", "QuestionAnswered", "QuestionMoved"
])

export async function watchSituation(observer: Observer, signal: AbortSignal): Promise<void> {
  let current: ClientSnapshot | undefined
  let after = 0 as EventSequence
  let ended = false
  let failures = 0
  const publish = (snapshot: ClientSnapshot) => {
    current = snapshot
    after = snapshot.sequence
    if (!signal.aborted) observer.onSnapshot(snapshot)
  }

  const program = Effect.gen(function* () {
    while (!ended) {
      yield* Effect.scoped(Effect.gen(function* () {
        const client = yield* connect({ url: `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api` })
        const refresh = (minimum = 0) => Effect.gen(function* () {
          for (;;) {
            const snapshot = yield* client["client.snapshot"]({ requestId: requestId() })
            if (snapshot.sequence >= minimum) {
              publish(snapshot)
              return
            }
            // Publication may lag the log. Do not acknowledge a control event
            // until the snapshot includes it.
            yield* Effect.sleep(25)
          }
        })
        if (current === undefined) yield* refresh()
        if (!signal.aborted) observer.onConnection("Live")
        yield* client["client.subscribe"]({ requestId: requestId(), after }).pipe(Stream.runForEach((item) => Effect.gen(function* () {
          if (item.sequence <= after) return
          if ("event" in item) {
            if (item.event._tag === "StateChanged" && current !== undefined) {
              const event = item.event
              publish({ ...current, sequence: item.sequence, agents: current.agents.map((agent) => {
                if (agent.agentId !== event.agentId) return agent
                const updated = { ...agent, state: event.state }
                return { ...updated, displayedState: displayedState(updated) }
              }) })
            } else if (refreshTags.has(item.event._tag)) {
              yield* refresh(item.sequence)
            }
          }
          // Checkpoints, unknown events and content-only markers also advance
          // the cursor. State markers are recovered by the browser client.
          after = Math.max(after, item.sequence) as EventSequence
          failures = 0
        })))
      })).pipe(Effect.catch((error) => Effect.gen(function* () {
        if (!signal.aborted) observer.onConnection("Reconnecting")
        // A browser's WebSocket error conceals an HTTP authentication refusal.
        // Probe the session rather than guessing from an error message.
        const response = yield* Effect.tryPromise(() => fetch("/api/session", {
          method: "POST", credentials: "same-origin", cache: "no-store", signal
        })).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (response?.status === 401) {
          ended = true
          current = undefined
          if (!signal.aborted) observer.onSessionExpired()
        }
        if (typeof error === "object" && error !== null && "_tag" in error && error._tag === "CommandError") {
          // The wire gives a fixed refusal for an invalid/ahead cursor. A new
          // snapshot is safe for any refused read and restores its log anchor.
          current = undefined
        }
      })))
      if (!ended) {
        if (!signal.aborted) observer.onConnection("Reconnecting")
        yield* Effect.sleep(Math.min(250 * 2 ** Math.min(failures++, 5), 5_000))
      }
    }
  })
  await Effect.runPromise(program, { signal }).catch(() => {
    // Never display transport exceptions, which may contain server data.
    if (!signal.aborted) observer.onConnection("Reconnecting")
  })
}
