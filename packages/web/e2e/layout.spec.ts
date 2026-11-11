import { completedSetup } from "./support/completedSetup.ts"
import { assertPhoneWidth } from "./support/phoneWidth.ts"
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
  agentCredential, call, makeFakeSecrets, makeRig, removeRig,
  seedAccount, seedAgent, seedHarness, success
} from "../../engine/test/support/handlerRig.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"

// Each page reports its own outcome even if another page's layout regresses.
for (const [name, path, ready] of [
  ["Login", "/", "Log in"],
  ["Home", "/", "Home"],
  ["Thread", "/#/thread/phone-worker", "Thread"],
  ["Alerts", "/?page=alerts", "Phone notifications"],
  ["Settings", "/?page=settings", "Service settings"],
] as const) test(`7.3 production width: ${name} fits 360 pixels`, async ({ page }) => {
  const rig = makeRig()
  const previousHome = process.env.LGCODE_HOME
  process.env.LGCODE_HOME = rig.stateFolder
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
          await page.setViewportSize({ width: 360, height: 800 })
          await page.goto(`http://127.0.0.1:${port}${path}`)
          await expect(page.getByRole("form", { name: "Log in" })).toBeVisible()
          if (name !== "Login") {
            await page.getByLabel("Password", { exact: true }).fill(password)
            await page.getByRole("button", { name: "Log in", exact: true }).click()
            await expect(page.getByRole("button", { name: "Open navigation", exact: true })).toBeVisible()
            await expect(page.getByRole("region", { name: ready, exact: true })).toBeVisible()
            if (name === "Home") await expect(page.locator(".home-view .home-request-row")).toContainText("name-phone-worker")
            if (name === "Thread") await expect(page.getByRole("region", { name: "Question", exact: true })).toContainText("Which branch should I use?")
            if (name === "Alerts") await expect(async () => {
              await page.getByRole("button", { name: "Refresh alerts" }).click()
              await expect(page.getByRole("region", { name: "Phone notifications", exact: true })).toContainText("A question needs your answer")
            }).toPass()
            if (name === "Settings") await expect(page.getByRole("form", { name: "Web server settings", exact: true })).toBeVisible()
          }
          await assertPhoneWidth(page, name)
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
    if (previousHome === undefined) delete process.env.LGCODE_HOME
    else process.env.LGCODE_HOME = previousHome
    removeRig(rig)
  }
})
