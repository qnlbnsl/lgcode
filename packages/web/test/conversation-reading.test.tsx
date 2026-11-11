import * as Effect from "effect/Effect"
import { adminShellClient } from "./admin-shell-client.ts"
import { ShellDataProvider, useConversation } from "../src/data/ShellDataProvider.tsx"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { AgentId } from "@lgcode/contracts"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { useConversationReading } from "../src/thread/reading.tsx"
import { BoundedText } from "../src/thread/boundedText.tsx"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock("@lgcode/client/browser", () => ({ connect: () => Effect.succeed(adminShellClient()) }))
let container: HTMLDivElement, root: Root
const identity = { _tag: "agent" as const, agentId: "reader" as AgentId }
function Reader({ count, id }: { count: number; id: string }) {
  const reading = useConversationReading(identity, count, true)
  return <div data-reader={id} ref={reading.scroller} onScroll={reading.onScroll}>
    {Array.from({ length: count }, (_, index) => <article data-sequence={index + 1} key={index}>{index + 1}</article>)}
    {reading.away && <button onClick={reading.latest}>Latest {id}</button>}
  </div>
}
const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 400, width: 400, x: 0, y: top, toJSON: () => ({}) })
const readers = () => [...container.querySelectorAll<HTMLDivElement>("[data-reader]")]
const scroll = async (node: HTMLDivElement, top: number) => { await act(async () => { node.scrollTop = top; node.dispatchEvent(new Event("scroll", { bubbles: true })) }) }
beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100)
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) { return this.querySelectorAll("article").length * 50 })
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const parent = this.closest<HTMLDivElement>("[data-reader]")
    return rect(this.dataset.sequence ? (Number(this.dataset.sequence) - 1) * 50 - parent!.scrollTop : 0, this.dataset.sequence ? 50 : 100)
  })
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() })
const render = async (count: number, second = true) => { await act(async () => root.render(<ShellDataProvider onSessionExpired={() => {}}><Reader id="page" count={count} />{second && <Reader id="dock" count={count} />}</ShellDataProvider>)) }

it("keeps simultaneous readers independent as content arrives, and follows the bottom only for a reader already there", async () => {
  await render(10)
  const [page, dock] = readers()
  await scroll(page!, 125); await scroll(dock!, 400)
  await render(12)
  expect(page!.scrollTop).toBe(125)
  expect(dock!.scrollTop).toBe(600)
  expect(page!.textContent).toContain("Latest page")
  await act(async () => page!.querySelector("button")!.click())
  expect(page!.scrollTop).toBe(600)
})

it("restores the visible turn and its offset after navigation", async () => {
  await render(10, false); await scroll(readers()[0]!, 135)
  await act(async () => root.render(<ShellDataProvider onSessionExpired={() => {}}><p>Other page</p></ShellDataProvider>))
  await render(12, false)
  expect(readers()[0]!.scrollTop).toBe(135)
})

it("bounds twelve-line and single-line text and opens the whole plain block with focus restored on Escape", async () => {
  const original = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal")
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } })
  try {
    const text = Array.from({ length: 30 }, (_, index) => `Line ${index + 1} <b>literal</b>`).join("\n")
    await act(async () => root.render(<BoundedText text={text} label="Review trace" />))
    expect(container.querySelector("pre")!.textContent).not.toContain("Line 13")
    expect(container.querySelector("b")).toBeNull()
    const open = container.querySelector<HTMLButtonElement>("button")!
    open.focus(); await act(async () => open.click())
    expect(container.querySelector("dialog pre")!.textContent).toBe(text)
    expect(document.activeElement?.tagName).toBe("H2")
    await act(async () => container.querySelector("dialog")!.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })))
    expect(document.activeElement).toBe(open)
    await act(async () => root.render(<BoundedText text={"x".repeat(100_000)} />))
    expect(container.querySelector("pre")!.textContent!.length).toBeLessThan(16_400)
  } finally {
    if (original) Object.defineProperty(HTMLDialogElement.prototype, "showModal", original)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal")
  }
})
