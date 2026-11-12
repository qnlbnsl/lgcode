import type { AgentId, ClientRequest, ClientSnapshot, Project, Team } from "@lgtm/contracts"
import { projectTeamGroup } from "@lgtm/contracts"
import type { NavigationData } from "../data/projectReads.ts"
import type { ShellRoute } from "../routes.ts"

export function selectedScope(route: ShellRoute, navigation?: NavigationData, snapshot?: ClientSnapshot) {
  const projectId = "projectId" in route ? route.projectId : route.page === "thread"
    ? navigation?.agents.find((agent) => agent.agentId === route.agentId)?.projectId : undefined
  const project = navigation?.projects.find((row) => row.projectId === projectId)
  const agent = route.page === "thread" ? snapshot?.agents.find((row) => row.agentId === route.agentId) : undefined
  const team = navigation?.teams.find((row) => row.projectId === projectId && (route.page === "project" ? row.teamId === route.teamId
    : agent?.groups.includes(row.group ?? projectTeamGroup(row.projectId, row.teamId))))
  const repoId = route.page === "repository" ? route.repoId : project?.repoId
  const repository = navigation?.repositories.find((row) => row.repoId === repoId)
  const assignedWorkspace = navigation?.workspaces.find((row) => row.worktreeId === (team?.worktreeId ?? project?.worktreeId))
  const inspectedWorkspace = route.page === "project" && route.workspaceId !== undefined
    ? navigation?.workspaces.find((row) => row.repoId === repository?.repoId && row.worktreeId === route.workspaceId) : assignedWorkspace
  return { project, team, agent, repository, assignedWorkspace, inspectedWorkspace }
}
export const teamAgents = (team: Team, snapshot?: ClientSnapshot) => snapshot?.agents.filter((agent) => agent.groups.includes(team.group ?? projectTeamGroup(team.projectId, team.teamId))) ?? []
export interface AttentionItem {
  readonly key: string
  readonly agentId: AgentId
  readonly kind: "Failed start" | "Question" | "Approval"
  readonly title: string
  readonly since: number
  readonly subject?: string
}
export function attentionItems(snapshot?: ClientSnapshot, requests?: ReadonlyArray<ClientRequest>): AttentionItem[] {
  return [
    ...(snapshot?.agents.filter((agent) => agent.startFailure !== undefined).map((agent): AttentionItem => ({
      key: `failure:${agent.agentId}`, agentId: agent.agentId, kind: "Failed start", title: agent.name, since: agent.startedAt
    })) ?? []),
    ...(requests?.filter((request) => request.status === "open" && request.holder._tag === "owner").map((request): AttentionItem => ({
      key: JSON.stringify([request.kind, request.id]), agentId: request.agentId, kind: request.kind === "permission" ? "Approval" : "Question",
      title: request.display?.preview ?? request.id, since: request.openedAt,
      subject: `${request.kind}:${request.id}`
    })) ?? [])
  ].sort((a, b) => Number(b.kind === "Failed start") - Number(a.kind === "Failed start") || a.since - b.since || a.key.localeCompare(b.key))
}
export const projectAgentIds = (project: Project, navigation?: NavigationData) => new Set([project.leadAgentId,
  ...(navigation?.agents.filter((row) => row.projectId === project.projectId).map((row) => row.agentId) ?? [])])
