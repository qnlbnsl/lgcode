import { randomBytes } from "node:crypto"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { build } from "vite"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as SqliteClient from "../../../third_party/t3code/node-sqlite/src/nodeSqliteClient.ts"
import { serve } from "../../engine/src/client/web/server.ts"
import { Redactor } from "../../engine/src/log/Redactor.ts"
import { engineLists } from "../../engine/src/pieces/lists.ts"
import { buildServices } from "../../engine/src/service.ts"
import { unusedPort } from "../../engine/test/support/browserWeb.ts"
import { makeFakeRunner } from "../../engine/test/support/fakeRunner.ts"
import { call, makeFakeSecrets, makeRig, ownerCredential, removeRig, startPayload, success } from "../../engine/test/support/handlerRig.ts"
import { decisionSetup } from "../../engine/test/support/projectDecisionFixtures.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"
import { requestPermission } from "../../engine/test/support/routingRig.ts"

// Real authenticated HTTP/WebSocket transport, engine handlers and SQLite.
// Only the external coding harness and its secrets service are test doubles.
test("Home, boards, linked decisions and Add task use the real engine across both themes and four widths", async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const rig = makeRig()
  const previousHome = process.env.LGCODE_HOME
  process.env.LGCODE_HOME = rig.stateFolder
  const password = randomBytes(32).toString("base64url")
  const staticRoot = join(rig.root, "page")
  try {
    await build({ configFile: false, root: new URL("..", import.meta.url).pathname, logLevel: "silent", build: { outDir: staticRoot } })
    const port = await unusedPort()
    const origin = `http://127.0.0.1:${port}`
    const program = Effect.gen(function* () {
      const runner = yield* makeFakeRunner()
      const run = Effect.gen(function* () {
        yield* registerRebuildCheck()
        const fixture = yield* decisionSetup()
        const taskId = success(yield* call(fixture.leadCredential, "project.task.create", fixture.task)).taskId as string
        const asked = success(yield* call(fixture.workerCredential, "ask", { projectId: fixture.projectId, taskId,
          title: "Choose the implementation", text: "Keep <script>agent text</script> plain.", proposedAnswer: "Use existing contracts", recommendation: "Keep the direct route contract" }))
        success(yield* call(fixture.leadCredential, "pass-up", { subject: { _tag: "question", id: asked.questionId } }))
        const permission = yield* requestPermission(runner, { agentId: fixture.workerId, token: fixture.worker.token }, {
          permissionRequestId: "page-permission", description: "Review the actual tool input", options: [
            { id: "once", name: "Allow once", kind: "allow_once", persistent: false, level: "ask" },
            { id: "reject", name: "Reject", kind: "reject_once", persistent: false, level: "read-only" }
          ]
        })
        success(yield* call(fixture.leadCredential, "pass-up", { subject: { _tag: "permission", id: permission.id } }))
        runner.rejectNext("start", "test external harness refusal")
        yield* call(ownerCredential, "start", startPayload(rig, { name: "Retry worker" }))
        yield* serve({ password: Redacted.make(password), staticRoot, lists: engineLists,
          settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: false } })
        yield* Effect.promise(async () => {
          const overflow = async () => {
            const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
            expect(widths.document).toBeLessThanOrEqual(widths.viewport)
            expect(widths.body).toBeLessThanOrEqual(widths.viewport)
          }
          const home = () => page.goto(`${origin}/#/`)
          const project = () => page.goto(`${origin}/#/project/${fixture.projectId}/board`)
          const sprint = () => page.goto(`${origin}/#/project/${fixture.projectId}/sprint/${fixture.sprintId}`)
          const task = () => page.goto(`${origin}/#/project/${fixture.projectId}/task/${taskId}`)
          await page.goto(origin)
          await page.getByLabel("Password", { exact: true }).fill(password)
          await page.getByRole("button", { name: "Log in", exact: true }).click()
          await expect(page.locator(`[data-home-item="question:${asked.questionId}"]`)).toBeVisible()
          for (const theme of ["light", "dark"] as const) for (const width of [390, 768, 1440, 2560]) {
            await page.emulateMedia({ colorScheme: theme })
            await page.setViewportSize({ width, height: 1000 })
            for (const [name, visit, ready] of [
              ["home", home, '[aria-label="Home"] .request-list'],
              ["board", project, ".sprint-card"],
              ["sprint", sprint, '[aria-label="Sprint detail"] .detail-blockers'],
              ["task", task, ".task-timeline"]
            ] as const) {
              await visit()
              await expect(page.locator(ready).first()).toBeVisible()
              await overflow()
              if (name === "board") {
                if (width !== 390) for (const box of await page.locator(".sprint-card").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width))) expect(box).toBeLessThanOrEqual(300)
                await expect(page.locator("progress")).toHaveCount(0)
                await expect(page.locator(width === 390 ? ".board-list" : ".kanban")).toBeVisible()
              }
              if (name === "sprint") expect(await page.locator(".detail-blockers").evaluate((node) => Boolean(node.nextElementSibling?.classList.contains("agent-data")))).toBe(true)
              await page.screenshot({ path: testInfo.outputPath(`${name}-${theme}-${width}.png`), fullPage: true })
            }
            await sprint()
            await page.getByRole("button", { name: "Add task", exact: true }).click()
            await expect(page.getByRole("dialog", { name: "Add task", exact: true })).toBeVisible()
            await overflow()
            await page.screenshot({ path: testInfo.outputPath(`add-task-${theme}-${width}.png`), fullPage: true })
            await page.getByRole("button", { name: "Cancel", exact: true }).click()
          }
          await page.setViewportSize({ width: 1440, height: 1000 })
          await home()
          await page.locator(`[data-home-item="question:${asked.questionId}"]`).click()
          const answer = page.getByRole("form", { name: "Answer question", exact: true })
          await expect(answer.getByRole("textbox")).toHaveValue("Use existing contracts")
          await expect(page.locator(".home-detail")).toContainText("<script>agent text</script>")
          await expect(page.locator(".home-detail script")).toHaveCount(0)
          await answer.getByRole("textbox").fill("Use existing contracts after review")
          await answer.getByRole("button", { name: "Send answer", exact: true }).click()
          await expect(page.locator(`[data-home-item="question:${asked.questionId}"]`)).toHaveCount(0)
          await expect(page.locator(`[data-home-item="permission:${permission.id}"]`)).toBeFocused()
          await page.locator(`[data-home-item="permission:${permission.id}"]`).click()
          await page.getByRole("button", { name: "Allow once", exact: true }).click()
          await expect.poll(() => runner.callsOf("answerPermission").length).toBe(1)
          await expect(page.locator(`[data-home-item="permission:${permission.id}"]`)).toHaveCount(0)
          const failure = page.locator(".failed-start-list details").first()
          await failure.locator("summary").click()
          await failure.getByRole("button", { name: "Resume agent", exact: true }).click()
          await expect(page.locator(".failed-start-list details")).toHaveCount(0)
          await expect(page.getByText("No open requests.", { exact: true })).toBeVisible()
          await task()
          await expect(page.locator(".detail-status")).toContainText("Done")
          await expect(page.locator(".task-timeline")).toContainText("Question answered")
          await page.goto(`${origin}/#/repository/${fixture.repoId}`)
          await expect(page.getByRole("navigation", { name: "Repository views" }).getByRole("link", { name: "Design", exact: true })).toHaveAttribute("href", `/#/repository/${fixture.repoId}/design`)
          await page.locator(".project-table a").first().click()
          await page.goBack()
          await expect(page.getByRole("region", { name: "Repository projects", exact: true })).toBeVisible()
          await sprint()
          await page.getByRole("button", { name: "Add task", exact: true }).click()
          const dialog = page.getByRole("dialog", { name: "Add task", exact: true })
          await dialog.getByRole("textbox", { name: "Task", exact: true }).fill("Actual owner task")
          await dialog.getByRole("button", { name: "Add task", exact: true }).click()
          await expect(page.getByRole("heading", { name: "Actual owner task", exact: true })).toBeVisible()
        })
        const tasks = success(yield* call(ownerCredential, "project.read", { projectId: fixture.projectId, collection: "tasks" })).items as Array<{ taskId: string }>
        for (const row of tasks) success(yield* call(ownerCredential, "project.task.update", { projectId: fixture.projectId, taskId: row.taskId, state: "done" }))
        const withoutEvidence = yield* call(ownerCredential, "project.sprint.complete", { projectId: fixture.projectId, sprintId: fixture.sprintId, completion: "Merged", evidence: "" })
        expect(withoutEvidence._tag).toBe("Failure")
        success(yield* call(ownerCredential, "project.sprint.complete", { projectId: fixture.projectId, sprintId: fixture.sprintId, completion: "Merged", evidence: `[Work](task:${taskId})` }))
        yield* Effect.promise(async () => {
          await page.goto(`${origin}/#/project/${fixture.projectId}/board`)
          await expect(page.locator('[aria-label="Done"] .sprint-card')).toBeVisible()
          await page.locator(".sprint-card").click()
          await expect(page.getByRole("heading", { name: "Completion evidence", exact: true })).toBeVisible()
          await expect(page.locator(".section-heading").getByRole("button", { name: "Add task", exact: true })).toHaveCount(0)
          await expect(page.locator(".evidence-text a")).toHaveAttribute("href", `/#/project/${fixture.projectId}/task/${taskId}`)
        })
        success(yield* call(ownerCredential, "project.archive", { projectId: fixture.projectId }))
        yield* Effect.promise(async () => {
          await page.goto(`${origin}/#/project/${fixture.projectId}/board`)
          await expect(page.getByText("Archived. Restore this project in Project settings to add work.", { exact: true })).toBeVisible()
          await page.goto(`${origin}/#/`)
          await expect(page.getByText("No open requests.", { exact: true })).toBeVisible()
        })
      })
      const dependencies = Layer.mergeAll(runner.layer, makeFakeSecrets().layer, Layer.succeed(Redactor, {
        redact: (event) => Effect.succeed(event), redactText: (text) => Effect.succeed(text)
      }))
      yield* Effect.scoped(run).pipe(Effect.provide(buildServices(rig, engineLists).pipe(Layer.provide(dependencies))), Effect.provide(runner.layer))
    }).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped)
    await Effect.runPromise(program as Effect.Effect<void, unknown>)
  } finally {
    if (previousHome === undefined) delete process.env.LGCODE_HOME
    else process.env.LGCODE_HOME = previousHome
    removeRig(rig)
  }
})
