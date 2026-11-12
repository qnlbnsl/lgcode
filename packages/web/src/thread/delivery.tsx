import type { ClientEnvelope } from "@lgtm/client/browser"
import type { Event } from "@lgtm/contracts"
import { DataText, visibleText } from "./text.tsx"
import { BoundedText } from "./boundedText.tsx"

type DeliveryEvent = Extract<Event, { _tag: "DeliveryQueued" | "DeliverySent" | "DeliveryAccepted" | "DeliveryRequeued" | "DeliveryHeld" | "DeliveryReleased" | "DeliveryReturned" | "DeliveryWithdrawn" }>
type SourceEvent = Extract<Event, { _tag: "AgentStarted" | "DeliveryQueued" }>
const sourceDelivery = (event: ClientEnvelope["event"]) => event._tag === "AgentStarted" ? event.firstPromptDelivery
  : event._tag === "DeliveryQueued" ? event.delivery : undefined

const status = (event: DeliveryEvent) => event._tag.slice("Delivery".length)

export function DeliveryHistory({ event, items }: {
  readonly event: DeliveryEvent | SourceEvent
  readonly items: ReadonlyArray<ClientEnvelope>
}) {
  if (event._tag === "DeliveryQueued" || event._tag === "AgentStarted") {
    const delivery = sourceDelivery(event)
    if (delivery === undefined) return null
    const sender = delivery.sender
    const from = sender._tag === "agent" ? `Agent ${sender.agentId}` : sender._tag === "piece"
      ? `Piece ${sender.namespace}` : sender._tag === "service" ? `Service ${sender.service}` : "Owner"
    const latest = items.filter((item) => "deliveryId" in item.event && item.event.deliveryId === delivery.id).at(-1)?.event
    const failed = latest?._tag === "DeliveryReturned" || latest?._tag === "DeliveryWithdrawn"
    return <article aria-label="Outgoing delivery" className={sender._tag === "owner" ? "owner-turn" : "agent-turn"}>
      <h3>{delivery.content._tag === "compact" ? "Compact request" : "Outgoing prompt"}</h3>
      {"text" in delivery.content && <BoundedText text={delivery.content.text} label="Prompt" />}
      {"context" in delivery.content && delivery.content.context?.map((ref, index) => <p className="sent-context" key={index}>Context: {visibleText(ref._tag === "task" ? ref.taskId : ref.path)}</p>)}
      {failed && <p className="delivery-failed">Message not delivered: {visibleText(latest.reason)}</p>}
      <details className="delivery-details"><summary>Delivery details</summary>
      <p>From: {visibleText(from)}</p>
      <p>Delivery: {visibleText(delivery.id)}</p>
      {delivery.source && <p>Source: {visibleText(`${delivery.source._tag}: ${delivery.source.id}`)}</p>}
      <ol aria-label="Delivery history">
        <li>Queued</li>
        {items.map((item) => {
          const next = item.event
          if (!("deliveryId" in next) || next.deliveryId !== delivery.id
            || !["DeliverySent", "DeliveryAccepted", "DeliveryRequeued", "DeliveryHeld", "DeliveryReturned", "DeliveryWithdrawn"].includes(next._tag)) return null
          return <li key={item.sequence}>{status(next as DeliveryEvent)}{"reason" in next && <>: {visibleText(next.reason)}</>}</li>
        })}
      </ol>
      </details>
    </article>
  }
  // History may start after a source. Keep its state visible until the source
  // is read, then join it by delivery identity instead of repeating the text.
  if ("deliveryId" in event && items.some((item) => sourceDelivery(item.event)?.id === event.deliveryId)) return null
  return <article aria-label="Delivery state">
    <h3 className={event._tag === "DeliveryReturned" || event._tag === "DeliveryWithdrawn" ? "delivery-failed" : undefined}>{event._tag === "DeliveryReturned" || event._tag === "DeliveryWithdrawn" ? "Message not delivered" : `Delivery ${status(event)}`}</h3>
    {event._tag === "DeliveryReleased" && <p>Agent: {visibleText(event.agentId)}{event.holdSequence === undefined ? "" : ` · Hold sequence: ${event.holdSequence}`}</p>}
    {"deliveryId" in event && <p>Delivery: {visibleText(event.deliveryId)}</p>}
    {"reason" in event && <DataText text={event.reason} />}
  </article>
}
