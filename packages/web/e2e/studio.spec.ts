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
import { makeFakeRunner } from "../../engine/test/support/fakeRunner.ts"
import { call, makeFakeSecrets, makeRig, removeRig } from "../../engine/test/support/handlerRig.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"
import { decisionSetup } from "../../engine/test/support/projectDecisionFixtures.ts"
import { buildStudio } from "../../studio/scripts/build.ts"

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
          await expect.poll(() => timings.filter((line) => line.includes("snapshot took")).length).toBe(2)

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
