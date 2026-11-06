import { useEffect, useState } from "react"
import type { Alert, EventSequence } from "@sheprd/contracts"
import { requestId, useAdminApi } from "./api.ts"
import { threadHref } from "../thread/links.ts"

export function Alerts({ onSessionExpired }: { readonly onSessionExpired: () => void }) {
  const { run, busy, message } = useAdminApi(onSessionExpired)
  const [items, setItems] = useState<ReadonlyArray<Alert>>()
  const [next, setNext] = useState<EventSequence>()

  async function load(after = 0 as EventSequence) {
    const page = await run((client) => client["client.alerts.list"]({ requestId: requestId(), after, limit: 100 }))
    if (page !== undefined) {
      setItems((previous) => after === 0 ? page.items : [...(previous ?? []).filter((item) => !page.items.some((newItem) => newItem.alertId === item.alertId)), ...page.items])
      setNext(page.next)
    }
  }

  useEffect(() => { void load() }, [run])

  return <section aria-label="Alerts">
    <h2>Alerts</h2>
    {message && <p role="alert">{message}</p>}
    <button disabled={busy} onClick={() => { void load() }}>Refresh alerts</button>
    {items === undefined ? <p role="status">{busy ? "Loading alerts…" : "Alerts have not loaded."}</p> : items.length === 0 ? <p>No alerts.</p> : <ul>
      {items.map((alert) => <li key={alert.alertId}>
        <p>{alert.title}</p>
        <p>Status: {alert.status} · Kind: {alert.kind}</p>
        {alert.delivery !== undefined && <p>
          Delivery: {alert.delivery.status === "delivered" ? "Delivered" : alert.delivery.final ? "Still failing" : "Failed"}
          {" · "}Attempt: {alert.delivery.attempt}
          {alert.delivery.status === "failed" && <> · Reason: {alert.delivery.reason}</>}
        </p>}
        {alert.agentId !== undefined && <a href={threadHref(alert.agentId,
          alert.subject?._tag === "piece" ? `${alert.subject.namespace}:${alert.subject.id}` : undefined)}>Open thread for {alert.agentId}</a>}
        {alert.subject !== undefined && <p>Subject: {alert.subject._tag} · {alert.subject.id}</p>}
      </li>)}
    </ul>}
    {next !== undefined && <button disabled={busy} onClick={() => { void load(next) }}>Load more alerts</button>}
  </section>
}
