import { useEffect, useState } from "react"
import type { Client } from "@lgtm/client/browser"
import { Sprint, Task, type ClientRequest, type ProjectId } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { useShellData } from "../data/ShellDataProvider.tsx"
import { requestId, withClient } from "../thread/client.ts"

export interface BoardData { readonly sprints: readonly Sprint[]; readonly tasks: readonly Task[] }

// Read the engine's projections, including its linked-request task state. A
// partial snapshot is never a complete board or permission to create a task.
export const readBoard = (client: Client, projectId: ProjectId) => Effect.gen(function* () {
  const before = yield* client["client.sequence"]({ requestId: requestId() })
  const read = (collection: "sprints" | "tasks") => Effect.gen(function* () {
    const rows: unknown[] = []
    const seen = new Set<string>()
    let after: string | undefined
    for (;;) {
      const page = yield* client["project.read"]({ requestId: requestId(), projectId, collection, limit: 200,
        ...(after === undefined ? {} : { after }) })
      if (!("items" in page)) return yield* Effect.fail(new Error("Board unavailable"))
      rows.push(...page.items)
      if (page.next === undefined) return rows
      if (!page.items.length || seen.has(page.next)) return yield* Effect.fail(new Error("Board cursor did not advance"))
      seen.add(page.next)
      after = page.next
    }
  })
  const sprints = yield* Schema.decodeUnknownEffect(Schema.Array(Sprint))(yield* read("sprints"))
  const tasks = yield* Schema.decodeUnknownEffect(Schema.Array(Task))(yield* read("tasks"))
  const after = yield* client["client.sequence"]({ requestId: requestId() })
  if (after.sequence !== before.sequence || sprints.some((row) => row.projectId !== projectId)
    || tasks.some((row) => row.projectId !== projectId)) return yield* Effect.fail(new Error("Board revision changed"))
  return { sprints, tasks } satisfies BoardData
})

export function useProjectBoard(projectId: ProjectId) {
  const { snapshot, complete } = useShellData()
  const [state, setState] = useState<{ projectId: ProjectId; sequence: number; data?: BoardData; failed?: boolean }>()
  const section = snapshot?.project
  const usable = section !== undefined && !section.truncated && !snapshot?.failedSections?.includes("project")
  useEffect(() => {
    if (usable || snapshot === undefined) return
    const controller = new AbortController()
    void withClient((client) => readBoard(client, projectId), controller.signal).then((data) => {
      if (!controller.signal.aborted) setState({ projectId, sequence: snapshot.sequence, data })
    }).catch(() => {
      if (!controller.signal.aborted) setState((previous) => ({ projectId, sequence: snapshot.sequence, failed: true,
        ...(previous?.projectId === projectId && previous.data !== undefined ? { data: previous.data } : {}) }))
    })
    return () => controller.abort()
  }, [projectId, snapshot, usable])
  const current = state?.projectId === projectId && state.sequence === snapshot?.sequence ? state : undefined
  const data = usable ? { sprints: section.sprints.filter((row) => row.projectId === projectId),
    tasks: section.tasks.filter((row) => row.projectId === projectId) } : state?.projectId === projectId ? state.data : undefined
  return { data, ready: data !== undefined && complete && (usable || current !== undefined && !current.failed), failed: current?.failed === true }
}

export const ownerRequests = (requests: readonly ClientRequest[]) => requests.filter((row) => row.status === "open" && row.holder._tag === "owner")
export const taskRequests = (requests: readonly ClientRequest[], task: Task) => requests.filter((row) => row.projectId === task.projectId && row.taskId === task.taskId)
export const sprintRequests = (requests: readonly ClientRequest[], sprint: Sprint) => requests.filter((row) => row.projectId === sprint.projectId && row.sprintId === sprint.sprintId)
export const taskStatus = (task: Task, requests: readonly ClientRequest[]) => {
  const linked = taskRequests(requests, task).filter((row) => row.status === "open")
  return linked.some((row) => row.kind === "permission") ? "Blocked by an approval"
    : linked.length ? "Needs answer" : ({ queue: "Up next", active: "In progress", review: "In review", blocked: "Blocked", done: "Done" })[task.state]
}
