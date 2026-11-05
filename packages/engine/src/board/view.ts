import { EventSequence as Sequence, type Actor, type AgentId, type EventEnvelope, type EventSequence } from "@shephrd/contracts";
import type { BoardAddressee, BoardAuthor, PostId } from "@shephrd/contracts/board/ids";
import type { BoardChannelView, BoardPostView, BoardReadState, BoardView, BoardWakeView } from "@shephrd/contracts/board/view";
import * as Schema from "effect/Schema";

type Keyed<T> = Readonly<Record<string, T>>;
const keyed = <T>(): Keyed<T> => Object.create(null) as Keyed<T>;
const get = <T>(rows: Keyed<T>, key: string): T | undefined => Object.hasOwn(rows, key) ? rows[key] : undefined;
const put = <T>(rows: Keyed<T>, key: string, value: T): Keyed<T> => ({ ...rows, [key]: value });
const omit = <T>(rows: Keyed<T>, key: string): Keyed<T> => {
  const next = { ...rows };
  delete next[key];
  return next;
};
const filter = <T>(rows: Keyed<T>, keep: (row: T) => boolean): Keyed<T> =>
  Object.fromEntries(Object.entries(rows).filter(([, row]) => keep(row)));
const zero = Schema.decodeUnknownSync(Sequence)(0);
const readerKey = (reader: BoardAddressee): string => reader._tag === "agent" ? reader.agentId : "owner";
const sameAuthor = (a: BoardAuthor, b: BoardAuthor): boolean => a._tag === b._tag && (
  a._tag === "owner" || (a._tag === "agent" && b._tag === "agent" && a.agentId === b.agentId)
  || (a._tag === "service" && b._tag === "service" && a.service === b.service)
);
// Tuple encoding avoids collisions between arbitrary post and agent ids.
const noticeKey = (postId: PostId, addressee: BoardAddressee): string => JSON.stringify([postId, addressee._tag, readerKey(addressee)]);

// These replayable indexes are fold bookkeeping, rather than public board
// metadata. Parent links locate group joins without consulting live agents.
// Acceptance is historical evidence for a later return, even when a wake
// carried only completions. It is not a copy of current delivery status.
// The close's actor and sequence distinguish an owner's deciding reply from
// replies written after the close, without retaining another copy of text.
interface FoldIndexes {
  readonly parents: Keyed<Actor>;
  readonly acceptedWakes: Keyed<EventSequence>;
  readonly closures: Keyed<{ readonly closer: BoardAuthor; readonly sequence: EventSequence }>;
  readonly ownerNoAnswers: Keyed<AgentId>;
}
export interface BoardFold extends BoardView, FoldIndexes {}
const indexes = (state: BoardView): FoldIndexes => {
  const stored = state as BoardView & Partial<FoldIndexes>;
  return { parents: stored.parents ?? keyed(), acceptedWakes: stored.acceptedWakes ?? keyed(), closures: stored.closures ?? keyed(),
    ownerNoAnswers: stored.ownerNoAnswers ?? keyed() };
};

// The first resolution owns the alert until the post closes, even if a
// recipient's disposition changes later. Rebuild retains the live identity.
export const firstOwnerNoAnswer = (state: BoardView, postId: PostId): AgentId | undefined => get(indexes(state).ownerNoAnswers, postId);

export const emptyBoard = (): BoardFold => ({
  channels: keyed(), posts: keyed(), completions: keyed(), noAnswers: keyed(), wakes: keyed(),
  lastTurnEnd: keyed(), ceilings: keyed(), stopped: [], lastStopped: keyed(), lastCrashed: keyed(),
  labels: keyed(), lastLabelLeft: keyed(), lastMemberLeft: keyed(), readState: keyed(),
  parents: keyed(), acceptedWakes: keyed(), closures: keyed(), ownerNoAnswers: keyed(),
});

const channelPosts = (state: BoardView, channelId: string): ReadonlyArray<BoardPostView> =>
  Object.values(state.posts).filter((post) => post.channelId === channelId).sort((a, b) => a.sequence - b.sequence);

const join = (state: BoardView, reader: BoardAddressee, channelId: string): BoardView => {
  const last = channelPosts(state, channelId).at(-1)?.sequence ?? zero;
  const key = readerKey(reader);
  const channels = put(get(state.readState, key) ?? keyed<BoardReadState>(), channelId, { watermark: last, above: [] });
  return { ...state, readState: put(state.readState, key, channels) };
};

