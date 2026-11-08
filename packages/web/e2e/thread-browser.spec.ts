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
  call, makeFakeSecrets, makeRig, ownerCredential, removeRig,
  seedAccount, seedHarness, startPayload, success
} from "../../engine/test/support/handlerRig.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"

test("the production thread opens from a roster link, prompts, displays full permission input on a phone, and answers once", async ({ page }) => {
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
        yield* serve({ password: Redacted.make(password), staticRoot, lists: engineLists,
          settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: false } })
        const worker = success(yield* call(ownerCredential, "start", startPayload(rig, { name: "ThreadWorker" })))
        yield* Effect.promise(async () => {
          await page.setViewportSize({ width: 360, height: 800 })
          await page.goto(`http://127.0.0.1:${port}/`)
          await page.getByLabel("Password", { exact: true }).fill(password)
          await page.getByRole("button", { name: "Log in", exact: true }).click()
          await page.getByRole("link", { name: "ThreadWorker", exact: true }).click()
          await expect(page.getByRole("heading", { name: "Thread: ThreadWorker", exact: true })).toBeVisible()
          await page.reload()
          await expect(page.getByRole("heading", { name: "Thread: ThreadWorker", exact: true })).toBeVisible()
          await page.getByRole("textbox", { name: "Prompt agent", exact: true }).fill("Inspect the current file.")
          await page.getByRole("button", { name: "Send prompt", exact: true }).click()
          await expect(page.getByRole("status").filter({ hasText: "Prompt sent." })).toBeVisible()
          await expect.poll(() => runner.callsOf("prompt").length).toBe(1)
        })
        const sent = runner.callsOf("prompt")[0]!.input
        yield* runner.subscribed
        const maliciousText = '<img src=x onerror="window.__threadXss=1"> **markdown** javascript:bad'
        yield* runner.emit({ _tag: "deliveryUpdate", agentId: sent.agentId, incarnation: sent.incarnation,
          deliveryId: sent.delivery.id, kind: "message", replay: false, text: maliciousText,
          content: { _tag: "text", text: maliciousText } })
        yield* runner.emitRaw({ _tag: "permissionRequested", agentId: worker.agentId, incarnation: sent.incarnation,
          permissionRequestId: "browser-permission", toolCallId: "browser-tool", description: "Harmless title",
          options: [{ id: "once", name: "Allow", persistent: false, kind: "allow_once", level: "ask" },
            { id: "reject", name: "Reject", persistent: false, kind: "reject_once", level: "read-only" }],
          settingsWrite: false, toolKind: "execute",
          toolInput: { command: `echo\u202e${" ".repeat(1_000)}actual-command`, path: "x".repeat(1_000) } })
        yield* Effect.promise(async () => {
          const request = page.getByRole("region", { name: "Permission request", exact: true })
          await expect(request).toContainText("actual-command")
          await expect(request).toContainText("\\u202e")
          await expect(request).toContainText("[1000 spaces]")
          await expect(page.getByRole("article", { name: "Agent message", exact: true })).toContainText(maliciousText)
          expect(await page.locator("img").count()).toBe(0)
          expect(await page.evaluate(() => (window as typeof window & { __threadXss?: number }).__threadXss)).toBeUndefined()
          await assertPhoneWidth(page, "Thread")
          // Dispatch both clicks before React can commit a disabled state.
          await request.getByRole("button", { name: "Allow", exact: true }).evaluate((button) => {
            (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click()
          })
          await expect.poll(() => runner.callsOf("answerPermission").length).toBe(1)
          expect(runner.callsOf("answerPermission")[0]!.input).toMatchObject({ requestId: "browser-permission", optionId: "once" })
          expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)
          expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0)
          await page.getByRole("button", { name: "Log out", exact: true }).click()
          await expect(page.getByRole("form", { name: "Log in" })).toBeVisible()
          await expect(page.getByRole("region", { name: "Thread", exact: true })).toHaveCount(0)
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
