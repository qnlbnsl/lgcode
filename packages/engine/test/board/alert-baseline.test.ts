import * as Effect from "effect/Effect"
import { expect, it } from "vitest"
import { threadHref, threadLocation } from "../../../web/src/thread/links.ts"
import { engineLists } from "../../src/pieces/lists.ts"
import { append, awaitCleared, awaitRaised, barrier, eventsOf, raised, quietLists, withAlerts } from "../support/alertsRig.ts"
import { call, makeRig, ownerCredential, removeRig, seedAgent, success } from "../support/handlerRig.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { owner } from "./wakeFixtures.ts"

// The first actual no-answer resolution identifies the alert thread.
// Rebuilt scans preserve that same identity, independently of recipient order.
// This first-start case also retains baseline suppression and close checks.
it("7.5 a fresh alert follower scans rebuilt reverse-order no-answers, preserves the first resolution and clears one baseline key", async () => {
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
      expect(rows[0]!.event).toMatchObject({ kind: "board.no-answer", agentId: "other", baseline: true,
        subject: { _tag: "piece", namespace: "board", id: "silent-post" } })
      expect(yield* eventsOf("client.AlertDelivered")).toEqual([])
      yield* append({ _tag: "board.PostClosed", postId: "silent-post", outcome: "withdrawn", closer: owner, completionOwed: false })
      expect(yield* awaitCleared(rows[0]!.event.alertId)).toHaveLength(1)
      expect(yield* raised("no-answer:silent-post")).toHaveLength(1)
    }), { rig, initialize: false })
  } finally { removeRig(rig) }
})

it.each(["close", "dismiss"] as const)("FR-041 reverse-order silent recipients retain the same live and baseline thread through %s", async (ending) => {
  const identities: unknown[] = []
  for (const baseline of [false, true]) {
    const rig = makeRig()
    const setup = () => Effect.gen(function* () {
      yield* seedAgent({ id: "first", state: "idle" })
      yield* seedAgent({ id: "second", state: "idle" })
      yield* append(
        { _tag: "board.ChannelOpened", channelId: "silent", name: "Silent", kind: "plain", opener: owner, manager: owner,
          members: [owner, { _tag: "agent", agentId: "first" }, { _tag: "agent", agentId: "second" }] },
        { _tag: "board.PostWritten", postId: "silent-post", channelId: "silent", author: owner, text: "Reply, please.", reply: "all",
          to: [{ _tag: "agent", agentId: "first" }, { _tag: "agent", agentId: "second" }] },
        { _tag: "board.AddresseeResolved", postId: "silent-post", addressee: { _tag: "agent", agentId: "second" }, disposition: "no-answer", authorIsOwner: true },
        { _tag: "board.AddresseeResolved", postId: "silent-post", addressee: { _tag: "agent", agentId: "first" }, disposition: "no-answer", authorIsOwner: true },
      )
    })
    try {
      if (baseline) await withAlerts(() => Effect.gen(function* () {
        yield* registerRebuildCheck(); yield* setup()
      }), { rig, lists: quietLists(engineLists) })
      await withAlerts(() => Effect.gen(function* () {
        yield* registerRebuildCheck()
        if (!baseline) yield* setup()
        const rows = yield* awaitRaised("no-answer:silent-post")
        yield* barrier()
        expect(yield* raised("no-answer:silent-post")).toHaveLength(1)
        const event = rows[0]!.event
        const page = success(yield* call(ownerCredential, "client.alerts.list", { after: 0, limit: 100 }))
        const item = page.items.find((row: { alertId: string }) => row.alertId === event.alertId)!
        const identity = { key: item.alertKey, kind: item.kind, subject: item.subject, agentId: item.agentId,
          route: threadHref(item.agentId, `${item.subject.namespace}:${item.subject.id}`) }
        expect(identity).toEqual({ key: "no-answer:silent-post", kind: "board.no-answer",
          subject: { _tag: "piece", namespace: "board", id: "silent-post" }, agentId: "second", route: "/#/thread/second?subject=board%3Asilent-post" })
        expect(threadLocation(`https://example.test${identity.route}`)).toEqual({ agentId: "second", subject: "board:silent-post" })
        identities.push(identity)
        expect(event.baseline === true).toBe(baseline)
        expect(yield* eventsOf("client.AlertDelivered")).toEqual([])
        if (ending === "close") yield* append({ _tag: "board.PostClosed", postId: "silent-post", outcome: "answered", closer: owner, completionOwed: false })
        else success(yield* call(ownerCredential, "client.alerts.dismiss", { alertId: event.alertId }))
        expect(yield* awaitCleared(event.alertId)).toHaveLength(1)
        yield* barrier("after-ending")
        expect(yield* raised("no-answer:silent-post")).toHaveLength(1)
      }), { rig, initialize: !baseline })
    } finally { removeRig(rig) }
  }
  expect(identities[0]).toEqual(identities[1])
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
