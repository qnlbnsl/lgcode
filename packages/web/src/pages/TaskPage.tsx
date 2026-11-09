import { useEffect, useState } from "react"
import { TaskHistoryEntry, type ProjectId, type TaskId } from "@lgcode/contracts"
import type { Client } from "@lgcode/client/browser"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { useShellData } from "../data/ShellDataProvider.tsx"
import { shellHref, type ShellRoute } from "../routes.ts"
import { RequestBlock, byRequestAge } from "../requests/RequestList.tsx"
import { requestId, withClient } from "../thread/client.ts"
import { DataText, visibleText } from "../thread/text.tsx"
import { Empty, ReadState, Time, agentName, EvidenceText } from "./common.tsx"
import { ownerRequests, taskRequests, taskStatus, useProjectBoard } from "./projectData.ts"
import "./pages.css"
import { Icon } from "../shell/Icon.tsx"

export const readTaskHistory = (client: Client, projectId: ProjectId, taskId: TaskId) => Effect.gen(function* () {
  const before = yield* client["client.sequence"]({ requestId: requestId() })
  const items: TaskHistoryEntry[] = []
  const seen = new Set<string>()
  let after: string | undefined
  for (;;) {
    const page = yield* client["project.task.history"]({ requestId: requestId(), projectId, taskId, limit: 200,
      ...(after === undefined ? {} : { after }) })
    if (!("items" in page)) return yield* Effect.fail(new Error("History unavailable"))
    items.push(...(yield* Schema.decodeUnknownEffect(Schema.Array(TaskHistoryEntry))(page.items)))
    if (page.next === undefined) break
    if (!page.items.length || seen.has(page.next)) return yield* Effect.fail(new Error("History cursor did not advance"))
    seen.add(page.next)
    after = page.next
  }
  const final = yield* client["client.sequence"]({ requestId: requestId() })
  if (final.sequence !== before.sequence) return yield* Effect.fail(new Error("History revision changed"))
  return items.sort((a, b) => a.sequence - b.sequence)
})

export { EvidenceText } from "./common.tsx"

export function TaskPage({ route }: { readonly route: ShellRoute }) {
  if (route.page !== "task") return null
  return <TaskContent key={`${route.projectId}/${route.taskId}`} route={route} />
}
function TaskContent({ route }: { readonly route: Extract<ShellRoute, { page: "task" }> }) {
  const { navigation, snapshot, requests = [] } = useShellData()
  const { data: board, failed } = useProjectBoard(route.projectId)
  const [history, setHistory] = useState<readonly TaskHistoryEntry[]>()
  const [historyFailed, setHistoryFailed] = useState(false)
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setHistoryFailed(false)
    void withClient((client) => readTaskHistory(client, route.projectId, route.taskId), controller.signal).then((rows) => {
      if (!controller.signal.aborted) setHistory(rows)
    }).catch(() => { if (!controller.signal.aborted) setHistoryFailed(true) })
    return () => controller.abort()
  }, [route.projectId, route.taskId, snapshot?.sequence, generation])
  if (navigation === undefined || board === undefined) return <section className="pages"><ReadState failed={failed} /></section>
  const project = navigation.projects.find((row) => row.projectId === route.projectId)
  const task = board.tasks.find((row) => row.taskId === route.taskId)
  if (project === undefined || task === undefined) return <section className="pages"><Empty>This task is unavailable.</Empty></section>
  const sprint = board.sprints.find((row) => row.sprintId === task.sprintId)
  const workspace = navigation.workspaces.find((row) => row.worktreeId === task.worktreeId)
  const team = navigation.teams.find((row) => row.projectId === project.projectId && row.teamId === task.teamId)
  const blockers = ownerRequests(taskRequests(requests, task)).sort(byRequestAge)
  return <section className="pages" aria-label="Task detail"><div className="page-top">
    <a href={shellHref({ page: "sprint", projectId: project.projectId, sprintId: task.sprintId })}><Icon name="arrow-left" /> {visibleText(sprint?.label ?? task.sprintId)}{sprint && <> · {visibleText(sprint.name)}</>}</a>
    <div className="page-actions"><a href={shellHref({ page: "project", projectId: project.projectId, teamId: task.teamId, workspaceId: task.worktreeId, tab: "git" })}>View changes</a>
      <a href={shellHref({ page: "thread", agentId: task.owner })}>Talk to {agentName(snapshot?.agents, task.owner)}</a></div>
    </div><h1>{visibleText(task.title)}</h1><p className="detail-status">{visibleText(task.label ?? task.taskId)} · {taskStatus(task, requests)}</p>
    <div className="sprint-detail"><div>
      {blockers.length > 0 && <section className="detail-blockers" aria-label="What this task waits for">{blockers.map((row) => <RequestBlock key={`${row.kind}:${row.id}`} request={row} />)}</section>}
      {task.story !== undefined && <><DataText text={task.story.summary} />{task.story.done.length > 0 && <section className="detail-section"><h2>Done when</h2><ul>{task.story.done.map((line, index) => <li key={index}><EvidenceText text={line} projectId={project.projectId} board={board} /></li>)}</ul></section>}</>}
      {task.story !== undefined && task.story.activity.length > 0 && <section className="detail-section"><h2>All work</h2><ol className="task-timeline story-timeline">{task.story.activity.map((step, index) => {
        const question = "question" in step ? requests.find((row) => row.kind === "question" && row.id === step.question) : undefined
        const answered = question?.status === "answered"
        const content = "question" in step ? answered ? step.answered : step.open : step
        const at = question === undefined ? step.at : answered ? question.answeredAt : question.openedAt
        return <li key={index} className={question?.status === "open" ? "waiting" : ""}><strong>{visibleText(content.title)}</strong>{at !== undefined && <Time at={at} />}<EvidenceText text={content.detail} projectId={project.projectId} board={board} /></li>
      })}</ol></section>}
      <section className="detail-section"><h2>Activity</h2>{historyFailed && <div role="alert"><p>Could not refresh the task's history.</p><button onClick={() => setGeneration((value) => value + 1)}>Try again</button></div>}
        {history === undefined ? <p role="status">Loading activity…</p> : history.length === 0 ? <p>No activity recorded.</p>
          : <ol className="task-timeline">{history.map((entry, index) => <li key={`${entry.sequence}/${index}`} className={entry.state === "blocked" ? "waiting" : ""}>
            <strong>{visibleText(entry.title)}</strong><Time at={entry.at} /><EvidenceText text={entry.detail} projectId={project.projectId} board={board} />
          </li>)}</ol>}
      </section>
    </div><aside className="detail-sidebar" aria-label="Task context"><dl>
      <dt>Status</dt><dd>{taskStatus(task, requests)}</dd><dt>Owner</dt><dd><a href={shellHref({ page: "thread", agentId: task.owner })}>{agentName(snapshot?.agents, task.owner)}</a></dd>
      <dt>Team</dt><dd><a href={shellHref({ page: "project", projectId: project.projectId, teamId: task.teamId, tab: "tasks" })}>{visibleText(team?.name ?? task.teamId)}</a></dd>
      <dt>Branch</dt><dd><code className="tail" title={visibleText(workspace?.branch ?? "Unavailable")}>{visibleText(workspace?.branch ?? "Unavailable")}</code></dd>
      <dt>Worktree</dt><dd><code className="tail" title={visibleText(workspace?.path ?? "Unavailable")}>{visibleText(workspace?.path ?? "Unavailable")}</code></dd>
    </dl></aside></div>
  </section>
}
