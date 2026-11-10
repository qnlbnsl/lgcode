import { randomBytes } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { build } from "vite"
import * as SqliteClient from "../../../third_party/t3code/node-sqlite/src/nodeSqliteClient.ts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import type { Project, Repository, Workspace } from "@lgcode/contracts"
import { buildServices } from "../../engine/src/service.ts"
import { serve } from "../../engine/src/client/web/server.ts"
import { makeRedactor } from "../../engine/src/identity/redactor.ts"
import { CommandHandler } from "../../engine/src/commands/CommandHandler.ts"
import { LogWriteFailed } from "../../engine/src/log/EventLog.ts"
import { engineLists } from "../../engine/src/pieces/lists.ts"
import { Views } from "../../engine/src/views/Views.ts"
import { projectView } from "../../engine/src/project/view.ts"
import { unusedPort } from "../../engine/test/support/browserWeb.ts"
import { makeFakeRunner } from "../../engine/test/support/fakeRunner.ts"
import { appendSetup, call, eventOf, freshRequest, harnessSettings, makeFakeSecrets, makeRig, ownerCredential, removeRig, seedAccount, seedAgent, success } from "../../engine/test/support/handlerRig.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"
test.describe.configure({ timeout: 120_000 })

// Build the production web root, authenticate through App, and navigate the
// actual project Git route. Shell owns the provider, watcher and Git session.
// The engine, cookie listener, redactor, SQL and Git remain real.
const git = (folder: string, ...args: string[]) => execFileSync("/usr/bin/git", ["-C", folder, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
const save = (folder: string, name: string, text: string) => writeFileSync(join(folder, name), text)
const commit = (folder: string, title: string) => { git(folder, "add", "--all"); git(folder, "commit", "-m", title); return git(folder, "rev-parse", "HEAD") }
interface Fixture { readonly base: string; readonly source: Workspace; readonly project: Project; readonly repository: Repository; readonly root: string }
async function withGit(page: Page, base: "main" | "master", prepare: (f: Fixture) => void, body: (f: Fixture) => Promise<void>, options: { readonly loseCommitReply?: boolean; readonly reportedFailure?: boolean } = {}) {
  const rig = makeRig(), previous = process.env.LGCODE_HOME
  process.env.LGCODE_HOME = rig.stateFolder
  const password = randomBytes(32).toString("base64url"), staticRoot = join(rig.root, "page"), port = await unusedPort()
  try {
    git(rig.work, "init", "-b", base); git(rig.work, "config", "user.name", "Browser Git fixture"); git(rig.work, "config", "user.email", "browser@example.invalid"); git(rig.work, "config", "commit.gpgsign", "false")
    save(rig.work, "file.txt", "base\n"); commit(rig.work, "Initial")
    await build({ configFile: false, root: new URL("..", import.meta.url).pathname, logLevel: "silent", build: { outDir: staticRoot } })
    const program = Effect.gen(function* () {
      const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
      const run = Effect.gen(function* () {
        yield* registerRebuildCheck(); yield* seedAccount("launch", "cursor")
        success(yield* call(ownerCredential, "harnesses", { operation: "set", harness: harnessSettings("cursor", { adapterPath: process.execPath, reportedModes: [{ id: "default", level: "ask" }] }) }))
        success(yield* call(ownerCredential, "accounts set-secret", { accountId: "launch", name: "CURSOR_API_KEY", nonce: "browser-git", value: Redacted.make("synthetic-browser-git-key") }))
        success(yield* call(ownerCredential, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "zsh" } }))
        const added = success(yield* call(ownerCredential, "project.repository.add", { name: "Real browser repository", path: rig.work, machineId: "local" }))
        success(yield* call(ownerCredential, "project.workspace.register", { repoId: added.repoId, path: rig.work, branch: base, machineId: "local", checkout: "main" }))
        const created = success(yield* call(ownerCredential, "project.create", { name: "Browser work", goal: "Prove the owned Git component", machineId: "local", repository: { _tag: "existing", repoId: added.repoId }, useWorktree: true }))
        const view = projectView(yield* (yield* Views).snapshot), project = view.projects[created.projectId]!, source = view.workspaces[project.worktreeId]!, repository = view.repositories[added.repoId]!
        const fixture: Fixture = { base: rig.work, source, project, repository, root: rig.root }
        prepare(fixture)
        if (options.reportedFailure) {
          const member = yield* seedAgent({ id: "browser-reviewer", parent: project.leadAgentId, folder: source.path })
          const [thread] = yield* appendSetup([eventOf({ _tag: "ThreadItem", agentId: member.agentId, itemId: "browser-report", content: { _tag: "text", text: "Reported browser review" }, replay: false })])
          for (const kind of ["tests", "review"] as const) success(yield* call(ownerCredential, "project.review.report", { projectId: project.projectId, worktreeId: source.worktreeId,
            head: git(source.path, "rev-parse", "HEAD"), kind, status: "failed", summary: "Reported failure <script>literal</script>", threadAgentId: member.agentId, threadSequence: thread!.sequence }))
        }
        yield* serve({ password: Redacted.make(password), staticRoot, lists: engineLists, settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: false } })
        yield* Effect.promise(async () => {
          const route = `http://127.0.0.1:${port}/#/project/${encodeURIComponent(project.projectId)}/git`
          await page.goto(route)
          await page.getByLabel("Password", { exact: true }).fill(password)
          await page.getByRole("button", { name: "Log in", exact: true }).click()
          await expect(page).toHaveURL(route)
          await expect(page.getByRole("tab", { name: "Git", exact: true })).toHaveAttribute("aria-selected", "true")
          await expect(page.locator("#view-body > .git-workspace")).toHaveCount(1)
          await expect(page.getByRole("region", { name: "Git", exact: true })).toBeVisible()
          await expect(page.getByRole("button", { name: "Refresh Git", exact: true })).toBeEnabled()
          await body(fixture)
        })
      })
      const redactor = makeRedactor({ secrets: () => [Redacted.make("synthetic-browser-git-key")], tokenHashes: () => new Set() })
      const dependencies = Layer.mergeAll(runner.layer, secrets.layer, redactor.layer)
      const real = buildServices(rig, engineLists).pipe(Layer.provide(dependencies))
      const services = Layer.effect(CommandHandler, Effect.gen(function* () {
        const handler = yield* CommandHandler; let lose = true
        return { ...handler, execute: (credential, name, payload) => {
          // TEMP-OBSERVE: fixed command family, exit and elapsed time only; no payload or error content.
          const observed = ["project.fetch", "project.pull", "project.push"].includes(name), started = performance.now()
          if (observed) console.info("TEMP-OBSERVE", JSON.stringify({ phase: "handler-call", operation: name, unixMs: Date.now() }))
          return handler.execute(credential, name, payload).pipe(Effect.onExit((exit) => Effect.sync(() => {
            if (observed) console.info("TEMP-OBSERVE", JSON.stringify({ phase: "handler-exit", operation: name, unixMs: Date.now(), durationMs: performance.now() - started, exit: exit._tag }))
          })), Effect.flatMap((reply) => {
            if (options.loseCommitReply && name === "project.commit" && lose) { lose = false; return Effect.fail(new LogWriteFailed({ reason: "database read failed" })) }
            return Effect.succeed(reply)
          }))
        } }
      })).pipe(Layer.provideMerge(real))
      yield* Effect.scoped(run).pipe(Effect.provide(services), Effect.provide(runner.layer))
    }).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped)
    await Effect.runPromise(program as Effect.Effect<void, unknown>)
  } finally {
    if (previous === undefined) delete process.env.LGCODE_HOME; else process.env.LGCODE_HOME = previous
    removeRig(rig)
  }
}
const refresh = async (page: Page) => { await page.getByRole("button", { name: "Refresh Git", exact: true }).click(); await expect(page.getByRole("button", { name: "Refresh Git", exact: true })).toBeEnabled() }
const file = (page: Page, name: string) => page.locator(".source-file").filter({ hasText: name })

