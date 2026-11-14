import * as Effect from 'effect/Effect'
import { expect, test, vi } from 'vitest'
import { promises as fs, mkdirSync, symlinkSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { run, read } from '../client/support/readRig.ts'
import { call, ownerCredential, agentCredential, seedAgent } from '../support/handlerRig.ts'
import { CommandHandler } from '../../src/commands/CommandHandler.ts'
import { workflowFolderReason } from '../../src/workflows/folder.ts'
import { registerRebuildCheck } from '../support/rebuildCheck.ts'

test('saved workflow folder redirects file storage; hostile paths and agent settings are refused', async () => run(Effect.gen(function* () {
  const input = yield* (yield* CommandHandler).input({ _tag: 'owner' })
  const root = input.runtime.home, first = join(root, 'first'), second = join(root, 'second')
  mkdirSync(first); mkdirSync(second)
  const settings = { workspaceFolder: first, shell: '/bin/sh' }
  const set = (workflowFolder: string) => call(ownerCredential, 'project.settings.set', { settings: { ...settings, workflowFolder } })
  expect((yield* set(first))._tag).toBe('Success')
  const copy = (yield* read('client.workflows.clone', { scope: 'default', id: 'build-loop', target: 'user', name: 'Folder copy' })).workflow
  expect(existsSync(join(first, copy.id + '.json'))).toBe(true)
  expect((yield* set(second))._tag).toBe('Success')
  expect((yield* read('client.workflows.list')).items.some((w: any) => w.id === copy.id)).toBe(false)
  const before = readFileSync(join(first, copy.id + '.json'), 'utf8')
  const marker = join(root, 'hostile-marker')
  symlinkSync(first, join(root, 'link'))
  for (const path of ['relative', input.runtime.stateFolder, join(input.runtime.stateFolder, 'missing'), join(root, 'link'), join(root, 'missing'), join(root, '--upload-pack=bad'), join(root, `$(touch ${marker})`), first + '/../../../../etc', first + '\0bad']) {
    const refused = yield* set(path)
    expect(refused).toMatchObject({ _tag: 'Failure' })
    if (path !== first + '\0bad') expect(refused).toMatchObject({ failure: { reason: workflowFolderReason } })
    expect(readFileSync(join(first, copy.id + '.json'), 'utf8')).toBe(before)
    expect(existsSync(marker)).toBe(false)
  }
  const agent = yield* seedAgent({ id: 'folder-agent' })
  expect(yield* call(agentCredential(agent.token), 'project.settings.set', { settings: { ...settings, workflowFolder: first } })).toMatchObject({ _tag: 'Failure', failure: { reason: 'command refused' } })
}), registerRebuildCheck()))

test('review defaults are saved and returned exactly; no reviewer selector exists yet', async () => run(Effect.gen(function* () {
  const input = yield* (yield* CommandHandler).input({ _tag: 'owner' })
  const workspaceFolder = join(input.runtime.home, 'workspace'); mkdirSync(workspaceFolder)
  for (const reviewDefaults of [{ reviewers: 1, differentVendor: false }, { reviewers: 4, differentVendor: true }]) {
    expect((yield* call(ownerCredential, 'project.settings.set', { settings: { workspaceFolder, shell: '/bin/sh', reviewDefaults } }))._tag).toBe('Success')
    expect((yield* read('project.settings')).settings.reviewDefaults).toEqual(reviewDefaults)
  }
}), registerRebuildCheck()))

test('omitted workflow folder and review defaults stay saved; an explicit clear restores the default', async () => run(Effect.gen(function* () {
  const input = yield* (yield* CommandHandler).input({ _tag: 'owner' })
  const folder = join(input.runtime.home, 'saved-workflows'); mkdirSync(folder)
  const settings = { workspaceFolder: folder, shell: '/bin/sh' }, reviewDefaults = { reviewers: 4, differentVendor: false }
  expect((yield* call(ownerCredential, 'project.settings.set', { settings: { ...settings, workflowFolder: folder, reviewDefaults } }))._tag).toBe('Success')
  expect((yield* call(ownerCredential, 'project.settings.set', { settings }))._tag).toBe('Success')
  expect((yield* read('project.settings')).settings).toMatchObject({ workflowFolder: folder, reviewDefaults })
  expect((yield* call(ownerCredential, 'project.settings.set', { settings, clearWorkflowFolder: true }))._tag).toBe('Success')
  expect((yield* read('project.settings')).settings).not.toHaveProperty('workflowFolder')
  expect((yield* read('project.settings')).settings.reviewDefaults).toEqual(reviewDefaults)
  const copy = (yield* read('client.workflows.clone', { scope: 'default', id: 'build-loop', target: 'user', name: 'Default folder' })).workflow
  expect(existsSync(join(input.runtime.home, '.lgtm', 'workflows', copy.id + '.json'))).toBe(true)
}), registerRebuildCheck()))


test('the workflow folder ownership check refuses a real directory whose file descriptor reports another user', async () => run(Effect.gen(function* () {
  const input = yield* (yield* CommandHandler).input({ _tag: 'owner' })
  const folder = join(input.runtime.home, 'other-owner'); mkdirSync(folder)
  const actualOpen = fs.open.bind(fs)
  const mocked = vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const handle = await actualOpen(...args)
    if (String(args[0]).endsWith('/other-owner')) {
      const actualStat = handle.stat.bind(handle)
      vi.spyOn(handle, 'stat').mockImplementation(async () => ({ ...await actualStat(), uid: process.getuid!() + 1 }) as any)
    }
    return handle
  })
  try {
    expect(yield* call(ownerCredential, 'project.settings.set', { settings: { workspaceFolder: input.runtime.home, shell: '/bin/sh', workflowFolder: folder } })).toMatchObject({ _tag: 'Failure', failure: { reason: workflowFolderReason } })
    expect((yield* read('project.settings')).settings?.workflowFolder).toBeUndefined()
  } finally { mocked.mockRestore() }
}), registerRebuildCheck()))
