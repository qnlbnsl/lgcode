import type { Event, EventEnvelope } from "@shephrd/contracts";
import { expect, it } from "vitest";

import { apply, emptyViews } from "../../src/views/apply.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { journey } from "../support/viewFixtures.ts";
import {
  accept, agent, channel, close, envelopes, event, freeze, owner, position, post, queue,
  read, requiredModule, resolve, returned, scenario, setup, start, wake, type BoardModule,
} from "./fixtures.ts";

registerRebuildCheck({ noLog: true });

it("fold: emptyBoard isolates empty collections between independent engines", async () => {
  const { emptyBoard } = await requiredModule<BoardModule>("view");
  const first = emptyBoard();
  expect(first).toMatchObject({
    channels: {}, posts: {}, completions: {}, noAnswers: {}, wakes: {}, lastTurnEnd: {},
    ceilings: {}, stopped: [], lastStopped: {}, lastCrashed: {}, labels: {},
    lastLabelLeft: {}, lastMemberLeft: {}, readState: {},
  });
  expect(emptyBoard()).not.toBe(first);
});

it("fold: channels preserve their opener and group anchor, and a direct channel has no manager", async () => {
  const { state } = await scenario([...setup,
    channel({ channelId: "group", name: "Group", kind: "group", group: "build", anchorAgentId: "lead" }),
    event({ _tag: "board.ChannelOpened", channelId: "direct", name: "Direct", kind: "direct",
      opener: { _tag: "service", service: "watcher" }, members: [agent("worker"), { _tag: "service", service: "watcher" }] }),
  ]);
  expect(state.channels["room"]).toMatchObject({ opener: agent("lead"), manager: agent("lead"), seatSequence: 4 });
  expect(state.channels["room"]?.members).toContainEqual(agent("lead"));
  expect(state.channels["group"]).toMatchObject({ kind: "group", group: "build", anchorAgentId: "lead", seatSequence: 5 });
  expect(state.channels["direct"]).toMatchObject({ kind: "direct", members: [agent("worker"), { _tag: "service", service: "watcher" }] });
  expect(state.channels["direct"]?.manager).toBeUndefined();
});

it("fold: member removal and rejoin preserve the last-left sequence; moving the seat preserves the opener and existing member's unread position", async () => {
  const { state } = await scenario([...setup, post("old"),
    event({ _tag: "board.ChannelMembersChanged", channelId: "room", membersAdded: [], membersRemoved: [agent("worker")] }),
    event({ _tag: "board.ChannelMembersChanged", channelId: "room", membersAdded: [agent("worker")], membersRemoved: [] }),
    event({ _tag: "board.ManagerChanged", channelId: "room", manager: agent("other") }),
  ]);
  expect(state.lastMemberLeft["room"]?.["worker"]).toBe(6);
  expect(state.channels["room"]).toMatchObject({ manager: agent("other"), opener: agent("lead"), seatSequence: 8 });
  expect(state.channels["room"]?.members).toContainEqual(agent("lead"));
  expect(position(state)).toEqual({ watermark: 5, above: [] });
  expect(position(state, "other")).toEqual({ watermark: 0, above: [] });
});

it("fold: PostWritten retains post order and replyTo, and records every reply in order", async () => {
  const { state } = await scenario([...setup, post("question"),
    post("reply-1", { author: agent("worker"), to: [], reply: "none", replyToPostId: "question" }),
    post("reply-2", { author: owner, to: [], reply: "none", replyToPostId: "question" }),
  ]);
  expect(state.posts["question"]).toMatchObject({ sequence: 5, status: "open", reply: "all", to: [agent("worker")], replies: ["reply-1", "reply-2"] });
  expect(state.posts["reply-1"]).toMatchObject({ sequence: 6, replyTo: "question", author: agent("worker"), text: "Text for reply-1." });
});

it("fold: acknowledgement marks only its addressee read and taken without resolving or closing the question", async () => {
  const { state } = await scenario([...setup, post("question", { to: [agent("worker"), agent("other")] }),
    event({ _tag: "board.PostAcknowledged", postId: "question", addressee: agent("worker") }),
    event({ _tag: "board.PostAcknowledged", postId: "question", addressee: agent("worker") }),
  ]);
  expect(state.posts["question"]).toMatchObject({ status: "open", dispositions: {}, acknowledged: [agent("worker")], takenAt: { worker: 6 } });
  expect(position(state)).toEqual({ watermark: 5, above: [] });
  expect(position(state, "other")).toEqual({ watermark: 0, above: [] });
});

