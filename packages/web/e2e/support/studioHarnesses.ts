import { randomBytes } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Page } from "@playwright/test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as SqliteClient from "../../../../third_party/t3code/node-sqlite/src/nodeSqliteClient.ts"
import { buildServices } from "../../../engine/src/service.ts"
import { serve } from "../../../engine/src/client/web/server.ts"
import { engineLists } from "../../../engine/src/pieces/lists.ts"
import { Redactor } from "../../../engine/src/log/Redactor.ts"
import { fixtureHarnessPrograms } from "../../../engine/test/support/fixtureHarnessPrograms.ts"
import { unusedPort } from "../../../engine/test/support/browserWeb.ts"
import { makeFakeRunner } from "../../../engine/test/support/fakeRunner.ts"
import { appendSetup, eventOf, harnessSettings, makeFakeSecrets, makeRig, readLog, removeRig } from "../../../engine/test/support/handlerRig.ts"
import { registerRebuildCheck } from "../../../engine/test/support/rebuildCheck.ts"
import { buildStudio } from "../../../studio/scripts/build.ts"
import { completedSetup } from "./completedSetup.ts"

export async function exerciseStudioHarnesses(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const rig = makeRig(), previousHome = process.env.LGTM_HOME
  process.env.LGTM_HOME = rig.stateFolder
  const executable = join(rig.root, "fixture-harness"), script = join(rig.root, "install.cjs")
  // This is the entire install. No package manager or provider is contacted.
  writeFileSync(script, `const fs=require('node:fs'); fs.writeFileSync(${JSON.stringify(executable)}, '#!/bin/sh\\necho fixture-1.2.3\\n'); fs.chmodSync(${JSON.stringify(executable)}, 0o700);`)
  const harnessPrograms = fixtureHarnessPrograms({ home: rig.home, executable, script, id: "fixture", name: "Fixture harness", version: "fixture-1.2.3" })
  const password = randomBytes(32).toString("base64url"), port = await unusedPort()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  try {
    const studioRoot = await buildStudio(join(rig.root, "studio")), staticRoot = join(rig.root, "web")
    mkdirSync(staticRoot); writeFileSync(join(staticRoot, "index.html"), "<title>Test</title>")
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const runner = yield* makeFakeRunner()
      const dependencies = Layer.mergeAll(runner.layer, makeFakeSecrets().layer, Layer.succeed(Redactor, { redact: (e) => Effect.succeed(e), redactText: (s) => Effect.succeed(s) }))
      yield* Effect.scoped(Effect.gen(function* () {
        yield* registerRebuildCheck()
        yield* completedSetup()
        yield* appendSetup([eventOf({ _tag: "HarnessChanged", harness: harnessSettings("fixture", { adapterPath: executable, models: [], efforts: [] }) })])
        yield* serve({ password: Redacted.make(password), staticRoot, studioRoot, lists: engineLists, settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: false } })
        yield* Effect.promise(async () => {
          const root = `http://127.0.0.1:${port}/studio/`
          await page.goto(root)
          await page.locator("#login-password").fill(password)
          await page.getByRole("button", { name: "Sign in", exact: true }).click()
          await page.locator(".sidebar").getByRole("link", { name: "Harnesses", exact: true }).click()
          await expect(page.getByRole("heading", { name: "Harnesses", exact: true })).toBeVisible()
          await expect(page.locator(".sidebar").getByRole("link", { name: "Subscriptions", exact: true })).toHaveCount(0)
          const harness = page.locator(".svc-harness").filter({ has: page.getByRole("heading", { name: "Fixture harness", exact: true }) })
          await expect(harness).toContainText("Not installed")
          mkdirSync(".foundry", { recursive: true })
          await page.screenshot({ path: ".foundry/harnesses-page.png", fullPage: true, animations: "disabled" })
          await harness.getByRole("button", { name: "Add account", exact: true }).click()
          const dialog = page.getByRole("dialog")
          await expect(dialog.locator(".qc-code pre")).toHaveText(`'${process.execPath}' '${script}'`)
          await expect(dialog.getByRole("button", { name: "Copy the install recipe", exact: true })).toBeVisible()
          await expect(dialog.locator("#as-name")).toHaveCount(0)
          await page.screenshot({ path: ".foundry/harness-install-dialog.png", fullPage: true, animations: "disabled" })
          await dialog.getByRole("button", { name: "Install", exact: true }).click()
          await expect(dialog).toContainText("Installed")
          await expect(dialog).toContainText("fixture-1.2.3")
          await dialog.getByRole("button", { name: "Continue", exact: true }).click()
          await dialog.locator("#as-name").fill("Owner account")
          await dialog.getByRole("button", { name: "Add account", exact: true }).click()
          await expect(harness.locator(".svc-sub")).toContainText("Owner account")
          await expect(harness).toContainText("Installed")
          await page.reload()
          await expect(harness.locator(".svc-sub")).toContainText("Owner account")
          await page.goto(`${root}#/subscriptions`)
          await expect(page.getByRole("heading", { name: "Harnesses", exact: true })).toBeVisible()
          await expect(page).toHaveURL(/#\/harnesses$/)
          await expect(page.locator('.sidebar a[aria-current="page"]')).toContainText("Harnesses")
        })
        const events = (yield* readLog).filter((e) => e.event._tag.startsWith("HarnessInstall"))
        expect(events.map((e) => e.event._tag)).toEqual(["HarnessInstallStarted", "HarnessInstallFinished"])
        expect(runner.callsOf("start")).toHaveLength(0)
      })).pipe(Effect.provide(buildServices({ ...rig, harnessPrograms }, engineLists).pipe(Layer.provide(dependencies))), Effect.provide(runner.layer))
    })).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped) as Effect.Effect<void, unknown, never>)
    expect(errors).toEqual([])
    await exerciseSampleHarnesses(page)
  } finally {
    if (previousHome === undefined) delete process.env.LGTM_HOME; else process.env.LGTM_HOME = previousHome
    removeRig(rig)
  }
}

