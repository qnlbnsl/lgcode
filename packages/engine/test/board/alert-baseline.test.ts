import * as Effect from "effect/Effect"
import { expect, it } from "vitest"
import { engineLists } from "../../src/pieces/lists.ts"
import { append, awaitCleared, eventsOf, raised, quietLists, withAlerts } from "../support/alertsRig.ts"
import { makeRig, removeRig, seedAgent } from "../support/handlerRig.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { owner } from "./wakeFixtures.ts"

it("7.5 first-start baseline raises and clears an open post to the owner without delivering it", async () => {
  const rig = makeRig()
  try {
    let postId = ""
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck()
      yield* seedAgent({ id: "lead", state: "idle" })
      postId = "baseline-owner-post"
      yield* append(
        { _tag: "board.ChannelOpened", channelId: "owner-questions", name: "Owner-questions", kind: "plain",
          opener: owner, manager: owner, members: [owner, { _tag: "agent", agentId: "lead" }] },
        { _tag: "board.PostWritten", postId, channelId: "owner-questions", author: { _tag: "agent", agentId: "lead" },
          text: "A private question for the owner.", to: [owner], reply: "all" },
      )
    }), { rig, lists: quietLists(engineLists) })

    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck()
      const rows = yield* raised(`post:${postId}`)
      expect(rows).toHaveLength(1) // catches a first-start scan that misses existing owner-directed posts
      expect(rows[0]!.event).toMatchObject({ kind: "board.post", agentId: "lead", baseline: true,
        subject: { _tag: "piece", namespace: "board", id: postId } }) // catches a non-baseline or misidentified alert
      expect(JSON.stringify(rows[0]!.event)).not.toContain("A private question for the owner.") // catches leaking post text into the alert
      expect(yield* eventsOf("client.AlertDelivered")).toEqual([]) // catches pushing a baseline alert to a carrier
      yield* append({ _tag: "board.PostClosed", postId, outcome: "answered", closer: owner, completionOwed: true })
      expect(yield* awaitCleared(rows[0]!.event.alertId)).toHaveLength(1) // catches leaving a closed post's alert open
    }), { rig, initialize: false })
  } finally { removeRig(rig) }
})
