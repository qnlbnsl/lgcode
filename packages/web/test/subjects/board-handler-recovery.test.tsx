import { act } from "react"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import { expect, it, vi } from "vitest"
import { CommandHandler } from "../../../engine/src/commands/CommandHandler.ts"
import { eventsOf, provideBoard, seedBoard } from "../../../engine/test/board/wakeFixtures.ts"
import { freshRequest, makeRig, ownerCredential, readLog, removeRig } from "../../../engine/test/support/handlerRig.ts"
import { mountThread } from "../thread-fixtures.tsx"

const click = async (container: HTMLElement, label: string) => {
  const button = Array.from(container.querySelectorAll("button")).find((row) => row.textContent === label)!
  expect(button).toBeTruthy()
  await act(async () => { button.click() })
}

const eventually = async (check: () => void) => { await act(async () => { await vi.waitFor(check) }) }
const recovery = (container: HTMLElement) => [...container.querySelectorAll("button")].find((row) => row.textContent === "Recover original reply")

// Keep the SQLite writer, planner, receipt lookup and views real.
// Only the browser connection and external harness are replaced. The
// connection maps handler refusals to the RPC contract's CommandError tag.
const withBoard = async (test: (context: {
  execute: (name: string, payload: Record<string, unknown>) => Effect.Effect<Record<string, unknown>, { _tag: "CommandError"; reason: string }>
  members: (add: string[], remove: string[]) => Promise<unknown>
  receipt: (id: string) => Promise<ReadonlyArray<{ result_json: string }>>
  posts: () => Promise<ReadonlyArray<{ replyToPostId?: string; text: string }>>
  deliveries: () => Promise<ReadonlyArray<unknown>>
  parent: string
}) => Promise<void>) => {
  const rig = makeRig()
  vi.stubEnv("HOME", rig.home)
  vi.stubEnv("LGCODE_HOME", rig.stateFolder)
  try {
    await Effect.runPromise(provideBoard(rig, Effect.gen(function* () {
      const credentials = yield* seedBoard()
      const handler = yield* CommandHandler
      const sql = yield* SqlClient.SqlClient
      const execute = (name: string, payload: Record<string, unknown>) => handler.execute(ownerCredential, name, payload).pipe(
        Effect.mapError(() => ({ _tag: "CommandError" as const, requestId: payload.requestId, reason: "command refused" })),
      )
      const parent = yield* handler.execute(credentials.lead!, "board.post", {
        requestId: freshRequest(), channelId: "room", text: "Please review.", to: [{ _tag: "owner" }], reply: "all",
      })
      yield* Effect.promise(() => test({
        execute,
        parent: parent.postId as string,
        members: (add, remove) => Effect.runPromise(execute("board.members", {
          requestId: freshRequest(), channelId: "room", add, remove,
        })),
        receipt: (id) => Effect.runPromise(sql<{ result_json: string }>`SELECT result_json FROM receipts WHERE caller = 'owner' AND request_id = ${id}`),
        deliveries: () => Effect.runPromise(readLog.pipe(Effect.provideService(SqlClient.SqlClient, sql), Effect.map((rows) => eventsOf(rows, "DeliveryQueued")))),
        posts: () => Effect.runPromise(readLog.pipe(Effect.provideService(SqlClient.SqlClient, sql),
          Effect.map((rows) => eventsOf(rows, "board.PostWritten")))),
      }))
    })))
  } finally {
    vi.unstubAllEnvs()
    removeRig(rig)
  }
}

const mountBoard = async (board: { execute: (name: string, payload: Record<string, unknown>) => Effect.Effect<Record<string, unknown>, unknown>; parent: string }, overrides: Record<string, unknown>) => {
  const container = await mountThread([], { "client.snapshot": (payload: Record<string, unknown>) => board.execute("client.snapshot", payload),
    "client.sequence": (payload: Record<string, unknown>) => board.execute("client.sequence", payload),
    "client.event": (payload: Record<string, unknown>) => board.execute("client.event", payload), ...overrides }, `/#/thread/worker-1?subject=board:${board.parent}`, false)
  await act(async () => { await vi.waitFor(() => expect(container.querySelector<HTMLButtonElement>('[aria-label="Read post"]')?.disabled).toBe(false)) })
  return container
}

