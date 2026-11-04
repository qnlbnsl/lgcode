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
  call, makeFakeSecrets, makeRig, ownerCredential, removeRig,
  seedAccount, seedHarness, startPayload, success
} from "../../engine/test/support/handlerRig.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"

test("the production shell logs in, follows real client RPCs, fits a phone, and logs out", async ({ page }) => {
  const rig = makeRig()
  const previousHome = process.env.SHEPHRD_HOME
  process.env.SHEPHRD_HOME = rig.stateFolder
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
        yield* serve({ password: Redacted.make(password), staticRoot, lists: engineLists,
          settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: false } })
        yield* Effect.promise(async () => {
          await page.setViewportSize({ width: 360, height: 800 })
          await page.goto(`http://127.0.0.1:${port}/`)
          await page.getByLabel("Password", { exact: true }).fill(password)
          await page.getByRole("button", { name: "Log in", exact: true }).click()
          await expect(page.getByLabel("Situation", { exact: true })).toContainText("Live")
          await expect(page.getByLabel("Idle", { exact: true })).toContainText("No agents.")
        })
        // Use the real command handler and log, with only the harness faked.
        // The browser must observe the resulting roster event on its stream.
        success(yield* call(ownerCredential, "start", startPayload(rig, { name: "PhoneWorker" })))
        yield* Effect.promise(async () => {
          const situation = page.getByLabel("Situation", { exact: true })
          await expect(situation).toContainText("PhoneWorker")
          await page.reload()
          await expect(situation).toContainText("PhoneWorker")
          const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
            document: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
          expect(widths.document).toBeLessThanOrEqual(widths.viewport)
          expect(widths.body).toBeLessThanOrEqual(widths.viewport)
          expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)
          expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0)
          await page.getByRole("button", { name: "Log out", exact: true }).click()
          await expect(page.getByRole("form", { name: "Log in" })).toBeVisible()
          await expect(situation).toHaveCount(0)
          await page.reload()
          await expect(page.getByRole("form", { name: "Log in" })).toBeVisible()
        })
      })
      const dependencies = Layer.mergeAll(runner.layer, makeFakeSecrets().layer, Layer.succeed(Redactor, {
        redact: (event) => Effect.succeed(event), redactText: (text) => Effect.succeed(text)
      }))
      yield* Effect.scoped(run).pipe(Effect.provide(buildServices(rig, engineLists).pipe(Layer.provide(dependencies))),
        Effect.provide(runner.layer))
    }).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped)
    await Effect.runPromise(program as Effect.Effect<void, unknown>)
  } finally {
    if (previousHome === undefined) delete process.env.SHEPHRD_HOME
    else process.env.SHEPHRD_HOME = previousHome
    removeRig(rig)
  }
})
