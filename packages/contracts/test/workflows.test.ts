import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { validateWorkflow } from '../src/workflows.ts'
const file = new URL('../../../design/mock/workflows/build-loop.json', import.meta.url)
test('the shipped build loop validates and covers all eight phases and every named block', () => {
  let data: any
  try { data = JSON.parse(readFileSync(file, 'utf8')) } catch { data = null }
  expect(validateWorkflow(data)).toBeUndefined()
  expect(data.phases.map((p: any) => p.name)).toEqual(['Define', 'Design and teams', 'Plan', 'Build', 'Verify', 'Review', 'Hand over', 'Keep running'])
  for (const name of ['Write each plan', 'Review each plan', 'Next round', 'Build subitems', 'Build without tests', 'Fix team']) {
    expect(data.phases.flatMap((p: any) => p.blocks).some((b: any) => b.name === name)).toBe(true)
  }
})
test('invalid structure, duplicate identities, dangling moves, personal roles and invalid settings are refused', () => {
  const good: any = { version: 1, name: 'Small', settings: { tests: true, agentReview: true, fullReviewRounds: 3, approvalAfterRound: 4, maxReviewRounds: null, stuckPoints: 12, stuckShare: 30, stuckRounds: 3, autoMergeFix: true }, phases: [{ id: 'p', name: 'Phase', blocks: [{ id: 'a', name: 'Build', role: 'builder', steps: [] }] }], moves: [] }
  expect(validateWorkflow(good)).toBeUndefined()
  for (const bad of [null, { ...good, phases: [] }, { ...good, phases: [...good.phases, ...good.phases] }, { ...good, moves: [{ from: 'a', to: 'missing', when: 'done' }] }, { ...good, settings: { ...good.settings, maxReviewRounds: 0 } }, { ...good, phases: [{ ...good.phases[0], blocks: [{ ...good.phases[0].blocks[0], role: 'Maya' }] }] }]) expect(validateWorkflow(bad)).toBeTypeOf('string')
})

test('the definition preserves every state and inner move from the specification', () => {
  const data = JSON.parse(readFileSync(file, 'utf8'))
  const names = new Set(data.phases.flatMap((p: any) => p.blocks.flatMap((b: any) => [b.name, ...b.steps.flatMap((s: any) => [s.from, s.to])])))
  const spec = readFileSync(new URL('../../../docs/specs/2026-11-05-build-loop-design.md', import.meta.url), 'utf8').split('## The steps in each phase')[1]!.split('### Test types')[0]!
  const joined = spec.replace(/\n  /g, ' ')
  for (const line of joined.split('\n').filter((line) => line.startsWith('- ') && line.includes(' -> '))) {
    const [from, rest] = line.slice(2).split(' -> ')
    const to = rest!.split(': ')[0]!
    for (const state of [from!, to]) if (!/^[1-8] /.test(state)) expect(names.has(state), `The spec state ${state} is missing.`).toBe(true)
  }
})
