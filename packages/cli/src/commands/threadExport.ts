import { open } from "node:fs/promises"
import { constants } from "node:fs"
import { ClientError, type Client } from "@shephrd/client"
import type { AgentId, EventSequence, RequestId } from "@shephrd/contracts"
import * as Effect from "effect/Effect"

export const exportThread = (client: Client, agentId: string, path: string) => Effect.gen(function* () {
  const readPage = (after: number) => client["client.thread"]({
    requestId: globalThis.crypto.randomUUID() as RequestId, agentId: agentId as AgentId, after: after as EventSequence, limit: 500,
  }).pipe(Effect.flatMap((page) => "data" in page
    // Agent-facing reads keep their data envelope intact. Export needs the
    // owner's structured pages to follow cursors without opening that data.
    ? Effect.fail(new ClientError({ message: "thread export requires the owner identity; agents can use client thread" }))
    : Effect.succeed(page)))
  let page = yield* readPage(0)
  yield* Effect.acquireUseRelease(
    Effect.tryPromise(() => open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600)),
    (file) => Effect.gen(function* () {
      yield* Effect.tryPromise(() => file.chmod(0o600))
      yield* Effect.tryPromise(() => file.truncate(0))
      let after = 0
      for (;;) {
        for (const item of page.items) yield* Effect.tryPromise(() => file.writeFile(`${JSON.stringify(item)}\n`))
        if (page.next === undefined) return
        if (page.next <= after) return yield* new ClientError({ message: "the thread page cursor did not advance" })
        after = page.next
        page = yield* readPage(after)
      }
    }),
    (file) => Effect.promise(() => file.close()).pipe(Effect.ignore)
  )
})
