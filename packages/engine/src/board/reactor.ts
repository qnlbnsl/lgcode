import { transferName } from "./transferName.ts";
import type { AgentId, Event, EventEnvelope } from "@lgcode/contracts";
import type { BoardPostView } from "@lgcode/contracts/board/view";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import type { Snapshot } from "../commands/internal.ts";
import { writePieceBatch, type PieceBatch } from "../commands/pieceBatch.ts";
import { subscribe } from "../log/subscribe.ts";
import type { EngineLists } from "../pieces/lists.ts";
import { Restart } from "../recovery/service.ts";
import { project } from "../routing/waits.ts";
import { Views } from "../views/Views.ts";
import { canCarryPost, leftChannelAfter, own, successorManager } from "./access.ts";
import { outcome } from "./outcome.ts";
import { activeWakes, boardView, buildWake, completionOwed, isUnread, noAnswerDue, originalsOwed, readerKey, refreshWakes, reminderDue } from "./wake.ts";

const closer = { _tag: "service", service: "board" } as const;
const stoppedAfter = (snapshot: Snapshot, id: string, sequence: number): boolean =>
  (own(boardView(snapshot).lastStopped, id) ?? 0) > sequence;
const gone = (snapshot: Snapshot, id: string, post: BoardPostView): boolean => {
  const agent = own(snapshot.agents, id);
  return stoppedAfter(snapshot, id, post.sequence)
    || (own(boardView(snapshot).lastCrashed, id) ?? 0) > post.sequence
    || (agent?.state._tag === "interrupted" && agent.reloadable !== true);
};

const owesWake = (snapshot: Snapshot, target: AgentId): boolean => {
  const board = boardView(snapshot);
  return Object.values(board.completions).some((debt) => debt.authorAgentId === target && debt.returns < 2)
    || Object.values(board.noAnswers).some((debt) => debt.authorAgentId === target && debt.returns < 2)
    || originalsOwed(snapshot, target).size > 0
    || Object.values(board.posts).some((post) => post.status === "open" && post.reply !== "none"
      && post.to.some((to) => to._tag === "agent" && to.agentId === target) && own(post.dispositions, target) === undefined
      && (own(post.returns ?? {}, target) ?? 0) < 2
      && (isUnread(snapshot, { _tag: "agent", agentId: target }, post) || reminderDue(snapshot, target, post)));
};

// A reminder already built remains owed when cleanup in another target's
// transaction withdraws its wake. Taking intervening work cannot erase it.
const owedReminders = (snapshot: Snapshot, target: AgentId): ReadonlySet<string> => new Set(
  Object.values(boardView(snapshot).wakes).filter((wake) => wake.targetAgentId === target).flatMap((wake) => wake.reminders).filter((id) => {
    const post = own(boardView(snapshot).posts, id);
    return post?.status === "open" && post.reply !== "none" && own(post.dispositions, target) === undefined
      && own(post.reminderAcceptedAt, target) === undefined && (own(post.returns ?? {}, target) ?? 0) < 2;
  }),
);

// Called by writePieceBatch under the writer permit. Every observation, close,
// cleanup and replacement therefore uses the same state as the engine checks.
export const lifecycleBatch = (snapshot: Snapshot, target: AgentId, lists?: EngineLists): PieceBatch => {
  let state = snapshot;
  const events: Event[] = [];
  const append = (event: Event) => { events.push(event); state = project(state, [event], lists); };
  for (const channel of Object.values(boardView(state).channels)) {
    if (channel.kind === "direct" || channel.manager?._tag !== "agent" || channel.manager.agentId !== target
      || !stoppedAfter(state, target, channel.seatSequence)) continue;
    const manager = successorManager(state, channel.channelId);
    if (manager !== undefined) append({ _tag: "board.ManagerChanged", channelId: channel.channelId, manager,
      ...transferName(state, channel, manager, state.agents[target]?.name ?? "agent") });
  }
  for (const original of Object.values(boardView(state).posts)) {
    if (original.status !== "open") continue;
    if (original.author._tag === "agent" && original.author.agentId === target) {
      const stopped = stoppedAfter(state, target, original.sequence);
      if (stopped || leftChannelAfter(state, target, original)) {
        append({ _tag: "board.PostClosed", postId: original.postId, outcome: "withdrawn", closer, completionOwed: !stopped });
        continue;
      }
    }
    if (original.reply === "none") continue;
    const addressee = original.to.find((to) => to._tag === "agent" && to.agentId === target);
    const disposition = own(original.dispositions, target);
    if (addressee !== undefined && (disposition === undefined || disposition === "no-answer")) {
      const resolution = gone(state, target, original) ? "gone"
        : leftChannelAfter(state, target, original) || !canCarryPost(state, target, original.postId) ? "removed"
        : disposition !== undefined ? undefined
        : (own(original.returns ?? {}, target) ?? 0) >= 2 ? "undeliverable"
        : noAnswerDue(state, target, original) ? "no-answer" : undefined;
      if (resolution !== undefined) append({ _tag: "board.AddresseeResolved", postId: original.postId, addressee,
        disposition: resolution, authorIsOwner: original.author._tag === "owner" });
    }
    // A restart may also find resolutions already committed without a close.
    if (addressee === undefined && !(original.author._tag === "agent" && original.author.agentId === target)) continue;
    const post = own(boardView(state).posts, original.postId)!;
    const closed = outcome({ reply: post.reply, dispositions: post.to.map((to) => own(post.dispositions, readerKey(to))) });
    if (closed !== undefined) append({ _tag: "board.PostClosed", postId: post.postId, outcome: closed, closer,
      completionOwed: completionOwed(state, post, closer) });
  }
  // Do not request a rebuild of a healthy wake. In particular a full wake must
  // not be repeatedly cut and rebuilt for a question that did not fit in it.
  const cleaned = refreshWakes(state, [], lists, false, new Set([target]));
  for (const event of cleaned.events) append(event);
  const deliveries = [...cleaned.deliveries];
  const reminders = owedReminders(state, target);
  if (activeWakes(state, target).length === 0 && !cleaned.events.some((event) => event._tag === "board.WakeBuilt" && event.targetAgentId === target)
    && (reminders.size > 0 || owesWake(state, target))) {
    const wake = buildWake(state, target, { reminders });
    if (wake !== undefined) { append(wake.event); deliveries.push(wake.delivery); }
  }
  return { events, deliveries };
};

