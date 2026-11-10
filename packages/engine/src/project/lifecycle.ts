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
import { withGit, gitCall } from "./gitApi.ts"
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
  if (payload.useWorktree === false) return yield* refused("projects require a dedicated worktree")
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
    const actual = yield* withGit(input, (git) => git.register(location.path)).pipe(Effect.mapError(() => refused("repository is unavailable")))
    // Keep the repository's main checkout as the owner's review destination.
    const path = dirname(actual.commonDirectory)
    yield* withGit(input, (git) => git.register(path)).pipe(Effect.mapError(() => refused("main repository checkout is required")))
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
  const base = stem(name)
  const branch = yield* withGit(input, () => creationIo(async (signal) => {
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
  }))
  const path = join(repository.path, ".worktrees", branch)
  for (const value of [root, repository.path, path, branch]) if ((yield* input.runtime.log.redactText(value)) !== value) return yield* refused("a path cannot contain a registered secret")
  return { requestId: payload.requestId, bodyHash, projectId: fresh(ProjectId), repository, workspaceFolder: root,
    workspace: { worktreeId: fresh(WorkspaceId), repoId: repository.repoId, path, branch, machineId: "local",
      checkout: "worktree" as const }, newRepository: payload.repository._tag === "new",
    name, goal, shell: settings.shell, leadName: leadNames[Object.keys(view.projects).length % leadNames.length]!, lead,
    ...(repositoryIdentity === undefined ? {} : { repositoryIdentity }) } satisfies ProjectCreation
})

// The exact creation selector performs only local observations. Readiness
// resolution is read-only; paths are not claimed until lifecycle preparation.
export const previewProjectPlacement: import("../api/reads.ts").ReadHandler = (input, raw) => Effect.gen(function* () {
  const plan = yield* planCreation(input, raw as Payload<"project.create">, "preview")
  return { reply: { requestId: raw.requestId, result: { repositoryPath: plan.repository.path, path: plan.workspace.path,
    branch: plan.workspace.branch, checkout: plan.workspace.checkout!, reserved: false } } }
})

const internalWrite = (runtime: Runtime, events: ReadonlyArray<Event>) => runtime.log.transact((append) =>
  append({ _tag: "owner" }, freshRequest(), randomUUID(), events, {}, false).pipe(Effect.asVoid))
const creation = (runtime: Runtime, requestId: string) => runtime.views.snapshot.pipe(Effect.flatMap((snapshot) => {
  const row = own(projectView(snapshot).creations, requestId)
  return row === undefined ? Effect.fail(refused("project creation intent is unavailable")) : Effect.succeed(row)
}))

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const dedicatedCreation = (plan: ProjectCreation) => plan.workspace.checkout === "worktree" && plan.workspace.path !== plan.repository.path
  ? Effect.void : Effect.fail(refused("projects require a dedicated worktree"))
const checkCreationBindings = (observed: Input, current: Input, plan: ProjectCreation) => Effect.gen(function* () {
  const before = projectView(observed.snapshot), now = projectView(current.snapshot), repoId = plan.repository.repoId
  const locations = (view: typeof now) => Object.values(view.locations).filter((row) => row.repoId === repoId)
  const workspaces = (view: typeof now) => Object.values(view.workspaces).filter((row) => row.repoId === repoId)
  if (current.actor._tag !== "owner" || !same(before.settings, now.settings) || now.settings?.workspaceFolder !== plan.workspaceFolder
    || !same(own(before.repositories, repoId), own(now.repositories, repoId))
    || !same(locations(before), locations(now)) || !same(workspaces(before), workspaces(now))) return yield* refused("project state changed; refresh and retry")
})
const admitCreation = (input: Input, plan: ProjectCreation) => Effect.gen(function* () {
  yield* dedicatedCreation(plan)
  const view = projectView(input.snapshot)
  if (duplicateName(input, { repoId: plan.repository.repoId, machineId: plan.workspace.machineId, name: plan.name }, plan.projectId)
    || Object.values(view.creations).some((row) => row.requestId !== plan.requestId && (row.repository.repoId === plan.repository.repoId
      && row.workspace.machineId === plan.workspace.machineId && row.name.toLowerCase() === plan.name.toLowerCase()
      || row.workspace.path === plan.workspace.path || row.newRepository && row.repository.path === plan.repository.path))) return yield* refused("project name already exists in this repository")
  if (plan.newRepository && (own(view.repositories, plan.repository.repoId) !== undefined
    || Object.values(view.repositories).some((row) => row.path === plan.repository.path))) return yield* refused("repository is already registered")
  if (Object.values(view.workspaces).some((row) => row.path === plan.workspace.path && row.machineId === plan.workspace.machineId
    && (row.worktreeId !== plan.workspace.worktreeId || row.repoId !== plan.repository.repoId))) return yield* refused("workspace is already registered")
  if (own(view.projects, plan.projectId) !== undefined) return yield* refused("project state changed; refresh and retry")
})

