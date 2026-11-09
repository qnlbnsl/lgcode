import { ContextPath, ContextReferences, type Caller, type ContextReference, type ContextSearchResult } from "@lgcode/contracts"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { agentReadReply, type ReadHandler } from "../api/reads.ts"
import { refused, type Input, type Payload } from "../commands/internal.ts"
import { canReadProject } from "./access.ts"
import { own, projectKey, projectView } from "./view.ts"
import { gitCall, safePath, withGit, workspacePath } from "./gitApi.ts"

// References confer no access. This also guards reads and future board members.
export const canReadContext = (snapshot: Input["snapshot"], caller: Caller, refs: ReadonlyArray<ContextReference> = []) =>
  refs.every((ref) => canReadProject(snapshot, caller, ref.projectId))

const identity = (input: Input, ref: ContextReference) => Effect.gen(function* () {
  for (const [key, value] of Object.entries(ref)) {
    if (key !== "_tag") yield* safePath(input, value)
  }
})

// Call under the command writer's permit. An old receipt is returned before
// admission, so an unchanged retry never regenerates text or reference IDs.
export const resolveContext = (input: Input, refs: ReadonlyArray<ContextReference> | undefined,
  recipients: ReadonlyArray<Caller>) => Effect.gen(function* () {
  if (refs === undefined || refs.length === 0) return undefined
  if (!Schema.is(ContextReferences)(refs) || input.actor._tag !== "owner" && input.actor._tag !== "agent") return yield* refused("context is unavailable to this caller")
  const view = projectView(input.snapshot)
  const selected: ContextReference[] = []
  for (const ref of refs) {
    yield* identity(input, ref)
    if (ref.projectId !== refs[0]!.projectId || !canReadProject(input.snapshot, input.actor, ref.projectId)
      || recipients.some((recipient) => !canReadProject(input.snapshot, recipient, ref.projectId))) return yield* refused("context is unavailable to this conversation")
    const project = own(view.projects, ref.projectId)!
    if (project.archivedAt !== undefined || project.archiving) return yield* refused("context project is archived")
    if (ref._tag === "task") {
      const task = own(view.tasks, projectKey(ref.projectId, ref.taskId))
      if (task === undefined) return yield* refused("context task is unavailable")
      selected.push({ _tag: "task", projectId: project.projectId, taskId: task.taskId })
    } else {
      const file = yield* withGit(input, (git) => Effect.gen(function* () {
        const workspace = yield* workspacePath(input, ref, git)
        if (workspace.repoId !== ref.repoId || ref.repoId !== project.repoId) return yield* refused("context repository does not match the project")
        yield* gitCall(git.contextFile(workspace.path, ref.path))
        return { _tag: "file" as const, projectId: project.projectId, repoId: workspace.repoId, worktreeId: workspace.worktreeId, path: ref.path }
      }))
      selected.push(file)
    }
  }
  return selected
})

export const searchContext: ReadHandler = (input, raw) => Effect.gen(function* () {
  const p = raw as Payload<"project.context.search">
  if (!canReadProject(input.snapshot, input.actor, p.projectId)) return yield* refused("project is unavailable to this caller")
  const view = projectView(input.snapshot), project = own(view.projects, p.projectId)!
  if (project.archivedAt !== undefined || project.archiving) return yield* refused("context project is archived")
  yield* safePath(input, p.projectId); yield* safePath(input, p.worktreeId)
  if (p.teamId !== undefined) {
    yield* safePath(input, p.teamId)
    if (own(view.teams, projectKey(p.projectId, p.teamId))?.worktreeId !== p.worktreeId) return yield* refused("context team workspace does not match")
  }
  const result: { items: Array<typeof ContextSearchResult.Type.items[number]>; truncated: boolean } = { items: [], truncated: false }
  const add = (reference: ContextReference, label: string) => Effect.gen(function* () {
    yield* identity(input, reference)
    const clean = yield* input.runtime.log.redactText(label)
    if (result.items.length >= (p.limit ?? 100) || Buffer.byteLength(JSON.stringify([...result.items, { reference, label: clean }])) > 64 * 1024) {
      result.truncated = true; return
    }
    result.items.push({ reference, label: clean })
  })
  // Validate the registered placement even for a tasks-only search.
  yield* withGit(input, (git) => Effect.gen(function* () {
    const workspace = yield* workspacePath(input, p, git)
    if (p.scope !== "files") {
      for (const task of Object.values(view.tasks)) {
        if (task.projectId !== p.projectId || p.teamId !== undefined && task.teamId !== p.teamId) continue
        const label = `${task.label ?? task.taskId} · ${task.title}`
        // Match the redacted display, never a hidden secret substring.
        if (!(yield* input.runtime.log.redactText(label)).toLowerCase().includes(p.query.toLowerCase())) continue
        yield* add({ _tag: "task", projectId: task.projectId, taskId: task.taskId }, label)
      }
    }
    if (p.scope !== "tasks") {
      const files = yield* gitCall(git.contextFiles(workspace.path, p.query))
      result.truncated ||= files.truncated
      for (const path of files.items) {
        if (!Schema.is(ContextPath)(path)) continue
        // A redacted identity cannot be selected or replayed faithfully.
        if ((yield* input.runtime.log.redactText(path)) !== path) continue
        yield* add({ _tag: "file", projectId: p.projectId, repoId: workspace.repoId, worktreeId: workspace.worktreeId, path }, path)
      }
    }
  }))
  const reply = { requestId: p.requestId, result }
  return { reply: input.actor._tag === "agent" ? agentReadReply(p.requestId, reply) : reply }
})
