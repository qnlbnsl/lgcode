import type { Caller } from "@lgcode/contracts";
import { holdsIncoming, holdsUnsettled, ownerHeld } from "@lgcode/contracts/board/conditions";
import type { Snapshot } from "../commands/internal.ts";
import { channelMembers, own } from "./access.ts";
import { boardView, encodedBytes, isUnread, postDispositions } from "./wake.ts";

// Conditions are never truncated. Every list is derived from this same views
// value, with post metadata and delivery debts taking the available space first.
export const snapshotFor = (caller: Caller, snapshot: Snapshot, enabled = true) => {
  if (caller._tag === "agent") return;
  const board = boardView(snapshot);
  const ids = Object.keys(snapshot.agents);
  const section = {
    sequence: snapshot.sequence, disabled: !enabled, truncated: false,
    holdsUnsettled: enabled ? ids.filter((id) => holdsUnsettled(id, board, snapshot.deliveries)) : [],
    holdsIncoming: enabled ? ids.filter((id) => holdsIncoming(id, board)) : [],
    ownerHeld: enabled ? ownerHeld(board) : [],
    posts: [] as unknown[], completions: [] as unknown[], noAnswers: [] as unknown[],
    channels: [] as unknown[], unread: [] as unknown[], wakes: [] as unknown[],
  };
  if (!enabled) return section;
  let bytes = encodedBytes(section);
  const fill = (target: unknown[], items: Iterable<unknown>) => {
    for (const item of items) {
      const extra = encodedBytes(item) + (target.length === 0 ? 0 : 1);
      if (bytes + extra > 256 * 1024) { section.truncated = true; break; }
      bytes += extra;
      target.push(item);
    }
  };
  fill(section.posts, Object.values(board.posts).filter((post) => post.status === "open").map((post) => ({
    postId: post.postId, channelId: post.channelId, author: post.author, to: post.to, reply: post.reply,
    sequence: post.sequence, status: post.status, dispositions: postDispositions(post), acknowledged: post.acknowledged,
    takenAt: post.takenAt, reminderAcceptedAt: post.reminderAcceptedAt,
    decidingReplies: post.decidingReplies, replyIds: post.replies,
    ...(post.replyTo === undefined ? {} : { replyTo: post.replyTo }),
  })));
  fill(section.completions, Object.values(board.completions));
  fill(section.noAnswers, Object.values(board.noAnswers));
  fill(section.channels, Object.values(board.channels).map((channel) => ({
    channelId: channel.channelId, name: channel.name, kind: channel.kind, members: channel.members,
    ...(channel.manager === undefined ? {} : { manager: channel.manager }),
    ...(channel.group === undefined ? {} : { group: channel.group }),
    ...(channel.anchorAgentId === undefined ? {} : { anchorAgentId: channel.anchorAgentId }),
  })));
  function* unreadCounts() {
    for (const channel of Object.values(board.channels)) {
      const posts = Object.values(board.posts).filter((post) => post.channelId === channel.channelId);
      for (const member of channelMembers(snapshot, channel.channelId)) {
        if (member._tag === "service") continue;
        yield { channelId: channel.channelId, member, count: posts.filter((post) => isUnread(snapshot, member, post)).length };
      }
    }
  }
  fill(section.unread, unreadCounts());
  fill(section.wakes, Object.values(board.wakes).filter((wake) => wake.deliveryId !== undefined
    && own(snapshot.deliveries, wake.deliveryId)?.status === "queued").map((wake) => ({
    wakeId: wake.wakeId, targetAgentId: wake.targetAgentId, deliveryId: wake.deliveryId,
  })));
  return section;
};
