import { execFileSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { join } from "node:path"
import { mkdirSync, writeFileSync } from "node:fs"
import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { build } from "vite"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as SqlClient from "effect/sql/SqlClient"
import type { CreateProjectPayload } from "../src/project/creation.ts"
import { CommandHandler } from "../../engine/src/commands/CommandHandler.ts"
import { serve } from "../../engine/src/client/web/server.ts"
import { engineLists } from "../../engine/src/pieces/lists.ts"
import { projectView } from "../../engine/src/project/view.ts"
import { unusedPort } from "../../engine/test/support/browserWeb.ts"
import { RunnerRejected } from "../../engine/src/runner/Runner.ts"
import { sessionFor } from "../../engine/test/support/fakeRunner.ts"
import { makeFakeRunner } from "../../engine/test/support/fakeRunner.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"
import { snapshot } from "../../engine/test/support/routingRig.ts"
import { call, freshRequest, harnessSettings, makeFakeSecrets, makeRig, ownerCredential as owner, provideRig,
  readLog, removeRig, success, type Fakes, type Rig } from "../../engine/test/support/handlerRig.ts"

import { makeRedactor } from "../../engine/src/identity/redactor.ts"
import { httpsProxy } from "./support/httpsProxy.ts"

test.use({ ignoreHTTPSErrors: true })

// Source for the production App after the accepted foundation join. Execution
// is exercised through the authorized remote browser runner. There is no alternate page,
// mock RPC route, projection seeding, or fixture-only production import.
const git = (path: string, ...args: string[]) => execFileSync("git", ["-C", path, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
type ReplyGate = { hold: boolean; release?: (() => void) | undefined; setListener?: ((enabled: boolean) => Promise<unknown>) | undefined; login?: (() => Promise<void>) | undefined }
const replyGate = (gate: ReplyGate): NonNullable<Fakes["wrapLog"]> => (real) => ({ ...real, transact: (use) => {
  let created = false
  return real.transact((append) => use((actor, id, hash, events, rows, receipt) => {
    created ||= events.some((event) => event._tag === "project.Created")
    return append(actor, id, hash, events, rows, receipt)
  })).pipe(Effect.tap(() => created && gate.hold ? Effect.promise(() => new Promise<void>((resolve) => { gate.hold = false; gate.release = resolve })) : Effect.void))
} })
const fixture = async (page: Page, body: (rig: Rig, gate: ReplyGate, runner: Effect.Success<ReturnType<typeof makeFakeRunner>>) => Effect.Effect<void, unknown, any>, registered = true, isolated = false) => {
  const rig = makeRig(), previousHome = process.env.HOME, previousState = process.env.LGCODE_HOME
  process.env.HOME = rig.home; process.env.LGCODE_HOME = rig.stateFolder
  const gate: ReplyGate = { hold: false }
  const displaySecrets: Array<Redacted.Redacted<string>> = []
  let displayProxy: Awaited<ReturnType<typeof httpsProxy>> | undefined
  try {
    git(rig.work, "init", "-b", "main")
    git(rig.work, "-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Initial")
    const staticRoot = join(rig.root, "page")
    await build({ configFile: false, root: new URL("..", import.meta.url).pathname, logLevel: "silent", build: { outDir: staticRoot } })
    const port = await unusedPort(), password = randomBytes(32).toString("base64url")
    const displayPort = isolated ? await unusedPort() : undefined
    if (displayPort !== undefined) displayProxy = await httpsProxy(displayPort, rig.root)
    const display = displayProxy === undefined ? {} : { display: { port: displayPort!, publicAddress: displayProxy.origin.replace("127.0.0.1", "localhost") } }
    gate.login = async () => {
      await page.getByLabel("Password", { exact: true }).fill(password)
      await page.getByRole("button", { name: /^(Log in|Sign in)$/ }).click()
    }
    const program = Effect.gen(function* () {
      const runner = yield* makeFakeRunner()
      return yield* provideRig(rig, { runner, secrets: makeFakeSecrets(), lists: engineLists, wrapLog: replyGate(gate), ...(isolated ? { redactor: makeRedactor({ secrets: () => displaySecrets, tokenHashes: () => new Set() }).layer } : {}) }, Effect.gen(function* () {
        yield* registerRebuildCheck()
        success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "zsh" } }))
        success(yield* call(owner, "harnesses", { operation: "set", harness: harnessSettings("cursor", { adapterPath: process.execPath, reportedModes: [{ id: "default", level: "ask" }] }) }))
        success(yield* call(owner, "accounts", { operation: "add", account: { id: "primary", harness: "cursor", enabled: true } }))
        success(yield* call(owner, "accounts set-secret", { accountId: "primary", name: "CURSOR_API_KEY", nonce: freshRequest(), value: Redacted.make("synthetic-browser-project-credential") }))
        if (registered) {
          const { repoId } = success(yield* call(owner, "project.repository.add", { name: "Actual Product", path: rig.work, machineId: "local" }))
          const seed = success(yield* call(owner, "project.create", { name: "Already set up", goal: "Fixture setup", machineId: "local", repository: { _tag: "existing", repoId }, useWorktree: true }))
          success(yield* call(owner, "project.setup.advance", { step: "found" }))
          success(yield* call(owner, "project.setup.advance", { step: "project" }))
          success(yield* call(owner, "project.setup.complete", { projectId: seed.projectId }))
        }
        const webSettings = { enabled: true, port, heartbeatSeconds: 25, proxyMode: false, ...display }
        if (isolated) success(yield* call(owner, "client.web.settings.set", { settings: webSettings }))
        yield* serve({ password: Redacted.make(password), staticRoot, lists: engineLists,
          ...(isolated ? { registerSecret: (secret: Redacted.Redacted<string>) => { displaySecrets.push(secret) } } : { settings: webSettings }) })
        const handler = yield* CommandHandler
        // Both boundaries use the actual listener and keep its owner cookie.
        // Enabled permits normal automatic receipt recovery; disabled keeps
        // replacement connections unavailable until the fixture restores it.
        gate.setListener = (enabled) => Effect.runPromise(handler.execute(owner, "client.web.settings.set", {
          requestId: freshRequest(), settings: { enabled, port, heartbeatSeconds: 26, proxyMode: false }
        }))
        yield* Effect.promise(async () => {
          await page.goto(`http://127.0.0.1:${port}/#/`)
          await gate.login!()
          await expect(registered ? page.getByRole("button", { name: "New project", exact: true }).first() : page.getByRole("main", { name: "Set up LGcode", exact: true })).toBeVisible()
        })
        yield* body(rig, gate, runner)
      }))
    })
    await Effect.runPromise(program as Effect.Effect<void, unknown>)
  } finally {
    gate.release?.()
    await displayProxy?.close()
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome
    if (previousState === undefined) delete process.env.LGCODE_HOME; else process.env.LGCODE_HOME = previousState
    removeRig(rig)
  }
}
const openForm = async (page: Page) => {
  await page.getByRole("button", { name: "New project", exact: true }).first().click()
  const dialog = page.getByRole("dialog", { name: "New project", exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel("Project name", { exact: true })).toBeVisible()
  return dialog
}

test("New project has real unreserved placement, modal keyboard focus, literal text, and all Field/Dusk widths", async ({ page }, info) => {
  await fixture(page, (rig) => Effect.gen(function* () {
    const before = yield* readLog
    const branches = git(rig.work, "for-each-ref", "--format=%(refname)")
    for (const width of [390, 768, 1440, 2560]) for (const scheme of ["light", "dark"] as const) {
      yield* Effect.promise(async () => {
        await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" })
        const trigger = page.getByRole("button", { name: "New project", exact: true }).first()
        const dialog = await openForm(page)
        await dialog.getByLabel("Project name", { exact: true }).fill('Literal <script>project</script>')
        await dialog.getByLabel("Goal", { exact: true }).fill("Keep this real goal")
        await expect(dialog.getByRole("status", { name: "Project placement" })).toContainText("This preview reserves nothing")
        expect(await dialog.locator("dt").allTextContents()).toEqual(["Branch", "Folder"])
        expect(await dialog.locator("script").count()).toBe(0)
        const bounds = await dialog.evaluate((element) => {
          const r = element.getBoundingClientRect(), machine = element.querySelector('select[id$="-machine"]')!, name = element.querySelector('input[id$="-name"]')!
          return { inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
            overflow: document.documentElement.scrollWidth - innerWidth, machineBeforeName: Boolean(machine.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING) }
        })
        expect(bounds).toEqual({ inside: true, overflow: 0, machineBeforeName: true })
        const first = dialog.getByRole("button", { name: "Close project setup" })
        await first.focus(); await page.keyboard.press("Shift+Tab")
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
        await expect(dialog.getByRole("button", { name: "Create project", exact: true })).toBeFocused()
        await page.keyboard.press("Tab")
        await expect(first).toBeFocused()
        await page.screenshot({ path: info.outputPath(`new-project-${width}-${scheme}.png`), fullPage: true })
        await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused()
      })
    }
    expect(yield* readLog).toEqual(before)
    expect(git(rig.work, "for-each-ref", "--format=%(refname)")).toBe(branches)
    expect(Object.keys(projectView(yield* snapshot).creations)).toHaveLength(0)
  }))
})

test("Create persists the goal, real Git worktree and single lead at all eight Field/Dusk sizes, then opens each exact thread", async ({ page }, info) => {
  // Issue 608: eight real project/worktree/lead creations need a journey-sized budget.
  test.setTimeout(120_000)
  await fixture(page, (rig, _gate, runner) => Effect.gen(function* () {
    let combination = 0
    for (const width of [390, 768, 1440, 2560]) for (const scheme of ["light", "dark"] as const) {
      const beforeStarts = runner.callsOf("start").length
      const name = combination++ === 0 ? "Billing export" : `Browser export ${width} ${scheme}`
      const branch = name.toLowerCase().replaceAll(" ", "-")
      git(rig.work, "branch", branch)
      yield* Effect.promise(async () => {
        await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" })
        await page.goto(new URL("/#/", page.url()).href)
        const dialog = await openForm(page)
        await dialog.getByLabel("Project name", { exact: true }).fill(name)
        await dialog.getByLabel("Goal", { exact: true }).fill("Ship a real export")
        await expect(dialog.locator('input[type="checkbox"]')).toHaveCount(0)
        await expect(dialog.locator("dt")).toHaveText(["Branch", "Folder"])
        await expect(dialog.getByRole("status", { name: "Project placement" })).toContainText(`${branch}-2`)
        await expect(dialog.getByRole("button", { name: "Create project", exact: true })).toBeEnabled()
        await page.screenshot({ path: info.outputPath(`new-project-create-${width}-${scheme}.png`), fullPage: true })
        await dialog.getByRole("button", { name: "Create project", exact: true }).click()
        await expect(dialog).not.toBeVisible()
      })
      const view = projectView(yield* snapshot), project = Object.values(view.projects).find((row) => row.name === name)!
      expect(project.goal).toBe("Ship a real export")
      const workspace = view.workspaces[project.worktreeId]!
      expect(workspace).toMatchObject({ branch: `${branch}-2`, checkout: "worktree", repoId: project.repoId })
      expect(git(workspace.path, "branch", "--show-current")).toBe(`${branch}-2`)
      expect(runner.callsOf("start")).toHaveLength(beforeStarts + 1)
      expect((yield* readLog).filter((row) => row.event._tag === "project.Created" && row.event.projectId === project.projectId)).toHaveLength(1)
      yield* Effect.promise(async () => { await expect(page).toHaveURL(new RegExp(`/thread/${encodeURIComponent(project.leadAgentId)}`)) })
    }
  }))
})

test("Machines registration and Cancel return the same Home draft, then actual registration creates its dedicated worktree and lead", async ({ page }) => {
  await fixture(page, (rig, _gate, runner) => Effect.gen(function* () {
    yield* Effect.promise(async () => {
      await page.goto(new URL("/#/?view=projects", page.url()).href)
      const dialog = await openForm(page)
      await dialog.getByLabel("Project name", { exact: true }).fill("Registered browser goal")
      await dialog.getByLabel("Goal", { exact: true }).fill("Keep this draft through the actual Machines route")
      await dialog.getByRole("button", { name: "Add repository", exact: true }).click()
      await expect(page).toHaveURL(/#\/service\/machines$/)
      const registration = page.getByRole("region", { name: "Add repository to this computer" })
      await expect(registration).toBeVisible()
      await registration.getByRole("button", { name: "Cancel", exact: true }).click()
      await expect(page).toHaveURL(/#\/\?view=projects$/)
      await expect(dialog.getByLabel("Project name", { exact: true })).toHaveValue("Registered browser goal")
      await expect(dialog.getByLabel("Goal", { exact: true })).toHaveValue("Keep this draft through the actual Machines route")
      await page.keyboard.press("Escape")
      await expect(page.getByRole("button", { name: "New project", exact: true })).toBeFocused()
      await openForm(page)
      await dialog.getByRole("button", { name: "Add repository", exact: true }).click()
      await expect(registration.getByLabel("Name", { exact: true })).toHaveValue("Actual Product")
      await registration.getByLabel("Existing checkout folder", { exact: true }).fill(rig.work)
      await registration.getByRole("button", { name: "Register checkout", exact: true }).click()
      await expect(page).toHaveURL(/#\/\?view=projects$/)
      await expect(dialog.locator('input[type="checkbox"]')).toHaveCount(0)
      await expect(dialog.getByLabel("Goal", { exact: true })).toHaveValue("Keep this draft through the actual Machines route")
      await expect(dialog.getByRole("button", { name: "Create project", exact: true })).toBeEnabled()
      await expect(dialog.locator("dt")).toHaveText(["Branch", "Folder"])
      await dialog.getByRole("button", { name: "Create project", exact: true }).click()
      await expect(dialog).not.toBeVisible()
    })
    const view = projectView(yield* snapshot), project = Object.values(view.projects).find((row) => row.name === "Registered browser goal")!
    expect(project.goal).toBe("Keep this draft through the actual Machines route")
    expect(view.workspaces[project.worktreeId]?.checkout).toBe("worktree")
    expect(git(view.workspaces[project.worktreeId]!.path, "branch", "--show-current")).toBe("registered-browser-goal")
    expect(runner.callsOf("start")).toHaveLength(2)
    expect(runner.callsOf("start")[1]!.input.agentId).toBe(project.leadAgentId)
    expect((yield* readLog).filter((row) => row.event._tag === "project.RepositoryAdded")).toHaveLength(1)
    yield* Effect.promise(async () => { await expect(page).toHaveURL(new RegExp(`/thread/${encodeURIComponent(project.leadAgentId)}`)) })
  }))
})

test("actual authenticated logout clears both creation and registration drafts before the next login", async ({ page }) => {
  await fixture(page, (_rig, gate, runner) => Effect.gen(function* () {
    yield* Effect.promise(async () => {
      const dialog = await openForm(page)
      await dialog.getByLabel("Project name", { exact: true }).fill("Private browser project")
      await dialog.getByLabel("Goal", { exact: true }).fill("Private browser goal")
      await dialog.getByRole("button", { name: "Add repository", exact: true }).click()
      const registration = page.getByRole("region", { name: "Add repository to this computer" })
      await registration.getByLabel("Name", { exact: true }).fill("Private owner repository")
      await registration.getByLabel("Existing checkout folder", { exact: true }).fill("/private/old-owner-checkout")
      await page.getByRole("button", { name: "Log out", exact: true }).click()
      await expect(page.getByRole("form", { name: "Log in" })).toBeVisible()
      await gate.login!()
      await page.getByRole("link", { name: "Home", exact: true }).click()
      const fresh = await openForm(page)
      await expect(fresh.getByLabel("Project name", { exact: true })).toHaveValue("Actual Product")
      await expect(fresh.getByLabel("Goal", { exact: true })).toHaveValue("")
      await expect(fresh.getByLabel("Repository", { exact: true })).toContainText("Actual Product")
      await fresh.getByRole("button", { name: "Add repository", exact: true }).click()
      await expect(registration.getByLabel("Name", { exact: true })).toHaveValue("Actual Product")
      await expect(registration.getByLabel("Existing checkout folder", { exact: true })).not.toHaveValue("/private/old-owner-checkout")
    })
    expect(runner.callsOf("start")).toHaveLength(1)
    expect(Object.keys(projectView(yield* snapshot).repositories)).toHaveLength(1)
  }))
})

// Attach actual wire observations even when an assertion fails. A completed
// thread alone does not prove that an identical receipt was replayed.
const observeCreations = (page: Page) => {
  const requests: Array<{ socket: number; payload: CreateProjectPayload }> = []
  const closedSockets = new Set<number>()
  let nextSocket = 0
  page.on("websocket", (socket) => {
    const index = nextSocket++
    socket.on("close", () => closedSockets.add(index))
    socket.on("framesent", ({ payload }) => {
      try {
        const decoded = JSON.parse(payload.toString())
        for (const frame of Array.isArray(decoded) ? decoded : [decoded]) {
          if (frame._tag === "Request" && frame.tag === "project.create") requests.push({ socket: index, payload: frame.payload })
        }
      } catch { /* Keepalive frames carry no creation payload. */ }
    })
  })
  return { requests, closedSockets, snapshot: () => ({ requests, closedSockets: [...closedSockets] }) }
}
const assertReceipt = (request: CreateProjectPayload, projectId: string) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ result_json: string }>`SELECT result_json FROM receipts WHERE request_id = ${request.requestId}`
  expect(rows).toHaveLength(1)
  expect(rows[0]!.result_json).toContain(projectId)
})

test("one socket close automatically recovers the identical creation receipt and its single project and lead", async ({ page }, info) => {
  const wire = observeCreations(page)
  try {
    await fixture(page, (_rig, gate, runner) => Effect.gen(function* () {
      const beforeStarts = runner.callsOf("start").length
      gate.hold = true
      yield* Effect.promise(async () => {
        const dialog = await openForm(page)
        await dialog.getByLabel("Project name", { exact: true }).fill("Automatic acknowledgement")
        await dialog.getByLabel("Goal", { exact: true }).fill("Automatically recover this immutable goal")
        await expect(dialog.getByRole("button", { name: "Create project", exact: true })).toBeEnabled()
        await expect(dialog.locator('input[type="checkbox"]')).toHaveCount(0)
        await expect(dialog.locator("dt")).toHaveText(["Branch", "Folder"])
        await dialog.getByRole("button", { name: "Create project", exact: true }).click()
        await expect.poll(() => typeof gate.release).toBe("function")
        await expect.poll(() => wire.requests.length).toBe(1)
        const originalSocket = wire.requests[0]!.socket
        await gate.setListener!(true)
        await expect.poll(() => wire.closedSockets.has(originalSocket)).toBe(true)
        gate.release!()
        await expect(dialog).not.toBeVisible()
        await expect.poll(() => wire.requests.length).toBeGreaterThanOrEqual(2)
      })
      const attempts = wire.requests.map((row) => row.payload)
      expect(attempts.every((row) => JSON.stringify(row) === JSON.stringify(attempts[0]))).toBe(true)
      expect(attempts[0]!.useWorktree).toBe(true)
      const view = projectView(yield* snapshot), projects = Object.values(view.projects).filter((row) => row.name === "Automatic acknowledgement")
      expect(projects).toHaveLength(1)
      const project = projects[0]!
      expect(project.goal).toBe("Automatically recover this immutable goal")
      expect(view.workspaces[project.worktreeId]?.checkout).toBe("worktree")
      expect(runner.callsOf("start")).toHaveLength(beforeStarts + 1)
      expect((yield* readLog).filter((row) => row.event._tag === "project.Created")).toHaveLength(2)
      yield* assertReceipt(attempts[0]!, project.projectId)
      yield* Effect.promise(async () => { await expect(page).toHaveURL(new RegExp(`/thread/${encodeURIComponent(project.leadAgentId)}`)) })
    }))
  } finally {
    await info.attach("automatic-creation-wire", { body: JSON.stringify(wire.snapshot(), null, 2), contentType: "application/json" })
  }
})

test("exhausted socket recovery keeps the frozen creation for manual Check same creation without a second project or lead", async ({ page }, info) => {
  const wire = observeCreations(page)
  try {
    await fixture(page, (_rig, gate, runner) => Effect.gen(function* () {
      const beforeStarts = runner.callsOf("start").length
      gate.hold = true
      yield* Effect.promise(async () => {
        const dialog = await openForm(page)
        await dialog.getByLabel("Project name", { exact: true }).fill("Lost acknowledgement")
        await dialog.getByLabel("Goal", { exact: true }).fill("Original immutable goal")
        await expect(dialog.getByRole("button", { name: "Create project", exact: true })).toBeEnabled()
        await expect(dialog.locator('input[type="checkbox"]')).toHaveCount(0)
        await expect(dialog.locator("dt")).toHaveText(["Branch", "Folder"])
        await dialog.getByRole("button", { name: "Create project", exact: true }).click()
        await expect.poll(() => typeof gate.release).toBe("function")
        await expect.poll(() => wire.requests.length).toBe(1)
        const originalSocket = wire.requests[0]!.socket
        await gate.setListener!(false)
        await expect.poll(() => wire.closedSockets.has(originalSocket)).toBe(true)
        gate.release!()
        // Original full1 uncertainty oracle and its default 5000ms timeout.
        await expect(dialog.getByRole("alert")).toContainText("Could not confirm creation")
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
        await gate.setListener!(true)
        const reopened = await openForm(page)
        await expect(reopened.getByLabel("Goal", { exact: true })).toHaveValue("Original immutable goal")
        await expect(reopened.getByLabel("Goal", { exact: true })).toBeDisabled()
        await expect(reopened.getByRole("button", { name: "Check same creation" })).toBeEnabled()
        await reopened.getByRole("button", { name: "Check same creation" }).click()
        await expect(reopened).not.toBeVisible()
      })
      const attempts = wire.requests.map((row) => row.payload)
      expect(attempts.length).toBeGreaterThanOrEqual(2)
      expect(attempts.every((row) => JSON.stringify(row) === JSON.stringify(attempts[0]))).toBe(true)
      expect(attempts[0]!.useWorktree).toBe(true)
      expect(runner.callsOf("start")).toHaveLength(beforeStarts + 1)
      const view = projectView(yield* snapshot), projects = Object.values(view.projects).filter((row) => row.name === "Lost acknowledgement")
      expect(projects).toHaveLength(1)
      const project = projects[0]!
      expect(project.goal).toBe("Original immutable goal")
      expect(view.workspaces[project.worktreeId]?.checkout).toBe("worktree")
      expect((yield* readLog).filter((row) => row.event._tag === "project.Created")).toHaveLength(2)
      yield* assertReceipt(attempts[0]!, project.projectId)
      yield* Effect.promise(async () => { await expect(page).toHaveURL(new RegExp(`/thread/${encodeURIComponent(project.leadAgentId)}`)) })
    }))
  } finally {
    await info.attach("manual-creation-wire", { body: JSON.stringify(wire.snapshot(), null, 2), contentType: "application/json" })
  }
})

test("first-run Welcome, discovery, Back, Machines detour and actual first creation retain private state across all Field/Dusk widths", async ({ page }, info) => {
  await fixture(page, (rig, _gate, runner) => Effect.gen(function* () {
    const initial = yield* readLog
    yield* Effect.promise(async () => {
      const setup = page.getByRole("main", { name: "Set up LGcode", exact: true })
      for (const width of [390, 768, 1440, 2560]) for (const colorScheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ colorScheme, reducedMotion: "reduce" })
        await expect(setup.getByRole("button", { name: "Get started", exact: true })).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: info.outputPath(`welcome-${width}-${colorScheme}.png`), fullPage: true })
      }
    })
    expect(yield* readLog).toEqual(initial)
    expect(runner.callsOf("start")).toHaveLength(0)
    yield* Effect.promise(async () => {
      const setup = page.getByRole("main", { name: "Set up LGcode", exact: true })
      await setup.getByRole("button", { name: "Get started", exact: true }).click()
      await expect(setup).toContainText("Remote authentication not checked")
      const form = setup.locator(".new-project")
      for (const width of [390, 768, 1440, 2560]) for (const colorScheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ colorScheme, reducedMotion: "reduce" })
        await expect(setup.getByRole("heading", { name: "Found on this computer", exact: true })).toBeVisible()
        await setup.getByRole("button", { name: "Continue", exact: true }).click()
        await expect(form.getByLabel("Goal", { exact: true })).toHaveCount(0)
        await expect(form.getByLabel("Repository", { exact: true })).toContainText("New repository")
        await form.getByLabel("Project name", { exact: true }).fill("First private draft")
        await expect(form.getByRole("button", { name: "Create project", exact: true })).toBeDisabled()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: info.outputPath(`first-project-${width}-${colorScheme}.png`), fullPage: true })
        await setup.getByRole("button", { name: "Back", exact: true }).click()
        await setup.getByRole("button", { name: "Continue", exact: true }).click()
        await expect(form.getByLabel("Project name", { exact: true })).toHaveValue("First private draft")
        await setup.getByRole("button", { name: "Back", exact: true }).click()
      }
      await setup.getByRole("button", { name: "Continue", exact: true }).click()
      await form.getByRole("button", { name: "Add repository", exact: true }).click()
      const registration = page.getByRole("region", { name: "Add repository to this computer", exact: true })
      await registration.getByLabel("Name", { exact: true }).fill("First owned repository")
      await registration.getByLabel("Existing checkout folder", { exact: true }).fill(rig.work)
      await registration.getByRole("button", { name: "Register checkout", exact: true }).click()
      await expect(form.getByLabel("Project name", { exact: true })).toHaveValue("First private draft")
      await expect(form.getByRole("button", { name: "Create project", exact: true })).toBeEnabled()
      await form.getByRole("button", { name: "Create project", exact: true }).click()
      await expect(page).toHaveURL(/#\/thread\//)
      await expect(setup).toHaveCount(0)
      await page.reload()
      await expect(page.getByRole("region", { name: "Thread", exact: true })).toBeVisible()
      expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)
    })
    const view = projectView(yield* snapshot), project = Object.values(view.projects)[0]!
    expect(view.setup.projectId).toBe(project.projectId)
    expect(view.setup.completedAt).toBeGreaterThan(0)
    expect(project.goal).toBe("")
    expect(runner.callsOf("start")).toHaveLength(1)
    expect(git(view.workspaces[project.worktreeId]!.path, "branch", "--show-current")).toBe("first-private-draft")
    expect((yield* readLog).filter((row) => row.event._tag === "project.SetupCompleted")).toHaveLength(1)
  }), false)
})

