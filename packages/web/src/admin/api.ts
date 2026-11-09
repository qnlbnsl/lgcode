import { useCallback, useEffect, useRef, useState } from "react"
import { connect, type Client } from "@lgcode/client/browser"
import type { RequestId } from "@lgcode/contracts"
import * as Effect from "effect/Effect"

export const requestId = () => crypto.randomUUID() as RequestId

// A typed refusal is conclusive. A transport failure can follow a committed
// command and must retain its request identity for receipt recovery.
export const commandOutcome = <A, E,>(operation: Effect.Effect<A, E>) => Effect.gen(function* () {
  const result = yield* Effect.result(operation)
  if (result._tag === "Success") return { _tag: "acknowledged" as const, value: result.success }
  const failure = result.failure
  if (typeof failure === "object" && failure !== null && "_tag" in failure && failure._tag === "CommandError") return { _tag: "refused" as const }
  return yield* Effect.fail(failure)
})

// Each operation owns a socket scope. Leaving the page cancels its pending
// reads and commands, and releases the sockets even when a request fails.
export function useAdminApi(onSessionExpired: () => void) {
  const controller = useRef<AbortController | undefined>(undefined)
  const expired = useRef(onSessionExpired)
  expired.current = onSessionExpired
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => () => {
    controller.current?.abort()
    controller.current = undefined
  }, [])

  const run = useCallback(async <A,>(operation: (client: Client) => Effect.Effect<A, unknown>): Promise<A | undefined> => {
    if (controller.current !== undefined) return undefined
    const action = new AbortController()
    controller.current = action
    setBusy(true)
    setMessage("")
    try {
      const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const client = yield* connect({ url: `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api` })
        return yield* operation(client)
      })), { signal: action.signal })
      return action.signal.aborted ? undefined : result
    } catch {
      if (!action.signal.aborted) {
        // Never render a transport exception or a secret-setting payload.
        setMessage("Could not complete the request. Check the connection and try again.")
        try {
          const response = await fetch("/api/session", {
            method: "POST", credentials: "same-origin", cache: "no-store", signal: action.signal
          })
          if (!action.signal.aborted && response.status === 401) expired.current()
        } catch { /* Keep the fixed connection message. */ }
      }
      return undefined
    } finally {
      if (!action.signal.aborted) {
        controller.current = undefined
        setBusy(false)
      }
    }
  }, [])

  return { run, busy, message, setMessage }
}
