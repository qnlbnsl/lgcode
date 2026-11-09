import type { Project, ProjectCreation, ProjectSettings, ProjectTaskRecord, Repository, RepositoryLocation, Sprint, Team, Workspace } from "./schema.ts"
export interface ProjectView {
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
