// Pure functions that turn the engine's records into the website's store.
//
// The website in design/mock was written for its screens, so its store has its own shape.
// These functions absorb the difference. Each one takes engine records, as the browser
// client decodes them from `client.snapshot`, and returns plain objects in the store's shape.
// A field the engine does not hold gets an empty value, never a sample value. The list of
// those fields is in .foundry/result.md and in the plan for connecting the mock.
import type { ClientSnapshot, RosterEntry } from "@lgtm/contracts"
import { startFailureText } from "@lgtm/contracts/startFailure"

type ProjectSection = NonNullable<ClientSnapshot["project"]>
type EngineProject = ProjectSection["projects"][number]
type EngineRepository = ProjectSection["repositories"][number]
type EngineWorkspace = ProjectSection["workspaces"][number]
type EngineTeam = ProjectSection["teams"][number]
type EngineSprint = ProjectSection["sprints"][number]
type EngineTask = ProjectSection["tasks"][number]
type EngineAgent = ClientSnapshot["agents"][number]
type EngineRow = ClientSnapshot["requests"][number]

// ---- the store's shape ------------------------------------------------------------
// These name the fields the screens read. They follow design/mock/js/data.js.
export interface StoreOwner { readonly name: string; readonly initials: string }
export interface StoreMachine {
  readonly id: string; readonly name: string; readonly role: "master" | "worker"; readonly status: "online" | "offline"
  readonly here: boolean; readonly slots: { readonly used: number; readonly limit: number }; readonly lastSeen: number
  readonly address: string; readonly workspace: string; readonly os: string
}
export interface StoreRepo {
  readonly id: string; readonly name: string; readonly main: string; readonly remote: string | null
  readonly folders: Readonly<Record<string, string>>; readonly design: boolean
  readonly description: string; readonly describedAt: number | null; readonly describedBy: string | null
}
export interface StoreSubscription {
  readonly id: string; readonly harness: string; readonly name: string; readonly machine: string; readonly enabled: boolean
  readonly signedIn: boolean; readonly useForNew: boolean; readonly usage: null; readonly window: null
  readonly account: null; readonly model: string
}
export type StoreStage = "Design" | "Plan" | "Build" | "Review" | "Hand over"
export interface StoreProject {
  readonly worktree?: string
  readonly id: string; readonly repo: string; readonly name: string; readonly prefix: string; readonly goal: string
  readonly stage: StoreStage | ""; readonly phase: string; readonly branch: string; readonly folder: string
  readonly machine: string; readonly lead: string; readonly shell: string; readonly createdAt: number | null
  readonly archived: boolean; readonly hasMocks: boolean; readonly tests: "on" | "off" | ""; readonly agentReview: "on" | "off" | ""
}
export interface StoreTeam {
  readonly worktree?: string
  readonly id: string; readonly project: string; readonly name: string; readonly stage: StoreStage | ""
  readonly area: string | null; readonly branch: string; readonly needToKnow: boolean
}
export type StoreAgentState = "starting" | "working" | "waiting" | "idle" | "paused" | "stopped" | "failed"
export interface StoreAgent {
  readonly id: string; readonly project: string; readonly team: string | null; readonly role: string; readonly name: string
  readonly harness: string; readonly subscription: string; readonly model: string; readonly effort: string | null
  readonly folder?: string
  readonly permission: string; readonly state: StoreAgentState; readonly activity: string; readonly task: string | null
  readonly context: number; readonly turns: number; readonly tokens: number; readonly workState: string
  readonly stalled: boolean; readonly startedAt: number; readonly lastOutputAt: number
  readonly failure: { readonly reason: string } | null
}
export interface StoreOption { readonly id: string; readonly label: string; readonly kind?: string; readonly primary?: boolean }
export interface StoreRequest {
  readonly sourceSequence?: number
  readonly id: string; readonly kind: "approval" | "question"; readonly agent: string; readonly project: string
  readonly task: string | null; readonly title: string; readonly body: string; readonly command: string | null
  readonly folder: string; readonly tool: string | null; readonly recommendation: string | null
  readonly options: ReadonlyArray<StoreOption>; readonly createdAt: number; readonly status: "open"
  readonly heldBy: string | null
}
export interface StoreWorktree {
  readonly id: string; readonly repo: string; readonly kind: "base" | "project" | "team"; readonly branch: string
  readonly parent: string | null; readonly machine: string; readonly folder: string
  readonly files: ReadonlyArray<never>; readonly commits: ReadonlyArray<never>; readonly ahead: number; readonly behind: number
  readonly merge: null; readonly owner: string | null; readonly team: string | null; readonly project: string | null
}
export type StoreColumn = "Backlog" | "Planned" | "In progress" | "Review" | "Done"
export interface StoreSprint {
  readonly id: string; readonly project: string; readonly label: string; readonly name: string; readonly goal: string
  readonly phase: string; readonly column: StoreColumn; readonly team: string | null; readonly dependsOn: ReadonlyArray<string>
  readonly epic: null; readonly priority: null; readonly start: null; readonly end: null
}
export interface StoreTask {
  readonly id: string; readonly project: string; readonly label: string; readonly title: string; readonly sprint: string
  readonly team: string; readonly owner: string; readonly state: string; readonly points: null
  readonly files: ReadonlyArray<never>; readonly history: ReadonlyArray<never>
}
export type ConnectionStatus = "live" | "reconnecting" | "offline"
export interface StoreConn { readonly status: ConnectionStatus; readonly lastHeard: number }

