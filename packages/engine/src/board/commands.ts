import { randomUUID } from "node:crypto";
import { type AgentId, type Event, type EventEnvelope } from "@lgtm/contracts";
import { ChannelId, PostId, type BoardAddressee, type BoardAuthor } from "@lgtm/contracts/board/ids";
import { holdsIncoming, holdsUnsettled } from "@lgtm/contracts/board/conditions";
import type { BoardPostView } from "@lgtm/contracts/board/view";
import { BoardChannelName, BoardPostText } from "@lgtm/contracts/board/schemas";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { agentReadReply, type ReadHandler, type ReadReply } from "../api/reads.ts";
import { refused, type Input, type Payload, type PiecePlan } from "../commands/internal.ts";
import { holderAbove } from "../routing/holders.ts";
import { canReadContext, resolveContext, type ContextFiles } from "../project/context.ts";
import { project } from "../routing/waits.ts";
import { canAddMember, canClose, canManage, canOpenGroup, canPost, canRead, channelMembers, directGrant, own } from "./access.ts";
import { boardStatus } from "./status.ts";
import { outcome } from "./outcome.ts";
import { activeWakes, boardView, buildWake, completionOwed, encodedBytes, isUnread, neverSentWake, postDispositions, readerKey, refreshWakes, sameAuthor } from "./wake.ts";

type Planner = (input: Input, payload: Record<string, unknown>) => Effect.Effect<PiecePlan, ReturnType<typeof refused>>;
const authorOf = (input: Input): BoardAuthor | undefined => input.actor._tag === "piece" ? undefined : input.actor;
const batchId = <T extends Event["_tag"]>(batch: ReadonlyArray<EventEnvelope>, tag: T): Extract<Event, { _tag: T }> =>
  batch.find((row) => row.event._tag === tag)!.event as Extract<Event, { _tag: T }>;
const withWakes = (input: Input, events: ReadonlyArray<Event>, targets: ReadonlyArray<AgentId>) => {
  const state = project(input.snapshot, events, input.runtime.lists);
  const wakes = refreshWakes(state, targets, input.runtime.lists);
  return { events: [...events, ...wakes.events], deliveries: wakes.deliveries };
};

const open: Planner = (input, raw) => Effect.gen(function* () {
  const payload = raw as Payload<"board.open">;
  const opener = authorOf(input);
  if (opener === undefined || opener._tag === "service") return yield* refused();
  if (payload.group === undefined && payload.anchorAgentId !== undefined) return yield* refused("an anchor requires a group");
  const anchor = payload.anchorAgentId ?? (opener._tag === "agent" ? opener.agentId : undefined);
  if (payload.group !== undefined && !canOpenGroup(input.snapshot, input.actor, payload.group, anchor)) return yield* refused("group cannot be opened");
  const name = yield* input.runtime.log.redactText(payload.name);
  if (!Schema.is(BoardChannelName)(name)) return yield* refused("name holds a secret");
  if (Object.values(boardView(input.snapshot).channels).some((channel) => channel.name === name
    && channel.manager !== undefined && sameAuthor(channel.manager, opener))) return yield* refused("channel name already belongs to this manager");
  const event: Extract<Event, { _tag: "board.ChannelOpened" }> = {
    _tag: "board.ChannelOpened", channelId: Schema.decodeUnknownSync(ChannelId)(randomUUID()), name,
    kind: payload.group === undefined ? "plain" : "group", opener, manager: opener,
    members: payload.group === undefined ? [opener] : [],
    ...(payload.group === undefined ? {} : { group: payload.group, anchorAgentId: anchor! }),
  };
  return { events: [event], reply: (batch) => ({ requestId: payload.requestId, channelId: batchId(batch, "board.ChannelOpened").channelId }) };
});

const members: Planner = (input, raw) => Effect.gen(function* () {
  const payload = raw as Payload<"board.members">;
  const channel = own(boardView(input.snapshot).channels, payload.channelId);
  if (channel?.kind !== "plain" || !canManage(input.snapshot, input.actor, payload.channelId)) return yield* refused("channel cannot be managed");
  if (payload.add.some((id) => !canAddMember(input.snapshot, input.actor, payload.channelId, id))) return yield* refused("member cannot be added");
  const removed = channel.members.filter((member): member is BoardAddressee => member._tag === "agent" && payload.remove.includes(member.agentId));
  const retained = channel.members.filter((member) => !removed.some((item) => sameAuthor(member, item)));
  const added: BoardAddressee[] = [];
  for (const id of payload.add) {
    const member = { _tag: "agent", agentId: id } as const;
    if (![...retained, ...added].some((candidate) => sameAuthor(candidate, member))) added.push(member);
  }
  const memberCount = retained.length + added.length;
  if (memberCount > 64) return yield* refused("a plain channel has at most 64 members");
  const events: Event[] = added.length === 0 && removed.length === 0 ? [] : [{ _tag: "board.ChannelMembersChanged",
    channelId: payload.channelId, membersAdded: added, membersRemoved: removed }];
  return { ...withWakes(input, events, []), reply: () => ({ requestId: payload.requestId, memberCount }) };
});