it("fold: resolving a reply retains the deciding id and acknowledgement; a later duplicate cannot overwrite it", async () => {
  const { state } = await scenario([...setup, post("question"),
    post("answer", { author: agent("worker"), reply: "none", to: [], replyToPostId: "question" }),
    resolve("question", "replied", { decidingPostId: "answer" }),
    resolve("question", "gone"),
  ]);
  expect(state.posts["question"]).toMatchObject({ dispositions: { worker: "replied" }, decidingReplies: { worker: "answer" } });
  expect(state.posts["question"]?.acknowledged).toContainEqual(agent("worker"));
});

it.each(["gone", "removed", "undeliverable", "no-answer"])(
  "fold: an open post upgrades %s to replied without losing the deciding reply", async (disposition) => {
    const { state } = await scenario([...setup, post("question"), resolve("question", disposition),
      post("late", { author: agent("worker"), reply: "none", to: [], replyToPostId: "question" }),
      resolve("question", "replied", { decidingPostId: "late" }),
    ]);
    expect(state.posts["question"]).toMatchObject({ status: "open", dispositions: { worker: "replied" }, decidingReplies: { worker: "late" } });
    expect(Object.values(state.noAnswers)).toEqual([]);
  },
);

it.each(["gone", "removed"])("fold: lifecycle disposition %s replaces no-answer", async (disposition) => {
  const { state } = await scenario([...setup, post("question"), resolve("question", "no-answer"), resolve("question", disposition)]);
  expect(state.posts["question"]?.dispositions).toEqual({ worker: disposition });
});

it("fold: a closed post does not change its deciding disposition on a later reply", async () => {
  const { state } = await scenario([...setup, post("question"), resolve("question", "gone"),
    close("question", { outcome: "unanswerable", closer: owner }),
    post("late", { author: agent("worker"), reply: "none", to: [], replyToPostId: "question" }),
    resolve("question", "replied", { decidingPostId: "late" }),
  ]);
  expect(state.posts["question"]).toMatchObject({ status: "closed", outcome: "unanswerable", dispositions: { worker: "gone" }, decidingReplies: {}, replies: ["late"] });
});

it.each(["answered", "unanswerable", "withdrawn"])("fold: PostClosed persists %s and exactly the event's completion debt", async (outcome) => {
  const { state } = await scenario([...setup, post("owed"), post("self-closed"),
    close("owed", { outcome, closer: owner }),
    close("self-closed", { outcome: "withdrawn", closer: agent("lead"), completionOwed: false }),
  ]);
  expect(state.posts["owed"]).toMatchObject({ status: "closed", outcome });
  expect(Object.values(state.completions)).toEqual([{ postId: "owed", authorAgentId: "lead", returns: 0 }]);
});

it.each([owner, { _tag: "service", service: "watcher" }])("fold: a $_tag author never acquires agent completion debt", async (author) => {
  const { state } = await scenario([...setup, post("question", { author }), close("question", { completionOwed: false })]);
  expect(state.posts["question"]).toMatchObject({ status: "closed", outcome: "answered" });
  expect(Object.values(state.completions)).toEqual([]);
});

it("fold: WakeBuilt is indexed by source id and DeliveryQueued supplies the distinct delivery id", async () => {
  const { state, history } = await scenario([...setup, post("question"),
    wake("source-id", { carried: ["question"], mustReply: ["question"] }), queue("source-id", "different-delivery-id"),
  ]);
  expect(history[6]?.wakes["source-id"]?.deliveryId).toBeUndefined();
  expect(state.wakes["source-id"]).toMatchObject({ wakeId: "source-id", deliveryId: "different-delivery-id", targetAgentId: "worker", carried: ["question"], mustReply: ["question"] });
  expect(position(state)).toEqual({ watermark: 0, above: [] });
  expect(state.wakes["source-id"]).not.toHaveProperty("status");
});