it("FR-006 starts a fresh attempt after a receipted planner refusal and membership restoration", () => withBoard(async (board) => {
  const reply = vi.fn((payload: Record<string, unknown>) => board.execute("board.post", payload))
  const container = await mountBoard(board, {
    "board.read": (payload: Record<string, unknown>) => board.execute("board.read", payload), "board.post": reply,
  })
  await click(container, "Read post")
  const field = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply"]')!
  field.value = "Keep my answer."
  await board.members([], ["lead"])
  await click(container, "Send reply")
  await eventually(() => expect(container.textContent).toContain("The engine refused this reply: addressee is not a member"))
  expect(field.value).toBe("Keep my answer.")
  const refused = reply.mock.calls[0]![0]
  const stored = await board.receipt(refused.requestId as string)
  expect(stored).toHaveLength(1)
  expect(JSON.parse(stored[0]!.result_json)).toEqual(expect.arrayContaining([
    expect.objectContaining({ event: expect.objectContaining({
      _tag: "CommandRefused", command: "board.post", reason: "addressee is not a member",
    }) }),
  ]))
  expect((await board.posts()).filter((post) => post.replyToPostId === board.parent)).toHaveLength(0)
  await board.members(["lead"], [])
  // Restoration must not mutate the old receipt. A deliberate new send must
  // use a new key instead of replaying it.
  const replay = await Effect.runPromise(Effect.result(board.execute("board.post", refused)))
  expect(replay).toMatchObject({ _tag: "Failure", failure: { _tag: "CommandError" } })
  await click(container, "Send reply")
  expect(container.textContent).toContain("Reply sent.")
  expect(container.textContent).toContain("Keep my answer.")
  expect(reply).toHaveBeenCalledTimes(2)
  expect(reply.mock.calls[1]![0].requestId).not.toBe(refused.requestId)
  expect((await board.posts()).filter((post) => post.replyToPostId === board.parent)).toEqual([
    expect.objectContaining({ text: "Keep my answer." }),
  ])
}))

it.each(["transport failure", "connection exception"])("FR-006 reuses the committed receipt after an uncertain %s", (outcome) => withBoard(async (board) => {
  let loseResponse = true
  const reply = vi.fn((payload: Record<string, unknown>) => board.execute("board.post", payload).pipe(Effect.flatMap((result) => {
    if (!loseResponse) return Effect.succeed(result)
    loseResponse = false
    return outcome === "transport failure" ? Effect.fail({ _tag: "RpcClientError", reason: "response lost" })
      : Effect.die(new Error("connection lost after commit"))
  })))
  const container = await mountBoard(board, {
    "board.read": (payload: Record<string, unknown>) => board.execute("board.read", payload), "board.post": reply,
  })
  await click(container, "Read post")
  const field = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply"]')!
  field.value = "Only one stored answer."
  await click(container, "Send reply")
  await eventually(() => expect(recovery(container)).toBeDefined())
  expect(field.value).toBe("Only one stored answer.")
  const first = reply.mock.calls[0]![0]
  expect(await board.receipt(first.requestId as string)).toHaveLength(1)
  expect((await board.posts()).filter((post) => post.replyToPostId === board.parent)).toHaveLength(1)
  await click(container, "Recover original reply")
  await eventually(() => expect(container.textContent).toContain("Reply sent."))
  await eventually(() => expect(container.textContent).toContain("Only one stored answer."))
  expect(reply).toHaveBeenCalledTimes(2)
  expect(reply.mock.calls[1]![0]).toEqual(first)
  expect((await board.posts()).filter((post) => post.replyToPostId === board.parent)).toHaveLength(1)
}))

