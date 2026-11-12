import { ContextPath, ContextReferences, type Caller, type ContextReference, type ContextSearchResult } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { agentReadReply, type ReadHandler } from "../api/reads.ts"
import { refused, type Input, type Payload } from "../commands/internal.ts"
import { canReadProject } from "./access.ts"
import { own, projectKey, projectView } from "./view.ts"
import { gitCall, safePath, withGit, workspacePath, workspaceReference, checkObservedWorkspace } from "./gitApi.ts"

// References confer no access. This also guards reads and future board members.
export const canReadContext = (snapshot: Input["snapshot"], caller: Caller, refs: ReadonlyArray<ContextReference> = []) =>
  refs.every((ref) => canReadProject(snapshot, caller, ref.projectId))

const identity = (input: Input, ref: ContextReference) => Effect.gen(function* () {
  for (const [key, value] of Object.entries(ref)) {
    if (key !== "_tag") yield* safePath(input, value)
  }
})

export type ContextFiles = (input: Input, ref: Extract<ContextReference, { _tag: "file" }>) => Effect.Effect<void, ReturnType<typeof refused>>
// Only the physical file probes run before the writer. The returned closure
// checks exact bindings; resolveContext still admits current participants/tasks.
export const prepareContextFiles = (observed: Input, refs: ReadonlyArray<ContextReference> | undefined) => Effect.gen(function* () {
  const files = yield* Effect.forEach((refs ?? []).filter((ref) => ref._tag === "file"), (ref) => Effect.gen(function* () {
    yield* identity(observed, ref)
    const result = yield* withGit(observed, (git) => Effect.gen(function* () {
      const workspace = yield* workspacePath(observed, ref, git)
      if (workspace.repoId !== ref.repoId) return yield* refused("context repository does not match the project")
      yield* gitCall(git.contextFile(workspace.path, ref.path))
      return workspace
    })).pipe(Effect.result)
    return { ref, result }
  }))
  const check: ContextFiles = (current, ref) => Effect.gen(function* () {
    yield* workspaceReference(current, ref)
    const file = files.find((file) => JSON.stringify(file.ref) === JSON.stringify(ref))
    if (file === undefined) return yield* refused("project state changed; refresh and retry")
    if (file.result._tag === "Failure") return yield* file.result.failure
    yield* checkObservedWorkspace(observed, current, file.result.success, ref.projectId)
  })
  return check
})

// Call under the command writer's permit. An old receipt is returned before
// admission, so an unchanged retry never regenerates text or reference IDs.
export const resolveContext = (input: Input, refs: ReadonlyArray<ContextReference> | undefined,
  recipients: ReadonlyArray<Caller>, files?: ContextFiles) => Effect.gen(function* () {
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
      const workspace = yield* workspaceReference(input, ref)
      if (workspace.repoId !== ref.repoId || ref.repoId !== project.repoId) return yield* refused("context repository does not match the project")
      if (files === undefined) return yield* refused("project state changed; refresh and retry")
      yield* files(input, ref)
      selected.push({ _tag: "file", projectId: project.projectId, repoId: workspace.repoId, worktreeId: workspace.worktreeId, path: ref.path })
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
    // Budget the complete result. `false` is the larger encoded flag value.
    if (result.items.length >= (p.limit ?? 100) || Buffer.byteLength(JSON.stringify({ items: [...result.items, { reference, label: clean }], truncated: false })) > 64 * 1024) {
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
  const wrapped = input.actor._tag === "agent" ? agentReadReply(p.requestId, reply) : reply
  if (Buffer.byteLength(JSON.stringify(wrapped)) > 256 * 1024) return yield* refused("context reply exceeds the read budget")
  return { reply: wrapped }
})
