import type { Caller, Project } from "@lgtm/contracts"
import type { Snapshot } from "../commands/internal.ts"
import { own, projectView } from "./view.ts"
export const canReadProject = (snapshot: Snapshot, actor: Caller, projectId: string): boolean =>
  own(projectView(snapshot).projects, projectId) !== undefined && (actor._tag === "owner"
    || actor._tag === "agent" && own(projectView(snapshot).agentProjects, actor.agentId) === projectId)
export const canLeadProject = (snapshot: Snapshot, actor: Caller, project: Project): boolean =>
  actor._tag === "owner" || actor._tag === "agent" && project.leadAgentId === actor.agentId

export const projectPreventsRun = (snapshot: Snapshot, agentId: string): boolean => {
  const view = projectView(snapshot), id = own(view.agentProjects, agentId)
  const project = id === undefined ? undefined : own(view.projects, id)
  return project?.archiving === true || project?.archivedAt !== undefined
}
