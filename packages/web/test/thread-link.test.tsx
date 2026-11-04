import { expect, it, vi } from "vitest"
import { mountThread } from "./thread-fixtures.tsx"

// enable-in: a7c — the alert list and its link are introduced by the later alerts page unit.
it.skip("7.9 opens a thread link without sending a state-changing command", async () => {
  const answer = vi.fn()
  const prompt = vi.fn()
  const container = await mountThread([], { answer, prompt }, "/thread/worker-1?subject=board:post-42")
  const link = container.querySelector<HTMLAnchorElement>('a[href*="/thread/worker-1"]')
  expect(link).toBeTruthy() // catches subject links that do not open the agent thread
  expect(link!.getAttribute("href")).toContain("post-42") // catches a link that loses the alert's subject
  link!.click()
  expect(answer).not.toHaveBeenCalled() // catches answering a request as a side effect of opening a link
  expect(prompt).not.toHaveBeenCalled() // catches prompting an agent as a side effect of opening a link
})