export const postPlanner = (files?: ContextFiles): Planner => (input, raw) => Effect.gen(function* () {
  const payload = raw as Payload<"board.post">;
  const author = authorOf(input);
  if (author === undefined) return yield* refused();
  const to = payload.to.filter((target, i, all) => all.findIndex((other) => sameAuthor(target, other)) === i);
  if (to.some((target) => sameAuthor(target, author))) return yield* refused("an author cannot address itself");
  const events: Event[] = [];
  let state = input.snapshot;
  let channelId: ChannelId;
  if ("direct" in payload) {
    if (!directGrant(state, author, payload.direct)) return yield* refused("direct grant does not hold");
    const existing = Object.values(boardView(state).channels).find((channel) => channel.kind === "direct"
      && channel.members.length === 2 && channel.members.some((member) => sameAuthor(member, author))
      && channel.members.some((member) => sameAuthor(member, payload.direct)));
    channelId = existing?.channelId ?? Schema.decodeUnknownSync(ChannelId)(randomUUID());
    if (existing === undefined) {
      events.push({ _tag: "board.ChannelOpened", channelId, name: "Direct", kind: "direct", opener: author, members: [author, payload.direct] });
      state = project(state, events, input.runtime.lists);
    }
  } else channelId = payload.channelId;
  if (!canPost(state, input.actor, { channelId, to, reply: payload.reply, ...(payload.replyTo === undefined ? {} : { replyTo: payload.replyTo }) })) {
    return yield* refused("post is not reachable");
  }
  if (to.some((target) => target._tag === "agent" && !channelMembers(state, channelId).some((member) => sameAuthor(member, target)))) return yield* refused("addressee is not a member");
  if (payload.reply !== "none") {
    if (to.length === 0) return yield* refused("a question requires an addressee");
    if (author._tag === "service" && to.some((target) => target._tag === "owner")) return yield* refused("a service cannot ask the owner");
    if (to.some((target) => {
      if (target._tag !== "agent") return false;
      const agent = own(state.agents, target.agentId);
      return agent === undefined || agent.state._tag === "stopped" || agent.state._tag === "crashed"
        || (agent.state._tag === "interrupted" && agent.reloadable !== true);
    })) return yield* refused("addressee is unavailable");
    const openPosts = Object.values(boardView(state).posts).filter((post) => post.status === "open" && post.reply !== "none" && sameAuthor(post.author, author));
    if (openPosts.length >= 64) return yield* refused("an author has at most 64 open questions");
    if (author._tag === "agent" && to.some((target) => target._tag === "owner")
      && openPosts.filter((post) => post.to.some((target) => target._tag === "owner")).length >= 3) return yield* refused("an agent has at most three open owner questions");
  }
  // Sanitise before redaction and before constructing any derived wake text.
  const text = yield* input.runtime.log.redactText(payload.text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, ""));
  if (!Schema.is(BoardPostText)(text)) return yield* refused("post too long once secrets are hidden");
  const postId = Schema.decodeUnknownSync(PostId)(randomUUID());
  const context = yield* resolveContext(input, payload.context, channelMembers(state, channelId), files);
  const written: Event = { _tag: "board.PostWritten", postId, channelId, author, text, to, reply: payload.reply,
    ...(context === undefined ? {} : { context }),
    ...(payload.replyTo === undefined ? {} : { replyToPostId: payload.replyTo }) };
  events.push(written);
  state = project(input.snapshot, events, input.runtime.lists);
  const targets = new Set<AgentId>(payload.reply === "none" ? [] : to.flatMap((target) => target._tag === "agent" ? [target.agentId] : []));
  const parent = payload.replyTo === undefined ? undefined : own(boardView(state).posts, payload.replyTo);
  if (parent?.status === "open" && parent.reply !== "none") {
    const addressee = author._tag === "service" ? undefined : parent.to.find((target) => sameAuthor(target, author));
    if (addressee !== undefined && own(parent.dispositions, readerKey(addressee)) !== "replied") {
      events.push({ _tag: "board.AddresseeResolved", postId: parent.postId, addressee, disposition: "replied", decidingPostId: postId, authorIsOwner: parent.author._tag === "owner" });
      state = project(input.snapshot, events, input.runtime.lists);
    }
    const updated = own(boardView(state).posts, parent.postId)!;
    const closed = outcome({ reply: updated.reply, dispositions: updated.to.map((target) => own(updated.dispositions, readerKey(target))), ownerReplied: author._tag === "owner" });
    if (closed !== undefined && (author._tag === "owner" || (addressee !== undefined && own(parent.dispositions, readerKey(addressee)) !== "replied"))) {
      events.push({ _tag: "board.PostClosed", postId: parent.postId, outcome: closed, closer: author,
        completionOwed: completionOwed(state, updated, author) });
      if (parent.author._tag === "agent") targets.add(parent.author.agentId);
    }
  }
  return { ...withWakes(input, events, [...targets]), reply: (batch) => ({ requestId: payload.requestId, postId: batchId(batch, "board.PostWritten").postId }) };
});

