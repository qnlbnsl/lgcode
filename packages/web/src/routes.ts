import type { AgentId, ProjectId, RepositoryId, SprintId, TaskId, TeamId, WorkspaceId } from "@lgtm/contracts"

export const workspaceTabs = ["board", "mocks", "chat", "terminal", "git", "settings", "tasks"] as const
export type WorkspaceTab = typeof workspaceTabs[number]
export type ServicePage = "alerts" | "machines" | "subscriptions" | "settings"
export type ShellRoute =
  | { readonly page: "home" }
  | { readonly page: "service"; readonly service: ServicePage }
  | { readonly page: "repository"; readonly repoId: RepositoryId; readonly tab?: "projects" | "design" }
  | { readonly page: "project"; readonly projectId: ProjectId; readonly teamId?: TeamId; readonly tab: WorkspaceTab; readonly workspaceId?: WorkspaceId }
  | { readonly page: "sprint"; readonly projectId: ProjectId; readonly sprintId: SprintId }
  | { readonly page: "task"; readonly projectId: ProjectId; readonly taskId: TaskId }
  | { readonly page: "thread"; readonly agentId: AgentId; readonly subject?: string }
  | { readonly page: "invalid" }

// Project identities are branded nonempty strings, not UUIDs. Never decode
// outside the guarded parser or silently select a different entity on failure.
const identifier = (value: string | undefined) => {
  if (value === undefined) throw new Error("Missing identity")
  const decoded = decodeURIComponent(value)
  if (!decoded || /[\p{Cc}\p{Cf}]/u.test(decoded)) throw new Error("Invalid identity")
  return decoded
}
const services: readonly string[] = ["alerts", "machines", "subscriptions", "settings"]
export function parseShellRoute(href: string): ShellRoute {
  try {
    const url = new URL(href, "http://127.0.0.1")
    const hash = url.hash.startsWith("#/")
    const route = hash ? new URL(url.hash.slice(1), url.origin) : url
    const parts = route.pathname.replace(/\/$/u, "").split("/").slice(1)
    if (route.pathname === "/") {
      const legacy = !hash && url.searchParams.get("page")
      return legacy && services.includes(legacy) ? { page: "service", service: legacy as ServicePage } : { page: "home" }
    }
    if ((parts[0] === "thread" || parts[0] === "threads") && parts.length === 2) {
      const subject = route.searchParams.get("subject") ?? url.searchParams.get("subject") ?? undefined
      if (subject !== undefined && /[\p{Cc}\p{Cf}]/u.test(subject)) return { page: "invalid" }
      return { page: "thread", agentId: identifier(parts[1]) as AgentId, ...(subject === undefined ? {} : { subject }) }
    }
    if (parts[0] === "service" && parts.length === 2 && services.includes(parts[1]!)) return { page: "service", service: parts[1] as ServicePage }
    if (parts[0] === "repository" && (parts.length === 2 || parts.length === 3 && (parts[2] === "projects" || parts[2] === "design"))) return {
      page: "repository", repoId: identifier(parts[1]) as RepositoryId, ...(parts[2] === undefined ? {} : { tab: parts[2] as "projects" | "design" })
    }
    if (parts[0] !== "project") return { page: "invalid" }
    const projectId = identifier(parts[1]) as ProjectId
    if (parts.length === 4 && parts[2] === "sprint") return { page: "sprint", projectId, sprintId: identifier(parts[3]) as SprintId }
    if (parts.length === 4 && parts[2] === "task") return { page: "task", projectId, taskId: identifier(parts[3]) as TaskId }
    const teamId = parts[2] === "team" ? identifier(parts[3]) as TeamId : undefined
    const tab = parts[teamId === undefined ? 2 : 4] ?? "board"
    if (parts.length > (teamId === undefined ? 3 : 5) || !workspaceTabs.includes(tab as WorkspaceTab) || (tab === "tasks" && teamId === undefined)) return { page: "invalid" }
    const workspaceId = route.searchParams.get("workspace")
    return { page: "project", projectId, tab: tab as WorkspaceTab, ...(teamId === undefined ? {} : { teamId }),
      ...(workspaceId === null ? {} : { workspaceId: identifier(encodeURIComponent(workspaceId)) as WorkspaceId }) }
  } catch { return { page: "invalid" } }
}

export function shellHref(route: ShellRoute): string {
  const encode = encodeURIComponent
  switch (route.page) {
    case "home": return "/#/"
    case "invalid": return "/#/invalid"
    case "service": return `/#/service/${route.service}`
    case "repository": return `/#/repository/${encode(route.repoId)}${route.tab === undefined ? "" : `/${route.tab}`}`
    case "thread": return `/#/thread/${encode(route.agentId)}${route.subject === undefined ? "" : `?subject=${encode(route.subject)}`}`
    case "sprint": return `/#/project/${encode(route.projectId)}/sprint/${encode(route.sprintId)}`
    case "task": return `/#/project/${encode(route.projectId)}/task/${encode(route.taskId)}`
    case "project": return `/#/project/${encode(route.projectId)}${route.teamId === undefined ? "" : `/team/${encode(route.teamId)}`}/${route.tab}${route.workspaceId === undefined ? "" : `?workspace=${encode(route.workspaceId)}`}`
  }
}

export const scopeKey = (projectId: string, teamId?: string) => JSON.stringify([projectId, teamId ?? null])
