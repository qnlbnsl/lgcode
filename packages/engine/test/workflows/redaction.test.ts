import * as Effect from 'effect/Effect'
import * as Redacted from 'effect/Redacted'
import { expect, test } from 'vitest'
import { WorkflowStore } from '../../src/workflows/store.ts'
import { workflowReads } from '../../src/workflows/commands.ts'
import { makeRedactor } from '../../src/identity/redactor.ts'
import { emptyProject } from '../../src/project/view.ts'
import type { Input } from '../../src/commands/internal.ts'
import { registerRebuildCheck } from '../support/rebuildCheck.ts'
import { makeRig, removeRig } from '../support/handlerRig.ts'
registerRebuildCheck({ noLog: true })
test('all workflow actions use the real redactor for secrets containing JSON escapes', async () => {
  const rig = makeRig(), secret = 'synthetic\nsecret"value'
  try {
    const copy = await new WorkflowStore(rig.home).clone('default', 'build-loop', 'user', secret)
    const redactor = makeRedactor({ secrets: () => [Redacted.make(secret)], tokenHashes: () => new Set() })
    const input = { actor: { _tag: 'owner' }, runtime: { home: rig.home, stateFolder: rig.stateFolder, log: { redactText: (s: string) => Effect.succeed(redactor.redactText(s)) } }, snapshot: { project: emptyProject() } } as unknown as Input
    for (const action of ['list', 'read', 'clone', 'save', 'validate', 'delete']) {
      const result = await Effect.runPromise(workflowReads['client.workflows.' + action]!(input, { requestId: 'redaction', scope: 'user', id: copy.id, target: 'user', name: secret + ' copy', definition: copy.definition }) as Effect.Effect<any>)
      const serialized = JSON.stringify(result)
      expect(serialized, action).not.toContain(JSON.stringify(secret).slice(1, -1))
      if (['list', 'read', 'clone', 'save'].includes(action)) expect(serialized, action).toContain('[REDACTED]')
    }
  } finally { removeRig(rig) }
})