const close: Planner = (input, raw) => Effect.gen(function* () {
  const payload = raw as Payload<"board.close">;
  const post = own(boardView(input.snapshot).posts, payload.postId);
  const closer = authorOf(input);
  if (post === undefined || closer === undefined || !canClose(input.snapshot, input.actor, payload.postId)) return yield* refused("post cannot be closed");
  if (post.status === "closed") return { events: [], reply: () => ({ requestId: payload.requestId, postId: payload.postId, outcome: post.outcome }) };
  const owed = completionOwed(input.snapshot, post, closer, true);
  const event: Event = { _tag: "board.PostClosed", postId: payload.postId, outcome: "withdrawn", closer, completionOwed: owed };
  return { ...withWakes(input, [event], owed && post.author._tag === "agent" ? [post.author.agentId] : []),
    reply: (batch) => ({ requestId: payload.requestId, postId: payload.postId, outcome: batchId(batch, "board.PostClosed").outcome }) };
});

const acknowledge: Planner = (input, raw) => Effect.gen(function* () {
  const payload = raw as Payload<"board.acknowledge">;
  const post = own(boardView(input.snapshot).posts, payload.postId);
  const caller = input.actor;
  if ((caller._tag !== "owner" && caller._tag !== "agent") || post === undefined || post.reply === "none"
    || !post.to.some((target) => sameAuthor(target, caller))
    || !canRead(input.snapshot, caller, post.channelId)) return yield* refused("post cannot be acknowledged");
  const events: Event[] = post.status === "closed" || own(post.dispositions, readerKey(caller)) !== undefined
    || post.acknowledged.some((target) => sameAuthor(target, caller)) ? []
    : [{ _tag: "board.PostAcknowledged", postId: post.postId, addressee: caller }];
  return { ...(events.length === 0 ? { events } : withWakes(input, events, [])), reply: () => ({ requestId: payload.requestId, postId: payload.postId }) };
});

const flush: Planner = (input, raw) => Effect.gen(function* () {
  const payload = raw as Payload<"board.flush">;
  if (input.actor._tag !== "owner" && input.actor._tag !== "service") return yield* refused();
  const agent = own(input.snapshot.agents, payload.agentId);
  if (agent === undefined || agent.state._tag === "stopped" || agent.state._tag === "crashed") return yield* refused("agent is unavailable");
  if (neverSentWake(input.snapshot, payload.agentId) !== undefined) return { events: [], reply: () => ({ requestId: payload.requestId }) };
  const built = buildWake(input.snapshot, payload.agentId, { digestOnly: true });
  return { events: built === undefined ? [] : [built.event], deliveries: built === undefined ? [] : [built.delivery],
    reply: (batch) => ({ requestId: payload.requestId, ...(built === undefined ? {} : { wakeId: batchId(batch, "board.WakeBuilt").wakeId }) }) };
});

