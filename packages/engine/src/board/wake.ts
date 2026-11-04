import { randomBytes, randomUUID } from "node:crypto";
import { settled, type AgentId, type Event } from "@shephrd/contracts";
import { WakeId, type BoardAddressee, type BoardAuthor } from "@shephrd/contracts/board/ids";
import { boardLimits } from "@shephrd/contracts/board/limits";
import type { BoardCompletion } from "@shephrd/contracts/board/schemas";
import type { BoardPostView, BoardView, BoardWakeView } from "@shephrd/contracts/board/view";
import * as Schema from "effect/Schema";
import type { PiecePlan, Snapshot } from "../commands/internal.ts";
import { escapeLeadingSlash } from "../routing/envelope.ts";
import { project } from "../routing/waits.ts";
import type { EngineLists } from "../pieces/lists.ts";
import { canCarryCompletion, canCarryPost, own } from "./access.ts";
import { outcome } from "./outcome.ts";
import type { BoardFold } from "./view.ts";

type DeliveryRequest = NonNullable<PiecePlan["deliveries"]>[number];

export const boardView = (snapshot: Snapshot): BoardView => snapshot.board as BoardView;
export const sameAuthor = (a: BoardAuthor, b: BoardAuthor): boolean => a._tag === b._tag && (
  a._tag === "owner" || (a._tag === "agent" && b._tag === "agent" && a.agentId === b.agentId)
  || (a._tag === "service" && b._tag === "service" && a.service === b.service)
);
export const readerKey = (reader: BoardAddressee): string => reader._tag === "owner" ? "owner" : reader.agentId;
export const encodedBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");
export const postDispositions = (post: BoardPostView): BoardCompletion["dispositions"] => post.to.flatMap((addressee) => {
  const key = readerKey(addressee);
  const disposition = own(post.dispositions, key);
  const replyId = own(post.decidingReplies, key);
  return disposition === undefined ? [] : [{ addressee, disposition, ...(replyId === undefined ? {} : { replyId }) }];
});
export const isUnread = (snapshot: Snapshot, reader: BoardAddressee, post: BoardPostView): boolean => {
  const state = own(own(boardView(snapshot).readState, readerKey(reader)) ?? {}, post.channelId);
  return state === undefined || (post.sequence > state.watermark && !state.above.includes(post.postId));
};
const orderedPosts = (snapshot: Snapshot) => Object.values(boardView(snapshot).posts).sort((a, b) => a.sequence - b.sequence);
const authorLabel = (author: BoardAuthor): string => author._tag === "agent" ? `agent ${author.agentId}`
  : author._tag === "service" ? `service ${author.service}` : "owner";

// Each body has its own boundary. A copied boundary in agent text cannot end
// the next post, even when several posts ride in one engine envelope.
const postText = (post: BoardPostView | BoardCompletion["replies"][number], state: string, mustReply = false): string => {
  const text = escapeLeadingSlash(post.text);
  let marker = randomBytes(18).toString("base64url");
  while (text.includes(marker)) marker = randomBytes(18).toString("base64url");
  return `Post ${post.postId} from ${authorLabel(post.author)} in channel ${post.channelId}; reply ${post.reply}; ${state}.\n`
    + (mustReply ? "Run board.acknowledge with this post's id when you start responding.\n" : "")
    + `Data [${marker}]\n${text}\nEnd data [${marker}]`;
};

// The bounded payload is also used by reads/tests independently of formatting.
// Unresolved addressees have no disposition yet. Only deciding replies, plus
// the owner's closing reply, enter the bounded id list.
export const completionFor = (snapshot: Snapshot, postId: string): BoardCompletion => {
  const post = own(boardView(snapshot).posts, postId);
  if (post === undefined || post.outcome === undefined) throw new Error("completion requires a closed post");
  const deciding = new Set(Object.values(post.decidingReplies));
  const closure = own((boardView(snapshot) as Partial<BoardFold>).closures ?? {}, postId);
  if (post.outcome === "answered" && closure?.closer._tag === "owner") {
    const ownerReply = post.replies.map((id) => own(boardView(snapshot).posts, id)).find((reply) => reply?.author._tag === "owner" && reply.sequence < closure.sequence);
    if (ownerReply !== undefined) deciding.add(ownerReply.postId);
  }
  const replyIds = post.replies.filter((id) => deciding.has(id)).slice(0, 17);
  const payload: BoardCompletion = {
    postId: post.postId, outcome: post.outcome, dispositions: postDispositions(post),
    replyIds, totalReplies: post.replies.length, replies: [],
  };
  if (post.author._tag !== "agent" || !canCarryCompletion(snapshot, post.author.agentId, postId, true)) return payload;
  let result = payload;
  for (const id of replyIds) {
    const reply = own(boardView(snapshot).posts, id);
    if (reply === undefined) continue;
    const item = { postId: reply.postId, channelId: reply.channelId, author: reply.author, text: reply.text,
      to: reply.to, reply: reply.reply, ...(reply.replyTo === undefined ? {} : { replyTo: reply.replyTo }) };
    const next = { ...result, replies: [...result.replies, item] };
    if (encodedBytes(next) > 64 * 1024 || encodedBytes(renderCompletion(snapshot, next)) > 64 * 1024) break;
    result = next;
  }
  return result;
};

