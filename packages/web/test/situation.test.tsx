import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { afterEach, expect, it, vi } from "vitest"
import { App } from "../src/index.ts"
import { controlledStream } from "./controlled-stream.ts"

const browserClient = vi.hoisted(() => ({ client: undefined as unknown, connect: vi.fn() }))
vi.mock("@lgtm/client/browser", async () => {
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

const stateOf = (container: HTMLElement, name: string) => [...container.querySelectorAll(".agent-link")].find((node) => node.querySelector(".agent-name")?.textContent === name)?.querySelector("small")?.textContent

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

it("7.2 shows permission, working and idle states in navigation, then applies a newer stream state", async () => {
  const stateChanged = await Effect.runPromise(Deferred.make<ReturnType<typeof envelope>>())
  const subscribe = vi.fn(() => Stream.fromEffect(Deferred.await(stateChanged)))
  browserClient.client = {
    "client.snapshot": () => Effect.succeed(snapshot),
    "client.subscribe": subscribe
  }
  const container = await mount()

  await act(async () => { await vi.waitFor(() => { if (!container.textContent?.includes("needs-owner")) throw new Error("snapshot agent is not rendered") }) })
  expect(stateOf(container, "needs-owner")).toBe("Waiting on a permission") // catches requests sorted into ordinary work
  expect(stateOf(container, "working-agent")).toBe("Working") // catches working agents hidden from the roster
  expect(stateOf(container, "idle-agent")).toBe("Idle") // catches idle agents treated as active

  // A stream state transition is authoritative over the snapshot's lane.
  await act(async () => { await Effect.runPromise(Deferred.succeed(stateChanged, envelope(8))) })
  expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ after: 7 }))
  expect(stateOf(container, "idle-agent")).toBe("Working") // catches ignoring live state transitions
})

it("7.2 resumes a dropped stream from its last applied cursor", async () => {
  let current = { ...snapshot, project: {
    sequence: 7, truncated: false, projects: [], repositories: [], workspaces: [], teams: [], agents: [], tasks: [], sprints: []
  } }
  const subscribe = vi.fn()
    .mockImplementationOnce(() => {
      // The committed state is already available to reads when event 8 is delivered.
      current = { ...current, sequence: 8, project: { ...current.project, sequence: 8 },
        agents: snapshot.agents.map((row) => row.agentId === "idle-agent" ? agent("idle-agent", "Working", { _tag: "working" }) : row) }
      return Stream.concat(
        Stream.fromIterable([envelope(8)]),
        Stream.fail(new Error("connection dropped"))
      )
    })
    .mockImplementation(() => Stream.fromIterable([{ _tag: "client.Checkpoint", sequence: 8 }]))
  const readSnapshot = vi.fn(() => Effect.succeed(current))
  browserClient.client = {
    "client.snapshot": readSnapshot, "client.subscribe": subscribe,
    "client.requests": () => Effect.succeed({ sequence: current.sequence, items: [] }),
    "client.alerts.list": () => Effect.succeed({ items: [] }),
    "client.sequence": () => Effect.succeed({ sequence: current.sequence })
  }
  const container = await mount()

  await act(async () => { await vi.waitFor(() => expect(subscribe.mock.calls.length).toBeGreaterThanOrEqual(2)) })
  expect(subscribe.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ after: 7 }))
  expect(subscribe.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ after: 8 })) // catches reconnecting from the old snapshot cursor and losing the transition
  expect(readSnapshot).toHaveBeenCalledTimes(1) // transport resume must retain the streamed state without fetching another snapshot
  expect(stateOf(container, "idle-agent")).toBe("Working")
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
  const attentionState = questions > 0 ? "Waiting on an answer" : name === "paused" ? "Paused for a limit" : name === "crashed" ? "Crashed" : "Interrupted"
  expect(stateOf(container, name)).toBe(attentionState)
  await act(async () => {
    current = { ...current, sequence: 8, agents: [...snapshot.agents, agent(name, "", { _tag: ordinary === "Working" ? "working" : "idle" })] }
    await live.emit(itemForSituation(8, name, "QuestionAnswered", questions === 0 ? { _tag: ordinary === "Working" ? "working" : "idle" } : undefined))
  })
  expect(stateOf(container, name)).toBe(ordinary)
  await act(async () => {
    current = { ...current, sequence: 9, agents: [...snapshot.agents, agent(name, "", state, 0, questions)] }
    await live.emit(itemForSituation(9, name, "QuestionAsked", questions === 0 ? state : undefined))
  })
  expect(stateOf(container, name)).toBe(attentionState)
  expect(stateOf(container, "needs-owner")).toBe("Waiting on a permission")
  expect(stateOf(container, "working-agent")).toBe("Working")
  expect(stateOf(container, "idle-agent")).toBe("Idle")
  await act(async () => {
    current = { ...current, sequence: 10, agents: [...snapshot.agents, agent(name, "", { _tag: ordinary === "Working" ? "working" : "idle" })] }
    await live.emit(itemForSituation(10, name, "QuestionAnswered", questions === 0 ? { _tag: ordinary === "Working" ? "working" : "idle" } : undefined))
  })
  expect(stateOf(container, name)).toBe(ordinary)
})

const itemForSituation = (sequence: number, agentId: string, tag: string, state?: object) => ({
  sequence, eventId: `event-${sequence}`, occurredAt: sequence, caller: { _tag: "owner" },
  event: state !== undefined ? { _tag: "StateChanged", agentId, state } : tag === "QuestionAsked"
    ? { _tag: tag, agentId, questionId: "question-1", holder: { _tag: "owner" }, deliveryId: "delivery-1", text: "Continue?" }
    : { _tag: tag, agentId, questionId: "question-1", answeredBy: { _tag: "owner" }, deliveryId: "delivery-2", text: "Continue." }
})
