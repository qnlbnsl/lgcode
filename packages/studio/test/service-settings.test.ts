// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { serviceSettingsSource } from '../scripts/serviceSettings.ts'
import { harnessChoicesSource } from '../scripts/harnessChoices.ts'
import { harnessIntegrationSource } from '../scripts/harnessIntegration.ts'
import { gitActionsSource } from '../scripts/gitActions.ts'
const transformer = readFileSync('packages/studio/scripts/serviceSettings.ts', 'utf8')
const needles = [...transformer.matchAll(/(?:source\.)?replace(?:All)?\(((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'))/g)]
  .map((match) => new Function(`return ${match[1]}`)() as string)
for (const path of ['js/live/git.js', 'js/screens/service.js']) {
  const original = readFileSync(`design/mock/${path}`, 'utf8')
  const current = gitActionsSource(path, harnessIntegrationSource(path, harnessChoicesSource(path, original)))
  test(`all settings patches match the merged ${path}`, () => {
    const result = serviceSettingsSource(path, current)
    expect(result).toContain('serviceSettings.')
    if (path.includes('screens')) expect(result).toContain('Notifications')
  })
  for (const from of new Set(needles.filter((needle) => current.includes(needle)))) {
    test(`refuses absent or duplicated settings patch ${path}: ${from.slice(0, 50)}`, () => {
      expect(() => serviceSettingsSource(path, current.split(from).join(''))).toThrow('Service settings integration')
      expect(() => serviceSettingsSource(path, current + from)).toThrow('Service settings integration')
    })
  }
}

test('a version reply preserves settings saved while it was in flight and ignores extra reply settings', async () => {
  const source = readFileSync('design/mock/js/live/service-settings.js', 'utf8').replace(/^import .*;$/gm, '').replace(/^export \{.*;$/gm, '').replace(/export /g, '')
  let release!: (value: unknown) => void
  const held = new Promise((resolve) => { release = resolve })
  const connection = {}, state = { session: { status: 'in' }, settings: { stallWorker: 10, version: 'old' } }, store = { state }
  const loadVersion = new Function('store', 'engine', 'engineWrite', 'run', 'toast', `${source}; return loadVersion;`)(
    store, { request: () => held, connection: () => connection }, (patch: any) => Object.assign(store.state, patch), (_key: string, operation: () => unknown) => operation(), () => {})
  const loading = loadVersion(true)
  state.settings = { stallWorker: 31, version: 'old' }
  release({ version: 'new', commit: 'abc', comparison: 'same', dataFolder: '/state', checkout: '/checkout', updateCommands: [], stallWorker: 999 })
  await loading
  expect(state.settings).toMatchObject({ stallWorker: 31, version: 'new', commit: 'abc', versionComparison: 'same' })
})
