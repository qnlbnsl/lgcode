import * as Schema from "effect/Schema"
import * as Rpc from "effect/rpc/Rpc"
import * as RpcGroup from "effect/rpc/RpcGroup"
import { ClientRequest } from "../requests.ts"
import type { CallerKind } from "../commands.ts"
import { AgentId, EventSequence, RequestId } from "../ids.ts"
import { Project, ProjectCreation, ProjectId, ProjectName, ProjectSettings, ProjectStage, ProjectText, Repository, RepositoryLocation, Sprint, SprintId, Task, TaskHistoryEntry, TaskId, Team, Workspace } from "./schema.ts"

import { ProjectMockRpcGroup, projectMockAccess, SetupState } from "./mocks.ts"
import { ProjectDesignRpcGroup, projectDesignAccess } from "./design.ts"
import { ProjectGitRpcGroup, projectGitAccess } from "./git.ts"
import { ContextSearchFields, ContextSearchResult } from "./context.ts"

const request = { requestId: RequestId }
const Refused = Schema.TaggedStruct("CommandError", { ...request, reason: Schema.String })
const Ack = Schema.Struct(request)
const paging = { after: Schema.optionalKey(Schema.NonEmptyString), limit: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200))) }
const page = <S extends Schema.Constraint>(item: S) => Schema.Struct({ ...request, items: Schema.Array(item), next: Schema.optionalKey(Schema.NonEmptyString) })
const project = { ...request, projectId: ProjectId }
const createPayload = { ...request, name: ProjectName, goal: ProjectText, machineId: ProjectName,
  repository: Schema.Union([Schema.TaggedStruct("existing", { repoId: Repository.fields.repoId }), Schema.TaggedStruct("new", { name: ProjectName })]),
  useWorktree: Schema.optionalKey(Schema.Boolean) }