// What one snapshot gives the store. Every key replaces the store's key of the same name.
export interface EngineRecords {
  readonly machines: ReadonlyArray<StoreMachine>; readonly subscriptions: ReadonlyArray<StoreSubscription>
  readonly repos: ReadonlyArray<StoreRepo>
  readonly projects: ReadonlyArray<StoreProject>; readonly teams: ReadonlyArray<StoreTeam>
  readonly agents: ReadonlyArray<StoreAgent>; readonly requests: ReadonlyArray<StoreRequest>
  readonly worktrees: ReadonlyArray<StoreWorktree>; readonly sprints: ReadonlyArray<StoreSprint>
  readonly tasks: ReadonlyArray<StoreTask>
}

// ---- small pieces -------------------------------------------------------------------
const STAGES: Record<string, StoreStage> = { design: "Design", plan: "Plan", build: "Build", review: "Review", handover: "Hand over" }
export const mapStage = (stage: string | undefined): StoreStage | "" => (stage === undefined ? "" : STAGES[stage] ?? "")

// The page's own words for the engine's permission levels.
const PERMISSIONS: Record<string, string> = {
  "read-only": "Read only", ask: "Ask before every change", edit: "Edit files without asking", full: "Full access"
}
export const mapPermission = (level: string): string => PERMISSIONS[level] ?? level

// The owner's name comes from Git's user.name in the workspace folder, through the engine.
export function mapOwner(name: string | undefined): StoreOwner {
  const clean = name?.trim()
  if (!clean) return { name: "Owner", initials: "O" }
  const words = clean.split(/\s+/)
  const initials = words.length > 1 ? words[0]!.charAt(0) + words[words.length - 1]!.charAt(0) : clean.slice(0, 2)
  return { name: clean, initials: initials.toUpperCase() }
}

// A short prefix for task labels, from the project's name, as the website makes one.
export function prefixOf(name: string): string {
  const letters = name.split(/[^A-Za-z0-9]+/).filter(Boolean).map((word) => word.charAt(0)).join("").slice(0, 2).toUpperCase()
  return letters || "PJ"
}

// ---- machines and workspaces -------------------------------------------------------
// The engine knows a machine only by the name its workspaces and projects carry. It holds no
// status, load or address for one, so a machine is shown as online with no figures.
// The engine calls its own computer "local" until machine pairing exists. It is always the
// first machine, the master that serves the page, even before it holds any workspace.
export const LOCAL_MACHINE = "local"

export function mapMachines(section: Pick<ProjectSection, "workspaces" | "projects">, now: number): StoreMachine[] {
  const names: string[] = [LOCAL_MACHINE]
  for (const row of [...section.workspaces, ...section.projects]) if (!names.includes(row.machineId)) names.push(row.machineId)
  return names.map((id, index) => ({
    id, name: id, role: index === 0 ? "master" : "worker", status: "online", here: index === 0,
    slots: { used: 0, limit: 0 }, lastSeen: now, address: "", os: "",
    workspace: section.workspaces.find((row) => row.machineId === id && row.checkout === "main")?.path ?? ""
  }))
}

export function mapRepository(repo: EngineRepository, workspaces: ReadonlyArray<EngineWorkspace>): StoreRepo {
  const own = workspaces.filter((row) => row.repoId === repo.repoId)
  const main = own.find((row) => row.checkout === "main") ?? own.find((row) => row.parentId === undefined)
  // A repository's folder on each machine is its main checkout there, or its registered path.
  const folders: Record<string, string> = {}
  for (const row of own) folders[row.machineId] ??= own.find((other) => other.machineId === row.machineId && other.checkout === "main")?.path ?? repo.path
  // The engine registers a repository on its own machine, so that machine always has it.
  folders[LOCAL_MACHINE] ??= repo.path
  return {
    id: repo.repoId, name: repo.name, main: main?.branch ?? "", remote: null, folders, design: false,
    description: "", describedAt: null, describedBy: null
  }
}

