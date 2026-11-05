import type { ClientEnvelope } from "@shephrd/client"
import { expect, it, vi } from "vitest"
import type { ViewerClient } from "../src/connection.ts"
import { ViewerSession } from "../src/session.ts"
import { eventText } from "../src/text.ts"
import { agentRow, envelope, snapshot } from "../../client/test/support/unit3.ts"

const source = envelope(2, { _tag: "DeliveryQueued", delivery: {
  id: "outgoing", target: "agent-a", sender: { _tag: "owner" }, content: { _tag: "prompt", text: "Owner source text" }
} })

it("selects nested delivery sources without synthetic identity, joins split pages, and restores history on reopen", async () => {
  expect(source).not.toHaveProperty("agentId")
  let secondPage: (() => void) | undefined
  const thread = vi.fn(async ({ after }: { after: number }) => after === 0 ? { items: [source], next: 2 }
    : new Promise((resolve) => { secondPage = () => resolve({ items: [envelope(3, {
      _tag: "DeliverySent", agentId: "agent-a", deliveryId: "outgoing", method: "acp"
    })] }) }))
  const client = { thread, close: async () => {} } as unknown as ViewerClient
  const session = new ViewerSession(client, () => {})
  const loading = session.select("agent-a")
  await vi.waitFor(() => expect(secondPage).toBeDefined())
  secondPage!()
  await loading
  expect(session.items.map((item) => item.event._tag)).toEqual(["DeliveryQueued", "DeliverySent"])
  expect(session.items.map((item) => eventText(item.event)).join("\n")).toContain("Owner source text")
  await session.select(undefined)
  const reopened = session.select("agent-a")
  await vi.waitFor(() => expect(thread).toHaveBeenCalledTimes(4))
  secondPage!()
  await reopened
  expect(session.items).toHaveLength(2)
  await session.close()
})

it("recovers oversized live sources and retains state history after the viewer reconnects", async () => {
  let onItem: Parameters<ViewerClient["subscribe"]>[1] | undefined
  let recovered = false
  const client = {
    snapshot: async () => snapshot({ agents: [agentRow()] }), thread: async () => ({ items: recovered ? [source] : [] }),
    event: async () => { recovered = true; return { envelope: source } }, close: async () => {},
    subscribe: async (_after: number, callback: NonNullable<typeof onItem>, signal: AbortSignal) => {
      onItem = callback
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
    }
  } as unknown as ViewerClient
  const session = new ViewerSession(client, () => {})
  try {
    await session.start()
    onItem!({ _tag: "client.Oversized", sequence: 2, tag: "DeliveryQueued", bytes: 300_000 } as any)
    await vi.waitFor(() => expect(session.items).toHaveLength(1))
    await session.start()
    onItem!(envelope(3, { _tag: "DeliveryAccepted", agentId: "agent-a", deliveryId: "outgoing" }))
    expect(session.items.map((item) => item.event._tag)).toEqual(["DeliveryQueued", "DeliveryAccepted"])
    onItem!(envelope(4, { _tag: "QuestionAnswered", agentId: "agent-a", questionId: "question", answeredBy: { _tag: "owner" }, text: "Owner answer", deliveryId: "answer" }))
    expect(session.items.map((item) => eventText(item.event)).join("\n")).toContain("Owner answer")
  } finally { await session.close() }
})
