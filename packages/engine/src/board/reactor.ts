import type { AgentId, Event, EventEnvelope } from "@shephrd/contracts";
import type { BoardPostView } from "@shephrd/contracts/board/view";
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
import { own, successorManager } from "./access.ts";
import { outcome } from "./outcome.ts";
import { activeWakes, boardView, buildWake, completionOwed, isUnread, noAnswerDue, readerKey, refreshWakes, reminderDue } from "./wake.ts";

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
    || Object.values(board.posts).some((post) => post.status === "open" && post.reply !== "none"
      && post.to.some((to) => to._tag === "agent" && to.agentId === target) && own(post.dispositions, target) === undefined
      && (own(post.returns ?? {}, target) ?? 0) < 2
      && (isUnread(snapshot, { _tag: "agent", agentId: target }, post) || reminderDue(snapshot, target, post)));
};

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
    if (manager !== undefined) append({ _tag: "board.ManagerChanged", channelId: channel.channelId, manager });
  }
  for (const original of Object.values(boardView(state).posts)) {
    if (original.status !== "open") continue;
    if (original.author._tag === "agent" && original.author.agentId === target && stoppedAfter(state, target, original.sequence)) {
      append({ _tag: "board.PostClosed", postId: original.postId, outcome: "withdrawn", closer, completionOwed: false });
      continue;
    }
    if (original.reply === "none") continue;
    const addressee = original.to.find((to) => to._tag === "agent" && to.agentId === target);
    const disposition = own(original.dispositions, target);
    if (addressee !== undefined && (disposition === undefined || disposition === "no-answer")) {
      const resolution = gone(state, target, original) ? "gone"
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
  const cleaned = refreshWakes(state, [], lists);
  for (const event of cleaned.events) append(event);
  const deliveries = [...cleaned.deliveries];
  if (activeWakes(state, target).length === 0 && !cleaned.events.some((event) => event._tag === "board.WakeBuilt" && event.targetAgentId === target)
    && owesWake(state, target)) {
    const wake = buildWake(state, target);
    if (wake !== undefined) { append(wake.event); deliveries.push(wake.delivery); }
  }
  return { events, deliveries };
};

// A refusal touches nothing. Do not fan an unrelated successful target's wake
// back out to every post by the same author: that would retry refused duties.
const touchedTargets = (snapshot: Snapshot, batch: ReadonlyArray<EventEnvelope>): ReadonlySet<AgentId> => {
  const targets = new Set<AgentId>();
  const postTargets = (id: string) => {
    const post = own(boardView(snapshot).posts, id);
    if (post === undefined) return;
    if (post.author._tag === "agent") targets.add(post.author.agentId);
    for (const to of post.to) if (to._tag === "agent") targets.add(to.agentId);
  };
  for (const { event } of batch) {
    if (event._tag === "CommandRefused") continue;
    if ("agentId" in event) targets.add(event.agentId);
    if (event._tag === "DeliveryQueued") targets.add(event.delivery.target);
    if (event._tag === "board.WakeBuilt") targets.add(event.targetAgentId);
    else if ("postId" in event && event._tag.startsWith("board.")) {
      postTargets(event.postId);
      if (event._tag === "board.PostWritten" && event.replyToPostId !== undefined) postTargets(event.replyToPostId);
    } else if (event._tag === "board.Read") {
      for (const id of event.postIds) postTargets(id);
    } else if (event._tag === "board.ManagerChanged" && event.manager._tag === "agent") targets.add(event.manager.agentId);
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
  const run = (target: AgentId, sourceSequence: number) => writePieceBatch({
    namespace: "board", kind: "reactor", sourceSequence,
    build: (snapshot) => lifecycleBatch(snapshot, target, lists),
  }, lists);
  for (const agent of Object.values(initial.agents)) yield* run(agent.agentId, initial.sequence);
  yield* subscribe(initial.sequence).pipe(Stream.runForEachArray((batch) => Effect.gen(function* () {
    const snapshot = yield* views.snapshot;
    for (const target of touchedTargets(snapshot, batch)) yield* run(target, batch.at(-1)!.sequence);
  })));
}));