export function mapWorktree(row: EngineWorkspace, workspaces: ReadonlyArray<EngineWorkspace>, projects: ReadonlyArray<EngineProject>): StoreWorktree {
  const parent = row.parentId === undefined ? undefined : workspaces.find((other) => other.worktreeId === row.parentId)
  const project = row.projectId === undefined ? undefined : projects.find((p) => p.projectId === row.projectId)
  const kind = row.teamId !== undefined ? "team" : row.projectId !== undefined ? "project" : "base"
  return {
    id: row.worktreeId, repo: row.repoId, kind, branch: row.branch, parent: parent?.branch ?? null, machine: row.machineId,
    folder: row.path, files: [], commits: [], ahead: 0, behind: 0, merge: null,
    owner: kind === "project" ? project?.leadAgentId ?? null : null, team: row.teamId ?? null, project: row.projectId ?? null
  }
}

// ---- projects and teams -----------------------------------------------------------
export function mapProject(project: EngineProject, workspaces: ReadonlyArray<EngineWorkspace>): StoreProject {
  const workspace = workspaces.find((row) => row.worktreeId === project.worktreeId)
  return {
    worktree: project.worktreeId, id: project.projectId, repo: project.repoId, name: project.name, prefix: prefixOf(project.name), goal: project.goal,
    stage: mapStage(project.stage), phase: project.stage ?? "", branch: workspace?.branch ?? "", folder: workspace?.path ?? "",
    machine: project.machineId, lead: project.leadAgentId, shell: project.shell ?? "", createdAt: null,
    archived: project.archivedAt !== undefined, hasMocks: false, tests: "on", agentReview: "on"
  }
}

export function mapTeam(team: EngineTeam, workspaces: ReadonlyArray<EngineWorkspace>): StoreTeam {
  return {
    worktree: team.worktreeId, id: team.teamId, project: team.projectId, name: team.name, stage: mapStage(team.stage), area: team.area ?? null,
    branch: workspaces.find((row) => row.worktreeId === team.worktreeId)?.branch ?? "", needToKnow: false
  }
}

// ---- agents --------------------------------------------------------------------------
const MOCK_ROLES = ["project-lead", "team-lead", "builder", "reviewer", "tester", "test-writer", "designer", "planner"]
export function mapRole(role: string, isProjectLead: boolean): string {
  if (isProjectLead || role === "project-lead") return "project-lead"
  if (MOCK_ROLES.includes(role)) return role
  if (/lead/i.test(role)) return "team-lead"
  return "builder"
}

export function mapAgentState(agent: Pick<RosterEntry, "state" | "startFailure" | "openPermissionRequests" | "openQuestionsAsked">): StoreAgentState {
  if (agent.startFailure !== undefined) return "failed"
  switch (agent.state._tag) {
    case "stopped": case "interrupted": return "stopped"
    case "crashed": return "failed"
    case "paused": return "paused"
    case "starting": return "starting"
    default: return agent.openPermissionRequests + agent.openQuestionsAsked > 0 ? "waiting" : agent.state._tag
  }
}

const WORK_STATE: Record<StoreAgentState, string> = {
  starting: "working", working: "working", waiting: "waiting", idle: "assigned", paused: "off", stopped: "off", failed: "off"
}

// An agent belongs to a project through the engine's project summaries, or as its lead. It
// belongs to a team when it is in the team's group. An agent outside every project is not
// shown, because every screen reaches an agent through its project.
export function mapAgent(agent: EngineAgent, section: Pick<ProjectSection, "projects" | "teams" | "agents">): StoreAgent | undefined {
  const led = section.projects.find((p) => p.leadAgentId === agent.agentId)
  const projectId = led?.projectId ?? section.agents.find((row) => row.agentId === agent.agentId)?.projectId
  if (projectId === undefined) return undefined
  const team = section.teams.find((t) => t.projectId === projectId && t.group !== undefined && agent.groups.includes(t.group))
  const state = mapAgentState(agent)
  const quiet = agent.displayedState === "Working" || agent.displayedState === "Idle"
  return {
    id: agent.agentId, project: projectId, team: led !== undefined ? null : team?.teamId ?? null,
    role: mapRole(agent.role, led !== undefined), name: agent.name, harness: agent.harness, subscription: agent.account,
    folder: agent.folder, model: agent.model ?? "", effort: agent.effort ?? null, permission: mapPermission(agent.permission), state,
    activity: quiet ? "" : agent.displayedState, task: null, context: 0, turns: 0, tokens: 0, workState: WORK_STATE[state],
    stalled: false, startedAt: agent.startedAt, lastOutputAt: agent.startedAt,
    failure: agent.startFailure === undefined ? null : { reason: startFailureText(agent.startFailure) }
  }
}

