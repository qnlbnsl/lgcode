import { completedSetup } from "../e2e/support/completedSetup.ts"
import { randomBytes } from "node:crypto"
import { join } from "node:path"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Stream from "effect/Stream"
import type { ClientStreamItem } from "@lgcode/contracts"
import { App } from "../src/app.tsx"
import { serve } from "../../engine/src/api/server.ts"
import { EventLog } from "../../engine/src/log/EventLog.ts"
import { provideBoard, boardState } from "../../engine/test/board/wakeFixtures.ts"
import { decisionSetup } from "../../engine/test/support/projectDecisionFixtures.ts"
import { call, freshRequest, makeRig, ownerCredential, readLog, removeRig, success } from "../../engine/test/support/handlerRig.ts"
import { registerRebuildCheck } from "../../engine/test/support/rebuildCheck.ts"
import { connect } from "../../engine/test/support/socketClient.ts"

const transport = vi.hoisted(() => ({ client: undefined as unknown }))
vi.mock("@lgcode/client/browser", async () => {
  const Effect = await import("effect/Effect")
  return { connect: () => Effect.succeed(transport.client) }
})
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it("refreshes a real team post through the authenticated shell stream without polling or consuming member marks", async () => {
  const rig = makeRig()
  vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder)
  // Only the HTTP session probe is a double. Every RPC below, including the
  // owner's subscription, traverses the real authenticated Unix socket API.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.spyOn(document, "hidden", "get").mockReturnValue(false)
  localStorage.clear()
  const container = document.createElement("div"); document.body.append(container)
  const root = createRoot(container)
  const trace: Array<{ kind: string; sequence?: number; tag?: string; posts?: ReadonlyArray<string> }> = []
  const commands: string[] = []
  let savedAnchor: { sequence: string; offset: number } | undefined
  const heldPolls: Array<ReturnType<typeof setInterval>> = []
  const nativeInterval = globalThis.setInterval.bind(globalThis)
  vi.spyOn(globalThis, "setInterval").mockImplementation((callback, delay, ...args) => {
    // Hold only TeamMessages' fallback. Effect/socket timers and other UI
    // intervals run normally; the stack guard rejects broad timer interception.
    if (delay === 5000 && new Error().stack?.includes("/thread/team.tsx")) {
      const timer = nativeInterval(() => {}, 2_147_483_647)
      heldPolls.push(timer)
      return timer
    }
    return nativeInterval(callback, delay, ...args)
  })
  // JSDOM has no layout. These deterministic rectangles simulate only the
  // production reader's geometry; native browser layout remains unproved here.
  const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 400, width: 400, x: 0, y: top, toJSON: () => ({}) })
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100)
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) { return this.querySelectorAll("[data-sequence]").length * 50 })
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const scroller = this.closest<HTMLElement>('[aria-label="Team messages"]')
    if (scroller && this.dataset.sequence) {
      const index = [...scroller.querySelectorAll("[data-sequence]")].indexOf(this)
      return rect(index * 50 - scroller.scrollTop, 50)
    }
    return rect(0, 100)
  })
  const wait = async (check: () => void) => {
    await vi.waitFor(async () => {
      await act(async () => {})
      check()
    })
  }
  try {
    await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
      yield* registerRebuildCheck()
      const fixture = yield* decisionSetup()
      yield* completedSetup(fixture.projectId)
      const log = yield* EventLog
      let subscriptions = 0
      const socketPath = join(rig.stateFolder, "conversation.sock")
      const bearer = randomBytes(32).toString("base64url")
      yield* serve({ socketPath, ownerCredential: Redacted.make(bearer), debug: false }).pipe(Effect.provideService(EventLog, {
        ...log, subscribeCommitted: log.subscribeCommitted.pipe(Effect.tap(() => Effect.sync(() => { subscriptions++ })))
      }))
      const client = yield* connect(socketPath, bearer)
      for (let index = 0; index < 36; index++) yield* client["board.post"]({ requestId: freshRequest(), channelId: fixture.team.channelId,
        text: `History ${index + 1}: Keep the older anchor.`, to: [], reply: "none" })
      // Establish a nonempty actual member watermark before owner viewing.
      success(yield* call(fixture.workerCredential, "board.read", { channelId: fixture.team.channelId, limit: 100 }))
      const before = yield* boardState
      expect(Object.keys(before.readState)).not.toHaveLength(0)
      const logBefore = yield* readLog
      const head = logBefore.at(-1)!.sequence
      transport.client = new Proxy(client, { get: (target, property) => {
        const name = String(property)
        const method = Reflect.get(target, property) as (payload: unknown) => Effect.Effect<Record<string, unknown>, unknown>
        if (name === "client.subscribe") return (payload: Parameters<typeof client["client.subscribe"]>[0]) => {
          commands.push(name)
          return target["client.subscribe"](payload).pipe(Stream.tap((item: ClientStreamItem) => Effect.sync(() => {
            trace.push({ kind: "stream", sequence: item.sequence, tag: "event" in item ? item.event._tag : item._tag })
          })))
        }
        return (payload: unknown) => {
          commands.push(name)
          return method(payload).pipe(Effect.tap((reply) => Effect.sync(() => {
            if (name === "client.snapshot") trace.push({ kind: "snapshot", sequence: reply.sequence as number })
            if (name === "board.peek") trace.push({ kind: "peek", posts: (reply.items as ReadonlyArray<{ postId: string }>).map((row) => row.postId) })
          })))
        }
      } })
      yield* Effect.promise(async () => {
        history.replaceState({}, "", `/#/project/${fixture.projectId}/team/${fixture.team.teamId}/chat`)
        await act(async () => root.render(<App />))
        await wait(() => expect(container.querySelector('[aria-label="Team messages"]')?.textContent).toContain("History 36:"))
        await wait(() => expect(subscriptions).toBe(1))
        expect(heldPolls).toHaveLength(1)
        const messages = container.querySelector<HTMLDivElement>('[aria-label="Team messages"]')!
        await act(async () => { messages.scrollTop = 135; messages.dispatchEvent(new Event("scroll", { bubbles: true })) })
        const top = messages.getBoundingClientRect().top
        const anchor = [...messages.querySelectorAll<HTMLElement>("[data-sequence]")].find((row) => row.getBoundingClientRect().bottom > top)!
        savedAnchor = { sequence: anchor.dataset.sequence!, offset: anchor.getBoundingClientRect().top - top }
        expect(container.querySelector(".conversation-latest")).not.toBeNull()
        expect(trace.filter((row) => row.kind === "snapshot")).toEqual([{ kind: "snapshot", sequence: head }])
      })
      const text = "A new team message: <b>literal owner direction</b>"
      const posted = yield* client["board.post"]({ requestId: freshRequest(), channelId: fixture.team.channelId, text, to: [], reply: "none" })
      const afterPost = yield* readLog
      const delta = afterPost.slice(logBefore.length)
      expect(delta.map((row) => row.event._tag)).toEqual(["board.PostWritten"])
      const committed = delta[0]!
      expect(committed.event).toMatchObject({ _tag: "board.PostWritten", postId: posted.postId, channelId: fixture.team.channelId, author: { _tag: "owner" }, text })
      yield* Effect.promise(async () => {
        await wait(() => expect(trace).toContainEqual({ kind: "stream", sequence: committed.sequence, tag: "board.PostWritten" }))
        await wait(() => expect(container.querySelector('[aria-label="Team messages"]')?.textContent).toContain(text))
        trace.push({ kind: "render", sequence: committed.sequence })
        const streamed = trace.findIndex((row) => row.kind === "stream" && row.sequence === committed.sequence)
        const refreshed = trace.findIndex((row, index) => index > streamed && row.kind === "snapshot" && row.sequence! >= committed.sequence)
        const peeked = trace.findIndex((row, index) => index > refreshed && row.kind === "peek" && row.posts?.includes(posted.postId))
        expect(refreshed).toBeGreaterThan(streamed); expect(peeked).toBeGreaterThan(refreshed)
        expect(trace.at(-1)!.kind).toBe("render")
        const messages = container.querySelector<HTMLDivElement>('[aria-label="Team messages"]')!
        const anchor = messages.querySelector<HTMLElement>(`[data-sequence="${savedAnchor!.sequence}"]`)!
        expect(messages.scrollTop).toBe(135)
        expect(anchor.getBoundingClientRect().top - messages.getBoundingClientRect().top).toBe(savedAnchor!.offset)
        const row = messages.querySelector(`[data-sequence="${committed.sequence}"]`)!
        expect(row.textContent).toContain(text); expect(row.textContent).toContain(posted.postId)
        expect(row.querySelector("b")).toBeNull()
        const latest = container.querySelector<HTMLButtonElement>(".conversation-latest")!
        expect(latest).not.toBeNull()
        await act(async () => latest.click())
        expect(messages.scrollTop).toBe(messages.scrollHeight)
        expect(container.querySelector(".conversation-latest")).toBeNull()
        expect(heldPolls.length).toBeGreaterThanOrEqual(2)
      })
      const after = yield* boardState
      expect(after.readState).toEqual(before.readState)
      for (const [id, post] of Object.entries(before.posts)) expect(after.posts[id]!.acknowledged).toEqual(post.acknowledged)
      expect(after.posts[posted.postId]!.acknowledged).toEqual([])
      const finalLog = yield* readLog
      expect(finalLog.slice(logBefore.length).map((row) => row.event._tag)).toEqual(["board.PostWritten"])
      expect(commands).toContain("board.peek"); expect(commands).not.toContain("board.read"); expect(commands).not.toContain("board.acknowledge")
    })))
  } finally {
    console.info("Real board stream proof", JSON.stringify({ trace, commands, heldTeamFallbackPolls: heldPolls.length, simulatedLayout: true }))
    await act(async () => root.unmount()); container.remove()
    for (const timer of heldPolls) clearInterval(timer)
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs()
    history.replaceState({}, "", "/"); removeRig(rig)
  }
})
