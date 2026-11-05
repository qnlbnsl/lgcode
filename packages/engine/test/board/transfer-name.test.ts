import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { expect, it } from "vitest";
import * as Schema from "effect/Schema";
import { Event, type AgentId } from "@shephrd/contracts";
import { BoardChannelName } from "@shephrd/contracts/board/schemas";
import { lifecycleBatch } from "../../src/board/reactor.ts";
import { isUnread } from "../../src/board/wake.ts";
import { agent, board, channel, event, owner, post, snapshot, stop, tree } from "./accessFixtures.ts";

it.each(["plain", "group"] as const)("renames every %s transfer, replaces the prior manager prefix, resolves clashes and retains channel state", (kind) => {
  const history = [...tree.map((entry) => entry._tag === "AgentStarted" ? event({ ...entry, name: entry.agentId === "worker" ? "lead-a" : entry.agentId === "lead" ? "top-b" : entry.name }) : entry),
    channel({ channelId: "moving", name: "review-queue", manager: agent("worker"), kind,
      ...(kind === "group" ? { group: "review", anchorAgentId: "lead", members: [] } : { members: [owner, agent("lead"), agent("worker"), agent("other")] }) }),
    channel({ channelId: "clash", name: "lead-a-review-queue", manager: agent("lead") }),
    post("earlier", { channelId: "moving", author: owner, to: [agent("other")] }),
    event({ _tag: "board.Read", channelId: "moving", reader: agent("lead"), postIds: ["earlier"] }),
    post("question", { channelId: "moving", author: owner, to: [agent("other")] }),
    event({ _tag: "board.Read", channelId: "moving", reader: agent("other"), postIds: ["question"] }), stop("worker")];
  const before = board(snapshot(...history));
  expect(isUnread(snapshot(...history), agent("lead"), before.posts.question!)).toBe(true);
  const first = lifecycleBatch(snapshot(...history), "worker" as AgentId).events;
  expect(first.find((entry) => entry._tag === "board.ManagerChanged")).toMatchObject({ name: "lead-a-review-queue-1", ownName: "review-queue" });
  history.push(...first);
  const moved = board(snapshot(...history));
  expect(moved.channels.moving?.members).toEqual(before.channels.moving?.members);
  expect(moved.posts.question).toEqual(before.posts.question);
  expect(moved.readState.other?.moving).toEqual(before.readState.other?.moving);
  expect(moved.readState.lead?.moving).toEqual(before.readState.lead?.moving);
  expect(isUnread(snapshot(...history), agent("lead"), moved.posts.question!)).toBe(true);
  expect(moved.posts.question?.status).toBe("open");
  history.push(stop("lead"));
  const second = lifecycleBatch(snapshot(...history), "lead" as AgentId).events;
  expect(second.find((entry) => entry._tag === "board.ManagerChanged" && entry.channelId === "moving")).toMatchObject({ name: "top-b-review-queue", ownName: "review-queue" });
  history.push(...second);
  const twice = board(snapshot(...history));
  expect(twice.channels.moving?.manager).toEqual(agent("root"));
  expect(twice.posts.question).toEqual(before.posts.question);
  expect(twice.readState.other?.moving).toEqual(before.readState.other?.moving);
  expect(isUnread(snapshot(...history), agent("root"), twice.posts.question!)).toBe(false);
});

it("normalizes labels and bounds long names while retaining the original own name for future transfers", () => {
  const ownName = "r".repeat(64);
  const history = [...tree.map((entry) => entry._tag === "AgentStarted" && entry.agentId === "worker" ? event({ ...entry, name: "99 / Lead!".repeat(20) }) : entry),
    channel({ channelId: "moving", name: ownName, manager: agent("worker") }), stop("worker")];
  const batch = lifecycleBatch(snapshot(...history), "worker" as AgentId).events;
  const transfer = batch.find((entry) => entry._tag === "board.ManagerChanged")!;
  expect(transfer).toMatchObject({ name: `L-${"r".repeat(62)}`, ownName });
  for (const entry of batch) expect(() => Schema.decodeUnknownSync(Event)(entry)).not.toThrow();
  if (transfer._tag === "board.ManagerChanged") expect(Schema.is(BoardChannelName)((transfer as { name?: string }).name)).toBe(true);
});

it("replays historical manager transfers with no rename fields", () => {
  const view = board(snapshot(...tree, channel(), event({ _tag: "board.ManagerChanged", channelId: "room", manager: owner })));
  expect(view.channels.room).toMatchObject({ name: "Room", manager: owner });
});

registerRebuildCheck({ noLog: true });
