import * as Effect from "effect/Effect";
import { expect, it } from "vitest";
import { boardAlertTitles } from "@shephrd/contracts/board/alerts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { awaitCleared, awaitRaised, barrier, raised, withAlerts } from "../support/alertsRig.ts";
import { call, ownerCredential, seedAgent, success } from "../support/handlerRig.ts";
import { agent, change, owner } from "./wakeFixtures.ts";

for (const first of ["worker", "other"]) it(`5.17 the real alert follower keeps the first no-answer thread, first=${first}, and closes its single key with the post`, async () => withAlerts(() => Effect.gen(function* () {
  yield* registerRebuildCheck();
  yield* seedAgent({ id: "worker", state: "paused" });
  yield* seedAgent({ id: "other", state: "paused" });
  const channelId = success(yield* call(ownerCredential, "board.open", { name: "Alerts" })).channelId;
  success(yield* call(ownerCredential, "board.members", { channelId, add: ["worker", "other"], remove: [] }));
  const postId = success(yield* call(ownerCredential, "board.post", { channelId, text: "A private question", to: [agent("worker"), agent("other")], reply: "all" })).postId;
  yield* change({ _tag: "board.AddresseeResolved", postId, addressee: agent(first), disposition: "no-answer", authorIsOwner: true });
  const alerts = yield* awaitRaised(`no-answer:${postId}`);
  expect(alerts).toHaveLength(1);
  expect(alerts[0]!.event).toMatchObject({ kind: "board.no-answer", agentId: first, title: boardAlertTitles["board.no-answer"],
    subject: { _tag: "piece", namespace: "board", id: postId } });
  yield* change({ _tag: "board.AddresseeResolved", postId, addressee: agent(first === "worker" ? "other" : "worker"), disposition: "no-answer", authorIsOwner: true });
  yield* barrier();
  expect(yield* raised(`no-answer:${postId}`)).toHaveLength(1);
  success(yield* call(ownerCredential, "board.close", { postId }));
  expect(yield* awaitCleared(alerts[0]!.event.alertId)).toHaveLength(1);
  expect(JSON.stringify(alerts[0]!.event)).not.toContain("A private question");
  expect(yield* raised(`post:${postId}`)).toEqual([]);
})));

it("5.15 local board subjects become namespaced API subjects and board.post clears when its question closes", async () => withAlerts(() => Effect.gen(function* () {
  yield* registerRebuildCheck();
  yield* seedAgent({ id: "worker", state: "paused" });
  const channelId = success(yield* call(ownerCredential, "board.open", { name: "Owner" })).channelId;
  success(yield* call(ownerCredential, "board.members", { channelId, add: ["worker"], remove: [] }));
  yield* change({ _tag: "board.PostWritten", channelId, postId: "owner-alert", author: agent("worker"), text: "Owner question", to: [owner], reply: "all" });
  const alerts = yield* awaitRaised("post:owner-alert");
  expect(alerts).toHaveLength(1);
  expect(alerts[0]!.event).toMatchObject({ kind: "board.post", agentId: "worker", subject: { _tag: "piece", namespace: "board", id: "owner-alert" } });
  success(yield* call(ownerCredential, "board.post", { channelId, text: "Answer", replyTo: "owner-alert", to: [], reply: "none" }));
  expect(yield* awaitCleared(alerts[0]!.event.alertId)).toHaveLength(1);
})));
