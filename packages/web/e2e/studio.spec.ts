import { exerciseStudioGit } from './support/studioGit.ts'
import { exerciseStudioService } from './support/studioService.ts'
// The live website from packages/studio, served by the real engine at /studio/, on a real
// project log. Only the harness runner is fake. The current page stays at /.
import { completedSetup } from "./support/completedSetup.ts"
import { execFileSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
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
import { seedAccount, harnessSettings, agentCredential, appendSetup, eventOf, ownerCredential, success, call, makeFakeSecrets, makeRig, removeRig } from "../../engine/test/support/handlerRig.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"
import { decisionSetup } from "../../engine/test/support/projectDecisionFixtures.ts"
import { buildStudio } from "../../studio/scripts/build.ts"
import { httpsProxy } from "./support/httpsProxy.ts"

test.use({ ignoreHTTPSErrors: true })

test.use({ actionTimeout: 10_000 })

test("live chat: signs in through the engine, shows its real records, and keeps the sample out", async ({ page }, info) => {
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
    execFileSync('git', ['init', '-b', 'topic'], { cwd: rig.work, stdio: 'ignore' })
    writeFileSync(join(rig.work, 'reference.txt'), 'Context file body stays on disk.\n')
    execFileSync('git', ['add', 'reference.txt'], { cwd: rig.work })
    execFileSync('git', ['-c', 'user.name=Test owner', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Fixture'], { cwd: rig.work, stdio: 'ignore' })
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
        success(yield* call(ownerCredential, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "sh" } }))
        yield* appendSetup([
          eventOf({ _tag: 'project.RepositoryAdded', repoId: project.repoId, name: 'Repository', path: rig.work }),
          eventOf({ _tag: 'project.RepositoryLocated', repoId: project.repoId, machineId: 'local', path: rig.work }),
          eventOf({ _tag: 'project.WorktreeCreated', repoId: project.repoId, worktreeId: project.worktreeId, branch: 'topic', path: rig.work, machineId: 'local', checkout: 'main' }),
        ])
        const contextTask = success(yield* call(ownerCredential, 'project.task.create', { ...project.task, label: 'TASK-1', title: 'Use selected context' })).taskId
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

          await expect(page.getByRole('button', { name: 'Not now', exact: true })).toBeVisible()
          await page.getByRole('button', { name: 'Not now', exact: true }).click()
          await expect(page.getByRole('button', { name: 'Not now', exact: true })).toHaveCount(0)

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
          await expect(thread.getByRole('button', { name: 'Subscription', exact: true })).toContainText('Primary')
          await thread.getByRole('button', { name: 'Stop this reply', exact: true }).click()
          await expect.poll(() => runner.callsOf('cancel').length).toBe(1)
          await expect(thread.getByRole('button', { name: 'Send', exact: true })).toBeVisible()
          await thread.getByRole('button', { name: 'Context', exact: true }).click()
          await thread.getByPlaceholder('Search tasks and files').fill('TASK-1')
          await thread.getByRole('button', { name: /TASK-1 · Use selected context/ }).click()
          await thread.getByRole('button', { name: 'Context', exact: true }).click()
          await thread.getByPlaceholder('Search tasks and files').fill('reference.txt')
          await thread.getByRole('button', { name: 'reference.txt', exact: true }).click()
          await composer.fill('Build the requested screen')
          await thread.getByRole('button', { name: 'Send', exact: true }).click()
          await expect(composer).toHaveValue('')
          await expect.poll(() => runner.callsOf('prompt').filter((c) => c.input.agentId === project.workerId).length).toBe(1)
          const current = runner.callsOf('prompt').find((c) => c.input.agentId === project.workerId)!.input
          expect(current.delivery.content).toMatchObject({ _tag: 'prompt', context: [{ _tag: 'task', projectId: project.projectId, taskId: contextTask }, { _tag: 'file', projectId: project.projectId, repoId: project.repoId, worktreeId: project.worktreeId, path: 'reference.txt' }] })
          expect(JSON.stringify(current.delivery.content)).not.toContain('Context file body stays on disk.')
          await expect(thread.locator('.thread')).toContainText('Build the requested screen')
          await expect(thread.locator('.thread')).toContainText('TASK-1')
          await Effect.runPromise(runner.emitRaw({ _tag: 'deliveryUpdate', agentId: project.workerId, incarnation: current.incarnation, deliveryId: current.delivery.id, kind: 'message', replay: false, itemId: 'studio-reply', content: { _tag: 'text', text: 'Screen ' }, text: 'Screen ' }))
          await Effect.runPromise(runner.emitRaw({ _tag: 'deliveryUpdate', agentId: project.workerId, incarnation: current.incarnation, deliveryId: current.delivery.id, kind: 'message', replay: false, itemId: 'studio-reply', content: { _tag: 'text', text: 'implemented.' }, text: 'implemented.' }))
          await expect(thread.locator('.thread')).toContainText('Screen implemented.')
          const largeText = Array.from({ length: 12_000 }, (_, i) => `Trace ${i}: <b>literal output</b>`).join('\n') + '\nEND-OF-STUDIO-TRACE'
          await Effect.runPromise(runner.emitRaw({ _tag: 'deliveryUpdate', agentId: project.workerId, incarnation: current.incarnation, deliveryId: current.delivery.id, kind: 'message', replay: false, itemId: 'studio-large', content: { _tag: 'text', text: largeText }, text: largeText }))
          await thread.getByRole('button', { name: 'Load', exact: true }).click()
          await expect(thread.locator('.thread')).toContainText('END-OF-STUDIO-TRACE')
          await expect(thread.locator('.thread b')).toHaveCount(0)
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
        const resumedToken = Redacted.value(runner.callsOf("load").at(-1)!.input.token)
        const workerQuestion = success(yield* call(agentCredential(resumedToken), "ask", { title: "Choose a worker approach", text: "Use the existing adapter?", proposedAnswer: "Keep the adapter", recommendation: "Preserve the interface" })).questionId
        success(yield* call(project.leadCredential, "pass-up", { subject: { _tag: "question", id: workerQuestion } }))
        yield* appendSetup([eventOf({ _tag: "PermissionRequested", agentId: project.workerId, permissionRequestId: "studio-thread-permission", holder: { _tag: "owner" }, deliveryId: "thread-permission-delivery", toolCallId: "thread-tool", description: "Check the thread options", options: Array.from({ length: 10 }, (_, i) => ({ id: `thread-option-${i}`, name: i === 9 ? "Harness persistent allow" : `Harness option ${i}`, kind: i === 9 ? "allow_always" : "reject_once", level: i === 9 ? "ask" : "read-only", persistent: i === 9 })), settingsWrite: false, toolInput: { command: "pnpm test thread" } })])
        yield* Effect.promise(async () => {
          const origin = `http://127.0.0.1:${port}`
          await page.goto(`${origin}/studio/#/p/${project.projectId}/chat/${project.workerId}`)
          const thread = page.locator('.chat-main')
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

        success(yield* call(ownerCredential, 'project.task.update', { projectId: project.projectId, taskId: contextTask, state: 'review' }))
        yield* appendSetup([eventOf({ _tag: 'roles.StallSeen', agentId: project.workerId, noticeRecipient: 'owner', triggerSequence: 1, sourceSequence: 1, occurrence: 1, notice: 'sent' })])
        yield* Effect.promise(async () => {
          const origin = `http://127.0.0.1:${port}`
          await page.goto(`${origin}/studio/#/p/${project.projectId}/agents`)
          await expect(page.getByRole('region', { name: 'Blocked', exact: true })).toContainText('name-one-worker')
          await expect(page.locator('.ag-row').filter({ hasText: 'name-one-worker' })).toContainText('TASK-1')
          await expect(page.locator('.ag-row').filter({ hasText: 'name-one-worker' }).locator('.ctx')).toContainText('25%')
          await page.getByRole('button', { name: 'Table', exact: true }).click()
          const row = page.locator('.ag-table tbody tr').filter({ hasText: 'name-one-worker' })
          await expect(row).toContainText('TASK-1')
          await expect(row.locator('.ws')).toHaveText('Reviewing')
          await expect(row).toContainText('other-model')
          await row.getByRole('button', { name: 'More for name-one-worker', exact: true }).click()
          await page.getByRole('menuitem', { name: /^Nudge/ }).click()
          await row.getByRole('button', { name: 'Stop name-one-worker', exact: true }).click()
          await page.getByRole('dialog').getByRole('button', { name: 'Stop agent', exact: true }).click()
          await expect(row.getByRole('button', { name: 'Resume name-one-worker', exact: true })).toBeVisible()
          await row.getByRole('button', { name: 'Resume name-one-worker', exact: true }).click()
          await expect(row.getByRole('button', { name: 'Stop name-one-worker', exact: true })).toBeVisible()
          await row.getByRole('button', { name: 'More for name-one-worker', exact: true }).click()
          await page.getByRole('menuitemradio', { name: 'Test model', exact: true }).click()
          await expect(row).toContainText('test-model')
          // The docked lead panel reads the same engine-backed thread component.
          await expect(page.locator('.panel .thread')).toContainText('Choose the release branch')
        })
        yield* appendSetup([eventOf({ _tag: 'roles.StallEnded', agentId: project.workerId, noticeRecipient: 'owner', triggerSequence: 1, sourceSequence: 1, occurrence: 1, notice: 'sent' })])
        yield* Effect.promise(async () => {
          await expect(page.locator('.ag-totals > div').filter({ hasText: 'May be stuck' }).locator('b')).toHaveText('0')
        })
        const channels = success(yield* call(ownerCredential, 'board.channels', {}))
        const direct = channels.items.find((c: { kind: string; members: Array<{ _tag: string; agentId?: string }> }) => c.kind === 'direct' && c.members.some((m) => m.agentId === project.workerId))
        expect(direct).toBeDefined()
        const posts = success(yield* call(ownerCredential, 'board.read', { channelId: direct.channelId }))
        expect(posts.items).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'Status check: what are you on, and is anything in your way?', reply: 'any' })]))
        const alertSettings = success(yield* call(ownerCredential, 'client.alerts.settings', {}))
        expect(alertSettings.pushPromptDismissed).toBe(true)
        // A failed start is a roster record and produces a Home row, without a merge request.
        yield* appendSetup([eventOf({ _tag: 'AgentStartFailed', agentId: project.workerId, reason: 'not-signed-in' })])
        yield* Effect.promise(async () => {
          await page.goto(`http://127.0.0.1:${port}/studio/#/home`)
          await expect(page.locator('.rq-table')).toContainText('name-one-worker failed to start')
          await page.getByRole('button', { name: 'Show name-one-worker failed to start', exact: true }).click()
          await expect(page.locator('.rq-detail')).toContainText('Not signed in')
          await expect(page.locator('.rq-detail').getByRole('button', { name: 'Resume', exact: true })).toBeVisible()
          await expect(page.locator('.rq-table .kind.merge')).toHaveCount(0)
          await page.locator('.bell').click()
          await expect(page.getByRole('menuitem', { name: /name-one-worker failed to start/ })).toBeVisible()
          await page.getByRole('menuitem', { name: 'Open Home', exact: true }).click()
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
test("live projects and board: signs in through the engine, shows its real records, and keeps the sample out", async ({ page }, info) => {
  test.setTimeout(90_000)
  page.setDefaultTimeout(5_000)
  await page.setViewportSize({ width: 1920, height: 1080 })
  const rig = makeRig()
  const previousHome = process.env.LGTM_HOME
  process.env.LGTM_HOME = rig.stateFolder
  const password = randomBytes(32).toString("base64url")
  const staticRoot = join(rig.root, "page")
  mkdirSync(staticRoot)
  writeFileSync(join(staticRoot, "index.html"), "<!doctype html><title>Current page</title><main>Current page</main>")
  const errors: string[] = []
  let expectedDisplayRefusal = false
  let displayProxy: Awaited<ReturnType<typeof httpsProxy>> | undefined
  const violations: string[] = []
  const timings: string[] = []
  const sent: string[] = []
  page.on("websocket", (socket) => socket.on("framesent", (frame) => sent.push(String(frame.payload))))
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message))
  page.on("console", (message) => {
    // The browser logs the engine's refusal of a signed-out session check and of a wrong
    // password. Those refusals are expected here.
    if (message.type() === "error" && !/status of 401/.test(message.text()) && !(expectedDisplayRefusal && /status of 503/.test(message.text()))) errors.push(message.text())
    if (message.type() === "debug" && message.text().startsWith("LGTM Studio:")) timings.push(message.text())
  })
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { violations?: string[] }).violations ??= []
      ;(window as unknown as { violations: string[] }).violations.push(`${event.violatedDirective}: ${event.blockedURI}`)
    })
  })
  try {
    execFileSync("git", ["-C", rig.work, "init", "-b", "main"], { stdio: "ignore" })
    execFileSync("git", ["-C", rig.work, "-c", "user.name=Owner", "-c", "user.email=owner@example.test", "commit", "--allow-empty", "-m", "Initial"], { stdio: "ignore" })
    const additionalRepo = join(rig.root, "additional-repository")
    mkdirSync(additionalRepo)
    execFileSync("git", ["-C", additionalRepo, "init", "-b", "main"], { stdio: "ignore" })
    execFileSync("git", ["-C", additionalRepo, "-c", "user.name=Owner", "-c", "user.email=owner@example.test", "commit", "--allow-empty", "-m", "Initial"], { stdio: "ignore" })
    const studioRoot = await buildStudio(join(rig.root, "studio"))
    const port = await unusedPort(), displayPort = await unusedPort()
    displayProxy = await httpsProxy(displayPort, rig.root)
    const webSettings = { enabled: true, port, heartbeatSeconds: 25, proxyMode: false, display: { port: displayPort, publicAddress: displayProxy.origin.replace("127.0.0.1", "localhost") } }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const runner = yield* makeFakeRunner()
      runner.script("choices", () => Effect.succeed({ models: { source: "negotiated", options: [{ id: "test-model", label: "Test model" }, { id: "model-next", label: "Next model" }] }, efforts: { source: "negotiated", options: [{ id: "high", label: "High" }, { id: "medium", label: "Medium" }] } }))
      const dependencies = Layer.mergeAll(runner.layer, makeFakeSecrets().layer, Layer.succeed(Redactor, {
        redact: (event) => Effect.succeed(event), redactText: (text) => Effect.succeed(text)
      }))
      yield* Effect.scoped(Effect.gen(function* () {
        yield* registerRebuildCheck()
        const project = yield* decisionSetup()
        yield* appendSetup([eventOf({ _tag: "project.RepositoryAdded", repoId: project.repoId, name: "Repository", path: rig.work }),
          eventOf({ _tag: "project.RepositoryLocated", repoId: project.repoId, machineId: "local", path: rig.work }),
          eventOf({ _tag: "project.WorktreeCreated", repoId: project.repoId, worktreeId: project.worktreeId,
          branch: "main", path: rig.work, machineId: "local", checkout: "main" })])
        success(yield* call(ownerCredential, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "bash" } }))
        writeFileSync(join(rig.work, "studio-screen.html"), "<h1>Recorded screen evidence</h1>")
        writeFileSync(join(rig.work, "studio-data.json"), "{}")
        const componentText = '<h1>Actual registered component</h1><script>document.body.dataset.ready="yes"</script>'
        mkdirSync(join(rig.work, "studio-components"))
        writeFileSync(join(rig.work, "studio-components/card.html"), componentText)
        writeFileSync(join(rig.work, "studio-design.pen"), "Registered design bytes")
        writeFileSync(join(rig.work, "studio-tokens.json"), JSON.stringify({ tokens: [{ name: "engine.ink", value: "#123456" }] }))
        success(yield* call(ownerCredential, "project.design.record", { projectId: project.projectId, design: {
          repoId: project.repoId, worktreeId: project.worktreeId, file: "studio-design.pen", tokensPath: "studio-tokens.json",
          components: [{ componentId: "card", name: "Engine Card", reference: "studio-components/card.html", variants: "Compact", fingerprint: createHash("sha256").update(componentText).digest("hex") }]
        } }))
        const field = { entity: "request", name: "title", type: "string", description: "Engine field description", screens: ["requests"], sourceId: "data" }
        const mockRevision = success(yield* call(ownerCredential, "project.mocks.record", { projectId: project.projectId, bundle: {
          sources: [{ sourceId: "screens", worktreeId: project.worktreeId, path: "studio-screen.html", kind: "screens" },
            { sourceId: "data", worktreeId: project.worktreeId, path: "studio-data.json", kind: "data" }],
          screens: [{ screenId: "requests", sourceId: "screens", name: "Engine requests screen", summary: "Actual screen summary", route: "/requests", scenarioRoutes: [] }],
          components: [], scenarios: [], draftedFields: [field], reviewedComparisons: [{ field, status: "differs", known: "number" }]
        } }))
        const taskId = success(yield* call(ownerCredential, "project.task.create", { ...project.task, title: "Engine task", label: "TK-1" })).taskId
        success(yield* call(ownerCredential, "project.task.note", { projectId: project.projectId, taskId, title: "Recorded note", detail: "Actual engine history" }))
        yield* seedAccount("studio-ready", "cursor")
        success(yield* call(ownerCredential, "harnesses", { operation: "set", harness: harnessSettings("cursor", { adapterPath: process.execPath, reportedModes: [{ id: "default", level: "ask" }] }) }))
        success(yield* call(ownerCredential, "accounts set-secret", { accountId: "studio-ready", name: "CURSOR_API_KEY", nonce: "studio-browser", value: Redacted.make("synthetic-studio-browser-key") }))
        const channelId = success(yield* call(ownerCredential, "board.open", { name: "project-updates" })).channelId
        success(yield* call(ownerCredential, "board.members", { channelId, add: [project.workerId], remove: [] }))
        success(yield* call(project.workerCredential, "board.post", { channelId, text: "Engine board post", to: [{ _tag: "owner" }], reply: "none" }))
        yield* completedSetup(project.projectId)
        success(yield* call(ownerCredential, "client.web.settings.set", { settings: webSettings }))
        yield* serve({ password: Redacted.make(password), staticRoot, studioRoot, lists: engineLists, registerSecret: () => {} })
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

          await page.keyboard.press("Control+k")
          const switcher = page.getByRole("dialog", { name: "Find project or agent", exact: true })
          const query = switcher.getByRole("textbox")
          await query.fill("Real decisions")
          await expect(switcher.getByRole("option")).toHaveCount(1)
          await expect(switcher.getByRole("option")).toContainText("Project")
          await query.fill("Repository")
          await expect(switcher.getByRole("option").first()).toContainText("Repository")
          await expect(switcher).not.toContainText("No remote")
          await query.fill("Engine task")
          await expect(switcher).toContainText('Nothing matches')
          await query.fill("agent builder")
          await expect(switcher.getByRole("option").first()).toContainText("Agent")
          await query.press("Enter")
          await expect(page).toHaveURL(new RegExp(`/chat/${project.workerId}$`))
          expect(sent.join("\n")).not.toContain("context.search")

          // Mock data is fetched when its tab opens, with no sample thumbnails.
          await page.goto(`${origin}/studio/#/p/${project.projectId}/mocks`)
          await expect(page.locator(".mk-screens")).toContainText("Engine requests screen")
          await expect(page.locator(".mk-screens")).toContainText(mockRevision.revisionId)
          await expect(page.locator(".mk-mini")).toBeEmpty()
          await page.getByRole("link", { name: /^Changes/ }).click()
          await expect(page.locator(".mk-changes")).toContainText(mockRevision.revisionId)
          await expect(page.locator(".mk-changes")).toContainText("Owner")
          await expect(page.locator(".mk-changes")).not.toContainText("New")
          await page.getByRole("link", { name: /^Data/ }).click()
          await expect(page.locator(".main .table")).toContainText("request.title")
          await expect(page.locator(".main .table")).toContainText("Engine field description")
          await page.getByRole("link", { name: /^Screens/ }).click()
          await page.getByRole("link", { name: "Engine requests screen", exact: true }).click()
          await expect(page.getByRole("button", { name: "Edit design", exact: true })).toBeDisabled()
          await page.getByRole("button", { name: "Open preview", exact: true }).click()
          const preview = page.locator('section[aria-label="Engine requests screen preview"]')
          await expect(preview.frameLocator("iframe").getByRole("heading", { name: "Recorded screen evidence" })).toBeVisible()
          const privateMockUrl = await preview.locator("iframe").getAttribute("src")
          await preview.getByRole("button", { name: "Close display", exact: true }).click()
          await expect(preview.locator("iframe")).toHaveCount(0)
          expect((await page.request.get(privateMockUrl!)).ok()).toBe(false)
          await page.getByRole("button", { name: "Approve", exact: true }).click()
          await expect(page.locator(".toasts")).toContainText("not connected to the service yet")
          await expect(page.locator(".mk-stagebar")).toContainText("Draft")
          await page.getByRole("link", { name: "Screens", exact: true }).click()
          await page.getByRole("button", { name: "Request changes", exact: true }).click()
          await page.locator("#mc-text").fill("Please revise the engine screen")
          // The existing socket carries the prompt. No optimistic comment is created.
          await page.getByRole("dialog").getByRole("button", { name: "Send", exact: true }).click()
          await expect(page.getByRole("dialog")).toHaveCount(0)
          await expect(page.locator(".toasts")).toContainText("Change request sent")
          writeFileSync(join(rig.work, "studio-screen.html"), "<h1>Changed evidence</h1>")
          await page.getByRole("button", { name: "Approve mocks", exact: true }).click()
          await page.getByRole("dialog").getByRole("button", { name: "Approve mocks", exact: true }).click()
          await expect(page.locator(".toasts")).toContainText("artifact is unavailable or changed")
          await expect(page.locator(".wf-status")).not.toContainText("Approved")
          writeFileSync(join(rig.work, "studio-screen.html"), "<h1>Recorded screen evidence</h1>")
          await page.getByRole("button", { name: "Approve mocks", exact: true }).click()
          await page.getByRole("dialog").getByRole("button", { name: "Approve mocks", exact: true }).click()
          await expect(page.locator(".wf-status")).toContainText("Approved")
          await page.reload()
          await expect(page.locator(".wf-status")).toContainText("Approved")
          await page.goto(`${origin}/studio/#/p/${project.projectId}/board`)
          await page.reload()
          await expect(page.getByRole("tab", { name: "Mocks", exact: true })).toBeVisible()

          await page.goto(`${origin}/studio/#/r/${project.repoId}/design`)
          await expect(page.locator(".dz-file")).toContainText("studio-design.pen")
          await expect(page.locator(".dz-file")).toContainText("Owner")
          await expect(page.locator(".dz-canvas")).toContainText("No flows")
          await page.getByRole("button", { name: "Category", exact: true }).click()
          await page.getByRole("menuitemradio", { name: "Components", exact: true }).click()
          await expect(page.locator(".dz-canvas")).toContainText("Engine Card")
          await expect(page.locator(".dz-canvas")).toContainText("Compact")
          await page.getByRole("button", { name: "View component", exact: true }).click()
          const display = page.getByRole("dialog", { name: "Engine Card preview", exact: true })
          await display.getByRole("button", { name: "Open display", exact: true }).click()
          await expect(display.frameLocator("iframe").locator("body")).toHaveAttribute("data-ready", "yes")
          expect(await display.locator("iframe").getAttribute("sandbox")).toBe("allow-scripts")
          const privateComponentUrl = await display.locator("iframe").getAttribute("src")
          await page.keyboard.press("Escape")
          await expect(display).toHaveCount(0)
          await expect.poll(async () => (await page.request.get(privateComponentUrl!)).ok()).toBe(false)
          await page.getByRole("button", { name: "Category", exact: true }).click()
          await page.getByRole("menuitemradio", { name: "Palette", exact: true }).click()
          await expect(page.locator(".dz-canvas")).toContainText("engine.ink")
          await expect(page.locator(".dz-canvas")).toContainText("#123456")
          await expect(page.locator(".dz-canvas")).not.toContainText("Dusk")
          // A changed design is refused by the real display route before editor startup.
          writeFileSync(join(rig.work, "studio-design.pen"), "Changed design bytes")
          await page.getByRole("button", { name: "Open in OpenPencil", exact: true }).click()
          expectedDisplayRefusal = true
          const refusedDisplay = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/display/open")
          await page.getByRole("dialog").getByRole("button", { name: "Open display", exact: true }).click()
          expect((await refusedDisplay).status()).toBe(503)
          await expect(page.locator(".toasts")).toContainText("isolated display could not be opened")
          expectedDisplayRefusal = false
          await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click()
          await expect(page.getByRole("dialog")).toHaveCount(0)
          writeFileSync(join(rig.work, "studio-design.pen"), "Registered design bytes")

          // The project's lead and its team come from the engine.
          await page.goto(`${origin}/studio/#/p/${encodeURIComponent(project.projectId)}/agents`)
          await expect(page.locator(".main")).toContainText("Build")
          await expect(page.locator(".main")).toContainText("Project lead")
          await expect(page.locator(".topbar")).toContainText("Project")
        })

        // A change in the engine reaches the open page through the stream.
        yield* call(project.leadCredential, "project.sprint.create", { projectId: project.projectId, label: "SP-2",
          name: "Pushed sprint", goal: "Arrive on the stream", phase: "Plan", owner: project.leadId, needs: [] })
        yield* Effect.promise(async () => {
          const origin = `http://127.0.0.1:${port}`
          const sidebar = page.locator(".sidebar")
          await page.goto(`${origin}/studio/#/p/${encodeURIComponent(project.projectId)}/board`)
          await expect(page.locator(".main")).toContainText("Pushed sprint")
          await expect(page.locator('[aria-label="Backlog"] .sprint-card')).toHaveCount(0)
          await expect(page.locator('[aria-label="Planned"]')).toContainText("Pushed sprint")
          await expect(page.locator('[aria-label="In progress"]')).toContainText("Sprint")
          await page.goto(`${origin}/studio/#/p/${project.projectId}/sprint/${project.sprintId}`)
          await expect(page.locator(".tk")).toContainText("Engine task")
          await page.getByRole("button", { name: "Add task", exact: true }).click()
          await page.getByRole("textbox", { name: "Task title" }).fill("Owner added task")
          await page.getByRole("button", { name: "Add", exact: true }).click()
          await expect(page.locator(".tk")).toContainText("Owner added task")
          await page.getByRole("row").filter({ hasText: "Engine task" }).click()
          await expect(page.locator(".page-title")).toHaveText("Engine task")
          await expect(page.locator(".main")).toContainText(rig.work)
          await expect(page.locator(".timeline")).toContainText("Recorded note")
          await expect(page.locator(".main")).toContainText(rig.work)
          await page.goto(`${origin}/studio/#/p/${project.projectId}/team/${project.team.teamId}`)
          await expect(page.getByRole("link", { name: "Team channel", exact: true })).toBeVisible()
          await expect(page.locator(".main")).toContainText("Owner added task")
          await page.goto(`${origin}/studio/#/r/${project.repoId}`)
          await expect(page.locator(".repo-facts")).toContainText(rig.work)
          await expect(page.locator(".repo-facts dt").filter({ hasText: "Remote" }).locator("+ dd")).toBeEmpty()
          await expect(page.locator(".repo-desc p")).toHaveCount(0)
          await expect(page.locator(".main .table")).toContainText("Project")
          await page.goto(`${origin}/studio/#/p/${project.projectId}/messages/waiting`)
          await expect(page.locator(".ch-row").filter({ hasText: "project-updates" }).locator(".count.info")).toHaveText("1")
          await page.locator(".ch-row").filter({ hasText: "project-updates" }).click()
          await expect(page.locator(".mb-stream")).toContainText("Engine board post")
          await expect(page.locator(".ch-row").filter({ hasText: "project-updates" }).locator(".count.info")).toHaveCount(0)
          const composer = page.locator(".mb-stream .board-composer")
          await composer.locator("textarea").fill("Owner board post")
          await composer.getByRole("button", { name: "Post", exact: true }).click()
          const posted = page.locator(".mb-stream .post").filter({ hasText: "Owner board post" })
          await expect(posted).toBeVisible()
          await expect(posted).toContainText("Needs reply")
          await posted.hover()
          await posted.getByRole("button", { name: "Mark as answered", exact: true }).click()
          await expect(posted).toContainText("Withdrawn")
          await posted.hover()
          await posted.getByRole("button", { name: "Reopen", exact: true }).click()
          await expect(page.locator(".toasts")).toContainText("not connected to the service yet")
          const original = page.locator(".mb-stream .post").filter({ hasText: "Engine board post" })
          await original.hover()
          await original.getByRole("button", { name: "Reply in thread", exact: true }).click()
          const thread = page.getByRole("complementary", { name: "Thread", exact: true })
          await thread.locator("textarea").fill("Owner thread reply")
          await thread.getByRole("button", { name: "Post", exact: true }).click()
          await expect(thread).toContainText("Owner thread reply")
          await page.getByRole("button", { name: "Close thread", exact: true }).click()
          await page.goto(`${origin}/studio/#/p/${project.projectId}/settings`)
          await page.locator("#ps-goal").fill("An edited engine goal")
          await page.getByRole("button", { name: "Save goal", exact: true }).click()
          await expect(page.getByRole("button", { name: "Save goal", exact: true })).toHaveCount(0)
          await page.getByRole("button", { name: "Rename", exact: true }).click()
          await page.locator("#rename-field").fill("Renamed project")
          await page.getByRole("dialog").getByRole("button", { name: "Rename", exact: true }).click()
          await expect(sidebar.locator(".tree-row.project").filter({ hasText: "Renamed project" })).toBeVisible()
          await page.getByRole("combobox", { name: "Lead model", exact: true }).selectOption("model-next")
          await expect(page.getByRole("combobox", { name: "Lead model", exact: true })).toHaveValue("model-next")
          await page.getByRole("combobox", { name: "Lead effort", exact: true }).selectOption("medium")
          await expect(page.getByRole("combobox", { name: "Lead effort", exact: true })).toHaveValue("medium")
          await page.getByRole("button", { name: "Archive", exact: true }).click()
          await page.getByRole("dialog").getByRole("button", { name: "Archive project", exact: true }).click()
          await expect(page).toHaveURL(new RegExp("#/r/"))
          await page.goto(`${origin}/studio/#/projects`)
          await page.getByRole("button", { name: /^Archived/ }).click()
          await expect(page.locator(".main .table")).toContainText("Renamed project")
          await page.keyboard.press("Control+k")
          await page.getByRole("dialog").getByRole("textbox").fill("Renamed")
          await expect(page.getByRole("dialog")).toContainText("Nothing matches")
          await page.keyboard.press("Escape")
          await page.getByRole("button", { name: "Restore", exact: true }).click()
          await expect(page.getByRole("button", { name: "Restore", exact: true })).toHaveCount(0)
          await page.goto(`${origin}/studio/#/machines`)
          await expect(page.locator(".svc-machines tbody > tr")).toHaveCount(1)
          const machine = page.locator(".svc-machines tbody > tr").first()
          await expect(machine).toContainText("local")
          await expect(machine).toContainText(String(port))
          await expect(machine.locator("td").nth(1)).toBeEmpty()
          await expect(machine.locator("td").nth(2)).toBeEmpty()
          await expect(machine.locator("td").nth(8)).toBeEmpty()
          await page.getByRole("button", { name: "Add machine", exact: true }).click()
          await expect(page.locator(".toasts")).toContainText("not connected to the service yet")
          await expect(page.getByRole("dialog")).toHaveCount(0)
          await page.getByRole("button", { name: /^Show details for / }).click()
          await expect(page.locator(".svc-detail")).toContainText(rig.root)
          await expect(page.locator(".svc-detail")).toContainText("Installed · 1 signed in")
          await expect(page.locator("#lim-local")).toHaveValue("")
          await page.locator("#lim-local").fill("2")
          await expect(page.locator(".toasts")).toContainText("not connected to the service yet")
          await page.getByRole("button", { name: "Actions for local", exact: true }).click()
          await page.getByRole("menuitem", { name: "Scan harnesses again", exact: true }).click()
          await expect(page.locator(".svc-machines").locator("..")).toHaveAttribute("aria-busy", "false")
          await expect(page.locator(".svc-detail")).toContainText("Installed · 1 signed in")
          await page.getByRole("button", { name: "Actions for local", exact: true }).click()
          await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
          await page.locator("#rename-field").fill("Other machine")
          await page.getByRole("dialog").getByRole("button", { name: "Rename", exact: true }).click()
          await expect(page.locator(".toasts")).toContainText("not connected to the service yet")
          await expect(machine).toContainText("local")
          if (await page.getByRole("dialog").count()) await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click()
          await page.getByRole("button", { name: "Actions for local", exact: true }).click()
          await page.getByRole("menuitem", { name: "Remove machine", exact: true }).click()
          await expect(page.locator(".toasts")).toContainText("not connected to the service yet")
          await expect(page.locator(".svc-machines tbody > tr")).toHaveCount(2)
          await page.getByRole("button", { name: "Add repository", exact: true }).click()
          await expect(page.locator("#ar-machine option")).toHaveCount(1)
          await page.locator("#ar-path").fill(additionalRepo)
          await page.getByRole("dialog").getByRole("button", { name: "Add repository", exact: true }).click()
          await expect(sidebar.locator(".tree-row.repo").filter({ hasText: "additional-repository" })).toBeVisible()
          await page.goto(`${origin}/studio/#/projects`)
          await page.locator(".main").getByRole("button", { name: "New project", exact: true }).click()
          await expect(page.locator("#np-machine option")).toHaveCount(1)
          await page.locator("#np-repo").selectOption({ label: "additional-repository" })
          await page.locator("#np-goal").fill("Build owner creation")
          await page.getByRole("button", { name: "Create project", exact: true }).click()
          await expect(page.locator(".topbar")).toContainText("Owner creation")
          await page.locator(".sidebar").getByRole("button", { name: "New project", exact: true }).click()
          await page.locator("#np-repo").selectOption({ label: "additional-repository" })
          await page.locator("#np-goal").fill("Build owner creation")
          await page.getByRole("button", { name: "Create project", exact: true }).click()
          await expect(page.locator(".toasts")).toContainText("project name already exists in this repository")
          await expect(page.locator("#np-goal")).toHaveValue("Build owner creation")
          await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click()
          await page.locator(".sidebar").getByRole("button", { name: "New project", exact: true }).click()
          await page.locator("#np-repo").selectOption("__new")
          await page.locator("#np-newrepo").fill("browser-new-repository")
          await page.locator("#np-goal").fill("Build nested board")
          await page.getByRole("button", { name: "Create project", exact: true }).click()
          await expect(page.locator(".topbar")).toContainText("Nested board")
          await expect(sidebar.locator(".tree-row.repo").filter({ hasText: "browser-new-repository" })).toBeVisible()
          await expect.poll(() => timings.some((line) => line.includes("first pushed update") && line.includes("after the engine recorded it"))).toBe(true)
          await page.goto(`${origin}/studio/#/home`)

          // A reload keeps the session, which is the engine's cookie.
          await page.reload()
          await expect(sidebar.locator(".tree-row.project").filter({ hasText: "Renamed project" })).toBeVisible()
          await expect.poll(() => timings.filter((line) => line.includes("snapshot took")).length).toBe(4)

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
    await displayProxy?.close()
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
    for (const route of ["/projects", "/p/console/board", "/p/console/chat", "/p/console/agents", "/p/console/sprint/sp1", "/p/console/task/t15", "/p/console/team/console-shell", "/p/console/messages", "/p/console/settings", "/p/console/mocks", "/p/console/mocks/screen/requests", "/r/lgtm/design/components/overview", "/r/lgtm/design/palette/colour", "/p/console/terminal", "/p/console/files", "/machines", "/settings"]) {
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

// An empty engine takes the owner through discovery and an existing repository, then
// starts exactly one lead through the fake runner and persists positive completion.
test("live first run: saves settings, registers the existing folder and creates the first project", async ({ page }) => {
  test.setTimeout(90_000)
  page.setDefaultTimeout(5_000)
  const rig = makeRig(), previousHome = process.env.LGTM_HOME
  process.env.LGTM_HOME = rig.stateFolder
  const password = randomBytes(32).toString("base64url"), errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => { if (message.type() === "error" && !/status of 401/.test(message.text())) errors.push(message.text()) })
  try {
    execFileSync("git", ["-C", rig.work, "init", "-b", "main"], { stdio: "ignore" })
    execFileSync("git", ["-C", rig.work, "-c", "user.name=Owner", "-c", "user.email=owner@example.test", "commit", "--allow-empty", "-m", "Initial"], { stdio: "ignore" })
    const studioRoot = await buildStudio(join(rig.root, "studio")), staticRoot = join(rig.root, "old-page"), port = await unusedPort()
    mkdirSync(staticRoot); writeFileSync(join(staticRoot, "index.html"), "<!doctype html><title>Old page</title>")
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const runner = yield* makeFakeRunner()
      const dependencies = Layer.mergeAll(runner.layer, makeFakeSecrets().layer, Layer.succeed(Redactor, {
        redact: (event) => Effect.succeed(event), redactText: (text) => Effect.succeed(text)
      }))
      yield* Effect.scoped(Effect.gen(function* () {
        yield* registerRebuildCheck()
        yield* seedAccount("setup-ready", "cursor")
        success(yield* call(ownerCredential, "harnesses", { operation: "set", harness: harnessSettings("cursor", {
          adapterPath: process.execPath, reportedModes: [{ id: "default", level: "ask" }]
        }) }))
        success(yield* call(ownerCredential, "accounts set-secret", { accountId: "setup-ready", name: "CURSOR_API_KEY", nonce: "studio-setup", value: Redacted.make("synthetic-studio-setup-key") }))
        yield* serve({ password: Redacted.make(password), staticRoot, studioRoot, lists: engineLists,
          settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: false } })
        yield* Effect.promise(async () => {
          const origin = `http://127.0.0.1:${port}`
          await page.goto(`${origin}/studio/`)
          await page.locator("#login-password").fill(password)
          await page.getByRole("button", { name: "Sign in", exact: true }).click()
          await expect(page.getByRole("heading", { name: "Connect a subscription", exact: true })).toBeVisible()
          await expect(page.locator(".auth-options")).toContainText("local-credential")
          await expect(page.locator(".auth-options")).not.toContainText("WXKP-3QHD")
          await page.getByRole("button", { name: "Skip setup", exact: true }).click()
          await expect(page.locator(".toasts")).toContainText("not connected to the service yet")
          await page.locator("#setup-workspace").fill(rig.root)
          await page.locator("#setup-shell").fill("bash")
          await page.locator("#setup-owner").fill("Setup Owner")
          await page.getByRole("button", { name: "Continue", exact: true }).click()
          await expect(page.getByRole("heading", { name: "Add a repository", exact: true })).toBeVisible()
          await page.locator("#setup-path").fill(rig.work)
          await page.getByRole("button", { name: "Continue", exact: true }).click()
          await expect(page.getByRole("heading", { name: "Start the first project", exact: true })).toBeVisible()
          await page.locator("#setup-goal").fill("Build a first board")
          await page.getByRole("button", { name: "Create project", exact: true }).click()
          await expect(page.locator(".topbar")).toContainText("First board")
          await expect(page.locator(".sidebar")).toContainText("Setup Owner")
          await page.reload()
          await expect(page.locator(".topbar")).toContainText("First board")
          await expect(page.locator(".auth.setup")).toHaveCount(0)
        })
        const setup = success(yield* call(ownerCredential, "project.setup", {})).setup
        expect(setup.completedAt).toBeDefined()
        expect(runner.calls.filter((row) => row.method === "start")).toHaveLength(1)
        const settings = success(yield* call(ownerCredential, "project.settings", {})).settings
        expect(settings).toMatchObject({ workspaceFolder: rig.root, shell: "bash", displayName: "Setup Owner" })
      })).pipe(Effect.provide(buildServices(rig, engineLists).pipe(Layer.provide(dependencies))), Effect.provide(runner.layer))
    })).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped) as Effect.Effect<void, unknown, never>)
    expect(errors).toEqual([])
  } finally {
    if (previousHome === undefined) delete process.env.LGTM_HOME; else process.env.LGTM_HOME = previousHome
    removeRig(rig)
  }
})

