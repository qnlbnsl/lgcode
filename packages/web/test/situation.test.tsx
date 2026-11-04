import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { afterEach, expect, it, vi } from "vitest"
import { App } from "../src/index.ts"

const browserClient = vi.hoisted(() => ({ client: undefined as unknown, connect: vi.fn() }))
vi.mock("@shephrd/client/browser", async () => {
  const Effect = await import("effect/Effect")
  return { connect: (...args: unknown[]) => { browserClient.connect(...args); return Effect.succeed(browserClient.client) } }
})

const roots: Array<{ container: HTMLDivElement; root: Root }> = []
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const agent = (agentId: string, displayedState: string, state: object, openPermissionRequests = 0) => ({
  agentId, name: agentId, role: "worker", groups: [], parent: { _tag: "owner" },
  state, displayedState, openPermissionRequests, openQuestionsAsked: 0,
  harness: "codex", account: "default", permission: "ask", folder: "/work", startedAt: 1
})
const envelope = (sequence: number, agentId = "idle-agent") => ({
  sequence, eventId: `event-${sequence}`, occurredAt: sequence, caller: { _tag: "owner" },
  event: { _tag: "StateChanged", agentId, state: { _tag: "working" } }
})

const snapshot = {
  sequence: 7,
  agents: [
    agent("needs-owner", "Waiting on a permission", { _tag: "working" }, 1),
    agent("working-agent", "Working", { _tag: "working" }),
    agent("idle-agent", "Idle", { _tag: "idle" })
  ], requests: [], questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0
}

const mount = async () => {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  roots.push({ container, root })
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  await act(async () => { root.render(<App />) })
  return container
}

afterEach(async () => {
  for (const { container, root } of roots.splice(0)) {
    await act(async () => { root.unmount() })
    container.remove()
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  browserClient.connect.mockReset()
  browserClient.client = undefined
})

it("7.2 places snapshot agents in needs you, working and idle lanes, then applies a newer stream state", async () => {
  const subscribe = vi.fn(() => Stream.fromIterable([envelope(8)]))
  browserClient.client = {
    snapshot: () => Effect.succeed(snapshot),
    subscribe
  }
  const container = await mount()

  await act(async () => { await vi.waitFor(() => { if (!container.textContent?.includes("needs-owner")) throw new Error("snapshot agent is not rendered") }) })
  expect(container.querySelector('[aria-label="Needs you"]')?.textContent).toContain("needs-owner") // catches requests sorted into ordinary work
  expect(container.querySelector('[aria-label="Working"]')?.textContent).toContain("working-agent") // catches working agents hidden from the roster
  expect(container.querySelector('[aria-label="Idle"]')?.textContent).toContain("idle-agent") // catches idle agents treated as active

  // A stream state transition is authoritative over the snapshot's lane.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ after: 7 }))
  expect(container.querySelector('[aria-label="Working"]')?.textContent).toContain("idle-agent") // catches ignoring live state transitions
})

it("7.2 resumes a dropped stream from its last applied cursor", async () => {
  const subscribe = vi.fn()
    .mockImplementationOnce(() => Stream.concat(
      Stream.fromIterable([envelope(8)]),
      Stream.fail(new Error("connection dropped"))
    ))
    .mockImplementation(() => Stream.fromIterable([{ _tag: "client.Checkpoint", sequence: 8 }]))
  browserClient.client = { snapshot: () => Effect.succeed(snapshot), subscribe }
  const container = await mount()

  await vi.waitFor(() => expect(subscribe.mock.calls.length).toBeGreaterThanOrEqual(2))
  expect(subscribe.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ after: 7 }))
  expect(subscribe.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ after: 8 })) // catches reconnecting from the old snapshot cursor and losing the transition
  expect(container.querySelector('[aria-label="Working"]')?.textContent).toContain("idle-agent")
})
