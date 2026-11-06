import { act } from "react"
import * as Effect from "effect/Effect"
import { CommandsRpcGroup } from "@sheprd/contracts"
import { expect, it, vi } from "vitest"
import { mountThread } from "./thread-fixtures.tsx"

it("7.9 opens the real alert's thread link with its subject without sending a state-changing command", async () => {
  const command = vi.fn(() => Effect.succeed({ requestId: "unexpected-command" }))
  const list = vi.fn(() => Effect.succeed({ requestId: "alerts", items: [{
    alertId: "alert-1", alertKey: "post:post-42", kind: "board.post", agentId: "worker-1",
    subject: { _tag: "piece", namespace: "board", id: "post-42" },
    title: "A post needs your reply", sourceSequence: 1, status: "open", raisedAt: 1,
  }] }))
  const container = await mountThread([], {
    ...Object.fromEntries([...CommandsRpcGroup.requests.keys()]
      .filter((name) => !["client.snapshot", "client.thread", "client.subscribe"].includes(name))
      .map((name) => [name, command])),
    "client.alerts.list": list,
  })
  const alertsLink = Array.from(container.querySelectorAll("a")).find((link) => link.textContent === "Alerts")!
  await act(async () => { alertsLink.click() })
  expect(list).toHaveBeenCalled()
  expect(container.querySelector('section[aria-label="Alerts"]')).toBeTruthy()
  const link = container.querySelector<HTMLAnchorElement>('a[href*="/thread/worker-1"]')
  expect(link).toBeTruthy() // catches an alert without a navigable thread link
  const target = new URL(link!.href)
  expect(target.pathname).toBe("/") // catches paths the static server cannot serve
  expect(target.hash).toBe("#/thread/worker-1?subject=board%3Apost-42") // catches a lost subject or a wrong agent
  // JSDOM cannot navigate from /?page=alerts to the static index document.
  // Follow the actual href through the app's navigation event instead. The
  // Playwright board flow also exercises document navigation in a browser.
  link!.addEventListener("click", (event) => {
    event.preventDefault()
    history.pushState(null, "", link!.href)
    window.dispatchEvent(new PopStateEvent("popstate"))
  }, { once: true })
  await act(async () => {
    link!.click()
  })
  expect(container.querySelector('section[aria-label="Thread"]')).toBeTruthy()
  expect(container.textContent).toContain("Thread: Worker one") // catches staying on Alerts or opening the wrong thread
  expect(container.querySelector('button[aria-label="Read post"]')).toBeTruthy() // catches losing the board subject in navigation
  expect(command).not.toHaveBeenCalled() // catches reads with marks, answers, prompts or alert dismissal on navigation
})

