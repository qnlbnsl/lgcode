import { randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { build } from "vite"
import * as SqliteClient from "../../../third_party/t3code/node-sqlite/src/nodeSqliteClient.ts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import { buildServices } from "../../engine/src/service.ts"
import { serve } from "../../engine/src/client/web/server.ts"
import { engineLists } from "../../engine/src/pieces/lists.ts"
import { Redactor } from "../../engine/src/log/Redactor.ts"
import { unusedPort } from "../../engine/test/support/browserWeb.ts"
import { eventsOf, awaitRaised } from "../../engine/test/support/alertsRig.ts"
import { makeFakeRunner } from "../../engine/test/support/fakeRunner.ts"
import {
  agentCredential, call, makeRig, makeFakeSecrets, ownerCredential, removeRig,
  seedAccount, seedAgent, seedHarness, success,
} from "../../engine/test/support/handlerRig.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"
import { httpsProxy } from "./support/httpsProxy.ts"
import { owner } from "../../engine/test/board/wakeFixtures.ts"

// The ephemeral fixture certificate is trusted only in this browser test.
test.use({ ignoreHTTPSErrors: true })

test("7.4 a phone owner follows the board alert, reads and replies, and wakes the fake agent once", async ({ page }) => {
  const rig = makeRig()
  const previousHome = process.env.SHEPHRD_HOME
  process.env.SHEPHRD_HOME = rig.stateFolder
  const password = randomBytes(32).toString("base64url")
  const staticRoot = join(rig.root, "page")
  let proxy: Awaited<ReturnType<typeof httpsProxy>> | undefined
  const carrierRequests: Array<{ method: string; url: string; body: string; headers: Record<string, string | string[] | undefined> }> = []
  const carrier = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    carrierRequests.push({ method: request.method!, url: request.url!, body: Buffer.concat(chunks).toString("utf8"), headers: request.headers })
    response.writeHead(200, { "content-type": "application/json" })
    response.end('{"id":"accepted"}')
  })
  await new Promise<void>((resolve, reject) => { carrier.once("error", reject); carrier.listen(0, "127.0.0.1", resolve) })
  const carrierAddress = carrier.address() as import("node:net").AddressInfo
  try {
    await build({ configFile: false, root: new URL("..", import.meta.url).pathname,
      logLevel: "silent", build: { outDir: staticRoot } })
    const port = await unusedPort()
    proxy = await httpsProxy(port, rig.root)
    const origin = proxy.origin
    const carrierOrigin = `http://127.0.0.1:${carrierAddress.port}`
    const program = Effect.gen(function* () {
      const runner = yield* makeFakeRunner()
      const run = Effect.gen(function* () {
        yield* registerRebuildCheck()
        yield* seedHarness()
        yield* seedAccount()
        const { token } = yield* seedAgent({ id: "lead", name: "Thread lead", state: "idle" })
        success(yield* call(ownerCredential, "client.web.settings.set", { settings: {
          enabled: true, port, heartbeatSeconds: 25, proxyMode: true, publicAddress: origin,
        } }))
        yield* serve({ password: Redacted.make(password), staticRoot, lists: engineLists,
          settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: true, publicAddress: origin } })
        success(yield* call(ownerCredential, "client.alerts.carrier.set", {
          carrier: { _tag: "ntfy", server: carrierOrigin, topic: "owner_alerts" },
        }))
        const channelId = success(yield* call(ownerCredential, "board.open", { name: "Owner-questions" })).channelId
        success(yield* call(ownerCredential, "board.members", { channelId, add: ["lead"], remove: [] }))
        const postId = success(yield* call(agentCredential(token), "board.post", {
          channelId, text: '<img src=x onerror="window.__boardXss=1"> **question text**', to: [owner], reply: "all",
        })).postId
        const alerts = yield* awaitRaised(`post:${postId}`)
        yield* Effect.promise(async () => {
          await expect.poll(() => carrierRequests.filter((row) => row.method === "POST").length).toBe(1)
          const notification = carrierRequests.find((row) => row.method === "POST")!
          expect(notification.body).not.toContain("question text") // catches sending post prose to a third-party carrier
          expect(notification.headers.title).toBe("A post needs your reply") // catches agent-controlled alert titles
          expect(notification.headers.click).toBe(`${origin}/#/thread/lead`) // catches missing or misdirected notification links

          await page.setViewportSize({ width: 360, height: 800 })
          await page.goto(origin)
          await page.getByLabel("Password", { exact: true }).fill(password)
          await page.getByRole("button", { name: "Log in", exact: true }).click()
          await expect(page.getByLabel("Situation", { exact: true })).toBeVisible()
          expect(await page.evaluate(() => ({ secure: isSecureContext, uuid: typeof crypto.randomUUID })))
            .toEqual({ secure: true, uuid: "function" })
          expect((await page.context().cookies(origin)).some((cookie) => cookie.secure && cookie.httpOnly && cookie.sameSite === "Strict")).toBe(true)
          await page.goto(notification.headers.click as string)
          await expect(page.getByRole("heading", { name: "Thread: Thread lead", exact: true })).toBeVisible()
          const read = page.getByRole("button", { name: "Read post", exact: true })
          await expect(read).toBeVisible() // catches a notification link that opens no board subject entry
          await expect(page.getByText("question text")).toHaveCount(0) // catches reading the post merely by following the link
          await read.click()
          await expect(page.getByText('<img src=x onerror="window.__boardXss=1"> **question text**', { exact: true })).toBeVisible()
          await expect(page.locator("img")).toHaveCount(0)
          expect(await page.evaluate(() => (window as typeof window & { __boardXss?: number }).__boardXss)).toBeUndefined()
          const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }))
          expect(widths.document).toBeLessThanOrEqual(widths.viewport)
          await page.getByRole("textbox", { name: "Reply", exact: true }).fill("I will review it.")
          await page.getByRole("button", { name: "Send reply", exact: true }).click()
          await expect(page.getByText("I will review it.")).toBeVisible()
          await expect.poll(() => runner.callsOf("prompt").length).toBe(1)
          await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveCount(0)
        })
        expect(alerts).toHaveLength(1)
        const cleared = yield* eventsOf("client.AlertCleared")
        expect(cleared.filter((row) => row.event.alertId === alerts[0]!.event.alertId)).toHaveLength(1)
        expect(runner.callsOf("prompt")).toHaveLength(1) // catches missing or duplicate completion wakes
      })
      const dependencies = Layer.mergeAll(runner.layer, makeFakeSecrets().layer, Layer.succeed(Redactor, {
        redact: (event) => Effect.succeed(event), redactText: (text) => Effect.succeed(text),
      }))
      return yield* Effect.scoped(run).pipe(Effect.provide(buildServices(rig, engineLists).pipe(Layer.provide(dependencies))),
        Effect.provide(runner.layer))
    }).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped)
    await Effect.runPromise(program as Effect.Effect<void, unknown>)
  } finally {
    if (previousHome === undefined) delete process.env.SHEPHRD_HOME
    else process.env.SHEPHRD_HOME = previousHome
    await proxy?.close()
    carrier.closeAllConnections()
    await new Promise<void>((resolve) => carrier.close(() => resolve()))
    removeRig(rig)
  }
})
