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