test("mounted Mocks and repository Design expose actual immutable evidence, supported scenarios, stale refusal and one durable approval at all eight sizes", async ({ page }, info) => {
  await fixture(page, (rig) => Effect.gen(function* () {
    const view = projectView(yield* snapshot), project = Object.values(view.projects)[0]!, folder = view.workspaces[project.worktreeId]!.path
    writeFileSync(join(folder, "screen.html"), "<h1>Owned mock evidence</h1>")
    writeFileSync(join(folder, "tokens.json"), JSON.stringify({ tokens: [{ name: "ink", value: "#123456" }] }))
    writeFileSync(join(folder, "actual.pen"), "Registered design evidence")
    const design = success(yield* call(owner, "project.design.record", { projectId: project.projectId, design: {
      repoId: project.repoId, worktreeId: project.worktreeId, file: "actual.pen", tokensPath: "tokens.json", components: [] } }))
    const bundle = { sources: [{ sourceId: "screen", worktreeId: project.worktreeId, path: "screen.html", kind: "screens" }],
      screens: [{ screenId: "home", sourceId: "screen", name: "Owned screen <script>literal</script>", route: "/home", scenarioRoutes: [{ scenarioId: "empty", route: "/home?case=empty" }] }],
      scenarios: [{ scenarioId: "empty", name: "Empty", description: "Supported exact route" }, { scenarioId: "heavy", name: "Heavy unsupported", description: "No route on this screen" }], components: [], draftedFields: [], designRevision: design.revisionId }
    const revision = success(yield* call(owner, "project.mocks.record", { projectId: project.projectId, bundle }))
    yield* Effect.promise(async () => {
      const origin = new URL(page.url()).origin, mocks = page.getByRole("region", { name: "Mocks", exact: true })
      for (const width of [390, 768, 1440, 2560]) for (const colorScheme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ colorScheme, reducedMotion: "reduce" })
        await page.goto(`${origin}/#/project/${project.projectId}/board`)
        await expect(page.locator(".stage-strip")).toContainText("Design")
        await expect(page.getByRole("link", { name: "Open the mocks", exact: true })).toBeVisible()
        await page.getByRole("tab", { name: "Mocks", exact: true }).click()
        await expect(mocks.getByRole("combobox", { name: "Revision", exact: true })).toHaveValue(revision.revisionId)
        await expect(mocks).toContainText("Owned screen <script>literal</script>")
        await mocks.getByRole("combobox", { name: "Scenario", exact: true }).selectOption("empty")
        await expect(mocks).toContainText("/home?case=empty")
        await expect(mocks.getByRole("combobox", { name: "Scenario", exact: true })).not.toContainText("Heavy unsupported")
        await mocks.getByRole("button", { name: "Read current artifacts", exact: true }).click()
        await expect(mocks.getByRole("button", { name: "Approve mocks", exact: true })).toBeEnabled()
        expect(await mocks.locator("script").count()).toBe(0)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: info.outputPath(`mocks-${width}-${colorScheme}.png`), fullPage: true })
        await page.goto(`${origin}/#/repository/${project.repoId}/design`)
        const registered = page.getByRole("region", { name: "Repository Design", exact: true })
        await expect(registered).toContainText("actual.pen")
        await expect(registered).toContainText("#123456")
        await expect(registered).toContainText(design.revisionId)
        await expect(registered).not.toContainText("awaiting integration")
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: info.outputPath(`repository-design-${width}-${colorScheme}.png`), fullPage: true })
      }
      await page.goto(`${origin}/#/project/${project.projectId}/mocks`)
      await mocks.getByRole("button", { name: "Read current artifacts", exact: true }).click()
      await expect(mocks.getByRole("button", { name: "Approve mocks", exact: true })).toBeEnabled()
      // Evidence changes after review; the actual engine must refuse approval.
      writeFileSync(join(folder, "screen.html"), "Changed after review")
      await mocks.getByRole("button", { name: "Approve mocks", exact: true }).click()
      await mocks.getByRole("button", { name: "Confirm approval", exact: true }).click()
      await expect(mocks).toContainText("Approval refused")
    })
    expect((yield* readLog).filter((row) => row.event._tag === "project.MockApproved")).toHaveLength(0)
    const next = success(yield* call(owner, "project.mocks.record", { projectId: project.projectId, expectedRevision: revision.revisionId, bundle }))
    yield* Effect.promise(async () => {
      const mocks = page.getByRole("region", { name: "Mocks", exact: true })
      await mocks.getByRole("button", { name: "Refresh mocks", exact: true }).click()
      await mocks.getByRole("combobox", { name: "Revision", exact: true }).selectOption(next.revisionId)
      await mocks.getByRole("button", { name: "Read current artifacts", exact: true }).click()
      await expect(mocks.getByRole("button", { name: "Approve mocks", exact: true })).toBeEnabled()
      await mocks.getByRole("button", { name: "Approve mocks", exact: true }).click()
      await mocks.getByRole("button", { name: "Confirm approval", exact: true }).click()
      await expect(mocks).toContainText("Recorded implementation worklist")
      await page.reload()
      await expect(mocks).toContainText("Recorded implementation worklist")
    })
    const log = yield* readLog, approvals = log.filter((row) => row.event._tag === "project.MockApproved")
    expect(approvals).toHaveLength(1)
    expect(projectView(yield* snapshot).projects[project.projectId]?.stage).toBe("plan")
    expect(log.filter((row) => row.event._tag === "DeliveryQueued" && row.event.delivery.source?._tag === "piece" && row.event.delivery.source.namespace === "project" && row.event.delivery.source.id.startsWith('["mock-approval",'))).toHaveLength(1)
  }))
})


