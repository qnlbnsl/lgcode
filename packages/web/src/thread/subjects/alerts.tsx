import { useEffect, useState } from "react"
import type { AgentId, Alert, AlertKind, EventSequence } from "@sheprd/contracts"
import * as Effect from "effect/Effect"
import { requestId, withClient } from "../client.ts"
import { SubjectPanel } from "./index.tsx"

// Carrier links contain only an agent id. Resolve their subjects with a pure
// metadata read; board.read, which writes marks, still requires a tap.
export function AlertSubjects({ agentId, subject, sequence }: {
  readonly agentId: AgentId; readonly subject?: string; readonly sequence?: number
}) {
  const [alerts, setAlerts] = useState<ReadonlyArray<Alert>>([])
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void withClient((client) => Effect.gen(function* () {
      const found: Alert[] = []
      let after = 0 as EventSequence
      for (;;) {
        const page = yield* client["client.alerts.list"]({ requestId: requestId(), after, limit: 100, status: "open" })
        found.push(...page.items.filter((row) => row.agentId === agentId && row.subject?._tag === "piece"))
        if (page.next === undefined) return found
        if (page.next <= after) return yield* Effect.fail(new Error("Alert cursor did not advance"))
        after = page.next
      }
    }), controller.signal).then((found) => {
      if (controller.signal.aborted) return
      setFailed(false)
      // Keep an opened entry when its alert clears, so the owner's reply and
      // the post's closed state remain visible after a successful answer.
      setAlerts((previous) => [...previous.filter((old) => !found.some((row) => row.alertId === old.alertId)), ...found])
    }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [agentId, sequence, retry])
  const subjects = new Map<string, AlertKind>(alerts.flatMap((alert) => alert.subject?._tag === "piece"
    ? [[`${alert.subject.namespace}:${alert.subject.id}`, alert.kind] as const] : []))
  const entries = subject === undefined ? [...subjects] : [[subject, subjects.get(subject)] as const]
  return <>
    {entries.map(([subject, kind]) => <SubjectPanel key={subject} agentId={agentId} subject={subject}
      {...(kind === undefined ? {} : { alertKind: kind })} />)}
    {failed && <p role="status">Could not load alert subjects. <button onClick={() => setRetry((value) => value + 1)}>Try again</button></p>}
  </>
}
