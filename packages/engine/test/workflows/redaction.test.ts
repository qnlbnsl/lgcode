import * as Effect from 'effect/Effect'
import { expect, test } from 'vitest'
import { WorkflowStore } from '../../src/workflows/store.ts'
import { workflowReads } from '../../src/workflows/commands.ts'
import type { Input } from '../../src/commands/internal.ts'
import { registerRebuildCheck } from '../support/rebuildCheck.ts'
import { makeRig, removeRig } from '../support/handlerRig.ts'
registerRebuildCheck({ noLog: true })
test('workflow replies redact secrets containing JSON escapes before serialization', async () => {
  const rig = makeRig(), secret = 'synthetic\nsecret"value'
  try {
    const copy = new WorkflowStore(rig.home).clone('default', 'build-loop', 'user', secret)
    const input = { actor: { _tag: 'owner' }, runtime: { home: rig.home, log: { redactText: (s: string) => Effect.succeed(s.replaceAll(secret, '[redacted]')) } }, snapshot: {} } as unknown as Input
    const result = await Effect.runPromise(workflowReads['client.workflows.read']!(input, { requestId: 'redaction', scope: 'user', id: copy.id }) as Effect.Effect<any>)
    expect(result.reply.workflow.name).toBe('[redacted]')
    expect(result.reply.workflow.definition.name).toBe('[redacted]')
  } finally { removeRig(rig) }
})
