import { validateWorkflow } from '@lgtm/contracts/workflows'
import * as Effect from 'effect/Effect'
import { refused, type Input } from '../commands/internal.ts'
import { projectView } from '../project/view.ts'
import { WorkflowStore } from './store.ts'
import type { ReadHandler } from '../api/reads.ts'
const handler = (operation: string): ReadHandler => (input: Input, payload: Record<string, unknown>) => Effect.gen(function* () {
  if (input.actor._tag !== 'owner') return yield* Effect.fail(refused('Only the owner can manage workflows.'))
  if (operation === 'validate') {
    const error = validateWorkflow(payload.definition)
    return { reply: { requestId: payload.requestId, valid: !error, ...(error ? { error } : {}) } }
  }
  const repository = typeof payload.repoId === 'string' ? Object.values(projectView(input.snapshot).repositories).find((r) => r.repoId === payload.repoId) : undefined
  if (payload.repoId !== undefined && !repository) return yield* Effect.fail(refused('Choose a registered repository.'))
  const result = yield* Effect.tryPromise({
    try: async () => {
      const store = new WorkflowStore(input.runtime.home, repository?.path, projectView(input.snapshot).settings?.workflowFolder, input.runtime.stateFolder)
      switch (operation) {
        case 'list': return await store.list()
        case 'read': return { workflow: await store.read(payload.scope as string, payload.id as string) }
        case 'clone': return { workflow: await store.clone(payload.scope as string, payload.id as string, payload.target as string, payload.name as string) }
        case 'save': return { workflow: await store.save(payload.scope as string, payload.id as string, payload.definition) }
        case 'delete': await store.delete(payload.scope as string, payload.id as string); return {}
        default: throw new Error('Unknown workflow action.')
      }
    }, catch: (error) => refused(error instanceof Error && !('code' in error) ? error.message : 'The workflow file is unavailable, unsafe, or already exists.'),
  })
  // Workflow text is owner-authored file data, and can contain a registered secret.
  const clean = (value: unknown): Effect.Effect<unknown> => {
    if (typeof value === 'string') return input.runtime.log.redactText(value)
    if (Array.isArray(value)) return Effect.forEach(value, clean)
    if (value !== null && typeof value === 'object') return Effect.forEach(Object.entries(value), ([key, item]) => clean(item).pipe(Effect.map((text) => [key, text] as const))).pipe(Effect.map(Object.fromEntries))
    return Effect.succeed(value)
  }
  return { reply: { requestId: payload.requestId, ...((yield* clean(result)) as Record<string, unknown>) } }
})
export const workflowReads = Object.fromEntries(['list', 'read', 'clone', 'save', 'validate', 'delete'].map((action) => [`client.workflows.${action}`, handler(action)]))