async function exerciseSampleHarnesses(page: Page) {
  const { createServer } = await import("node:http")
  const { readFile } = await import("node:fs/promises")
  const { extname } = await import("node:path")
  const { fileURLToPath } = await import("node:url")
  const design = fileURLToPath(new URL("../../../../design/", import.meta.url))
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
  page.on("pageerror", (error) => errors.push(error.message))
  try {
    const root = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}/mock/`
    await page.goto(`${root}#/harnesses`)
    await expect(page.locator(".sidebar")).toContainText("Maya Okafor")
    await expect(page.locator(".svc-harness")).toHaveCount(4)
    await expect(page.locator(".page")).toContainText(/\d+ of \d+ signed in, \d+ at its limit/)
    await expect(page.locator('[name="df-perm"]')).toHaveCount(0)
    await page.screenshot({ path: ".foundry/harnesses-sample.png", fullPage: true, animations: "disabled" })
    const gemini = page.locator(".svc-harness").filter({ has: page.getByRole("heading", { name: "Gemini CLI", exact: true }) })
    await expect(gemini).toContainText("Not installed")
    await gemini.getByRole("button", { name: "Add account", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.locator(".qc-code pre")).toContainText("ci")
    await expect(dialog).toContainText("@google/gemini-cli@0.68.0")
    await dialog.getByRole("button", { name: "Install", exact: true }).click()
    await dialog.getByRole("button", { name: "Continue", exact: true }).click()
    await dialog.locator("#as-name").fill("Sample account")
    await dialog.getByRole("button", { name: "Add account", exact: true }).click()
    await expect(gemini.locator(".svc-sub")).toContainText("Sample account")
    await gemini.getByRole("button", { name: "Add account", exact: true }).click()
    await dialog.locator("#as-name").fill("Another account")
    await dialog.locator("#as-machine").selectOption("buildbox")
    await expect(dialog).toContainText("Gemini CLI is not installed on")
    await expect(dialog.getByRole("button", { name: "Add account", exact: true })).toBeDisabled()
    await dialog.locator("#as-machine").evaluate((select: HTMLSelectElement) => { select.value = "laptop"; select.dispatchEvent(new Event("change", { bubbles: true })) })
    await expect(dialog).toContainText("is offline.")
    await expect(dialog.getByRole("button", { name: "Add account", exact: true })).toBeDisabled()
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    const cursor = page.locator(".svc-harness").filter({ has: page.getByRole("heading", { name: "Cursor", exact: true }) })
    await cursor.getByRole("button", { name: "Add account", exact: true }).click()
    await expect(dialog.getByRole("button", { name: "Install", exact: true })).toBeDisabled()
    await expect(dialog).toContainText("Run the official installer in your terminal")
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    await page.goto(`${root}#/settings?section=defaults`)
    await expect(page.locator("#df-model")).toHaveCount(0)
    await expect(page.getByText("What a new agent may do without asking.", { exact: false })).toBeVisible()
    expect(errors).toEqual([])
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) }
}
