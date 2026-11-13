import { useEffect, useRef, useState } from "react"
import type { Alert, EventSequence, RequestId } from "@lgtm/contracts"
import { commandOutcome, requestId, useAdminApi } from "./api.ts"
import { threadHref } from "../thread/links.ts"
import { visibleText } from "../thread/text.tsx"
import { useMutationDisabled } from "../data/ShellDataProvider.tsx"
import { shellHref } from "../routes.ts"
import "./admin.css"

export function Alerts({ onSessionExpired }: { readonly onSessionExpired: () => void }) {
  const { run, busy, message, setMessage } = useAdminApi(onSessionExpired)
  const offline = useMutationDisabled()
  const [items, setItems] = useState<ReadonlyArray<Alert>>()
  const [next, setNext] = useState<EventSequence>()
  const [stale, setStale] = useState(false)
  const [pending, setPending] = useState<Alert["alertId"]>()
  const retry = useRef<{ requestId: RequestId; alertId: Alert["alertId"]; generation: EventSequence; attempt: number } | undefined>(undefined)

  async function load(after = 0 as EventSequence) {
    const page = await run((client) => client["client.alerts.list"]({ requestId: requestId(), after, limit: 100 }))
    if (page !== undefined) {
      if (page.next !== undefined && (page.next <= after || page.items.length === 0)) {
        setStale(true)
        setMessage("The alert cursor did not advance. Refresh alerts before continuing.")
        return
      }
      setItems((previous) => after === 0 ? page.items : [...(previous ?? []).filter((item) => !page.items.some((newItem) => newItem.alertId === item.alertId)), ...page.items])
      setNext(page.next)
      setStale(false)
    } else setStale(true)
  }

  useEffect(() => { void load() }, [run])

  async function retryDelivery(alert?: Alert) {
    if (offline || busy) return
    // A lost acknowledgement may follow a real carrier exchange. Reusing the
    // exact receipt identity prevents a click from sending that exchange twice.
    if (retry.current !== undefined && alert !== undefined && retry.current.alertId !== alert.alertId) return
    if (retry.current === undefined) {
      if (alert?.delivery?.status !== "failed" || stale) return
      retry.current = { requestId: requestId(), alertId: alert.alertId,
        generation: alert.delivery.generation, attempt: alert.delivery.attempt }
    }
    setPending(retry.current.alertId)
    const reply = await run((client) => commandOutcome(client["client.alerts.retry"](retry.current!)))
    if (reply === undefined) return
    retry.current = undefined
    setPending(undefined)
    await load()
    setMessage(reply._tag === "refused" ? "The notification changed or the retry was refused. Check the current alert state before retrying."
      : reply.value.accepted ? "The notification service accepted the retry. Phone arrival is not confirmed."
      : `The notification service did not accept the retry: ${reply.value.reason ?? "carrier delivery failed"}.`)
  }

  const failed = items?.filter((alert) => alert.status === "open" && alert.delivery?.status === "failed")
  const remedy = failed?.some((alert) => alert.delivery?.status === "failed" && ["token missing", "service missing"].includes(alert.delivery.reason))
  return <section className="admin-page" aria-label="Notifications">
    <div className="admin-page-top"><h2>Notifications</h2>
      <button disabled={busy} onClick={() => { void load() }}>Refresh alerts</button>
    </div>
    {message && <p role="alert">{message}</p>}
    {offline && <p className="admin-note">Reconnect before retrying notifications.</p>}
    {stale && items !== undefined && <p role="status">Showing the last loaded alerts. Refresh to check their current state.</p>}
    {failed !== undefined && failed.length > 0 && <p className="admin-warning">{failed.length} failed {next === undefined ? "notifications" : "notifications on the loaded pages"}. {remedy && <a href={`${shellHref({ page: "service", service: "settings" })}?focus=token`}>Fix in Service settings</a>}</p>}
    {pending !== undefined && !busy && <div className="admin-actions"><p role="status">The retry result is uncertain. Retry this same notification to recover its receipt.</p>
      <button disabled={offline} onClick={() => { void retryDelivery() }}>Recover retry result</button></div>}
    {items === undefined ? <p role="status">{busy ? "Loading alerts…" : "Alerts have not loaded."}</p> : items.length === 0 ? <p>No alerts.</p> : <div className="admin-table-wrap"><table className="admin-table admin-alert-table" aria-label="Notifications">
      <thead><tr><th>Notification</th><th>Time</th><th>About</th><th>Delivery</th><th>Actions</th></tr></thead>
      <tbody>{items.map((alert) => <tr key={alert.alertId}>
        <td className="admin-record-name"><span title={visibleText(alert.title)}>{visibleText(alert.title)}</span><small>Status: {alert.status} · Kind: {alert.kind}</small></td>
        <td>{Number.isFinite(alert.raisedAt) ? <time dateTime={new Date(alert.raisedAt).toISOString()}>{new Date(alert.raisedAt).toLocaleString()}</time> : "Time unavailable"}</td>
        <td>{alert.agentId !== undefined ? <a href={threadHref(alert.agentId,
          alert.subject?._tag === "piece" ? `${alert.subject.namespace}:${alert.subject.id}` : undefined)}>Open thread for {visibleText(alert.agentId)}</a> : "LGTM Studio"}</td>
        <td className={`admin-record-status${alert.delivery?.status === "failed" ? " admin-warning" : ""}`}>
        {alert.delivery !== undefined ? <>
          Delivery: {alert.delivery.status === "delivered" ? "Delivered" : alert.delivery.final ? "Still failing" : "Failed"}
          {" · "}Attempt: {alert.delivery.attempt}
          {alert.delivery.status === "failed" && <> · Reason: {alert.delivery.reason}</>}
        </> : "Delivery not reported"}</td>
        <td className="admin-row-actions">{alert.status === "open" && alert.delivery?.status === "failed" && <button disabled={busy || offline || stale || pending !== undefined && pending !== alert.alertId}
          onClick={() => { void retryDelivery(alert) }}>{pending === alert.alertId ? "Retry same notification" : "Retry"}</button>}</td>
      </tr>)}</tbody>
    </table></div>}
    {next !== undefined && <button disabled={busy} onClick={() => { void load(next) }}>Load more alerts</button>}
  </section>
}