it("read state: accepting a 21-post wake reads 20 digest posts plus its question, leaving five holes", async () => {
  const notes = Array.from({ length: 25 }, (_, i) => post(`note-${i + 1}`, { reply: "none", to: [] }));
  const carried = [...Array.from({ length: 20 }, (_, i) => `note-${i + 1}`), "question"];
  const { state } = await scenario([...setup, ...notes, post("question"),
    wake("digest", { carried, mustReply: ["question"] }), queue("digest"), accept("digest"),
  ]);
  expect(position(state)).toEqual({ watermark: 24, above: ["question"] });
  expect(position(state, "other")).toEqual({ watermark: 0, above: [] });
  expect(state.posts["question"]?.takenAt["worker"]).toBe(33);
  expect(state.posts["note-21"]?.takenAt["worker"]).toBeUndefined();
});

it("read state: a page reads exactly its ids, collapses only contiguous holes, and paging back never unreads", async () => {
  const { state, history } = await scenario([...setup,
    post("one"), post("two"), post("three"), post("four"),
    read(["three", "four"]), read(["one"]), read(["one"]), read(["two"]), read(["one"]),
  ]);
  expect(position(history[9]!)).toEqual({ watermark: 0, above: ["three", "four"] });
  expect(position(history[10]!)).toEqual({ watermark: 5, above: ["three", "four"] });
  expect(position(history[11]!)).toEqual(position(history[10]!));
  expect(position(state)).toEqual({ watermark: 8, above: [] });
  expect(state.posts["one"]?.takenAt["worker"]).toBe(10);
});

it("read state: posts in another channel do not block a contiguous watermark", async () => {
  const { state } = await scenario([...setup, channel({ channelId: "elsewhere", name: "Elsewhere" }),
    post("first"), post("foreign", { channelId: "elsewhere" }), post("second"), read(["first", "second"]),
  ]);
  expect(position(state)).toEqual({ watermark: 8, above: [] });
  expect(position(state, "worker", "elsewhere")).toEqual({ watermark: 0, above: [] });
});

it("read state: a board.Read uses its named owner reader rather than the envelope's caller", async () => {
  const { state } = await scenario([...setup, post("question", { to: [owner] }),
    event({ _tag: "board.Read", channelId: "room", reader: owner, postIds: ["question"] }),
  ]);
  expect(position(state, "owner")).toEqual({ watermark: 5, above: [] });
  expect(position(state)).toEqual({ watermark: 0, above: [] });
  expect(state.posts["question"]?.takenAt["owner"]).toBe(6);
});

it("read state: accepts discharge only named completions and no-answer notices", async () => {
  const { state, history } = await scenario([...setup,
    post("done-one"), post("done-two"), close("done-one"), close("done-two"),
    post("stalled", { to: [agent("worker"), agent("other")] }),
    resolve("stalled", "no-answer"), resolve("stalled", "no-answer", { addressee: agent("other") }),
    wake("author", { targetAgentId: "lead", completions: ["done-one"], noAnswers: [{ postId: "stalled", addressee: agent("worker") }] }),
    queue("author", "delivery-author", "lead"), accept("author", "lead"),
  ]);
  expect(Object.values(history[13]!.completions)).toHaveLength(2);
  expect(Object.values(history[13]!.noAnswers)).toHaveLength(2);
  expect(Object.values(state.completions)).toEqual([{ postId: "done-two", authorAgentId: "lead", returns: 0 }]);
  expect(Object.values(state.noAnswers)).toEqual([{ postId: "stalled", authorAgentId: "lead", addressee: agent("other"), returns: 0 }]);
});

it("fold: unaccepted returns count only carried duties for that target, including reminders and notices", async () => {
  const { state } = await scenario([...setup, post("question"), post("untouched"), post("done"), close("done"),
    post("stalled"), resolve("stalled", "no-answer"),
    wake("first", { carried: ["question"], mustReply: ["question"] }), queue("first"), returned("first"),
    wake("second", { reminders: ["question"] }), queue("second"), returned("second"),
    wake("author", { targetAgentId: "lead", completions: ["done"], noAnswers: [{ postId: "stalled", addressee: agent("worker") }] }),
    queue("author", "delivery-author", "lead"), returned("author", "lead"),
  ]);
  expect(state.posts["question"]?.returns?.["worker"]).toBe(2);
  expect(state.posts["untouched"]?.returns?.["worker"] ?? 0).toBe(0);
  expect(Object.values(state.completions)).toEqual([{ postId: "done", authorAgentId: "lead", returns: 1 }]);
  expect(Object.values(state.noAnswers)).toEqual([{ postId: "stalled", authorAgentId: "lead", addressee: agent("worker"), returns: 1 }]);
  expect(state.lastTurnEnd["worker"]).toBeUndefined();
  expect(state.posts["question"]?.status).toBe("open");
});

