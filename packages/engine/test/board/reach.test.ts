import type { Caller } from "@sheprd/contracts";
import { expect, it } from "vitest";

import type { Snapshot } from "../../src/commands/internal.ts";
import { engineLists } from "../../src/pieces/lists.ts";
import { canReach } from "../../src/routing/reach.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import {
  access, agent, board, direct, event, group, membersChanged, owner, plain, post, service, session,
  snapshot, stop, tree, withCeilings,
} from "./accessFixtures.ts";
import { close, queue, resolve, wake } from "./fixtures.ts";

registerRebuildCheck({ noLog: true }); // Real folds and replay checks are in snapshot().

const judge = (view: Snapshot, wakeId = "wake", target = "worker", caller?: Caller) => canReach({
  snapshot: view, target, deliveryId: `delivery-${wakeId}`, source: { _tag: "piece", namespace: "board", id: wakeId },
  ...(caller === undefined ? {} : { caller }),
}, engineLists);
const question = post("question");
const questionWake = wake("wake", { carried: ["question"], mustReply: ["question"] });

it("2.11 queue: catches retaining the default refusal or looking up a delivery before it exists", () => {
  const view = snapshot(...tree, plain, question, questionWake);
  expect(board(view).wakes["wake"]?.deliveryId).toBeUndefined();
  expect(view.deliveries["delivery-wake"]).toBeUndefined();
  expect(judge(view, "wake", "worker", agent("lead")), "the projected batch's source id must find its new WakeBuilt").toBe(true);
});

it.each([undefined, owner, agent("lead"), agent("other")] as const)(
  "2.11 caller %j: catches applying caller tree rules instead of each carried post's author", (caller) => {
    const view = snapshot(...tree, plain, question, questionWake, queue("wake"));
    expect(judge(view, "wake", "worker", caller)).toBe(true);
  },
);

it("2.11 wake identity: catches judging another wake, the entire board or a mismatched target", () => {
  const view = snapshot(...tree, plain, question,
    post("stale", { channelId: "room", to: [], reply: "none" }),
    wake("bad", { targetAgentId: "cousin", carried: ["stale"] }), queue("bad", "delivery-bad", "cousin"),
    questionWake, queue("wake"));
  expect(judge(view)).toBe(true);
  expect(judge(view, "bad", "cousin")).toBe(false);
  expect(judge(view, "missing")).toBe(false);
  expect(judge(view, "wake", "other")).toBe(false);
});

it("2.11 send: catches using queue-time membership after the target is removed", () => {
  const events = [...tree, plain, question, questionWake, queue("wake")];
  expect(judge(snapshot(...events))).toBe(true);
  expect(judge(snapshot(...events, membersChanged("room", ["worker"])))).toBe(false);
});

it("2.11 queue projection: catches ignoring a membership change in the same command batch", () => {
  expect(judge(snapshot(...tree, plain, question, questionWake))).toBe(true);
  const view = snapshot(...tree, plain, question, membersChanged("room", ["worker"]), questionWake);
  expect(board(view).wakes["wake"]?.deliveryId).toBeUndefined();
  expect(judge(view)).toBe(false);
});

it("2.11 group reach: catches admitting another subtree's label or ignoring a removed label", () => {
  const events = [...tree, group(), post("question", { channelId: "group" }), questionWake];
  expect(judge(snapshot(...events))).toBe(true);
  expect(judge(snapshot(...events, event({ _tag: "AgentGrouped", agentId: "worker", groups: [] })))).toBe(false);
  const foreign = snapshot(...tree, group(), post("foreign", { channelId: "group", to: [agent("cousin")] }),
    wake("foreign", { targetAgentId: "cousin", carried: ["foreign"], mustReply: ["foreign"] }));
  expect(judge(foreign, "foreign", "cousin")).toBe(false);
});

it("2.11 direct reach: catches delivering after a shared-channel grant ends", () => {
  const events = [...tree, plain, direct(agent("worker"), agent("other")),
    post("question", { channelId: "direct", author: agent("other") }), questionWake, queue("wake")];
  expect(judge(snapshot(...events))).toBe(true);
  expect(judge(snapshot(...events, membersChanged("room", ["worker"])))).toBe(false);
});

it.each(["queue", "send"] as const)("2.11 service direct at %s: catches refusing a legitimate service wake", (stage) => {
  const events = [...tree, direct(service, agent("worker")), post("question", { channelId: "direct", author: service }), questionWake];
  const view = snapshot(...events, ...(stage === "send" ? [queue("wake")] : []));
  expect(judge(view, "wake", "worker", service)).toBe(true);
  expect(judge(snapshot(...events, stop("worker")), "wake", "worker", service)).toBe(false);
});

it("2.11 ceiling: catches obliging a wider sibling despite its reported narrow mode", () => {
  const events = [...withCeilings({ worker: "full", other: "read-only" }), plain,
    event({ _tag: "ModeChanged", agentId: "worker", mode: "read-only", level: "read-only" }),
    post("digest", { author: agent("other"), reply: "none", to: [] }),
    post("obligation", { author: agent("other") })];
  const view = snapshot(...events, wake("digest", { carried: ["digest"] }),
    wake("obligation", { carried: ["obligation"], mustReply: ["obligation"] }));
  expect(judge(view, "digest")).toBe(true);
  expect(judge(view, "obligation")).toBe(false);
});

