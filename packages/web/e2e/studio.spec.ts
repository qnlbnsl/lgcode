// The live website from packages/studio, served by the real engine at /studio/, on a real
// project log. Only the harness runner is fake. The current page stays at /.
import { completedSetup } from "./support/completedSetup.ts"
import { randomBytes } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as SqliteClient from "../../../third_party/t3code/node-sqlite/src/nodeSqliteClient.ts"
import { buildServices } from "../../engine/src/service.ts"
import { serve } from "../../engine/src/client/web/server.ts"
import { engineLists } from "../../engine/src/pieces/lists.ts"
import { Redactor } from "../../engine/src/log/Redactor.ts"
import { unusedPort } from "../../engine/test/support/browserWeb.ts"
import { incarnationOf, makeFakeRunner } from "../../engine/test/support/fakeRunner.ts"
import { agentCredential, appendSetup, eventOf, ownerCredential, success, call, makeFakeSecrets, makeRig, removeRig } from "../../engine/test/support/handlerRig.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"
import { decisionSetup } from "../../engine/test/support/projectDecisionFixtures.ts"
import { buildStudio } from "../../studio/scripts/build.ts"

test.use({ actionTimeout: 10_000 })

test("live website: signs in through the engine, shows its real records, and keeps the sample out", async ({ page }, info) => {
  test.setTimeout(90_000)
  const rig = makeRig()
  const previousHome = process.env.LGTM_HOME
  process.env.LGTM_HOME = rig.stateFolder
  const password = randomBytes(32).toString("base64url")
  const staticRoot = join(rig.root, "page")
  mkdirSync(staticRoot)
  writeFileSync(join(staticRoot, "index.html"), "<!doctype html><title>Current page</title><main>Current page</main>")
  const errors: string[] = []
  const violations: string[] = []
  const timings: string[] = []
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message))
  page.on("console", (message) => {
    // The browser logs the engine's refusal of a signed-out session check and of a wrong
    // password. Those refusals are expected here.
    if (message.type() === "error" && !/status of 401/.test(message.text())) errors.push(message.text())
    if (message.type() === "debug" && message.text().startsWith("LGTM Studio:")) timings.push(message.text())
  })
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { violations?: string[] }).violations ??= []
      ;(window as unknown as { violations: string[] }).violations.push(`${event.violatedDirective}: ${event.blockedURI}`)
    })
  })
  try {
    const studioRoot = await buildStudio(join(rig.root, "studio"))
    const port = await unusedPort()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const runner = yield* makeFakeRunner()
      const dependencies = Layer.mergeAll(runner.layer, makeFakeSecrets().layer, Layer.succeed(Redactor, {
        redact: (event) => Effect.succeed(event), redactText: (text) => Effect.succeed(text)
      }))
      yield* Effect.scoped(Effect.gen(function* () {
        yield* registerRebuildCheck()
        const project = yield* decisionSetup()
        yield* completedSetup(project.projectId)
        runner.script("choices", () => Effect.succeed({ models: { source: "negotiated", options: [{ id: "test-model", label: "Test model" }, { id: "other-model", label: "Other model" }] }, efforts: { source: "negotiated", options: [{ id: "high", label: "High" }, { id: "low", label: "Low" }] } }))
        runner.script("context", () => Effect.succeed({ _tag: "available", used: 25, window: 100, percent: 25, reportedAt: Date.now() }))
        runner.script("cancel", (input) => runner.emitRaw({ _tag: "turnEnded", ...input, stopped: true,
          incarnation: runner.callsOf("prompt").filter((c) => c.input.agentId === input.agentId).at(-1)?.input.incarnation ?? incarnationOf(project.worker.token) }))
        const questionId = success(yield* call(project.leadCredential, "ask", { title: "Choose the release branch", text: "Which branch should the release use?", recommendation: "Keep one branch", proposedAnswer: "Use trunk" })).questionId
        yield* appendSetup([eventOf({ _tag: "PermissionRequested", agentId: project.leadId, permissionRequestId: "studio-permission", holder: { _tag: "owner" }, deliveryId: `seed-turn-${project.leadId}`, toolCallId: "studio-check", description: "Run Studio checks", options: [{ id: "harness-once", name: "Run once", kind: "allow_once", level: "ask", persistent: false }, { id: "harness-never", name: "Refuse this check", kind: "reject_once", level: "read-only", persistent: false }], settingsWrite: false, toolKind: "execute", toolInput: { command: "pnpm test studio" } })])
        yield* serve({ password: Redacted.make(password), staticRoot, studioRoot, lists: engineLists,
          settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: false } })
        yield* Effect.promise(async () => {
          const origin = `http://127.0.0.1:${port}`
          // The current page keeps working at the root, and /studio is sent to /studio/.
          await page.goto(origin)
          await expect(page).toHaveTitle("Current page")
          await page.goto(`${origin}/studio`)
          await expect(page).toHaveURL(`${origin}/studio/`)

          // A signed-out visitor sees the Login page, and a wrong password is refused.
          await expect(page.locator("#login-password")).toBeVisible()
          await page.locator("#login-password").fill("not the password")
          await page.getByRole("button", { name: "Sign in", exact: true }).click()
          await expect(page.getByText("That password is wrong. Nothing was signed in.")).toBeVisible()

          await page.locator("#login-password").fill(password)
          await page.getByRole("button", { name: "Sign in", exact: true }).click()
          const sidebar = page.locator(".sidebar")
          await expect(sidebar.locator(".tree-row.repo")).toContainText("Repository")
          await expect(sidebar.locator(".tree-row.project")).toContainText("Project")
          await expect(page.getByRole("button", { name: "Mock controls" })).toHaveCount(0)
          for (const word of ["Maya Okafor", "lgtm-studio", "Agent console", "Workstation"]) await expect(page.locator("body")).not.toContainText(word)

          // Home answers real questions and harness permissions, including full input.
          await expect(page.locator('.rq-table')).toContainText('Choose the release branch')
          await page.getByRole('button', { name: 'Show Choose the release branch', exact: true }).click()
          await page.getByRole('button', { name: 'Accept recommendation', exact: true }).click()
          await expect(page.getByRole('button', { name: 'Show Choose the release branch', exact: true })).toHaveCount(0)
          await page.getByRole('button', { name: 'Show Run Studio checks', exact: true }).click()
          await expect(page.locator('.rq-detail')).toContainText('pnpm test studio')
          await page.getByRole('button', { name: 'Run once', exact: true }).click()
          await expect(page.getByRole('button', { name: 'Show Run Studio checks', exact: true })).toHaveCount(0)
          await page.getByLabel('Show answered', { exact: true }).check()
          await expect(page.locator('.rq-table')).toContainText('Use trunk')
          await expect(page.locator('.rq-table')).toContainText('Run once')

          // A worker's thread is writable for the owner. The engine drives pending state.
          await page.goto(`${origin}/studio/#/p/${project.projectId}/chat/${project.workerId}`)
          const thread = page.locator('.chat-main')
          const composer = thread.locator('textarea')
          await expect(thread.locator('.ctxuse')).toHaveText('25%')
          await thread.getByRole('button', { name: 'Stop this reply', exact: true }).click()
          await expect.poll(() => runner.callsOf('cancel').length).toBe(1)
          await expect(thread.getByRole('button', { name: 'Send', exact: true })).toBeVisible()
          await composer.fill('Build the requested screen')
          await thread.getByRole('button', { name: 'Send', exact: true }).click()
          await expect(composer).toHaveValue('')
          await expect.poll(() => runner.callsOf('prompt').filter((c) => c.input.agentId === project.workerId).length).toBe(1)
          const current = runner.callsOf('prompt').find((c) => c.input.agentId === project.workerId)!.input
          await expect(thread.locator('.thread')).toContainText('Build the requested screen')
          await Effect.runPromise(runner.emitRaw({ _tag: 'deliveryUpdate', agentId: project.workerId, incarnation: current.incarnation, deliveryId: current.delivery.id, kind: 'message', replay: false, itemId: 'studio-reply', content: { _tag: 'text', text: 'Screen ' }, text: 'Screen ' }))
          await Effect.runPromise(runner.emitRaw({ _tag: 'deliveryUpdate', agentId: project.workerId, incarnation: current.incarnation, deliveryId: current.delivery.id, kind: 'message', replay: false, itemId: 'studio-reply', content: { _tag: 'text', text: 'implemented.' }, text: 'implemented.' }))
          await expect(thread.locator('.thread')).toContainText('Screen implemented.')
          // Requests rejected by the engine retain its reason in a notice.
          await thread.getByRole('button', { name: 'Agent actions', exact: true }).click()
          await page.getByRole('menuitem', { name: 'Compact context', exact: true }).click()
          await expect(page.locator('.toasts')).toContainText('command refused')
          await thread.getByRole('button', { name: 'Stop this reply', exact: true }).click()
          await expect.poll(() => runner.callsOf('cancel').length).toBe(2)
          await expect(thread.getByRole('button', { name: 'Send', exact: true })).toBeVisible()
          await thread.getByRole('button', { name: 'Model', exact: true }).click()
          await page.getByRole('menuitemradio', { name: 'Other model', exact: true }).click()
          await expect(thread.getByRole('button', { name: 'Model', exact: true })).toContainText('other-model')
          await thread.getByRole('button', { name: 'Effort', exact: true }).click()
          await page.getByRole('menuitemradio', { name: 'Low', exact: true }).click()
          await expect(thread.getByRole('button', { name: 'Effort', exact: true })).toContainText('low')
          await thread.getByRole('button', { name: 'Agent actions', exact: true }).click()
          await page.getByRole('menuitem', { name: 'Compact context', exact: true }).click()
          await expect.poll(() => runner.callsOf('compact').length).toBe(1)
          await thread.getByRole('button', { name: 'Agent actions', exact: true }).click()
          await page.getByRole('menuitem', { name: 'Stop agent', exact: true }).click()
          await page.getByRole('dialog').getByRole('button', { name: 'Stop agent', exact: true }).click()
          await expect(thread).toContainText('is stopped.')
          await thread.getByRole('button', { name: 'Resume', exact: true }).click()
          await expect(thread.locator('textarea')).toBeVisible()
          await expect.poll(() => runner.callsOf('load').length).toBe(1)
          await page.reload()
          await expect(thread.locator('.thread')).toContainText('Build the requested screen')
          await expect(thread.locator('.thread')).toContainText('Screen implemented.')

          // The project's lead and its team come from the engine.
          await page.goto(`${origin}/studio/#/p/${encodeURIComponent(project.projectId)}/agents`)
          await expect(page.locator(".main")).toContainText("Build")
          await expect(page.locator(".main")).toContainText("Project lead")
          await expect(page.locator(".topbar")).toContainText("Project")
        })

        // A worker question passes through its lead and is answered inside its thread.
        console.log("studio: chat actions complete")
        const resumedToken = Redacted.value(runner.callsOf("load").at(-1)!.input.token)
        const workerQuestion = success(yield* call(agentCredential(resumedToken), "ask", { title: "Choose a worker approach", text: "Use the existing adapter?", proposedAnswer: "Keep the adapter", recommendation: "Preserve the interface" })).questionId
        console.log("studio: worker question created")
        success(yield* call(project.leadCredential, "pass-up", { subject: { _tag: "question", id: workerQuestion } }))
        console.log("studio: worker question passed up")
        yield* appendSetup([eventOf({ _tag: "PermissionRequested", agentId: project.workerId, permissionRequestId: "studio-thread-permission", holder: { _tag: "owner" }, deliveryId: "thread-permission-delivery", toolCallId: "thread-tool", description: "Check the thread options", options: Array.from({ length: 10 }, (_, i) => ({ id: `thread-option-${i}`, name: i === 9 ? "Harness persistent allow" : `Harness option ${i}`, kind: i === 9 ? "allow_always" : "reject_once", level: i === 9 ? "ask" : "read-only", persistent: i === 9 })), settingsWrite: false, toolInput: { command: "pnpm test thread" } })])
        yield* Effect.promise(async () => {
          const origin = `http://127.0.0.1:${port}`
          await page.goto(`${origin}/studio/#/p/${project.projectId}/chat/${project.workerId}`)
          const thread = page.locator('.chat-main')
          console.log('studio: worker thread opened')
          // The compact card renders the full source, with a proposed answer from the engine.
          await expect(thread.locator(`#req-${workerQuestion}`)).toContainText('Use the existing adapter?')
          await thread.locator(`#req-${workerQuestion}`).getByRole('button', { name: 'Accept', exact: true }).click()
          await expect(thread.locator(`#req-${workerQuestion}`)).toContainText('Keep the adapter')
          const permission = thread.locator('#req-studio-thread-permission')
          await permission.getByRole('button', { name: 'Details', exact: true }).click()
          await expect(permission).toContainText('pnpm test thread')
          await permission.getByRole('button', { name: 'Harness persistent allow', exact: true }).click()
          await expect.poll(() => runner.callsOf('answerPermission').filter((c) => c.input.requestId === 'studio-thread-permission').length).toBe(1)
        })

        const answered = success(yield* call(ownerCredential, "client.requests", { after: 0, limit: 100 }))
        expect(answered.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: questionId, status: "answered", answer: "Use trunk" }), expect.objectContaining({ id: "studio-permission", status: "answered", optionId: "harness-once" })]))

        // A change in the engine reaches the open page through the stream.
        yield* call(project.leadCredential, "project.sprint.create", { projectId: project.projectId, label: "SP-2",
          name: "Pushed sprint", goal: "Arrive on the stream", phase: "Plan", owner: project.leadId, needs: [] })
        yield* Effect.promise(async () => {
          const origin = `http://127.0.0.1:${port}`
          const sidebar = page.locator(".sidebar")
          await page.goto(`${origin}/studio/#/p/${encodeURIComponent(project.projectId)}/board`)
          await expect(page.locator(".main")).toContainText("Pushed sprint")
          await expect.poll(() => timings.some((line) => line.includes("first pushed update") && line.includes("after the engine recorded it"))).toBe(true)
          await page.goto(`${origin}/studio/#/home`)

          // A reload keeps the session, which is the engine's cookie.
          await page.reload()
          await expect(sidebar.locator(".tree-row.project")).toContainText("Project")
          await expect.poll(() => timings.filter((line) => line.includes("snapshot took")).length).toBeGreaterThanOrEqual(3)

          // Logging out ends the session and leaves no records on the page.
          await page.getByRole("button", { name: "Log out" }).click()
          await expect(page.locator("#login-password")).toBeVisible()
          await expect(page.locator(".tree-row")).toHaveCount(0)
        })
      })).pipe(Effect.provide(buildServices(rig, engineLists).pipe(Layer.provide(dependencies))), Effect.provide(runner.layer))
    })).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped) as Effect.Effect<void, unknown, never>)
    expect(await page.evaluate(() => (window as unknown as { violations?: string[] }).violations ?? [])).toEqual([])
    expect(errors).toEqual([])
    info.annotations.push({ type: "timing", description: timings.join("; ") })
    console.log(timings.join("\n"))
  } finally {
    if (errors.length) console.log("PAGE ERRORS", errors)
    if (previousHome === undefined) delete process.env.LGTM_HOME; else process.env.LGTM_HOME = previousHome
    removeRig(rig)
  }
})

