import { expect, it } from "vitest"
import { mountThread } from "./thread-fixtures.tsx"

it("7.13 names an unsupported subject and explains that it is answered from a terminal", async () => {
  const container = await mountThread([], {}, "/thread/worker-1?subject=unknown:post-42")
  expect(container.textContent).toContain("post-42") // catches dropping the subject identifier in the fallback
  expect(container.textContent).toMatch(/answered from a terminal/i) // catches a fallback that offers no actionable next step
})

// enable-in: b6 — the board plan adds its known-namespace subject entry in B11.
it.skip("7.13 uses a known namespace table entry when the board entry is installed", async () => {
  const container = await mountThread([], {}, "/thread/worker-1?subject=board:post-42")
  expect(container.textContent).toContain("Board post")
  expect(container.textContent).not.toMatch(/answered from a terminal/i)
})
