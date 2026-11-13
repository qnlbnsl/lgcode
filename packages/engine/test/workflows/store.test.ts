import { registerRebuildCheck } from '../support/rebuildCheck.ts'
import { constants as C, promises as fs, mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, linkSync, rmSync, renameSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { WorkflowStore } from '../../src/workflows/store.ts'
registerRebuildCheck({ noLog: true })
let root: string, home: string, repo: string, store: WorkflowStore, definition: any
const folder = () => join(home, '.lgtm/workflows')
beforeEach(async () => {
  root = mkdtempSync('/tmp/lgtm-workflows-'); home = join(root, 'home'); repo = join(root, 'repo')
  mkdirSync(home); mkdirSync(repo); mkdirSync(folder(), { recursive: true }); store = new WorkflowStore(home, repo)
  definition = (await store.read('default', 'build-loop')).definition
})
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }) })
const victim = (path = join(root, 'victim.json')) => { writeFileSync(path, JSON.stringify(definition)); return path }
async function refuseAll(id: string, scope = 'user', selected = store) {
  await expect(selected.read(scope, id)).rejects.toThrow()
  await expect(selected.save(scope, id, { ...definition, name: 'Changed' })).rejects.toThrow()
  await expect(selected.clone(scope, id, 'user', 'Escaped copy')).rejects.toThrow()
  await expect(selected.delete(scope, id)).rejects.toThrow()
}
test('lists, clones, saves and deletes both scopes, with an immutable default', async () => {
  expect((await store.list()).items[0]).toMatchObject({ scope: 'default', readOnly: true })
  for (const scope of ['user', 'repository']) {
    const copy = await store.clone('default', 'build-loop', scope, 'My loop')
    const changed = { ...copy.definition, name: 'Renamed' }
    await store.save(scope, copy.id, changed)
    expect((await new WorkflowStore(home, repo).read(scope, copy.id)).definition.name).toBe('Renamed')
    await store.delete(scope, copy.id)
    await expect(store.read(scope, copy.id)).rejects.toThrow()
  }
  await expect(store.save('default', 'build-loop', definition)).rejects.toThrow('read-only')
  await expect(store.delete('default', 'build-loop')).rejects.toThrow('read-only')
})
test('traversal actions cannot read, overwrite, clone or delete real valid victims', async () => {
  for (const id of ['../victim', '../../victim', join(root, 'absolute'), 'a/../../victim']) {
    const path = id.startsWith('/') ? id + '.json' : join(folder(), id + '.json')
    mkdirSync(join(path, '..'), { recursive: true }); victim(path)
    const before = readFileSync(path, 'utf8')
    await refuseAll(id)
    expect(readFileSync(path, 'utf8')).toBe(before)
  }
})
test('valid workflow symlinks and hard links are refused for every action', async () => {
  const path = victim(), before = readFileSync(path, 'utf8')
  symlinkSync(path, join(folder(), 'symbolic.json')); linkSync(victim(join(root, 'hard-victim.json')), join(folder(), 'hard.json'))
  for (const id of ['symbolic', 'hard']) {
    await refuseAll(id)
    expect((await store.list()).items.find((r) => r.id === id)).toMatchObject({ canDelete: false, error: expect.stringContaining('Remove') })
  }
  expect(readFileSync(path, 'utf8')).toBe(before)
})
test.each(['.lgtm', 'workflows', 'home', 'repository'])('refuses a linked %s folder with valid victim content', async (part) => {
  const outside = join(root, 'outside'); mkdirSync(join(outside, '.lgtm/workflows'), { recursive: true })
  const target = part === '.lgtm' ? join(outside, '.lgtm') : part === 'workflows' ? join(outside, '.lgtm/workflows') : outside
  const base = part === 'repository' ? repo : home
  const path = part === '.lgtm' ? join(base, '.lgtm') : part === 'workflows' ? join(folder()) : base
  const protectedPath = join(outside, '.lgtm/workflows/copy.json'); victim(protectedPath)
  const before = readFileSync(protectedPath, 'utf8')
  rmSync(path, { recursive: true }); symlinkSync(target, path)
  const selected = new WorkflowStore(home, repo), scope = part === 'repository' ? 'repository' : 'user'
  await refuseAll('copy', scope, selected)
  await expect(selected.clone('default', 'build-loop', scope, 'New')).rejects.toThrow()
  expect(readFileSync(protectedPath, 'utf8')).toBe(before)
})
test('special files and oversized files are refused without waiting on a FIFO', async () => {
  execFileSync('mkfifo', [join(folder(), 'pipe.json')])
  const flags: number[] = [], open = fs.open.bind(fs)
  vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    if (String(args[0]).endsWith('/pipe.json')) {
      flags.push(Number(args[1]))
      // A mutation must fail promptly instead of hanging while opening a FIFO.
      if (!(Number(args[1]) & C.O_NONBLOCK)) throw new Error('Probe prevented a blocking FIFO open.')
    }
    return open(...args)
  })
  await refuseAll('pipe')
  expect(flags.length).toBeGreaterThan(0)
  expect(flags.every((flag) => !!(flag & C.O_NONBLOCK))).toBe(true)
  writeFileSync(join(folder(), 'large.json'), JSON.stringify({ ...definition, padding: ' '.repeat(192 * 1024) }))
  await expect(store.read('user', 'large')).rejects.toThrow('192 KiB')
})
test('a file growing after stat is still bounded at read time', async () => {
  const path = victim(join(folder(), 'growing.json')), open = fs.open.bind(fs)
  vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args)
    if (String(args[0]).endsWith('/growing.json')) {
      const stat = handle.stat.bind(handle); let calls = 0
      vi.spyOn(handle, 'stat').mockImplementation(async () => {
        const info = await stat(); if (++calls === 2) writeFileSync(path, JSON.stringify(definition) + ' '.repeat(193 * 1024)); return info
      })
    }
    return handle
  })
  await expect(store.read('user', 'growing')).rejects.toThrow('192 KiB')
})
test('a folder swap after opening keeps writes in the pinned directory', async () => {
  const outside = join(root, 'outside'); mkdirSync(outside); const path = victim(join(outside, 'copy.json')), before = readFileSync(path, 'utf8')
  await store.clone('default', 'build-loop', 'user', 'Copy')
  const open = fs.open.bind(fs); let swapped = false
  vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args)
    if (!swapped && String(args[0]).endsWith('/workflows')) {
      swapped = true; renameSync(folder(), folder() + '-held'); symlinkSync(outside, folder())
    }
    return handle
  })
  await store.save('user', 'copy', { ...definition, name: 'Pinned' })
  expect(readFileSync(path, 'utf8')).toBe(before)
  expect(JSON.parse(readFileSync(folder() + '-held/copy.json', 'utf8')).name).toBe('Pinned')
})
test('bounded asynchronous listing reports a cap and isolates unsafe folders', async () => {
  for (let n = 0; n < 130; n++) victim(join(folder(), `copy-${n}.json`))
  symlinkSync(root, join(repo, '.lgtm'))
  let pulse = false; const timer = setTimeout(() => { pulse = true }, 0)
  const result = await store.list(); clearTimeout(timer)
  expect(pulse).toBe(true)
  expect(result.items.filter((r) => r.scope === 'user')).toHaveLength(100)
  expect(result.folders).toContainEqual(expect.objectContaining({ scope: 'user', truncated: true, limit: 100 }))
  expect(result.folders).toContainEqual(expect.objectContaining({ scope: 'repository', error: expect.any(String) }))
  expect(result.items[0]!.scope).toBe('default')
})
test('malformed regular files can be repaired and unsafe names have manual removal guidance', async () => {
  writeFileSync(join(folder(), 'broken.json'), '{'); writeFileSync(join(folder(), 'Unsafe name.json'), '{}')
  expect((await store.list()).items.find((r) => r.id === 'Unsafe name')).toMatchObject({ canDelete: false, error: expect.stringContaining('Remove') })
  await store.save('user', 'broken', definition)
  expect((await store.read('user', 'broken')).definition).toEqual(definition)
})
test('Unicode names retain their display name and failures have distinct safe reasons', async () => {
  const clone = await store.clone('default', 'build-loop', 'user', '日本語')
  expect(clone.id).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/); expect(clone.name).toBe('日本語')
  await store.clone('default', 'build-loop', 'user', 'Copy')
  await expect(store.clone('default', 'build-loop', 'user', 'Copy')).rejects.toThrow('A workflow with that identifier already exists.')
  await expect(store.save('user', 'missing', definition)).rejects.toThrow('The workflow to save no longer exists.')
  await expect(store.delete('user', 'missing')).rejects.toThrow('The workflow to delete no longer exists.')
})
test('missing descriptor filesystem is refused with a plain sentence', async () => {
  const access = fs.access.bind(fs)
  vi.spyOn(fs, 'access').mockImplementation(async (path, ...rest) => {
    if (path === '/proc/self/fd') throw Object.assign(new Error('absent'), { code: 'ENOENT' })
    return access(path, ...rest)
  })
  await expect(store.list()).rejects.toThrow('Workflow storage requires the descriptor filesystem on this system.')
})

