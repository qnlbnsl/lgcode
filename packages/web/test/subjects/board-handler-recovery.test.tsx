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

// Keep the SQLite writer, planner, receipt lookup and views real.
// Only the browser connection and external harness are replaced. The
// connection maps handler refusals to the RPC contract's CommandError tag.
const withBoard = async (test: (context: {
  execute: (name: string, payload: Record<string, unknown>) => Effect.Effect<Record<string, unknown>, { _tag: "CommandError"; reason: string }>
  members: (add: string[], remove: string[]) => Promise<unknown>
  receipt: (id: string) => Promise<ReadonlyArray<{ result_json: string }>>
  posts: () => Promise<ReadonlyArray<{ replyToPostId?: string; text: string }>>
  parent: string
}) => Promise<void>) => {
  const rig = makeRig()
  vi.stubEnv("HOME", rig.home)
  vi.stubEnv("SHEPRD_HOME", rig.stateFolder)
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
        posts: () => Effect.runPromise(readLog.pipe(Effect.provideService(SqlClient.SqlClient, sql),
          Effect.map((rows) => eventsOf(rows, "board.PostWritten")))),
      }))
    })))
  } finally {
    vi.unstubAllEnvs()
    removeRig(rig)
  }
}

it("FR-006 starts a fresh attempt after a receipted planner refusal and membership restoration", () => withBoard(async (board) => {
  const reply = vi.fn((payload: Record<string, unknown>) => board.execute("board.post", payload))
  const container = await mountThread([], {
    "board.read": (payload: Record<string, unknown>) => board.execute("board.read", payload), "board.post": reply,
  }, `/#/thread/worker-1?subject=board:${board.parent}`)
  await click(container, "Read post")
  const field = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply"]')!
  field.value = "Keep my answer."
  await board.members([], ["lead"])
  await click(container, "Send reply")
  expect(container.textContent).toContain("command refused")
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
  const container = await mountThread([], {
    "board.read": (payload: Record<string, unknown>) => board.execute("board.read", payload), "board.post": reply,
  }, `/#/thread/worker-1?subject=board:${board.parent}`)
  await click(container, "Read post")
  const field = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply"]')!
  field.value = "Only one stored answer."
  await click(container, "Send reply")
  expect(field.value).toBe("Only one stored answer.")
  const first = reply.mock.calls[0]![0]
  expect(await board.receipt(first.requestId as string)).toHaveLength(1)
  expect((await board.posts()).filter((post) => post.replyToPostId === board.parent)).toHaveLength(1)
  await click(container, "Send reply")
  expect(container.textContent).toContain("Reply sent.")
  expect(container.textContent).toContain("Only one stored answer.")
  expect(reply).toHaveBeenCalledTimes(2)
  expect(reply.mock.calls[1]![0]).toEqual(first)
  expect((await board.posts()).filter((post) => post.replyToPostId === board.parent)).toHaveLength(1)
}))
