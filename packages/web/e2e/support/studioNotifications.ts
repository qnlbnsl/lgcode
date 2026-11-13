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
import { makeFakeSecrets, makeRig, removeRig, call, ownerCredential, seedAgent, success } from "../../../engine/test/support/handlerRig.ts"
import { question, awaitRaised } from "../../../engine/test/support/alertsRig.ts"
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
          await expect(page.getByText('Sprint alerts stay here until you dismiss them.', { exact: true })).toBeVisible()
          await expect(page.locator('#q-zone')).toHaveValue('UTC')
          await page.screenshot({ path: '.foundry/notifications-sample.png', fullPage: true })
          await page.goto(`${origin}/studio/#/notifications`)
          await page.locator('#login-password').fill(password)
          await page.getByRole('button', { name: 'Sign in', exact: true }).click()
          await expect(page.getByRole('button', { name: 'Log out', exact: true })).toBeVisible()
          await page.goto(`${origin}/studio/#/notifications`)
          await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible()
          for (const label of ['An account needs your attention', 'Something else needs your attention', 'The web server goes down', 'A board post needs your reply', 'An agent has not answered your post', 'An agent has stalled', 'A worker needs replacement', 'Work takes longer than expected', 'A permission rule is used for the first time']) {
            await expect(page.getByRole('switch', { name: label, exact: true })).toBeVisible()
          }
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
          await page.locator('#em-from').fill('edited-sender@local.test')
          await form.getByRole('button', { name: 'Save email', exact: true }).click()
          await expect(form.getByRole('button', { name: 'Save email', exact: true })).toBeDisabled()
          await expect(page.getByRole('switch', { name: 'Email enabled', exact: true })).toHaveAttribute('aria-checked', 'false')
          await page.reload()
          await expect(page.getByRole('switch', { name: 'Email enabled', exact: true })).toHaveAttribute('aria-checked', 'false')
          await expect(page.locator('#em-from')).toHaveValue('edited-sender@local.test')
          await page.getByRole('switch', { name: 'Email enabled', exact: true }).click()
          await expect(page.getByRole('switch', { name: 'Email enabled', exact: true })).toHaveAttribute('aria-checked', 'true')
          const quiet = page.getByRole('form', { name: 'Quiet hours', exact: true })
          await quiet.getByRole('switch', { name: 'Quiet hours', exact: true }).click()
          await page.locator('#q-zone').fill('America/Chicago')
          await page.locator('#q-from').fill('21:30')
          await page.locator('#q-to').fill('07:30')
          await quiet.getByRole('switch', { name: 'Let urgent alerts through', exact: true }).click()
          await quiet.getByRole('button', { name: 'Save quiet hours', exact: true }).click()
          await expect(quiet.getByRole('button', { name: 'Save quiet hours', exact: true })).toBeDisabled()
          await page.reload()
          await expect(page.locator('#q-zone')).toHaveValue('America/Chicago')
          await expect(page.locator('#q-from')).toHaveValue('21:30')
          await expect(page.locator('#q-to')).toHaveValue('07:30')
          await expect(quiet.getByRole('switch', { name: 'Quiet hours', exact: true })).toHaveAttribute('aria-checked', 'true')
          await expect(quiet.getByRole('switch', { name: 'Let urgent alerts through', exact: true })).toHaveAttribute('aria-checked', 'false')
          await expect(page.locator('#em-secret')).toHaveValue('')
          await expect(page.locator('#em-host')).toHaveValue('127.0.0.1')
          await expect(page.locator('#em-secret')).toHaveAttribute('placeholder', 'Password is set. Enter a replacement.')
          expect(await page.content()).not.toContain(secret)
          expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(secret)
          await expect(page.getByText('Agent failures, account problems, and a web server outage can reach you during quiet hours.', { exact: true })).toBeVisible()
          for (const [id, changed, previous] of [
            ['em-host', 'mail.example.test', '127.0.0.1'], ['em-port', String(smtp.port === 65535 ? 65534 : smtp.port + 1), String(smtp.port)],
            ['em-security', 'tls', 'plain'], ['em-username', 'changed-user', 'local-user']
          ]) {
            const input = page.locator('#' + id)
            if (id === 'em-security') await input.selectOption(changed!); else await input.fill(changed!)
            await expect(form.getByText('Changing the mail server or user name will clear the stored password. Enter a password or app key before saving.', { exact: true })).toBeVisible()
            await expect(page.locator('#em-secret')).toHaveAttribute('required', '')
            await expect(form.getByRole('button', { name: 'Save email', exact: true })).toBeDisabled()
            if (id === 'em-security') await input.selectOption(previous!); else await input.fill(previous!)
          }
        })
        yield* seedAgent({ id: 'notification-worker', state: 'working' })
        const time = (offset: number) => new Date(Date.now() + offset).toISOString().slice(11, 16)
        success(yield* call(ownerCredential, 'client.alerts.quiet.set', { quiet: { enabled: true, start: time(-3_600_000), end: time(3_600_000), timeZone: 'UTC', failureOverride: true } }))
        yield* question('notification-worker', 'browser-held-alert')
        yield* awaitRaised('question:browser-held-alert')
        yield* Effect.promise(async () => {
          await page.reload()
          await expect(page.getByText('Held until quiet hours end', { exact: true })).toBeVisible()
          expect(smtp.messages).toHaveLength(1)
          await page.screenshot({ path: '.foundry/notifications-live.png', fullPage: true })
          await page.locator('form[aria-label="Email delivery"]').getByRole('button', { name: 'Remove email', exact: true }).click()
          await page.getByRole('dialog').getByRole('button', { name: 'Remove email', exact: true }).click()
          await expect(page.locator('#em-host')).toHaveValue('')
          await expect(page.locator('#em-secret')).toHaveValue('')
          await page.reload()
          await expect(page.locator('#em-host')).toHaveValue('')
          await expect(page.locator('#em-secret')).not.toHaveAttribute('placeholder', 'Password is set. Enter a replacement.')
        })
      })).pipe(Effect.provide(buildServices(rig, engineLists).pipe(Layer.provide(dependencies))), Effect.provide(runner.layer))
    })).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped) as Effect.Effect<void, unknown, never>)
    expect(errors).toEqual([])
  } finally {
    if (previousHome === undefined) delete process.env.LGTM_HOME; else process.env.LGTM_HOME = previousHome
    await smtp.close(); removeRig(rig)
  }
}
