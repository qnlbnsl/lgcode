import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { completionFor } from "../../src/board/wake.ts";
import { appendSetup, call, headSequence, logAfter, makeRig, ownerCredential, removeRig, success, type Credential, type Rig } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { channel, post, queue, resolve, wake } from "./fixtures.ts";
import { agent, appendDelivery, boardState, change, deliveryText, eventsOf, owner, postAs, provideBoard, queued, seedBoard, snapshot, wakeFor } from "./wakeFixtures.ts";

let rig: Rig;
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("SHEPRD_HOME", rig.stateFolder); });
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig); });
const run = <A, E, R>(body: (credentials: Record<string, Credential>) => Effect.Effect<A, E, R>) => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck();
  return yield* body(yield* seedBoard());
})).pipe(Effect.orDie);

it.live("the owner can take a question without being an explicit channel member", () => run((c) => Effect.gen(function* () {
  const opened = success(yield* call(c.lead!, "board.open", { name: "OwnerQuestion" }));
  const id = yield* postAs(c.lead!, { channelId: opened.channelId, to: [owner] });
  success(yield* call(ownerCredential, "board.acknowledge", { postId: id }));
  expect((yield* boardState).posts[id]?.acknowledged).toEqual([owner]);
  expect(yield* queued()).toEqual([]);
})));

it.live("a non-addressee reply cannot close a post while its reactor outcome is pending", () => run((c) => Effect.gen(function* () {
  const id = yield* postAs(c.lead!);
  yield* appendSetup([resolve(id, "gone")]);
  const before = yield* headSequence;
  yield* postAs(c.other!, { replyTo: id, reply: "none", to: [] });
  expect((yield* boardState).posts[id]?.status).toBe("open");
  expect(eventsOf(yield* logAfter(before), "board.PostClosed")).toEqual([]);
})));

it.live("an owner's late reply is readable but does not become a deciding reply", () => run((c) => Effect.gen(function* () {
  const id = yield* postAs(c.lead!);
  const deciding = yield* postAs(c.worker!, { replyTo: id, reply: "none", to: [] });
  const late = yield* postAs(ownerCredential, { replyTo: id, reply: "none", to: [] });
  const payload = completionFor(yield* snapshot, id);
  expect(payload.totalReplies).toBe(2);
  expect(payload.replyIds).toEqual([deciding]);
  expect(payload.replyIds).not.toContain(late);
})));

it.live("an owner's closing reply is preserved across later replies and rebuilding", () => run((c) => Effect.gen(function* () {
  const id = yield* postAs(c.lead!);
  const deciding = yield* postAs(ownerCredential, { replyTo: id, reply: "none", to: [] });
  yield* postAs(ownerCredential, { replyTo: id, reply: "none", to: [] });
  expect(completionFor(yield* snapshot, id).replyIds).toEqual([deciding]);
})));

it.live("a queued completion loses its reply text when its author leaves the channel", () => run((c) => Effect.gen(function* () {
  const id = yield* postAs(c.lead!);
  yield* postAs(c.worker!, { replyTo: id, text: "Reply visible only to a member.", reply: "none", to: [] });
  const [old] = yield* queued("lead");
  expect((yield* wakeFor(old!.id)).completionReplyText).toEqual([id]);
  success(yield* call(ownerCredential, "board.members", { channelId: "room", add: [], remove: ["lead"] }));
  expect((yield* snapshot).deliveries[old!.id]?.status).toBe("withdrawn");
  const [replacement] = yield* queued("lead");
  expect(yield* wakeFor(replacement!.id)).toMatchObject({ completions: [id], completionReplyText: [] });
  expect(deliveryText(replacement!)).not.toContain("Reply visible only to a member.");
  expect((yield* boardState).completions[id]).toBeDefined();
})));

it.live("cleanup retains an already queued reminder while an engine prompt waits", () => run((c) => Effect.gen(function* () {
  const id = yield* postAs(c.lead!);
  const [old] = yield* queued("worker");
  yield* appendSetup([post("reminded-question"), wake("taken-question", { carried: ["reminded-question"], mustReply: ["reminded-question"] }), queue("taken-question")]);
  yield* appendDelivery("DeliverySent", "delivery-taken-question", "worker");
  yield* appendDelivery("DeliveryAccepted", "delivery-taken-question", "worker");
  yield* change({ _tag: "TurnEnded", agentId: "worker", compact: false });
  yield* change({ _tag: "DeliveryWithdrawn", agentId: "worker", deliveryId: old!.id, reason: "Fixture replacement." });
  yield* appendSetup([wake("mixed-reminder", { carried: [id], mustReply: [id], reminders: ["reminded-question"] }), queue("mixed-reminder")]);
  success(yield* call(ownerCredential, "prompt", { agentId: "worker", text: "An intervening engine prompt." }));
  success(yield* call(c.worker!, "board.acknowledge", { postId: id }));
  const [replacement] = yield* queued("worker");
  expect((yield* wakeFor(replacement!.id)).reminders).toEqual(["reminded-question"]);
})));

it.live("cleanup leaves a stopped group addressee to the lifecycle rule", () => run((c) => Effect.gen(function* () {
  yield* change({ _tag: "AgentGrouped", agentId: "worker", groups: ["review"] });
  yield* appendSetup([channel({ channelId: "group-room", name: "Group", kind: "group", group: "review", anchorAgentId: "lead", members: [] })]);
  const id = yield* postAs(c.lead!, { channelId: "group-room" });
  // Exercise the window after the stop event and before lifecycle repair.
  yield* change({ _tag: "AgentStopped", agentId: "worker" });
  yield* postAs(c.lead!, { reply: "none", to: [] });
  expect((yield* boardState).posts[id]?.dispositions.worker).toBeUndefined();
  expect(yield* queued("worker")).toEqual([]);
})));

it.live("a reach-loss close cleans every queued copy before replacements are built", () => run((c) => Effect.gen(function* () {
  const id = yield* postAs(c.lead!, { to: [agent("worker"), agent("other")] });
  yield* appendSetup([resolve(id, "gone", { addressee: agent("other") })]);
  success(yield* call(c.lead!, "board.members", { channelId: "room", add: [], remove: ["worker"] }));
  expect((yield* boardState).posts[id]).toMatchObject({ status: "closed", outcome: "unanswerable" });
  expect(yield* queued("worker")).toEqual([]);
  expect(yield* queued("other")).toEqual([]);
  expect((yield* wakeFor((yield* queued("lead"))[0]!.id)).completions).toEqual([id]);
})));