it("fold: an accepted board wake's return is a turn end, never a delivery failure, regardless of reason", async () => {
  const { state } = await scenario([...setup, post("question"),
    wake("first", { carried: ["question"], mustReply: ["question"] }), queue("first"), accept("first"), returned("first"),
  ]);
  expect(state.lastTurnEnd["worker"]).toBe(9);
  expect(state.posts["question"]?.returns?.["worker"] ?? 0).toBe(0);
  expect(state.posts["question"]?.takenAt["worker"]).toBe(8);
});

it("fold: reading a post separately cannot turn an unaccepted wake's return into a turn end", async () => {
  const { state } = await scenario([...setup, post("question"), read(["question"]),
    wake("unaccepted", { carried: ["question"], mustReply: ["question"] }), queue("unaccepted"), returned("unaccepted"),
  ]);
  expect(state.posts["question"]?.takenAt["worker"]).toBe(6);
  expect(state.posts["question"]?.returns?.["worker"]).toBe(1);
  expect(state.lastTurnEnd["worker"]).toBeUndefined();
});

it("fold: a completion-only accepted wake still records its return as the author's turn end", async () => {
  const { state } = await scenario([...setup, post("done"), close("done"),
    wake("completion", { targetAgentId: "lead", completions: ["done"] }),
    queue("completion", "delivery-completion", "lead"), accept("completion", "lead"), returned("completion", "lead"),
  ]);
  expect(Object.values(state.completions)).toEqual([]);
  expect(state.lastTurnEnd["lead"]).toBe(10);
});

it("fold: a reminder accept is durable and its accepted return advances the next turn boundary", async () => {
  const { state } = await scenario([...setup, post("question"), read(["question"]),
    event({ _tag: "TurnEnded", agentId: "worker", compact: false }),
    wake("reminder", { reminders: ["question"] }), queue("reminder"), accept("reminder"), returned("reminder"),
  ]);
  expect(state.posts["question"]).toMatchObject({ takenAt: { worker: 6 }, reminderAcceptedAt: { worker: 10 } });
  expect(state.lastTurnEnd["worker"]).toBe(11);
});

it("fold: compact turn ends and non-board returns cannot advance a recorded board turn boundary", async () => {
  const { state } = await scenario([...setup,
    event({ _tag: "TurnEnded", agentId: "worker", compact: false }),
    event({ _tag: "TurnEnded", agentId: "worker", compact: true }),
    event({ _tag: "DeliveryQueued", delivery: { id: "prompt", target: "worker", sender: owner, content: { _tag: "prompt", text: "Continue." } } }),
    event({ _tag: "DeliveryAccepted", agentId: "worker", deliveryId: "prompt" }),
    event({ _tag: "DeliveryReturned", agentId: "worker", deliveryId: "prompt", sender: owner, reason: "Test return." }),
  ]);
  expect(state.lastTurnEnd["worker"]).toBe(5);
});

it("fold: no-answer notices are owed to agent authors only and closing drops their stale notices", async () => {
  const { state, history } = await scenario([...setup,
    post("agent-question"), post("owner-question", { author: owner }),
    post("service-question", { author: { _tag: "service", service: "watcher" } }),
    resolve("agent-question", "no-answer"), resolve("owner-question", "no-answer", { authorIsOwner: true }),
    resolve("service-question", "no-answer"), close("agent-question"),
  ]);
  expect(Object.values(history[10]!.noAnswers)).toEqual([{ postId: "agent-question", authorAgentId: "lead", addressee: agent("worker"), returns: 0 }]);
  expect(state.posts["owner-question"]).toMatchObject({ status: "open", dispositions: { worker: "no-answer" } });
  expect(Object.values(state.noAnswers)).toEqual([]);
});

