import { existsSync } from "node:fs";

import { AgentId, type Caller, type Event, type LifecycleState, type PermissionLevel } from "@shephrd/contracts";
import type { BoardAddressee, BoardAuthor, ReplyMode } from "@shephrd/contracts/board/ids";
import type { BoardView } from "@shephrd/contracts/board/view";
import * as Schema from "effect/Schema";
import { expect } from "vitest";

import type { Snapshot } from "../../src/commands/internal.ts";
import { apply, emptyViews } from "../../src/views/apply.ts";
import { channel, envelopes, event, freeze, owner, post, start } from "./fixtures.ts";

export { channel, event, owner, post };
const agentId = Schema.decodeUnknownSync(AgentId);
export const agent = (id: string) => ({ _tag: "agent" as const, agentId: agentId(id) });
export const service = { _tag: "service", service: "sheepdog" } as const;

// Public pure seams for unit 2b. No fallback implements the missing policy.
export interface PostAccess {
  readonly channelId: string;
  readonly to: ReadonlyArray<BoardAddressee>;
  readonly reply: ReplyMode;
  readonly replyTo?: string;
}
export interface BoardAccess {
  readonly channelMembers: (snapshot: Snapshot, channelId: string) => ReadonlyArray<BoardAuthor>;
  readonly canAddMember: (snapshot: Snapshot, caller: Caller, channelId: string, memberId: string) => boolean;
  readonly canManage: (snapshot: Snapshot, caller: Caller, channelId: string) => boolean;
  readonly successorManager: (snapshot: Snapshot, channelId: string) => BoardAddressee | undefined;
  readonly canClose: (snapshot: Snapshot, caller: Caller, postId: string) => boolean;
  readonly canOpenGroup: (snapshot: Snapshot, caller: Caller, group: string, anchorAgentId?: string) => boolean;
  readonly directGrant: (snapshot: Snapshot, a: BoardAuthor, b: BoardAuthor) => boolean;
  readonly canRead: (snapshot: Snapshot, caller: Caller, channelId: string) => boolean;
  readonly canPost: (snapshot: Snapshot, caller: Caller, input: PostAccess) => boolean;
  readonly canCarryPost: (snapshot: Snapshot, target: string, postId: string) => boolean;
  readonly canCarryCompletion: (snapshot: Snapshot, target: string, postId: string, includesReplyText: boolean) => boolean;
}
export async function access(): Promise<BoardAccess> {
  const url = new URL("../../src/board/access.ts", import.meta.url);
  expect(existsSync(url), "Unit 2b must implement the pure board/access.ts rules; see .foundry/tests-result.md").toBe(true);
  return await import(/* @vite-ignore */ url.href) as BoardAccess;
}

export const spawn = (id: string, parent = "lead", groups: ReadonlyArray<string> = [], permission: PermissionLevel = "edit") =>
  event({ ...start(id, groups, parent), permission, parent: id === "root" || id === "stranger" ? owner : agent(parent) });
const startedTree = [spawn("root"), spawn("lead", "root"), spawn("worker", "lead", ["review"]),
  spawn("other", "lead", ["review"]), spawn("new-child"), spawn("grandchild", "worker"),
  spawn("sibling", "root", ["review"]), spawn("cousin", "sibling", ["review"]), spawn("stranger")];
// The baseline hierarchy has available holders. AgentStarted alone leaves
// every agent starting, so it cannot represent the child/holder access cases.
export const tree = startedTree.flatMap((row) => row._tag !== "AgentStarted" ? [row] : [row, event({
  _tag: "SessionOpened", agentId: row.agentId, session: { _tag: "acp", sessionId: `session-${row.agentId}` },
  protocolVersion: 2, reloadable: true,
})]);
export const withCeilings = (permissions: Readonly<Record<string, PermissionLevel>>) => tree.map((row) =>
  row._tag === "AgentStarted" && permissions[row.agentId] !== undefined
    ? event({ ...row, permission: permissions[row.agentId] }) : row);
export const plain = channel();
export const group = (overrides: Record<string, unknown> = {}) => channel({
  channelId: "group", name: "Review", kind: "group", members: [], group: "review", anchorAgentId: "lead", ...overrides,
});
export const direct = (a: BoardAuthor, b: BoardAuthor, channelId = "direct") => event({
  _tag: "board.ChannelOpened", channelId, name: "Direct", kind: "direct", opener: a, members: [a, b],
});
export const membersChanged = (channelId: string, remove: ReadonlyArray<string>, add: ReadonlyArray<string> = []) => event({
  _tag: "board.ChannelMembersChanged", channelId, membersAdded: add.map(agent), membersRemoved: remove.map(agent),
});
export const state = (agentId: string, value: LifecycleState) => event({ _tag: "StateChanged", agentId, state: value });
export const crash = (agentId: string) => event({ _tag: "AgentCrashed", agentId, exitCode: 1, signal: null, stderr: "Fixture crash." });
export const stop = (agentId: string) => event({ _tag: "AgentStopped", agentId });
export const session = (agentId: string, reloadable: boolean) => event({
  _tag: "SessionOpened", agentId, session: { _tag: "acp", sessionId: `session-${agentId}` }, protocolVersion: 2, reloadable,
});
export const pause = (agentId: string) => state(agentId, { _tag: "paused", reason: "limit", midTurn: false });
export const noReply = (channelId = "room"): PostAccess => ({ channelId, to: [], reply: "none" });
export const question = (target = "worker", channelId = "room"): PostAccess => ({ channelId, to: [agent(target)], reply: "all" });
export const board = (snapshot: Snapshot) => snapshot.board as BoardView;

// Use validated events and the real engine fold, including its registered
// board reducer. Every prefix is also rebuilt independently from the log.
export function history(events: ReadonlyArray<Event>): ReadonlyArray<Snapshot> {
  const rows = freeze(envelopes(events));
  let current = emptyViews();
  const states: Snapshot[] = [current];
  for (const [index, row] of rows.entries()) {
    const before = structuredClone(current);
    freeze(current);
    current = apply(current, row);
    expect(states.at(-1), "access fixture mutated a published view").toEqual(before);
    expect(current, `board access fixture differs from replay at ${row.sequence}`)
      .toEqual(rows.slice(0, index + 1).reduce(apply, emptyViews()));
    states.push(current);
  }
  return freeze(states);
}
export const snapshot = (...events: ReadonlyArray<Event>): Snapshot => history(events).at(-1)!;
export const memberIds = (members: ReadonlyArray<BoardAuthor>) => members.map((member) =>
  member._tag === "agent" ? member.agentId : member._tag === "owner" ? "owner" : `service:${member.service}`).sort();
