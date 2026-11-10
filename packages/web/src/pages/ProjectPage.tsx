import { useEffect, useState } from "react"
import { projectStages, sprintStatus, type Sprint, type Project } from "@lgcode/contracts"
import { useMutationDisabled, useShellData } from "../data/ShellDataProvider.tsx"
import { shellHref, type ShellRoute } from "../routes.ts"
import { visibleText } from "../thread/text.tsx"
import { AddTask } from "./AddTask.tsx"
import { Empty, ReadState, TaskTable, agentName } from "./common.tsx"
import { ownerRequests, sprintRequests, useProjectBoard, type BoardData } from "./projectData.ts"
import "./pages.css"

const names = { planned: "Planned", active: "In progress", review: "Review", done: "Done" }

function SprintCard({ sprint, board }: { readonly sprint: Sprint; readonly board: BoardData }) {
  const { requests = [], snapshot } = useShellData()
  const tasks = board.tasks.filter((row) => row.sprintId === sprint.sprintId)
  const waiting = ownerRequests(sprintRequests(requests, sprint))
  const done = tasks.filter((row) => row.state === "done").length
  const status = sprintStatus(sprint, tasks)
  const dependency = board.sprints.find((row) => sprint.needs.includes(row.sprintId) && row.completion === undefined)
  return <a className={`sprint-card${waiting.length ? " needs-attention" : ""}`} data-sprint={sprint.sprintId}
    href={shellHref({ page: "sprint", projectId: sprint.projectId, sprintId: sprint.sprintId })}>
    {waiting.length > 0 && <span className="sprint-note">{waiting.length === 1 ? waiting[0]!.kind === "permission" ? "Needs approval" : "Needs answer" : `${waiting.length} requests need you`}</span>}
    <span className="sprint-id"><span className="sprint-list-state">{names[status]} · </span>{visibleText(sprint.label)} · {sprint.phase}</span>
    <h3>{visibleText(sprint.name)}</h3><p className="sprint-goal" title={visibleText(sprint.goal)}>{visibleText(sprint.goal)}</p>
    <span className="sprint-meta"><strong>{agentName(snapshot?.agents, sprint.owner)}</strong><span>{done ? `${done} of ${tasks.length} done` : tasks.length ? `${tasks.length} tasks` : "No tasks yet"}</span></span>
    {done > 0 && <progress max={tasks.length} value={done} aria-label={`${done} of ${tasks.length} tasks done`} />}
    {dependency !== undefined && <span className="sprint-dependency">Waiting on {visibleText(dependency.label)}</span>}
    {sprint.completion !== undefined && <span className="sprint-dependency">{visibleText(sprint.completion)} · Release status is tracked separately.</span>}
  </a>
}

function SprintBoard({ board }: { readonly board: BoardData }) {
  const { requests = [] } = useShellData()
  const [phone, setPhone] = useState(() => window.matchMedia?.("(max-width:700px)").matches ?? false)
  useEffect(() => {
    const media = window.matchMedia?.("(max-width:700px)")
    if (media === undefined) return
    const change = () => setPhone(media.matches)
    media.addEventListener("change", change)
    return () => media.removeEventListener("change", change)
  }, [])
  const status = (sprint: Sprint) => sprintStatus(sprint, board.tasks.filter((task) => task.sprintId === sprint.sprintId))
  if (phone) {
    const order = { active: 0, review: 1, planned: 2, done: 3 }
    const waiting = (sprint: Sprint) => ownerRequests(sprintRequests(requests, sprint)).length > 0
    const sorted = [...board.sprints].sort((a, b) => Number(waiting(b)) - Number(waiting(a)) || order[status(a)] - order[status(b)])
    return <ol className="board-list" aria-label="Sprints, those needing you first">{sorted.map((sprint) => <li key={sprint.sprintId}><SprintCard sprint={sprint} board={board} /></li>)}</ol>
  }
  return <div className="kanban">{(["planned", "active", "review", "done"] as const).map((key) => {
    const values = board.sprints.filter((row) => status(row) === key)
    return <section className="kanban-column" key={key} aria-label={names[key]} ref={(node) => { node?.style.setProperty("--cards", String(Math.max(1, values.length))) }}><h2>{names[key]} <small>{values.length}</small></h2>
      <div className="kanban-cards">{values.map((sprint) => <SprintCard key={sprint.sprintId} sprint={sprint} board={board} />)}</div>
      {!values.length && <p className="column-empty">No sprints here</p>}
    </section>
  })}</div>
}

