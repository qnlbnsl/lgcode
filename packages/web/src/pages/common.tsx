import type { ReactNode } from "react"
import type { ClientSnapshot, ProjectId, Task } from "@lgcode/contracts"
import { useShellData } from "../data/ShellDataProvider.tsx"
import { shellHref, type ShellRoute } from "../routes.ts"
import { visibleText } from "../thread/text.tsx"
import { taskStatus, type BoardData } from "./projectData.ts"

export function Time({ at }: { readonly at: number }) {
  return <time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()}>{new Date(at).toLocaleString(undefined,
    { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
}

export function Empty({ children, action }: { readonly children: ReactNode; readonly action?: ReactNode }) {
  return <div className="page-empty" tabIndex={-1}><p>{children}</p>{action}</div>
}

export function ReadState({ failed = false }: { readonly failed?: boolean }) {
  const { retry } = useShellData()
  return <div role={failed ? "alert" : "status"}><p>{failed ? "Could not load this view. The last received data may be incomplete." : "Loading…"}</p>
    <button onClick={retry}>Try again</button></div>
}

export const agentName = (agents: ClientSnapshot["agents"] | undefined, id: string) => visibleText(agents?.find((row) => row.agentId === id)?.name ?? id)

export function TaskTable({ tasks, label = "Plan tasks" }: { readonly tasks: readonly Task[]; readonly label?: string }) {
  const { snapshot, requests = [] } = useShellData()
  if (!tasks.length) return <Empty>No tasks yet.</Empty>
  return <div className="task-table-wrap"><table className="task-list" aria-label={label}>
    <thead><tr><th className="task-id">Task</th><th>Title</th><th>Status</th><th>Owner</th></tr></thead>
    <tbody>{tasks.map((task) => <tr key={task.taskId}>
      <td className="task-id">{visibleText(task.label ?? task.taskId)}</td>
      <td className="task-title"><a href={shellHref({ page: "task", projectId: task.projectId, taskId: task.taskId })} title={visibleText(task.title)}>{visibleText(task.title)}</a></td>
      <td className={`task-status ${task.state === "blocked" ? "is-wait" : ""}`}>{taskStatus(task, requests)}</td>
      <td className="task-owner"><a href={shellHref({ page: "thread", agentId: task.owner })}>{agentName(snapshot?.agents, task.owner)}</a></td>
    </tr>)}</tbody>
  </table></div>
}

// Only protocol references to actual project records become links. Everything
// else, including arbitrary Markdown and HTML supplied by an agent, stays text.
export function EvidenceText({ text, projectId, board }: { readonly text: string; readonly projectId: ProjectId; readonly board: BoardData }) {
  const parts: ReactNode[] = []
  let offset = 0
  for (const match of text.matchAll(/\[([^\]\n]+)\]\((task|sprint|board):([^\)\n]*)\)/gu)) {
    parts.push(visibleText(text.slice(offset, match.index)))
    const kind = match[2]
    const id = match[3]!
    const task = kind === "task" ? board.tasks.find((row) => row.taskId === id || row.label === id) : undefined
    const sprint = kind === "sprint" ? board.sprints.find((row) => row.sprintId === id || row.label === id) : undefined
    const route: ShellRoute | undefined = task !== undefined ? { page: "task", projectId, taskId: task.taskId }
      : sprint !== undefined ? { page: "sprint", projectId, sprintId: sprint.sprintId }
      : kind === "board" && id === projectId ? { page: "project", projectId, tab: "board" } : undefined
    parts.push(route === undefined ? visibleText(match[0]) : <a key={match.index} href={shellHref(route)}>{visibleText(match[1]!)}</a>)
    offset = match.index + match[0].length
  }
  parts.push(visibleText(text.slice(offset)))
  return <p className="evidence-text">{parts}</p>
}