// A project whose lead is missing from the roster still gets a lead, made from the project's
// own record, because every project screen opens its lead's thread.
export function placeholderLead(project: StoreProject): StoreAgent {
  return {
    id: project.lead, project: project.id, team: null, role: "project-lead", name: "Project lead", harness: "claude",
    subscription: "", model: "", effort: null, permission: mapPermission("ask"), state: "stopped", activity: "",
    task: null, context: 0, turns: 0, tokens: 0, workState: "off", stalled: false, startedAt: 0, lastOutputAt: 0, failure: null
  }
}

// ---- subscriptions -------------------------------------------------------------------
// A subscription is one of the engine's harness accounts. The snapshot names each account
// with its status, and an agent names the account it runs on and that account's harness.
// The engine holds no usage figures for an account, so none are shown.
const HARNESS_IDS = ["claude", "codex"]
export function mapSubscriptions(accounts: ClientSnapshot["accounts"], agents: ReadonlyArray<EngineAgent>, machine: string): StoreSubscription[] {
  const ids = [...new Set([...(accounts ?? []).map((row) => row.id as string), ...agents.map((a) => a.account as string)])]
  return ids.flatMap((id) => {
    const harness = agents.find((a) => a.account === id)?.harness ?? (HARNESS_IDS.includes(id) ? id : undefined)
    if (harness === undefined) return []
    const row = accounts?.find((account) => account.id === id)
    return [{
      id, harness, name: id, machine, enabled: row?.enabled ?? true, signedIn: row === undefined || row.status !== "needs-sign-in",
      useForNew: false, usage: null, window: null, account: null, model: ""
    }]
  })
}

// ---- requests ---------------------------------------------------------------------------
// The snapshot holds every open permission request and question, each with the short display
// the engine keeps for it. A request held by an agent, such as a lead, waits for that agent
// and not for the owner, as on the website.
export function mapRequest(row: EngineRow, kind: "approval" | "question", agents: ReadonlyArray<StoreAgent>): StoreRequest | undefined {
  const agent = agents.find((a) => a.id === row.agentId)
  const display = row.display
  const project = display?.projectId ?? agent?.project
  if (project === undefined) return undefined
  const preview = display?.preview ?? ""
  const firstLine = preview.split("\n").find((line) => line.trim() !== "")?.trim() ?? ""
  const title = display?.title ?? (firstLine || (kind === "approval" ? "Permission request" : "Question"))
  const options: StoreOption[] = (display?.options ?? []).map((option) => ({
    id: option.id, label: option.name, kind: option.kind, ...(option.kind === "allow_once" ? { primary: true } : {})
  }))
  return {
    sourceSequence: row.sourceSequence,
    id: row.id, kind, agent: row.agentId, project, task: display?.taskId ?? null, title, body: preview,
    command: null, folder: agent?.folder ?? "", tool: display?.toolKind ?? null, recommendation: display?.recommendation ?? null,
    options, createdAt: row.openedAt ?? 0, status: "open", heldBy: row.holder._tag === "agent" ? row.holder.agentId : null
  }
}

// ---- sprints and tasks --------------------------------------------------------------------
export function columnOf(sprint: Pick<EngineSprint, "phase" | "completedAt">): StoreColumn {
  if (sprint.completedAt !== undefined) return "Done"
  switch (sprint.phase) {
    case "Build": case "Verify": return "In progress"
    case "Review": case "Hand over": return "Review"
    default: return "Planned"
  }
}

export function mapSprint(sprint: EngineSprint, tasks: ReadonlyArray<EngineTask>): StoreSprint {
  return {
    id: sprint.sprintId, project: sprint.projectId, label: sprint.label, name: sprint.name, goal: sprint.goal,
    phase: sprint.phase, column: columnOf(sprint), team: tasks.find((task) => task.sprintId === sprint.sprintId)?.teamId ?? null,
    dependsOn: [...sprint.needs], epic: null, priority: null, start: null, end: null
  }
}

export function mapTask(task: EngineTask): StoreTask {
  return {
    id: task.taskId, project: task.projectId, label: task.label ?? task.taskId, title: task.title, sprint: task.sprintId,
    team: task.teamId, owner: task.owner, state: task.state, points: null, files: [], history: []
  }
}

