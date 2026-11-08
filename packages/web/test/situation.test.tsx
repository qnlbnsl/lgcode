import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { afterEach, expect, it, vi } from "vitest"
import { App } from "../src/index.ts"
import { controlledStream } from "./controlled-stream.ts"

const browserClient = vi.hoisted(() => ({ client: undefined as unknown, connect: vi.fn() }))
vi.mock("@lgcode/client/browser", async () => {
  const Effect = await import("effect/Effect")
  return { connect: (...args: unknown[]) => { browserClient.connect(...args); return Effect.succeed(browserClient.client) } }
})

const roots: Array<{ container: HTMLDivElement; root: Root }> = []
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const agent = (agentId: string, displayedState: string, state: object, openPermissionRequests = 0, openQuestionsAsked = 0) => ({
  agentId, name: agentId, role: "worker", groups: [], parent: { _tag: "owner" },
  state, displayedState, openPermissionRequests, openQuestionsAsked,
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
  const stateChanged = await Effect.runPromise(Deferred.make<ReturnType<typeof envelope>>())
  const subscribe = vi.fn(() => Stream.fromEffect(Deferred.await(stateChanged)))
  browserClient.client = {
    "client.snapshot": () => Effect.succeed(snapshot),
    "client.subscribe": subscribe
  }
  const container = await mount()

  await act(async () => { await vi.waitFor(() => { if (!container.textContent?.includes("needs-owner")) throw new Error("snapshot agent is not rendered") }) })
  expect(container.querySelector('[aria-label="Needs you"]')?.textContent).toContain("needs-owner") // catches requests sorted into ordinary work
  expect(container.querySelector('[aria-label="Working"]')?.textContent).toContain("working-agent") // catches working agents hidden from the roster
  expect(container.querySelector('[aria-label="Idle"]')?.textContent).toContain("idle-agent") // catches idle agents treated as active

  // A stream state transition is authoritative over the snapshot's lane.
  await act(async () => { await Effect.runPromise(Deferred.succeed(stateChanged, envelope(8))) })
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
  browserClient.client = { "client.snapshot": () => Effect.succeed(snapshot), "client.subscribe": subscribe }
  const container = await mount()

  await act(async () => { await vi.waitFor(() => expect(subscribe.mock.calls.length).toBeGreaterThanOrEqual(2)) })
  expect(subscribe.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ after: 7 }))
  expect(subscribe.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ after: 8 })) // catches reconnecting from the old snapshot cursor and losing the transition
  expect(container.querySelector('[aria-label="Working"]')?.textContent).toContain("idle-agent")
})

it.each([
  { name: "working question", state: { _tag: "working" }, questions: 1, ordinary: "Working" },
  { name: "idle question", state: { _tag: "idle" }, questions: 1, ordinary: "Idle" },
  { name: "paused", state: { _tag: "paused", reason: "limit", midTurn: false, resetAt: 100 }, questions: 0, ordinary: "Idle" },
  { name: "interrupted", state: { _tag: "interrupted", previous: "working" }, questions: 0, ordinary: "Idle" },
  { name: "crashed", state: { _tag: "crashed" }, questions: 0, ordinary: "Idle" }
])("FR-085 gives $name precedence and handles streamed entry and exit", async ({ name, state, questions, ordinary }) => {
  const live = await controlledStream()
  let current = { ...snapshot, agents: [
    ...snapshot.agents, agent(name, "", state, 0, questions)
  ] }
  browserClient.client = { "client.snapshot": () => Effect.succeed(current), "client.subscribe": () => live.stream }
  const container = await mount()
  const inLane = (lane: string) => [...container.querySelectorAll(`section[aria-label="${lane}"] li strong`)].map((node) => node.textContent)
  const expectOnly = (lane: string) => {
    for (const candidate of ["Needs you", "Working", "Idle"]) {
      if (candidate === lane) expect(inLane(candidate)).toContain(name)
      else expect(inLane(candidate)).not.toContain(name)
    }
  }
  expectOnly("Needs you")
  await act(async () => {
    current = { ...current, sequence: 8, agents: [...snapshot.agents, agent(name, "", { _tag: ordinary === "Working" ? "working" : "idle" })] }
    await live.emit(itemForSituation(8, name, "QuestionAnswered", questions === 0 ? { _tag: ordinary === "Working" ? "working" : "idle" } : undefined))
  })
  expectOnly(ordinary)
  await act(async () => {
    current = { ...current, sequence: 9, agents: [...snapshot.agents, agent(name, "", state, 0, questions)] }
    await live.emit(itemForSituation(9, name, "QuestionAsked", questions === 0 ? state : undefined))
  })
  expectOnly("Needs you")
  expect(inLane("Needs you")).toContain("needs-owner")
  expect(inLane("Working")).toContain("working-agent")
  expect(inLane("Idle")).toContain("idle-agent")
  await act(async () => {
    current = { ...current, sequence: 10, agents: [...snapshot.agents, agent(name, "", { _tag: ordinary === "Working" ? "working" : "idle" })] }
    await live.emit(itemForSituation(10, name, "QuestionAnswered", questions === 0 ? { _tag: ordinary === "Working" ? "working" : "idle" } : undefined))
  })
  expectOnly(ordinary)
})

const itemForSituation = (sequence: number, agentId: string, tag: string, state?: object) => ({
  sequence, eventId: `event-${sequence}`, occurredAt: sequence, caller: { _tag: "owner" },
  event: state !== undefined ? { _tag: "StateChanged", agentId, state } : tag === "QuestionAsked"
    ? { _tag: tag, agentId, questionId: "question-1", holder: { _tag: "owner" }, deliveryId: "delivery-1", text: "Continue?" }
    : { _tag: tag, agentId, questionId: "question-1", answeredBy: { _tag: "owner" }, deliveryId: "delivery-2", text: "Continue." }
})