it.each(["database write failed", "command refused"])("594 retains a lost committed reply through edits, navigation and a later admission failure: %s", (reason) => withBoard(async (board) => {
  let calls = 0
  const reply = vi.fn((payload: Record<string, unknown>) => {
    calls++
    if (calls === 2) return Effect.fail({ _tag: "CommandError", reason: "board disabled" })
    return board.execute("board.post", payload).pipe(Effect.flatMap((result) => calls === 1 ? Effect.fail({ _tag: "CommandError", reason }) : Effect.succeed(result)))
  })
  const read = vi.fn((payload: Record<string, unknown>) => board.execute("board.read", payload))
  const container = await mountBoard(board, { "board.read": read, "board.post": reply })
  await click(container, "Read post")
  const field = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply"]')!
  field.value = "Exactly one original answer."
  await click(container, "Send reply")
  await eventually(() => expect(recovery(container)).toBeDefined())
  const original = reply.mock.calls[0]![0]
  const receipt = await board.receipt(original.requestId as string)
  expect(receipt).toHaveLength(1)
  const deliveries = await board.deliveries()
  field.value = "Edited text must not replace the original."
  await act(async () => field.dispatchEvent(new Event("input", { bubbles: true })))
  await act(async () => { history.pushState(null, "", "/#/"); window.dispatchEvent(new PopStateEvent("popstate")) })
  const beforeRead = read.mock.calls.length
  await act(async () => { history.pushState(null, "", `/#/thread/worker-1?subject=board:${board.parent}`); window.dispatchEvent(new PopStateEvent("popstate")) })
  expect(read).toHaveBeenCalledTimes(beforeRead)
  await click(container, "Recover original reply")
  await eventually(() => expect(recovery(container)).toBeDefined())
  expect(reply.mock.calls[1]![0]).toEqual(original)
  expect(container.textContent).toContain("Could not confirm")
  await click(container, "Recover original reply")
  expect(reply.mock.calls.map((row) => row[0])).toEqual([original, original, original])
  await eventually(() => expect(container.textContent).toContain("Reply sent."))
  expect(await board.receipt(original.requestId as string)).toEqual(receipt)
  expect(await board.deliveries()).toEqual(deliveries)
  expect((await board.posts()).filter((post) => post.replyToPostId === board.parent)).toEqual([expect.objectContaining({ text: "Exactly one original answer." })])
}))

it.each(["logout", "expiry"] as const)("594 clears captured reply text and late completion at owner %s", (teardown) => withBoard(async (board) => {
  let release!: () => void
  let expired = false
  const pending = new Promise<void>((done) => { release = done })
  const reply = vi.fn((payload: Record<string, unknown>) => board.execute("board.post", payload).pipe(Effect.flatMap((result) => Effect.promise(() => pending).pipe(Effect.as(result)))))
  const container = await mountBoard(board, { "board.read": (payload: Record<string, unknown>) => board.execute("board.read", payload), "board.post": reply,
    "client.snapshot": (payload: Record<string, unknown>) => expired ? Effect.fail({ _tag: "CommandError", reason: "invalid credential" }) : board.execute("client.snapshot", payload) })
  await click(container, "Read post")
  const field = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply"]')!
  field.value = "Private captured board answer."
  await click(container, "Send reply")
  await vi.waitFor(async () => expect((await board.posts()).filter((post) => post.replyToPostId === board.parent)).toHaveLength(1))
  const original = reply.mock.calls[0]![0], receipt = await board.receipt(original.requestId as string)
  if (teardown === "logout") await click(container, "Log out")
  else {
    expired = true; vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })))
    await act(async () => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")) })
  }
  await act(async () => { await vi.waitFor(() => expect(container.querySelector('form[aria-label="Log in"]')).not.toBeNull()) })
  expect(field.value).toBe("")
  expired = false; vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })))
  const login = container.querySelector<HTMLFormElement>('form[aria-label="Log in"]')!
  login.querySelector<HTMLInputElement>('input')!.value = "synthetic-login"
  await act(async () => login.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
  await act(async () => { await vi.waitFor(() => expect(container.querySelector('[aria-label="Board post"]')).not.toBeNull()) })
  await act(async () => release())
  expect(container.textContent).not.toContain("Private captured board answer.")
  expect(container.textContent).not.toContain("Reply sent.")
  expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Recover original reply")).toBe(false)
  expect(await board.receipt(original.requestId as string)).toEqual(receipt)
  expect((await board.posts()).filter((post) => post.replyToPostId === board.parent)).toHaveLength(1)
}))
