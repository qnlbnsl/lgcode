import * as Effect from "effect/Effect"
import * as Semaphore from "effect/Semaphore"
import { type Runtime, type Input, refused } from "../commands/internal.ts"
import { agentReadReply } from "../api/reads.ts"
import { canReadProject } from "./access.ts"
import { own, projectView } from "./view.ts"
import { makeGitService, type GitService, type GitOperation, type Conflict } from "./git/index.ts"

// One queue owner per command runtime. The gate survives settings replacement,
// including overlapping roots. It never releases an active child operation early.
const owners = new WeakMap<Runtime, { gate: Semaphore.Semaphore; queued: number; root?: string; service?: GitService }>()
export const withGit = <A, E, R>(input: Input, body: (git: GitService) => Effect.Effect<A, E, R>) => Effect.suspend(() => {
  let owner = owners.get(input.runtime)
  if (owner === undefined) { owner = { gate: Semaphore.makeUnsafe(1), queued: 0 }; owners.set(input.runtime, owner) }
  const state = owner
  return Effect.acquireUseRelease(Effect.suspend(() => {
    if (state.queued >= 64) return Effect.fail(refused("Git operation queue is full; retry shortly"))
    state.queued++
    return Effect.succeed(state)
  }), () => state.gate.withPermit(Effect.gen(function* () {
    const root = projectView(yield* input.runtime.views.snapshot).settings?.workspaceFolder
    if (root === undefined) return yield* refused("set the workspace folder before using Git")
    if (root !== projectView(input.snapshot).settings?.workspaceFolder) return yield* refused("workspace settings changed; refresh and retry")
    if (state.root !== root) { state.service = makeGitService({ workspaceFolder: root }); state.root = root }
    // Service operations have a finite timeout. Waiting remains interruptible;
    // an active operation finishes before its gate is released, even on disconnect.
    return yield* Effect.uninterruptible(body(state.service!))
  })), () => Effect.sync(() => { state.queued-- }))
})
export const gitCall = <A>(effect: GitOperation<A>) => effect.pipe(Effect.mapError((error) => refused(`Git: ${error.reason}`)))
export const localMachine = (id: string) => id === "local" ? Effect.void : Effect.fail(refused("only the local machine can register a checkout before machine pairing"))
export const safePath = (input: Input, path: string) => Effect.gen(function* () {
  if ((yield* input.runtime.log.redactText(path)) !== path) return yield* refused("a path cannot contain a registered secret")
})
export const repositoryPath = (input: Input, id: string) => Effect.gen(function* () {
  const view = projectView(input.snapshot)
  const repository = own(view.repositories, id)
  const location = Object.values(view.locations).find((row) => row.repoId === id && row.machineId === "local")
  if (repository === undefined || location === undefined) return yield* refused("repository location not found")
  yield* safePath(input, repository.path); yield* safePath(input, location.path)
  return { repository, location }
})
export const workspacePath = (input: Input, raw: Record<string, unknown>, git: GitService) => Effect.gen(function* () {
  const view = projectView(input.snapshot)
  const workspace = own(view.workspaces, raw.worktreeId as string)
  if (workspace === undefined) return yield* refused("registered workspace not found")
  yield* localMachine(workspace.machineId)
  if (input.actor._tag !== "owner" || raw.projectId !== undefined) {
    const id = raw.projectId as string
    const project = own(view.projects, id)
    if (project === undefined || !canReadProject(input.snapshot, input.actor, id) || project.repoId !== workspace.repoId
      || !(project.worktreeId === workspace.worktreeId || Object.values(view.teams).some((team) => team.projectId === id && team.worktreeId === workspace.worktreeId))) {
      return yield* refused("project is unavailable to this caller")
    }
  }
  yield* safePath(input, workspace.path)
  const { repository, location } = yield* repositoryPath(input, workspace.repoId)
  const main = yield* gitCall(git.register(repository.path))
  const local = yield* gitCall(git.register(location.path))
  const checkout = yield* gitCall(git.register(workspace.path))
  if (main.commonDirectory !== local.commonDirectory || main.commonDirectory !== checkout.commonDirectory) return yield* refused("checkout belongs to a different repository")
  const state = yield* gitCall(git.state(checkout.path))
  if (state.branch !== workspace.branch) return yield* refused("registered workspace branch changed; restore the registered branch")
  return workspace
})
// No identifier exemption applies to Git text. Paths, authors, patches, hunk
// sides, ref names and URLs all pass through the production text redactor.
export const gitReply = (input: Input, requestId: unknown, result: unknown, agent = false) => Effect.gen(function* () {
  const redact = (value: unknown, key?: string): Effect.Effect<unknown> => {
    // Schema discriminators and hunk choices are fixed protocol values, not
    // display text. Preserve these exact positions so redaction cannot turn
    // a valid conflict into an unencodable or unresolvable reply.
    if (key === "kind" && ["context", "conflict", "compare"].includes(value as string)) return Effect.succeed(value)
    if (key === "choices" && Array.isArray(value)) return Effect.succeed(value)
    if (typeof value === "string") return input.runtime.log.redactText(value)
    if (Array.isArray(value)) return Effect.forEach(value, (item) => redact(item))
    if (value !== null && typeof value === "object") return Effect.forEach(Object.entries(value), ([key, item]) => redact(item, key).pipe(Effect.map((clean) => [key, clean] as const))).pipe(Effect.map(Object.fromEntries))
    return Effect.succeed(value)
  }
  const clean = yield* redact(result)
  const reply = { requestId, result: clean }
  const wrapped = agent && input.actor._tag === "agent" ? agentReadReply(requestId, reply) : reply
  if (Buffer.byteLength(JSON.stringify(wrapped), "utf8") > 256 * 1024) return yield* refused("Git reply exceeds the read budget; select a smaller file or page")
  return wrapped
})
// The service reconstructs canonical content. The request carries choices and
// identity only, never caller-authored segments or replacement file content.
export const selection = (raw: Record<string, unknown>): Conflict => ({
  ...(raw.selection as Pick<Conflict, "path" | "fingerprint" | "head" | "choices">), ours: "", base: "", theirs: "", segments: []
})
