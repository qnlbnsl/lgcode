import * as Effect from "effect/Effect"
import { expect, it } from "vitest"
import { engineLists } from "../../src/pieces/lists.ts"
import { append, awaitCleared, eventsOf, raised, quietLists, withAlerts } from "../support/alertsRig.ts"
import { makeRig, removeRig, seedAgent } from "../support/handlerRig.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { owner } from "./wakeFixtures.ts"

// The contract permits a silent addressee as the thread. Live sources keep
// the first resolution; a fresh scan selects the first silent target in `to`
// order. These need one shared key, not an invented cross-start tie rule.
it("7.5 a fresh alert follower scans rebuilt reverse-order no-answers, selects the first target and clears one baseline key", async () => {
  const rig = makeRig()
  try {
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck()
      yield* seedAgent({ id: "worker", state: "paused" })
      yield* seedAgent({ id: "other", state: "paused" })
      yield* append(
        { _tag: "board.ChannelOpened", channelId: "silent", name: "Silent", kind: "plain", opener: owner, manager: owner,
          members: [owner, { _tag: "agent", agentId: "worker" }, { _tag: "agent", agentId: "other" }] },
        { _tag: "board.PostWritten", postId: "silent-post", channelId: "silent", author: owner, text: "Please decide.",
          to: [{ _tag: "agent", agentId: "worker" }, { _tag: "agent", agentId: "other" }], reply: "all" },
        ...["other", "worker"].map((agentId) => ({ _tag: "board.AddresseeResolved", postId: "silent-post",
          addressee: { _tag: "agent", agentId }, disposition: "no-answer", authorIsOwner: true })),
      )
      expect(yield* raised("no-answer:silent-post")).toEqual([])
    }), { rig, lists: quietLists(engineLists) })
    await withAlerts(() => Effect.gen(function* () {
      yield* registerRebuildCheck()
      const rows = yield* raised("no-answer:silent-post")
      expect(rows).toHaveLength(1)
      expect(rows[0]!.event).toMatchObject({ kind: "board.no-answer", agentId: "worker", baseline: true,
        subject: { _tag: "piece", namespace: "board", id: "silent-post" } })
      expect(yield* eventsOf("client.AlertDelivered")).toEqual([])
      yield* append({ _tag: "board.PostClosed", postId: "silent-post", outcome: "withdrawn", closer: owner, completionOwed: false })
      expect(yield* awaitCleared(rows[0]!.event.alertId)).toHaveLength(1)
      expect(yield* raised("no-answer:silent-post")).toHaveLength(1)
    }), { rig, initialize: false })
  } finally { removeRig(rig) }
})

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
