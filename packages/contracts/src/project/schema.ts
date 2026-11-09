import * as Schema from "effect/Schema"
import { AccountId, AgentId, EpochMilliseconds, EventSequence, HarnessId, RequestId } from "../ids.ts"
import { ChannelId } from "../board/ids.ts"
import { PermissionLevel } from "../permission.ts"

export const ProjectId = Schema.NonEmptyString.pipe(Schema.brand("ProjectId"))
export type ProjectId = typeof ProjectId.Type
export const RepositoryId = Schema.NonEmptyString.pipe(Schema.brand("RepositoryId"))
export type RepositoryId = typeof RepositoryId.Type
export const WorkspaceId = Schema.NonEmptyString.pipe(Schema.brand("WorkspaceId"))
export type WorkspaceId = typeof WorkspaceId.Type
export const TeamId = Schema.NonEmptyString.pipe(Schema.brand("TeamId"))
export type TeamId = typeof TeamId.Type
export const SprintId = Schema.NonEmptyString.pipe(Schema.brand("SprintId"))
export type SprintId = typeof SprintId.Type
export const TaskId = Schema.NonEmptyString.pipe(Schema.brand("TaskId"))
export type TaskId = typeof TaskId.Type
export const ProjectText = Schema.String.check(Schema.isMaxCodePoints(8192))
export const ProjectName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxCodePoints(128), Schema.isPattern(/\S/))
export const ProjectPath = Schema.String.check(Schema.isMinLength(1), Schema.isMaxCodePoints(4096))
export const ProjectStage = Schema.Literals(["design", "plan", "build", "review", "handover"])
export const SprintPhase = Schema.Literals(["Define", "Design", "Plan", "Build", "Verify", "Review", "Hand over"])
export const TaskState = Schema.Literals(["queue", "active", "review", "blocked", "done"])
export const ProjectLeadDefaults = Schema.Struct({
  harness: HarnessId, account: Schema.Union([Schema.TaggedStruct("any", {}), Schema.TaggedStruct("named", { accountId: AccountId })]),
  model: Schema.optionalKey(ProjectName), effort: Schema.optionalKey(ProjectName), permission: PermissionLevel
})
export const ProjectSettings = Schema.Struct({ workspaceFolder: ProjectPath, shell: ProjectName, lead: Schema.optionalKey(ProjectLeadDefaults) })
export type ProjectSettings = typeof ProjectSettings.Type
export const Repository = Schema.Struct({ repoId: RepositoryId, name: ProjectName, path: ProjectPath })
export type Repository = typeof Repository.Type
export const RepositoryLocation = Schema.Struct({ repoId: RepositoryId, machineId: ProjectName, path: ProjectPath })
export const Workspace = Schema.Struct({
  worktreeId: WorkspaceId, repoId: RepositoryId, machineId: ProjectName, branch: ProjectName, path: ProjectPath,
  checkout: Schema.optionalKey(Schema.Literals(["main", "worktree"])),
  projectId: Schema.optionalKey(ProjectId), teamId: Schema.optionalKey(TeamId), parentId: Schema.optionalKey(WorkspaceId),
  owner: Schema.optionalKey(ProjectName), activity: Schema.optionalKey(ProjectText)
})
export type Workspace = typeof Workspace.Type
export const Project = Schema.Struct({
  projectId: ProjectId, repoId: RepositoryId, name: ProjectName, goal: ProjectText,
  leadAgentId: AgentId, worktreeId: WorkspaceId, machineId: ProjectName,
  stage: Schema.optionalKey(ProjectStage), shell: Schema.optionalKey(ProjectName), archivedAt: Schema.optionalKey(EpochMilliseconds), archiving: Schema.optionalKey(Schema.Boolean)
})
export type Project = typeof Project.Type
export const CreationFolderIdentity = Schema.Struct({ device: Schema.NonEmptyString, inode: Schema.NonEmptyString })
// Only unfinished creation intents live in this projection. Completed requests
// use the engine's ordinary durable receipt instead.
export const ProjectCreation = Schema.Struct({
  requestId: RequestId, bodyHash: Schema.NonEmptyString, projectId: ProjectId,
  repository: Repository, workspace: Workspace, workspaceFolder: ProjectPath,
  newRepository: Schema.Boolean, name: ProjectName, goal: ProjectText, shell: ProjectName,
  leadName: ProjectName, lead: ProjectLeadDefaults,
  repositoryIdentity: Schema.optionalKey(CreationFolderIdentity), folderIdentity: Schema.optionalKey(CreationFolderIdentity)
})
export type ProjectCreation = typeof ProjectCreation.Type
export const Team = Schema.Struct({
  projectId: ProjectId, teamId: TeamId, name: ProjectName, worktreeId: WorkspaceId,
  stage: Schema.optionalKey(ProjectStage), area: Schema.optionalKey(ProjectName),
  channelId: Schema.optionalKey(ChannelId), group: Schema.optionalKey(ProjectName)
})
export type Team = typeof Team.Type
export const Sprint = Schema.Struct({
  projectId: ProjectId, sprintId: SprintId, label: ProjectName, name: ProjectName, goal: ProjectText,
  phase: SprintPhase, owner: AgentId, needs: Schema.Array(SprintId).check(Schema.isMaxLength(128)),
  completion: Schema.optionalKey(ProjectName), evidence: Schema.optionalKey(ProjectText), completedAt: Schema.optionalKey(EpochMilliseconds)
})
export type Sprint = typeof Sprint.Type
const activityText = { title: ProjectName, detail: ProjectText }
export const TaskActivity = Schema.Union([
  Schema.Struct({ ...activityText, at: Schema.optionalKey(EpochMilliseconds) }),
  Schema.Struct({ question: Schema.NonEmptyString, open: Schema.Struct(activityText), answered: Schema.Struct(activityText), at: Schema.optionalKey(EpochMilliseconds) })
])
export const TaskStory = Schema.Struct({
  summary: ProjectText, done: Schema.Array(ProjectText).check(Schema.isMaxLength(128)),
  activity: Schema.Array(TaskActivity).check(Schema.isMaxLength(128))
}).check(Schema.makeFilter((story) => new TextEncoder().encode(JSON.stringify(story)).byteLength <= 48 * 1024))
export const Task = Schema.Struct({
  projectId: ProjectId, taskId: TaskId, label: Schema.optionalKey(ProjectName), title: ProjectName, owner: AgentId,
  teamId: TeamId, sprintId: SprintId, state: TaskState, worktreeId: WorkspaceId, story: Schema.optionalKey(TaskStory)
})
export type Task = typeof Task.Type
export const TaskHistoryEntry = Schema.Struct({
  sequence: EventSequence, at: EpochMilliseconds, title: ProjectName, detail: ProjectText,
  state: TaskState
})
export type TaskHistoryEntry = typeof TaskHistoryEntry.Type
export const ProjectTaskRecord = Schema.Struct({ ...Task.fields, history: Schema.Array(TaskHistoryEntry) })
export type ProjectTaskRecord = typeof ProjectTaskRecord.Type
export const projectTeamGroup = (projectId: string, teamId: string) => `team:${projectId}/${teamId}`
