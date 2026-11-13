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
    expect(stallInput(snapshot).snapshot.agents[agent.agentId].stallMinutes).toBe(minutes)
    expect(resolveSettings(settings, { kind: 'worker', limits: {} }).stallMinutes).toBe(minutes + 2)
    expect(resolveSettings(settings, { kind: 'lead', limits: {} }).stallMinutes).toBe(minutes + 1)
    expect(resolveSettings(settings, { kind: 'lead', limits: { stallMinutes: 44 } }).stallMinutes).toBe(44)
    const refused = yield* call(agentCredential(agent.token), 'roles.settings.set', { settings })
    expect(refused).toMatchObject({ _tag: 'Failure', failure: { reason: 'command refused' } })
  }
}), registerRebuildCheck()))
