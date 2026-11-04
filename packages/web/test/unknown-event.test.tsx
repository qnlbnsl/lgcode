import { expect, it } from "vitest"
import { item, mountThread } from "./thread-fixtures.tsx"

it("7.10 keeps the thread usable when an unknown event arrives", async () => {
  const container = await mountThread([
    item(2, { _tag: "UnknownEvent", tag: "FuturePieceEvent", namespace: "client" }),
    item(3, { _tag: "ThreadItem", itemId: "text", replay: false, content: { _tag: "text", text: "Still visible" } })
  ])
  expect(container.textContent).toContain("Still visible") // catches a page-level crash that hides subsequent supported events
})
