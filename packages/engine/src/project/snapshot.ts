import { projectAgentStatus, type Caller, type ProjectSnapshot, type Task } from "@lgcode/contracts"
import type { Snapshot } from "../commands/internal.ts"
import { projectedTask } from "./decisions.ts"
import { canReadProject } from "./access.ts"
import { own, projectView } from "./view.ts"

export const projectNeedsOwner = (snapshot: Snapshot, projectId: string) => {
  const view = projectView(snapshot)
  return [...Object.values(snapshot.requests), ...Object.values(snapshot.questions)].filter((row) => row.status === "open"
    && row.holder._tag === "owner" && own(view.agentProjects, row.agentId) === projectId)
}
export const projectAgents = (snapshot: Snapshot, projectId: string) => {
  const view = projectView(snapshot)
  const needs = new Set(projectNeedsOwner(snapshot, projectId).map((row) => row.agentId))
  return Object.values(snapshot.agents).filter((agent) => own(view.agentProjects, agent.agentId) === projectId).map((agent) => ({
    agentId: agent.agentId, projectId: projectId as typeof ProjectSnapshot.Type.projects[number]["projectId"],
    status: projectAgentStatus({ needsOwner: needs.has(agent.agentId) || agent.startFailure !== undefined, state: agent.state._tag,
      tasks: Object.values(view.tasks).filter((task) => task.projectId === projectId && task.owner === agent.agentId).map((task) => projectedTask(snapshot, task)) })
  }))
}
export const taskMetadata = ({ history: _history, ...task }: import("@lgcode/contracts").ProjectTaskRecord): Task => task
export const snapshotFor = (caller: Caller, snapshot: Snapshot): typeof ProjectSnapshot.Type | undefined => {
  if (caller._tag !== "owner" && caller._tag !== "agent") return
  const view = projectView(snapshot)
  const projects = Object.values(view.projects).filter((row) => canReadProject(snapshot, caller, row.projectId))
  const ids = new Set(projects.map((row) => row.projectId))
  const repos = new Set(projects.map((row) => row.repoId))
  const section: { -readonly [K in keyof typeof ProjectSnapshot.Type]: typeof ProjectSnapshot.Type[K] extends ReadonlyArray<infer V> ? V[] : typeof ProjectSnapshot.Type[K] } = {
    sequence: snapshot.sequence, truncated: false, ...(caller._tag === "owner" ? { setup: view.setup } : {}), projects: [], repositories: [], workspaces: [], teams: [], sprints: [], tasks: [], agents: []
  }
  const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8")
  let size = bytes(section)
  const fill = <T>(out: T[], rows: Iterable<T>) => {
    for (const row of rows) {
      const extra = bytes(row) + 1
      if (size + extra > 256 * 1024) { section.truncated = true; continue }
      out.push(row); size += extra
    }
  }
  fill(section.projects, projects)
  fill(section.repositories, Object.values(view.repositories).filter((row) => caller._tag === "owner" || repos.has(row.repoId)))
  const workspaceIds = new Set([...projects.map((row) => row.worktreeId), ...Object.values(view.teams).filter((row) => ids.has(row.projectId)).map((row) => row.worktreeId)])
  fill(section.workspaces, Object.values(view.workspaces).filter((row) => caller._tag === "owner" || workspaceIds.has(row.worktreeId)))
  fill(section.teams, Object.values(view.teams).filter((row) => ids.has(row.projectId)))
  fill(section.sprints, Object.values(view.sprints).filter((row) => ids.has(row.projectId)))
  fill(section.tasks, Object.values(view.tasks).filter((row) => ids.has(row.projectId)).map((task) => taskMetadata(projectedTask(snapshot, task))))
  fill(section.agents, projects.flatMap((row) => projectAgents(snapshot, row.projectId)))
  return section
}