test("Git: four widths, both themes and modes, scroll ownership, phone gutters, keyboard resize, drafts and history", async ({ page }, info) => {
  await withGit(page, "main", (f) => {
    mkdirSync(join(f.source.path, "src")); for (let n = 0; n < 70; n++) save(f.source.path, `src/file-${n}.txt`, Array.from({ length: 10 }, (_, i) => `row ${i} ${"long literal <script>data</script> ".repeat(n === 0 && i === 0 ? 200 : 2)}`).join("\n") + "\n")
    save(f.source.path, "tab\tname.txt", "tabbed file\n")
    // Exercise layout with indexed additions. The real untracked aggregate and
    // its process bounds have separate service regressions for issue 588.
    git(f.source.path, "add", "--all")
  }, async (f) => {
    const message = page.getByLabel("Commit message", { exact: true }); await message.fill("Preserve my workspace draft")
    await expect(page.locator(".source-file")).toHaveCount(71)
    for (const colorScheme of ["light", "dark"] as const) for (const width of [390, 768, 1440, 2560]) {
      await page.emulateMedia({ colorScheme }); await page.setViewportSize({ width, height: width === 390 ? 844 : 1100 })
      await page.getByRole("button", { name: "All files", exact: true }).click()
      await expect(page.locator(".diff-file")).toHaveCount(71)
      expect(await page.locator("#view-body > .git-workspace").evaluate((workspace) => {
        const parent = workspace.parentElement!, padding = getComputedStyle(parent), bounds = parent.getBoundingClientRect(), actual = workspace.getBoundingClientRect()
        return { padding: [padding.paddingTop, padding.paddingRight, padding.paddingBottom, padding.paddingLeft],
          maxWidth: getComputedStyle(workspace).maxWidth,
          fillsViewBody: [actual.left - bounds.left, actual.right - bounds.right, actual.top - bounds.top, actual.bottom - bounds.bottom].every((gap) => Math.abs(gap) < 1) }
      })).toEqual({ padding: ["0px", "0px", "0px", "0px"], maxWidth: "none", fillsViewBody: true })
      for (const mode of ["Unified", "Split"]) {
        await page.getByRole("button", { name: mode, exact: true }).click()
        await expect(page.getByRole("button", { name: mode, exact: true })).toHaveAttribute("aria-pressed", "true")
        await expect(message).toHaveValue("Preserve my workspace draft")
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        const split = page.locator(".split-diff")
        // The worktree list can fold away; the real Shell and persisted changes
        // pane determine the width available to the comparison.
        const availableDiffWidth = await page.locator(".git-workspace").evaluate((workspace) => workspace.clientWidth
          - workspace.querySelector(".git-changes")!.getBoundingClientRect().width
          - workspace.querySelector(".git-resize")!.getBoundingClientRect().width)
        if (mode === "Split" && availableDiffWidth >= 900) {
          await expect(split.first()).toBeVisible()
          expect(await page.locator(".diff-content").evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThanOrEqual(900)
          expect(await split.first().evaluate((element) => {
            const cells = [...element.querySelectorAll<HTMLElement>(":scope > .diff-line")]
            return cells.length % 2 === 0 && cells.every((cell, i) => i % 2 !== 0 || Math.abs(cell.getBoundingClientRect().top - cells[i + 1]!.getBoundingClientRect().top) < 1)
          })).toBe(true)
        } else {
          await expect(page.locator(".unified-diff").first()).toBeVisible()
          if (mode === "Split") await expect(page.locator("#split-note")).toContainText("Showing unified.")
        }
      }
      if (width === 390) {
        await page.getByRole("button", { name: "This file", exact: true }).click(); await file(page, "file-4.txt").click()
        await expect(page.locator(".diff-content")).toBeFocused()
        expect(await page.locator(".diff-content").evaluate((element) => element.getBoundingClientRect().top < innerHeight - 100)).toBe(true)
        await expect(page.locator("#diff-path")).toHaveText("src/file-4.txt")
        await expect(page.locator(".diff-file")).toHaveCount(1)
        const row = page.locator(".unified-diff .diff-line.added").filter({ hasText: "row 4 long literal" }).first()
        await expect(row.locator("code")).toContainText("row 4 long literal <script>data</script>")
        await expect(row.locator(".line-one")).toBeVisible()
        await expect(row.locator(".line-one")).toHaveAttribute("data-phone-number", "5")
        expect(await row.locator(".line-one").evaluate((gutter) => {
          const number = getComputedStyle(gutter, "::after")
          return { size: number.fontSize, content: number.content, second: getComputedStyle(gutter.nextElementSibling!).display }
        })).toEqual({ size: "12px", content: '"5"', second: "none" })
        await expect(row.locator(".line-two")).toBeHidden()
      } else {
        const body = page.locator(".git-pane-body"), diff = page.locator(".diff-content")
        const top = await page.locator(".git-pane-head").boundingBox(), foot = await page.locator(".git-integration").boundingBox()
        await body.evaluate((element) => { element.scrollTop = element.scrollHeight })
        expect(await page.locator(".git-pane-head").boundingBox()).toEqual(top); expect(await page.locator(".git-integration").boundingBox()).toEqual(foot)
        const before = await body.evaluate((element) => element.scrollTop)
        await diff.evaluate((element) => { element.scrollTop = 400 })
        expect(await body.evaluate((element) => element.scrollTop)).toBe(before)
        if (width > 900) {
          const resize = page.getByRole("separator", { name: "Resize the commit pane" })
          await resize.focus(); const previous = Number(await resize.getAttribute("aria-valuenow")); await resize.press("ArrowRight")
          expect(Number(await resize.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(previous)
        }
      }
      await page.screenshot({ path: info.outputPath(`git-${colorScheme}-${width}.png`), fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 1100 }); await page.getByRole("button", { name: "History", exact: true }).click()
    await page.locator("[data-source-commit]").first().click(); await expect(message).toBeDisabled(); await expect(page.getByRole("button", { name: "Push", exact: true })).toBeDisabled()
    await page.getByRole("button", { name: "Back to changes", exact: true }).click(); await expect(message).toHaveValue("Preserve my workspace draft")
    expect(git(f.source.path, "rev-list", "--count", "HEAD")).toBe("1")
  })
})

for (const base of ["main", "master"] as const) test(`Git: actual owner prepares, reviews and approves ${base}; dialog focus and real destination bytes`, async ({ page }) => {
  await withGit(page, base, (f) => { save(f.source.path, "feature.txt", "review these actual bytes\n"); commit(f.source.path, "Feature <script>literal</script>") }, async (f) => {
    const original = git(f.base, "rev-parse", "HEAD"), expected = git(f.source.path, "rev-parse", "HEAD")
    const opener = page.getByRole("button", { name: `Review merge to ${base}`, exact: true }); await expect(opener).toBeEnabled(); await opener.click()
    const dialog = page.getByRole("dialog", { name: `Review merge to ${base}`, exact: true })
    await expect(dialog).toContainText("review these actual bytes"); await expect(dialog).toContainText(expected); await expect(dialog).toContainText(original)
    await expect(dialog).toContainText("No reported evidence"); expect(git(f.base, "rev-parse", "HEAD")).toBe(original)
    await expect(dialog.getByRole("radio", { name: "Approve without evidence", exact: true })).toBeChecked()
    const approve = dialog.getByRole("button", { name: "Approve without evidence", exact: true }); await expect(approve).toBeEnabled()
    await page.keyboard.press("Tab"); expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused()
    await page.getByRole("button", { name: "Inspect recorded review", exact: true }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Approve without evidence", exact: true }).click()
    await expect(page.getByRole("dialog")).toContainText("Merged. Destination head:")
    expect(git(f.base, "rev-parse", "HEAD")).toBe(expected); expect(readFileSync(join(f.base, "feature.txt"), "utf8")).toBe("review these actual bytes\n")
    await expect(page.locator("script:not([src])")).toHaveCount(0)
  })
})

test("Git: actual bulk stage/unstage, stale discard and a real literal rename commit", async ({ page }) => {
  await withGit(page, "main", (f) => { renameSync(join(f.source.path, "file.txt"), join(f.source.path, "tab\trenamed.txt")); git(f.source.path, "add", "--all"); save(f.source.path, "new.txt", "new <script>data</script>\n") }, async (f) => {
    await expect(page.locator(".git-rename")).toContainText("file.txt")
    await page.getByRole("button", { name: "Unstage all", exact: true }).click(); await expect.poll(() => git(f.source.path, "diff", "--cached", "--name-only")).toBe("")
    await page.getByRole("button", { name: "Discard", exact: true }).click(); await expect(page.getByRole("dialog")).toBeVisible()
    save(f.source.path, "new.txt", "later edit stays\n"); await page.getByRole("button", { name: "Confirm discard", exact: true }).click()
    await expect(page.locator(".git-pane-head")).toContainText("state changed"); expect(readFileSync(join(f.source.path, "new.txt"), "utf8")).toBe("later edit stays\n")
    await page.getByRole("button", { name: "Stage all", exact: true }).click(); await expect(page.getByRole("button", { name: "Commit 2 files", exact: true })).toBeDisabled()
    await page.getByLabel("Commit message", { exact: true }).fill("Real rename and later edit")
    await page.getByRole("button", { name: "Commit 2 files", exact: true }).click()
    await expect(page.locator("#git-notice")).toContainText("Committed ")
    expect(git(f.source.path, "log", "-1", "--format=%B")).toBe("Real rename and later edit"); expect(git(f.source.path, "status", "--porcelain")).toBe("")
  })
})

test("Git: stale reviewed heads refuse honestly and a new review binds the new pair", async ({ page }) => {
  await withGit(page, "main", (f) => { save(f.source.path, "feature", "feature\n"); commit(f.source.path, "Feature") }, async (f) => {
    await page.getByRole("button", { name: "Review merge to main", exact: true }).click(); await expect(page.getByRole("button", { name: "Approve without evidence", exact: true })).toBeEnabled()
    const base = git(f.base, "rev-parse", "HEAD"); save(f.source.path, "later", "new head\n"); commit(f.source.path, "Later")
    await page.getByRole("button", { name: "Approve without evidence", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("Merge refused.")
    expect(git(f.base, "rev-parse", "HEAD")).toBe(base)
    await page.getByRole("button", { name: "Prepare a new review", exact: true }).click(); await expect(page.getByRole("button", { name: "Approve without evidence", exact: true })).toBeEnabled()
    await expect(page.getByRole("dialog")).toContainText(git(f.source.path, "rev-parse", "HEAD"))
  })
})

test("Git: genuine conflict choices preview, cancel, resolve, and allow a no-delta merge commit", async ({ page }) => {
  await withGit(page, "main", (f) => {
    save(f.source.path, "file.txt", "ours\n"); commit(f.source.path, "Ours"); save(f.base, "file.txt", "theirs\n"); commit(f.base, "Theirs")
    try { git(f.source.path, "merge", "--no-edit", "main") } catch { /* Real conflicting merge. */ }
  }, async (f) => {
    const original = readFileSync(join(f.source.path, "file.txt"), "utf8")
    await expect(page.locator(".conflict-hunk")).toHaveCount(1); await expect(page.locator(".conflict-side.base")).toContainText("base")
    await page.getByRole("button", { name: "Keep both", exact: true }).click(); await expect(page.locator(".conflict-preview")).toContainText("ours\ntheirs")
    expect(readFileSync(join(f.source.path, "file.txt"), "utf8")).toBe(original)
    await page.getByRole("button", { name: "Cancel choices", exact: true }).click(); await expect(page.getByRole("button", { name: "Use ours", exact: true })).toBeEnabled()
    await expect(page.locator(".is-chosen")).toHaveCount(0); expect(readFileSync(join(f.source.path, "file.txt"), "utf8")).toBe(original)
    await page.getByRole("button", { name: "Use ours", exact: true }).click(); await page.getByRole("button", { name: "Mark resolved", exact: true }).click()
    await expect(page.locator("#git-notice")).toContainText("Conflict resolved."); expect(git(f.source.path, "ls-files", "--unmerged")).toBe("")
    expect(readFileSync(join(f.source.path, "file.txt"), "utf8")).toBe("ours\n")
    await page.getByLabel("Commit message", { exact: true }).fill("Finish actual merge")
    await page.getByRole("button", { name: "Commit", exact: true }).click(); await expect(page.locator("#git-notice")).toContainText("Committed ")
    expect(git(f.source.path, "log", "-1", "--format=%P").split(" ")).toHaveLength(2)
  })
})

test("Git: current failed and then stale reported evidence remains data, and the owner can explicitly approve", async ({ page }) => {
  await withGit(page, "master", (f) => { save(f.source.path, "feature", "feature\n"); commit(f.source.path, "Feature") }, async (f) => {
    await page.getByRole("button", { name: "Review merge to master", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.locator(".merge-evidence")).toContainText("Failed"); await expect(dialog.locator(".merge-evidence")).toContainText("This is reported data.")
    await expect(dialog.locator(".merge-evidence a").first()).toHaveAttribute("href", "/#/thread/browser-reviewer")
    await expect(dialog.getByRole("radio", { name: "Approve without evidence", exact: true })).toBeChecked()
    save(f.source.path, "after-report", "stale evidence must stay visible\n"); const head = commit(f.source.path, "After report")
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    await refresh(page)
    await page.getByRole("button", { name: "Inspect recorded review", exact: true }).click()
    await expect(dialog.getByRole("button", { name: "Prepare a new review", exact: true })).toBeEnabled()
    await dialog.getByRole("button", { name: "Prepare a new review", exact: true }).click(); await expect(dialog.locator(".merge-evidence")).toContainText("Stale report")
    await dialog.getByRole("radio", { name: "Approve", exact: true }).check()
    await dialog.getByRole("button", { name: "Approve merge to master", exact: true }).click(); await expect(dialog).toContainText("Merged. Destination head:")
    expect(git(f.base, "rev-parse", "HEAD")).toBe(head)
  }, { reportedFailure: true })
})

test("Git: a typed lost reply refreshes to terminal uncertainty without replay or clearing the next draft", async ({ page }) => {
  await withGit(page, "main", (f) => { save(f.source.path, "file.txt", "commit this once\n") }, async (f) => {
    await page.getByRole("button", { name: "Stage all", exact: true }).click()
    await page.getByLabel("Commit message", { exact: true }).fill("Original receipt body")
    await page.getByRole("button", { name: "Commit 1 file", exact: true }).click()
    await expect(page.locator(".git-workspace [role=alert]")).toContainText("does not establish")
    expect(git(f.source.path, "rev-list", "--count", "HEAD")).toBe("2")
    await expect(page.locator("#git-notice")).toHaveCount(0)
    await page.getByLabel("Commit message", { exact: true }).fill("Keep the next draft")
    await expect(page.getByRole("button", { name: "Push", exact: true })).toBeEnabled()
    await expect(page.locator("#git-notice")).toHaveCount(0)
    expect(git(f.source.path, "rev-list", "--count", "HEAD")).toBe("2"); expect(git(f.source.path, "log", "-1", "--format=%B")).toBe("Original receipt body")
    await expect(page.getByLabel("Commit message", { exact: true })).toHaveValue("Keep the next draft")
  }, { loseCommitReply: true })
})

test("Git: a dirty destination remains inspectable and does not change the assigned execution worktree", async ({ page }) => {
  await withGit(page, "main", (f) => { save(f.source.path, "feature", "feature\n"); commit(f.source.path, "Feature"); save(f.base, "dirty", "preserve this base edit\n") }, async (f) => {
    await expect(page.getByRole("button", { name: "Review merge to main", exact: true })).toBeDisabled()
    await expect(page.locator(".integration-state")).toContainText("destination has uncommitted")
    await page.getByRole("button", { name: "Inspect destination", exact: true }).click()
    await expect(page.locator(".git-pane-head h2")).toHaveText("Main checkout"); await expect(page.locator(".git-inspecting")).toContainText(`Assigned: ${f.source.branch}`)
    await expect(file(page, "dirty")).toBeVisible(); expect(readFileSync(join(f.base, "dirty"), "utf8")).toBe("preserve this base edit\n")
    unlinkSync(join(f.base, "dirty")); await refresh(page)
  })
})

test("Git: an unsupported newline path stays literal, refuses safely and preserves bytes", async ({ page }) => {
  const name = "newline\nname.txt"
  await withGit(page, "main", (f) => { save(f.source.path, name, "preserve literal newline name\n") }, async (f) => {
    await expect(page.locator(".source-file")).toContainText("newline\\nname.txt")
    await page.getByRole("button", { name: "Stage newline\\nname.txt", exact: true }).click()
    await expect(page.locator(".git-pane-head")).toContainText("Git refused this path")
    await expect(page.getByRole("button", { name: "Refresh Git", exact: true })).toBeEnabled()
    expect(git(f.source.path, "diff", "--cached", "--name-only")).toBe("")
    expect(readFileSync(join(f.source.path, name), "utf8")).toBe("preserve literal newline name\n")
    expect(git(f.source.path, "rev-list", "--count", "HEAD")).toBe("1")
  })
})

test("Git: fetch, fast-forward pull and push use only the owned temporary remote", async ({ page }) => {
  await withGit(page, "main", (f) => {
    const remote = join(f.root, "remote.git"), other = join(f.root, "other-clone")
    execFileSync("/usr/bin/git", ["init", "--bare", remote], { stdio: "pipe" })
    git(f.source.path, "remote", "add", "origin", remote); git(f.source.path, "push", "-u", "origin", f.source.branch)
    execFileSync("/usr/bin/git", ["clone", "--branch", f.source.branch, remote, other], { stdio: "pipe" })
    git(other, "config", "user.name", "Temporary remote writer"); git(other, "config", "user.email", "temporary@example.invalid"); git(other, "config", "commit.gpgsign", "false")
    save(other, "incoming.txt", "actual remote bytes\n"); commit(other, "Incoming"); git(other, "push", "origin", f.source.branch)
  }, async (f) => {
    await page.getByRole("button", { name: "Fetch", exact: true }).click(); await expect(page.locator("#git-sync-state")).toContainText("1 incoming")
    await page.getByRole("button", { name: "Pull", exact: true }).click(); await expect(page.locator("#git-sync-state")).toContainText("0 incoming")
    expect(readFileSync(join(f.source.path, "incoming.txt"), "utf8")).toBe("actual remote bytes\n")
    save(f.source.path, "outgoing.txt", "actual outgoing bytes\n"); await refresh(page)
    await page.getByRole("button", { name: "Stage all", exact: true }).click(); await page.getByLabel("Commit message", { exact: true }).fill("Outgoing")
    await page.getByRole("button", { name: "Commit 1 file", exact: true }).click(); await expect(page.locator("#git-sync-state")).toContainText("1 outgoing")
    try {
      await page.getByRole("button", { name: "Push", exact: true }).click(); await expect(page.locator("#git-sync-state")).toContainText("0 outgoing")
    } finally {
      // TEMP-OBSERVE: bounded fixed UI flags and parsed counts, never DOM text or protected data.
      console.info("TEMP-OBSERVE", JSON.stringify(await page.evaluate(() => {
        const counts = /^(\d+) incoming · (\d+) outgoing/.exec(document.querySelector("#git-sync-state")?.textContent ?? "")
        const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")]
        return { phase: "push-assertion-end", unixMs: Date.now(), incoming: counts ? Number(counts[1]) : null, outgoing: counts ? Number(counts[2]) : null,
          pushAcknowledged: document.querySelector("#git-notice")?.textContent === "push completed.", hasAlert: !!document.querySelector(".git-workspace [role=alert]"),
          pushDisabled: buttons.find((button) => button.textContent === "Push")?.disabled,
          refreshing: buttons.some((button) => button.textContent === "Refreshing…") }
      }).catch(() => ({ phase: "push-assertion-end", uiUnavailable: true }))))
    }
    expect(git(join(f.root, "remote.git"), "rev-parse", `refs/heads/${f.source.branch}`)).toBe(git(f.source.path, "rev-parse", "HEAD"))
    expect(git(join(f.root, "remote.git"), "show", `${f.source.branch}:outgoing.txt`)).toBe("actual outgoing bytes")
  })
})
