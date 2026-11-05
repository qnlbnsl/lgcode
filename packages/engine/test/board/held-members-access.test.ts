import { expect, it } from "vitest";

import { canAddMember, canManage, channelMembers } from "../../src/board/access.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
import { agent, board, channel, direct, owner, snapshot, state, tree } from "./accessFixtures.ts";

registerRebuildCheck({ noLog: true });

const ready = tree;
const room = channel({ members: [agent("lead")] });

it.each(["paused", "starting", "interrupted", "crashed", "stopped"] as const)(
  "plain additions skip a %s intermediate holder without changing stored seats or members", (kind) => {
    const unavailable = kind === "paused" ? { _tag: kind, reason: "limit", midTurn: false } as const
      : kind === "interrupted" ? { _tag: kind, previous: "idle" } as const : { _tag: kind };
    const view = snapshot(...ready, room, state("worker", unavailable));
    expect(canAddMember(view, agent("lead"), "room", "grandchild")).toBe(true);
    expect(canAddMember(view, agent("worker"), "room", "grandchild")).toBe(false);
    expect(board(view).channels.room?.manager).toEqual(agent("lead"));
    expect(channelMembers(view, "room")).toEqual([agent("lead")]);
  },
);

it.each(["idle", "working"] as const)("plain additions stop at an %s intermediate holder", (kind) => {
  const view = snapshot(...ready, room, state("worker", { _tag: kind }));
  expect(canAddMember(view, agent("lead"), "room", "grandchild")).toBe(false);
  expect(canAddMember(view, owner, "room", "grandchild")).toBe(true);
});

it("a manager may add its effective own holder through multiple unavailable ancestors", () => {
  const view = snapshot(...ready, channel({ manager: agent("grandchild"), members: [agent("grandchild")] }),
    state("worker", { _tag: "paused", reason: "limit", midTurn: false }), state("lead", { _tag: "crashed" }));
  expect(canAddMember(view, agent("grandchild"), "room", "root")).toBe(true);
  expect(canAddMember(view, agent("grandchild"), "room", "worker")).toBe(false);
  expect(canAddMember(view, agent("grandchild"), "room", "lead")).toBe(false);
});

it("retaining a paused manager seat does not make the manager an available holder", () => {
  const view = snapshot(...ready, room, state("lead", { _tag: "paused", reason: "limit", midTurn: false }));
  expect(canManage(view, agent("lead"), "room")).toBe(true);
  expect(canAddMember(view, agent("lead"), "room", "worker")).toBe(false);
  expect(canAddMember(view, agent("lead"), "room", "root")).toBe(true);
  expect(canAddMember(view, owner, "room", "worker")).toBe(true);
});

it("effective holders still need management rights and cannot edit group or direct members", () => {
  const view = snapshot(...ready, room,
    channel({ channelId: "group", kind: "group", group: "review", anchorAgentId: "lead" }),
    direct(agent("lead"), agent("worker")));
  expect(canAddMember(view, agent("worker"), "room", "grandchild")).toBe(false);
  for (const id of ["sibling", "cousin", "stranger"]) {
    expect(canAddMember(view, agent("lead"), "room", id)).toBe(false);
    expect(canAddMember(view, owner, "room", id)).toBe(true);
  }
  expect(canAddMember(view, owner, "room", "missing")).toBe(false);
  for (const id of ["group", "direct", "missing"]) {
    expect(canAddMember(view, owner, id, "worker")).toBe(false);
  }
});
