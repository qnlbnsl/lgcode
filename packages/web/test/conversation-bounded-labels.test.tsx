import { act } from "react"
import * as Effect from "effect/Effect"
import { expect, it, vi } from "vitest"
import { CommandHandler } from "../../engine/src/commands/CommandHandler.ts"
import { provideBoard } from "../../engine/test/board/wakeFixtures.ts"
import { appendSetup, call, eventOf, makeRig, ownerCredential, readLog, removeRig, seedAccount, seedAgent, seedHarness, success } from "../../engine/test/support/handlerRig.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"
import { cleanupThread, item, mountThread } from "./thread-fixtures.tsx"

const observe = (check: () => void) => vi.waitFor(async () => { await act(async () => {}); check() })
const button = (container: HTMLElement, name: string) => [...container.querySelectorAll("button")].find((node) => node.textContent === name)!

for (const kind of ["tool-call", "file-change"] as const) it(`issue 604: mounted ${kind} label bounds ordinary output and preserves exact full reading, copy and stored evidence`, async () => {
  const rig = makeRig()
  vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder)
  vi.spyOn(document, "hidden", "get").mockReturnValue(false)
  const dialogDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal")
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard")
  const copy = vi.fn(async (_text: string) => {})
  // This is a mounted DOM control, not a browser rendering measurement.
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } })
  // Both strings satisfy the actual ThreadItem event contract. The path is a
  // provider-reported relative path with ordinary components, not a filesystem
  // creation request or a claim that this many components exists on disk.
  const label = kind === "tool-call" ? "Tool title" : "File path"
  const text = kind === "tool-call" ? `Inspect <b>literal title</b> ${"t".repeat(40_000)} TITLE-END-604`
    : `${Array.from({ length: 200 }, (_, index) => `component-${index}-${"p".repeat(190)}`).join("/")}/PATH-END-604.txt`
  const body = Array.from({ length: 30 }, (_, index) => `${index + 1}: <b>literal body</b>`).join("\n") + "\nBODY-END-604"
  try {
    await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* seedAccount(); yield* seedHarness()
      const target = yield* seedAgent({ id: "bounded-label", name: "Worker one", folder: rig.work })
      const event = eventOf({ _tag: "ThreadItem", agentId: target.agentId, itemId: `long-${kind}`, replay: false,
        content: kind === "tool-call" ? { _tag: kind, callId: "tool-604", title: text, status: "completed", input: body, output: body }
          : { _tag: kind, callId: "tool-604", path: text, diff: body },
      })
      yield* appendSetup([event])
      const storedBefore = (yield* readLog).find((row) => row.event._tag === "ThreadItem" && row.event.itemId === `long-${kind}`)!
      expect(storedBefore.event).toEqual(event)
      const page = success(yield* call(ownerCredential, "client.thread", { agentId: target.agentId, after: 0, limit: 100 }))
      const handler = yield* CommandHandler
      const client: Record<string, unknown> = Object.fromEntries([
        "client.snapshot", "client.thread", "client.requests", "client.alerts.list", "client.sequence", "accounts", "client.agent.configuration", "client.agent.context",
      ].map((name) => [name, (payload: Record<string, unknown>) => handler.execute(ownerCredential, name, payload)]))
      yield* Effect.promise(async () => {
        const container = await mountThread(page.items, client, `/thread/${target.agentId}`, false)
        await observe(() => expect(container.querySelector('[aria-label="Agent message"]')).toBeTruthy())
        const message = container.querySelector<HTMLElement>('[aria-label="Agent message"]')!
        if (kind === "tool-call") {
          const summary = message.querySelector("summary")!
          // Bounding the expanded body alone leaves the collapsed stream
          // unbounded. This original assertion covers that independent surface.
          expect(summary.textContent!.length).toBeLessThan(16_500)
          expect(summary.textContent).toContain("completed")
          expect(summary.textContent).not.toContain("TITLE-END-604")
          expect(summary.querySelector("button, a, input, dialog, [tabindex]")).toBeNull()
          await act(async () => { message.querySelector("details")!.open = true })
        }
        const ordinary = message.querySelector("pre")!
        expect(ordinary.textContent!.length).toBeLessThanOrEqual(16_384)
        expect(ordinary.textContent).not.toContain(kind === "tool-call" ? "TITLE-END-604" : "PATH-END-604")
        expect(message.querySelector("b")).toBeNull()
        const open = button(message, `Open ${label} in full`)
        expect(open).toBeTruthy(); expect(open.closest("summary")).toBeNull()
        await act(async () => { open.focus(); open.click() })
        expect(message.querySelector("dialog pre")!.textContent).toBe(text)
        expect(message.querySelector("dialog pre")!.textContent!.endsWith(kind === "tool-call" ? "TITLE-END-604" : "PATH-END-604.txt")).toBe(true)
        expect(message.querySelector("dialog b")).toBeNull()
        await act(async () => button(message, "Back to conversation").click())
        expect(document.activeElement).toBe(open)
        await act(async () => button(message, `Copy ${label}`).click())
        expect(copy).toHaveBeenLastCalledWith(text)
        // Keep the existing complete input/output/diff readers consequential.
        const bodyReaders = [...message.querySelectorAll<HTMLButtonElement>("button")].filter((node) => node.textContent === "Open Message in full")
        expect(bodyReaders).toHaveLength(kind === "tool-call" ? 2 : 1)
        for (const reader of bodyReaders) {
          await act(async () => reader.click())
          expect(message.querySelector("dialog pre")!.textContent).toBe(body)
          await act(async () => button(message, "Back to conversation").click())
        }
        await cleanupThread()
      })
      const storedAfter = (yield* readLog).find((row) => row.sequence === storedBefore.sequence)!
      expect(storedAfter).toEqual(storedBefore)
      expect(storedAfter.event).toEqual(event)
    })))
  } finally {
    await cleanupThread()
    if (dialogDescriptor) Object.defineProperty(HTMLDialogElement.prototype, "showModal", dialogDescriptor)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal")
    if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor)
    else Reflect.deleteProperty(navigator, "clipboard")
    vi.unstubAllEnvs(); removeRig(rig)
  }
}, 20_000)

it("issue 604: mounted short activity labels retain readable title, path and actual status", async () => {
  const container = await mountThread([
    item(2, { _tag: "ThreadItem", itemId: "short-tool", replay: false, content: { _tag: "tool-call", callId: "short-call", title: "Read source", status: "failed", input: "literal input", output: "literal output" } }),
    item(3, { _tag: "ThreadItem", itemId: "short-file", replay: false, content: { _tag: "file-change", callId: "short-call", path: "src/main.ts", diff: "+ literal change" } }),
  ], {}, "/thread/worker-1", false)
  await observe(() => expect(container.querySelector(".tool-activity summary")?.textContent).toContain("Read source"))
  expect(container.querySelector(".tool-activity summary")!.textContent).toContain("failed")
  expect(container.textContent).toContain("src/main.ts")
  expect(container.textContent).toContain("literal input"); expect(container.textContent).toContain("literal output")
  expect(container.textContent).toContain("+ literal change")
  expect(container.textContent).not.toContain("Open Tool title in full")
  expect(container.textContent).not.toContain("Open File path in full")
})