test('the engine default loads from a checkout with spaces without a design folder', () => {
  const checkout = join(root, 'checkout with spaces'); mkdirSync(checkout)
  for (const name of ['store.ts', 'folder.ts', 'build-loop.json']) writeFileSync(join(checkout, name), readFileSync(new URL('../../src/workflows/' + name, import.meta.url)))
  symlinkSync(fileURLToPath(new URL('../../node_modules', import.meta.url)), join(checkout, 'node_modules'))
  const code = `const { WorkflowStore } = await import(${JSON.stringify(new URL('file://' + checkout + '/store.ts').href)}); console.log((await new WorkflowStore(${JSON.stringify(home)}).read('default', 'build-loop')).name)`
  expect(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }).trim()).toBe('Build loop')
})

test('a file swap after open cannot redirect a read to a valid outside workflow', async () => {
  const path = join(folder(), 'swapped.json'), outside = victim()
  writeFileSync(path, JSON.stringify({ ...definition, name: 'Internal workflow' }))
  const open = fs.open.bind(fs); let swapped = false
  vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args)
    if (!swapped && String(args[0]).endsWith('/swapped.json')) {
      swapped = true; renameSync(path, path + '.held'); symlinkSync(outside, path)
    }
    return handle
  })
  expect((await store.read('user', 'swapped')).name).toBe('Internal workflow')
  expect(JSON.parse(readFileSync(outside, 'utf8'))).toEqual(definition)
})
test('valid oversized definitions cannot be saved', async () => {
  const copy = await store.clone('default', 'build-loop', 'user', 'Large save')
  const blocks = definition.phases.flatMap((p: any) => p.blocks)
  const large = { ...definition, moves: Array.from({ length: 1000 }, (_, n) => ({ from: blocks[0].id, to: blocks[1].id, when: 'x'.repeat(190) + n })) }
  await expect(store.save('user', copy.id, large)).rejects.toThrow('192 KiB')
  expect((await store.read('user', copy.id)).name).toBe('Large save')
})