it("fold: stop drops even twice-failed completion and notice debts; resume cannot resurrect them", async () => {
  const { state, history } = await scenario([...setup, post("done"), close("done"), post("stalled"), resolve("stalled", "no-answer"),
    ...["first", "second"].flatMap((id) => [
      wake(id, { targetAgentId: "lead", completions: ["done"], noAnswers: [{ postId: "stalled", addressee: agent("worker") }] }),
      queue(id, `delivery-${id}`, "lead"), returned(id, "lead"),
    ]),
    event({ _tag: "AgentStopped", agentId: "lead" }),
    event({ _tag: "StateChanged", agentId: "lead", state: { _tag: "starting" } }),
  ]);
  expect(Object.values(history[14]!.completions)[0]?.returns).toBe(2);
  expect(Object.values(history[14]!.noAnswers)[0]?.returns).toBe(2);
  expect(history[15]!.stopped).toContain("lead");
  expect(Object.values(state.completions)).toEqual([]);
  expect(Object.values(state.noAnswers)).toEqual([]);
  expect(state.lastStopped["lead"]).toBe(15);
  expect(state.stopped).not.toContain("lead");
  expect(state.channels["room"]?.members).toContainEqual(agent("lead"));
});

it("fold: crash and resume retain completion debt and read state, and failed reload retains its latest sequence", async () => {
  const { state, history } = await scenario([...setup, post("done"), close("done"), read(["done"], "lead"),
    post("unread"),
    event({ _tag: "AgentCrashed", agentId: "lead", exitCode: 1, signal: null, stderr: "Test crash." }),
    event({ _tag: "StateChanged", agentId: "lead", state: { _tag: "starting" } }),
    event({ _tag: "AgentReloadFailed", agentId: "lead", reason: "Test reload failure." }),
    event({ _tag: "StateChanged", agentId: "lead", state: { _tag: "starting" } }),
  ]);
  expect(history[10]!.lastCrashed["lead"]).toBe(9);
  expect(state.lastCrashed["lead"]).toBe(11);
  expect(Object.values(state.completions)).toEqual([{ postId: "done", authorAgentId: "lead", returns: 0 }]);
  expect(position(state, "lead")).toEqual({ watermark: 5, above: [] });
  expect(state.stopped).not.toContain("lead");
});

it("fold: the start ceiling and label loss sequences survive mode narrowing, regroup and resume", async () => {
  const { state } = await scenario([start("lead", ["build", "review"]),
    event({ _tag: "ModeChanged", agentId: "lead", mode: "read-only", level: "read-only" }),
    event({ _tag: "AgentGrouped", agentId: "lead", groups: ["review"] }),
    event({ _tag: "AgentGrouped", agentId: "lead", groups: ["review", "build"] }),
    event({ _tag: "AgentStopped", agentId: "lead" }),
    event({ _tag: "StateChanged", agentId: "lead", state: { _tag: "starting" } }),
  ]);
  expect(state.ceilings["lead"]).toBe("edit");
  expect(state.labels["lead"]).toEqual(["review", "build"]);
  expect(state.lastLabelLeft["lead"]?.["build"]).toBe(3);
  expect(state.lastLabelLeft["lead"]?.["review"]).toBeUndefined();
  expect(state.lastStopped["lead"]).toBe(5);
});

it.each(["plain", "group"])("read state: a late %s member joins after 400 posts with no inherited backlog", async (kind) => {
  const { state } = await scenario([start("lead"), start("worker"),
    channel({ kind, members: [agent("lead")], ...(kind === "group" ? { group: "build", anchorAgentId: "lead" } : {}) }),
    ...Array.from({ length: 400 }, (_, i) => post(`old-${i}`, { reply: "none", to: [] })),
    kind === "plain"
      ? event({ _tag: "board.ChannelMembersChanged", channelId: "room", membersAdded: [agent("worker")], membersRemoved: [] })
      : event({ _tag: "AgentGrouped", agentId: "worker", groups: ["build"] }),
    post("new", { reply: "none", to: [] }),
  ]);
  expect(position(state)).toEqual({ watermark: 403, above: [] });
  expect(state.posts["new"]?.sequence).toBe(405);
});

it("read state: AgentStarted joins an existing labelled group at its last post", async () => {
  const { state } = await scenario([start("lead", ["build"]),
    channel({ kind: "group", group: "build", anchorAgentId: "lead", members: [] }), post("old"),
    start("new-worker", ["build"]), post("new"),
  ]);
  expect(position(state, "new-worker")).toEqual({ watermark: 3, above: [] });
});

it.each(["plain", "group"])("read state: fresh resume from stopped restarts %s membership at the last post", async (kind) => {
  const { state } = await scenario([start("lead", ["build"]), start("worker", ["build"]),
    channel({ kind, ...(kind === "group" ? { group: "build", anchorAgentId: "lead" } : {}) }),
    post("before"), event({ _tag: "AgentStopped", agentId: "worker" }), post("during"),
    event({ _tag: "StateChanged", agentId: "worker", state: { _tag: "starting" } }), post("after"),
  ]);
  expect(position(state)).toEqual({ watermark: 6, above: [] });
  expect(state.lastStopped["worker"]).toBe(5);
  expect(state.stopped).not.toContain("worker");
});