test("live website: subscriptions, notifications and service settings persist through the engine", async ({ page }, info) => {
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
        success(yield* call(ownerCredential, 'harnesses', { operation: 'set', harness: harnessSettings('first', { models: ['test-model', 'other-model'], efforts: ['high'], defaultModel: 'test-model', defaultEffort: 'high' }) }))
        success(yield* call(ownerCredential, 'project.settings.set', { settings: { workspaceFolder: rig.work, shell: 'zsh', lead: { harness: 'first', account: { _tag: 'any' }, permission: 'ask', model: 'test-model', effort: 'high' } } }))
        yield* completedSetup(project.projectId)
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

          // The project's lead and its team come from the engine.
          await page.goto(`${origin}/studio/#/p/${encodeURIComponent(project.projectId)}/agents`)
          await expect(page.locator(".main")).toContainText("Build")
          await expect(page.locator(".main")).toContainText("Project lead")
          await expect(page.locator(".topbar")).toContainText("Project")
        })

        // A change in the engine reaches the open page through the stream.
        yield* call(project.leadCredential, "project.sprint.create", { projectId: project.projectId, label: "SP-2",
          name: "Pushed sprint", goal: "Arrive on the stream", phase: "Plan", owner: project.leadId, needs: [] })
        yield* appendSetup([eventOf({ _tag: 'QuestionAsked', agentId: project.workerId, questionId: 'service-question', holder: { _tag: 'owner' }, deliveryId: 'service-question-delivery', text: 'Which branch?' }),
          eventOf({ _tag: 'OwnerNeeded', agentId: project.workerId, reason: 'request needs the owner', subject: { _tag: 'question', id: 'service-question' } })])
        yield* Effect.promise(async () => {
          const origin = `http://127.0.0.1:${port}`
          const sidebar = page.locator(".sidebar")
          await page.goto(`${origin}/studio/#/p/${encodeURIComponent(project.projectId)}/board`)
          await expect(page.locator(".main")).toContainText("Pushed sprint")
          await expect.poll(() => timings.some((line) => line.includes("first pushed update") && line.includes("after the engine recorded it"))).toBe(true)
          await page.goto(`${origin}/studio/#/home`)

          await exerciseStudioService(page, origin)
          await page.goto(`${origin}/studio/#/home`)

          // A reload keeps the session, which is the engine's cookie.
          await page.reload()
          await expect(sidebar.locator(".tree-row.project")).toContainText("Project")
          await expect.poll(() => timings.filter((line) => line.includes("snapshot took")).length).toBeGreaterThanOrEqual(2)

          // Logging out ends the session and leaves no records on the page.
          await page.getByRole("button", { name: "Log out" }).click()
          await expect(page.locator("#login-password")).toBeVisible()
          await expect(page.locator(".tree-row")).toHaveCount(0)
        })
        const savedProject = success(yield* call(ownerCredential, 'project.settings', {})).settings
        expect(savedProject.workspaceFolder).toBe(rig.work)
        expect(savedProject.lead).toMatchObject({ harness: 'first', model: 'other-model', effort: 'high', permission: 'edit' })
        const savedRoles = success(yield* call(ownerCredential, 'roles.settings.get', {})).settings
        expect(savedRoles).toMatchObject({ stallWatch: true, standingRules: true, limits: { stallMinutes: 37, capacityBackoffMinutes: 6, capacityRetries: 2, crashRetries: 0, teamIdleMinutes: 90 } })
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


test('live website: Git changes, history, remotes, integration and owner approval', async ({ page }) => { test.setTimeout(360_000); await exerciseStudioGit(page) })

test('live website: Service settings discovers models when the default harness changes and explains a missing account', async ({ page }) => {
  test.setTimeout(90_000)
  const { exerciseStudioModels } = await import('./support/studioModels.ts')
  await exerciseStudioModels(page)
})
