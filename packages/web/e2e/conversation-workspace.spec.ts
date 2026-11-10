import { randomBytes } from "node:crypto"
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import type { ClientRequest } from "@lgcode/contracts"
import { build } from "vite"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as SqliteClient from "../../../third_party/t3code/node-sqlite/src/nodeSqliteClient.ts"
import { serve } from "../../engine/src/client/web/server.ts"
import { buildServices } from "../../engine/src/service.ts"
import { engineLists } from "../../engine/src/pieces/lists.ts"
import { Redactor } from "../../engine/src/log/Redactor.ts"
import { unusedPort } from "../../engine/test/support/browserWeb.ts"
import { incarnationOf, makeFakeRunner } from "../../engine/test/support/fakeRunner.ts"
import { agentCredential, appendSetup, call, eventOf, freshRequest, makeFakeSecrets, makeRig, ownerCredential, readLog, removeRig, seedAccount, seedHarness, startPayload, success } from "../../engine/test/support/handlerRig.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"
import { openNavigation } from "./support/navigation.ts"

// Production page, authenticated HTTP/WebSocket transport, handlers and database.
// The external harness and secret store are controlled test doubles. The
// WebSocket fault below drops an actual server receipt; it invents no result.
test("conversations retain drafts, real context, delivery and owner peek across page/dock and responsive views", async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const rig = makeRig(), previousHome = process.env.LGCODE_HOME
  process.env.LGCODE_HOME = rig.stateFolder
  const password = randomBytes(32).toString("base64url"), staticRoot = join(rig.root, "page")
  const git = (...args: string[]) => execFileSync("/usr/bin/git", ["-C", rig.work, ...args], { stdio: "pipe" })
  let dropPrompt = false, dropAnswer = false, dropLargeRead: number | undefined, dropped = false
  const promptFrames: Array<{ requestId: string; text: string; context?: unknown }> = []
  const answerFrames: Array<{ requestId: string; kind: string; id: string; optionId?: string }> = []
  const largeMarkers: Array<{ sequence: number; agentId?: string; tag: string }> = []
  await page.addInitScript(() => {
    const sockets: globalThis.WebSocket[] = []
    Object.assign(window, { __conversationSockets: sockets })
    window.WebSocket = new Proxy(window.WebSocket, { construct(target, args) {
      const socket = Reflect.construct(target, args) as globalThis.WebSocket
      sockets.push(socket); return socket
    } })
  })
  await page.routeWebSocket((url) => url.pathname === "/api", (socket) => {
    const server = socket.connectToServer()
    let receipt: string | undefined
    socket.onMessage((message) => {
      const raw = JSON.parse(message.toString())
      for (const frame of Array.isArray(raw) ? raw : [raw]) if (frame._tag === "Request") {
        if (frame.tag === "prompt") promptFrames.push(frame.payload)
        if (frame.tag === "answer") answerFrames.push(frame.payload)
        if (dropPrompt && frame.tag === "prompt" || dropAnswer && frame.tag === "answer"
          || dropLargeRead !== undefined && frame.tag === "client.event" && frame.payload.sequence === dropLargeRead) receipt = String(frame.id)
      }
      server.send(message)
    })
    server.onMessage((message) => {
      const raw = JSON.parse(message.toString()), frames = Array.isArray(raw) ? raw : [raw]
      for (const frame of frames) if (frame._tag === "Chunk") for (const item of frame.values ?? []) {
        if (item._tag === "client.Oversized") largeMarkers.push(item)
      }
      if (receipt !== undefined && frames.some((frame) => frame._tag === "Exit" && String(frame.requestId) === receipt)) {
        dropped = true
        void socket.close({ code: 4000, reason: "Controlled lost receipt" })
      } else socket.send(message)
    })
  })
  try {
    git("init", "-b", "main"); git("config", "user.name", "Conversation Test"); git("config", "user.email", "conversation@example.test"); git("config", "commit.gpgsign", "false")
    writeFileSync(join(rig.work, "reference.txt"), "FILE-BODY-MUST-NOT-BE-INLINED\n")
    git("add", "reference.txt"); git("commit", "-m", "Fixture")
    await build({ configFile: false, root: new URL("..", import.meta.url).pathname, logLevel: "silent", build: { outDir: staticRoot } })
    const port = await unusedPort(), origin = `http://127.0.0.1:${port}`
    const program = Effect.gen(function* () {
      const runner = yield* makeFakeRunner()
      runner.script("choices", () => Effect.succeed({ models: { source: "negotiated", options: [{ id: "model-a", label: "Model A" }, { id: "model-b", label: "Model B" }] }, efforts: { source: "negotiated", options: [{ id: "low" }, { id: "high" }] } }))
      runner.script("context", () => Effect.succeed({ _tag: "available", used: 25, window: 100, percent: 25, reportedAt: Date.now(), model: "model-a" }))
      runner.script("cancel", (input) => runner.emitRaw({ _tag: "turnEnded", ...input,
        incarnation: incarnationOf(Redacted.value(runner.callsOf("start").find((row) => row.input.agentId === input.agentId)!.input.token)), stopped: true }))
      const run = Effect.gen(function* () {
        yield* registerRebuildCheck(); yield* seedHarness(); yield* seedAccount()
        const lead = success(yield* call(ownerCredential, "start", startPayload(rig, { name: "Project lead" })))
        const leadToken = runner.callsOf("start").find((row) => row.input.agentId === lead.agentId)!.input.token
        const worker = success(yield* call(agentCredential(Redacted.value(leadToken)), "start", startPayload(rig, { name: "Conversation worker" })))
        success(yield* call(ownerCredential, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "sh" } }))
        const repoId = success(yield* call(ownerCredential, "project.repository.add", { name: "Conversation repository", path: rig.work, machineId: "local" })).repoId
        const worktreeId = success(yield* call(ownerCredential, "project.workspace.register", { repoId, machineId: "local", branch: "main", path: rig.work, checkout: "main" })).worktreeId
        const projectId = `conversation-${freshRequest()}`
        // Historical project membership enters through the typed event writer.
        // New teams, tasks, posts and all browser mutations use real handlers.
        yield* appendSetup([eventOf({ _tag: "project.Created", projectId, repoId, worktreeId, leadAgentId: lead.agentId, machineId: "local", name: "Conversation project", goal: "Keep real conversation state" })])
        const team = success(yield* call(ownerCredential, "project.team.create", { projectId, worktreeId, name: "Build team" }))
        success(yield* call(ownerCredential, "group", { agentId: worker.agentId, add: [team.group], remove: [] }))
        const sprintId = success(yield* call(ownerCredential, "project.sprint.create", { projectId, label: "SP-1", name: "Conversation", goal: "", phase: "Build", owner: lead.agentId, needs: [] })).sprintId
        const taskId = success(yield* call(ownerCredential, "project.task.create", { projectId, worktreeId, teamId: team.teamId, sprintId, owner: worker.agentId, state: "active", label: "TASK-1", title: "Attach actual identities" })).taskId
        success(yield* call(ownerCredential, "board.post", { channelId: team.channelId, text: "Existing team message <b>literal</b>", to: [], reply: "none" }))
        yield* serve({ password: Redacted.make(password), staticRoot, lists: engineLists, settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: false } })
        const thread = `${origin}/#/thread/${worker.agentId}`
        const teamHref = `/#/project/${projectId}/team/${team.teamId}/chat`
        const navigate = (hash: string) => page.evaluate((next) => { history.pushState(null, "", next); window.dispatchEvent(new PopStateEvent("popstate")) }, hash)
        const { current, permissionId } = yield* Effect.promise(async () => {
          await page.goto(thread); await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Log in", exact: true }).click()
          const input = page.getByRole("textbox", { name: /^Message (Conversation worker|Project lead)$/ })
          await expect(input).toBeVisible()
          await input.fill("worker draft"); await navigate(`/#/thread/${lead.agentId}`)
          await input.fill("lead draft"); await navigate(`/#/thread/${worker.agentId}`); await expect(input).toHaveValue("worker draft")
          await input.fill("See @"); await expect(page.getByRole("dialog", { name: "Add context", exact: true })).toBeVisible()
          await page.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(input).toHaveValue("See @")
          await input.fill("Use these identities"); await page.getByRole("button", { name: "Add context", exact: true }).click()
          const dialog = page.getByRole("dialog", { name: "Add context", exact: true })
          await dialog.getByRole("checkbox", { name: /TASK-1/ }).check(); await dialog.getByRole("checkbox", { name: /reference.txt/ }).check()
          await dialog.getByRole("button", { name: "Add selected context", exact: true }).click()
          await input.press("Shift+Enter"); await expect(input).toHaveValue("Use these identities\n")
          await input.press("Enter"); await expect(input).toHaveValue("")
          await expect(page.getByRole("article", { name: "Outgoing delivery" }).filter({ hasText: "Use these identities" })).toContainText("reference.txt")
          await expect.poll(() => runner.callsOf("prompt").filter((row) => row.input.agentId === worker.agentId).length).toBe(1)
          const sent = runner.callsOf("prompt").find((row) => row.input.agentId === worker.agentId)!.input.delivery
          expect(sent.content).toMatchObject({ _tag: "prompt", context: [{ _tag: "task", projectId, taskId }, { _tag: "file", projectId, repoId, worktreeId, path: "reference.txt" }] })
          expect(JSON.stringify(sent.content)).not.toContain("FILE-BODY-MUST-NOT-BE-INLINED")
          await page.getByRole("button", { name: "Model", exact: true }).click()
          await page.getByRole("menuitemradio", { name: "Model B", exact: true }).click()
          await expect(page.getByLabel("Agent configuration", { exact: true })).toContainText("Desired model: model-b")
          await expect(page.getByLabel("Agent configuration", { exact: true })).toContainText("25% context")
          await page.getByRole("button", { name: "Stop reply", exact: true }).click()
          await expect.poll(() => runner.callsOf("cancel").length).toBe(1)
          await expect(page.getByText("Reply stopped.", { exact: true })).toBeVisible()
          await input.fill("Next prompt survives cancellation"); await input.press("Enter")
          await expect.poll(() => runner.callsOf("prompt").filter((row) => row.input.agentId === worker.agentId).length).toBe(2)
          expect(runner.callsOf("stop")).toHaveLength(0)
          await input.fill("Unsure message"); dropPrompt = true; await input.press("Enter")
          await expect.poll(() => dropped).toBe(true)
          await expect(page.getByRole("button", { name: "Recover original send", exact: true })).toBeVisible()
          // Exhaust the accepted client's three real transport attempts, then
          // restore delivery for the owner's explicit same-key recovery.
          dropPrompt = false
          await input.fill("Newer unsent draft"); await navigate(teamHref); await expect(page.getByLabel("Team conversation", { exact: true })).toContainText("Existing team message <b>literal</b>")
          await navigate(`/#/thread/${worker.agentId}`); await expect(input).toHaveValue("Newer unsent draft")
          await page.getByRole("button", { name: "Recover original send", exact: true }).click()
          await expect(page.getByText("Prompt sent.", { exact: true })).toBeVisible(); await expect(input).toHaveValue("Newer unsent draft")
          const original = promptFrames.filter((row) => row.text === "Unsure message")
          expect(original).toHaveLength(4); expect(original.every((row) => JSON.stringify(row) === JSON.stringify(original[0]))).toBe(true)

          const current = runner.callsOf("prompt").filter((row) => row.input.agentId === worker.agentId).at(-1)!.input
          const permissionId = "browser-conversation-permission"
          const command = `printf '${String.fromCodePoint(0x202e)} literal command' ${"visible-argument ".repeat(200)}END-OF-COMMAND`
          await Effect.runPromise(runner.emitRaw({ _tag: "permissionRequested", agentId: worker.agentId, incarnation: current.incarnation,
            deliveryId: current.delivery.id, permissionRequestId: permissionId, toolCallId: "conversation-tool",
            description: "Run the review trace", toolKind: "execute", settingsWrite: false,
            toolInput: { command, cwd: rig.work, path: "<b>literal-path</b>" },
            options: [{ id: "once", name: "Allow once", persistent: false, kind: "allow_once", level: "ask" },
              { id: "deny", name: "Deny", persistent: false, kind: "reject_once", level: "read-only" }] }))
          const permission = page.locator(`[data-request-id="${permissionId}"][data-request-kind="permission"]`)
          await expect(permission).toBeVisible()
          await expect(permission.locator(".request-fields")).toContainText("END-OF-COMMAND")
          await expect(permission.locator(".request-fields")).toContainText("\\u202e")
          await expect(permission.locator(".request-fields")).toContainText("<b>literal-path</b>")
          expect(await permission.locator(".request-fields b").count()).toBe(0)
          // This worker's live lead initially holds the real permission.
          // Visible action data alone does not grant the owner answer controls.
          await expect(permission.locator(".request-options")).toHaveCount(0)
          await expect(permission.getByRole("button", { name: "Allow once", exact: true })).toHaveCount(0)
          return { current, permissionId }
        })
        const initial = success(yield* call(ownerCredential, "client.requests", { after: 0, limit: 200,
          agentId: worker.agentId, kind: "permission" })).items.find((row: ClientRequest) => row.id === permissionId) as ClientRequest
        expect(initial).toMatchObject({ id: permissionId, kind: "permission", agentId: worker.agentId,
          holder: { _tag: "agent", agentId: lead.agentId }, status: "open", canAnswer: false })
        success(yield* call(agentCredential(Redacted.value(leadToken)), "pass-up", { subject: { _tag: "permission", id: permissionId } }))
        const ownerHeld = success(yield* call(ownerCredential, "client.requests", { after: 0, limit: 200,
          agentId: worker.agentId, kind: "permission" })).items.find((row: ClientRequest) => row.id === permissionId) as ClientRequest
        expect(ownerHeld).toMatchObject({ id: permissionId, kind: "permission", agentId: worker.agentId,
          holder: { _tag: "owner" }, status: "open", canAnswer: true, sourceSequence: initial.sourceSequence })
        expect(ownerHeld.display).toEqual(initial.display)
        yield* Effect.promise(async () => {
          const input = page.getByRole("textbox", { name: /^Message (Conversation worker|Project lead)$/ })
          const permission = page.locator(`[data-request-id="${permissionId}"][data-request-kind="permission"]`)
          await expect(permission.locator(".request-options")).toBeVisible()
          await expect(permission.getByRole("button", { name: "Allow once", exact: true })).toBeEnabled()
          expect(await permission.evaluate((node) => Boolean(node.querySelector(".request-fields")!.compareDocumentPosition(node.querySelector(".request-options")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true)
          dropAnswer = true; dropped = false
          await permission.getByRole("button", { name: "Allow once", exact: true }).evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
          await expect.poll(() => dropped).toBe(true)
          await expect.poll(() => runner.callsOf("answerPermission").filter((row) => row.input.requestId === permissionId).length).toBe(1)
          await expect(permission.getByRole("button", { name: "Refresh this request", exact: true })).toBeVisible()
          dropAnswer = false
          // Reopening the real request cannot issue a second answer. Its
          // authoritative durable read now reports the committed outcome.
          await navigate(teamHref); await expect(page.getByLabel("Team conversation", { exact: true })).toBeVisible()
          await navigate(`/#/thread/${worker.agentId}?subject=permission:${permissionId}`)
          await expect(permission).toBeFocused()
          await permission.getByRole("button", { name: "Refresh this request", exact: true }).click()
          await expect(permission).toContainText("Request refreshed. It is closed or held elsewhere.")
          await expect(permission.getByRole("button", { name: "Allow once", exact: true })).toHaveCount(0)
          const answers = answerFrames.filter((row) => row.id === permissionId)
          expect(answers).toHaveLength(3); expect(answers.every((row) => JSON.stringify(row) === JSON.stringify(answers[0]))).toBe(true)

          const largeText = Array.from({ length: 12_000 }, (_, index) => `Trace ${index + 1}: <b>literal output</b>`).join("\n") + "\nEND-OF-BROWSER-TRACE"
          await Effect.runPromise(runner.emitRaw({ _tag: "deliveryUpdate", agentId: worker.agentId, incarnation: current.incarnation,
            deliveryId: current.delivery.id, kind: "message", replay: false, text: largeText, content: { _tag: "text", text: largeText } }))
          await expect.poll(() => largeMarkers.some((row) => row.agentId === worker.agentId && row.tag === "ThreadItem")).toBe(true)
          const marker = largeMarkers.filter((row) => row.agentId === worker.agentId && row.tag === "ThreadItem").at(-1)!
          const large = page.getByRole("article", { name: "Large thread item", exact: true })
          await expect(large).toBeVisible()
          dropLargeRead = marker.sequence; dropped = false
          await large.getByRole("button", { name: "Load full thread item", exact: true }).click()
          await expect.poll(() => dropped).toBe(true)
          await expect(large).toContainText("Could not load")
          dropLargeRead = undefined
          await large.getByRole("button", { name: "Load full thread item", exact: true }).click()
          const trace = page.getByRole("article", { name: "Agent message", exact: true }).filter({ hasText: "Trace 1:" })
          await expect(trace).toContainText("Trace 12:")
          await expect(trace).not.toContainText("Trace 13:")
          await trace.getByRole("button", { name: "Open Message in full", exact: true }).click()
          const full = page.getByRole("dialog", { name: "Message in full", exact: true })
          await expect(full.locator("pre")).toHaveText(largeText)
          expect(await full.locator("b").count()).toBe(0)
          await page.keyboard.press("Escape")
          await expect(trace.getByRole("button", { name: "Open Message in full", exact: true })).toBeFocused()
        })
        const rowsBefore = yield* readLog
        for (let index = 0; index < 36; index++) success(yield* call(ownerCredential, "board.post", {
          channelId: team.channelId, text: `History ${index + 1}: ${"Keep this older reading position. ".repeat(4)}`, to: [], reply: "none"
        }))
        const anchor = yield* Effect.promise(async () => {
          await page.setViewportSize({ width: 768, height: 800 }); await navigate(teamHref)
          const messages = page.getByLabel("Team messages", { exact: true })
          await expect(messages).toContainText("History 36:")
          expect(await messages.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)
          await messages.evaluate((node) => { node.scrollTop = 90 })
          await expect(page.getByRole("button", { name: "Latest messages", exact: true })).toBeVisible()
          const saved = await messages.evaluate((node) => {
            const top = node.getBoundingClientRect().top
            const row = [...node.querySelectorAll<HTMLElement>("[data-sequence]")].find((item) => item.getBoundingClientRect().bottom > top)!
            return { sequence: row.dataset.sequence!, offset: row.getBoundingClientRect().top - top }
          })
          await navigate(`/#/thread/${worker.agentId}`)
          await expect(page.getByRole("textbox", { name: "Message Conversation worker", exact: true })).toHaveValue("Newer unsent draft")
          await navigate(teamHref); await expect(messages).toContainText("History 36:")
          await expect.poll(() => messages.locator(`[data-sequence="${saved.sequence}"]`).evaluate((row) => row.getBoundingClientRect().top - row.parentElement!.getBoundingClientRect().top)).toBeCloseTo(saved.offset, 0)
          return saved
        })
        success(yield* call(ownerCredential, "board.post", { channelId: team.channelId, text: "A new team message", to: [], reply: "none" }))
        yield* Effect.promise(async () => {
          const messages = page.getByLabel("Team messages", { exact: true })
          await expect(messages).toContainText("A new team message")
          const offset = await messages.locator(`[data-sequence="${anchor.sequence}"]`).evaluate((row) => row.getBoundingClientRect().top - row.parentElement!.getBoundingClientRect().top)
          expect(offset).toBeCloseTo(anchor.offset, 0)
          await page.getByRole("button", { name: "Latest messages", exact: true }).click()
          await expect.poll(() => messages.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThanOrEqual(24)
        })
        yield* Effect.promise(async () => {
          await navigate(teamHref)
          const teamInput = page.getByRole("textbox", { name: "Message Build team", exact: true })
          await teamInput.fill("Actual team direction")
          await page.getByRole("button", { name: "Add context", exact: true }).click()
          const context = page.getByRole("dialog", { name: "Add context", exact: true })
          await context.getByRole("checkbox", { name: /TASK-1/ }).check()
          await context.getByRole("button", { name: "Add selected context", exact: true }).click()
          await teamInput.press("Enter")
          await expect(page.getByRole("article", { name: "Team message" }).filter({ hasText: "Actual team direction" })).toBeVisible()
          for (const theme of ["light", "dark"] as const) for (const width of [390, 768, 1440, 2560]) {
            await page.emulateMedia({ colorScheme: theme }); await page.setViewportSize({ width, height: 1000 })
            await expect(page.locator("html")).toHaveAttribute("data-theme", theme)
            await navigate(teamHref); await expect(page.getByLabel("Team conversation", { exact: true })).toBeVisible()
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
            await page.screenshot({ path: testInfo.outputPath(`team-${theme}-${width}.png`) })
            await navigate(`/#/thread/${worker.agentId}`); await expect(page.getByRole("textbox", { name: "Message Conversation worker", exact: true })).toHaveValue("Newer unsent draft")
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
            await page.screenshot({ path: testInfo.outputPath(`agent-${theme}-${width}.png`) })
          }
          await page.setViewportSize({ width: 2560, height: 1000 }); await navigate(`/#/project/${projectId}/board`)
          await expect(page.getByLabel("Lead conversation", { exact: true }).getByRole("textbox", { name: "Message Conversation worker", exact: true })).toHaveValue("Newer unsent draft")
          await navigate(`/#/thread/${lead.agentId}`); await navigate(`/#/project/${projectId}/board`)
          const dock = page.getByLabel("Lead conversation", { exact: true })
          await expect(dock).toBeVisible(); await expect(dock.getByRole("textbox", { name: "Message Project lead", exact: true })).toHaveValue("lead draft")
          await dock.getByRole("textbox", { name: "Message Project lead", exact: true }).fill("Edited from the lead dock")
          await navigate(`/#/thread/${lead.agentId}`)
          await expect(page.getByRole("textbox", { name: "Message Project lead", exact: true })).toHaveValue("Edited from the lead dock")
          await navigate(`/#/project/${projectId}/board`)
          await expect(dock.getByRole("textbox", { name: "Message Project lead", exact: true })).toHaveValue("Edited from the lead dock")
          await page.setViewportSize({ width: 390, height: 844 }); await expect(dock).toBeHidden()
          await page.getByRole("button", { name: "Conversation with Project lead", exact: true }).click(); await expect(dock).toBeVisible()
          await page.keyboard.press("Escape"); await expect(dock).toBeHidden(); await expect(page.getByRole("button", { name: "Conversation with Project lead", exact: true })).toBeFocused()
          const storage = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join(" "))
          expect(storage).not.toContain("draft"); expect(storage).not.toContain("Unsure message"); expect(storage).not.toContain("reference.txt")
          await openNavigation(page)
          await expect(page.getByRole("dialog", { name: "Repositories, projects and teams", exact: true })).toBeVisible()
          await expect(page.getByRole("navigation", { name: "Projects", exact: true })).toBeVisible()
          await page.getByRole("button", { name: "Log out", exact: true }).click(); await expect(page.getByRole("form", { name: "Log in", exact: true })).toBeVisible()
          await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Log in", exact: true }).click()
          await navigate(`/#/thread/${worker.agentId}`); await expect(page.getByRole("textbox", { name: "Message Conversation worker", exact: true })).toHaveValue("")
        })
        const rowsAfter = yield* readLog
        expect(rowsAfter.filter((row) => row.event._tag === "board.Read")).toEqual(rowsBefore.filter((row) => row.event._tag === "board.Read"))
        const direction = rowsAfter.find((row) => row.event._tag === "board.PostWritten" && row.event.text === "Actual team direction")?.event
        expect(direction).toMatchObject({ _tag: "board.PostWritten", context: [{ _tag: "task", projectId, taskId }] })
        expect(rowsAfter.filter((row) => row.event._tag === "DeliveryQueued" && row.event.delivery.content._tag === "prompt" && row.event.delivery.content.text === "Unsure message")).toHaveLength(1)
        // The owner's team peek never marks a member's unread posts as read.
        const workerToken = runner.callsOf("start").find((row) => row.input.agentId === worker.agentId)!.input.token
        const workerStatus = success(yield* call(agentCredential(Redacted.value(workerToken)), "board.status", { agentId: worker.agentId }))
        expect(workerStatus.agentId).toBe(worker.agentId)
        expect(workerStatus.unread).toBeGreaterThan(0)
        yield* Effect.promise(async () => {
          const input = page.getByRole("textbox", { name: "Message Conversation worker", exact: true })
          await input.fill("Keep this stopped draft")
          await page.getByRole("button", { name: "Stop agent", exact: true }).click()
          await expect(page.getByRole("button", { name: "Resume agent", exact: true })).toBeVisible()
          await expect(input).toBeHidden()
          await expect(page.getByText("Your draft is kept.", { exact: false })).toBeVisible()
          await expect.poll(() => runner.callsOf("stop").filter((row) => row.input.agentId === worker.agentId).length).toBe(1)
          await page.getByRole("button", { name: "Resume agent", exact: true }).click()
          await expect(input).toHaveValue("Keep this stopped draft")
          await expect.poll(() => runner.callsOf("load").filter((row) => row.input.agentId === worker.agentId).length).toBe(1)
          await input.fill("Discard this draft on full reload")
          await page.reload(); await expect(input).toHaveValue("")
          await input.fill("Private draft before actual session expiry")
          const detachedInput = await input.elementHandle()
          await page.context().clearCookies()
          await page.evaluate(() => {
            for (const socket of (window as typeof window & { __conversationSockets: globalThis.WebSocket[] }).__conversationSockets) {
              if (socket.readyState === WebSocket.OPEN) socket.close(4000, "Controlled reconnect after cookie removal")
            }
          })
          await expect(page.getByRole("form", { name: "Log in", exact: true })).toBeVisible()
          expect(await detachedInput!.evaluate((node) => (node as HTMLTextAreaElement).value)).toBe("")
          await page.getByLabel("Password", { exact: true }).fill(password); await page.getByRole("button", { name: "Log in", exact: true }).click()
          await navigate(`/#/thread/${worker.agentId}`); await expect(input).toHaveValue("")
        })
      })
      const dependencies = Layer.mergeAll(runner.layer, makeFakeSecrets().layer, Layer.succeed(Redactor, { redact: (event) => Effect.succeed(event), redactText: (text) => Effect.succeed(text) }))
      yield* Effect.scoped(run).pipe(Effect.provide(buildServices(rig, engineLists).pipe(Layer.provide(dependencies))), Effect.provide(runner.layer))
    }).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped)
    await Effect.runPromise(program as Effect.Effect<void, unknown>)
  } finally { if (previousHome === undefined) delete process.env.LGCODE_HOME; else process.env.LGCODE_HOME = previousHome; removeRig(rig) }
})