// All reads page from one snapshot. Tokens identify an item within the
// full stable order before current selection, and never grant access on a later request.
const page = <T>(items: ReadonlyArray<T>, payload: Record<string, unknown>, key: (item: T) => string,
  wrap: (reply: Record<string, unknown>) => Record<string, unknown> = (reply) => reply,
  orderedKeys: ReadonlyArray<string> = items.map(key)) => {
  const positions = new Map(orderedKeys.map((id, index) => [id, index]));
  const anchor = typeof payload.after === "string" ? positions.get(payload.after) ?? -1 : -1;
  const remaining = items.filter((item) => positions.get(key(item))! > anchor);
  const result: T[] = [];
  const reply = () => ({ requestId: payload.requestId, items: result,
    ...(result.length < remaining.length && result.length > 0 ? { next: key(result.at(-1)!) } : {}) });
  for (const item of remaining) {
    if (result.length >= (payload.limit as number | undefined ?? 200)) break;
    result.push(item);
    // Include the envelope, escaping and cursor in the actual wire budget.
    // A singleton still advances a cursor even for a legacy oversized item.
    if (result.length > 1 && encodedBytes(wrap(reply())) > 512 * 1024) { result.pop(); break; }
  }
  return reply();
};
const channels: ReadHandler = (input, payload) => input.runtime.lists?.boardEnabled === false ? Effect.fail(refused("board disabled")) : Effect.succeed({ reply: page(
  Object.values(boardView(input.snapshot).channels).filter((channel) => canRead(input.snapshot, input.actor, channel.channelId)).map((channel) => ({
    channelId: channel.channelId, name: channel.name, kind: channel.kind, members: channelMembers(input.snapshot, channel.channelId),
    ...(channel.manager === undefined ? {} : { manager: channel.manager }),
    ...(channel.group === undefined ? {} : { group: channel.group }),
    ...(channel.anchorAgentId === undefined ? {} : { anchorAgentId: channel.anchorAgentId }),
  })), payload, (channel) => channel.channelId, undefined, Object.keys(boardView(input.snapshot).channels),
) });

const readPosts = (peek: boolean): ReadHandler => (input, payload) => Effect.gen(function* () {
  if (input.runtime.lists?.boardEnabled === false) return yield* refused("board disabled");
  const { snapshot, actor } = input;
  if (actor._tag !== "owner" && actor._tag !== "agent") return yield* refused();
  if (peek && actor._tag !== "owner") return yield* refused();
  const board = boardView(snapshot);
  const referenced = typeof payload.post === "string" ? own(board.posts, payload.post)
    : typeof payload.repliesTo === "string" ? own(board.posts, payload.repliesTo) : undefined;
  if ((payload.post !== undefined || payload.repliesTo !== undefined)
    && (referenced === undefined || !canRead(snapshot, actor, referenced.channelId))) return yield* refused();
  if (typeof payload.channelId === "string" && !canRead(snapshot, actor, payload.channelId)) return yield* refused();
  const ordered = Object.values(board.posts).sort((a, b) => a.sequence - b.sequence);
  const posts = ordered.filter((post) => canRead(snapshot, actor, post.channelId) && canReadContext(snapshot, actor, post.context)
    && (payload.channelId === undefined || post.channelId === payload.channelId)
    && (payload.post === undefined || post.postId === payload.post)
    && (payload.repliesTo === undefined || post.replyTo === payload.repliesTo)
    && (payload.open !== true || (post.status === "open" && sameAuthor(post.author, actor)))
    && (payload.incoming !== true || (post.status === "open" && post.reply !== "none"
      && post.to.some((to) => sameAuthor(to, actor))
      && (own(post.dispositions, readerKey(actor)) === undefined || own(post.dispositions, readerKey(actor)) === "no-answer"))))
    .sort((a, b) => a.sequence - b.sequence);
  const items = posts.map((post) => ({ postId: post.postId, channelId: post.channelId, author: post.author,
    ...(post.context === undefined ? {} : { context: post.context }),
    text: post.text, to: post.to, reply: post.reply, sequence: post.sequence, status: post.status,
    dispositions: postDispositions(post), acknowledged: post.acknowledged,
    ...(post.replyTo === undefined ? {} : { replyTo: post.replyTo }),
    ...(post.outcome === undefined ? {} : { outcome: post.outcome }),
  }));
  const wrap = (value: Record<string, unknown>) => actor._tag === "agent" ? agentReadReply(payload.requestId, value) : value;
  const plain = page(items, payload, (post) => post.postId, wrap, ordered.map((post) => post.postId));
  const reply = wrap(plain);
  const returned = new Set(plain.items.map((post) => post.postId));
  const unread = posts.filter((post) => returned.has(post.postId) && isUnread(snapshot, actor, post));
  const byChannel = new Map<ChannelId, PostId[]>();
  for (const post of unread) {
    const ids = byChannel.get(post.channelId) ?? [];
    ids.push(post.postId);
    byChannel.set(post.channelId, ids);
  }
  const marks: Event[] = [...byChannel].map(([channelId, postIds]) => ({ _tag: "board.Read", channelId, reader: actor, postIds }));
  return { reply, marks: peek ? [] : marks };
});

