import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as Effect from 'effect/Effect'
import { afterEach, expect, test, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ script: '', calls: [] as Array<{ file: string; args: string[]; options: any }> }))
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>()
  return { ...actual, execFile: (file: string, args: string[], options: any, callback: any) => {
    fixture.calls.push({ file, args, options })
    return actual.execFile(process.execPath, ['-e', fixture.script], options, callback)
  } }
})
import { gitVersion, serviceControlReads } from '../../src/client/serviceControl.ts'
afterEach(() => { fixture.calls = []; fixture.script = '' })
test('the version process refuses output above 16 kibibytes and accepts the bound exactly', async () => {
  fixture.script = 'process.stdout.write("x".repeat(16384))'
  expect((await gitVersion('/tmp', ['rev-parse', '--verify', 'HEAD'])).length).toBe(16384)
  fixture.script = 'process.stdout.write("x".repeat(16385))'
  await expect(gitVersion('/tmp', ['rev-parse', '--verify', 'HEAD'])).rejects.toThrow('The Git version check is unavailable.')
  fixture.script = 'process.stderr.write("x".repeat(16385))'
  await expect(gitVersion('/tmp', ['rev-parse', '--verify', 'HEAD'])).rejects.toThrow('The Git version check is unavailable.')
})
test('the version process stops a quiet command at ten seconds', async () => {
  fixture.script = 'setTimeout(() => process.stdout.write("late"), 12000)'
  const started = Date.now()
  await expect(gitVersion('/tmp', ['rev-parse', '--verify', 'HEAD'])).rejects.toThrow('The Git version check is unavailable.')
  expect(Date.now() - started).toBeGreaterThanOrEqual(9900)
  expect(fixture.calls[0]!.options.timeout).toBe(10_000)
})
test('hostile extra version fields never reach the process invocation and Git uses its fixed search', async () => {
  const root = mkdtempSync('/tmp/lgtm-version-boundary-'), marker = join(root, 'injected')
  try {
    writeFileSync(join(root, 'package.json'), '{"version":"1.2.3"}')
    fixture.script = 'process.stdout.write("a".repeat(40))'
    const hostile = `$(touch ${marker}); --upload-pack=bad`
    const result = await Effect.runPromise(serviceControlReads['client.service.version']!({ actor: { _tag: 'owner' }, runtime: {
      pluginRoot: root, stateFolder: root, log: { redactText: Effect.succeed },
    } } as any, { requestId: 'fixed-version', check: false, command: hostile, remote: hostile, path: hostile, ref: hostile }) as Effect.Effect<any>)
    expect(result.reply).toMatchObject({ version: '1.2.3', commit: 'a'.repeat(40), checkout: root })
    expect(fixture.calls.length).toBeGreaterThan(0)
    for (const call of fixture.calls) {
      expect(call.file).toBe('git')
      expect(call.options.env.PATH).toBe('/usr/bin:/bin')
      expect(JSON.stringify(call.args)).not.toContain(hostile)
      expect(call.options.cwd === root || call.options.cwd.startsWith('/tmp/lgtm-version-network-')).toBe(true)
    }
    expect(existsSync(marker)).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
