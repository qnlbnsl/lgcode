import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { afterEach, vi } from "vitest"
import { App } from "../src/index.ts"

const browserClient = vi.hoisted(() => ({ client: undefined as unknown, connect: vi.fn() }))
vi.mock("@lgcode/client/browser", async () => {
  const Effect = await import("effect/Effect")
  return { connect: (...args: unknown[]) => { browserClient.connect(...args); return Effect.succeed(browserClient.client) } }
})

export const requestId = "permission-1"
export const agentId = "worker-1"
export const item = (sequence: number, event: Record<string, unknown>) => ({
  sequence, eventId: `event-${sequence}`, occurredAt: sequence,
  caller: { _tag: "owner" }, event: { agentId, ...event }
})

export const permissionRequest = (fields: Record<string, unknown> = {}) => item(2, {
  _tag: "PermissionRequested", permissionRequestId: requestId, holder: { _tag: "owner" }, deliveryId: "delivery-1",
  toolCallId: "tool-1", description: "Run command", options: [
    { id: "allow-once", name: "Allow", persistent: false },
    { id: "allow-always", name: "Allow always", persistent: true }
  ], settingsWrite: false, ...fields
})

const rosterAgent = {
  agentId, name: "Worker one", role: "worker", groups: [], parent: { _tag: "owner" }, state: { _tag: "working" },
  displayedState: "Working", openPermissionRequests: 0, openQuestionsAsked: 0, harness: "codex", account: "default",
  permission: "ask", folder: "/work", startedAt: 1
}

export const roots: Array<{ container: HTMLDivElement; root: Root }> = []
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export const mountThread = async (items: ReadonlyArray<unknown>, extraClient: Record<string, unknown> = {}, path = `/thread/${agentId}`, waitForThread = true) => {
  window.history.replaceState({}, "", path)
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  roots.push({ container, root })
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  let revision = 1
  const fixtureClient = {
    "client.snapshot": () => Effect.succeed({ sequence: 1, agents: [rosterAgent], requests: [], questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0, project: { sequence: 1, truncated: false, repositories: [], workspaces: [], projects: [], teams: [], agents: [], sprints: [], tasks: [] } }),
    "client.subscribe": () => Stream.never,
    "client.requests": () => Effect.succeed({ sequence: revision, items: [] }),
    "client.alerts.list": () => Effect.succeed({ items: [] }),
    "client.sequence": () => Effect.succeed({ sequence: revision }),
    "client.thread": () => Effect.succeed({ items, next: undefined }),
    answer: vi.fn(() => Effect.succeed({})),
    prompt: vi.fn(() => Effect.succeed({})),
    ...extraClient
  }
  type SnapshotFixture = { sequence: number; agents: ReadonlyArray<Partial<typeof rosterAgent>>; project?: unknown }
  const snapshotRead = fixtureClient["client.snapshot"] as (...args: unknown[]) => Effect.Effect<SnapshotFixture, unknown>
  const subscribe = fixtureClient["client.subscribe"] as (payload: { filter?: unknown }) => Stream.Stream<unknown, unknown>
  // A mounted thread now has an independent shell subscription. Thread tests
  // drive only the agent-filtered connection; shell tests drive the unfiltered
  // one explicitly. This preserves their independent cursor assertions.
  browserClient.client = { ...fixtureClient,
    "client.snapshot": (...args: unknown[]) => snapshotRead(...args).pipe(Effect.map((value) => {
      revision = value.sequence
      return { ...value, agents: value.agents.map((row) => ({ ...rosterAgent, ...row })),
        project: value.project ?? { sequence: value.sequence, truncated: false, repositories: [], workspaces: [], projects: [], teams: [], agents: [], sprints: [], tasks: [] } }
    })),
    "client.subscribe": (payload: { filter?: unknown }) => payload.filter === undefined && path !== "/" ? Stream.never : subscribe(payload)
  }
  await act(async () => { root.render(<App />) })
  if (waitForThread) await act(async () => {
    await vi.waitFor(() => {
      if (!container.textContent?.includes("Worker one")) throw new Error("owner view has not loaded")
    })
  })
  return container
}

export const cleanupThread = async () => {
  for (const { container, root } of roots.splice(0)) {
    await act(async () => { root.unmount() })
    container.remove()
  }
  window.history.replaceState({}, "", "/")
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  browserClient.connect.mockReset()
  browserClient.client = undefined
}

afterEach(cleanupThread)
