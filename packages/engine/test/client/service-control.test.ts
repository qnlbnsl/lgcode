import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import * as Effect from 'effect/Effect'
import { afterEach, expect, test } from 'vitest'
import { run, read, readOutcome } from './support/readRig.ts'
import { agentCredential, seedAgent, call, ownerCredential } from '../support/handlerRig.ts'
import { CommandHandler } from '../../src/commands/CommandHandler.ts'
import { installRestarter, serviceVersion, serviceRestartPending } from '../../src/client/serviceControl.ts'
import { engineLists } from '../../src/pieces/lists.ts'
import { registerRebuildCheck } from '../support/rebuildCheck.ts'
afterEach(() => installRestarter(undefined))
test('version and confirmed restart deny agents with the exact reason; restart stops agents before acknowledgement', async () => run(Effect.gen(function* () {
  expect(engineLists.reads['client.service.restart']).toBeTypeOf('function')
  expect(engineLists.access['client.service.restart']).toEqual(['owner'])
  const agent = yield* seedAgent({ id: 'restart-worker' })
  const credentials = agentCredential(agent.token)
  for (const name of ['client.service.version', 'client.service.restart']) {
    expect(yield* readOutcome(name, { confirmed: true, check: true }, credentials)).toMatchObject({ _tag: 'Failure', failure: { reason: 'command refused' } })
  }
  expect(yield* readOutcome('client.service.restart', { confirmed: false })).toMatchObject({ _tag: 'Failure', failure: { reason: 'Confirm that every signed-in page is signed out and running agents are stopped.' } })
  expect(yield* readOutcome('client.service.restart', { confirmed: true })).toMatchObject({ _tag: 'Failure', failure: { reason: 'This service cannot restart itself on this platform.' } })
  let restarts = 0
  installRestarter(() => { restarts++ })
  expect(yield* read('client.service.restart', { confirmed: true })).toMatchObject({ restarting: true })
  expect(serviceRestartPending()).toBe(true)
  expect(restarts).toBe(1)
  const snapshot = (yield* (yield* CommandHandler).input({ _tag: 'owner' })).snapshot
  expect(snapshot.agents[agent.agentId]?.state._tag).toBe('stopped')
  expect(yield* call(ownerCredential, 'resume', { agentId: agent.agentId })).toMatchObject({ _tag: 'Failure', failure: { reason: 'service restarting' } })
  expect(yield* read('client.service.restart', { confirmed: true })).toMatchObject({ restarting: true })
  expect(restarts).toBe(1)
}), registerRebuildCheck()))

test('hostile extra version and restart fields cannot supply commands, paths or Git options', async () => run(Effect.gen(function* () {
  const value = '$(touch /tmp/lgtm-s6-injection); --upload-pack=touch'
  const direct = yield* call(ownerCredential, 'client.service.version', {})
  expect(direct).toMatchObject({ _tag: 'Success' })
  expect(yield* read('client.service.version')).toMatchObject({ comparison: 'unchecked' })
  expect(yield* read('client.service.version', { command: value, path: '/etc', remote: value, ref: value })).toMatchObject({ comparison: 'unchecked', checkout: (yield* (yield* CommandHandler).input({ _tag: 'owner' })).runtime.pluginRoot })
  expect(yield* call(ownerCredential, 'client.service.version', { check: value })).toMatchObject({ _tag: 'Failure', failure: { reason: 'command refused' } })
  expect(yield* call(ownerCredential, 'client.service.restart', { confirmed: value, command: value })).toMatchObject({ _tag: 'Failure', failure: { reason: 'command refused' } })
  expect(existsSync('/tmp/lgtm-s6-injection')).toBe(false)
}), registerRebuildCheck()))

test('version reports the checkout commit and refuses executable Git transports and credential URLs', async () => {
  registerRebuildCheck({ noLog: true })
  const root = mkdtempSync('/tmp/lgtm-version-')
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }))
    const git = (...args: string[]) => execFileSync('/usr/bin/git', args, { cwd: root, encoding: 'utf8' }).trim()
    git('init', '-b', 'master'); git('add', 'package.json')
    git('-c', 'user.name=Owner', '-c', 'user.email=owner@example.invalid', 'commit', '-m', 'Version fixture')
    expect(await serviceVersion(root)).toMatchObject({ version: '1.2.3', commit: git('rev-parse', 'HEAD'), comparison: 'unchecked' })
    for (const remote of ['ext::touch /tmp/lgtm-s6-injection', 'ssh://example.invalid/repo', 'https://user:password@example.invalid/repo', '--upload-pack=bad']) {
      git('config', 'remote.origin.url', remote)
      expect(await serviceVersion(root, true)).toMatchObject({ comparison: 'unavailable', version: '1.2.3' })
    }
    const calls: string[][] = []
    const check = async (_cwd: string, args: string[]) => { calls.push(args); return args[0] === 'config' ? 'https://example.invalid/owner/repository.git' : git('rev-parse', 'HEAD') + '\tHEAD' }
    expect(await serviceVersion(root, true, check)).toMatchObject({ comparison: 'same' })
    expect(calls).toEqual([['config', '--get', 'remote.origin.url'], ['ls-remote', '--exit-code', '--', 'https://example.invalid/owner/repository.git', 'HEAD']])
    expect(await serviceVersion(root, true, async (_cwd, args) => args[0] === 'config' ? 'https://example.invalid/owner/repository.git' : 'a'.repeat(40) + '\tHEAD')).toMatchObject({ comparison: 'different' })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: 'changed-on-disk' }))
    expect(await serviceVersion(root)).toMatchObject({ version: '1.2.3' })
    expect(existsSync('/tmp/lgtm-s6-injection')).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
