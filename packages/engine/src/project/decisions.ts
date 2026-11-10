import type { AgentId, ProjectRequestLink, Task, ProjectTaskRecord, TaskHistoryEntry } from "@lgcode/contracts"
import * as Effect from "effect/Effect"
import { refused, type Snapshot } from "../commands/internal.ts"
import { cutUtf8 } from "../client/reads/display.ts"
import { canLeadProject } from "./access.ts"
import { own, projectKey, projectView } from "./view.ts"

// Caller metadata never establishes membership. Optional old metadata remains
// decodable, but only an admitted project identity can authorize completion.
export const questionLinks = (snapshot: Snapshot, agentId: AgentId, link: ProjectRequestLink) => Effect.gen(function* () {
  const view = projectView(snapshot)
  const projectId = own(view.agentProjects, agentId) as ProjectRequestLink["projectId"]
  if (projectId === undefined) {
    if (link.projectId !== undefined || link.taskId !== undefined || link.sprintId !== undefined) return yield* refused("invalid question links")
    return {}
  }
  if (own(view.projects, projectId) === undefined || link.projectId !== undefined && link.projectId !== projectId) return yield* refused("invalid question links")
  const task = link.taskId === undefined ? undefined : own(view.tasks, projectKey(projectId, link.taskId))
  const sprintId = link.sprintId ?? task?.sprintId
  if (link.taskId !== undefined && task === undefined || task !== undefined && sprintId !== task.sprintId
    || sprintId !== undefined && own(view.sprints, projectKey(projectId, sprintId)) === undefined) return yield* refused("invalid question links")
  if (task !== undefined && !canChangeLinkedTask(snapshot, agentId, task)) return yield* refused("invalid question links")
  return { projectId, ...(task === undefined ? {} : { taskId: task.taskId }), ...(sprintId === undefined ? {} : { sprintId }) }
})

export const permissionLinks = (snapshot: Snapshot, agentId: AgentId): ProjectRequestLink => {
  const view = projectView(snapshot)
  const projectId = own(view.agentProjects, agentId) as ProjectRequestLink["projectId"]
  if (projectId === undefined || own(view.projects, projectId) === undefined) return {}
  // The first persisted creation wins, including when labels look numeric.
  const task = Object.values(view.tasks).filter((row) => row.projectId === projectId && row.owner === agentId
    && (row.state === "active" || row.state === "review"))
    .sort((a, b) => (a.history[0]?.sequence ?? 0) - (b.history[0]?.sequence ?? 0) || a.taskId.localeCompare(b.taskId))[0]
  return { projectId, ...(task === undefined ? {} : { taskId: task.taskId, sprintId: task.sprintId }) }
}

export const linkedTask = (snapshot: Snapshot, link: ProjectRequestLink) => link.projectId === undefined || link.taskId === undefined
  ? undefined : own(projectView(snapshot).tasks, projectKey(link.projectId, link.taskId))

export const taskRequests = (snapshot: Snapshot, task: Task) => [
  ...Object.values(snapshot.questions), ...Object.values(snapshot.requests),
].filter((row) => row.projectId === task.projectId && row.taskId === task.taskId)

export const projectedTask = <T extends Task>(snapshot: Snapshot, task: T): T => taskRequests(snapshot, task).some((row) => row.status === "open")
  ? { ...task, state: "blocked" } : task

export const decisionHistory = (snapshot: Snapshot, task: ProjectTaskRecord): ReadonlyArray<TaskHistoryEntry> => {
  const requests = taskRequests(snapshot, task)
  // Closing one request must not erase another blocker from that point in
  // history. Later task changes must not rewrite an earlier permission answer.
  const stateAt = (sequence: number, completedQuestion = false): Task["state"] => {
    if (requests.some((row) => row.sourceSequence <= sequence && (row.closedSequence === undefined || row.closedSequence > sequence))) return "blocked"
    return completedQuestion ? "done" : task.history.filter((row) => row.sequence <= sequence).at(-1)?.state ?? task.state
  }
  const entries: TaskHistoryEntry[] = task.history.map((row) => ({ ...row, state: stateAt(row.sequence) }))
  for (const row of requests) {
    const question = "questionId" in row
    entries.push({ sequence: row.sourceSequence, at: row.openedAt, state: "blocked",
      title: question ? "Question asked" : "Approval requested", detail: cutUtf8(question ? row.text : row.description, 8192) })
    if (row.closedSequence !== undefined && row.answeredAt !== undefined) entries.push({ sequence: row.closedSequence, at: row.answeredAt,
      state: stateAt(row.closedSequence, question), title: row.status === "cancelled" ? "Approval cancelled" : question ? "Question answered" : "Approval answered",
      detail: cutUtf8(question ? row.answer ?? "Answered" : row.status === "cancelled" ? row.reason ?? "Cancelled" : "Answer recorded", 8192) })
  }
  return entries.sort((a, b) => a.sequence - b.sequence)
}

// Both admission and completion recheck the original asker's current authority.
// A holder's answer does not let a worker write another member's task.
export const canChangeLinkedTask = (snapshot: Snapshot, agentId: AgentId, task: Task): boolean => {
  const view = projectView(snapshot), project = own(view.projects, task.projectId)
  return project !== undefined && own(view.agentProjects, agentId) === task.projectId
    && (task.owner === agentId || canLeadProject(snapshot, { _tag: "agent", agentId }, project))
}
