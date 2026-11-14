import { randomBytes } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Page } from "@playwright/test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as SqliteClient from "../../../../third_party/t3code/node-sqlite/src/nodeSqliteClient.ts"
import { buildServices } from "../../../engine/src/service.ts"
import { serve } from "../../../engine/src/client/web/server.ts"
import { engineLists } from "../../../engine/src/pieces/lists.ts"
import { refused, type Input } from "../../../engine/src/commands/internal.ts"
import { Views } from "../../../engine/src/views/Views.ts"
import { projectView } from "../../../engine/src/project/view.ts"
import { Redactor } from "../../../engine/src/log/Redactor.ts"
import { unusedPort } from "../../../engine/test/support/browserWeb.ts"
import { makeFakeRunner } from "../../../engine/test/support/fakeRunner.ts"
import { call, makeFakeSecrets, makeRig, ownerCredential, removeRig, success } from "../../../engine/test/support/handlerRig.ts"
import { screenBundle, seedScreens } from "../../../engine/test/project/mockScreenFixtures.ts"
import { buildStudio } from "../../../studio/scripts/build.ts"
import { completedSetup } from "./completedSetup.ts"

export async function exerciseStudioMocks(page: Page) {
  const rig = makeRig(), previous = process.env.LGTM_HOME
  process.env.LGTM_HOME = rig.stateFolder
  const password = randomBytes(32).toString("base64url"), port = await unusedPort()
  let releaseComment!: () => void, rejectComment = false
  const heldComment = new Promise<void>((resolve) => { releaseComment = resolve })
  const lists = { ...engineLists, planners: { ...engineLists.planners,
    "project.mocks.comment": (input: Input, payload: Record<string, unknown>) => rejectComment
      ? Effect.fail(refused("mock revision changed; refresh and retry"))
      : Effect.promise(() => heldComment).pipe(Effect.andThen(engineLists.planners["project.mocks.comment"]!(input, payload)))
  } }
  await page.setViewportSize({ width: 1600, height: 1000 })
  try {
    const studioRoot = await buildStudio(join(rig.root, "studio")), staticRoot = join(rig.root, "web")
    mkdirSync(staticRoot); writeFileSync(join(staticRoot, "index.html"), "<title>Test</title>")
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const runner = yield* makeFakeRunner()
      const dependencies = Layer.mergeAll(runner.layer, makeFakeSecrets().layer, Layer.succeed(Redactor, { redact: (e) => Effect.succeed(e), redactText: (s) => Effect.succeed(s) }))
      yield* Effect.scoped(Effect.gen(function* () {
        const f = yield* seedScreens(rig)
        yield* completedSetup("project" as never)
        const original = JSON.stringify({ version: "2.8", children: [] })
        const edited = JSON.stringify({ version: "2.8", children: [], name: "Edited document from OpenPencil" })
        writeFileSync(join(rig.work, "mocks/layout.pen"), original)
        const designRevision = success(yield* call(ownerCredential, "project.design.record", { projectId: "project", design: { repoId: f.repoId, worktreeId: "workspace", file: "mocks/layout.pen", components: [] } })).revisionId
        const revisionId = success(yield* call(ownerCredential, "project.mocks.record", { projectId: "project", expectedRevision: f.revisionId, bundle: { ...screenBundle(), designRevision } })).revisionId
        yield* serve({ password: Redacted.make(password), staticRoot, studioRoot, lists, settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: false } })
        yield* Effect.promise(async () => {
          const origin = `http://127.0.0.1:${port}/studio/`, screen = origin + "#/p/project/mocks/screen/home"
          await page.goto(screen); await page.locator("#login-password").fill(password)
          await page.getByRole("button", { name: "Sign in", exact: true }).click()
          await expect(page.locator("#login-password")).toHaveCount(0)
          await page.goto(screen)
          const comment = '<script>plain owner comment</script> $(touch escaped) ../../outside'
          await page.getByRole("textbox", { name: "Comment", exact: true }).fill(comment)
          await page.locator(".mk-say").getByRole("button", { name: "Send", exact: true }).click()
          await expect(page.getByRole("button", { name: "Sending…", exact: true })).toBeDisabled()
          await expect(page.locator(".mk-comments ol")).not.toContainText(comment)
          releaseComment()
          await expect(page.locator(".mk-comments ol")).toContainText(comment)
          await expect(page.locator(".mk-comments ol script")).toHaveCount(0)
          await page.reload()
          await expect(page.locator(".mk-comments ol")).toContainText(comment)
          rejectComment = true
          await page.getByRole("textbox", { name: "Comment", exact: true }).fill("Refused comment")
          await page.locator(".mk-say").getByRole("button", { name: "Send", exact: true }).click()
          await expect(page.getByText("mock revision changed; refresh and retry", { exact: true })).toBeVisible()
          await expect(page.locator(".mk-comments ol")).not.toContainText("Refused comment")
          await expect(page.getByRole("textbox", { name: "Comment", exact: true })).toHaveValue("Refused comment")
          await page.getByRole("button", { name: "Approve", exact: true }).click()
          await expect(page.getByRole("button", { name: "Withdraw approval", exact: true })).toBeEnabled()
          await page.getByRole("button", { name: "Withdraw approval", exact: true }).click()
          await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeEnabled()
          await page.goto(origin + "#/p/project/mocks/changes")
          await page.getByRole("button", { name: "Mark seen", exact: true }).click()
          await expect(page.getByRole("button", { name: "Mark seen", exact: true })).toHaveCount(0)
          await expect(page.locator(".mk-changes .badge.warn")).toHaveCount(0)
          await page.reload()
          await expect(page.locator(".mk-changes")).toContainText(revisionId)
          await expect(page.locator(".mk-changes .badge.warn")).toHaveCount(0)
          await page.goto(screen)
          await page.locator('input[type="file"][aria-label="Editor export"]').setInputFiles({ name: "owner-export.pen", mimeType: "application/octet-stream", buffer: Buffer.from(edited) })
          const confirmation = page.getByRole("dialog")
          await expect(confirmation).toContainText("The project returns to Design and its overall approval is withdrawn.")
          expect(readFileSync(join(rig.work, "mocks/layout.pen"), "utf8")).toBe(original)
          await confirmation.getByRole("button", { name: "Save changes", exact: true }).click()
          await expect(page.getByText("Editor changes saved", { exact: true })).toBeVisible()
          expect(readFileSync(join(rig.work, "mocks/layout.pen"), "utf8")).toBe(edited)
          await expect(page.locator(".mk-comments ol")).toContainText(comment)
          await expect(page.locator(".mk-comments ol")).toContainText("Revision " + revisionId)
          await expect(page.locator(".mk-stagebar")).not.toContainText(revisionId)
          await page.goto(origin + "#/p/project/mocks/changes")
          await expect(page.locator(".mk-changes .badge.warn")).toHaveCount(1)
          await expect(page.getByRole("button", { name: "Mark seen", exact: true })).toBeVisible()
        })
        const state = projectView(yield* (yield* Views).snapshot)
        expect(state.projects.project?.stage).toBe("design")
        expect(Object.values(state.mockApprovals)).toEqual([])
        expect(Object.values(state.mockScreenReviews).flatMap((r) => r.comments)).toHaveLength(1)
        expect(Object.values(state.mockScreenReviews).find((r) => r.revisionId === revisionId && r.screenId === "home")?.approval?.approved).toBe(false)
      })).pipe(Effect.provide(buildServices(rig, lists).pipe(Layer.provide(dependencies))), Effect.provide(runner.layer))
    })).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped) as Effect.Effect<void, unknown, never>)
  } finally {
    releaseComment()
    if (previous === undefined) delete process.env.LGTM_HOME; else process.env.LGTM_HOME = previous
    removeRig(rig)
  }
}