// design/mock still opens on its own, on its sample data, with its simulation and controls.
test("design mock: still opens on its sample data with no console error", async ({ page }) => {
  const { createServer } = await import("node:http")
  const { readFile } = await import("node:fs/promises")
  const { extname } = await import("node:path")
  const { fileURLToPath } = await import("node:url")
  const design = fileURLToPath(new URL("../../../design/", import.meta.url))
  const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" }
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent((request.url ?? "/").split("?")[0]!)
    try {
      if (path.includes("..")) throw new Error()
      const body = await readFile(join(design, path.endsWith("/") ? path + "index.html" : path))
      response.setHeader("Content-Type", types[extname(path.endsWith("/") ? "index.html" : path)] ?? "application/octet-stream")
      response.end(body)
    } catch { response.statusCode = 404; response.end() }
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message))
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })
  try {
    const origin = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`
    await page.goto(`${origin}/mock/#/home`)
    await expect(page.locator(".sidebar")).toContainText("Maya Okafor")
    await expect(page.locator(".sidebar")).toContainText("lgtm-studio")
    await expect(page.getByRole("button", { name: "Mock controls" })).toHaveCount(1)
    for (const route of ["/p/console/board", "/p/console/terminal", "/p/console/files", "/machines", "/settings"]) {
      await page.goto(`${origin}/mock/#${route}`)
      await expect(page.locator(".main")).toBeVisible()
    }
    // The mock's own login still accepts any password but "wrong".
    await page.getByRole("button", { name: "Log out" }).click()
    await page.locator("#login-password").fill("wrong")
    await page.getByRole("button", { name: "Sign in", exact: true }).click()
    await expect(page.getByText("That password is wrong. Nothing was signed in.")).toBeVisible()
    await page.locator("#login-password").fill("anything")
    await page.getByRole("button", { name: "Sign in", exact: true }).click()
    await expect(page.locator(".sidebar")).toContainText("Maya Okafor")
    expect(errors).toEqual([])
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) }
})
