import type { Client } from "@lgtm/client/browser"
import { EventEnvelope, type EventSequence, type MockApproval, type MockRevision, type ProjectId, type RequestId } from "@lgtm/contracts"
import * as Schema from "effect/Schema"
import * as Effect from "effect/Effect"
import { requestId } from "../thread/client.ts"

// The engine returns oldest first. A partial page cannot identify the head.
export const readMockHistory = (client: Client, projectId: ProjectId) => Effect.gen(function* () {
  const initial = yield* client["client.sequence"]({ requestId: requestId() })
  const items: MockRevision[] = [], seen = new Set<string>()
  let after: RequestId | undefined, approval: MockApproval | undefined
  for (let page = 0; page < 100; page++) {
    const reply = yield* client["project.mocks.read"]({ requestId: requestId(), projectId, ...(after === undefined ? {} : { after }) })
    if (!("items" in reply)) return { items, complete: false, reason: "Mock history is unavailable." } as const
    for (const row of reply.items) {
      if (seen.has(row.revisionId)) return { items, complete: false, reason: "Mock history changed while loading. Refresh it." } as const
      seen.add(row.revisionId); items.push(row)
    }
    approval = reply.approval
    if (reply.next === undefined) {
      const final = yield* client["client.sequence"]({ requestId: requestId() })
      if (final.sequence !== initial.sequence) return { items, complete: false, reason: "Mock history changed while loading. Refresh it." } as const
      return { items, complete: true, ...(approval === undefined ? {} : { approval }) } as const
    }
    if (reply.next === after || !seen.has(reply.next) || reply.items.length === 0) {
      return { items, complete: false, reason: "Mock history did not advance. Refresh it." } as const
    }
    after = reply.next
  }
  return { items, complete: false, reason: "More mock history is available. Refresh before approving." } as const
})
export type MockHistory = Effect.Success<ReturnType<typeof readMockHistory>>

export const screenRoute = (revision: MockRevision, screenId: string, scenarioId?: string): string | undefined => {
  const screen = revision.bundle.screens.find((row) => row.screenId === screenId)
  if (screen === undefined) return undefined
  if (scenarioId === undefined) return screen.route
  if (!revision.bundle.scenarios.some((row) => row.scenarioId === scenarioId)) return undefined
  const routes = screen.scenarioRoutes.filter((row) => row.scenarioId === scenarioId)
  return routes.length === 1 ? routes[0]!.route : undefined
}

export const artifactState = (revision: MockRevision, sourceId: string, result: { readonly _tag: "available"; readonly fingerprint: string } | { readonly _tag: "unavailable" }) => {
  if (result._tag === "unavailable") return "unavailable"
  const recorded = revision.artifacts.find((row) => row.sourceId === sourceId)?.fingerprint
  return recorded === result.fingerprint ? "current" : "stale"
}

// A public CommandError can also encode a database or receipt failure. Only
// an authenticated durable refusal for this exact owner command retires it.
// The bounded search may miss older evidence; absence stays uncertain.
const approvalRefused = (client: Client, original: RequestId) => Effect.gen(function* () {
  const id = requestId(), head = yield* client["client.sequence"]({ requestId: id })
  if (head.requestId !== id) return false
  for (let sequence = head.sequence; sequence > Math.max(0, head.sequence - 64); sequence--) {
    const readId = requestId()
    const reply = yield* client["client.event"]({ requestId: readId, sequence: sequence as EventSequence })
    if (reply.requestId !== readId || !("envelope" in reply) || !Schema.is(EventEnvelope)(reply.envelope)) continue
    const row = reply.envelope
    if (row.sequence === sequence && row.requestId === original && row.caller._tag === "owner"
      && row.event._tag === "CommandRefused" && row.event.command === "project.mocks.approve") return true
  }
  return false
}).pipe(Effect.catch(() => Effect.succeed(false)))

// Revalidation prevents an old selection being silently replaced with the head.
// The engine performs the final artifact/head check atomically with approval.
export const approveMockRevision = (client: Client, projectId: ProjectId, revisionId: RequestId, approvalId: RequestId) => Effect.gen(function* () {
  const history = yield* readMockHistory(client, projectId)
  if (!history.complete) return { state: "uncertain" as const, history }
  if (history.items.at(-1)?.revisionId !== revisionId) return { state: "stale" as const, history }
  if (history.approval?.revisionId === revisionId) return { state: "approved" as const, history }
  const result = yield* client["project.mocks.approve"]({ requestId: approvalId, projectId, revisionId }).pipe(Effect.result)
  if (result._tag === "Failure") {
    const current = yield* readMockHistory(client, projectId)
    if (current.complete && current.approval?.revisionId === revisionId) return { state: "approved" as const, history: current }
    if (current.complete && current.items.at(-1)?.revisionId !== revisionId) return { state: "stale" as const, history: current }
    return { state: (yield* approvalRefused(client, approvalId)) ? "refused" as const : "uncertain" as const, history: current }
  }
  return { state: "approved" as const, history: yield* readMockHistory(client, projectId) }
})
