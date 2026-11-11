import { completedSetup } from "./support/completedSetup.ts"
import { randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { chmodSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { DatabaseSync } from "node:sqlite"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as AcpRunner from "../../engine/src/runner/AcpRunner.ts"
import { accountFor, harnessFor, fakeAgentPath, peekEcho, promptTexts } from "../../engine/test/support/acpRunnerRig.ts"
import { serve as serveApi } from "../../engine/src/api/server.ts"
import { dispatchQueued } from "../../engine/src/routing/deliveries.ts"
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
import {
  call, makeRig, makeFakeSecrets, ownerCredential, removeRig,
  appendSetup, eventOf, agentIdOf, success,
} from "../../engine/test/support/handlerRig.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"
import { httpsProxy } from "./support/httpsProxy.ts"
const owner = { _tag: "owner" as const }

// This browser test ignores errors for the proxy's self-signed certificate.
// It installs no certificate trust; the production listener stays on HTTP.
test.use({ ignoreHTTPSErrors: true })

test("7.4 a phone owner follows the board alert, reads and replies, and wakes the fake agent once", async ({ page }) => {
  const rig = makeRig()
  // The real child client enforces the production state-folder permissions.
  chmodSync(rig.stateFolder, 0o700)
  const previousHome = process.env.LGCODE_HOME
  process.env.LGCODE_HOME = rig.stateFolder
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
    const adapter = join(rig.root, "adapter.mjs")
    const echoFile = join(rig.root, "agent-echo.json")
    writeFileSync(adapter, `#!${process.execPath}\nimport(${JSON.stringify(pathToFileURL(fakeAgentPath).href)});\n`)
    chmodSync(adapter, 0o755)
    const harness = harnessFor("first", adapter)
    const gatePath = join(rig.root, "post-ready")
    const rows = () => {
      const db = new DatabaseSync(rig.database, { readOnly: true })
      try { return (db.prepare("SELECT payload_json FROM events ORDER BY sequence").all() as Array<{ payload_json: string }>).map((row) => JSON.parse(row.payload_json)) }
      finally { db.close() }
    }
    const program = Effect.gen(function* () {
      const runnerLayer = AcpRunner.layer({ socketPath: join(rig.stateFolder, "engine.sock"), stateFolder: rig.stateFolder,
        environment: { PATH: process.env.PATH!, HOME: rig.home } }).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, makeFakeSecrets().layer, Layer.succeed(Redactor, {
          redact: (event) => Effect.succeed(event), redactText: (text) => Effect.succeed(text),
        }))))
      const run = Effect.gen(function* () {
        yield* registerRebuildCheck()
        yield* serveApi({ socketPath: join(rig.stateFolder, "engine.sock"),
          ownerCredential: Redacted.make(randomBytes(32).toString("base64url")), debug: false, lists: engineLists })
        success(yield* call(ownerCredential, "client.web.settings.set", { settings: {
          enabled: true, port, heartbeatSeconds: 25, proxyMode: true, publicAddress: origin,
        } }))
        yield* completedSetup()
        yield* serve({ password: Redacted.make(password), staticRoot, lists: engineLists,
          settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: true, publicAddress: origin } })
        success(yield* call(ownerCredential, "client.alerts.carrier.set", {
          carrier: { _tag: "ntfy", server: carrierOrigin, topic: "owner_alerts" },
        }))
        const channelId = success(yield* call(ownerCredential, "board.open", { name: "Owner-questions" })).channelId
        const account = accountFor("first", { turns: [[
          { step: "wait_for_file", path: gatePath },
          { step: "lgcode_command", command: "board.post", input: {
            channelId, text: '<img src=x onerror="window.__boardXss=1"> **question text**', to: [owner], reply: "all",
          } },
        ], [{ step: "text", text: "Completion received." }]] }, echoFile)
        yield* appendSetup([eventOf({ _tag: "HarnessChanged", harness }), eventOf({ _tag: "AccountChanged", accountId: account.id, account })])
        const worker = success(yield* call(ownerCredential, "start", {
          name: "Thread lead", role: "worker", harness: harness.id, account: { _tag: "named", accountId: account.id },
          permission: "ask", folder: rig.work, groups: [], prompt: "Post the question for the owner.",
        }))
        const leadId = worker.agentId as string
        success(yield* call(ownerCredential, "board.members", { channelId, add: [leadId], remove: [] }))
        writeFileSync(gatePath, "ready")
        yield* Effect.promise(async () => {
          try {
            await expect.poll(() => rows().some((row) => row._tag === "board.PostWritten" && row.author?._tag === "agent" && row.author.agentId === leadId)).toBe(true)
          } catch (error) {
            console.info("Board process setup:", JSON.stringify({ tags: rows().map((row) => row._tag), methods: peekEcho(echoFile)?.inbound.map((frame) => frame.method) }))
            throw error
          }
          await expect.poll(() => rows().some((row) => row._tag === "TurnEnded" && row.agentId === leadId)).toBe(true)
        })
        const postId = rows().find((row) => row._tag === "board.PostWritten" && row.author?._tag === "agent" && row.author.agentId === leadId).postId as string
        const alerts = yield* awaitRaised(`post:${postId}`)
        yield* Effect.promise(async () => {
          await expect.poll(() => carrierRequests.filter((row) => row.method === "POST").length).toBe(1)
          const notification = carrierRequests.find((row) => row.method === "POST")!
          expect(notification.body).not.toContain("question text") // catches sending post prose to a third-party carrier
          expect(notification.headers.title).toBe("A post needs your reply") // catches agent-controlled alert titles
          expect(notification.headers.click).toBe(`${origin}/#/thread/${leadId}`) // catches missing or misdirected notification links

          await page.setViewportSize({ width: 360, height: 800 })
          await page.goto(origin)
          await page.getByLabel("Password", { exact: true }).fill(password)
          await page.getByRole("button", { name: "Log in", exact: true }).click()
          await expect(page.getByRole("region", { name: "Home", exact: true })).toBeVisible()
          expect(await page.evaluate(() => ({ secure: isSecureContext, uuid: typeof crypto.randomUUID })))
            .toEqual({ secure: true, uuid: "function" })
          expect((await page.context().cookies(origin)).some((cookie) => cookie.secure && cookie.httpOnly && cookie.sameSite === "Strict")).toBe(true)
          const reads = () => rows().filter((row) => row._tag === "board.Read" && row.reader._tag === "owner" && row.postIds.includes(postId))
          expect(reads()).toHaveLength(0)
          await page.goto(notification.headers.click as string)
          await expect(page.getByRole("heading", { name: "Thread lead", exact: true })).toBeVisible()
          const read = page.getByRole("button", { name: "Read post", exact: true })
          await expect(read).toBeVisible() // catches a notification link that opens no board subject entry
          await expect(page.getByText("question text")).toHaveCount(0) // catches reading the post merely by following the link
          await expect(read).toBeEnabled()
          expect(reads()).toHaveLength(0)
          await read.click()
          await expect.poll(() => reads().length).toBe(1)
          await expect(page.getByText('<img src=x onerror="window.__boardXss=1"> **question text**', { exact: true })).toBeVisible()
          await expect(page.locator("img")).toHaveCount(0)
          expect(await page.evaluate(() => (window as typeof window & { __boardXss?: number }).__boardXss)).toBeUndefined()
          const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }))
          expect(widths.document).toBeLessThanOrEqual(widths.viewport)
          await page.getByRole("textbox", { name: "Reply", exact: true }).fill("I will review it.")
          await page.getByRole("button", { name: "Send reply", exact: true }).click()
          await expect(page.getByRole("region", { name: "Board post", exact: true }).getByText("I will review it.", { exact: true })).toBeVisible()
          await expect(page.getByRole("region", { name: "Board post", exact: true })).toContainText("Status: closed · answered")
          await expect.poll(() => promptTexts(peekEcho(echoFile)!).length).toBe(2)
          await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveCount(0)
        })
        expect(alerts).toHaveLength(1)
        const cleared = yield* eventsOf("client.AlertCleared")
        expect(cleared.filter((row) => row.event.alertId === alerts[0]!.event.alertId)).toHaveLength(1)
        // Drain after the real process has ended its completion turn, then flush
        // twice. A duplicate wake cannot hide behind an aggregate prompt count.
        yield* Effect.promise(async () => {
          await expect.poll(() => rows().filter((row) => row._tag === "TurnEnded" && row.agentId === leadId).length).toBe(2)
        })
        for (let pass = 0; pass < 2; pass++) {
          success(yield* call(ownerCredential, "board.flush", { agentId: leadId }))
          yield* dispatchQueued(agentIdOf(leadId))
        }
        const log = rows()
        expect(log.filter((row) => row._tag === "board.PostClosed" && row.postId === postId)).toMatchObject([{ outcome: "answered" }])
        const replies = log.filter((row) => row._tag === "board.PostWritten" && row.replyToPostId === postId && row.author._tag === "owner")
        expect(replies).toHaveLength(1)
        const replyId = replies[0].postId as string
        const completions = log.filter((row) => row._tag === "board.WakeBuilt" && row.completions.includes(postId))
        expect(completions).toHaveLength(1)
        expect(completions[0]).toMatchObject({ targetAgentId: leadId, completions: [postId], completionReplyText: [postId], carried: [replyId], mustReply: [], reminders: [], noAnswers: [] })
        const deliveries = log.filter((row) => row._tag === "DeliveryQueued" && row.delivery.source?._tag === "piece" && row.delivery.source.namespace === "board" && row.delivery.source.id === completions[0].wakeId)
        expect(deliveries).toHaveLength(1)
        expect(deliveries[0].delivery.target).toBe(leadId)
        const deliveryId = deliveries[0].delivery.id
        expect(log.filter((row) => row._tag === "DeliverySent" && row.deliveryId === deliveryId)).toMatchObject([{ agentId: leadId }])
        const prompts = promptTexts(peekEcho(echoFile)!)
        expect(prompts).toHaveLength(2)
        expect(prompts[1]).toContain(postId)
        expect(prompts[1]).toContain(replyId)
        expect(prompts[1]).toContain("I will review it.")
      })
      const dependencies = Layer.mergeAll(runnerLayer, makeFakeSecrets().layer, Layer.succeed(Redactor, {
        redact: (event) => Effect.succeed(event), redactText: (text) => Effect.succeed(text),
      }))
      return yield* Effect.scoped(run).pipe(Effect.provide(buildServices(rig, engineLists).pipe(Layer.provide(dependencies))),
        Effect.provide(runnerLayer))
    }).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.provide(NodeServices.layer), Effect.scoped)
    await Effect.runPromise(program as Effect.Effect<void, unknown>)
  } finally {
    if (previousHome === undefined) delete process.env.LGCODE_HOME
    else process.env.LGCODE_HOME = previousHome
    await proxy?.close()
    carrier.closeAllConnections()
    await new Promise<void>((resolve) => carrier.close(() => resolve()))
    removeRig(rig)
  }
})