const status = (input: Input, raw: Record<string, unknown>): Effect.Effect<ReadReply, ReturnType<typeof refused>> => Effect.gen(function* () {
  const payload = raw as Payload<"board.status">;
  const { snapshot, actor } = input;
  const board = boardView(snapshot);
  const disabled = input.runtime.lists?.boardEnabled === false;
  if (payload.agentId === undefined) {
    if (actor._tag !== "owner" && actor._tag !== "service") return yield* refused();
    const { posts: _posts, ...conditions } = boardStatus(snapshot, !disabled);
    return { reply: { requestId: payload.requestId, ...conditions } };
  }
  const id = payload.agentId;
  if (own(snapshot.agents, id) === undefined) return yield* refused("agent not found");
  const holder = holderAbove(snapshot, id);
  if (actor._tag !== "owner" && actor._tag !== "service" && !(actor._tag === "agent" && (actor.agentId === id
    || (holder._tag === "agent" && holder.agentId === actor.agentId)))) return yield* refused();
  if (disabled) return { reply: { requestId: payload.requestId, agentId: id, sequence: snapshot.sequence, disabled: true,
    unread: 0, incomingOpen: 0, ownOpen: 0, owed: 0, failedCompletions: 0, wakeQueued: false, wakeSent: false,
    holdsUnsettled: false, holdsIncoming: false } };
  const posts = Object.values(board.posts).sort((a, b) => a.sequence - b.sequence);
  const incoming = posts.filter((post) => post.status === "open" && post.reply !== "none"
    && post.to.some((to) => to._tag === "agent" && to.agentId === id)
    && (own(post.dispositions, id) === undefined || own(post.dispositions, id) === "no-answer"));
  const ownPosts = posts.filter((post) => post.status === "open" && post.reply !== "none" && post.author._tag === "agent" && post.author.agentId === id);
  const completions = Object.values(board.completions).filter((debt) => debt.authorAgentId === id);
  const noAnswers = Object.values(board.noAnswers).filter((notice) => notice.authorAgentId === id);
  if (payload.detail !== undefined) {
    const failed = new Set([...completions, ...noAnswers].filter((debt) => debt.returns >= 2).map((debt) => debt.postId));
    const ids = new Set([...completions, ...noAnswers].map((debt) => debt.postId));
    const details = (payload.detail === "incoming" ? incoming : payload.detail === "own" ? ownPosts : posts.filter((post) => ids.has(post.postId))).map((post: BoardPostView) => ({
      postId: post.postId, channelId: post.channelId, reply: post.reply, to: post.to, dispositions: postDispositions(post), acknowledged: post.acknowledged,
      ...(post.outcome === undefined ? {} : { outcome: post.outcome }), ...(failed.has(post.postId) ? { deliveryFailed: true } : {}),
    }));
    return { reply: page(details, raw, (post) => post.postId, undefined, posts.map((post) => post.postId)) };
  }
  const wakes = activeWakes(snapshot, id);
  return { reply: { requestId: payload.requestId, agentId: id, sequence: snapshot.sequence, disabled: false,
    unread: posts.filter((post) => canRead(snapshot, { _tag: "agent", agentId: id }, post.channelId) && isUnread(snapshot, { _tag: "agent", agentId: id }, post)).length,
    incomingOpen: incoming.length, ownOpen: ownPosts.length, owed: completions.length + noAnswers.length,
    failedCompletions: [...completions, ...noAnswers].filter((debt) => debt.returns >= 2).length,
    wakeQueued: wakes.some((wake) => own(snapshot.deliveries, wake.deliveryId!)?.status === "queued"),
    wakeSent: wakes.some((wake) => own(snapshot.deliveries, wake.deliveryId!)?.status === "sent"),
    holdsUnsettled: holdsUnsettled(id, board, snapshot.deliveries), holdsIncoming: holdsIncoming(id, board),
  } };
});

export const boardPlanners = { "board.open": open, "board.members": members, "board.post": postPlanner(),
  "board.close": close, "board.acknowledge": acknowledge, "board.flush": flush } satisfies Record<string, Planner>;
export const boardReads = { "board.read": readPosts(false), "board.peek": readPosts(true), "board.channels": channels, "board.status": status } satisfies Record<string, ReadHandler>;
