import { randomBytes } from "node:crypto"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { build } from "vite"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as SqliteClient from "../../../third_party/t3code/node-sqlite/src/nodeSqliteClient.ts"
import { buildServices } from "../../engine/src/service.ts"
import { serve } from "../../engine/src/client/web/server.ts"
import { engineLists } from "../../engine/src/pieces/lists.ts"
import { Redactor } from "../../engine/src/log/Redactor.ts"
import { unusedPort } from "../../engine/test/support/browserWeb.ts"
import { makeFakeRunner } from "../../engine/test/support/fakeRunner.ts"
import { makeFakeSecrets, makeRig, removeRig } from "../../engine/test/support/handlerRig.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"
import { decisionSetup } from "../../engine/test/support/projectDecisionFixtures.ts"

// Production artifact, authenticated engine reads and real typed project log.
// Only the harness runner is fake. These are emulated viewport proofs.
test("foundation shell: URL history, focus, sizing, themes and eight viewport captures under the real policy", async ({ page }, info) => {
  test.setTimeout(90_000) // One authenticated service covers eight screenshots and a real outage.
  const rig = makeRig()
  const previousHome = process.env.LGCODE_HOME
  process.env.LGCODE_HOME = rig.stateFolder
  const password = randomBytes(32).toString("base64url")
  const staticRoot = join(rig.root, "page")
  const violations: string[] = []
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => { if (message.type() === "error" && /content.security.policy|refused to (?:apply|execute|load)/iu.test(message.text())) violations.push(message.text()) })
  await page.addInitScript(() => {
    const observed: string[] = []
    Object.assign(window, { shellPolicyViolations: observed })
    document.addEventListener("securitypolicyviolation", (event) => observed.push(`${event.violatedDirective}: ${event.blockedURI}`))
  })
  try {
    await build({ configFile: false, root: new URL("..", import.meta.url).pathname, logLevel: "silent", build: { outDir: staticRoot } })
    const port = await unusedPort()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const runner = yield* makeFakeRunner()
      const dependencies = Layer.mergeAll(runner.layer, makeFakeSecrets().layer, Layer.succeed(Redactor, {
        redact: (event) => Effect.succeed(event), redactText: (text) => Effect.succeed(text)
      }))
      yield* Effect.scoped(Effect.gen(function* () {
        yield* registerRebuildCheck()
        const project = yield* decisionSetup()
        yield* serve({ password: Redacted.make(password), staticRoot, lists: engineLists,
          settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: false } })
        yield* Effect.promise(async () => {
          const origin = `http://127.0.0.1:${port}`
          const board = `${origin}/#/project/${encodeURIComponent(project.projectId)}/board`
          await page.goto(board)
          await page.getByLabel("Password", { exact: true }).fill(password)
          await page.getByRole("button", { name: "Log in", exact: true }).click()
          await expect(page.getByRole("tab", { name: "Board", exact: true })).toHaveAttribute("aria-selected", "true")
          await expect(page.locator(".project-select")).toContainText("Project")
          const repositoryDisclosure = page.getByRole("button", { name: "Collapse Repository", exact: true })
          await repositoryDisclosure.click()
          await expect(page).toHaveURL(board)
          await page.getByRole("button", { name: "Expand Repository", exact: true }).click()
          await page.getByRole("tab", { name: "Project settings", exact: true }).click()
          await expect(page.locator(".admin-page")).toContainText("Project settings")
          await page.goBack()
          await expect(page.getByRole("tab", { name: "Board", exact: true })).toHaveAttribute("aria-selected", "true")
          await page.goForward()
          await expect(page.getByRole("tab", { name: "Project settings", exact: true })).toHaveAttribute("aria-selected", "true")
          await page.reload()
          await expect(page.getByRole("tab", { name: "Project settings", exact: true })).toHaveAttribute("aria-selected", "true")

          for (const [theme, label] of [["light", "Light"], ["dark", "Dark"]] as const) {
            await page.goto(`${origin}/#/service/settings`)
            await page.getByRole("button", { name: label, exact: true }).click()
            for (const width of [390, 768, 1440, 2560]) {
              await page.setViewportSize({ width, height: 900 })
              await page.goto(board)
              await expect(page.locator("html")).toHaveAttribute("data-theme", theme)
              await expect(page.getByRole("tab", { name: "Board", exact: true })).toHaveAttribute("aria-selected", "true")
              const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
                document: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
              expect(dimensions.viewport).toBe(width)
              expect(dimensions.document).toBeLessThanOrEqual(width)
              expect(dimensions.body).toBeLessThanOrEqual(width)
              if (width === 390) {
                const menu = page.getByRole("button", { name: "Open navigation", exact: true })
                await menu.click()
                const drawer = page.getByRole("dialog", { name: "Repositories, projects and teams", exact: true })
                await expect(drawer).toBeVisible()
                await expect(page.locator("main")).toHaveAttribute("inert", "")
                expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true)
                await page.keyboard.press("Shift+Tab")
                expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true)
                await page.keyboard.press("Escape")
                await expect(drawer).toHaveCount(0)
                await expect(menu).toBeFocused()
                await expect(page.locator(".topbar > *")).toHaveCount(3)
              }
              await info.attach(`${theme === "light" ? "Field" : "Dusk"}-${width}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" })
              expect(await page.evaluate(() => (window as typeof window & { shellPolicyViolations: string[] }).shellPolicyViolations)).toEqual([])
            }
          }
          await page.setViewportSize({ width: 1440, height: 900 })
          const separator = page.getByRole("separator", { name: "Resize navigation", exact: true })
          await separator.focus()
          await page.keyboard.press("ArrowRight")
          await expect(separator).toHaveAttribute("aria-valuenow", "264")
          const rect = await separator.boundingBox()
          expect(rect).not.toBeNull()
          await page.mouse.move(rect!.x + rect!.width / 2, rect!.y + 60)
          await page.mouse.down()
          await page.mouse.move(rect!.x + rect!.width / 2 + 32, rect!.y + 60)
          await page.mouse.up()
          await expect(separator).toHaveAttribute("aria-valuenow", "296")
          expect(await page.locator('.sidebar').evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(296)
          await page.getByRole("button", { name: "Collapse navigation", exact: true }).click()
          expect(await page.locator('.sidebar').evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(48)
          await page.reload()
          await expect(page.getByRole("button", { name: "Expand navigation", exact: true })).toBeVisible()
          await page.getByRole("button", { name: "Expand navigation", exact: true }).click()
          await expect(separator).toHaveAttribute("aria-valuenow", "296")
          await page.goto(`${origin}/#/service/settings`)
          await page.getByRole("button", { name: "Match system", exact: true }).click()
          await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" })
          await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
          await page.emulateMedia({ colorScheme: "dark" })
          await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
          await page.goto(`${origin}/#/thread/${project.workerId}`)
          const draft = page.getByRole("textbox", { name: "Prompt agent", exact: true })
          await draft.fill("Retain this draft while disconnected")
          await draft.press("Control+k")
          await expect(page.getByRole("dialog", { name: "Find project or agent", exact: true })).toHaveCount(0)
          await page.context().setOffline(true)
          try {
            // A real transport interruption, with no app or DTO replacement.
            await expect(page.getByRole("button", { name: "Send prompt", exact: true })).toBeDisabled()
            await expect(draft).toHaveValue("Retain this draft while disconnected")
          } finally { await page.context().setOffline(false) }
          expect(violations).toEqual([])
          expect(errors).toEqual([])
          expect(await page.evaluate(() => (window as typeof window & { shellPolicyViolations: string[] }).shellPolicyViolations)).toEqual([])
        })
      })).pipe(Effect.provide(buildServices(rig, engineLists).pipe(Layer.provide(dependencies))), Effect.provide(runner.layer))
    })).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true }))) as Effect.Effect<void, unknown>)
  } finally {
    if (previousHome === undefined) delete process.env.LGCODE_HOME
    else process.env.LGCODE_HOME = previousHome
    removeRig(rig)
  }
})
