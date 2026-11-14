import * as Effect from 'effect/Effect'
import { expect, test } from 'vitest'
import { run, read } from '../../client/support/readRig.ts'
import { call, ownerCredential, agentCredential, seedAgent } from '../../support/handlerRig.ts'
import { CommandHandler } from '../../../src/commands/CommandHandler.ts'
import { resolveSettings } from '../../../src/roles/stall-watch/settings.ts'
import { stallInput } from '../../../src/roles/stall-watch/stallView.ts'
import { registerRebuildCheck } from '../../support/rebuildCheck.ts'

test('saved assigned, worker and lead timers change the stall evaluator input; agents are refused', async () => run(Effect.gen(function* () {
  const agent = yield* seedAgent({ id: 'settings-worker' })
  const handler = yield* CommandHandler
  for (const minutes of [7, 31]) {
    const settings = { assignedStallMinutes: minutes, leadStallMinutes: minutes + 1, limits: { stallMinutes: minutes + 2 } }
    expect((yield* call(ownerCredential, 'roles.settings.set', { settings }))._tag).toBe('Success')
    expect((yield* read('roles.settings.get')).settings).toEqual(settings)
    const input = yield* handler.input({ _tag: 'owner' })
    const snapshot = input.snapshot
    expect(stallInput(snapshot).snapshot.agents[agent.agentId]!.stallMinutes).toBe(minutes)
    expect(resolveSettings(settings, { kind: 'worker', limits: {} }).stallMinutes).toBe(minutes + 2)
    expect(resolveSettings(settings, { kind: 'lead', limits: {} }).stallMinutes).toBe(minutes + 1)
    expect(resolveSettings(settings, { kind: 'lead', limits: { stallMinutes: 44 } }).stallMinutes).toBe(44)
    const refused = yield* call(agentCredential(agent.token), 'roles.settings.set', { settings })
    expect(refused).toMatchObject({ _tag: 'Failure', failure: { reason: 'command refused' } })
  }
}), registerRebuildCheck()))

import { evaluateStall, type StallInput } from '../../../src/roles/stall-watch/rules/stall.ts'
test('saved auto-nudge, attempt count and replacement threshold change who is woken', async () => run(Effect.gen(function* () {
  const handler = yield* CommandHandler
  const evaluate = (settings: object, occurrence: number) => evaluateStall({ now: 600_000,
    snapshot: { sequence: 1, agents: { worker: { state: 'idle', parent: 'owner', role: 'worker' } }, deliveries: {}, roles: { settings, actions: [] } },
    status: { disabled: false }, episode: { elapsed: 600_000, occurrence, addressee: 'worker', post: { postId: 'p', author: 'owner', reply: 'all', to: ['worker'] } },
  } as StallInput)
  for (const settings of [{ autoNudge: false, nudgeAttempts: 2, replaceAfter: 4 }, { autoNudge: true, nudgeAttempts: 1, replaceAfter: 3 }]) {
    expect((yield* call(ownerCredential, 'roles.settings.set', { settings }))._tag).toBe('Success')
    const saved = (yield* read('roles.settings.get')).settings
    expect(evaluate(saved, 0)[0]!.noticeRecipient).toBe(settings.autoNudge ? 'worker' : 'owner')
    expect(evaluate(saved, 1).some((a) => a.noticeRecipient === 'worker')).toBe(!settings.autoNudge ? false : settings.nudgeAttempts > 1)
    expect(evaluate(saved, settings.replaceAfter - 1)[0]!._tag).toBe('roles.ReplaceAdvised')
    expect(evaluate(saved, settings.replaceAfter)).toEqual([])
  }
}), registerRebuildCheck()))

test('zero, negative and huge stall values are refused without replacing saved settings', async () => run(Effect.gen(function* () {
  const settings = { assignedStallMinutes: 7, leadStallMinutes: 31, limits: { stallMinutes: 11 } }
  expect((yield* call(ownerCredential, 'roles.settings.set', { settings }))._tag).toBe('Success')
  for (const value of [0, -1, Number.MAX_SAFE_INTEGER]) for (const patch of [{ assignedStallMinutes: value }, { leadStallMinutes: value }, { limits: { stallMinutes: value } }]) {
    expect(yield* call(ownerCredential, 'roles.settings.set', { settings: patch })).toMatchObject({ _tag: 'Failure' })
    expect((yield* read('roles.settings.get')).settings).toEqual(settings)
  }
}), registerRebuildCheck()))
