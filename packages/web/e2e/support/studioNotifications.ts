import { randomBytes } from "node:crypto"
import { cpSync, mkdirSync } from "node:fs"
import { resolve, join } from "node:path"
import { expect, test, type Page } from "@playwright/test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as SqliteClient from "../../../../third_party/t3code/node-sqlite/src/nodeSqliteClient.ts"
import { buildServices } from "../../../engine/src/service.ts"
import { serve } from "../../../engine/src/client/web/server.ts"
import { engineLists } from "../../../engine/src/pieces/lists.ts"
import { Redactor } from "../../../engine/src/log/Redactor.ts"
import { unusedPort } from "../../../engine/test/support/browserWeb.ts"
import { makeFakeRunner } from "../../../engine/test/support/fakeRunner.ts"
import { makeFakeSecrets, makeRig, removeRig } from "../../../engine/test/support/handlerRig.ts"
import { smtpServer } from "../../../engine/test/support/smtpServer.ts"
import { decisionSetup } from "../../../engine/test/support/projectDecisionFixtures.ts"
import { completedSetup } from "./completedSetup.ts"
import { buildStudio } from "../../../studio/scripts/build.ts"

export async function exerciseStudioNotifications(page: Page) {
  test.setTimeout(90_000)
  const rig = makeRig(), smtp = await smtpServer(), password = randomBytes(32).toString("base64url")
  const secret = 'synthetic-mail-app-key', previousHome = process.env.LGTM_HOME
  process.env.LGTM_HOME = rig.stateFolder
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    const studioRoot = await buildStudio(join(rig.root, 'studio'))
    const staticRoot = join(rig.root, 'sample')
    cpSync(resolve('design/mock'), staticRoot, { recursive: true, dereference: true })
    const port = await unusedPort()
    mkdirSync('.foundry', { recursive: true })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const runner = yield* makeFakeRunner()
      const dependencies = Layer.mergeAll(runner.layer, makeFakeSecrets().layer, Layer.succeed(Redactor, {
        redact: (event) => Effect.succeed(event), redactText: (text) => Effect.succeed(text)
      }))
      yield* Effect.scoped(Effect.gen(function* () {
        const project = yield* decisionSetup()
        yield* completedSetup(project.projectId)
        yield* serve({ password: Redacted.make(password), staticRoot, studioRoot, lists: engineLists,
          settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: false } })
        yield* Effect.promise(async () => {
          const origin = `http://127.0.0.1:${port}`
          await page.setViewportSize({ width: 1440, height: 2400 })
          await page.goto(`${origin}/#/notifications`)
          await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible()
          await expect(page.locator('#em-host')).toBeVisible()
          await expect(page.locator('#q-zone')).toHaveValue('UTC')
          await page.screenshot({ path: '.foundry/notifications-sample.png', fullPage: true })
          await page.goto(`${origin}/studio/#/notifications`)
          await page.locator('#login-password').fill(password)
          await page.getByRole('button', { name: 'Sign in', exact: true }).click()
          await expect(page.getByRole('button', { name: 'Log out', exact: true })).toBeVisible()
          await page.goto(`${origin}/studio/#/notifications`)
          await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible()
          await page.locator('#em-host').fill('127.0.0.1')
          await page.locator('#em-port').fill(String(smtp.port))
          await page.locator('#em-security').selectOption('plain')
          await page.locator('#em-username').fill('local-user')
          await page.locator('#em-from').fill('owner@local.test')
          await page.locator('#em-to').fill('owner@local.test')
          await page.locator('#em-secret').fill(secret)
          const form = page.locator('form[aria-label="Email delivery"]')
          await form.getByRole('button', { name: 'Save email', exact: true }).click()
          await expect(page.locator('#em-secret')).toHaveValue('')
          await expect(page.locator('#em-secret')).toHaveAttribute('placeholder', 'Password is set. Enter a replacement.')
          await form.getByRole('button', { name: 'Send a test', exact: true }).click()
          await expect(page.locator('.toasts')).toContainText('Your mail server accepted the test email.')
          expect(smtp.messages).toHaveLength(1)
          await page.getByRole('switch', { name: 'Email enabled', exact: true }).click()
          await expect(page.getByRole('switch', { name: 'Email enabled', exact: true })).toHaveAttribute('aria-checked', 'false')
          await page.getByRole('switch', { name: 'Email enabled', exact: true }).click()
          await expect(page.getByRole('switch', { name: 'Email enabled', exact: true })).toHaveAttribute('aria-checked', 'true')
          const quiet = page.getByRole('form', { name: 'Quiet hours', exact: true })
          await quiet.getByRole('switch', { name: 'Quiet hours', exact: true }).click()
          await page.locator('#q-zone').fill('America/Chicago')
          await page.locator('#q-from').fill('21:30')
          await page.locator('#q-to').fill('07:30')
          await quiet.getByRole('switch', { name: 'Let failure alerts through', exact: true }).click()
          await quiet.getByRole('button', { name: 'Save quiet hours', exact: true }).click()
          await expect(quiet.getByRole('button', { name: 'Save quiet hours', exact: true })).toBeDisabled()
          await page.reload()
          await expect(page.locator('#q-zone')).toHaveValue('America/Chicago')
          await expect(page.locator('#q-from')).toHaveValue('21:30')
          await expect(page.locator('#q-to')).toHaveValue('07:30')
          await expect(quiet.getByRole('switch', { name: 'Quiet hours', exact: true })).toHaveAttribute('aria-checked', 'true')
          await expect(quiet.getByRole('switch', { name: 'Let failure alerts through', exact: true })).toHaveAttribute('aria-checked', 'false')
          await expect(page.locator('#em-secret')).toHaveValue('')
          await expect(page.locator('#em-host')).toHaveValue('127.0.0.1')
          await expect(page.locator('#em-secret')).toHaveAttribute('placeholder', 'Password is set. Enter a replacement.')
          expect(await page.content()).not.toContain(secret)
          expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(secret)
          await page.screenshot({ path: '.foundry/notifications-live.png', fullPage: true })
        })
      })).pipe(Effect.provide(buildServices(rig, engineLists).pipe(Layer.provide(dependencies))), Effect.provide(runner.layer))
    })).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped) as Effect.Effect<void, unknown, never>)
    expect(errors).toEqual([])
  } finally {
    if (previousHome === undefined) delete process.env.LGTM_HOME; else process.env.LGTM_HOME = previousHome
    await smtp.close(); removeRig(rig)
  }
}
