import * as Effect from "effect/Effect"
import { type Event } from "@lgcode/contracts"
import { type ReadHandler } from "../api/reads.ts"
import { type PiecePlanner, type Input, refused } from "../commands/internal.ts"
import { withGit, gitCall, gitReply, workspacePath, repositoryPath, selection } from "./gitApi.ts"
import { type GitService, type GitOperation } from "./git/index.ts"
import { own, projectView } from "./view.ts"

type Raw = Record<string, unknown>
const workspaceRead = (run: (git: GitService, path: string, raw: Raw) => GitOperation<unknown>): ReadHandler =>
  (input, raw) => withGit(input, (git) => Effect.gen(function* () {
    const workspace = yield* workspacePath(input, raw, git)
    const result = yield* gitCall(run(git, workspace.path, raw))
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
    const operation = run(git, workspace.path, raw, input)
    const result = yield* operation.pipe(Effect.mapError((error) => error._tag === "GitFailure" ? refused(`Git: ${error.reason}`) : error))
    const reply = result === undefined ? { requestId: raw.requestId } : yield* gitReply(input, raw.requestId, result)
    return { events: [] as Event[], reply: () => reply }
  }))
const discover: ReadHandler = (input, raw) => withGit(input, (git) => Effect.gen(function* () {
  const found = yield* gitCall(git.discover())
  return { reply: yield* gitReply(input, raw.requestId, { ...found, items: found.items.map(({ name, path }) => ({ name, path })) }) }
}))
export const gitReads = {
  "project.repository.discover": discover,
  "project.branches": repositoryRead((git, path) => git.branches(path)),
  "project.checkouts": repositoryRead((git, path) => git.worktrees(path)),
  "project.changes": workspaceRead((git, path) => git.changes(path)),
  "project.diff": workspaceRead((git, path, raw) => git.diff(path, {
    ...(raw.path === undefined ? {} : { path: raw.path as string }), ...(raw.staged === undefined ? {} : { staged: raw.staged as boolean }),
    ...(raw.commit === undefined ? {} : { commit: raw.commit as string }) })),
  "project.history": workspaceRead((git, path, raw) => git.history(path, raw.limit as number | undefined)),
  "project.commit.files": workspaceRead((git, path, raw) => git.commitFiles(path, raw.commit as string)),
  "project.git.state": workspaceRead((git, path, raw) => git.state(path, raw.target as string | undefined)),
  "project.review": workspaceRead((git, path, raw) => git.review(path, raw.base as string)),
  "project.conflict": workspaceRead((git, path, raw) => git.conflict(path, raw.path as string)),
  "project.conflict.choose": workspaceRead((git, path, raw) => git.choose(path, selection(raw), raw.hunk as number, raw.choice as import("./git/types.ts").ConflictChoice)),
  "project.review.open": workspaceRead((git, path, raw) => git.openReview(path, raw.base as string, raw.expectedHead as string).pipe(
    Effect.map((result) => ({ ...result, kind: "compare" as const, opened: false as const })))),
  "project.discard.plan": workspaceRead((git, path, raw) => git.planDiscard(path, raw.paths as string[] | undefined)),
} satisfies Record<string, ReadHandler>
export const gitPlanners = {
  "project.stage": mutate((git, path, raw) => git.stage(path, raw.path as string)),
  "project.unstage": mutate((git, path, raw) => git.unstage(path, raw.path as string)),
  "project.stage.all": mutate((git, path) => git.stageAll(path)),
  "project.unstage.all": mutate((git, path) => git.unstageAll(path)),
  "project.discard": mutate((git, path, raw) => git.discard(path, raw.plan as import("./git/types.ts").DiscardPlan, raw.confirmed as boolean)),
  "project.commit": mutate((git, path, raw) => git.commit(path, raw.message as string).pipe(Effect.map((head) => ({ head })))),
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
