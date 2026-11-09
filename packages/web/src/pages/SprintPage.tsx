import { useState } from "react"
import { sprintStatus } from "@lgcode/contracts"
import { useMutationDisabled, useShellData } from "../data/ShellDataProvider.tsx"
import { shellHref, type ShellRoute } from "../routes.ts"
import { RequestBlock, byRequestAge } from "../requests/RequestList.tsx"
import { DataText, visibleText } from "../thread/text.tsx"
import { AddTask } from "./AddTask.tsx"
import { Empty, ReadState, TaskTable, Time, agentName, EvidenceText } from "./common.tsx"
import { ownerRequests, sprintRequests, useProjectBoard } from "./projectData.ts"
import "./pages.css"
import { Icon } from "../shell/Icon.tsx"

export function SprintPage({ route }: { readonly route: ShellRoute }) {
  if (route.page !== "sprint") return null
  return <SprintContent key={`${route.projectId}/${route.sprintId}`} route={route} />
}
function SprintContent({ route }: { readonly route: Extract<ShellRoute, { page: "sprint" }> }) {
  const { navigation, snapshot, requests = [] } = useShellData()
  const { data: board, ready, failed } = useProjectBoard(route.projectId)
  const disabled = useMutationDisabled()
  const [adding, setAdding] = useState(false)
  if (navigation === undefined || board === undefined) return <section className="pages"><ReadState failed={failed} /></section>
  const project = navigation.projects.find((row) => row.projectId === route.projectId)
  const sprint = board.sprints.find((row) => row.sprintId === route.sprintId)
  if (project === undefined || sprint === undefined) return <section className="pages"><Empty>This sprint is unavailable.</Empty></section>
  const tasks = board.tasks.filter((row) => row.sprintId === sprint.sprintId)
  const blockers = ownerRequests(sprintRequests(requests, sprint)).sort(byRequestAge)
  const teams = navigation.teams.filter((row) => row.projectId === project.projectId && tasks.some((task) => task.teamId === row.teamId))
  const status = { active: "In progress", planned: "Planned", review: "In review", done: "Done" }[sprintStatus(sprint, tasks)]
  return <section className="pages" aria-label="Sprint detail"><div className="page-top"><a href={shellHref({ page: "project", projectId: project.projectId, tab: "board" })}><Icon name="arrow-left" /> Project board</a></div>
    <h1>{visibleText(sprint.name)}</h1><p className="detail-status">{visibleText(sprint.label)} · {sprint.phase} · {status}{blockers.length > 0 && <span className="is-wait"> · {blockers.length} requests need you</span>}</p>
    <div className="sprint-detail"><div>
      {blockers.length > 0 && <section className="detail-blockers" aria-label="What this sprint waits for">{blockers.map((row) => <RequestBlock key={`${row.kind}:${row.id}`} request={row} />)}</section>}
      <DataText text={sprint.goal} />
      <section className="detail-section"><div className="section-heading"><h2>Plan tasks</h2>{sprint.completion === undefined && <button disabled={!ready || disabled || project.archiving || project.archivedAt !== undefined} onClick={() => setAdding(true)}>Add task</button>}</div><TaskTable tasks={tasks} /></section>
      {sprint.completion !== undefined && <section className="detail-section"><h2>Completion evidence</h2>{sprint.evidence !== undefined && <EvidenceText text={sprint.evidence} projectId={project.projectId} board={board} />}
        <p>{visibleText(sprint.completion)}{sprint.completedAt !== undefined && <> · <Time at={sprint.completedAt} /></>}. Release status is tracked separately.</p></section>}
    </div><aside className="detail-sidebar" aria-label="Sprint context"><dl>
      <dt>Owner</dt><dd><a href={shellHref({ page: "thread", agentId: sprint.owner })}>{agentName(snapshot?.agents, sprint.owner)}</a></dd>
      <dt>Phase</dt><dd>{sprint.phase}</dd><dt>Team</dt><dd>{teams.length ? teams.map((row) => <a key={row.teamId} href={shellHref({ page: "project", projectId: project.projectId, teamId: row.teamId, tab: "tasks" })}>{visibleText(row.name)}</a>) : "Not assigned"}</dd>
      <dt>Depends on</dt><dd>{sprint.needs.length ? sprint.needs.map((id) => {
        const dependency = board.sprints.find((row) => row.sprintId === id)
        return dependency === undefined ? <span key={id}>{visibleText(id)} · Unavailable</span> : <a key={id} href={shellHref({ page: "sprint", projectId: project.projectId, sprintId: id })}>{visibleText(dependency.label)} · {visibleText(dependency.name)}</a>
      }) : "No dependencies"}</dd>
    </dl></aside></div>
    <AddTask project={project} board={board} open={adding} sprintId={sprint.sprintId} onClose={() => setAdding(false)}
      onCreated={(taskId) => { setAdding(false); location.hash = shellHref({ page: "task", projectId: project.projectId, taskId }).slice(2) }} />
  </section>
}