it.each([owner, service] as const)("2.11 author %j: catches imposing agent ceilings on owner or service posts", (author) => {
  const view = snapshot(...withCeilings({ worker: "full" }), plain,
    post("question", { author }), questionWake);
  expect(judge(view)).toBe(true);
});

it("2.11 digest of another agent's question: catches applying the ceiling to a target that owes no reply", () => {
  const view = snapshot(...withCeilings({ worker: "full", other: "read-only" }), plain,
    post("for-lead", { author: agent("other"), to: [agent("lead")] }),
    wake("digest", { carried: ["for-lead"] }));
  expect(judge(view, "digest")).toBe(true);
});

it("2.11 per-post reach: catches treating a stale digest as permission to reject unrelated new work", async () => {
  const view = snapshot(...tree, plain,
    event({ _tag: "board.ChannelOpened", channelId: "lost", name: "Lost", kind: "plain", opener: agent("lead"),
      manager: agent("lead"), members: [agent("lead"), agent("worker")] }),
    post("old-digest", { channelId: "lost", reply: "none", to: [] }),
    post("old-question", { channelId: "lost" }), question, membersChanged("lost", ["worker"]),
    wake("mixed", { carried: ["old-digest", "old-question", "question"], mustReply: ["old-question", "question"] }),
    questionWake);
  const rules = await access();
  const before = structuredClone(view);
  expect(rules.canCarryPost(view, "worker", "old-digest")).toBe(false);
  expect(rules.canCarryPost(view, "worker", "old-question")).toBe(false);
  expect(rules.canCarryPost(view, "worker", "question")).toBe(true);
  expect(judge(view, "mixed")).toBe(false);
  expect(judge(view)).toBe(true);
  expect(view, "pure reach returns decisions; planners and the reactor own removed dispositions").toEqual(before);
  expect(board(view).posts["old-question"]?.dispositions).toEqual({});
});

it("2.11 metadata-only completion: catches losing a completion when its author left the channel", () => {
  const events = [...tree, plain, post("done", { author: agent("worker"), to: [agent("other")] }),
    resolve("done", "removed", { addressee: agent("other") }), close("done", { outcome: "unanswerable" }),
    membersChanged("room", ["worker"]), wake("completion", { completions: ["done"] }), queue("completion")];
  expect(judge(snapshot(...events), "completion")).toBe(true);
});

const answered = [...tree, plain, post("done", { author: agent("worker"), to: [agent("other")] }),
  post("reply", { author: agent("other"), reply: "none", to: [], replyToPostId: "done" }),
  resolve("done", "replied", { addressee: agent("other"), decidingPostId: "reply" }), close("done"),
  wake("completion", { completions: ["done"], completionReplyText: ["done"] }), queue("completion")];

it("2.11 completion with reply text: catches leaking a captured reply after author membership is removed", () => {
  expect(judge(snapshot(...answered), "completion")).toBe(true);
  expect(judge(snapshot(...answered, membersChanged("room", ["worker"])), "completion")).toBe(false);
});

it("2.11 completion text policy: catches refusing the metadata replacement merely because replies exist", async () => {
  const before = snapshot(...answered);
  const after = snapshot(...answered, membersChanged("room", ["worker"]));
  const rules = await access();
  expect(rules.canCarryCompletion(before, "worker", "done", true)).toBe(true);
  expect(rules.canCarryCompletion(after, "worker", "done", true)).toBe(false);
  expect(rules.canCarryCompletion(after, "worker", "done", false)).toBe(true);
});

it("2.11 completion direct grant: catches leaking reply text after the last shared-channel grant ends", async () => {
  const events = [...tree, plain, direct(agent("worker"), agent("other")),
    post("done", { channelId: "direct", author: agent("worker"), to: [agent("other")] }),
    post("reply", { channelId: "direct", author: agent("other"), reply: "none", to: [], replyToPostId: "done" }),
    resolve("done", "replied", { addressee: agent("other"), decidingPostId: "reply" }), close("done")];
  const rules = await access();
  expect(rules.canCarryCompletion(snapshot(...events), "worker", "done", true)).toBe(true);
  const lost = snapshot(...events, membersChanged("room", ["worker"]));
  expect(rules.canCarryCompletion(lost, "worker", "done", true)).toBe(false);
  expect(rules.canCarryCompletion(lost, "worker", "done", false)).toBe(true);
});

it("2.11 group crash: catches dropping membership when an author crashes and resumes", () => {
  const events = [...tree, group(), post("question", { channelId: "group", author: agent("other") }), questionWake];
  expect(judge(snapshot(...events))).toBe(true);
  expect(judge(snapshot(...events, event({ _tag: "AgentCrashed", agentId: "other", exitCode: 1, signal: null, stderr: "Fixture crash." }),
    session("other", true)))).toBe(true);
});
