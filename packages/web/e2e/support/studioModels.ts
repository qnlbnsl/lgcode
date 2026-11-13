import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page } from '@playwright/test'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Redacted from 'effect/Redacted'
import * as SqliteClient from '../../../../third_party/t3code/node-sqlite/src/nodeSqliteClient.ts'
import { buildServices } from '../../../engine/src/service.ts'
import { serve } from '../../../engine/src/client/web/server.ts'
import { engineLists } from '../../../engine/src/pieces/lists.ts'
import { Redactor } from '../../../engine/src/log/Redactor.ts'
import { unusedPort } from '../../../engine/test/support/browserWeb.ts'
import { makeFakeRunner } from '../../../engine/test/support/fakeRunner.ts'
import { appendSetup, call, eventOf, harnessSettings, makeFakeSecrets, makeRig, ownerCredential, removeRig, success } from '../../../engine/test/support/handlerRig.ts'
import { registerRebuildCheck } from '../../../engine/test/support/rebuildCheck.ts'
import { buildStudio } from '../../../studio/scripts/build.ts'
import { completedSetup } from './completedSetup.ts'

export async function exerciseStudioModels(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const rig = makeRig(), previous = process.env.LGTM_HOME
  process.env.LGTM_HOME = rig.stateFolder
  const password = randomBytes(32).toString('base64url'), port = await unusedPort()
  try {
    const studioRoot = await buildStudio(join(rig.root, 'studio')), staticRoot = join(rig.root, 'web')
    mkdirSync(staticRoot); writeFileSync(join(staticRoot, 'index.html'), '<title>Test</title>')
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const runner = yield* makeFakeRunner()
      runner.script('discover', ({ harness: settings, account }) => {
        const harness = settings.id
        return Effect.succeed({ models: { source: 'negotiated', options: [{ id: account.id === 'first-alternate' ? 'alternate-only' : `${harness}-reported`, label: `${harness} reported model` }] }, efforts: { source: 'negotiated', options: [{ id: 'high', label: 'High' }] } })
      })
      const dependencies = Layer.mergeAll(runner.layer, makeFakeSecrets().layer, Layer.succeed(Redactor, { redact: (e) => Effect.succeed(e), redactText: (s) => Effect.succeed(s) }))
      yield* Effect.scoped(Effect.gen(function* () {
        yield* registerRebuildCheck()
        yield* completedSetup()
        for (const id of ['first', 'second', 'no-account']) {
          yield* appendSetup([eventOf({ _tag: 'HarnessChanged', harness: harnessSettings(id, { adapterPath: process.execPath, models: [], efforts: [] }) })])
          if (id !== 'no-account') yield* appendSetup([eventOf({ _tag: 'AccountChanged', accountId: `${id}-account`, account: { id: `${id}-account`, harness: id, displayName: `${id}-account`, enabled: true } })])
        }
        yield* appendSetup([eventOf({ _tag: 'AccountChanged', accountId: 'first-alternate', account: { id: 'first-alternate', harness: 'first', displayName: 'first-alternate', enabled: true } })])
        success(yield* call(ownerCredential, 'project.settings.set', { settings: { workspaceFolder: rig.root, shell: 'sh', lead: { harness: 'first', account: { _tag: 'any' }, permission: 'ask' } } }))
        yield* serve({ password: Redacted.make(password), staticRoot, studioRoot, lists: engineLists, settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: false } })
        yield* Effect.promise(async () => {
          const url = `http://127.0.0.1:${port}/studio/#/settings?section=defaults`
          await page.goto(url)
          await page.locator('#login-password').fill(password)
          await page.getByRole('button', { name: 'Sign in', exact: true }).click()
          await expect(page.locator('#login-password')).toHaveCount(0)
          await page.goto(url)
          await expect(page.locator('#df-model option[value="first-reported"]')).toHaveCount(1)
          const harnesses = page.getByRole('group', { name: 'Harness', exact: true })
          await harnesses.getByRole('button', { name: 'second', exact: true }).click()
          await expect(page.locator('#df-model option[value="second-reported"]')).toHaveCount(1)
          await expect(page.locator('#df-model option[value="first-reported"]')).toHaveCount(0)
          await harnesses.getByRole('button', { name: 'no-account', exact: true }).click()
          await expect(page.getByText('No account is registered for this harness.', { exact: true }).first()).toBeVisible()
          await expect(page.locator('#df-model')).toHaveCount(0)
          await page.goto(`http://127.0.0.1:${port}/studio/#/subscriptions`)
          await expect(page.getByRole('combobox', { name: 'Model for new agents on first-alternate', exact: true }).locator('option[value="alternate-only"]')).toHaveCount(1)
          await expect(page.getByRole('combobox', { name: 'Model for new agents on first-account', exact: true }).locator('option[value="alternate-only"]')).toHaveCount(0)
        })
        expect(runner.callsOf('prompt')).toHaveLength(0)
        expect(runner.callsOf('start')).toHaveLength(0)
        expect(runner.callsOf('discover')).toHaveLength(3)
      })).pipe(Effect.provide(buildServices(rig, engineLists).pipe(Layer.provide(dependencies))), Effect.provide(runner.layer))
    })).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped) as Effect.Effect<void, unknown, never>)
  } finally {
    if (previous === undefined) delete process.env.LGTM_HOME; else process.env.LGTM_HOME = previous
    removeRig(rig)
  }
}
