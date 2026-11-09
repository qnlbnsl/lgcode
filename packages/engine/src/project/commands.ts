import { randomUUID } from "node:crypto"
import { realpath, stat } from "node:fs/promises"
import { isAbsolute } from "node:path"
import { RepositoryId, WorkspaceId, TeamId, SprintId, TaskId, ChannelId,
  projectTeamGroup, type Event, type Project, type Task } from "@lgcode/contracts"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { agentReadReply, type ReadHandler } from "../api/reads.ts"
import { refused, type Input, type Payload, type PiecePlanner } from "../commands/internal.ts"
import { canLeadProject, canReadProject } from "./access.ts"
import { own, projectKey, projectView } from "./view.ts"
import { projectAgents, taskMetadata } from "./snapshot.ts"
import { cleanName, duplicateName } from "./names.ts"
import { readHarnesses } from "../commands/internal.ts"

import { withGit, gitCall, localMachine, safePath } from "./gitApi.ts"
import { validChoiceId } from "../runner/choices.ts"

const fresh = <S extends Schema.Top & { readonly Type: string }>(schema: S): S["Type"] => Schema.decodeUnknownSync(schema as never)(randomUUID()) as S["Type"]
const ack = (requestId: unknown, events: ReadonlyArray<Event>) => ({ events, reply: () => ({ requestId }) })
const requireProject = (input: Input, id: string, lead = true) => {
  const row = own(projectView(input.snapshot).projects, id)
  return row !== undefined && (lead ? canLeadProject(input.snapshot, input.actor, row) : canReadProject(input.snapshot, input.actor, id))
    ? Effect.succeed(row) : Effect.fail(refused("project is unavailable to this caller"))
}
const member = (input: Input, projectId: string, agentId: string) =>
  own(input.snapshot.agents, agentId) !== undefined && own(projectView(input.snapshot).agentProjects, agentId) === projectId