const renderCompletion = (snapshot: Snapshot, completion: BoardCompletion): string => {
  const { replies, ...metadata } = completion;
  const post = own(boardView(snapshot).posts, completion.postId)!;
  const reason = completion.outcome !== "withdrawn" ? ""
    : post.author._tag === "agent" && !canCarryCompletion(snapshot, post.author.agentId, post.postId, true)
      ? "\nThe author was removed from the channel." : "\nThe post was withdrawn.";
  const omitted = completion.totalReplies - replies.length;
  return `Completion ${JSON.stringify(metadata)}${reason}`
    + replies.map((reply) => `\n${postText(reply, "reply")}`).join("")
    + (omitted === 0 ? "" : `\n${omitted} more replies; run board.read with repliesTo ${completion.postId}`);
};

export const activeWakes = (snapshot: Snapshot, target: string): ReadonlyArray<BoardWakeView> =>
  Object.values(boardView(snapshot).wakes).filter((wake) => {
    const delivery = wake.deliveryId === undefined ? undefined : own(snapshot.deliveries, wake.deliveryId);
    return wake.targetAgentId === target && delivery?.target === target && (delivery.status === "queued" || delivery.status === "sent");
  });
export const neverSentWake = (snapshot: Snapshot, target: string): BoardWakeView | undefined =>
  activeWakes(snapshot, target).find((wake) => {
    const delivery = own(snapshot.deliveries, wake.deliveryId!)!;
    return delivery.status === "queued" && delivery.method === undefined;
  });
const noticeKey = (notice: { readonly postId: string; readonly addressee: BoardAddressee }) =>
  JSON.stringify([notice.postId, notice.addressee._tag, readerKey(notice.addressee)]);

export const reminderDue = (snapshot: Snapshot, target: string, post: BoardPostView): boolean => {
  const board = boardView(snapshot);
  const taken = own(post.takenAt, target);
  return post.status === "open" && post.reply !== "none" && post.to.some((to) => to._tag === "agent" && to.agentId === target)
    && own(post.dispositions, target) === undefined && taken !== undefined
    && (own(board.lastTurnEnd, target) ?? 0) > taken && own(post.reminderAcceptedAt, target) === undefined
    && settled(snapshot, target)
    && !Object.values(board.posts).some((row) => row.status === "open" && row.reply !== "none" && row.author._tag === "agent" && row.author.agentId === target)
    && !Object.values(board.completions).some((row) => row.authorAgentId === target && row.returns < 2);
};

