import { useEffect, useState } from "react"
import type { AgentId, GitChange, Project, WorkspaceId } from "@lgtm/contracts"
import { sprintStatus } from "@lgtm/contracts"
import { useShellData } from "../data/ShellDataProvider.tsx"
import { useProjectBoard } from "../pages/projectData.ts"
import { shellHref } from "../routes.ts"
import { requestId, withClient } from "../thread/client.ts"
import { visibleText } from "../thread/text.tsx"

export function ConversationContext({ project, agentId, worktreeId }: {
  readonly project: Project; readonly agentId: AgentId; readonly worktreeId: WorkspaceId
}) {
  const { snapshot } = useShellData()
  const { data, failed } = useProjectBoard(project.projectId)
  const [changes, setChanges] = useState<{ readonly worktreeId: WorkspaceId; readonly items: ReadonlyArray<typeof GitChange.Type>; readonly truncated: boolean }>()
  const [refresh, setRefresh] = useState(0)
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setUnavailable(false)
    void withClient((client) => client["project.changes"]({ requestId: requestId(), projectId: project.projectId, worktreeId }), controller.signal)
      .then((reply) => {
        if (controller.signal.aborted) return
        if ("result" in reply) setChanges({ worktreeId, ...reply.result })
        else setUnavailable(true)
      }).catch(() => { if (!controller.signal.aborted) setUnavailable(true) })
    return () => controller.abort()
  }, [project.projectId, worktreeId, snapshot?.sequence, refresh])
  const lead = project.leadAgentId === agentId
  const task = data?.tasks.find((row) => row.owner === agentId && ["active", "review", "blocked"].includes(row.state))
  const sprints = data?.sprints.filter((row) => {
    const status = sprintStatus(row, data.tasks.filter((task) => task.sprintId === row.sprintId))
    return status === "active" || status === "review"
  })
  const files = changes?.worktreeId === worktreeId ? changes : undefined
  return <aside className="conversation-context" aria-label="Task and changes">
    <section><h2>{lead ? "Sprints in flight" : "Task"}</h2>
      {data === undefined ? <p>{failed ? "Work is unavailable. Retry from the project view." : "Loading work…"}</p>
        : lead ? sprints?.length ? <ul>{sprints.map((row) => <li key={row.sprintId}><a href={shellHref({ page: "sprint", projectId: project.projectId, sprintId: row.sprintId })}>{visibleText(row.label ?? row.sprintId)} · {visibleText(row.name)}</a></li>)}</ul> : <p>No sprints in flight.</p>
        : task ? <a href={shellHref({ page: "task", projectId: project.projectId, taskId: task.taskId })}>{visibleText(task.label ?? task.taskId)} · {visibleText(task.title)}</a> : <p>No task assigned.</p>}
    </section>
    <section><h2>Changed files</h2>
      {unavailable ? <p>Changed files are unavailable.</p> : files === undefined ? <p>Loading changes…</p>
        : files.items.length ? <ul>{files.items.map((row) => <li key={row.path}><code>{visibleText(row.path)}</code></li>)}</ul> : <p>No changed files.</p>}
      {files?.truncated && <p>Only the first changed files are shown.</p>}
      <button onClick={() => setRefresh((value) => value + 1)}>Refresh changed files</button>
      <a href={shellHref({ page: "project", projectId: project.projectId, tab: "git", workspaceId: worktreeId })}>Open Git</a>
    </section>
  </aside>
}
