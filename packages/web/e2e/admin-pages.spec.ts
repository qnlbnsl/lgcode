import { completedSetup } from "./support/completedSetup.ts"
import { assertPhoneWidth } from "./support/phoneWidth.ts"
import { openNavigation } from "./support/navigation.ts"
import { randomBytes } from "node:crypto"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { build } from "vite"
import * as SqliteClient from "../../../third_party/t3code/node-sqlite/src/nodeSqliteClient.ts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import { buildServices } from "../../engine/src/service.ts"
import { serve } from "../../engine/src/client/web/server.ts"
import { Redactor } from "../../engine/src/log/Redactor.ts"
import { engineLists } from "../../engine/src/pieces/lists.ts"
import { unusedPort } from "../../engine/test/support/browserWeb.ts"
import { makeFakeRunner } from "../../engine/test/support/fakeRunner.ts"
import {
  agentCredential, call, makeFakeSecrets, makeRig, ownerCredential, removeRig,
  seedAccount, seedAgent, seedHarness, success
} from "../../engine/test/support/handlerRig.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"

test("the production admin pages use real RPCs and fit a 360-pixel browser", async ({ page }) => {
  const rig = makeRig()
  const previousHome = process.env.LGTM_HOME
  process.env.LGTM_HOME = rig.stateFolder
  const password = randomBytes(32).toString("base64url")
  const staticRoot = join(rig.root, "page")
  try {
    await build({ configFile: false, root: new URL("..", import.meta.url).pathname,
      logLevel: "silent", build: { outDir: staticRoot } })
    const port = await unusedPort()
    const program = Effect.gen(function* () {
      const runner = yield* makeFakeRunner()
      const run = Effect.gen(function* () {
        yield* registerRebuildCheck()
        yield* seedHarness()
        yield* seedAccount()
        const worker = yield* seedAgent({ id: "phone-worker", state: "working" })
        yield* completedSetup()
        yield* serve({ password: Redacted.make(password), staticRoot, lists: engineLists,
          settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: false } })
        success(yield* call(agentCredential(worker.token), "ask", { text: "Which branch should I use?" }))
        yield* Effect.promise(async () => {
          const openService = async (name: "Phone notifications" | "Service settings") => {
            await openNavigation(page)
            await page.getByRole("navigation", { name: "Service pages", exact: true }).getByRole("link", { name, exact: true }).click()
            await expect(page.getByRole("button", { name: "Open navigation", exact: true })).toHaveAttribute("aria-expanded", "false")
          }
          const notifications = page.locator('.admin-page[aria-label="Phone notifications"]')
          await page.setViewportSize({ width: 360, height: 800 })
          await page.goto(`http://127.0.0.1:${port}/?page=alerts`)
          await page.getByLabel("Password", { exact: true }).fill(password)
          await page.getByRole("button", { name: "Log in", exact: true }).click()
          await expect(async () => {
            await page.getByRole("button", { name: "Refresh alerts" }).click()
            await expect(notifications).toContainText("A question needs your answer")
          }).toPass()
          const threadLink = page.getByRole("link", { name: "Open thread for phone-worker" })
          await expect(threadLink).toHaveAttribute("href", "/#/thread/phone-worker")
          await threadLink.click()
          await expect(page).toHaveURL(`http://127.0.0.1:${port}/#/thread/phone-worker`)
          await expect(page.getByRole("heading", { name: "name-phone-worker", exact: true })).toBeVisible()
          await expect(page.getByRole("region", { name: "Question", exact: true })).toContainText("Which branch should I use?")
          await openService("Phone notifications")
          await page.reload()
          await expect(notifications).toContainText("A question needs your answer")
          await assertPhoneWidth(page, "Alerts")
          await openService("Service settings")
          const push = page.getByRole("checkbox", { name: "Push for approval", exact: true })
          await expect(push).toBeChecked()
          await push.uncheck()
          await page.getByRole("button", { name: "Refresh settings" }).click()
          await expect(push).not.toBeChecked()
          const carrier = page.getByRole("form", { name: "Alert carrier", exact: true })
          await carrier.getByLabel("Server", { exact: true }).fill("https://PUSH.example:443")
          await carrier.getByLabel("Topic", { exact: true }).fill("phone-alerts")
          await carrier.getByLabel("Topic", { exact: true }).blur()
          await expect(page.getByText("Token destination: https://push.example", { exact: true })).toBeVisible()
          await expect(carrier.getByLabel("Topic", { exact: true })).toBeEnabled()
          const token = page.getByRole("form", { name: "Carrier token", exact: true })
          await token.getByLabel("New token", { exact: true }).fill("dummy-browser-test-token")
          await token.getByLabel("New token", { exact: true }).blur()
          await expect(token.getByLabel("New token", { exact: true })).toHaveValue("")
          await expect(page.getByText("Token set", { exact: true })).toBeVisible()
          await token.getByRole("button", { name: "Clear token", exact: true }).click()
          await expect(page.getByText("No token set", { exact: true })).toBeVisible()
          await assertPhoneWidth(page, "Settings")
          const web = page.getByRole("form", { name: "Web server settings", exact: true })
          await web.getByLabel("Heartbeat seconds", { exact: true }).fill("30")
          await web.getByLabel("Heartbeat seconds", { exact: true }).blur()
          // A web settings commit closes its own reply socket. Reading again
          // verifies the saved state independently of that acknowledgement.
          await page.getByRole("button", { name: "Refresh settings" }).click()
          await expect(web.getByLabel("Heartbeat seconds", { exact: true })).toHaveValue("30")
          await expect(page.getByText("Server state (last read): running", { exact: true })).toBeVisible()
          await web.getByRole("checkbox", { name: "Enable web server", exact: true }).click()
          const confirmation = page.getByRole("dialog", { name: "Turn off the web server?", exact: true })
          await expect(confirmation).toBeVisible()
          await expect(web.getByRole("checkbox", { name: "Enable web server", exact: true })).toBeChecked()
          await confirmation.getByRole("button", { name: "Cancel", exact: true }).click()
          await expect(confirmation).not.toBeVisible()
          await expect(web.getByRole("checkbox", { name: "Enable web server", exact: true })).toBeChecked()
          expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)
          expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0)
        })
        const alerts = success(yield* call(ownerCredential, "client.alerts.settings", {}))
        expect(alerts.carrier).toEqual({ _tag: "ntfy", server: "https://push.example", topic: "phone-alerts" })
        expect(alerts.tokenSet).toBe(false)
      })
      const dependencies = Layer.mergeAll(runner.layer, makeFakeSecrets().layer, Layer.succeed(Redactor, {
        redact: (event) => Effect.succeed(event), redactText: (text) => Effect.succeed(text)
      }))
      yield* Effect.scoped(run).pipe(Effect.provide(buildServices(rig, engineLists).pipe(Layer.provide(dependencies))),
        Effect.provide(runner.layer))
    }).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped)
    await Effect.runPromise(program as Effect.Effect<void, unknown>)
  } finally {
    if (previousHome === undefined) delete process.env.LGTM_HOME
    else process.env.LGTM_HOME = previousHome
    removeRig(rig)
  }
})
