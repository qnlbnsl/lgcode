import * as Effect from "effect/Effect"
import { CommandUncertain, refused, type Input, type Payload, type Runtime } from "../commands/internal.ts"
import { MockEditorFileError, saveMockEditorFile, type MockEditorFileChange } from "./mockEditorFile.ts"
import { own, projectKey, projectView } from "./view.ts"

export const mockEditorUncertainReason = "Mock editor save outcome is uncertain; refresh the mocks before retrying."
type Pending = MockEditorFileChange & { readonly projectId: string }
// This engine-owned, request-scoped resource holds bytes and pinned descriptors
// only until the command's writer finishes. It is never a piece hook or event.
const pending = new WeakMap<Runtime["log"], Map<string, Pending>>()
const resourceKey = (p: { requestId: unknown; worktreeId: unknown; projectId: unknown }) => JSON.stringify([p.requestId, p.worktreeId, p.projectId])
export const stageMockEditorFile = (input: Input, p: Payload<"project.mocks.editor.save">, root: string, file: string, expected: string, bytes: Uint8Array) => Effect.uninterruptible(Effect.gen(function* () {
  const change = yield* Effect.tryPromise({ try: () => saveMockEditorFile(root, file, expected, bytes, true),
    catch: (error) => error instanceof MockEditorFileError && error.uncertain ? new CommandUncertain({ reason: mockEditorUncertainReason }) : refused("mock editor file changed or its path is unsafe") })
  let saves = pending.get(input.runtime.log)
  if (saves === undefined) { saves = new Map(); pending.set(input.runtime.log, saves) }
  saves.set(resourceKey(p), { ...change, projectId: p.projectId })
}))

export const settleMockEditorSave = (runtime: Runtime, raw: unknown) => Effect.gen(function* () {
  const p = raw as { requestId?: unknown; worktreeId?: unknown; projectId?: unknown } | null
  if (typeof p?.requestId !== "string" || typeof p.worktreeId !== "string" || typeof p.projectId !== "string") return
  const requestId = p.requestId, key = resourceKey({ requestId, worktreeId: p.worktreeId, projectId: p.projectId })
  const saves = pending.get(runtime.log), change = saves?.get(key)
  if (change === undefined) return
  saves!.delete(key)
  yield* Effect.gen(function* () {
    // Inspect committed state even when the caller lost its response. A
    // committed save must never be rolled back merely because delivery failed.
    const view = projectView(yield* runtime.views.snapshot)
    if (own(view.mockRevisions, projectKey(change.projectId, requestId)) === undefined)
      yield* Effect.tryPromise({ try: change.restore, catch: () => new CommandUncertain({ reason: mockEditorUncertainReason }) })
  }).pipe(Effect.ensuring(Effect.promise(change.close)))
})
