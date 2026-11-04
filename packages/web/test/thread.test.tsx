import { act } from "react"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { expect, it, vi } from "vitest"
import { agentId, item, mountThread } from "./thread-fixtures.tsx"

it("7.4 renders every thread content kind as inert text and resolves oversized markers only after a tap", async () => {
  const oversized = { _tag: "client.Oversized", sequence: 7, tag: "ThreadItem", agentId, bytes: 300_000 }
  const eventRead = vi.fn(() => Effect.succeed({ envelope: item(7, { _tag: "ThreadItem", itemId: "large", replay: false, content: { _tag: "text", text: "loaded full event" } }) }))
  const container = await mountThread([
    item(2, { _tag: "ThreadItem", itemId: "text", replay: false, content: { _tag: "text", text: '<img src=x onerror="window.__xss=1"> **markdown** <a href="javascript:window.__xss=2">bad</a>' } }),
    item(3, { _tag: "ThreadItem", itemId: "plan", replay: false, content: { _tag: "plan", entries: [{ content: "Plan step", priority: "high", status: "pending" }] } }),
    item(4, { _tag: "ThreadItem", itemId: "tool", replay: false, content: { _tag: "tool-call", callId: "tool-1", title: "Run command", status: "completed", input: "{\"cmd\":\"ls\"}", output: "done" } }),
    item(5, { _tag: "ThreadItem", itemId: "file", replay: false, content: { _tag: "file-change", path: "src/a.ts", diff: "+const safe = true" } })
  ], { "client.event": eventRead, "client.subscribe": () => Stream.fromIterable([oversized]) })

  expect(container.textContent).toContain("Plan step") // catches thread views that discard plan updates
  expect(container.textContent).toContain("Run command") // catches thread views that hide tool calls
  expect(container.textContent).toContain("src/a.ts") // catches thread views that omit file changes
  expect(container.textContent).toContain('<img src=x onerror="window.__xss=1"> **markdown**') // catches interpreting agent Markdown or HTML
  expect(container.querySelector("img")).toBeNull() // catches raw HTML insertion
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull() // catches executable agent links
  expect((window as typeof window & { __xss?: number }).__xss).toBeUndefined()
  expect(eventRead).not.toHaveBeenCalled() // catches eagerly reading a large event during render

  const load = container.querySelector<HTMLButtonElement>('button[aria-label*="Load"]')
  expect(load).toBeTruthy() // catches silently dropping oversized stream markers
  await act(async () => { load!.click() })
  expect(eventRead).toHaveBeenCalledWith(expect.objectContaining({ sequence: 7 })) // catches tap controls that never fetch the full event
  expect(container.textContent).toContain("loaded full event")
})

it("7.4 shows a placeholder only for content-only event tags", async () => {
  const container = await mountThread([], { "client.subscribe": () => Stream.fromIterable([
    { _tag: "client.Oversized", sequence: 2, tag: "ThreadItem", agentId, bytes: 300_000 },
    { _tag: "client.Oversized", sequence: 3, tag: "StateChanged", agentId, bytes: 300_000 }
  ]) })
  expect(container.querySelector('button[aria-label*="Load"]')).toBeTruthy() // catches dropping the placeholder for content-only thread data
  expect(container.textContent).not.toContain("StateChanged") // catches placeholders for control events that carry no display content
})
