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
import { call, ownerCredential, success, makeFakeSecrets, makeRig, removeRig } from '../../../engine/test/support/handlerRig.ts'
import { registerRebuildCheck } from '../../../engine/test/support/rebuildCheck.ts'
import { decisionSetup } from '../../../engine/test/support/projectDecisionFixtures.ts'
import { buildStudio } from '../../../studio/scripts/build.ts'
import { completedSetup } from './completedSetup.ts'

export async function exerciseStudioSettings(page: Page) {
  const rig = makeRig(), previous = process.env.LGTM_HOME
  process.env.LGTM_HOME = rig.stateFolder
  const password = randomBytes(32).toString('base64url')
  const workflowFolder = join(rig.home, 'owner-workflows'); mkdirSync(workflowFolder)
  const staticRoot = join(rig.root, 'static'); mkdirSync(staticRoot)
  writeFileSync(join(staticRoot, 'index.html'), '<title>Test service</title>')
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message))
  try {
    const studioRoot = await buildStudio(join(rig.root, 'studio')), port = await unusedPort()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const runner = yield* makeFakeRunner()
      const dependencies = Layer.mergeAll(runner.layer, makeFakeSecrets().layer, Layer.succeed(Redactor, { redact: (event) => Effect.succeed(event), redactText: (text) => Effect.succeed(text) }))
      yield* Effect.scoped(Effect.gen(function* () {
        yield* registerRebuildCheck()
        const project = yield* decisionSetup(); yield* completedSetup(project.projectId)
        success(yield* call(ownerCredential, 'project.settings.set', { settings: { workspaceFolder: rig.work, shell: '/bin/sh' } }))
        yield* serve({ password: Redacted.make(password), staticRoot, studioRoot, lists: engineLists, settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: false } })
        yield* Effect.promise(async () => {
          const root = `http://127.0.0.1:${port}/studio/`
          await page.goto(root)
          await page.locator('#login-password').fill(password)
          await page.getByRole('button', { name: 'Sign in', exact: true }).click()
          await expect(page.locator('.sidebar .tree-row.project')).toBeVisible()
          await page.goto(`${root}#/settings?section=stall-watch`)
          for (const [id, value] of [['sd-a', '7'], ['sd-w', '17'], ['sd-l', '29'], ['sd-n', '1'], ['sd-r', '4']]) {
            await page.locator('#' + id).fill(value!)
            await expect(page.locator('.svc-pane fieldset')).toHaveAttribute('aria-busy', 'false')
          }
          await page.getByRole('switch', { name: 'Nudge a stalled agent automatically', exact: true }).click()
          await expect(page.getByRole('switch', { name: 'Nudge a stalled agent automatically', exact: true })).toHaveAttribute('aria-checked', 'false')
          await page.reload()
          for (const [id, value] of [['sd-a', '7'], ['sd-w', '17'], ['sd-l', '29'], ['sd-n', '1'], ['sd-r', '4']]) await expect(page.locator('#' + id)).toHaveValue(value!)
          await page.goto(`${root}#/settings?section=workflow`)
          await page.locator('#wf-path').fill(workflowFolder); await page.locator('#wf-path').press('Tab')
          await expect(page.locator('.svc-pane fieldset')).toHaveAttribute('aria-busy', 'false')
          await page.getByRole('button', { name: 'Check again', exact: true }).click()
          await expect(page.locator('.toasts')).toContainText('Checked the workflow folder.')
          await page.locator('#wf-reviewers').fill('4')
          await expect(page.locator('.svc-pane fieldset')).toHaveAttribute('aria-busy', 'false')
          await page.getByRole('switch', { name: 'Reviewer from another vendor', exact: true }).click()
          await expect(page.getByRole('switch', { name: 'Reviewer from another vendor', exact: true })).toHaveAttribute('aria-checked', 'false')
          await page.reload()
          await expect(page.locator('#wf-path')).toHaveValue(workflowFolder)
          await expect(page.locator('#wf-reviewers')).toHaveValue('4')
          await page.locator('#wf-path').fill('$(touch /tmp/s6-hostile)'); await page.locator('#wf-path').press('Tab')
          await expect(page.locator('.toasts')).toContainText('The workflow folder must be absolute')
          await expect(page.locator('#wf-path')).toHaveValue(workflowFolder)
          await page.goto(`${root}#/settings?section=about`)
          await expect(page.locator('.svc-pane')).toContainText('LGTM Studio unknown')
          await page.getByRole('button', { name: 'Check for an update', exact: true }).click()
          await expect(page.locator('.svc-pane')).toContainText('A safe HTTPS check of origin is unavailable.')
          await expect(page.locator('.svc-pane')).toContainText('git merge --ff-only FETCH_HEAD')
          await page.getByRole('button', { name: 'Update the service', exact: true }).click()
          await expect(page.locator('.toasts')).toContainText('This is not connected to the service yet. Nothing was changed.')
          await page.getByRole('button', { name: 'Restart', exact: true }).click()
          await expect(page.getByRole('dialog')).toContainText('Every signed-in page is signed out and running agents are stopped.')
          await page.getByRole('dialog').getByRole('button', { name: 'Restart', exact: true }).click()
          await expect(page.locator('.toasts')).toContainText('This service cannot restart itself on this platform.')
          expect(errors).toEqual([])
        })
      }).pipe(Effect.provide(buildServices(rig).pipe(Layer.provide(dependencies))), Effect.provide(runner.layer)))
    })).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true }))))
  } finally { if (previous === undefined) delete process.env.LGTM_HOME; else process.env.LGTM_HOME = previous; removeRig(rig) }
}
