import { act } from "react"
import { createRoot } from "react-dom/client"
import * as Schema from "effect/Schema"
import { Event } from "@lgtm/contracts"
import { expect, it } from "vitest"
import type { ClientEnvelope } from "@lgtm/client/browser"
import { DeliveryHistory } from "../src/thread/delivery.tsx"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const queued = { sequence: 2, event: Schema.decodeUnknownSync(Event)({ _tag: "DeliveryQueued", delivery: { id: "actual-delivery", target: "agent", sender: { _tag: "owner" }, content: { _tag: "prompt", text: "One original source" } } }) } as ClientEnvelope & { event: { _tag: "DeliveryQueued" } }
const release = { sequence: 4, event: Schema.decodeUnknownSync(Event)({ _tag: "DeliveryReleased", agentId: "agent", holdSequence: 3 }) } as ClientEnvelope & { event: { _tag: "DeliveryReleased" } }

it("547 keeps an actual agent release visible alongside its source without inventing a delivery identity", async () => {
  const container = document.createElement("div"), root = createRoot(container)
  try {
    await act(async () => root.render(<><DeliveryHistory event={queued.event} items={[queued, release]} /><DeliveryHistory event={release.event} items={[queued, release]} /></>))
    expect(container.querySelectorAll('[aria-label="Outgoing delivery"]')).toHaveLength(1)
    expect(container.querySelectorAll('[aria-label="Delivery state"]')).toHaveLength(1)
    expect(container.textContent?.match(/One original source/gu)).toHaveLength(1)
    expect(container.textContent).toContain("Released")
    expect(container.querySelector('[aria-label="Delivery state"]')?.textContent).not.toContain("actual-delivery")
  } finally { await act(async () => root.unmount()) }
})

it("547 shows an actual release before hydration and retains it when its earlier source arrives", async () => {
  const container = document.createElement("div"), root = createRoot(container)
  try {
    await act(async () => root.render(<DeliveryHistory event={release.event} items={[release]} />))
    expect(container.textContent).toContain("Delivery Released")
    await act(async () => root.render(<><DeliveryHistory event={queued.event} items={[queued, release]} /><DeliveryHistory event={release.event} items={[queued, release]} /></>))
    expect(container.querySelectorAll('[aria-label="Delivery state"]')).toHaveLength(1)
    expect(container.querySelectorAll('[aria-label="Outgoing delivery"]')).toHaveLength(1)
    expect(container.textContent).toContain("One original source"); expect(container.textContent).toContain("Released")
  } finally { await act(async () => root.unmount()) }
})
