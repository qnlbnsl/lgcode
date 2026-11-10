import * as Effect from "effect/Effect"
import { type Event } from "@lgcode/contracts"
import { type ReadHandler } from "../api/reads.ts"
import { type PiecePlanner, type Input, refused, CommandUncertain } from "../commands/internal.ts"
import { withGit, gitCall, gitReply, workspacePath, repositoryPath, selection } from "./gitApi.ts"
import { type GitService, type GitOperation } from "./git/index.ts"
import { callerKey } from "../identity/caller.ts"
import { own, projectKey, projectView } from "./view.ts"
import { reviewPlanners, reviewReads } from "./gitReview.ts"

type Raw = Record<string, unknown>
const workspaceRead = (run: (git: GitService, path: string, raw: Raw, agentRead: boolean) => GitOperation<unknown>): ReadHandler =>
  (input, raw) => withGit(input, (git) => Effect.gen(function* () {
    const workspace = yield* workspacePath(input, raw, git)
    const result = yield* gitCall(run(git, workspace.path, raw, input.actor._tag === "agent"))
    return { reply: yield* gitReply(input, raw.requestId, result, true) }
  }))
const repositoryRead = (run: (git: GitService, path: string) => GitOperation<unknown>): ReadHandler =>
  (input, raw) => withGit(input, (git) => Effect.gen(function* () {
    const { repository, location } = yield* repositoryPath(input, raw.repoId as string)
    const main = yield* gitCall(git.register(repository.path)), local = yield* gitCall(git.register(location.path))
    if (main.commonDirectory !== local.commonDirectory) return yield* refused("checkout belongs to a different repository")
    return { reply: yield* gitReply(input, raw.requestId, yield* gitCall(run(git, local.path))) }
  }))
const mutate = (run: (git: GitService, path: string, raw: Raw, input: Input) => Effect.Effect<unknown, import("./git/types.ts").GitFailure | import("../commands/internal.ts").CommandRefused>): PiecePlanner =>
  (input, raw) => withGit(input, (git) => Effect.gen(function* () {
    const workspace = yield* workspacePath(input, raw, git)
    const attempt = own(projectView(input.snapshot).gitAttempts, projectKey(callerKey(input.actor), raw.requestId as string))
    if (attempt !== undefined && raw.message === undefined && raw.expectedHead === undefined) {
      const current = yield* gitCall(git.mutationIdentity(workspace.path))
      if (JSON.stringify(current) !== JSON.stringify(attempt.before)) return yield* refused("Git: stale_state")
    }
    const operation = run(git, workspace.path, raw, input)
    const result = yield* operation.pipe(Effect.mapError((error) => error._tag === "GitFailure" ? error.uncertain ? new CommandUncertain({ reason: "Git outcome is uncertain; refresh Git state" }) : refused(`Git: ${error.reason}`) : error))
    const reply = result === undefined ? { requestId: raw.requestId } : yield* gitReply(input, raw.requestId, result).pipe(Effect.mapError(() => new CommandUncertain({ reason: "Git outcome is uncertain; refresh Git state" })))
    return { events: [] as Event[], reply: () => reply }
  }))
const discover: ReadHandler = (input, raw) => withGit(input, (git) => Effect.gen(function* () {
  const found = yield* gitCall(git.discover())
  return { reply: yield* gitReply(input, raw.requestId, { ...found, items: found.items.map(({ name, path }) => ({ name, path })) }) }
}))
export const gitReads = {
  ...reviewReads,
  "project.repository.discover": discover,
  "project.branches": repositoryRead((git, path) => git.branches(path)),
  "project.checkouts": repositoryRead((git, path) => git.worktrees(path)),
  "project.changes": workspaceRead((git, path, _raw, agentRead) => git.changes(path, agentRead)),
  "project.diff": workspaceRead((git, path, raw, agentRead) => git.diff(path, { agentRead,
    ...(raw.path === undefined ? {} : { path: raw.path as string }), ...(raw.staged === undefined ? {} : { staged: raw.staged as boolean }),
    ...(raw.commit === undefined ? {} : { commit: raw.commit as string }) })),
  "project.history": workspaceRead((git, path, raw) => git.history(path, raw.limit as number | undefined)),
  "project.commit.files": workspaceRead((git, path, raw, agentRead) => git.commitFiles(path, raw.commit as string, agentRead)),
  "project.git.state": workspaceRead((git, path, raw) => git.state(path, raw.target as string | undefined)),
  "project.review": workspaceRead((git, path, raw, agentRead) => git.review(path, raw.base as string, agentRead)),
  "project.conflict": workspaceRead((git, path, raw, agentRead) => git.conflict(path, raw.path as string, agentRead)),
  "project.conflict.choose": workspaceRead((git, path, raw) => git.choose(path, selection(raw), raw.hunk as number, raw.choice as import("./git/types.ts").ConflictChoice)),
  "project.discard.plan": workspaceRead((git, path, raw) => git.planDiscard(path, raw.paths as string[] | undefined)),
} satisfies Record<string, ReadHandler>
export const gitPlanners = {
  ...reviewPlanners,
  "project.stage": mutate((git, path, raw) => git.stage(path, raw.path as string)),
  "project.unstage": mutate((git, path, raw) => git.unstage(path, raw.path as string)),
  "project.stage.all": mutate((git, path) => git.stageAll(path)),
  "project.unstage.all": mutate((git, path) => git.unstageAll(path)),
  "project.discard": mutate((git, path, raw) => git.discard(path, raw.plan as import("./git/types.ts").DiscardPlan, raw.confirmed as boolean)),
  "project.commit": mutate((git, path, raw, input) => Effect.gen(function* () {
    const attempt = own(projectView(input.snapshot).gitAttempts, projectKey(callerKey(input.actor), raw.requestId as string))
    if (attempt !== undefined && JSON.stringify(yield* gitCall(git.mutationIdentity(path))) !== JSON.stringify(attempt.before)) return yield* refused("Git: stale_state")
    return { head: yield* gitCall(git.commit(path, raw.message as string)) }
  })),
  "project.fetch": mutate((git, path) => git.fetch(path)),
  "project.pull": mutate((git, path) => git.pull(path)),
  "project.push": mutate((git, path) => git.push(path)),
  "project.integrate": mutate((git, path, raw, input) => Effect.gen(function* () {
    const destination = yield* workspacePath(input, { ...raw, worktreeId: raw.destinationId }, git)
    const source = own(projectView(input.snapshot).workspaces, raw.worktreeId as string)!
    // Integrations use the recorded team-to-project relationship, never a
    // caller-selected branch target or an unrelated checkout in the repository.
    const view = projectView(input.snapshot)
    const team = Object.values(view.teams).find((row) => row.worktreeId === source.worktreeId)
    const project = team === undefined ? undefined : own(view.projects, team.projectId)
    if (project?.worktreeId !== destination.worktreeId || source.parentId !== destination.worktreeId || source.repoId !== destination.repoId) {
      return yield* refused("integration requires a registered team source and its project workspace")
    }
    return { head: yield* gitCall(git.mergeTeam(path, destination.path, raw.expectedHead as string)) }
  })),
  "project.conflict.resolve": mutate((git, path, raw) => git.resolve(path, selection(raw))),
} satisfies Record<string, PiecePlanner>
