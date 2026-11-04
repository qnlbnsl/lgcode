import { expect, it } from "vitest";

import { canAddMember, canManage, canOpenGroup, canPost, canRead, successorManager } from "../../src/board/access.ts";
import { engineLists } from "../../src/pieces/lists.ts";
import { canReach } from "../../src/routing/reach.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import {
  agent, board, crash, event, membersChanged, noReply, owner, pause, plain, post, session,
  snapshot, state, stop, tree,
} from "./accessFixtures.ts";
import { close, queue, resolve, wake } from "./fixtures.ts";

registerRebuildCheck({ noLog: true });

// Explicitly record the intended structural link. The frozen access fixture's
// start helper otherwise makes lead a child of the owner, ignoring its parent.
const nestedTree = tree.map((row) => row._tag === "AgentStarted" && row.agentId === "lead"
  ? event({ ...row, parent: agent("root") }) : row);

it("uses recorded parent links for manager inheritance, even through a paused ancestor", () => {
  const initial = snapshot(...nestedTree, plain);
  expect(initial.agents["lead"]?.parent).toEqual(agent("root"));
  expect(canAddMember(initial, agent("lead"), "room", "root")).toBe(true);
  expect(successorManager(snapshot(...nestedTree, plain, pause("root"), stop("lead")), "room")).toEqual(agent("root"));
  expect(successorManager(snapshot(...nestedTree, plain, crash("root"), stop("lead")), "room")).toEqual(owner);
});

it("grants temporary management without membership and ends it on manager recovery", () => {
  const crashed = snapshot(...nestedTree, plain, crash("lead"));
  expect(canManage(crashed, agent("root"), "room")).toBe(true);
  expect(canRead(crashed, agent("root"), "room")).toBe(false);
  expect(canManage(snapshot(...nestedTree, plain, crash("lead"), state("lead", { _tag: "starting" }),
    session("lead", true)), agent("root"), "room")).toBe(false);
  for (const reloadable of [false, true]) {
    const interrupted = snapshot(...nestedTree, plain, session("lead", reloadable),
      event({ _tag: "AgentInterrupted", agentId: "lead", previous: "idle" }));
    expect(canManage(interrupted, agent("root"), "room")).toBe(!reloadable);
  }
});

it("does not treat SessionOpened alone as a lifecycle transition out of crashed", () => {
  const view = snapshot(...nestedTree, plain, crash("lead"), session("lead", true));
  expect(view.agents["lead"]?.state._tag).toBe("crashed");
  expect(canManage(view, agent("root"), "room")).toBe(true);
});

it("does not invent an ancestor from unrelated agents in the roster", () => {
  const actual = snapshot(...tree, plain, stop("lead"));
  expect(actual.agents["lead"]?.parent).toEqual(owner);
  expect(successorManager(actual, "room")).toEqual(owner);
});

const answered = [...nestedTree, plain, post("done", { author: agent("worker"), to: [agent("other")] }),
  post("reply", { author: agent("other"), reply: "none", to: [], replyToPostId: "done" }),
  resolve("done", "replied", { addressee: agent("other"), decidingPostId: "reply" }), close("done")];
const judge = (view: ReturnType<typeof snapshot>, id = "completion", deliveryId = `delivery-${id}`) => canReach({
  snapshot: view, target: "worker", deliveryId, source: { _tag: "piece", namespace: "board", id },
}, engineLists);

it("replays an explicit metadata-only replacement and sends it after membership is removed", () => {
  const view = snapshot(...answered,
    wake("captured", { completions: ["done"], completionReplyText: ["done"] }), queue("captured"),
    membersChanged("room", ["worker"]),
    wake("completion", { completions: ["done"], completionReplyText: [] }));
  expect(board(view).wakes["completion"]?.completionReplyText).toEqual([]);
  expect(judge(view, "captured")).toBe(false);
  expect(judge(view)).toBe(true); // Queue projection, before DeliveryQueued.
  const queued = snapshot(...answered, membersChanged("room", ["worker"]),
    wake("completion", { completions: ["done"], completionReplyText: [] }), queue("completion"));
  expect(judge(queued)).toBe(true); // Send, after joining the delivery id.
});

it("does not let a manifest omit another completion's captured text", () => {
  const view = snapshot(...answered, membersChanged("room", ["worker"]),
    wake("completion", { completions: ["done"], completionReplyText: ["done"] }), queue("completion"));
  expect(judge(view)).toBe(false);
  expect(judge(snapshot(...answered, wake("completion", { completions: [], completionReplyText: ["done"] })))).toBe(false);
});

it("rejects a mismatched delivery identity and inaccessible reminder text", () => {
  const view = snapshot(...answered, wake("completion", { completions: ["done"], completionReplyText: [] }), queue("completion"));
  expect(judge(view, "completion", "different-delivery")).toBe(false);
  const reminder = snapshot(...nestedTree, plain, post("question"), membersChanged("room", ["worker"]),
    wake("completion", { reminders: ["question"] }));
  expect(judge(reminder)).toBe(false);
});

it("rejects piece identities and inherited object properties at the access boundary", () => {
  const view = snapshot(...nestedTree, plain);
  const piece = { _tag: "piece", namespace: "board" } as const;
  expect(canPost(view, piece, noReply())).toBe(false);
  expect(canRead(view, piece, "room")).toBe(false);
  expect(canOpenGroup(view, piece, "review")).toBe(false);
  for (const id of ["constructor", "toString", "__proto__"]) {
    expect(canRead(view, owner, id)).toBe(false);
    expect(canPost(view, owner, noReply(id))).toBe(false);
    expect(canAddMember(view, owner, "room", id)).toBe(false);
  }
});