test("registered component View renders its own styles and image inertly, denies stale and foreign selections, and revokes the real session", async ({ page }, info) => {
  await fixture(page, (rig) => Effect.gen(function* () {
    const view = projectView(yield* snapshot), project = Object.values(view.projects)[0]!, folder = view.workspaces[project.worktreeId]!.path
    const component = '<!doctype html><title>Registered component</title><link rel="stylesheet" href="style.css"><h1>Actual registered component</h1><img alt="Owned component mark" src="mark.svg"><button autofocus onclick="document.body.dataset.clicked=String(Number(document.body.dataset.clicked||0)+1)">Component action</button><script>document.body.dataset.loaded="yes";document.body.dataset.clicked="0";try{parent.document.body.dataset.escaped="yes"}catch{document.body.dataset.opaque="yes"}</script>'
    mkdirSync(join(folder, "design/components"), { recursive: true })
    writeFileSync(join(folder, "design/actual.pen"), "Actual registered editor evidence")
    writeFileSync(join(folder, "design/components/card.html"), component)
    writeFileSync(join(folder, "design/components/source.tsx"), "export const Card = () => null")
    writeFileSync(join(folder, "design/components/style.css"), 'h1{color:rgb(18,52,86);border:6px solid rgb(255,132,0)}img{width:64px;height:64px}button{width:160px;height:40px}')
    writeFileSync(join(folder, "design/components/mark.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#285e43"/></svg>')
    const hash = (value: string) => createHash("sha256").update(value).digest("hex")
    const revision = success(yield* call(owner, "project.design.record", { projectId: project.projectId, design: {
      repoId: project.repoId, worktreeId: project.worktreeId, file: "design/actual.pen", components: [
        { componentId: "card", name: "Registered Card", reference: "design/components/card.html", fingerprint: hash(component) },
        { componentId: "source", name: "Source Card", reference: "design/components/source.tsx", fingerprint: hash("export const Card = () => null") }
      ] } }))
    success(yield* call(owner, "project.mocks.record", { projectId: project.projectId, bundle: {
      sources: [{ sourceId: "card", worktreeId: project.worktreeId, path: "design/components/card.html", kind: "screens" }],
      screens: [{ screenId: "card", sourceId: "card", name: "Actual interactive mock", route: "/card", scenarioRoutes: [] }],
      scenarios: [], components: [], draftedFields: [], designRevision: revision.revisionId
    } }))
    const { componentDisplay } = yield* Effect.promise(() => import("../../engine/src/project/display.ts"))
    const input = yield* (yield* CommandHandler).input({ _tag: "owner" })
    const admitted = yield* componentDisplay(input, { repoId: project.repoId, revisionId: revision.revisionId, componentId: "card" })
    expect(admitted.text === component).toBe(true)
    expect((yield* componentDisplay({ ...input, actor: { _tag: "agent", agentId: project.leadAgentId } }, { repoId: project.repoId, revisionId: revision.revisionId, componentId: "card" }).pipe(Effect.result))._tag).toBe("Failure")
    const initial = yield* readLog
    yield* Effect.promise(async () => {
      const origin = new URL(page.url()).origin, selection = { _tag: "component", repoId: project.repoId, revisionId: revision.revisionId, componentId: "card" }
      const open = (data: unknown) => page.request.post(`${origin}/api/display/open`, { data, headers: { Origin: origin } })
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.goto(`${origin}/#/repository/${project.repoId}/design`)
      const design = page.getByRole("region", { name: "Repository Design", exact: true })
      await expect(design).toContainText("Preview unavailable for this source format.")
      const preview = page.getByRole("region", { name: "Registered Card preview", exact: true })
      let issuedStatus = 0
      page.on("response", (response) => { if (new URL(response.url()).pathname === "/api/display/open") issuedStatus = response.status() })
      await preview.getByRole("button", { name: "View component", exact: true }).click()
      await expect.poll(() => issuedStatus).toBe(200)
      const iframe = preview.locator("iframe"), frame = preview.frameLocator("iframe")
      await expect(frame.getByRole("heading", { name: "Actual registered component", includeHidden: true })).toHaveCSS("color", "rgb(18, 52, 86)")
      await expect(frame.locator("body")).toHaveAttribute("data-loaded", "yes")
      await expect(frame.locator("body")).toHaveAttribute("data-opaque", "yes")
      await expect(frame.locator("body")).toHaveAttribute("inert", "")
      await expect.poll(() => frame.getByAltText("Owned component mark").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 64)).toBe(true)
      expect(await iframe.getAttribute("sandbox")).toBe("allow-scripts")
      expect(await iframe.getAttribute("tabindex")).toBe("-1")
      expect(await page.locator("body").getAttribute("data-escaped")).toBeNull()
      // A real pointer and keyboard traverse the owner page. Neither reaches
      // the component control; View/Close remain outside the inert subtree.
      const button = await frame.getByRole("button", { name: "Component action", includeHidden: true }).boundingBox()
      expect(button).not.toBeNull()
      await page.mouse.click(button!.x + button!.width / 2, button!.y + button!.height / 2)
      await expect(frame.locator("body")).toHaveAttribute("data-clicked", "0")
      const close = preview.getByRole("button", { name: "Close display", exact: true })
      await close.focus(); await page.keyboard.press("Shift+Tab")
      expect(await page.evaluate(() => document.activeElement?.tagName === "IFRAME")).toBe(false)
      expect(await frame.locator("body").evaluate((body) => body.ownerDocument.activeElement?.tagName === "BUTTON")).toBe(false)
      await page.screenshot({ path: info.outputPath("registered-component-inert.png"), fullPage: true })
      const privateUrl = await iframe.getAttribute("src")
      await close.click()
      await expect(iframe).toHaveCount(0)
      const revoked = await page.request.get(privateUrl!)
      expect(revoked.status() === 401 || revoked.status() === 503).toBe(true)
      const anonymousContext = await page.context().browser()!.newContext({ ignoreHTTPSErrors: true })
      try {
        expect((await anonymousContext.request.post(`${origin}/api/display/open`, { data: selection, headers: { Origin: origin } })).status()).toBe(401)
      } finally { await anonymousContext.close() }
      for (const data of [{ ...selection, repoId: "foreign-repository" }, { ...selection, revisionId: freshRequest() }, { ...selection, componentId: "foreign-component" }, { ...selection, path: "design/components/card.html" }]) {
        expect((await open(data)).ok()).toBe(false)
      }
      await preview.getByRole("button", { name: "View component", exact: true }).click()
      await expect(iframe).toBeVisible()
      const staleUrl = await iframe.getAttribute("src")
      writeFileSync(join(folder, "design/components/card.html"), "Changed registered component")
      expect((await page.request.get(staleUrl!)).status()).toBe(404)
      expect((await open(selection)).ok()).toBe(false)
      writeFileSync(join(folder, "design/components/card.html"), component)
      await close.click()
      await preview.getByRole("button", { name: "View component", exact: true }).click()
      await expect(frame.getByRole("heading", { name: "Actual registered component", includeHidden: true })).toBeVisible()
      // Component inertness must not disable the existing active mock path.
      await close.click()
      await page.goto(`${origin}/#/project/${project.projectId}/mocks`)
      const mock = page.getByRole("region", { name: "Recorded mock preview", exact: true })
      await mock.getByRole("button", { name: "Open preview", exact: true }).click()
      const mockFrame = mock.frameLocator("iframe")
      await expect(mockFrame.locator("body")).toHaveAttribute("data-loaded", "yes")
      await page.getByRole("button", { name: "Desktop", exact: true }).click()
      await expect.poll(() => mockFrame.locator("html").evaluate(() => innerWidth)).toBe(1440)
      expect(await mock.locator("iframe").evaluate((node) => node.getBoundingClientRect().width)).toBeLessThanOrEqual(await mock.evaluate((node) => node.clientWidth))
      await page.getByRole("button", { name: "Phone", exact: true }).click()
      await expect.poll(() => mockFrame.locator("html").evaluate(() => innerWidth)).toBe(390)
      expect(await mockFrame.locator("body").getAttribute("inert")).toBeNull()
      await mockFrame.getByRole("button", { name: "Component action", exact: true }).click()
      await expect(mockFrame.locator("body")).toHaveAttribute("data-clicked", "1")
      await mockFrame.getByRole("button", { name: "Component action", exact: true }).focus()
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("IFRAME")
      await mock.getByRole("button", { name: "Close display", exact: true }).click()
      await page.goto(`${origin}/#/repository/${project.repoId}/design`)
      await preview.getByRole("button", { name: "View component", exact: true }).click()
      await expect(frame.locator("body")).toHaveAttribute("data-loaded", "yes")
      const logoutUrl = await iframe.getAttribute("src")
      await page.getByRole("button", { name: "Log out", exact: true }).click()
      expect((await page.request.get(logoutUrl!)).ok()).toBe(false)
      expect((await open(selection)).status()).toBe(401)
    })
    expect(yield* readLog).toEqual(initial)
  }), true, true)
})

for (const axis of ["model", "effort"] as const) test(`first-run ${axis} refusal opens the existing lead remedy and completes only after real configure/resume`, async ({ page }) => {
  await fixture(page, (_rig, _gate, runner) => Effect.gen(function* () {
    success(yield* call(owner, "harnesses", { operation: "set", harness: harnessSettings("cursor", { adapterPath: process.execPath,
      models: ["test-model", "valid-model"], efforts: ["high", "low"], reportedModes: [{ id: "default", level: "ask" }] }) }))
    runner.script("start", () => Effect.fail(new RunnerRejected({ reason: "controlled first-run refusal", startFailure: `${axis}-refused` })))
    yield* Effect.promise(async () => {
      await page.getByRole("button", { name: "Get started", exact: true }).click()
      await page.getByRole("button", { name: "Continue", exact: true }).click()
      const form = page.locator(".new-project")
      await form.getByLabel("Repository", { exact: true }).selectOption("__new")
      await form.getByLabel("Repository name", { exact: true }).fill(`refused-${axis}`)
      await form.getByLabel("Project name", { exact: true }).fill(`Recover ${axis}`)
      await form.getByRole("button", { name: "Create project", exact: true }).click()
      await expect(page.getByText("Setup completion is unconfirmed.", { exact: false })).toBeVisible()
      await form.getByRole("button", { name: "Open lead conversation", exact: true }).click()
      await expect(page.getByRole("region", { name: "Thread", exact: true })).toBeVisible()
      await expect(page.getByRole("article", { name: "Failed start", exact: true })).toContainText(axis === "model" ? "refused the model" : "refused the effort")
    })
    const before = projectView(yield* snapshot), project = Object.values(before.projects)[0]!
    expect(before.setup.completedAt).toBeUndefined()
    expect(Object.values(before.projects)).toHaveLength(1)
    const refused = (yield* readLog).filter((row) => row.event._tag === "CommandRefused" && row.event.command === "project.setup.complete")
    expect(refused).toHaveLength(1)
    yield* Effect.promise(async () => {
      await page.getByRole("button", { name: axis === "model" ? "Model" : "Effort", exact: true }).click()
      await page.getByRole("menuitemradio", { name: axis === "model" ? "valid-model" : "low", exact: true }).click()
      await page.locator(".configuration-evidence > summary").click()
      await expect(page.getByText("Selection recorded.", { exact: false })).toBeVisible()
    })
    runner.script("start", (input) => Effect.succeed(sessionFor(input.agentId)))
    // Resume drains the original project kickoff through the real dispatcher.
    // Only its external provider turn end is controlled.
    const sql = yield* SqlClient.SqlClient
    runner.script("prompt", (input) => runner.emit({ _tag: "turnEnded", agentId: input.agentId, incarnation: input.incarnation }).pipe(Effect.provideService(SqlClient.SqlClient, sql)))
    yield* Effect.promise(async () => {
      await page.getByRole("button", { name: "Resume agent", exact: true }).click()
      await expect(page.getByRole("status", { name: "Agent activity", exact: true })).toHaveText("Idle")
      await page.getByRole("button", { name: "Return to first project", exact: true }).click()
      await page.getByRole("button", { name: "Retry completion", exact: true }).click()
      await expect(page.getByRole("main", { name: "Set up LGcode", exact: true })).toHaveCount(0)
      await expect(page).toHaveURL(new RegExp(`#\\/thread\\/${project.leadAgentId}$`))
    })
    const after = projectView(yield* snapshot), events = yield* readLog
    expect(Object.values(after.projects)).toHaveLength(1)
    expect(after.projects[project.projectId]).toEqual(before.projects[project.projectId])
    expect(after.setup.projectId).toBe(project.projectId)
    expect(after.setup.completedAt).toBeGreaterThan(0)
    expect(events.filter((row) => row.event._tag === "project.Created")).toHaveLength(1)
    const completed = events.filter((row) => row.event._tag === "project.SetupCompleted")
    expect(completed).toHaveLength(1)
    expect(completed[0]!.requestId).not.toBe(refused[0]!.requestId)
    expect(runner.callsOf("start")).toHaveLength(2)
    expect(runner.callsOf("configure").at(-1)!.input.desired[axis]).toBe(axis === "model" ? "valid-model" : "low")
    const configured = events.filter((row) => row.event._tag === "AgentConfigurationApplied" && row.event.agentId === project.leadAgentId)
    expect(configured.at(-1)?.event).toMatchObject({ applied: { [axis]: axis === "model" ? "valid-model" : "low" } })
  }), false)
})