export interface BuiltWake { readonly event: Extract<Event, { _tag: "board.WakeBuilt" }>; readonly delivery: DeliveryRequest }
// Call under the writer permit, after projecting withdrawals and post changes.
// A flush may deliver a digest on its own; cleanup never wakes for notices alone.
export const buildWake = (snapshot: Snapshot, target: AgentId, options: {
  readonly digestOnly?: boolean;
  readonly reminders?: ReadonlySet<string>;
} = {}): BuiltWake | undefined => {
  const agent = own(snapshot.agents, target);
  if (agent === undefined || agent.state._tag === "stopped" || agent.state._tag === "crashed") return undefined;
  const board = boardView(snapshot);
  const reservations = activeWakes(snapshot, target);
  const reservedPosts = new Set(reservations.flatMap((wake) => [...wake.carried, ...wake.mustReply, ...wake.reminders]));
  const reservedCompletions = new Set(reservations.flatMap((wake) => wake.completions));
  const reservedNotices = new Set(reservations.flatMap((wake) => wake.noAnswers.map(noticeKey)));
  const event: Extract<Event, { _tag: "board.WakeBuilt" }> = {
    _tag: "board.WakeBuilt", wakeId: Schema.decodeUnknownSync(WakeId)(randomUUID()), targetAgentId: target,
    carried: [], mustReply: [], completions: [], completionReplyText: [], reminders: [], noAnswers: [],
  };
  let built = event;
  const parts: string[] = [];
  // Reserve space for both overflow counters and the engine's author line.
  const fits = (text: string) => encodedBytes([...parts, text].join("\n\n")) <= boardLimits.wakeBytes - 1024;
  let completionBytes = 0;
  for (const debt of Object.values(board.completions)) {
    if (debt.authorAgentId !== target || reservedCompletions.has(debt.postId)) continue;
    const completion = completionFor(snapshot, debt.postId);
    const text = renderCompletion(snapshot, completion);
    const cost = Math.max(encodedBytes(completion), encodedBytes(text));
    if (completionBytes + cost > 128 * 1024 || !fits(text)) break;
    parts.push(text);
    completionBytes += cost;
    built = { ...built, completions: [...built.completions, debt.postId],
      completionReplyText: completion.replies.some((reply) => reply.text.length > 0)
        ? [...built.completionReplyText, debt.postId] : built.completionReplyText };
  }
  for (const notice of Object.values(board.noAnswers)) {
    if (notice.authorAgentId !== target || reservedNotices.has(noticeKey(notice))) continue;
    const text = `${authorLabel(notice.addressee)} has given no answer to your post ${notice.postId}. A late reply still counts. You can close the post, ask again, or wait.`;
    if (!fits(text)) break;
    parts.push(text);
    built = { ...built, noAnswers: [...built.noAnswers, { postId: notice.postId, addressee: notice.addressee }] };
  }
  const posts = orderedPosts(snapshot);
  for (const post of posts) {
    const retained = options.reminders?.has(post.postId) === true && post.status === "open" && post.reply !== "none"
      && own(post.dispositions, target) === undefined && own(post.reminderAcceptedAt, target) === undefined;
    if (reservedPosts.has(post.postId) || !canCarryPost(snapshot, target, post.postId) || (!retained && !reminderDue(snapshot, target, post))) continue;
    const text = `Reminder: post ${post.postId} in channel ${post.channelId} still needs your reply. Reply, even to say you have nothing to add.`;
    if (!fits(text)) break;
    parts.push(text);
    built = { ...built, reminders: [...built.reminders, post.postId] };
  }
  let omittedQuestions = 0;
  for (const post of posts) {
    if (post.status !== "open" || post.reply === "none" || !post.to.some((to) => to._tag === "agent" && to.agentId === target)
      || own(post.dispositions, target) !== undefined || post.acknowledged.some((to) => to._tag === "agent" && to.agentId === target)
      || !isUnread(snapshot, { _tag: "agent", agentId: target }, post) || reservedPosts.has(post.postId)
      || !canCarryPost(snapshot, target, post.postId)) continue;
    const text = postText(post, post.status, true);
    if (omittedQuestions > 0 || !fits(text)) { omittedQuestions++; continue; }
    parts.push(text);
    built = { ...built, carried: [...built.carried, post.postId], mustReply: [...built.mustReply, post.postId] };
  }
  const hasDuty = built.completions.length + built.noAnswers.length + built.reminders.length + built.mustReply.length > 0;
  if (!hasDuty && options.digestOnly !== true) return undefined;
  let noticeCount = 0;
  let omittedNotices = 0;
  for (const post of posts) {
    if (post.reply !== "none" || !isUnread(snapshot, { _tag: "agent", agentId: target }, post)
      || reservedPosts.has(post.postId) || !canCarryPost(snapshot, target, post.postId)) continue;
    const text = postText(post, post.status);
    if (noticeCount === 20 || omittedNotices > 0 || !fits(text)) { omittedNotices++; continue; }
    parts.push(text);
    noticeCount++;
    built = { ...built, carried: [...built.carried, post.postId] };
  }
  if (parts.length === 0) return undefined;
  if (omittedNotices > 0) parts.push(`${omittedNotices} more unread posts.`);
  if (omittedQuestions > 0) parts.push(`${omittedQuestions} more posts need your reply; run board.read with incoming set`);
  return { event: built, delivery: { target, sourceId: built.wakeId, body: parts.join("\n\n") } };
};

export const completionOwed = (snapshot: Snapshot, post: BoardPostView, closer: BoardAuthor, withdrawn = false): boolean =>
  post.author._tag === "agent" && (own(boardView(snapshot).lastStopped, post.author.agentId) ?? 0) <= post.sequence
  && !(withdrawn && sameAuthor(post.author, closer));

