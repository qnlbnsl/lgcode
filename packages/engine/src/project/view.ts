import type { Event, ProjectView, ProjectTaskRecord, TaskHistoryEntry } from "@lgtm/contracts"
import type { Snapshot } from "../commands/internal.ts"

export const own = <T>(rows: Readonly<Record<string, T>>, id: string): T | undefined => Object.hasOwn(rows, id) ? rows[id] : undefined
export const projectKey = (projectId: string, id: string) => JSON.stringify([projectId, id])
export const projectView = (snapshot: Snapshot): ProjectView => snapshot.project as ProjectView
const empty = <T>(): Readonly<Record<string, T>> => Object.create(null)
export const emptyProject = (): ProjectView => ({ gitAttempts: empty(), gitEvidence: empty(), gitReviews: empty(), taskNotifications: empty(), setup: { step: "welcome" }, mockRevisions: empty(), mockHeads: empty(), mockApprovals: empty(), designs: empty(), designHeads: empty(), creations: empty(), repositories: empty(), locations: empty(), workspaces: empty(), projects: empty(), teams: empty(), sprints: empty(), tasks: empty(), agentProjects: empty(), parents: empty() })
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
    case "project.GitAttempted": return { ...view, gitAttempts: { ...view.gitAttempts,
      [projectKey(event.attempt.caller._tag === "owner" ? "owner" : `agent:${event.attempt.caller.agentId}`, event.attempt.requestId)]: event.attempt } }
    case "project.GitFinished": {
      const key = projectKey(event.caller._tag === "owner" ? "owner" : `agent:${event.caller.agentId}`, event.operationRequestId)
      const { [key]: _finished, ...gitAttempts } = view.gitAttempts
      return { ...view, gitAttempts }
    }
    case "project.DesignRecorded": {
      const { _tag, ...record } = event
      return { ...view, designs: { ...view.designs, [projectKey(event.design.repoId, event.revisionId)]: { ...record, at } },
        designHeads: { ...view.designHeads, [event.design.repoId]: event.revisionId } }
    }
    case "project.SetupAdvanced": {
      const steps = ["welcome", "found", "project"]
      return steps.indexOf(event.step) > steps.indexOf(view.setup.step) && view.setup.completedAt === undefined ? { ...view, setup: { ...view.setup, step: event.step } } : view
    }
    case "project.SetupCompleted": return view.setup.completedAt !== undefined ? view : { ...view, setup: { step: "project", projectId: event.projectId, completedAt: at } }
    case "project.MockRecorded": {
      const { _tag, ...revision } = event
      return { ...view, mockHeads: { ...view.mockHeads, [event.projectId]: event.revisionId },
        mockRevisions: { ...view.mockRevisions, [projectKey(event.projectId, event.revisionId)]: { ...revision, at } } }
    }
    case "project.MockApproved": {
      const { _tag, ...approval } = event
      return { ...view, mockApprovals: { ...view.mockApprovals, [projectKey(event.projectId, event.approvalId)]: { ...approval, at } } }
    }
    // Retain only the latest report per kind and latest review per workspace
    // in the projection. The durable log preserves the complete history.
    case "project.GitEvidenceReported": return { ...view, gitEvidence: { ...view.gitEvidence, [projectKey(event.report.worktreeId, event.report.kind)]: event.report } }
    case "project.MainReviewOpened":
    case "project.MainReviewDecided": return { ...view, gitReviews: { ...view.gitReviews, [event.review.worktreeId]: event.review } }
    case "AgentStarted": {
      const parent = event.parent._tag === "agent" ? event.parent.agentId : undefined
      const projectId = parent === undefined ? undefined : own(view.agentProjects, parent)
      return { ...view, ...(parent === undefined ? {} : { parents: { ...view.parents, [event.agentId]: parent } }),
        ...(projectId === undefined ? {} : { agentProjects: { ...view.agentProjects, [event.agentId]: projectId } }) }
    }
    case "project.SettingsChanged": return { ...view, settings: event.settings }
    case "project.CreationPlanned": return { ...view, creations: { ...view.creations, [event.creation.requestId]: event.creation } }
    case "project.CreationClaimed": return { ...view, creations: change(view.creations, event.creationRequestId, (row) => ({ ...row,
      [event.kind === "repository" ? "repositoryIdentity" : "folderIdentity"]: event.identity })) }
    case "project.CreationFinished": { const creations = { ...view.creations }; delete creations[event.creationRequestId]; return { ...view, creations } }
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
    case "project.GoalChanged": return { ...view, projects: change(view.projects, event.projectId, (row) => ({ ...row, goal: event.goal })) }
    case "project.ArchiveStarted": return { ...view, projects: change(view.projects, event.projectId, (row) => ({ ...row, archiving: true })) }
    case "project.Archived": return { ...view, projects: change(view.projects, event.projectId, (row) => ({ ...row, archiving: false, archivedAt: at })) }
    case "project.Restored": return { ...view, projects: change(view.projects, event.projectId, (row) => { const { archivedAt: _a, ...rest } = row; return { ...rest, archiving: false } }) }
    case "project.StageChanged": return { ...view, projects: change(view.projects, event.projectId, (row) => ({ ...row, stage: event.stage })) }
    case "project.TeamAdded": { const { _tag, ...row } = event; return { ...view, teams: { ...view.teams, [projectKey(row.projectId, row.teamId)]: row } } }
    case "project.SprintAdded": { const { _tag, ...row } = event; return { ...view, sprints: { ...view.sprints, [projectKey(row.projectId, row.sprintId)]: row } } }
    case "project.SprintChanged": { const { _tag, projectId, sprintId, ...patch } = event; return { ...view, sprints: change(view.sprints, projectKey(projectId, sprintId), (row) => ({ ...row, ...patch })) } }
    case "project.SprintCompleted": return { ...view, sprints: change(view.sprints, projectKey(event.projectId, event.sprintId), (row) => ({ ...row, completion: event.completion, evidence: event.evidence, completedAt: at })) }
    case "project.OwnerTaskNotificationPlanned": {
      const { _tag, ...row } = event
      return { ...view, taskNotifications: { ...view.taskNotifications, [row.notificationId]: row } }
    }
    case "DeliveryQueued": {
      const source = event.delivery.source
      if (source?._tag !== "piece" || source.namespace !== "project" || !source.id.startsWith("task-notification:")) return view
      const id = source.id.slice("task-notification:".length)
      const row = own(view.taskNotifications, id)
      if (row === undefined || row.deliveryId !== undefined || row.targetAgentId !== event.delivery.target) return view
      return { ...view, taskNotifications: { ...view.taskNotifications, [id]: { ...row, deliveryId: event.delivery.id } } }
    }
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
