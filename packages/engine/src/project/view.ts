import type { Event, ProjectView, ProjectTaskRecord, TaskHistoryEntry } from "@lgcode/contracts"
import type { Snapshot } from "../commands/internal.ts"

export const own = <T>(rows: Readonly<Record<string, T>>, id: string): T | undefined => Object.hasOwn(rows, id) ? rows[id] : undefined
export const projectKey = (projectId: string, id: string) => JSON.stringify([projectId, id])
export const projectView = (snapshot: Snapshot): ProjectView => snapshot.project as ProjectView
const empty = <T>(): Readonly<Record<string, T>> => Object.create(null)
export const emptyProject = (): ProjectView => ({ repositories: empty(), locations: empty(), workspaces: empty(), projects: empty(), teams: empty(), sprints: empty(), tasks: empty(), agentProjects: empty(), parents: empty() })
const change = <T>(rows: Readonly<Record<string, T>>, id: string, f: (row: T) => T) => {
  const row = own(rows, id)
  return row === undefined ? rows : { ...rows, [id]: f(row) }
}
// The fourth reducer argument is the persisted envelope time. Replay and live
// publication must never create a new clock value for a task's history.
export const projectAfter = (view: ProjectView, event: Event, sequence: number, occurredAt: number): ProjectView => {
  const at = occurredAt as TaskHistoryEntry["at"]
  const seq = sequence as TaskHistoryEntry["sequence"]
  switch (event._tag) {
    case "AgentStarted": {
      const parent = event.parent._tag === "agent" ? event.parent.agentId : undefined
      const projectId = parent === undefined ? undefined : own(view.agentProjects, parent)
      return { ...view, ...(parent === undefined ? {} : { parents: { ...view.parents, [event.agentId]: parent } }),
        ...(projectId === undefined ? {} : { agentProjects: { ...view.agentProjects, [event.agentId]: projectId } }) }
    }
    case "project.SettingsChanged": return { ...view, settings: event.settings }
    case "project.RepositoryAdded": { const { _tag, ...row } = event; return { ...view, repositories: { ...view.repositories, [row.repoId]: row } } }
    case "project.RepositoryLocated": { const { _tag, ...row } = event; return { ...view, locations: { ...view.locations, [projectKey(row.repoId, row.machineId)]: row } } }
    case "project.WorktreeCreated": { const { _tag, ...row } = event; return { ...view, workspaces: { ...view.workspaces, [row.worktreeId]: row } } }
    case "project.Created": {
      const { _tag, ...row } = event
      const memberships = { ...view.agentProjects, [row.leadAgentId]: row.projectId }
      // A record can be created for a lead whose children already exist.
      let changed = true
      while (changed) {
        changed = false
        for (const [child, parent] of Object.entries(view.parents)) {
          if (own(memberships, child) === undefined && own(memberships, parent) === row.projectId) { memberships[child] = row.projectId; changed = true }
        }
      }
      return { ...view, projects: { ...view.projects, [row.projectId]: { ...row, stage: row.stage ?? "plan" } }, agentProjects: memberships }
    }
    case "project.Placed": return { ...view, projects: change(view.projects, event.projectId, (row) => ({ ...row, machineId: event.machineId, worktreeId: event.worktreeId })) }
    case "project.PreferencesChanged": return { ...view, projects: change(view.projects, event.projectId, (row) => ({ ...row, shell: event.shell })) }
    case "project.Renamed": return { ...view, projects: change(view.projects, event.projectId, (row) => ({ ...row, name: event.name })) }
    case "project.StageChanged": return { ...view, projects: change(view.projects, event.projectId, (row) => ({ ...row, stage: event.stage })) }
    case "project.TeamAdded": { const { _tag, ...row } = event; return { ...view, teams: { ...view.teams, [projectKey(row.projectId, row.teamId)]: row } } }
    case "project.SprintAdded": { const { _tag, ...row } = event; return { ...view, sprints: { ...view.sprints, [projectKey(row.projectId, row.sprintId)]: row } } }
    case "project.SprintChanged": { const { _tag, projectId, sprintId, ...patch } = event; return { ...view, sprints: change(view.sprints, projectKey(projectId, sprintId), (row) => ({ ...row, ...patch })) } }
    case "project.SprintCompleted": return { ...view, sprints: change(view.sprints, projectKey(event.projectId, event.sprintId), (row) => ({ ...row, completion: event.completion, evidence: event.evidence, completedAt: at })) }
    case "project.TaskAdded": {
      const { _tag, ...row } = event
      const activity = row.story?.activity.map((step) => ({ ...step, at: step.at ?? at }))
      const history: TaskHistoryEntry[] = [{ sequence: seq, at, state: row.state, title: "Task added", detail: row.title },
        ...(activity ?? []).map((step) => ({ sequence: seq, at: step.at, state: row.state,
          ...("question" in step ? step.open : { title: step.title, detail: step.detail }) }))]
      const task: ProjectTaskRecord = { ...row, ...(row.story === undefined ? {} : { story: { ...row.story, activity: activity! } }), history }
      return { ...view, tasks: { ...view.tasks, [projectKey(row.projectId, row.taskId)]: task } }
    }
    case "project.TaskChanged": {
      const { _tag, projectId, taskId, note, ...patch } = event
      return { ...view, tasks: change(view.tasks, projectKey(projectId, taskId), (row) => ({ ...row, ...patch,
        history: [...row.history, { sequence: seq, at, state: patch.state ?? row.state, title: "Task updated", detail: note ?? patch.title ?? patch.state ?? "Assignment updated" }] })) }
    }
    case "project.TaskNoted": return { ...view, tasks: change(view.tasks, projectKey(event.projectId, event.taskId), (row) => ({ ...row,
      history: [...row.history, { sequence: seq, at, state: row.state, title: event.title, detail: event.detail }] })) }
    default: return view
  }
}
