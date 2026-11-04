import * as Effect from "effect/Effect";
import { expect } from "vitest";
import { appendSetup, call, headSequence, logAfter, ownerCredential, readLog, success } from "../support/handlerRig.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { channel, resolve } from "./fixtures.ts";
import { agent, boardState, change, deliveryText, eventsOf, postAs, queued, wakeFor } from "./wakeFixtures.ts";
import { acceptWake, catchUp, eventually, it, pause, pendingWake, reactorRig, startReactor, stopReactor } from "./reactorFixtures.ts";

const { run } = reactorRig(() => registerRebuildCheck());

it.live("an author's removal delivers one metadata completion and cleans the recipient's wake", () => run((c) => Effect.gen(function* () {
  const id = yield* postAs(c.worker!, { to: [agent("other")] });
  success(yield* call(c.lead!, "board.members", { channelId: "room", add: [], remove: ["worker"] }));
  yield* catchUp;
  expect((yield* boardState).posts[id]?.outcome).toBe("withdrawn");
  expect((yield* boardState).completions[id]).toMatchObject({ authorAgentId: "worker", returns: 0 });
  expect(yield* queued("other")).toEqual([]);
  const completion = yield* pendingWake("worker");
  expect(deliveryText(completion)).toContain("The author was removed from the channel.");
  expect((yield* wakeFor(completion.id)).completionReplyText).toEqual([]);
  const before = yield* headSequence;
  yield* catchUp;
  expect(yield* logAfter(before)).toEqual([]);
  yield* acceptWake(completion.id);
  expect((yield* boardState).completions[id]).toBeUndefined();
})));

for (const kind of ["plain", "group"] as const) {
  it.live(`${kind} author removal and rejoin withdraws the old question and preserves a new one`, () => run((c) => Effect.gen(function* () {
    const channelId = kind === "plain" ? "room" : "group";
    if (kind === "group") {
      yield* change({ _tag: "AgentGrouped", agentId: "worker", groups: ["review"] },
        { _tag: "AgentGrouped", agentId: "other", groups: ["review"] });
      yield* appendSetup([channel({ channelId, kind, group: "review", anchorAgentId: "lead" })]);
    }
    const old = yield* postAs(c.worker!, { channelId, to: [agent("other")] });
    yield* acceptWake((yield* pendingWake("other")).id, "other");
    if (kind === "plain") {
      yield* change({ _tag: "board.ChannelMembersChanged", channelId: "room", membersAdded: [], membersRemoved: [agent("worker")] },
        { _tag: "board.ChannelMembersChanged", channelId: "room", membersAdded: [agent("worker")], membersRemoved: [] });
    } else {
      yield* change({ _tag: "AgentGrouped", agentId: "worker", groups: [] },
        { _tag: "AgentGrouped", agentId: "worker", groups: ["review"] });
    }
    const fresh = yield* postAs(c.worker!, { channelId, to: [agent("other")] });
    yield* catchUp;
    const state = yield* boardState;
    expect(state.posts[old]?.outcome).toBe("withdrawn");
    expect(state.posts[fresh]?.status).toBe("open");
    const completion = yield* pendingWake("worker");
    expect(deliveryText(completion)).toContain("The author was removed from the channel.");
    expect(eventsOf(yield* readLog, "board.PostClosed").filter((event) => event.postId === old)).toHaveLength(1);
  })));
}

it.live("a group addressee's departure survives rejoining after its wake was accepted", () => run((c) => Effect.gen(function* () {
  yield* change({ _tag: "AgentGrouped", agentId: "worker", groups: ["review"] });
  yield* appendSetup([channel({ channelId: "group", kind: "group", group: "review", anchorAgentId: "lead" })]);
  const id = yield* postAs(ownerCredential, { channelId: "group", to: [agent("worker"), agent("lead")] });
  yield* acceptWake((yield* pendingWake()).id);
  yield* change({ _tag: "AgentGrouped", agentId: "worker", groups: [] },
    { _tag: "AgentGrouped", agentId: "worker", groups: ["review"] });
  yield* catchUp;
  expect((yield* boardState).posts[id]?.dispositions.worker).toBe("removed");
  yield* postAs(c.worker!, { channelId: "group", replyTo: id, reply: "none", to: [] });
  expect((yield* boardState).posts[id]?.dispositions.worker).toBe("replied");
})));