const underAnchor = (state: BoardView, agentId: AgentId, anchor: AgentId): boolean => {
  const parents = indexes(state).parents;
  const seen = new Set<string>();
  let current: AgentId | undefined = agentId;
  while (current !== undefined && !seen.has(current)) {
    if (current === anchor) return true;
    seen.add(current);
    const parent: Actor | undefined = get(parents, current);
    current = parent?._tag === "agent" ? parent.agentId : undefined;
  }
  return false;
};
const groupMember = (state: BoardView, channel: BoardChannelView, agentId: AgentId): boolean =>
  !state.stopped.includes(agentId) && (channel.anchorAgentId === agentId
    || (channel.manager?._tag === "agent" && channel.manager.agentId === agentId)
    || (channel.group !== undefined && channel.anchorAgentId !== undefined
      && (get(state.labels, agentId) ?? []).includes(channel.group) && underAnchor(state, agentId, channel.anchorAgentId)));

const joinGroups = (before: BoardView, after: BoardView, agentId: AgentId): BoardView => {
  let state = after;
  for (const channel of Object.values(state.channels)) {
    if (channel.kind === "group" && groupMember(state, channel, agentId) && !groupMember(before, channel, agentId)) {
      state = join(state, { _tag: "agent", agentId }, channel.channelId);
    }
  }
  return state;
};

// Read only named posts. Event sequences in other channels never create
// holes, and an old page may record taking a post without moving backward.
const markRead = (state: BoardView, reader: BoardAddressee, channelId: string, ids: ReadonlyArray<PostId>, sequence: EventSequence): BoardView => {
  const key = readerKey(reader);
  const previous = get(get(state.readState, key) ?? keyed<BoardReadState>(), channelId) ?? { watermark: zero, above: [] };
  const read = new Set(previous.above);
  let posts = state.posts;
  for (const id of ids) {
    const post = get(posts, id);
    if (post === undefined || post.channelId !== channelId) continue;
    if (post.sequence > previous.watermark) read.add(id);
    if (get(post.takenAt, key) === undefined) posts = put(posts, id, { ...post, takenAt: put(post.takenAt, key, sequence) });
  }
  let watermark = previous.watermark;
  const ordered = channelPosts(state, channelId);
  for (const post of ordered) {
    if (post.sequence <= watermark) continue;
    if (!read.has(post.postId)) break;
    watermark = post.sequence;
    read.delete(post.postId);
  }
  const above = ordered.filter((post) => post.sequence > watermark && read.has(post.postId)).map((post) => post.postId);
  const channels = put(get(state.readState, key) ?? keyed<BoardReadState>(), channelId, { watermark, above });
  return { ...state, posts, readState: put(state.readState, key, channels) };
};

const acknowledge = (state: BoardView, post: BoardPostView, addressee: BoardAddressee, sequence: EventSequence): BoardView => {
  const acknowledged = post.acknowledged.some((reader) => sameAuthor(reader, addressee)) ? post.acknowledged : [...post.acknowledged, addressee];
  return markRead({ ...state, posts: put(state.posts, post.postId, { ...post, acknowledged }) }, addressee, post.channelId, [post.postId], sequence);
};

const deliveryWake = (state: BoardView, deliveryId: string, agentId: AgentId): BoardWakeView | undefined =>
  Object.values(state.wakes).find((wake) => wake.deliveryId === deliveryId && wake.targetAgentId === agentId);

