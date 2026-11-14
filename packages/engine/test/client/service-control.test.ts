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
  expect(engineLists.planners['client.service.restart']).toBeTypeOf('function')
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
  expect(yield* readOutcome('client.service.restart', { confirmed: true })).toMatchObject({ _tag: 'Failure', failure: { reason: 'service restarting' } })
  expect(restarts).toBe(1)
}), registerRebuildCheck()))

test('malformed version and restart controls are refused before a restarter runs', async () => run(Effect.gen(function* () {
  let restarts = 0
  installRestarter(() => { restarts++ })
  expect(yield* call(ownerCredential, 'client.service.version', { check: '--upload-pack=bad' })).toMatchObject({ _tag: 'Failure', failure: { reason: 'command refused' } })
  expect(yield* call(ownerCredential, 'client.service.restart', { confirmed: '$(touch marker)' })).toMatchObject({ _tag: 'Failure', failure: { reason: 'command refused' } })
  expect(restarts).toBe(0)
}), registerRebuildCheck()))

test('version reports the checkout commit and refuses executable Git transports and credential URLs', async () => {
  registerRebuildCheck({ noLog: true })
  const root = mkdtempSync('/tmp/lgtm-version-')
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }))
    const git = (...args: string[]) => execFileSync('/usr/bin/git', args, { cwd: root, encoding: 'utf8' }).trim()
    git('init', '-b', 'master'); git('add', 'package.json')
    git('-c', 'user.name=Owner', '-c', 'user.email=owner@example.invalid', 'commit', '-m', 'Version fixture')
    git('config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*')
    git('config', 'branch.master.remote', 'origin'); git('config', 'branch.master.merge', 'refs/heads/master')
    git('update-ref', 'refs/remotes/origin/master', 'HEAD')
    expect(await serviceVersion(root)).toMatchObject({ version: '1.2.3', commit: git('rev-parse', 'HEAD'), comparison: 'unavailable', updateCommands: [] })
    for (const remote of ['ext::touch /tmp/lgtm-s6-injection', 'ssh://example.invalid/repo', 'https://user:password@example.invalid/repo', '--upload-pack=bad']) {
      git('config', 'remote.origin.url', remote)
      expect(await serviceVersion(root, true)).toMatchObject({ comparison: 'unavailable', version: '1.2.3' })
    }
    git('config', 'remote.origin.url', 'https://example.invalid/owner/repository.git')
    git('config', 'protocol.ext.allow', 'always')
    git('config', 'url.ext::touch /tmp/lgtm-s6-injection.insteadOf', 'https://example.invalid/owner/repository.git')
    expect(await serviceVersion(root, true)).toMatchObject({ comparison: 'unavailable' })
    expect(existsSync('/tmp/lgtm-s6-injection')).toBe(false)
    const calls: string[][] = []
    const check = async (_cwd: string, args: string[]) => { calls.push(args); return args[0] === 'config' ? 'https://example.invalid/owner/repository.git' : args[0] === 'symbolic-ref' ? 'refs/heads/master' : args[0] === 'for-each-ref' ? 'origin\0refs/heads/master' : git('rev-parse', 'HEAD') + '\trefs/heads/master' }
    expect(await serviceVersion(root, true, check)).toMatchObject({ comparison: 'same' })
    expect(calls).toEqual([['symbolic-ref', '--quiet', 'HEAD'], ['for-each-ref', '--format=%(upstream:remotename)%00%(upstream:remoteref)', '--', 'refs/heads/master'], ['config', '--get', 'remote.origin.url'], ['ls-remote', '--exit-code', '--', 'https://example.invalid/owner/repository.git', 'refs/heads/master']])
    expect(await serviceVersion(root, true, async (_cwd, args) => args[0] === 'config' ? 'https://example.invalid/owner/repository.git' : args[0] === 'symbolic-ref' ? 'refs/heads/master' : args[0] === 'for-each-ref' ? 'origin\0refs/heads/master' : 'a'.repeat(40) + '\trefs/heads/master')).toMatchObject({ comparison: 'different' })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: 'changed-on-disk' }))
    expect(await serviceVersion(root)).toMatchObject({ version: '1.2.3' })
    expect(existsSync('/tmp/lgtm-s6-injection')).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('restart preflight refuses missing or non-file launch paths before stopping any agent', async () => run(Effect.gen(function* () {
  const agent = yield* seedAgent({ id: 'preflight-worker' })
  const input = yield* (yield* CommandHandler).input({ _tag: 'owner' })
  let restarts = 0
  for (const launch of [
    { execPath: join(input.runtime.home, 'missing-node'), scriptPath: process.argv[1]! },
    { execPath: process.execPath, scriptPath: join(input.runtime.home, 'missing-script') },
    { execPath: input.runtime.home, scriptPath: process.argv[1]! },
    { execPath: process.execPath, scriptPath: input.runtime.home },
  ]) {
    installRestarter(() => { restarts++ }, launch)
    expect(yield* readOutcome('client.service.restart', { confirmed: true })).toMatchObject({ _tag: 'Failure', failure: { reason: 'The service launch files are unavailable. Restart was refused before stopping agents.' } })
    expect(serviceRestartPending()).toBe(false)
    expect((yield* (yield* CommandHandler).input({ _tag: 'owner' })).snapshot.agents[agent.agentId]?.state._tag).toBe('idle')
    expect(restarts).toBe(0)
  }
}), registerRebuildCheck()))

