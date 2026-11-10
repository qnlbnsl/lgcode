import { completedSetup } from "./support/completedSetup.ts"
import { randomBytes } from "node:crypto"
import { chmodSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { build } from "vite"
import * as SqliteClient from "../../../third_party/t3code/node-sqlite/src/nodeSqliteClient.ts"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import { buildServices } from "../../engine/src/service.ts"
import { serve as serveApi } from "../../engine/src/api/server.ts"
import { serve } from "../../engine/src/client/web/server.ts"
import { Redactor } from "../../engine/src/log/Redactor.ts"
import { engineLists } from "../../engine/src/pieces/lists.ts"
import { unusedPort } from "../../engine/test/support/browserWeb.ts"
import { makeFakeRunner } from "../../engine/test/support/fakeRunner.ts"
import { makeFakeSecrets, makeRig, removeRig, seedAccount, seedHarness, startPayload, freshRequest } from "../../engine/test/support/handlerRig.ts"
import { connect } from "../../engine/test/support/socketClient.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"
import { connectViewer } from "../../viewer/src/connection.ts"
import { ViewerSession } from "../../viewer/src/session.ts"
import { eventText } from "../../viewer/src/text.ts"
import { openNavigation } from "./support/navigation.ts"

test("both owner clients retain first/later prompts, question answers, board deliveries and oversized sources across reopen and reconnect", async ({ page }) => {
  test.setTimeout(90_000)
  const rig = makeRig()
  const previousHome = process.env.LGCODE_HOME
  process.env.LGCODE_HOME = rig.stateFolder
  const password = randomBytes(32).toString("base64url")
  const credential = randomBytes(32)
  chmodSync(rig.stateFolder, 0o700)
  writeFileSync(join(rig.stateFolder, "owner-credential"), credential, { mode: 0o600 })
  const socketPath = join(rig.stateFolder, "engine.sock")
  const staticRoot = join(rig.root, "page")
  let viewer: ViewerSession | undefined
  try {
    await build({ configFile: false, root: new URL("..", import.meta.url).pathname,
      logLevel: "silent", build: { outDir: staticRoot } })
    const port = await unusedPort()
    const program = Effect.gen(function* () {
      const runner = yield* makeFakeRunner()
      const run = Effect.gen(function* () {
        yield* registerRebuildCheck()
        yield* seedHarness()
        yield* seedAccount()
        yield* serveApi({ socketPath, ownerCredential: Redacted.make(credential.toString("base64url")), debug: false })
        yield* completedSetup()
        yield* serve({ password: Redacted.make(password), staticRoot, lists: engineLists,
          settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: false } })
        const owner = yield* connect(socketPath, credential.toString("base64url"))
        const worker = yield* owner.start(startPayload(rig, { requestId: freshRequest(), name: "Conversation worker", prompt: "First owner prompt" }) as never)
        const promptCount = (count: number) => Effect.promise(() => expect.poll(() => runner.callsOf("prompt").length).toBe(count))
        const finish = Effect.gen(function* () {
          const sent = runner.callsOf("prompt").at(-1)!.input
          yield* runner.emit({ _tag: "deliveryUpdate", agentId: sent.agentId, incarnation: sent.incarnation,
            deliveryId: sent.delivery.id, kind: "message", replay: false, text: "Agent response" })
          yield* runner.emit({ _tag: "promptReply", agentId: sent.agentId, incarnation: sent.incarnation,
            deliveryId: sent.delivery.id, outcome: { _tag: "success" } })
          yield* runner.emit({ _tag: "turnEnded", agentId: sent.agentId, incarnation: sent.incarnation, deliveryId: sent.delivery.id })
          yield* Effect.promise(() => expect.poll(async () => {
            const snapshot = await Effect.runPromise(owner["client.snapshot"]({ requestId: freshRequest() }))
            return snapshot.agents.find((agent) => agent.agentId === worker.agentId)?.state._tag
          }).toBe("idle"))
        })
        const viewerText = () => viewer!.items.map((item) => eventText(item.event)).join("\n")
        yield* promptCount(1)
        yield* Effect.promise(async () => {
          viewer = new ViewerSession(await connectViewer({ LGCODE_HOME: rig.stateFolder }), () => {})
          await viewer.start()
          await viewer.select(worker.agentId)
          await page.setViewportSize({ width: 360, height: 800 })
          await page.goto(`http://127.0.0.1:${port}/`)
          await page.getByLabel("Password", { exact: true }).fill(password)
          await page.getByRole("button", { name: "Log in", exact: true }).click()
          await openNavigation(page)
          await page.getByRole("navigation", { name: "Projects", exact: true }).locator(".agent-link").filter({ hasText: "Conversation worker" }).click()
          await expect(page.getByRole("article", { name: "Outgoing delivery", exact: true })).toContainText("First owner prompt")
          expect(viewerText()).toContain("First owner prompt")
        })
        yield* finish
        yield* Effect.promise(async () => {
          await page.getByRole("form", { name: "Prompt agent", exact: true }).getByRole("textbox").fill("Later owner prompt")
          await page.getByRole("button", { name: "Send prompt", exact: true }).click()
          await expect(page.getByRole("article", { name: "Outgoing delivery" }).filter({ hasText: "Later owner prompt" })).toContainText("Sent")
          await expect.poll(viewerText).toContain("Later owner prompt")
          const source = viewer!.items.find((item) => item.event._tag === "DeliveryQueued")!
          expect(source).not.toHaveProperty("agentId")
          expect(source.event).not.toHaveProperty("agentId")
        })
        yield* promptCount(2)
        yield* finish
        const token = Redacted.value(runner.callsOf("start")[0]!.input.token)
        const agent = yield* connect(socketPath, token)
        const question = yield* agent.ask({ requestId: freshRequest(), text: "Which branch should I use?" })
        yield* Effect.promise(async () => {
          await page.getByRole("form", { name: "Answer question", exact: true }).getByRole("textbox").fill("Use the safe branch")
          await page.getByRole("button", { name: "Send answer", exact: true }).click()
          await expect(page.getByRole("article", { name: "Question answer", exact: true })).toContainText("Use the safe branch")
          await expect.poll(viewerText).toContain("Use the safe branch")
          expect(viewer!.items.some((item) => item.event._tag === "QuestionAnswered" && item.event.questionId === question.questionId)).toBe(true)
        })
        yield* promptCount(3)
        yield* finish
        const boardPost = yield* owner["board.post"]({ requestId: freshRequest(), direct: { _tag: "agent", agentId: worker.agentId },
          text: "Board roundtrip context", to: [{ _tag: "agent", agentId: worker.agentId }], reply: "all" })
        yield* promptCount(4)
        // Complete the addressed member's actual read/reply duty before its
        // turn ends. Otherwise the board correctly starts a reminder turn.
        const readPost = yield* agent["board.read"]({ requestId: freshRequest(), post: boardPost.postId })
        expect("data" in readPost && readPost.data.includes(boardPost.postId)).toBe(true)
        const boardReply = yield* agent["board.post"]({ requestId: freshRequest(), direct: { _tag: "owner" },
          replyTo: boardPost.postId, text: "Board context received.", to: [], reply: "none" })
        yield* finish
        const settledPost = yield* owner["board.read"]({ requestId: freshRequest(), post: boardPost.postId })
        expect("items" in settledPost && settledPost.items.find((post) => post.postId === boardPost.postId)).toMatchObject({
          status: "closed", dispositions: [{ addressee: { _tag: "agent", agentId: worker.agentId }, disposition: "replied" }],
        })
        const actualReply = yield* owner["board.read"]({ requestId: freshRequest(), post: boardReply.postId })
        expect("items" in actualReply && actualReply.items.find((post) => post.postId === boardReply.postId)).toMatchObject({
          author: { _tag: "agent", agentId: worker.agentId }, text: "Board context received.", replyTo: boardPost.postId,
        })
        yield* Effect.promise(async () => {
          await expect(page.getByRole("article", { name: "Outgoing delivery" }).filter({ hasText: "Board roundtrip context" })).toContainText("Accepted")
          await expect.poll(viewerText).toContain("Board roundtrip context")
          expect(viewer!.items.some((item) => item.event._tag === "DeliveryQueued" && item.event.delivery.source?._tag === "piece"
            && item.event.delivery.source.namespace === "board")).toBe(true)
          // Exceeds the live stream's 256 KiB envelope budget. Both clients
          // must recover its actual source rather than just current state.
          await expect(page.getByRole("button", { name: "Stop reply", exact: true })).toHaveCount(0)
          await page.getByRole("form", { name: "Prompt agent", exact: true }).getByRole("textbox").fill(`Large outgoing source ${"x".repeat(270_000)} END-OF-OUTGOING-SOURCE`)
          await expect(page.getByRole("button", { name: "Send prompt", exact: true })).toBeEnabled()
          await page.getByRole("button", { name: "Send prompt", exact: true }).click()
          await page.getByRole("article", { name: "Outgoing delivery" }).filter({ hasText: "Large outgoing source" }).getByRole("button", { name: "Open Prompt in full", exact: true }).click()
          await expect(page.getByRole("dialog", { name: "Prompt in full", exact: true }).locator("pre")).toContainText("END-OF-OUTGOING-SOURCE")
          await page.getByRole("button", { name: "Back to conversation", exact: true }).click()
          await expect.poll(() => viewerText().includes("END-OF-OUTGOING-SOURCE")).toBe(true)
          await viewer!.start()
          await page.reload()
          await expect(page.getByRole("article", { name: "Question answer" })).toContainText("Use the safe branch")
          await expect(page.getByRole("article", { name: "Outgoing delivery" }).filter({ hasText: "First owner prompt" })).toContainText("Accepted")
          await page.getByRole("article", { name: "Outgoing delivery" }).filter({ hasText: "Large outgoing source" }).getByRole("button", { name: "Open Prompt in full", exact: true }).click()
          await expect(page.getByRole("dialog", { name: "Prompt in full", exact: true }).locator("pre")).toContainText("END-OF-OUTGOING-SOURCE")
          await page.getByRole("button", { name: "Back to conversation", exact: true }).click()
          expect(viewerText()).toContain("First owner prompt")
          expect(viewerText()).toContain("Board roundtrip context")
          expect(viewerText()).toContain("END-OF-OUTGOING-SOURCE")
          await viewer!.close()
          viewer = undefined
        })
      })
      const dependencies = Layer.mergeAll(runner.layer, makeFakeSecrets().layer, Layer.succeed(Redactor, {
        redact: (event) => Effect.succeed(event), redactText: (text) => Effect.succeed(text)
      }))
      yield* Effect.scoped(run).pipe(Effect.provide(buildServices(rig, engineLists).pipe(Layer.provide(dependencies))), Effect.provide(runner.layer))
    }).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped)
    await Effect.runPromise(program as Effect.Effect<void, unknown>)
  } finally {
    await viewer?.close()
    if (previousHome === undefined) delete process.env.LGCODE_HOME
    else process.env.LGCODE_HOME = previousHome
    removeRig(rig)
  }
})
