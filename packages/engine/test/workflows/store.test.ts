import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { WorkflowStore } from '../../src/workflows/store.ts'
registerRebuildCheck({ noLog: true })
let root: string, home: string, repo: string, store: WorkflowStore
beforeEach(() => { root = mkdtempSync('/tmp/lgtm-workflows-'); home = join(root, 'home'); repo = join(root, 'repo'); mkdirSync(home); mkdirSync(repo); store = new WorkflowStore(home, repo) })
afterEach(() => rmSync(root, { recursive: true, force: true }))
test('lists the immutable default, clones, saves a rename, reloads and deletes user and repository files', () => {
  expect(store.list()[0]).toMatchObject({ scope: 'default', id: 'build-loop', readOnly: true })
  for (const scope of ['user', 'repository']) {
    const copy: any = store.clone('default', 'build-loop', scope, 'My loop')
    expect(copy.definition.name).toBe('My loop')
    copy.definition.phases[0].blocks[0].name = 'Renamed block'
    copy.definition.name = 'Renamed workflow'
    store.save(scope, copy.id, copy.definition)
    expect(new WorkflowStore(home, repo).read(scope, copy.id).definition.phases[0]!.blocks[0]!.name).toBe('Renamed block')
    expect(store.read(scope, copy.id).definition.name).toBe('Renamed workflow')
    store.delete(scope, copy.id)
    expect(() => store.read(scope, copy.id)).toThrow()
  }
  expect(() => store.save('default', 'build-loop', {})).toThrow()
  expect(() => store.delete('default', 'build-loop')).toThrow()
})
test('lists malformed files with errors without loading them', () => {
  mkdirSync(join(home, '.lgtm/workflows'), { recursive: true })
  writeFileSync(join(home, '.lgtm/workflows/broken.json'), '{')
  writeFileSync(join(home, '.lgtm/workflows/Unsafe name.json'), '{}')
  expect(store.list().find((r) => r.id === 'Unsafe name')).toMatchObject({ error: expect.any(String) })
  expect(store.list().find((r) => r.id === 'broken')).toMatchObject({ error: expect.any(String) })
  expect(() => store.read('user', 'broken')).toThrow()
})
test('refuses traversal, symlink files, linked folders, overwrites and invalid saves', () => {
  const copy = store.clone('default', 'build-loop', 'user', 'Copy')
  expect(() => store.clone('default', 'build-loop', 'user', 'Copy')).toThrow()
  expect(() => store.save('user', copy.id, {})).toThrow()
  for (const id of ['../outside', '/tmp/outside', 'a/b', '..', 'a%2fb']) expect(() => store.delete('user', id)).toThrow()
  const outside = join(root, 'outside.json'); writeFileSync(outside, 'unchanged')
  symlinkSync(outside, join(home, '.lgtm/workflows/link.json'))
  expect(() => store.read('user', 'link')).toThrow()
  expect(() => store.save('user', 'link', copy.definition)).toThrow()
  expect(() => store.delete('user', 'link')).toThrow()
  symlinkSync(root, join(repo, '.lgtm'))
  expect(() => store.clone('default', 'build-loop', 'repository', 'escape')).toThrow()
  expect(readFileSync(outside, 'utf8')).toBe('unchanged')
})