const everyBoardEvent: ReadonlyArray<Event> = [
  ...setup, post("question"), read(["question"]),
  event({ _tag: "board.PostAcknowledged", postId: "question", addressee: agent("worker") }),
  post("reply", { author: agent("worker"), reply: "none", to: [], replyToPostId: "question" }),
  resolve("question", "replied", { decidingPostId: "reply" }), close("question"),
  wake("author", { targetAgentId: "lead", completions: ["question"] }), queue("author", "delivery-author", "lead"), accept("author", "lead"),
  event({ _tag: "board.ChannelMembersChanged", channelId: "room", membersAdded: [], membersRemoved: [agent("other")] }),
  event({ _tag: "board.ManagerChanged", channelId: "room", manager: owner }),
];

it("reads only the event: every board event has identical live and placeholder folds without reading caller or timestamp", async () => {
  const { boardAfter, emptyBoard, rows, state } = await scenario(everyBoardEvent);
  expect(state.posts["question"]).toMatchObject({ status: "closed", outcome: "answered" });
  let projected = emptyBoard();
  for (const row of rows) {
    const placeholder = new Proxy({ event: row.event, sequence: row.sequence }, {
      get(target, key) {
        if (key === "event" || key === "sequence") return target[key];
        throw new Error(`A board projection read forbidden envelope field ${String(key)}`);
      },
    }) as EventEnvelope;
    projected = boardAfter(projected, placeholder);
  }
  expect(projected).toEqual(state);
});

it("fold: unrelated events cannot change board data, including non-board source ids that collide with a wake", async () => {
  const { boardAfter, state } = await scenario([...setup, post("question"), wake("collision")]);
  const ignored = envelopes([
    event({ _tag: "ModeChanged", agentId: "worker", mode: "read-only", level: "read-only" }),
    event({ _tag: "AgentInterrupted", agentId: "worker", previous: "idle" }),
    event({ _tag: "StateChanged", agentId: "worker", state: { _tag: "paused", reason: "signed-out", midTurn: false } }),
    event({ _tag: "DeliveryQueued", delivery: { id: "foreign", target: "worker", sender: { _tag: "piece", namespace: "roles" },
      content: { _tag: "prompt", text: "Foreign data." }, source: { _tag: "piece", namespace: "roles", id: "collision" } } }),
    event({ _tag: "DeliveryAccepted", agentId: "worker", deliveryId: "foreign" }),
    event({ _tag: "DeliveryReturned", agentId: "worker", deliveryId: "foreign", sender: { _tag: "piece", namespace: "roles" }, reason: "Test return." }),
    event({ _tag: "TurnEnded", agentId: "worker", compact: true }),
    ...journey.filter((value) => !["AgentStarted", "TurnEnded"].includes(value._tag)),
  ]);
  for (const row of ignored) expect(boardAfter(state, row)).toEqual(state);
});

it.each(["constructor", "__proto__", "toString"])("fold: valid id %s remains data in channel, post, wake and agent indexes", async (id) => {
  const { state } = await scenario([start(id),
    channel({ channelId: id, opener: agent(id), manager: agent(id), members: [agent(id)] }),
    post(id, { channelId: id, author: owner, to: [agent(id)] }),
    wake(id, { targetAgentId: id, carried: [id], mustReply: [id] }), queue(id, `delivery-${id}`, id), accept(id, id),
  ]);
  for (const index of [state.channels, state.posts, state.wakes, state.ceilings, state.readState]) {
    expect(Object.hasOwn(index, id)).toBe(true);
  }
  expect(state.posts[id]).toMatchObject({ postId: id, channelId: id, takenAt: { [id]: 6 } });
});

it("fold integration: the engine's default apply and emptyViews use the board reducer", () => {
  const state = freeze(envelopes(everyBoardEvent)).reduce(apply, emptyViews());
  expect(state.board).toMatchObject({
    channels: { room: { manager: owner, seatSequence: 15 } },
    posts: { question: { status: "closed", outcome: "answered", sequence: 5 } },
    completions: {},
  });
});
