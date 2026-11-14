import { registerRebuildCheck } from '../support/rebuildCheck.ts'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { checkRestartLaunch, restartAfterShutdown } from '../../src/client/restartLaunch.ts'
registerRebuildCheck({ noLog: true })
test('restart preflight requires readable launch files and an executable Node program', async () => {
  const root = mkdtempSync('/tmp/lgtm-restart-launch-'), execPath = join(root, 'node'), scriptPath = join(root, 'service.ts')
  try {
    writeFileSync(execPath, 'fixture', { mode: 0o700 }); writeFileSync(scriptPath, 'fixture', { mode: 0o600 })
    expect(await checkRestartLaunch({ execPath, scriptPath })).toBe(true)
    chmodSync(execPath, 0o600)
    expect(await checkRestartLaunch({ execPath, scriptPath })).toBe(false)
    chmodSync(execPath, 0o700); chmodSync(scriptPath, 0)
    expect(await checkRestartLaunch({ execPath, scriptPath })).toBe(false)
    chmodSync(scriptPath, 0o600); rmSync(scriptPath)
    expect(await checkRestartLaunch({ execPath, scriptPath })).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('an exec failure after teardown logs a fixed recovery line and exits distinctly without leaking its exception', () => {
  const lines: string[] = [], statuses: number[] = []
  restartAfterShutdown(() => { throw new Error('synthetic secret') }, (line) => lines.push(line), (code) => statuses.push(code))
  expect(lines).toEqual(['Service restart failed after shutdown. Start the service again from the terminal.\n'])
  expect(statuses).toEqual([78])
})