// Shared by command cleanup and the reactor. Call with the transaction's
// snapshot, never a cached view. New delivery requests are materialised only
// after these events by the engine's piece batch path.
export const refreshWakes = (snapshot: Snapshot, targets: ReadonlyArray<AgentId>, lists?: EngineLists, digestOnly = false): {
  readonly events: ReadonlyArray<Event>; readonly deliveries: ReadonlyArray<DeliveryRequest>;
} => {
  const events: Event[] = [];
  let state = snapshot;
  const append = (event: Event) => { events.push(event); state = project(state, [event], lists); };
  const rebuilding = new Set(targets);
  const reminders = new Map<AgentId, Set<string>>();
  // Resolve reach losses and clean their consequences to a fixed point before
  // building any replacement. A close can invalidate other queued wakes.
  let changed: boolean;
  do {
    changed = false;
    for (const wake of Object.values(boardView(state).wakes)) {
      const delivery = wake.deliveryId === undefined ? undefined : own(state.deliveries, wake.deliveryId);
      if (delivery?.status !== "queued") continue;
      const stale = wake.mustReply.some((id) => {
        const post = own(boardView(state).posts, id);
        return post === undefined || post.status === "closed" || own(post.dispositions, wake.targetAgentId) !== undefined
          || post.acknowledged.some((to) => to._tag === "agent" && to.agentId === wake.targetAgentId);
      }) || wake.reminders.some((id) => {
        const post = own(boardView(state).posts, id);
        return post === undefined || post.status === "closed" || own(post.dispositions, wake.targetAgentId) !== undefined;
      }) || [...wake.carried, ...wake.reminders].some((id) => !canCarryPost(state, wake.targetAgentId, id))
        || wake.completions.some((id) => own(boardView(state).completions, id) === undefined
          || !canCarryCompletion(state, wake.targetAgentId, id, wake.completionReplyText.includes(id)))
        || wake.noAnswers.some((notice) => !Object.values(boardView(state).noAnswers).some((owed) => noticeKey(owed) === noticeKey(notice)));
      // A read alone leaves the safety net. Acknowledgement removes it.
      if (!stale && !(rebuilding.has(wake.targetAgentId) && delivery.method === undefined)) continue;
      const retained = reminders.get(wake.targetAgentId) ?? new Set<string>();
      for (const id of wake.reminders) retained.add(id);
      reminders.set(wake.targetAgentId, retained);
      append({ _tag: "DeliveryWithdrawn", agentId: delivery.target, deliveryId: delivery.id, reason: "board wake replaced" });
      rebuilding.add(wake.targetAgentId);
      changed = true;
    }
    for (const target of rebuilding) {
      const agent = own(state.agents, target);
      // Lifecycle is the reactor's rule, never a channel removal. In
      // particular, a stopped group member must resolve gone, not removed.
      if (agent === undefined || agent.state._tag === "stopped" || agent.state._tag === "crashed"
        || (agent.state._tag === "interrupted" && agent.reloadable !== true)) continue;
      for (const post of orderedPosts(state)) {
        const to = post.to.find((to) => to._tag === "agent" && to.agentId === target);
        const disposition = own(post.dispositions, target);
        if (to === undefined || post.status !== "open" || post.reply === "none"
          || (disposition !== undefined && disposition !== "no-answer") || canCarryPost(state, target, post.postId)) continue;
        append({ _tag: "board.AddresseeResolved", postId: post.postId, addressee: to, disposition: "removed", authorIsOwner: post.author._tag === "owner" });
        changed = true;
        const updated = own(boardView(state).posts, post.postId)!;
        const closed = outcome({ reply: updated.reply, dispositions: updated.to.map((to) => own(updated.dispositions, readerKey(to))) });
        if (closed !== undefined) {
          append({ _tag: "board.PostClosed", postId: post.postId, outcome: closed, closer: { _tag: "service", service: "board" },
            completionOwed: completionOwed(state, updated, { _tag: "service", service: "board" }) });
          if (post.author._tag === "agent") rebuilding.add(post.author.agentId);
        }
      }
    }
  } while (changed);
  const deliveries: DeliveryRequest[] = [];
  for (const target of rebuilding) {
    const built = buildWake(state, target, { digestOnly, ...(reminders.has(target) ? { reminders: reminders.get(target)! } : {}) });
    if (built === undefined) continue;
    append(built.event);
    deliveries.push(built.delivery);
  }
  return { events, deliveries };
};
