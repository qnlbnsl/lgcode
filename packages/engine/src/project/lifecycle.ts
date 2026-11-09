import { randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import { ProjectCreation, ProjectId, RepositoryId, WorkspaceId, type Event } from "@lgcode/contracts"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { freshRequest, refused, type Input, type Payload, type Planner, type Runtime } from "../commands/internal.ts"
import { start } from "../commands/start.ts"
import { stop } from "../commands/stop.ts"
import { preempt, withLane } from "../routing/lanes.ts"
import { withWaitChecks } from "../routing/waits.ts"
import { claimFolder, clearFolderClaim, creationGit, creationIo, ensureRepository, ensureWorktree, ensureWorktreeParent, exists,
  folderIdentity, verifyCreation, type FolderIdentity } from "./creationGit.ts"
import { makeGitService } from "./git/index.ts"
import { directory } from "./git/paths.ts"
import { leadDefaults } from "./leadDefaults.ts"
import { cleanName, duplicateName } from "./names.ts"
import { own, projectView, projectKey } from "./view.ts"

export const projectLifecycleCommand = (name: string) => name === "project.create" || name === "project.archive"
const fresh = <S extends Schema.Top & { readonly Type: string }>(schema: S): S["Type"] => Schema.decodeUnknownSync(schema as never)(randomUUID()) as S["Type"]
const leadNames = ["Sage", "Rowan", "Cedar", "Willow", "Aspen", "Laurel", "Hazel", "Alder"] as const
const stem = (name: string) => name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60).replace(/-$/, "") || "project"

const planCreation = (input: Input, payload: Payload<"project.create">, bodyHash: string) => Effect.gen(function* () {
  if (payload.machineId !== "local") return yield* refused("only the confirmed local machine can start a project")
  const view = projectView(input.snapshot)
  const pending = Object.values(view.creations)
  if (pending.length >= 64) return yield* refused("finish pending project creations before starting another")
  const settings = view.settings
  if (settings === undefined) return yield* refused("configure the workspace folder before creating a project")
  const name = yield* cleanName(input, payload.name)
  const goal = yield* input.runtime.log.redactText(payload.goal)
  const lead = yield* leadDefaults(input, settings.lead)
  const root = yield* creationIo(() => directory(settings.workspaceFolder, settings.workspaceFolder))
  let repository: ProjectCreation["repository"], repositoryIdentity: FolderIdentity | undefined
  if (payload.repository._tag === "existing") {
    const repo = own(view.repositories, payload.repository.repoId)
    const location = own(view.locations, projectKey(payload.repository.repoId, payload.machineId))
    if (repo === undefined || location === undefined) return yield* refused("repository location not found")
    const actual = yield* makeGitService({ workspaceFolder: root }).register(location.path).pipe(Effect.mapError(() => refused("repository is unavailable")))
    // The assignment uses the main checkout when Create a worktree is off.
    const path = dirname(actual.commonDirectory)
    yield* makeGitService({ workspaceFolder: root }).register(path).pipe(Effect.mapError(() => refused("main repository checkout is required")))
    repository = { ...repo, path }
    repositoryIdentity = yield* creationIo(() => folderIdentity(path))
  } else {
    const repoName = yield* cleanName(input, payload.repository.name)
    const base = stem(repoName)
    const path = yield* creationIo(async () => {
      for (let i = 1; i <= 100; i++) {
        const candidate = join(root, i === 1 ? base : `${base}-${i}`)
        if (!await exists(candidate) && !pending.some((row) => row.repository.path === candidate)) return candidate
      }
      throw new Error()
    })
    repository = { repoId: fresh(RepositoryId), name: repoName, path }
  }
  if (duplicateName(input, { repoId: repository.repoId, machineId: payload.machineId, name })
    || pending.some((row) => row.repository.repoId === repository.repoId && row.workspace.machineId === payload.machineId && row.name.toLowerCase() === name.toLowerCase())) return yield* refused("project name already exists in this repository")
  const worktree = payload.useWorktree !== false
  let branch = "main", path = repository.path
  if (worktree) {
    const base = stem(name)
    branch = yield* creationIo(async (signal) => {
      for (let i = 1; i <= 100; i++) {
        const next = i === 1 ? base : `${base}-${i}`, target = join(repository.path, ".worktrees", next)
        if (await exists(target) || pending.some((row) => row.workspace.path === target || row.repository.path === repository.path && row.workspace.branch === next)) continue
        if (repositoryIdentity !== undefined) {
          const result = await creationGit(repository.path, ["for-each-ref", "--format=%(refname)", `refs/heads/${next}`], signal)
          if (result.split("\n").includes(`refs/heads/${next}`)) continue
        }
        return next
      }
      throw new Error()
    })
    path = join(repository.path, ".worktrees", branch)
  } else if (repositoryIdentity !== undefined) {
    const state = yield* makeGitService({ workspaceFolder: root }).state(repository.path).pipe(Effect.mapError(() => refused("repository is unavailable")))
    if (state.branch === null) return yield* refused("main repository checkout needs a named branch")
    branch = state.branch
  }
  for (const value of [root, repository.path, path, branch]) if ((yield* input.runtime.log.redactText(value)) !== value) return yield* refused("a path cannot contain a registered secret")
  const existing = !worktree ? Object.values(view.workspaces).find((row) => row.path === path && row.repoId === repository.repoId && row.machineId === "local") : undefined
  return { requestId: payload.requestId, bodyHash, projectId: fresh(ProjectId), repository, workspaceFolder: root,
    workspace: { worktreeId: existing?.worktreeId ?? fresh(WorkspaceId), repoId: repository.repoId, path, branch, machineId: "local",
      checkout: worktree ? "worktree" as const : "main" as const }, newRepository: payload.repository._tag === "new",
    name, goal, shell: settings.shell, leadName: leadNames[Object.keys(view.projects).length % leadNames.length]!, lead,
    ...(repositoryIdentity === undefined ? {} : { repositoryIdentity }) } satisfies ProjectCreation
})