export const boardAfter = (state: BoardView, envelope: Pick<EventEnvelope, "event" | "sequence">): BoardView => {
  const { event, sequence } = envelope;
  switch (event._tag) {
    case "board.ChannelOpened": {
      const members = event.kind === "plain" && event.opener._tag === "agent" && !event.members.some((member) => sameAuthor(member, event.opener))
        ? [...event.members, event.opener] : event.members;
      const channel = { ...event, members, seatSequence: sequence };
      let next: BoardView = { ...state, channels: put(state.channels, event.channelId, channel) };
      if (channel.kind === "group") {
        for (const id of Object.keys(indexes(state).parents) as AgentId[]) {
          if (groupMember(next, channel, id)) next = join(next, { _tag: "agent", agentId: id }, channel.channelId);
        }
        if (channel.manager?._tag === "owner") next = join(next, channel.manager, channel.channelId);
      } else {
        for (const member of members) if (member._tag !== "service") next = join(next, member, channel.channelId);
      }
      return next;
    }
    case "board.ChannelMembersChanged": {
      const channel = get(state.channels, event.channelId);
      if (channel === undefined || channel.kind !== "plain") return state;
      const members = channel.members.filter((member) => !event.membersRemoved.some((removed) => sameAuthor(member, removed)));
      for (const added of event.membersAdded) if (!members.some((member) => sameAuthor(member, added))) members.push(added);
      let left = get(state.lastMemberLeft, event.channelId) ?? keyed<EventSequence>();
      for (const removed of event.membersRemoved) left = put(left, readerKey(removed), sequence);
      let next: BoardView = { ...state,
        channels: put(state.channels, event.channelId, { ...channel, members }),
        lastMemberLeft: put(state.lastMemberLeft, event.channelId, left),
      };
      for (const added of event.membersAdded) next = join(next, added, event.channelId);
      return next;
    }
    case "board.ManagerChanged": {
      const channel = get(state.channels, event.channelId);
      if (channel === undefined || channel.kind === "direct") return state;
      const members = channel.kind === "plain" && !channel.members.some((member) => sameAuthor(member, event.manager))
        ? [...channel.members, event.manager] : channel.members;
      const next = { ...state, channels: put(state.channels, event.channelId, {
        ...channel, manager: event.manager, members, seatSequence: sequence,
      }) };
      return join(next, event.manager, event.channelId);
    }
    case "board.PostWritten": {
      const { replyToPostId, ...fields } = event;
      const post: BoardPostView = {
        ...fields, ...(replyToPostId === undefined ? {} : { replyTo: replyToPostId }), sequence, status: "open",
        dispositions: keyed(), decidingReplies: keyed(), acknowledged: [], takenAt: keyed(), reminderAcceptedAt: keyed(), replies: [], returns: keyed(),
      };
      let posts = put(state.posts, post.postId, post);
      const parent = replyToPostId === undefined ? undefined : get(posts, replyToPostId);
      if (parent !== undefined) posts = put(posts, parent.postId, { ...parent, replies: [...parent.replies, post.postId] });
      return { ...state, posts };
    }
    case "board.PostAcknowledged": {
      const post = get(state.posts, event.postId);
      return post === undefined || post.status === "closed" || get(post.dispositions, readerKey(event.addressee)) !== undefined
        ? state : acknowledge(state, post, event.addressee, sequence);
    }
    case "board.AddresseeResolved": {
      const post = get(state.posts, event.postId);
      if (post === undefined || post.status === "closed") return state;
      const key = readerKey(event.addressee);
      const previous = get(post.dispositions, key);
      if (previous !== undefined && !(previous !== "replied" && event.disposition === "replied")
        && !(previous === "no-answer" && (event.disposition === "gone" || event.disposition === "removed"))) return state;
      const updated = { ...post,
        dispositions: put(post.dispositions, key, event.disposition),
        decidingReplies: event.decidingPostId === undefined ? post.decidingReplies : put(post.decidingReplies, key, event.decidingPostId),
      };
      let next: BoardView = { ...state, posts: put(state.posts, post.postId, updated) };
      if (event.disposition === "no-answer" && event.authorIsOwner && event.addressee._tag === "agent"
        && firstOwnerNoAnswer(state, post.postId) === undefined) {
        next = { ...next, ...indexes(state), ownerNoAnswers: put(indexes(state).ownerNoAnswers, post.postId, event.addressee.agentId) } as BoardFold;
      }
      const notice = noticeKey(post.postId, event.addressee);
      if (event.disposition === "no-answer" && post.author._tag === "agent" && !state.stopped.includes(post.author.agentId)) {
        next = { ...next, noAnswers: put(next.noAnswers, notice, {
          postId: post.postId, authorAgentId: post.author.agentId, addressee: event.addressee, returns: 0,
        }) };
      } else if (event.disposition === "replied") {
        next = { ...next, noAnswers: omit(next.noAnswers, notice) };
        next = acknowledge(next, updated, event.addressee, sequence);
      }
      return next;
    }
    case "board.PostClosed": {
      const post = get(state.posts, event.postId);
      if (post === undefined || post.status === "closed") return state;
      const closed: BoardFold = { ...state, ...indexes(state),
        closures: put(indexes(state).closures, post.postId, { closer: event.closer, sequence }),
        posts: put(state.posts, post.postId, { ...post, status: "closed", outcome: event.outcome }),
        completions: event.completionOwed && post.author._tag === "agent"
          ? put(state.completions, post.postId, { postId: post.postId, authorAgentId: post.author.agentId, returns: 0 }) : state.completions,
        noAnswers: filter(state.noAnswers, (notice) => notice.postId !== post.postId),
      };
      return closed;
    }
    case "board.WakeBuilt": return { ...state, wakes: put(state.wakes, event.wakeId, event) };
    case "board.Read": return markRead(state, event.reader, event.channelId, event.postIds, sequence);
    case "DeliveryQueued": {
      const source = event.delivery.source;
      if (source?._tag !== "piece" || source.namespace !== "board") return state;
      const wake = get(state.wakes, source.id);
      return wake === undefined ? state : { ...state, wakes: put(state.wakes, wake.wakeId, { ...wake, deliveryId: event.delivery.id }) };
    }
    case "DeliveryAccepted": {
      const wake = deliveryWake(state, event.deliveryId, event.agentId);
      if (wake === undefined || get(indexes(state).acceptedWakes, wake.wakeId) !== undefined) return state;
      const accepted: BoardFold = { ...state, ...indexes(state),
        acceptedWakes: put(indexes(state).acceptedWakes, wake.wakeId, sequence),
      };
      let next: BoardView = accepted;
      const reader: BoardAddressee = { _tag: "agent", agentId: event.agentId };
      const channels = new Set(wake.carried.flatMap((id) => {
        const post = get(next.posts, id);
        return post === undefined ? [] : [post.channelId];
      }));
      for (const channel of channels) next = markRead(next, reader, channel, wake.carried, sequence);
      for (const id of wake.reminders) {
        const post = get(next.posts, id);
        if (post !== undefined && get(post.reminderAcceptedAt, event.agentId) === undefined) {
          next = { ...next, posts: put(next.posts, id, { ...post,
            reminderAcceptedAt: put(post.reminderAcceptedAt, event.agentId, sequence),
          }) };
        }
      }
      for (const id of wake.completions) if (get(next.completions, id)?.authorAgentId === event.agentId) next = { ...next, completions: omit(next.completions, id) };
      for (const notice of wake.noAnswers) {
        const key = noticeKey(notice.postId, notice.addressee);
        if (get(next.noAnswers, key)?.authorAgentId === event.agentId) next = { ...next, noAnswers: omit(next.noAnswers, key) };
      }
      return next;
    }
    case "DeliveryReturned": {
      const wake = deliveryWake(state, event.deliveryId, event.agentId);
      if (wake === undefined) return state;
      if (get(indexes(state).acceptedWakes, wake.wakeId) !== undefined) {
        return { ...state, lastTurnEnd: put(state.lastTurnEnd, event.agentId, sequence) };
      }
      let next = state;
      for (const id of new Set([...wake.carried, ...wake.reminders])) {
        const post = get(next.posts, id);
        if (post !== undefined) {
          const returns = post.returns ?? keyed<number>();
          next = { ...next, posts: put(next.posts, id, { ...post,
            returns: put(returns, event.agentId, (get(returns, event.agentId) ?? 0) + 1),
          }) };
        }
      }
      for (const id of wake.completions) {
        const completion = get(next.completions, id);
        if (completion?.authorAgentId === event.agentId) next = { ...next, completions: put(next.completions, id, { ...completion, returns: completion.returns + 1 }) };
      }
      for (const notice of wake.noAnswers) {
        const key = noticeKey(notice.postId, notice.addressee);
        const owed = get(next.noAnswers, key);
        if (owed?.authorAgentId === event.agentId) next = { ...next, noAnswers: put(next.noAnswers, key, { ...owed, returns: owed.returns + 1 }) };
      }
      return next;
    }
    case "AgentStarted": {
      const next = { ...state, parents: put(indexes(state).parents, event.agentId, event.parent),
        ceilings: put(state.ceilings, event.agentId, event.permission), labels: put(state.labels, event.agentId, event.groups) };
      return joinGroups(state, next, event.agentId);
    }
    case "AgentGrouped": {
      let left = get(state.lastLabelLeft, event.agentId) ?? keyed<EventSequence>();
      for (const label of get(state.labels, event.agentId) ?? []) if (!event.groups.includes(label)) left = put(left, label, sequence);
      const next = { ...state, labels: put(state.labels, event.agentId, event.groups), lastLabelLeft: put(state.lastLabelLeft, event.agentId, left) };
      return joinGroups(state, next, event.agentId);
    }
    case "AgentStopped": return { ...state,
      stopped: state.stopped.includes(event.agentId) ? state.stopped : [...state.stopped, event.agentId],
      lastStopped: put(state.lastStopped, event.agentId, sequence),
      completions: filter(state.completions, (completion) => completion.authorAgentId !== event.agentId),
      noAnswers: filter(state.noAnswers, (notice) => notice.authorAgentId !== event.agentId),
    };
    case "AgentCrashed":
    case "AgentReloadFailed": return { ...state, lastCrashed: put(state.lastCrashed, event.agentId, sequence) };
    case "StateChanged": {
      if (!state.stopped.includes(event.agentId) || event.state._tag === "stopped") return state;
      let next: BoardView = { ...state, stopped: state.stopped.filter((id) => id !== event.agentId) };
      for (const channel of Object.values(next.channels)) {
        if (channel.kind === "group" ? groupMember(next, channel, event.agentId) : channel.members.some((member) => member._tag === "agent" && member.agentId === event.agentId)) {
          next = join(next, { _tag: "agent", agentId: event.agentId }, channel.channelId);
        }
      }
      return next;
    }
    case "TurnEnded": return event.compact ? state : { ...state, lastTurnEnd: put(state.lastTurnEnd, event.agentId, sequence) };
    default: return state;
  }
};
