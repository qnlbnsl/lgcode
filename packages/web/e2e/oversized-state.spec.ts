import { completedSetup } from "./support/completedSetup.ts"
import { openNavigation } from "./support/navigation.ts"
import { randomBytes } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test, type WebSocket } from "@playwright/test"
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
import { call, makeFakeSecrets, makeRig, ownerCredential, removeRig, seedAccount, seedHarness,
  startPayload, success, harnessSettings } from "../../engine/test/support/handlerRig.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"
import { httpsProxy } from "./support/httpsProxy.ts"

test.use({ ignoreHTTPSErrors: true })

test("7.14 production state markers recover once over a 500-kbit/s link while live events continue", async ({ page }) => {
  test.setTimeout(120_000)
  const rig = makeRig()
  const previousHome = process.env.LGTM_HOME
  process.env.LGTM_HOME = rig.stateFolder
  const password = randomBytes(32).toString("base64url")
  const staticRoot = join(rig.root, "page")
  let proxy: Awaited<ReturnType<typeof httpsProxy>> | undefined
  const sockets: WebSocket[] = []
  const requests: Array<{ socket: WebSocket; frame: any; time: number }> = []
  const replies: Array<{ socket: WebSocket; frame: any; bytes: number; time: number }> = []
  page.on("websocket", (socket) => {
    sockets.push(socket)
    const frames = (payload: string | Buffer) => {
      const value = JSON.parse(payload.toString())
      return Array.isArray(value) ? value : [value]
    }
    socket.on("framesent", ({ payload }) => {
      for (const frame of frames(payload)) if (frame._tag === "Request") requests.push({ socket, frame, time: Date.now() })
    })
    socket.on("framereceived", ({ payload }) => {
      for (const frame of frames(payload)) replies.push({ socket, frame, bytes: Buffer.byteLength(payload), time: Date.now() })
    })
  })
  try {
    // This is the production build. Keeping names allows the debugger to read
    // the actual pinger's initialized options without injecting a test client,
    // changing the protocol, mocking time, or instrumenting application code.
    await build({ configFile: false, root: new URL("..", import.meta.url).pathname, logLevel: "silent",
      build: { outDir: staticRoot, minify: false } })
    const asset = readdirSync(join(staticRoot, "assets")).find((name) => name.endsWith(".js"))!
    const source = readFileSync(join(staticRoot, "assets", asset), "utf8")
    const pingerLine = source.split("\n").findIndex((line) => line.includes("let lastSeen = clock.currentTimeMillisUnsafe()"))
    expect(pingerLine, "the installed Effect pinger must be observable in the production artifact").toBeGreaterThan(0)
    const debuggerSession = await page.context().newCDPSession(page)
    const ping: Array<{ interval: string; timeoutMillis: number }> = []
    const debuggerErrors: string[] = []
    await debuggerSession.send("Debugger.enable")
    debuggerSession.on("Debugger.paused", async ({ callFrames }) => {
      try {
        const result = await debuggerSession.send("Debugger.evaluateOnCallFrame", {
          callFrameId: callFrames[0]!.callFrameId,
          expression: "JSON.stringify({ interval, timeoutMillis })", returnByValue: true,
        })
        ping.push(JSON.parse(result.result.value))
      } catch { debuggerErrors.push("Could not inspect the initialized Effect pinger") }
      finally { await debuggerSession.send("Debugger.resume") }
    })
    await page.addInitScript(() => {
      const observed: globalThis.WebSocket[] = []
      Object.assign(window, { __observedSockets: observed })
      window.WebSocket = new Proxy(window.WebSocket, {
        construct(target, args) {
          const socket = Reflect.construct(target, args) as globalThis.WebSocket
          observed.push(socket)
          return socket
        }
      })
    })
    const port = await unusedPort()
    proxy = await httpsProxy(port, rig.root)
    const origin = proxy.origin
    await debuggerSession.send("Debugger.setBreakpointByUrl", { url: `${origin}/assets/${asset}`, lineNumber: pingerLine })
    const program = Effect.gen(function* () {
      const runner = yield* makeFakeRunner()
      const run = Effect.gen(function* () {
        yield* registerRebuildCheck()
        yield* seedHarness()
        yield* seedAccount()
        yield* completedSetup()
        yield* serve({ password: Redacted.make(password), staticRoot, lists: engineLists,
          settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: true, publicAddress: origin } })
        yield* Effect.promise(async () => {
          await page.setViewportSize({ width: 360, height: 800 })
          await page.goto(origin)
          await page.getByLabel("Password", { exact: true }).fill(password)
          await page.getByRole("button", { name: "Log in", exact: true }).click()
          await expect(page.getByRole("region", { name: "Home", exact: true })).toBeVisible()
          await expect.poll(() => requests.some(({ frame }) => frame.tag === "client.subscribe")).toBe(true)
          expect(debuggerErrors).toEqual([])
          expect(ping).toContainEqual({ interval: "25 seconds", timeoutMillis: 50_000 })
          expect(ping).toContainEqual({ interval: "5 seconds", timeoutMillis: 5_000 })
          console.info(`7.14 effective browser pingers: ${JSON.stringify(ping)}`)
          // Inspection is over before the slow-link measurement begins.
          await debuggerSession.send("Debugger.disable")
        })
        const worker = success(yield* call(ownerCredential, "start", startPayload(rig, {
          name: "Large state worker", prompt: "start-prefix " + "x".repeat(300 * 1024),
        })))
        yield* Effect.promise(async () => { await expect.poll(() => runner.callsOf("prompt").length).toBe(1) })
        const sent = runner.callsOf("prompt")[0]!.input
        const permission = (id: string, bytes: number) => runner.emitRaw({ _tag: "permissionRequested",
          agentId: worker.agentId, incarnation: sent.incarnation, deliveryId: sent.delivery.id,
          permissionRequestId: id, toolCallId: id, description: `${id} ` + "x".repeat(bytes), settingsWrite: false,
          options: [{ id: "once", name: "Allow once", persistent: false, kind: "allow_once", level: "ask" }] })
        yield* permission("large-request", 300 * 1024)
        success(yield* call(ownerCredential, "harnesses", { operation: "set", harness: harnessSettings("first", {
          adapterArguments: ["harness-prefix " + "x".repeat(300 * 1024)],
        }) }))
        yield* Effect.promise(async () => {
          const home = page.getByRole("region", { name: "Home", exact: true })
          await expect(home).toContainText("Large state worker")
          await expect(home.locator(".home-request-row")).toHaveCount(1)
          for (const tag of ["AgentStarted", "PermissionRequested", "HarnessChanged"]) {
            await expect.poll(() => replies.some(({ frame }) => frame._tag === "Chunk" && frame.values?.some((value: any) => value._tag === "client.Oversized" && value.tag === tag))).toBe(true)
            await expect.poll(() => replies.some(({ frame, bytes }) => frame.exit?.value?.envelope?.event?._tag === tag && bytes > 256 * 1024)).toBe(true)
          }
          proxy!.throttle(500_000 / 8)
        })
        // An actual state event is >1 MiB after protocol encoding. Its recovery
        // competes with live state on the stream, with a real five-second pinger.
        yield* permission("slow-request", 1024 * 1024)
        let tick = 0
        yield* Effect.forever(Effect.gen(function* () {
          success(yield* call(ownerCredential, "group", { agentId: worker.agentId, add: [`live-${tick++}`], remove: [] }))
          yield* Effect.sleep(750)
        })).pipe(Effect.forkScoped)
        yield* Effect.promise(async () => {
          const recovered = () => replies.filter(({ frame }) => frame.exit?.value?.envelope?.event?.permissionRequestId === "slow-request")
          await expect.poll(() => recovered().length, { timeout: 50_000 }).toBe(1)
          const reply = recovered()[0]!
          const sequence = reply.frame.exit.value.envelope.sequence
          const reads = requests.filter(({ frame }) => frame.tag === "client.event" && frame.payload.sequence === sequence)
          expect(reads).toHaveLength(1)
          expect(reply.socket).toBe(reads[0]!.socket)
          expect(reply.socket.isClosed()).toBe(false)
          expect(reply.bytes).toBeGreaterThan(1024 * 1024)
          const elapsed = reply.time - reads[0]!.time
          expect(elapsed).toBeGreaterThanOrEqual(16_000)
          expect(elapsed).toBeLessThan(50_000)
          const stream = requests.find(({ frame }) => frame.tag === "client.subscribe")!
          expect(reads[0]!.socket).not.toBe(stream.socket)
          await expect(page.locator(".home-view .home-request-row")).toHaveCount(2)
          await expect(page.locator(".topbar .attention-toggle")).toHaveAttribute("aria-label", "2 items need attention")
          await expect.poll(() => replies.filter(({ frame }) => Array.isArray(frame.exit?.value?.agents)).at(-1)?.frame.exit.value.agents.find((agent: { agentId: string }) => agent.agentId === worker.agentId)?.groups.some((group: string) => group.startsWith("live-"))).toBe(true)
          const snapshot = replies.filter(({ frame }) => Array.isArray(frame.exit?.value?.requests)).at(-1)!.frame.exit.value
          expect(snapshot.requests.map((row: { id: string }) => row.id).sort()).toEqual(["large-request", "slow-request"])
          expect(snapshot.requests.every((row: { agentId: string; holder: { _tag: string } }) => row.agentId === worker.agentId && row.holder._tag === "owner")).toBe(true)
          expect(snapshot.agents.filter((agent: { agentId: string }) => agent.agentId === worker.agentId)).toMatchObject([{ agentId: worker.agentId, name: "Large state worker", openPermissionRequests: 2 }])
          expect(snapshot.requestsWithoutDisplay).toBe(0)
          console.info(`7.14 recovery: ${reply.bytes} encoded bytes, ${elapsed} ms at 500 kbit/s, one surviving read`)
          proxy!.throttle(undefined)
          // Force the stream's reconnect at the browser boundary. The recovery
          // read already completed once and must never be repeated.
          const subscriptions = requests.filter(({ frame }) => frame.tag === "client.subscribe")
          const count = subscriptions.length
          const active = subscriptions.at(-1)!
          await page.evaluate((index) => {
            (window as typeof window & { __observedSockets: globalThis.WebSocket[] }).__observedSockets[index]!.close(4000, "controlled reconnect")
          }, sockets.indexOf(active.socket))
          await expect.poll(() => requests.filter(({ frame }) => frame.tag === "client.subscribe").length).toBeGreaterThan(count)
          await expect(page.locator(".home-view .home-request-row")).toHaveCount(2)
          expect(replies.filter(({ frame }) => Array.isArray(frame.exit?.value?.requests)).at(-1)!.frame.exit.value.requests.map((row: { id: string }) => row.id).sort()).toEqual(["large-request", "slow-request"])
          await openNavigation(page)
          await page.locator(".repo-tree .agent-link").filter({ hasText: "Large state worker" }).click()
          const request = page.getByRole("region", { name: "Permission request", exact: true }).filter({ hasText: "slow-request" })
          await expect(request).toBeVisible()
          await request.getByRole("button", { name: "Allow once", exact: true }).click()
          await expect.poll(() => runner.callsOf("answerPermission").some(({ input }) => input.requestId === "slow-request" && input.optionId === "once")).toBe(true)
          await openNavigation(page)
          await page.getByRole("navigation", { name: "Pages" }).getByRole("link", { name: "Home", exact: true }).click()
          await expect(page.locator(".home-view .home-request-row")).toHaveCount(1)
          await expect.poll(() => requests.filter(({ frame }) => frame.tag === "client.subscribe").length).toBeGreaterThan(count)
          expect(requests.filter(({ frame }) => frame.tag === "client.event" && frame.payload.sequence === sequence)).toHaveLength(1)
        })
      })
      const dependencies = Layer.mergeAll(runner.layer, makeFakeSecrets().layer, Layer.succeed(Redactor, {
        redact: (event) => Effect.succeed(event), redactText: (text) => Effect.succeed(text),
      }))
      yield* Effect.scoped(run).pipe(Effect.provide(buildServices(rig, engineLists).pipe(Layer.provide(dependencies))), Effect.provide(runner.layer))
    }).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped)
    await Effect.runPromise(program as Effect.Effect<void, unknown>)
  } finally {
    if (previousHome === undefined) delete process.env.LGTM_HOME
    else process.env.LGTM_HOME = previousHome
    await proxy?.close()
    removeRig(rig)
  }
})