// Registration uses the same trusted service and queue as public Git calls.
const inspectCheckout = (input: Input, path: string) => withGit(input, (git) => Effect.gen(function* () {
  const repository = yield* gitCall(git.register(path))
  const state = yield* gitCall(git.state(repository.path))
  const checkouts = yield* gitCall(git.worktrees(repository.path))
  const main = checkouts.items.find((row) => row.path === repository.path)
  if (state.branch === null || main === undefined) return yield* refused("an existing local Git checkout root with a named branch is required")
  return { path: repository.path, common: repository.commonDirectory, branch: state.branch,
    checkout: repository.commonDirectory === `${repository.path}/.git` ? "main" as const : "worktree" as const }
}))
const settingsSet: PiecePlanner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.settings.set">
  yield* safePath(input, p.settings.workspaceFolder)
  const workspaceFolder = yield* Effect.tryPromise({ try: async () => {
    if (!isAbsolute(p.settings.workspaceFolder)) throw new Error()
    const folder = await realpath(p.settings.workspaceFolder)
    if (!(await stat(folder)).isDirectory()) throw new Error()
    return folder
  }, catch: () => refused("workspace folder must be an existing absolute directory") })
  const lead = p.settings.lead
  if (lead !== undefined) {
    const harness = (yield* readHarnesses(input.runtime)).find((row) => row.id === lead.harness)
    const account = lead.account._tag === "named" ? own(input.snapshot.accounts, lead.account.accountId) : undefined
    if (harness === undefined || lead.account._tag === "named" && account?.harness !== harness.id
      || lead.model !== undefined && harness.models.length > 0 && !harness.models.includes(lead.model)
      || lead.effort !== undefined && harness.efforts.length > 0 && !harness.efforts.includes(lead.effort)) return yield* refused("invalid lead defaults")
    for (const value of [lead.model, lead.effort]) if (value !== undefined && (!validChoiceId(value) || (yield* input.runtime.log.redactText(value)) !== value)) return yield* refused("invalid lead defaults")
  }
  return ack(p.requestId, [{ _tag: "project.SettingsChanged", settings: { workspaceFolder, shell: yield* cleanName(input, p.settings.shell), ...(lead === undefined ? {} : { lead }) } }])
})
const repositoryAdd: PiecePlanner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.repository.add">
  yield* localMachine(p.machineId); yield* safePath(input, p.path)
  const checkout = yield* inspectCheckout(input, p.path)
  if (Object.values(projectView(input.snapshot).repositories).some((repo) => repo.path === checkout.path)) return yield* refused("repository is already registered")
  const repoId = fresh(RepositoryId)
  return { events: [{ _tag: "project.RepositoryAdded", repoId, name: yield* cleanName(input, p.name), path: checkout.path },
    { _tag: "project.RepositoryLocated", repoId, machineId: p.machineId, path: checkout.path }], reply: () => ({ requestId: p.requestId, repoId }) }
})
const repositoryLocate: PiecePlanner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.repository.locate">
  yield* localMachine(p.machineId); yield* safePath(input, p.path)
  const repo = own(projectView(input.snapshot).repositories, p.repoId)
  if (repo === undefined) return yield* refused("repository not found")
  const registered = yield* inspectCheckout(input, repo.path)
  const located = yield* inspectCheckout(input, p.path)
  if (registered.common !== located.common) return yield* refused("checkout belongs to a different repository")
  return ack(p.requestId, [{ _tag: "project.RepositoryLocated", repoId: p.repoId, machineId: p.machineId, path: located.path }])
})
const workspaceRegister: PiecePlanner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.workspace.register">
  yield* localMachine(p.machineId); yield* safePath(input, p.path)
  const view = projectView(input.snapshot)
  const location = own(view.locations, projectKey(p.repoId, p.machineId))
  if (location === undefined) return yield* refused("repository location not found")
  const repo = yield* inspectCheckout(input, location.path)
  const checkout = yield* inspectCheckout(input, p.path)
  if (checkout.common !== repo.common || checkout.branch !== p.branch || checkout.checkout !== p.checkout) return yield* refused("checkout does not match the repository, branch and type")
  if (Object.values(view.workspaces).some((row) => row.machineId === p.machineId && row.path === checkout.path)) return yield* refused("workspace is already registered")
  if (p.parentId !== undefined) {
    const parent = own(view.workspaces, p.parentId)
    if (parent?.repoId !== p.repoId || parent.machineId !== p.machineId) return yield* refused("invalid parent workspace")
  }
  const worktreeId = fresh(WorkspaceId)
  return { events: [{ _tag: "project.WorktreeCreated", worktreeId, repoId: p.repoId, machineId: p.machineId, branch: p.branch,
    path: checkout.path, checkout: p.checkout, ...(p.parentId === undefined ? {} : { parentId: p.parentId }) }], reply: () => ({ requestId: p.requestId, worktreeId }) }
})
const rename: PiecePlanner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.rename">; const project = yield* requireProject(input, p.projectId)
  const name = yield* cleanName(input, p.name)
  if (duplicateName(input, { repoId: project.repoId, machineId: project.machineId, name }, project.projectId)) return yield* refused("project name already exists in this repository")
  return ack(p.requestId, [{ _tag: "project.Renamed", projectId: p.projectId, name }])
})
const place: PiecePlanner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.place">; const project = yield* requireProject(input, p.projectId)
  const workspace = own(projectView(input.snapshot).workspaces, p.worktreeId)
  if (workspace?.repoId !== project.repoId) return yield* refused("workspace belongs to a different repository")
  if (Object.values(input.snapshot.agents).some((agent) => member(input, p.projectId, agent.agentId)
    && !["stopped", "crashed"].includes(agent.state._tag))) return yield* refused("stop the project's agents before changing placement")
  return ack(p.requestId, [{ _tag: "project.Placed", projectId: p.projectId, worktreeId: p.worktreeId, machineId: workspace.machineId }])
})
const preferencesSet: PiecePlanner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.preferences.set">; yield* requireProject(input, p.projectId)
  return ack(p.requestId, [{ _tag: "project.PreferencesChanged", projectId: p.projectId, shell: yield* cleanName(input, p.shell) }])
})
const stageSet: PiecePlanner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.stage.set">; yield* requireProject(input, p.projectId)
  return ack(p.requestId, [{ _tag: "project.StageChanged", projectId: p.projectId, stage: p.stage }])
})
const teamCreate: PiecePlanner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.team.create">; const project = yield* requireProject(input, p.projectId)
  if (input.runtime.lists?.boardEnabled === false) return yield* refused("board disabled")
  const view = projectView(input.snapshot)
  const workspace = own(view.workspaces, p.worktreeId)
  if (workspace?.repoId !== project.repoId || workspace.machineId !== project.machineId
    || workspace.projectId !== undefined && workspace.projectId !== p.projectId
    || workspace.worktreeId !== project.worktreeId && workspace.parentId !== project.worktreeId) return yield* refused("invalid team workspace")
  if (Object.values(view.teams).some((row) => row.worktreeId === p.worktreeId)) return yield* refused("workspace already belongs to a team")
  const name = yield* cleanName(input, p.name)
  if (Object.values(view.teams).some((row) => row.projectId === p.projectId && row.name.toLowerCase() === name.toLowerCase())) return yield* refused("team name already exists")
  const teamId = fresh(TeamId); const channelId = fresh(ChannelId)
  const group = projectTeamGroup(p.projectId, teamId)
  const manager = { _tag: "agent", agentId: project.leadAgentId } as const
  return { events: [{ _tag: "project.TeamAdded", projectId: p.projectId, teamId, name, worktreeId: p.worktreeId, group, channelId,
    ...(p.stage === undefined ? {} : { stage: p.stage }), ...(p.area === undefined ? {} : { area: yield* cleanName(input, p.area) }) },
    { _tag: "board.ChannelOpened", channelId, name: `Team_${teamId}`, kind: "group", opener: manager, manager,
      anchorAgentId: project.leadAgentId, group, members: [] }], reply: () => ({ requestId: p.requestId, teamId, channelId, group }) }
})
const dependenciesValid = (input: Input, projectId: string, needs: ReadonlyArray<string>, sprintId?: string): boolean => {
  const view = projectView(input.snapshot)
  if (new Set(needs).size !== needs.length || needs.some((id) => id === sprintId || own(view.sprints, projectKey(projectId, id)) === undefined)) return false
  const seen = new Set<string>()
  const reachesSelf = (id: string): boolean => {
    if (id === sprintId) return true
    if (seen.has(id)) return false
    seen.add(id)
    return own(view.sprints, projectKey(projectId, id))?.needs.some(reachesSelf) ?? false
  }
  return !needs.some(reachesSelf)
}
const sprintCreate: PiecePlanner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.sprint.create">; yield* requireProject(input, p.projectId)
  if (!member(input, p.projectId, p.owner) || !dependenciesValid(input, p.projectId, p.needs)) return yield* refused("invalid sprint owner or dependencies")
  const label = yield* cleanName(input, p.label)
  if (Object.values(projectView(input.snapshot).sprints).some((row) => row.projectId === p.projectId && row.label.toLowerCase() === label.toLowerCase())) return yield* refused("sprint label already exists")
  const sprintId = fresh(SprintId)
  return { events: [{ _tag: "project.SprintAdded", projectId: p.projectId, sprintId, label, name: yield* cleanName(input, p.name), goal: p.goal, phase: p.phase, owner: p.owner, needs: p.needs }], reply: () => ({ requestId: p.requestId, sprintId }) }
})
const requireSprint = (input: Input, projectId: string, sprintId: string) => {
  const row = own(projectView(input.snapshot).sprints, projectKey(projectId, sprintId))
  return row === undefined ? Effect.fail(refused("sprint not found")) : Effect.succeed(row)
}
const sprintUpdate: PiecePlanner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.sprint.update">; yield* requireProject(input, p.projectId)
  const sprint = yield* requireSprint(input, p.projectId, p.sprintId)
  if (sprint.completion !== undefined) return yield* refused("completed sprint cannot be changed")
  if (p.owner !== undefined && !member(input, p.projectId, p.owner) || p.needs !== undefined && !dependenciesValid(input, p.projectId, p.needs, p.sprintId)) return yield* refused("invalid sprint owner or dependencies")
  const { requestId, ...fields } = p
  return ack(requestId, [{ _tag: "project.SprintChanged", ...fields, ...(p.name === undefined ? {} : { name: yield* cleanName(input, p.name) }) }])
})
const sprintComplete: PiecePlanner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.sprint.complete">; yield* requireProject(input, p.projectId)
  const sprint = yield* requireSprint(input, p.projectId, p.sprintId)
  if (sprint.completion !== undefined) return yield* refused("sprint is already complete")
  const view = projectView(input.snapshot)
  if (sprint.needs.some((id) => own(view.sprints, projectKey(p.projectId, id))?.completion === undefined)) return yield* refused("sprint dependencies are incomplete")
  if (Object.values(view.tasks).some((task) => task.projectId === p.projectId && task.sprintId === p.sprintId && task.state !== "done")) return yield* refused("sprint tasks are incomplete")
  return ack(p.requestId, [{ _tag: "project.SprintCompleted", projectId: p.projectId, sprintId: p.sprintId,
    completion: yield* cleanName(input, p.completion), evidence: p.evidence }])
})
const validTaskLinks = (input: Input, project: Project, task: Pick<Task, "owner" | "teamId" | "sprintId" | "worktreeId">) => {
  const view = projectView(input.snapshot)
  const team = own(view.teams, projectKey(project.projectId, task.teamId))
  const sprint = own(view.sprints, projectKey(project.projectId, task.sprintId))
  const owner = own(input.snapshot.agents, task.owner)
  return member(input, project.projectId, task.owner) && team !== undefined && sprint !== undefined
    && (task.owner === project.leadAgentId || owner?.groups.includes(team.group ?? projectTeamGroup(project.projectId, team.teamId)) === true)
    && sprint.completion === undefined && team.worktreeId === task.worktreeId
}
const taskCreate: PiecePlanner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.task.create">; const project = yield* requireProject(input, p.projectId)
  if (!validTaskLinks(input, project, p)) return yield* refused("invalid task links or completed sprint")
  const label = p.label === undefined ? undefined : yield* cleanName(input, p.label)
  if (label !== undefined && Object.values(projectView(input.snapshot).tasks).some((row) => row.projectId === p.projectId && row.label?.toLowerCase() === label.toLowerCase())) return yield* refused("task label already exists")
  const taskId = fresh(TaskId); const { requestId, ...fields } = p
  return { events: [{ _tag: "project.TaskAdded", ...fields, ...(label === undefined ? {} : { label }), taskId, title: yield* cleanName(input, p.title) }], reply: () => ({ requestId, taskId }) }
})
const requireTask = (input: Input, projectId: string, taskId: string, write: boolean) => Effect.gen(function* () {
  const project = yield* requireProject(input, projectId, false)
  const task = own(projectView(input.snapshot).tasks, projectKey(projectId, taskId))
  if (task === undefined || write && !canLeadProject(input.snapshot, input.actor, project)
    && !(input.actor._tag === "agent" && input.actor.agentId === task.owner)) return yield* refused("task is unavailable to this caller")
  return { project, task }
})
const taskUpdate: PiecePlanner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.task.update">; const { project, task } = yield* requireTask(input, p.projectId, p.taskId, true)
  const leads = canLeadProject(input.snapshot, input.actor, project)
  if (!leads && (p.owner !== undefined || p.teamId !== undefined || p.sprintId !== undefined || p.worktreeId !== undefined || p.title !== undefined)) return yield* refused("only a lead can change task assignments and titles")
  const changed = { ...task, ...p }
  if (!validTaskLinks(input, project, changed)) return yield* refused("invalid task links or completed sprint")
  const { requestId, ...fields } = p
  return ack(requestId, [{ _tag: "project.TaskChanged", ...fields, ...(p.title === undefined ? {} : { title: yield* cleanName(input, p.title) }) }])
})
const taskNote: PiecePlanner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.task.note">; yield* requireTask(input, p.projectId, p.taskId, true)
  return ack(p.requestId, [{ _tag: "project.TaskNoted", projectId: p.projectId, taskId: p.taskId, title: yield* cleanName(input, p.title), detail: p.detail }])
})