export function ProjectPage({ route, hasScreens }: { readonly route: ShellRoute; readonly hasScreens?: boolean }) {
  if (route.page !== "project") return null
  return <ProjectContent key={`${route.projectId}/${route.teamId ?? ""}`} route={route} {...(hasScreens === undefined ? {} : { hasScreens })} />
}
function ProjectContent({ route, hasScreens }: { readonly route: Extract<ShellRoute, { page: "project" }>; readonly hasScreens?: boolean }) {
  const { navigation, snapshot } = useShellData()
  const { data: board, failed, ready } = useProjectBoard(route.projectId)
  const disabled = useMutationDisabled()
  const [adding, setAdding] = useState(false)
  const project = navigation?.projects.find((row) => row.projectId === route.projectId)
  if (navigation === undefined || board === undefined) return <section className="pages"><ReadState failed={failed} /></section>
  if (project === undefined) return <section className="pages"><Empty>This project is unavailable.</Empty></section>
  const team = navigation.teams.find((row) => row.projectId === route.projectId && row.teamId === route.teamId)
  if (route.teamId !== undefined && team === undefined) return <section className="pages"><Empty>This team is unavailable.</Empty></section>
  const tasks = board.tasks.filter((row) => route.teamId === undefined || row.teamId === route.teamId)
  const stage = team?.stage ?? project.stage
  const stages: ReadonlyArray<NonNullable<Project["stage"]>> = projectStages(hasScreens === true)
  const canAdd = ready && !disabled && !project.archiving && project.archivedAt === undefined
  return <section className="pages project-page" aria-label={route.tab === "tasks" ? "Team tasks" : "Project board"}>
    <ol className="stage-strip" aria-label="Project stages">{stages.map((value) => <li key={value} aria-current={stage === value ? "step" : undefined} className={stage !== undefined && stages.indexOf(value) < stages.indexOf(stage) ? "stage-passed" : ""}>{value === "handover" ? "Hand over" : value[0]!.toUpperCase() + value.slice(1)}</li>)}</ol>
    {project.archivedAt !== undefined && <p>Archived. Restore this project in Project settings to add work.</p>}
    {route.tab === "tasks" ? <><div className="section-heading"><h2>{tasks.filter((row) => row.state === "done").length} of {tasks.length} tasks complete</h2><button disabled={!canAdd} onClick={() => setAdding(true)}>Add task</button></div><TaskTable tasks={tasks} label="Team tasks" /></>
      : board.sprints.length ? <SprintBoard board={board} /> : hasScreens && project.stage === "design" ? <Empty action={<a className="primary" href={shellHref({ ...route, tab: "mocks" })}>Open the mocks</a>}>No sprints until you approve the mocks.</Empty> : <Empty action={<a className="primary" href={shellHref({ page: "thread", agentId: project.leadAgentId })}>Talk to {agentName(snapshot?.agents, project.leadAgentId)}</a>}>No sprints yet.</Empty>}
    <AddTask project={project} board={board} open={adding} {...(route.teamId === undefined ? {} : { teamId: route.teamId })} onClose={() => setAdding(false)}
      onCreated={(taskId) => { setAdding(false); location.hash = shellHref({ page: "task", projectId: project.projectId, taskId }).slice(2) }} />
  </section>
}
