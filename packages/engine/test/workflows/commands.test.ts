import * as Effect from 'effect/Effect'
import { expect, test } from 'vitest'
import { agentCredential, seedAgent, appendSetup, eventOf, call, ownerCredential } from '../support/handlerRig.ts'
import { CommandHandler } from '../../src/commands/CommandHandler.ts'
import { join } from 'node:path'
import { run, read, readOutcome } from '../client/support/readRig.ts'
import { registerRebuildCheck } from '../support/rebuildCheck.ts'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
const rig = <A>(program: Effect.Effect<A, any, any>) => run(program, registerRebuildCheck())
test('authenticated workflow API lists, clones, validates, renames, saves, reads and deletes', async () => rig(Effect.gen(function* () {
  const list = yield* read('client.workflows.list')
  expect(list.items[0]).toMatchObject({ scope: 'default', readOnly: true })
  const original = (yield* read('client.workflows.read', { scope: 'default', id: 'build-loop' })).workflow
  const clone = (yield* read('client.workflows.clone', { scope: 'default', id: 'build-loop', target: 'user', name: 'API copy' })).workflow
  clone.definition.name = 'Renamed through API'
  clone.definition.phases[0].blocks[0].name = 'Updated block'
  expect(yield* read('client.workflows.validate', { definition: clone.definition })).toMatchObject({ valid: true })
  expect(yield* read('client.workflows.validate', { definition: {} })).toMatchObject({ valid: false, error: expect.any(String) })
  expect((yield* readOutcome('client.workflows.save', { scope: 'user', id: clone.id, definition: {} }))._tag).toBe('Failure')
  yield* read('client.workflows.save', { scope: 'user', id: clone.id, definition: clone.definition })
  expect((yield* read('client.workflows.read', { scope: 'user', id: clone.id })).workflow.definition).toEqual(clone.definition)
  expect((yield* read('client.workflows.read', { scope: 'default', id: 'build-loop' })).workflow).toEqual(original)
  for (const action of ['save', 'delete']) expect((yield* readOutcome('client.workflows.' + action, { scope: 'default', id: 'build-loop', definition: clone.definition }))._tag).toBe('Failure')
  yield* read('client.workflows.delete', { scope: 'user', id: clone.id })
  expect((yield* readOutcome('client.workflows.read', { scope: 'user', id: clone.id }))._tag).toBe('Failure')
})))
test('workflow API denies agents, unregistered repositories and escaping identities', async () => rig(Effect.gen(function* () {
  const a = yield* seedAgent({ id: 'workflow-agent' })
  const copy = (yield* read('client.workflows.clone', { scope: 'default', id: 'build-loop', target: 'user', name: 'Access control' })).workflow
  for (const action of ['list', 'read', 'clone', 'save', 'validate', 'delete']) expect((yield* readOutcome('client.workflows.' + action, { scope: 'user', id: copy.id, target: 'user', name: 'Refused', definition: copy.definition }, agentCredential(a.token)))._tag).toBe('Failure')
  yield* read('client.workflows.save', { scope: 'user', id: copy.id, definition: copy.definition })
  expect((yield* read('client.workflows.read', { scope: 'user', id: copy.id })).workflow.definition).toEqual(copy.definition)
  expect((yield* readOutcome('client.workflows.list', { repoId: '/tmp/arbitrary' }))._tag).toBe('Failure')
  const handler = yield* CommandHandler
  const input = yield* handler.input({ _tag: 'owner' })
  const victim = join(input.runtime.home, '.lgtm/escape.json')
  mkdirSync(join(input.runtime.home, '.lgtm'), { recursive: true })
  const before = JSON.stringify(copy.definition); writeFileSync(victim, before)
  for (const action of ['read', 'save', 'clone', 'delete']) expect((yield* call(ownerCredential, 'client.workflows.' + action, { scope: 'user', id: '../escape', target: 'user', name: 'Escape copy', definition: copy.definition }))._tag).toBe('Failure')
  expect(readFileSync(victim, 'utf8')).toBe(before)
  yield* read('client.workflows.delete', { scope: 'user', id: copy.id })
  const root = mkdtempSync('/tmp/lgtm-workflow-repo-')
  try {
    yield* appendSetup([eventOf({ _tag: 'project.RepositoryAdded', repoId: 'workflow-repo', name: 'Workflow repository', path: root })])
    const cloned = (yield* read('client.workflows.clone', { scope: 'default', id: 'build-loop', repoId: 'workflow-repo', target: 'repository', name: 'Repository copy' })).workflow
    expect((yield* read('client.workflows.list', { repoId: 'workflow-repo' })).items).toContainEqual(expect.objectContaining({ id: cloned.id, scope: 'repository' }))
  } finally { rmSync(root, { recursive: true, force: true }) }
})))
