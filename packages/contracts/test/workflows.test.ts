import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { validateWorkflow } from '../src/workflows.ts'
const file = new URL('../../engine/src/workflows/build-loop.json', import.meta.url)
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


test('rejects ambiguous moves, blank inner steps and inconsistent review limits', () => {
  const fresh = () => JSON.parse(readFileSync(file, 'utf8'))
  const d = fresh(), m = d.moves[0]
  d.moves.push({ when: m.when, to: m.to, from: m.from })
  expect(validateWorkflow(d)).toBeTypeOf('string')
  const self = fresh(); self.moves.push({ from: m.from, to: m.from, when: 'again' })
  expect(validateWorkflow(self)).toBeTypeOf('string')
  const capped = fresh(); capped.settings.maxReviewRounds = capped.settings.approvalAfterRound - 1
  expect(validateWorkflow(capped)).toBeTypeOf('string')
  for (const field of ['from', 'to', 'when']) {
    const blank = fresh(); const b = blank.phases.flatMap((p: any) => p.blocks).find((b: any) => b.steps.length)
    b.steps[0][field] = '   '
    expect(validateWorkflow(blank), field).toBeTypeOf('string')
  }
})

test('every default block is reachable and only declared ends can stop', () => {
  const d = JSON.parse(readFileSync(file, 'utf8'))
  const blocks = d.phases.flatMap((p: any) => p.blocks)
  const seen = new Set([blocks[0].id])
  for (let n = 0; n < blocks.length; n++) for (const m of d.moves) if (seen.has(m.from)) seen.add(m.to)
  expect(blocks.filter((b: any) => !seen.has(b.id)).map((b: any) => b.name)).toEqual([])
  expect(blocks.filter((b: any) => !b.end && !d.moves.some((m: any) => m.from === b.id)).map((b: any) => b.name)).toEqual([])
  expect(blocks.some((b: any) => b.end)).toBe(true)
  expect(d.phases[1].blocks.filter((b: any) => b.name === 'Tests on?')).toHaveLength(2)
  const lookup = (name: string) => blocks.find((b: any) => b.name === name)
  for (const name of ['Product tried', 'Approve release?']) expect(lookup(name).role, name).toBe('owner')
  for (const name of ['Plans compared', 'Plans work together?', 'All teams merged']) expect(lookup(name).role, name).toBe('orchestrator')
  expect(lookup('Failure report written').role).toBe('evaluator')
  expect(d.moves.filter((m: any) => m.from === lookup('Approve release?').id && m.when.startsWith('no'))).toHaveLength(2)
  expect(d.moves.some((m: any) => m.from === lookup('Fix team').id && m.to === lookup('Fixes merged').id)).toBe(true)
  expect(d.moves.some((m: any) => m.from === lookup('Failure report written').id && m.to === lookup('Fix team').id)).toBe(true)
})