const internalWrite = (runtime: Runtime, events: ReadonlyArray<Event>) => runtime.log.transact((append) =>
  append({ _tag: "owner" }, freshRequest(), randomUUID(), events, {}, false).pipe(Effect.asVoid))
const creation = (runtime: Runtime, requestId: string) => runtime.views.snapshot.pipe(Effect.flatMap((snapshot) => {
  const row = own(projectView(snapshot).creations, requestId)
  return row === undefined ? Effect.fail(refused("project creation intent is unavailable")) : Effect.succeed(row)
}))

// Called by CommandHandler only after owner authentication, typed decoding,
// and the ordinary receipt/hash check. The lifecycle lane precedes the writer.
export const prepareProjectLifecycle = (input: Input, name: string, payload: Record<string, unknown>, bodyHash: string) => Effect.gen(function* () {
  const runtime = input.runtime
  if (name === "project.create") {
    const p = payload as Payload<"project.create">
    yield* runtime.log.transact((append) => Effect.gen(function* () {
      const snapshot = yield* runtime.views.snapshot
      const existing = own(projectView(snapshot).creations, p.requestId)
      if (existing !== undefined) {
        if (existing.bodyHash !== bodyHash) return yield* refused("request id reused")
        return
      }
      const plan = yield* planCreation({ ...input, snapshot }, p, bodyHash)
      yield* append(input.actor, freshRequest(), randomUUID(), [{ _tag: "project.CreationPlanned", creation: plan }], {}, false)
    }))
    let plan = yield* creation(runtime, p.requestId)
    const witness = `${p.requestId}\n${plan.bodyHash}\n`
    if (plan.repositoryIdentity === undefined) {
      const identity = yield* claimFolder(plan.workspaceFolder, plan.repository.path, witness)
      yield* internalWrite(runtime, [{ _tag: "project.CreationClaimed", creationRequestId: p.requestId, kind: "repository", identity }])
      plan = yield* creation(runtime, p.requestId)
    }
    if (plan.newRepository) yield* clearFolderClaim(plan.workspaceFolder, plan.repository.path, witness, plan.repositoryIdentity!)
    yield* ensureRepository(plan)
    if (plan.workspace.checkout === "worktree") {
      yield* ensureWorktreeParent(plan)
      const identity = yield* claimFolder(plan.workspaceFolder, plan.workspace.path, witness, plan.folderIdentity)
      if (plan.folderIdentity === undefined) {
        yield* internalWrite(runtime, [{ _tag: "project.CreationClaimed", creationRequestId: p.requestId, kind: "folder", identity }])
        plan = yield* creation(runtime, p.requestId)
      }
      yield* clearFolderClaim(plan.workspaceFolder, plan.workspace.path, witness, plan.folderIdentity!)
    }
    yield* ensureWorktree(plan)
    yield* verifyCreation(plan)
    return
  }
  const projectId = payload.projectId as string
  yield* runtime.log.transact((append) => Effect.gen(function* () {
    const row = own(projectView(yield* runtime.views.snapshot).projects, projectId)
    if (row === undefined) return yield* refused("project is unavailable to this caller")
    if (row.archivedAt !== undefined || row.archiving) return
    yield* append(input.actor, freshRequest(), randomUUID(), [{ _tag: "project.ArchiveStarted", projectId: row.projectId }], {}, false)
  }))
  // ArchiveStarted prevents new children and resumes in the writer. Every
  // existing member is then stopped under its ordinary process/send lane.
  const members = Object.entries(projectView(yield* runtime.views.snapshot).agentProjects).filter(([, id]) => id === projectId)
  for (const [agentId] of members) {
    yield* Effect.acquireUseRelease(preempt(runtime.log, agentId), () => withLane(runtime.log, agentId)(Effect.gen(function* () {
      // A previously stopped process may have failed to close after its
      // terminal event. Confirm an idempotent runner stop for every member.
      yield* runtime.runner.stop({ agentId: agentId as never }).pipe(Effect.mapError(() => refused("project archive is unfinished because an agent could not stop")))
      yield* runtime.log.transact((append) => Effect.gen(function* () {
        const snapshot = yield* runtime.views.snapshot, agent = own(snapshot.agents, agentId)
        if (agent === undefined || agent.state._tag === "stopped" || agent.state._tag === "crashed") return
        const plan = stop({ runtime, actor: input.actor, snapshot }, agent)
        yield* append(input.actor, freshRequest(), randomUUID(), withWaitChecks(snapshot, plan.events, runtime.lists), plan.sideRows ?? {}, false)
      }))
    })), (settle) => settle)
  }
})

