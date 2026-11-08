import { comparePermission, type Actor, type AgentId, type Caller } from "@lgcode/contracts";
import type { BoardAddressee, BoardAuthor, ReplyMode } from "@lgcode/contracts/board/ids";
import type { BoardPostView, BoardView } from "@lgcode/contracts/board/view";
import type { Snapshot } from "../commands/internal.ts";
import { holderAbove } from "../routing/holders.ts";

export interface PostAccess {
  readonly channelId: string;
  readonly to: ReadonlyArray<BoardAddressee>;
  readonly reply: ReplyMode;
  readonly replyTo?: string;
}

// Arbitrary ids, including Object.prototype property names, are valid keys.
export const own = <T>(rows: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(rows, key) ? rows[key] : undefined;
const board = (snapshot: Snapshot): BoardView => snapshot.board as BoardView;
const same = (a: BoardAuthor, b: BoardAuthor): boolean => a._tag === b._tag && (
  a._tag === "owner" || (a._tag === "agent" && b._tag === "agent" && a.agentId === b.agentId)
  || (a._tag === "service" && b._tag === "service" && a.service === b.service)
);
const stopped = (snapshot: Snapshot, id: string): boolean =>
  own(snapshot.agents, id)?.state._tag === "stopped" || board(snapshot).stopped.some((agentId) => agentId === id);

// Includes the root itself. Holder availability must never change ancestry.
const under = (snapshot: Snapshot, id: string, root: string): boolean => {
  const seen = new Set<string>();
  let current: string | undefined = id;
  while (current !== undefined && !seen.has(current)) {
    if (current === root) return own(snapshot.agents, current) !== undefined;
    seen.add(current);
    const parent: Actor | undefined = own(snapshot.agents, current)?.parent;
    current = parent?._tag === "agent" ? parent.agentId : undefined;
  }
  return false;
};

export const channelMembers = (snapshot: Snapshot, channelId: string): ReadonlyArray<BoardAuthor> => {
  const channel = own(board(snapshot).channels, channelId);
  if (channel === undefined) return [];
  if (channel.kind !== "group") return channel.members;
  const members: BoardAuthor[] = [];
  if (channel.manager?._tag === "owner") members.push(channel.manager);
  for (const agent of Object.values(snapshot.agents)) {
    if (stopped(snapshot, agent.agentId)) continue;
    if (agent.agentId === channel.anchorAgentId
      || (channel.manager?._tag === "agent" && channel.manager.agentId === agent.agentId)
      || (channel.group !== undefined && channel.anchorAgentId !== undefined
        && agent.groups.includes(channel.group) && under(snapshot, agent.agentId, channel.anchorAgentId))) {
      members.push({ _tag: "agent", agentId: agent.agentId });
    }
  }
  return members;
};
const member = (snapshot: Snapshot, channelId: string, author: BoardAuthor): boolean =>
  channelMembers(snapshot, channelId).some((candidate) => same(candidate, author));

// Rejoining cannot erase a departure after a post. Group anchors and current
// managers do not need the label, so losing it is not a departure for them.
export const leftChannelAfter = (snapshot: Snapshot, id: AgentId, post: BoardPostView): boolean => {
  const view = board(snapshot);
  const channel = own(view.channels, post.channelId);
  if (channel === undefined || !member(snapshot, post.channelId, { _tag: "agent", agentId: id })) return true;
  if (channel.kind === "plain") return (own(own(view.lastMemberLeft, post.channelId) ?? {}, id) ?? 0) > post.sequence;
  if (channel.kind !== "group" || channel.group === undefined || channel.anchorAgentId === id
    || (channel.manager?._tag === "agent" && channel.manager.agentId === id)) return false;
  return (own(own(view.lastLabelLeft, id) ?? {}, channel.group) ?? 0) > post.sequence;
};

const unavailable = (snapshot: Snapshot, id: string): boolean => {
  const agent = own(snapshot.agents, id);
  return agent === undefined || stopped(snapshot, id) || agent.state._tag === "crashed"
    || (agent.state._tag === "interrupted" && agent.reloadable !== true);
};

// Used for both a permanent stop's successor and temporary acting rights.
// The caller decides whether to persist ManagerChanged; this never writes.
export const successorManager = (snapshot: Snapshot, channelId: string): BoardAddressee | undefined => {
  const channel = own(board(snapshot).channels, channelId);
  if (channel === undefined || channel.kind === "direct" || channel.manager === undefined) return undefined;
  if (channel.manager._tag === "owner") return channel.manager;
  const seen = new Set<string>([channel.manager.agentId]);
  let parent = own(snapshot.agents, channel.manager.agentId)?.parent;
  while (parent?._tag === "agent" && !seen.has(parent.agentId)) {
    seen.add(parent.agentId);
    if (!unavailable(snapshot, parent.agentId)) return parent;
    parent = own(snapshot.agents, parent.agentId)?.parent;
  }
  return { _tag: "owner" };
};

export const canManage = (snapshot: Snapshot, caller: Caller, channelId: string): boolean => {
  const channel = own(board(snapshot).channels, channelId);
  if (channel === undefined || channel.kind === "direct" || channel.manager === undefined) return false;
  if (caller._tag === "owner") return true;
  if (caller._tag !== "agent" || channel.manager._tag !== "agent") return false;
  if (!unavailable(snapshot, channel.manager.agentId)) return same(caller, channel.manager);
  // A stop waits for the permanent seat event; it does not confer acting rights.
  if (stopped(snapshot, channel.manager.agentId)) return false;
  const successor = successorManager(snapshot, channelId);
  return successor !== undefined && same(caller, successor);
};

export const canAddMember = (snapshot: Snapshot, caller: Caller, channelId: string, memberId: string): boolean => {
  if (own(board(snapshot).channels, channelId)?.kind !== "plain" || own(snapshot.agents, memberId) === undefined
    || !canManage(snapshot, caller, channelId)) return false;
  if (caller._tag === "owner") return true;
  if (caller._tag !== "agent") return false;
  const holder = holderAbove(snapshot, memberId);
  const ownHolder = holderAbove(snapshot, caller.agentId);
  return (holder._tag === "agent" && holder.agentId === caller.agentId)
    || (ownHolder._tag === "agent" && ownHolder.agentId === memberId);
};

export const canClose = (snapshot: Snapshot, caller: Caller, postId: string): boolean => {
  if (caller._tag === "piece") return false;
  const post = own(board(snapshot).posts, postId);
  return post !== undefined && (caller._tag === "owner" || caller._tag === "service"
    || same(caller, post.author) || canManage(snapshot, caller, post.channelId));
};

export const canOpenGroup = (snapshot: Snapshot, caller: Caller, group: string, anchorAgentId?: string): boolean => {
  if (caller._tag === "service" || caller._tag === "piece" || group.length === 0) return false;
  const anchor = anchorAgentId ?? (caller._tag === "agent" ? caller.agentId : undefined);
  if (anchor === undefined || own(snapshot.agents, anchor) === undefined) return false;
  if (caller._tag === "owner") return true;
  return anchor === caller.agentId && Object.values(snapshot.agents).some((agent) =>
    !stopped(snapshot, agent.agentId) && agent.groups.includes(group) && under(snapshot, agent.agentId, anchor));
};

export const directGrant = (snapshot: Snapshot, a: BoardAuthor, b: BoardAuthor): boolean => {
  if (same(a, b)) return false;
  // Valid pairs always contain an agent. A stop ends every direct grant.
  if (a._tag !== "agent" && b._tag !== "agent") return false;
  for (const side of [a, b]) {
    if (side._tag === "agent" && (own(snapshot.agents, side.agentId) === undefined || stopped(snapshot, side.agentId))) return false;
  }
  if (a._tag !== "agent" || b._tag !== "agent") return true;
  const aParent = own(snapshot.agents, a.agentId)?.parent;
  const bParent = own(snapshot.agents, b.agentId)?.parent;
  if ((aParent?._tag === "agent" && aParent.agentId === b.agentId)
    || (bParent?._tag === "agent" && bParent.agentId === a.agentId)) return true;
  return Object.values(board(snapshot).channels).some((channel) => channel.kind !== "direct"
    && member(snapshot, channel.channelId, a) && member(snapshot, channel.channelId, b));
};

export const canRead = (snapshot: Snapshot, caller: Caller, channelId: string): boolean =>
  own(board(snapshot).channels, channelId) !== undefined && caller._tag !== "service" && caller._tag !== "piece"
  && (caller._tag === "owner" || member(snapshot, channelId, caller));

const channelReach = (snapshot: Snapshot, channelId: string): boolean => {
  const channel = own(board(snapshot).channels, channelId);
  if (channel === undefined) return false;
  if (channel.kind !== "direct") return true;
  const [a, b] = channel.members;
  return channel.members.length === 2 && a !== undefined && b !== undefined && directGrant(snapshot, a, b);
};
const ceilingAllows = (snapshot: Snapshot, author: BoardAuthor, target: BoardAddressee): boolean => {
  if (author._tag !== "agent" || target._tag !== "agent") return true;
  if (under(snapshot, target.agentId, author.agentId) || under(snapshot, author.agentId, target.agentId)) return true;
  const ceilings = board(snapshot).ceilings;
  const from = own(ceilings, author.agentId);
  const to = own(ceilings, target.agentId);
  return from !== undefined && to !== undefined && comparePermission(from, to) >= 0;
};

export const canPost = (snapshot: Snapshot, caller: Caller, input: PostAccess): boolean => {
  if (caller._tag === "piece") return false;
  if (!channelReach(snapshot, input.channelId)) return false;
  if (caller._tag === "agent" && !member(snapshot, input.channelId, caller)) return false;
  if (input.replyTo !== undefined && own(board(snapshot).posts, input.replyTo)?.channelId !== input.channelId) return false;
  return input.reply === "none" || input.to.every((target) => ceilingAllows(snapshot, caller, target));
};

export const canCarryPost = (snapshot: Snapshot, target: string, postId: string): boolean => {
  const post = own(board(snapshot).posts, postId);
  const agent = own(snapshot.agents, target);
  if (post === undefined || agent === undefined || !member(snapshot, post.channelId, { _tag: "agent", agentId: agent.agentId })
    || !channelReach(snapshot, post.channelId)) return false;
  const addressee = post.to.find((to) => to._tag === "agent" && to.agentId === target);
  return post.reply === "none" || addressee === undefined || ceilingAllows(snapshot, post.author, addressee);
};

export const canCarryCompletion = (snapshot: Snapshot, target: string, postId: string, includesReplyText: boolean): boolean => {
  if (!includesReplyText) return true;
  const post = own(board(snapshot).posts, postId);
  const agent = own(snapshot.agents, target);
  return post !== undefined && agent !== undefined
    && member(snapshot, post.channelId, { _tag: "agent", agentId: agent.agentId }) && channelReach(snapshot, post.channelId);
};
