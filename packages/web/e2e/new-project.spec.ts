import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { join } from "node:path"
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
import { makeFakeRunner } from "../../engine/test/support/fakeRunner.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"
import { snapshot } from "../../engine/test/support/routingRig.ts"
import { call, freshRequest, harnessSettings, makeFakeSecrets, makeRig, ownerCredential as owner, provideRig,
  readLog, removeRig, success, type Fakes, type Rig } from "../../engine/test/support/handlerRig.ts"

// Source for the production App after the accepted foundation join. Execution
// remains held until an exact-source browser grant. There is no alternate page,
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
const fixture = async (page: Page, body: (rig: Rig, gate: ReplyGate, runner: Effect.Success<ReturnType<typeof makeFakeRunner>>) => Effect.Effect<void, unknown, any>, registered = true) => {
  const rig = makeRig(), previousHome = process.env.HOME, previousState = process.env.LGCODE_HOME
  process.env.HOME = rig.home; process.env.LGCODE_HOME = rig.stateFolder
  const gate: ReplyGate = { hold: false }
  try {
    git(rig.work, "init", "-b", "main")
    git(rig.work, "-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Initial")
    const staticRoot = join(rig.root, "page")
    await build({ configFile: false, root: new URL("..", import.meta.url).pathname, logLevel: "silent", build: { outDir: staticRoot } })
    const port = await unusedPort(), password = randomBytes(32).toString("base64url")
    gate.login = async () => {
      await page.getByLabel("Password", { exact: true }).fill(password)
      await page.getByRole("button", { name: /^(Log in|Sign in)$/ }).click()
    }
    const program = Effect.gen(function* () {
      const runner = yield* makeFakeRunner()
      return yield* provideRig(rig, { runner, secrets: makeFakeSecrets(), lists: engineLists, wrapLog: replyGate(gate) }, Effect.gen(function* () {
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
        yield* serve({ password: Redacted.make(password), staticRoot, lists: engineLists,
          settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: false } })
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
          await expect(page.getByRole("button", { name: "New project", exact: true }).first()).toBeVisible()
        })
        yield* body(rig, gate, runner)
      }))
    })
    await Effect.runPromise(program as Effect.Effect<void, unknown>)
  } finally {
    gate.release?.()
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
      await expect(dialog).toContainText("No repositories are registered")
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
      await registration.getByLabel("Name", { exact: true }).fill("Actual browser repository")
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
    expect(runner.callsOf("start")).toHaveLength(1)
    expect(runner.callsOf("start")[0]!.input.agentId).toBe(project.leadAgentId)
    expect((yield* readLog).filter((row) => row.event._tag === "project.RepositoryAdded")).toHaveLength(1)
    yield* Effect.promise(async () => { await expect(page).toHaveURL(new RegExp(`/thread/${encodeURIComponent(project.leadAgentId)}`)) })
  }), false)
})

test("actual authenticated logout clears both creation and registration drafts before the next login", async ({ page }) => {
  await fixture(page, (_rig, gate, runner) => Effect.gen(function* () {
    yield* Effect.promise(async () => {
      const dialog = await openForm(page)
      await expect(dialog).toContainText("No repositories are registered")
      await dialog.getByLabel("Project name", { exact: true }).fill("Private browser project")
      await dialog.getByLabel("Goal", { exact: true }).fill("Private browser goal")
      await dialog.getByRole("button", { name: "Add repository", exact: true }).click()
      const registration = page.getByRole("region", { name: "Add repository to this computer" })
      await registration.getByLabel("Name", { exact: true }).fill("Private browser registration")
      await registration.getByLabel("Existing checkout folder", { exact: true }).fill("/private/old-owner-checkout")
      await page.getByRole("button", { name: "Log out", exact: true }).click()
      await expect(page.getByRole("form", { name: "Log in" })).toBeVisible()
      await gate.login!()
      await page.getByRole("link", { name: "Home", exact: true }).click()
      const fresh = await openForm(page)
      await expect(fresh.getByLabel("Project name", { exact: true })).toHaveValue("")
      await expect(fresh.getByLabel("Goal", { exact: true })).toHaveValue("")
      await expect(fresh).toContainText("No repositories are registered")
      await fresh.getByRole("button", { name: "Add repository", exact: true }).click()
      await expect(registration.getByLabel("Name", { exact: true })).toHaveValue("")
      await expect(registration.getByLabel("Existing checkout folder", { exact: true })).toHaveValue("")
    })
    expect(runner.callsOf("start")).toHaveLength(0)
    expect(Object.keys(projectView(yield* snapshot).repositories)).toHaveLength(0)
  }), false)
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