// A refusal touches nothing. Do not fan an unrelated successful target's wake
// back out to every post by the same author: that would retry refused duties.
const touchedTargets = (snapshot: Snapshot, batch: ReadonlyArray<EventEnvelope>): ReadonlyMap<AgentId, number> => {
  const targets = new Map<AgentId, number>();
  const touch = (target: AgentId, sequence: number) => targets.set(target, Math.max(targets.get(target) ?? 0, sequence));
  const postTargets = (id: string, sequence: number) => {
    const post = own(boardView(snapshot).posts, id);
    if (post === undefined) return;
    if (post.author._tag === "agent") touch(post.author.agentId, sequence);
    for (const to of post.to) if (to._tag === "agent") touch(to.agentId, sequence);
  };
  const channelTargets = (channelId: string, sequence: number) => {
    for (const post of Object.values(boardView(snapshot).posts)) {
      if (post.channelId === channelId) postTargets(post.postId, sequence);
    }
  };
  // A membership change can end a direct pair's last shared channel. Its
  // other participant needs a scan even when its question was already read.
  const directTargets = (id: AgentId, sequence: number) => {
    for (const channel of Object.values(boardView(snapshot).channels)) {
      if (channel.kind === "direct" && channel.members.some((member) => member._tag === "agent" && member.agentId === id)) {
        channelTargets(channel.channelId, sequence);
      }
    }
  };
  for (const { event, sequence } of batch) {
    if (event._tag === "CommandRefused") continue;
    if ("agentId" in event) touch(event.agentId, sequence);
    if (event._tag === "DeliveryQueued") touch(event.delivery.target, sequence);
    if (event._tag === "board.WakeBuilt") touch(event.targetAgentId, sequence);
    else if ("postId" in event && event._tag.startsWith("board.")) {
      postTargets(event.postId, sequence);
      if (event._tag === "board.PostWritten" && event.replyToPostId !== undefined) postTargets(event.replyToPostId, sequence);
    } else if (event._tag === "board.Read") {
      for (const id of event.postIds) postTargets(id, sequence);
    } else if (event._tag === "board.ChannelMembersChanged") {
      channelTargets(event.channelId, sequence);
      for (const member of [...event.membersAdded, ...event.membersRemoved]) {
        if (member._tag === "agent") { touch(member.agentId, sequence); directTargets(member.agentId, sequence); }
      }
    } else if (event._tag === "board.ManagerChanged") {
      channelTargets(event.channelId, sequence);
      if (event.manager._tag === "agent") { touch(event.manager.agentId, sequence); directTargets(event.manager.agentId, sequence); }
    }
    if (event._tag === "AgentGrouped" || event._tag === "AgentStopped") directTargets(event.agentId, sequence);
  }
  return targets;
};

// Service owns the failure policy: LogWriteFailed stops this follower; defects
// restart it after a pause. The gapless, read-only subscription starts from the
// head captured before the scan, so it also finds commits made during the scan.
export const boardReactor = Effect.scoped(Effect.gen(function* () {
  const views = yield* Views;
  const recovery = yield* Effect.serviceOption(Restart);
  if (Option.isSome(recovery)) yield* recovery.value.whenReady;
  const initial = yield* views.snapshot;
  const lists = views.lists;
  // Coalesce buffered notifications already included in a transaction's read.
  // This is disposable subscription bookkeeping, not a durable reactor cursor
  // or a pending duty: every invocation still scans the whole state first.
  const inspected = new Map<AgentId, number>();
  const run = (target: AgentId, sourceSequence?: number) => writePieceBatch({
    namespace: "board", kind: "reactor", sourceSequence: sourceSequence ?? ((snapshot) => snapshot.sequence),
    build: (snapshot) => {
      inspected.set(target, snapshot.sequence);
      return lifecycleBatch(snapshot, target, lists);
    },
  }, lists);
  for (const agent of Object.values(initial.agents)) yield* run(agent.agentId);
  yield* subscribe(initial.sequence).pipe(Stream.runForEachArray((batch) => Effect.gen(function* () {
    const snapshot = yield* views.snapshot;
    for (const [target, sequence] of touchedTargets(snapshot, batch)) {
      if (sequence > (inspected.get(target) ?? 0)) yield* run(target, sequence);
    }
  })));
}));