// ---- the whole snapshot ----------------------------------------------------------------
export function mapSnapshot(snapshot: Pick<ClientSnapshot, "agents" | "requests" | "questions" | "project" | "accounts">, now: number): EngineRecords {
  const section: ProjectSection = snapshot.project ?? {
    sequence: 0 as ProjectSection["sequence"], truncated: false,
    projects: [], repositories: [], workspaces: [], teams: [], sprints: [], tasks: [], agents: []
  }
  // Each list is bounded independently. Keep children only with their required parents,
  // and clear optional links when their target was omitted. Never invent a parent record.
  const repos = section.repositories.map((r) => mapRepository(r, section.workspaces))
  const projects = section.projects.filter((p) => repos.some((r) => r.id === p.repoId)).map((p) => mapProject(p, section.workspaces))
  const projectExists = (id: string) => projects.some((p) => p.id === id)
  const teams = section.teams.filter((t) => projectExists(t.projectId)).map((t) => mapTeam(t, section.workspaces))
  const summaries = [...section.agents]
  for (const agent of snapshot.agents) {
    if (summaries.some((row) => row.agentId === agent.agentId)) continue
    // Retained group membership, task ownership and request displays also prove project
    // membership when the final agent summaries did not fit. Ambiguous evidence is omitted.
    const candidates = new Set([
      ...section.teams.filter((t) => t.group !== undefined && agent.groups.includes(t.group)).map((t) => t.projectId),
      ...section.tasks.filter((t) => t.owner === agent.agentId).map((t) => t.projectId),
      ...section.sprints.filter((sp) => sp.owner === agent.agentId).map((sp) => sp.projectId),
      ...[...snapshot.requests, ...snapshot.questions].filter((r) => r.agentId === agent.agentId).flatMap((r) => r.display?.projectId ?? [])
    ])
    if (candidates.size === 1) summaries.push({ agentId: agent.agentId, projectId: [...candidates][0]!, status: "Ready" })
  }
  const agents = snapshot.agents.flatMap((a) => mapAgent(a, { ...section,
    projects: section.projects.filter((p) => projectExists(p.projectId)), agents: summaries,
    teams: section.teams.filter((t) => teams.some((mapped) => mapped.id === t.teamId))
  }) ?? []).filter((a) => projectExists(a.project))
  for (const project of projects) if (!agents.some((a) => a.id === project.lead)) agents.push(placeholderLead(project))
  const sprints = section.sprints.filter((sp) => projectExists(sp.projectId)).map((sp) => mapSprint(sp, section.tasks))
  const tasks = section.tasks.map(mapTask).filter((t) => projectExists(t.project)
    && sprints.some((sp) => sp.id === t.sprint && sp.project === t.project)
    && teams.some((team) => team.id === t.team && team.project === t.project)
    && agents.some((a) => a.id === t.owner && a.project === t.project))
  const requests = [
    ...snapshot.requests.flatMap((row) => mapRequest(row, "approval", agents) ?? []),
    ...snapshot.questions.flatMap((row) => mapRequest(row, "question", agents) ?? [])
  ].filter((r) => projectExists(r.project) && agents.some((a) => a.id === r.agent && a.project === r.project)
    && (r.heldBy === null || agents.some((a) => a.id === r.heldBy)))
    .map((r) => ({ ...r, task: tasks.some((t) => t.id === r.task && t.project === r.project) ? r.task : null }))
  const machines = mapMachines(section, now)
  return {
    machines, subscriptions: mapSubscriptions(snapshot.accounts, snapshot.agents, machines[0]?.id ?? ""),
    repos, projects, teams, agents, requests,
    worktrees: section.workspaces.filter((w) => repos.some((r) => r.id === w.repoId)
      && (w.projectId === undefined || projectExists(w.projectId))
      && (w.teamId === undefined || teams.some((t) => t.id === w.teamId)))
      .map((w) => mapWorktree(w, section.workspaces, section.projects))
      .map((w) => ({ ...w, owner: agents.some((a) => a.id === w.owner) ? w.owner : null })),
    sprints: sprints.map((sp) => ({ ...sp, team: tasks.find((t) => t.sprint === sp.id)?.team ?? null,
      dependsOn: sp.dependsOn.filter((id) => sprints.some((other) => other.id === id && other.project === sp.project)) })), tasks
  }
}

export function mapConnection(status: ConnectionStatus, lastHeard: number): StoreConn {
  return { status, lastHeard }
}
