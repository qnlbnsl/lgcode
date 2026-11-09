import type { GitEvidence, GitMainReview } from "./git.ts"
import type { SetupState, MockRevision, MockApproval } from "./mocks.ts"
import type { RepositoryDesign } from "./design.ts"
import type { OwnerTaskNotification, Project, ProjectCreation, ProjectSettings, ProjectTaskRecord, Repository, RepositoryLocation, Sprint, Team, Workspace } from "./schema.ts"
export interface ProjectView {
  readonly gitEvidence: Readonly<Record<string, GitEvidence>>
  readonly gitReviews: Readonly<Record<string, GitMainReview>>
  readonly taskNotifications: Readonly<Record<string, OwnerTaskNotification>>
  readonly setup: SetupState
  readonly mockRevisions: Readonly<Record<string, MockRevision>>
  readonly mockHeads: Readonly<Record<string, string>>
  readonly mockApprovals: Readonly<Record<string, MockApproval>>
  readonly designs: Readonly<Record<string, RepositoryDesign>>
  readonly designHeads: Readonly<Record<string, string>>
  readonly settings?: ProjectSettings
  readonly creations: Readonly<Record<string, ProjectCreation>>
  readonly repositories: Readonly<Record<string, Repository>>
  readonly locations: Readonly<Record<string, typeof RepositoryLocation.Type>>
  readonly workspaces: Readonly<Record<string, Workspace>>
  readonly projects: Readonly<Record<string, Project>>
  readonly teams: Readonly<Record<string, Team>>
  readonly sprints: Readonly<Record<string, Sprint>>
  readonly tasks: Readonly<Record<string, ProjectTaskRecord>>
  readonly agentProjects: Readonly<Record<string, string>>
  readonly parents: Readonly<Record<string, string>>
}