// Called by CommandHandler only after owner authentication, typed decoding,
// and the ordinary receipt/hash check. The lifecycle lane precedes the writer.
export const prepareProjectLifecycle = (input: Input, name: string, payload: Record<string, unknown>, bodyHash: string) => Effect.gen(function* () {
  const runtime = input.runtime
  if (name === "project.create") {
    const p = payload as Payload<"project.create">
    const existing = own(projectView(input.snapshot).creations, p.requestId)
    if (existing !== undefined && existing.bodyHash !== bodyHash) return yield* refused("request id reused")
    if (p.useWorktree === false) return yield* refused("projects require a dedicated worktree")
    const prospective = existing ?? (yield* planCreation(input, p, bodyHash))
    yield* runtime.log.transact((append) => Effect.gen(function* () {
      const current = { ...input, snapshot: yield* runtime.views.snapshot }
      const view = projectView(current.snapshot), saved = own(view.creations, p.requestId)
      if (saved !== undefined) {
        if (saved.bodyHash !== bodyHash) return yield* refused("request id reused")
        yield* dedicatedCreation(saved)
        return
      }
      yield* checkCreationBindings(input, current, prospective)
      if (Object.keys(view.creations).length >= 64) return yield* refused("finish pending project creations before starting another")
      yield* admitCreation(current, prospective)
      yield* leadDefaults(current, prospective.lead)
      yield* append(input.actor, freshRequest(), randomUUID(), [{ _tag: "project.CreationPlanned", creation: prospective }], {}, false)
    }))
    let plan = yield* creation(runtime, p.requestId)
    // Historical main-checkout intents stay readable and reserved, but cannot
    // resume filesystem effects or start a lead under the current policy.
    yield* dedicatedCreation(plan)
    const witness = `${p.requestId}\n${plan.bodyHash}\n`
    if (plan.repositoryIdentity === undefined) {
      const identity = yield* claimFolder(plan.workspaceFolder, plan.repository.path, witness)
      yield* internalWrite(runtime, [{ _tag: "project.CreationClaimed", creationRequestId: p.requestId, kind: "repository", identity }])
      plan = yield* creation(runtime, p.requestId)
    }
    if (plan.newRepository) yield* clearFolderClaim(plan.workspaceFolder, plan.repository.path, witness, plan.repositoryIdentity!)
    yield* withGit(input, () => ensureRepository(plan))
    if (plan.workspace.checkout === "worktree") {
      yield* ensureWorktreeParent(plan)
      const identity = yield* claimFolder(plan.workspaceFolder, plan.workspace.path, witness, plan.folderIdentity)
      if (plan.folderIdentity === undefined) {
        yield* internalWrite(runtime, [{ _tag: "project.CreationClaimed", creationRequestId: p.requestId, kind: "folder", identity }])
        plan = yield* creation(runtime, p.requestId)
      }
      yield* clearFolderClaim(plan.workspaceFolder, plan.workspace.path, witness, plan.folderIdentity!)
    }
    yield* withGit(input, (git) => ensureWorktree(plan, git))
    const observed = { ...input, snapshot: yield* runtime.views.snapshot }
    const mainState = yield* withGit(observed, (git) => Effect.gen(function* () {
      yield* verifyCreation(plan, git)
      return yield* gitCall(git.state(plan.repository.path))
    }))
    if (mainState.branch === null) return yield* refused("main repository checkout needs a named branch")
    return finishCreation(observed, plan, mainState.branch)
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

// The handler must supply the request-local physical observation. There is no
// Git-reading fallback on the writer path.
export const createProject: Planner = () => Effect.fail(refused("project creation intent is unavailable"))
const finishCreation = (observed: Input, observedPlan: ProjectCreation, mainBranch: string): Planner => (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.create">
  const plan = own(projectView(input.snapshot).creations, p.requestId)
  if (plan === undefined) return yield* refused("project creation intent is unavailable")
  if (!same(plan, observedPlan)) return yield* refused("project state changed; refresh and retry")
  yield* checkCreationBindings(observed, input, plan)
  yield* admitCreation(input, plan)
  const view = projectView(input.snapshot)
  const main = Object.values(view.workspaces).find((row) => row.repoId === plan.repository.repoId && row.machineId === "local" && row.path === plan.repository.path)
  if (main !== undefined && main.branch !== mainBranch) return yield* refused("registered workspace branch changed; restore the registered branch")
  const mainWorkspace = main ?? { worktreeId: plan.workspace.checkout === "main" ? plan.workspace.worktreeId : fresh(WorkspaceId),
    repoId: plan.repository.repoId, machineId: "local", path: plan.repository.path, branch: mainBranch, checkout: "main" as const }
  const lead = yield* leadDefaults(input, plan.lead)
  const launch = yield* start(input, { requestId: p.requestId, name: plan.leadName, role: "project-lead", folder: plan.workspace.path, ...lead,
    prompt: `You lead project ${plan.name}. Shape its first plan with the owner.\nGoal:\n${plan.goal}` })
  const started = launch.events.find((row) => row._tag === "AgentStarted")
  if (started?._tag !== "AgentStarted") return yield* refused()
  return { ...launch, ...(launch.afterCommit === undefined ? {} : { afterCommit: launch.afterCommit.pipe(Effect.onError(() =>
    input.runtime.runner.stop({ agentId: started.agentId }).pipe(Effect.catchTag("RunnerRejected", () => Effect.void)))) }), events: [
    ...(plan.newRepository ? [{ _tag: "project.RepositoryAdded" as const, ...plan.repository },
      { _tag: "project.RepositoryLocated" as const, repoId: plan.repository.repoId, machineId: plan.workspace.machineId, path: plan.repository.path }] : []),
    ...(main === undefined ? [{ _tag: "project.WorktreeCreated" as const, ...mainWorkspace }] : []),
    ...(plan.workspace.worktreeId !== mainWorkspace.worktreeId && own(projectView(input.snapshot).workspaces, plan.workspace.worktreeId) === undefined ? [{ _tag: "project.WorktreeCreated" as const, ...plan.workspace }] : []),
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