export const createProject: Planner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.create">
  const plan = own(projectView(input.snapshot).creations, p.requestId)
  if (plan === undefined) return yield* refused("project creation intent is unavailable")
  yield* verifyCreation(plan)
  if (duplicateName(input, { repoId: plan.repository.repoId, machineId: plan.workspace.machineId, name: plan.name }, plan.projectId)) return yield* refused("project name already exists in this repository")
  const lead = yield* leadDefaults(input, plan.lead)
  const launch = yield* start(input, { requestId: p.requestId, name: plan.leadName, role: "project-lead", folder: plan.workspace.path, ...lead,
    prompt: `You lead project ${plan.name}. Shape its first plan with the owner.\nGoal:\n${plan.goal}` })
  const started = launch.events.find((row) => row._tag === "AgentStarted")
  if (started?._tag !== "AgentStarted") return yield* refused()
  return { ...launch, ...(launch.afterCommit === undefined ? {} : { afterCommit: launch.afterCommit.pipe(Effect.onError(() =>
    input.runtime.runner.stop({ agentId: started.agentId }).pipe(Effect.catchTag("RunnerRejected", () => Effect.void)))) }), events: [
    ...(plan.newRepository ? [{ _tag: "project.RepositoryAdded" as const, ...plan.repository },
      { _tag: "project.RepositoryLocated" as const, repoId: plan.repository.repoId, machineId: plan.workspace.machineId, path: plan.repository.path }] : []),
    ...(own(projectView(input.snapshot).workspaces, plan.workspace.worktreeId) === undefined ? [{ _tag: "project.WorktreeCreated" as const, ...plan.workspace }] : []),
    ...launch.events,
    { _tag: "project.Created", projectId: plan.projectId, repoId: plan.repository.repoId, name: plan.name, goal: plan.goal,
      leadAgentId: started.agentId, worktreeId: plan.workspace.worktreeId, machineId: plan.workspace.machineId, shell: plan.shell, stage: "plan" },
    { _tag: "project.CreationFinished", creationRequestId: p.requestId }
  ], reply: () => ({ requestId: p.requestId, projectId: plan.projectId }) }
})
export const archiveProject: Planner = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.archive">, view = projectView(input.snapshot)
  const row = own(view.projects, p.projectId)
  if (row === undefined) return yield* refused("project is unavailable to this caller")
  if (Object.values(input.snapshot.agents).some((agent) => own(view.agentProjects, agent.agentId) === p.projectId && !["stopped", "crashed"].includes(agent.state._tag))) return yield* refused("project archive is unfinished because an agent could not stop")
  return { events: row.archivedAt === undefined ? [{ _tag: "project.Archived", projectId: p.projectId }] : [], reply: () => ({ requestId: p.requestId }) }
})