// Cursors are stable keys in the selected collection. Unknown cursors refuse
// instead of silently repeating the first page. Every call rechecks access.
const page = <T>(input: Input, raw: Record<string, unknown>, entries: ReadonlyArray<readonly [string, T]>, data = false) => Effect.gen(function* () {
  const after = raw.after
  const start = after === undefined ? 0 : entries.findIndex(([key]) => key === after) + 1
  if (after !== undefined && start === 0) return yield* refused("invalid cursor")
  const items: T[] = []
  let next: string | undefined
  const wrap = (reply: Record<string, unknown>) => data && input.actor._tag === "agent" ? agentReadReply(raw.requestId, reply) : reply
  for (let i = start; i < entries.length; i++) {
    const [key, item] = entries[i]!
    if (items.length >= (raw.limit as number | undefined ?? 200)) break
    const candidate = { requestId: raw.requestId, items: [...items, item], ...(i < entries.length - 1 ? { next: key } : {}) }
    if (Buffer.byteLength(JSON.stringify(wrap(candidate)), "utf8") > 256 * 1024) {
      if (items.length === 0) return yield* refused("record exceeds the read budget")
      break
    }
    items.push(item); next = i < entries.length - 1 ? key : undefined
  }
  const reply = wrap({ requestId: raw.requestId, items, ...(next === undefined ? {} : { next }) })
  if (Buffer.byteLength(JSON.stringify(reply), "utf8") > 256 * 1024) return yield* refused("record exceeds the read budget")
  return { reply }
})
const goalSet: PiecePlanner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.goal.set">; yield* requireProject(input, p.projectId)
  return ack(p.requestId, [{ _tag: "project.GoalChanged", projectId: p.projectId, goal: p.goal }])
})
const restore: PiecePlanner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.restore">; const row = yield* requireProject(input, p.projectId)
  if (row.archiving) return yield* refused("finish archiving the project before restoring it")
  return ack(p.requestId, row.archivedAt === undefined ? [] : [{ _tag: "project.Restored", projectId: p.projectId }])
})
const settings: ReadHandler = (input, raw) => {
  const settings = projectView(input.snapshot).settings
  return Effect.succeed({ reply: { requestId: raw.requestId, ...(settings === undefined ? {} : { settings }) } })
}
const repositories: ReadHandler = (input, raw) => page(input, raw, Object.entries(projectView(input.snapshot).repositories))
const workspaces: ReadHandler = (input, raw) => page(input, raw, Object.entries(projectView(input.snapshot).workspaces).filter(([, row]) => raw.repoId === undefined || row.repoId === raw.repoId))
const read: ReadHandler = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.read">
  const view = projectView(input.snapshot)
  if (p.projectId !== undefined) yield* requireProject(input, p.projectId, false)
  if (p.collection !== "projects" && p.projectId === undefined) return yield* refused("projectId is required for this collection")
  const allowed = (projectId: string) => (p.projectId === undefined || p.projectId === projectId) && canReadProject(input.snapshot, input.actor, projectId)
  let entries: ReadonlyArray<readonly [string, unknown]>
  switch (p.collection) {
    case "projects": entries = Object.entries(view.projects).filter(([, row]) => allowed(row.projectId)); break
    case "teams": entries = Object.entries(view.teams).filter(([, row]) => allowed(row.projectId)); break
    case "sprints": entries = Object.entries(view.sprints).filter(([, row]) => allowed(row.projectId)); break
    case "tasks": entries = Object.entries(view.tasks).filter(([, row]) => allowed(row.projectId)).map(([key, row]) => [key, taskMetadata(row)] as const); break
    case "agents": entries = projectAgents(input.snapshot, p.projectId!).map((row) => [row.agentId, row] as const); break
  }
  return yield* page(input, raw, entries, true)
})
const taskHistory: ReadHandler = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.task.history">; const { task } = yield* requireTask(input, p.projectId, p.taskId, false)
  return yield* page(input, raw, task.history.map((row, index) => [String(index), row] as const), true)
})
export const projectPlanners = {
  "project.settings.set": settingsSet, "project.repository.add": repositoryAdd, "project.repository.locate": repositoryLocate,
  "project.workspace.register": workspaceRegister, "project.rename": rename, "project.place": place,
  "project.goal.set": goalSet, "project.restore": restore, "project.preferences.set": preferencesSet, "project.stage.set": stageSet, "project.team.create": teamCreate,
  "project.sprint.create": sprintCreate, "project.sprint.update": sprintUpdate, "project.sprint.complete": sprintComplete,
  "project.task.create": taskCreate, "project.task.update": taskUpdate, "project.task.note": taskNote
} satisfies Record<string, PiecePlanner>
const creations: ReadHandler = (input, raw) => page(input, raw, Object.entries(projectView(input.snapshot).creations))
export const projectReads = { "project.creations": creations, "project.settings": settings, "project.repositories": repositories, "project.workspaces": workspaces,
  "project.read": read, "project.task.history": taskHistory } satisfies Record<string, ReadHandler>