const { projectId: _tp, teamId: _t, channelId: _c, group: _g, ...team } = Team.fields
const { projectId: _sp, sprintId: _s, completion: _co, evidence: _e, completedAt: _a, ...sprint } = Sprint.fields
const { projectId: _kp, taskId: _k, ...task } = Task.fields
const taskChanges = {
  state: Schema.optionalKey(Task.fields.state), title: Schema.optionalKey(ProjectName), owner: Schema.optionalKey(AgentId),
  teamId: Schema.optionalKey(Task.fields.teamId), sprintId: Schema.optionalKey(SprintId),
  worktreeId: Schema.optionalKey(Task.fields.worktreeId), note: Schema.optionalKey(ProjectText)
}
export const ProjectAgentSummary = Schema.Struct({ agentId: AgentId, projectId: ProjectId, status: Schema.Literals(["Needs you", "Reviewing", "Working", "Ready"]) })
export const ProjectSnapshot = Schema.Struct({
  sequence: EventSequence, truncated: Schema.Boolean, setup: Schema.optionalKey(SetupState),
  projects: Schema.Array(Project), repositories: Schema.Array(Repository), workspaces: Schema.Array(Workspace),
  teams: Schema.Array(Team), sprints: Schema.Array(Sprint), tasks: Schema.Array(Task), agents: Schema.Array(ProjectAgentSummary)
})
export const ProjectRpcGroup = RpcGroup.make(
  Rpc.make("context.search", { payload: { ...request, ...ContextSearchFields },
    success: Schema.Union([Schema.Struct({ ...request, result: ContextSearchResult }), Schema.Struct({ ...request, data: Schema.String })]), error: Refused }),
  Rpc.make("settings", { payload: request, success: Schema.Struct({ ...request, settings: Schema.optionalKey(ProjectSettings), ownerNameSuggestion: Schema.optionalKey(ProjectName) }), error: Refused }),
  Rpc.make("settings.set", { payload: { ...request, settings: ProjectSettings }, success: Ack, error: Refused }),
  Rpc.make("repository.add", { payload: { ...request, name: ProjectName, path: Repository.fields.path, machineId: ProjectName }, success: Schema.Struct({ ...request, repoId: Repository.fields.repoId }), error: Refused }),
  Rpc.make("repository.locate", { payload: { ...request, ...RepositoryLocation.fields }, success: Ack, error: Refused }),
  Rpc.make("repositories", { payload: { ...request, ...paging }, success: page(Repository), error: Refused }),
  Rpc.make("workspace.register", { payload: { ...request, repoId: Repository.fields.repoId, machineId: ProjectName, branch: ProjectName,
    path: Workspace.fields.path, checkout: Schema.Literals(["main", "worktree"]), parentId: Schema.optionalKey(Workspace.fields.worktreeId) },
    success: Schema.Struct({ ...request, worktreeId: Workspace.fields.worktreeId }), error: Refused }),
  Rpc.make("workspaces", { payload: { ...request, ...paging, repoId: Schema.optionalKey(Repository.fields.repoId) }, success: page(Workspace), error: Refused }),
  Rpc.make("create", { payload: createPayload, success: Schema.Struct({ ...request, projectId: ProjectId }), error: Refused }),
  Rpc.make("placement.preview", { payload: createPayload, success: Schema.Struct({ ...request, result: Schema.Struct({
    repositoryPath: Repository.fields.path, path: Workspace.fields.path, branch: ProjectName, checkout: Schema.Literals(["main", "worktree"]),
    reserved: Schema.Literal(false) }) }), error: Refused }),
  Rpc.make("creation.abandon", { payload: { ...request, creationRequestId: RequestId }, success: Ack, error: Refused }),
  Rpc.make("creations", { payload: { ...request, ...paging }, success: page(ProjectCreation), error: Refused }),
  Rpc.make("goal.set", { payload: { ...project, goal: ProjectText }, success: Ack, error: Refused }),
  Rpc.make("archive", { payload: project, success: Ack, error: Refused }),
  Rpc.make("restore", { payload: project, success: Ack, error: Refused }),
  Rpc.make("rename", { payload: { ...project, name: ProjectName }, success: Ack, error: Refused }),
  Rpc.make("place", { payload: { ...project, worktreeId: Workspace.fields.worktreeId }, success: Ack, error: Refused }),
  Rpc.make("preferences.set", { payload: { ...project, shell: ProjectName }, success: Ack, error: Refused }),
  Rpc.make("stage.set", { payload: { ...project, stage: ProjectStage }, success: Ack, error: Refused }),
  Rpc.make("read", { payload: { ...request, ...paging, projectId: Schema.optionalKey(ProjectId), collection: Schema.Literals(["projects", "teams", "sprints", "tasks", "agents"]) },
    success: Schema.Union([page(Schema.Union([Project, Team, Sprint, Task, ProjectAgentSummary])), Schema.Struct({ ...request, data: Schema.String })]), error: Refused }),
  Rpc.make("requests", { payload: { ...project, ...paging, kind: Schema.optionalKey(ClientRequest.fields.kind), status: Schema.optionalKey(ClientRequest.fields.status) },
    success: Schema.Union([page(ClientRequest), Schema.Struct({ ...request, data: Schema.String })]), error: Refused }),
  Rpc.make("team.create", { payload: { ...project, ...team }, success: Schema.Struct({ ...request, teamId: Team.fields.teamId, channelId: Schema.NonEmptyString, group: Schema.NonEmptyString }), error: Refused }),
  Rpc.make("sprint.create", { payload: { ...project, ...sprint }, success: Schema.Struct({ ...request, sprintId: SprintId }), error: Refused }),
  Rpc.make("sprint.update", { payload: { ...project, sprintId: SprintId,
    name: Schema.optionalKey(ProjectName), goal: Schema.optionalKey(ProjectText), phase: Schema.optionalKey(Sprint.fields.phase),
    owner: Schema.optionalKey(AgentId), needs: Schema.optionalKey(Sprint.fields.needs) }, success: Ack, error: Refused }),
  Rpc.make("sprint.complete", { payload: { ...project, sprintId: SprintId, completion: ProjectName, evidence: ProjectText.check(Schema.isPattern(/\S/)) }, success: Ack, error: Refused }),
  Rpc.make("task.create", { payload: { ...project, ...task }, success: Schema.Struct({ ...request, taskId: TaskId }), error: Refused }),
  Rpc.make("task.update", { payload: { ...project, taskId: TaskId, ...taskChanges }, success: Ack, error: Refused }),
  Rpc.make("task.note", { payload: { ...project, taskId: TaskId, title: ProjectName, detail: ProjectText }, success: Ack, error: Refused }),
  Rpc.make("task.history", { payload: { ...project, taskId: TaskId, ...paging }, success: Schema.Union([page(TaskHistoryEntry), Schema.Struct({ ...request, data: Schema.String })]), error: Refused })
).prefix("project.").merge(ProjectGitRpcGroup).merge(ProjectMockRpcGroup).merge(ProjectDesignRpcGroup)
const owner = ["owner"] as const
const member = ["owner", "agent"] as const
export const projectAccess = {
  "project.context.search": member,
  ...projectGitAccess, ...projectMockAccess, ...projectDesignAccess, "project.placement.preview": owner,
  "project.settings": owner, "project.settings.set": owner, "project.repository.add": owner, "project.repository.locate": owner,
  "project.repositories": owner, "project.workspace.register": owner, "project.workspaces": owner, "project.create": owner,
  "project.rename": owner, "project.place": owner, "project.preferences.set": owner,
  "project.creation.abandon": owner, "project.creations": owner, "project.goal.set": owner, "project.archive": owner, "project.restore": owner,
  "project.requests": member, "project.stage.set": member, "project.read": member, "project.team.create": member,
  "project.sprint.create": member, "project.sprint.update": member, "project.sprint.complete": member,
  "project.task.create": member, "project.task.update": member, "project.task.note": member, "project.task.history": member
} satisfies Record<Rpc.Tag<RpcGroup.Rpcs<typeof ProjectRpcGroup>>, ReadonlyArray<CallerKind>>