test('restart writes an owner-attributed receipt before stopping, refuses a second request and never repeats a replay', async () => run(Effect.gen(function* () {
  const agent = yield* seedAgent({ id: 'receipt-worker' })
  let restarts = 0
  const start = () => { restarts++ }
  installRestarter(start)
  const requestId = 'owner-restart-receipt'
  expect(yield* read('client.service.restart', { requestId, confirmed: true })).toMatchObject({ restarting: true })
  const input = yield* (yield* CommandHandler).input({ _tag: 'owner' })
  const rows = yield* input.runtime.sql<{ sequence: number; caller: string; event_type: string }>`SELECT sequence, caller, event_type FROM events WHERE event_type IN ('client.ServiceRestartRequested', 'AgentStopped') ORDER BY sequence`
  expect(rows[0]).toMatchObject({ event_type: 'client.ServiceRestartRequested' })
  expect(rows[0]!.caller).toBe('owner')
  expect(rows[1]?.event_type).toBe('AgentStopped')
  expect(yield* read('client.service.restart', { requestId, confirmed: true })).toMatchObject({ restarting: true })
  expect(yield* readOutcome('client.service.restart', { requestId: 'another-restart', confirmed: true })).toMatchObject({ _tag: 'Failure', failure: { reason: 'service restarting' } })
  expect(restarts).toBe(1)
  // Simulate a new executable boot with the durable receipt still in the log.
  installRestarter(start)
  expect(yield* read('client.service.restart', { requestId, confirmed: true })).toMatchObject({ restarting: true })
  expect(restarts).toBe(1)
  expect(yield* readOutcome('client.service.restart', { requestId, confirmed: false })).toMatchObject({ _tag: 'Failure', failure: { reason: 'request id reused' } })
  expect(input.snapshot.agents[agent.agentId]?.state._tag).toBe('stopped')
}), registerRebuildCheck()))

test('credential-bearing HTTPS URLs are refused before a network command even when the network would succeed', async () => {
  const root = mkdtempSync('/tmp/lgtm-credential-url-')
  try {
    const commands: string[][] = []
    const git = async (_cwd: string, args: string[]) => {
      commands.push(args)
      if (args[0] === 'symbolic-ref') return 'refs/heads/feature'
      if (args[0] === 'for-each-ref') return 'origin\0refs/heads/feature'
      if (args[0] === 'config') return 'https://user:password@example.invalid/repo'
      return 'a'.repeat(40) + '\trefs/heads/feature'
    }
    expect(await serviceVersion(root, true, git)).toMatchObject({ comparison: 'unavailable', updateCommands: [] })
    expect(commands.some((args) => args[0] === 'ls-remote')).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('version networking ignores checkout-specific certificate settings and compares the tracked branch', async () => {
  const root = mkdtempSync('/tmp/lgtm-tracked-version-')
  try {
    writeFileSync(join(root, 'package.json'), '{"version":"1.2.3"}')
    const local = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
    local('init', '-b', 'feature'); local('add', 'package.json')
    local('-c', 'user.name=Owner', '-c', 'user.email=owner@example.invalid', 'commit', '-m', 'Fixture')
    local('config', 'remote.origin.url', 'https://example.invalid/repo')
    local('config', 'http.https://example.invalid/repo.sslVerify', 'false')
    local('config', 'branch.feature.remote', 'origin'); local('config', 'branch.feature.merge', 'refs/heads/feature')
    local('config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*')
    local('update-ref', 'refs/remotes/origin/feature', 'HEAD')
    let networkCwd = ''
    const git = async (cwd: string, args: string[]) => {
      if (args[0] !== 'ls-remote') return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
      networkCwd = cwd
      expect(cwd).not.toBe(root)
      expect(execFileSync('git', ['-c', 'http.sslVerify=true', 'config', '--get-urlmatch', 'http.sslVerify', 'https://example.invalid/repo'], { cwd, encoding: 'utf8' }).trim()).not.toBe('false')
      expect(args).toEqual(['ls-remote', '--exit-code', '--', 'https://example.invalid/repo', 'refs/heads/feature'])
      return local('rev-parse', 'HEAD') + '\trefs/heads/feature'
    }
    const result = await serviceVersion(root, true, git)
    expect(result).toMatchObject({ comparison: 'same', trackedBranch: 'origin/feature' })
    expect(result.updateCommands.join('\n')).toContain("git fetch -- 'origin' 'refs/heads/feature'")
    expect(result.updateCommands.join('\n')).not.toContain('origin HEAD')
    expect(existsSync(networkCwd)).toBe(false)
    local('config', '--unset', 'branch.feature.remote')
    const untracked = await serviceVersion(root, true)
    expect(untracked).toMatchObject({ comparison: 'unavailable', updateCommands: [], reason: 'This checkout has no tracked remote branch. No update commands are available.' })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