it.live("the group anchor and current manager retain membership when they lose the label", () => run(() => Effect.gen(function* () {
  for (const id of ["lead", "worker"]) yield* change({ _tag: "AgentGrouped", agentId: id, groups: ["review"] });
  yield* appendSetup([channel({ channelId: "group", kind: "group", group: "review", anchorAgentId: "lead", manager: agent("worker") })]);
  const id = yield* postAs(ownerCredential, { channelId: "group", to: [agent("lead"), agent("worker")] });
  for (const target of ["lead", "worker"]) yield* change({ _tag: "AgentGrouped", agentId: target, groups: [] });
  yield* catchUp;
  expect((yield* boardState).posts[id]?.dispositions).toEqual({});
  expect((yield* boardState).posts[id]?.status).toBe("open");
})));

it.live("a live group change ends an accepted direct question for its other participant", () => run((c) => Effect.gen(function* () {
  for (const id of ["worker", "other"]) yield* change({ _tag: "AgentGrouped", agentId: id, groups: ["review"] });
  yield* appendSetup([channel({ channelId: "group", kind: "group", group: "review", anchorAgentId: "lead" })]);
  success(yield* call(c.lead!, "board.members", { channelId: "room", add: [], remove: ["worker"] }));
  const id = success(yield* call(c.worker!, "board.post", { direct: agent("other"), text: "Direct question.", to: [agent("other")], reply: "all" })).postId as string;
  yield* acceptWake((yield* pendingWake("other")).id, "other");
  const reactor = yield* startReactor;
  yield* pause(100);
  yield* change({ _tag: "AgentGrouped", agentId: "worker", groups: [] });
  const state = yield* eventually(boardState, (view) => view.posts[id]?.status === "closed");
  expect(state.posts[id]?.dispositions.other).toBe("removed");
  expect(state.posts[id]?.outcome).toBe("unanswerable");
  expect(deliveryText(yield* pendingWake("worker"))).toContain("unanswerable");
  yield* stopReactor(reactor);
})));

it.live("a direct grant restored before the scan leaves an accepted question open", () => run((c) => Effect.gen(function* () {
  const id = success(yield* call(c.worker!, "board.post", { direct: agent("other"), text: "Direct question.", to: [agent("other")], reply: "all" })).postId as string;
  yield* acceptWake((yield* pendingWake("other")).id, "other");
  yield* change({ _tag: "board.ChannelMembersChanged", channelId: "room", membersAdded: [], membersRemoved: [agent("worker")] },
    { _tag: "board.ChannelMembersChanged", channelId: "room", membersAdded: [agent("worker")], membersRemoved: [] });
  yield* catchUp;
  expect((yield* boardState).posts[id]?.status).toBe("open");
  expect((yield* boardState).posts[id]?.dispositions.other).toBeUndefined();
})));

it.live("leaving replaces no-answer even when no queued wake remains", () => run((c) => Effect.gen(function* () {
  yield* change({ _tag: "AgentGrouped", agentId: "worker", groups: ["review"] });
  yield* appendSetup([channel({ channelId: "group", kind: "group", group: "review", anchorAgentId: "lead" })]);
  const id = yield* postAs(c.lead!, { channelId: "group" });
  yield* acceptWake((yield* pendingWake()).id);
  yield* appendSetup([resolve(id, "no-answer")]);
  yield* change({ _tag: "AgentGrouped", agentId: "worker", groups: [] });
  yield* catchUp;
  expect((yield* boardState).posts[id]?.dispositions.worker).toBe("removed");
  expect((yield* boardState).posts[id]?.outcome).toBe("unanswerable");
})));
