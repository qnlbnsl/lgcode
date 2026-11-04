import type { RolesAction, RolesActionRecord, EventEnvelope } from "@shephrd/contracts";
import type { BoardView } from "@shephrd/contracts/board/view";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type { Snapshot } from "../../commands/internal.ts";
import { executeService } from "../../commands/services.ts";
import { holderAbove } from "../../routing/holders.ts";
import { Views } from "../../views/Views.ts";
import type { EngineLists } from "../../pieces/lists.ts";
import type { RolesView } from "../view.ts";
import { actionRequestId, actionSubject } from "./requests.ts";

export const sheepdogCaller = { _tag: "service", service: "roles.sheepdog" } as const;
const own = <T>(rows: Readonly<Record<string, T>>, id: string): T | undefined => Object.hasOwn(rows, id) ? rows[id] : undefined;
export const noticeRecipient = (snapshot: Snapshot, agentId: string): RolesAction["noticeRecipient"] => {
  const holder = holderAbove(snapshot, agentId);
  return holder._tag === "owner" ? "owner" : holder.agentId;
};
export const sanitizeName = (name: string): string => name.replace(/[^\p{L}\p{N} ._-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80);
const fixedText: Record<RolesAction["_tag"], string> = {
  "roles.StallSeen": "Work is waiting. Check the board and carry on, or report what is blocking it.",
  "roles.StallEnded": "Work has resumed.",
  "roles.ReplaceAdvised": "This agent has stalled repeatedly. Review its work and consider replacing it.",
  "roles.RunawayReported": "This agent has passed its running limit. Review its current turn.",
  "roles.GaveUp": "Automatic recovery has ended. Review this agent and decide how to continue.",
  "roles.CrashAdmitted": "Automatic crash recovery has been admitted.",
  "roles.CrashRetried": "This agent was resumed after a crash. Check that its work continues.",
  "roles.CapacityRetried": "A capacity hold has been released for another attempt.",
  "roles.TeamIdleReported": "The team has no running work. Check the board and carry on, or report what is blocking it.",
  "roles.RoleAdviceBroken": "This agent's role advice needs review.",
  "roles.CacheFlushed": "The queued board notice has been flushed.",
  "roles.CompactRequested": "Context compaction was requested.",
};
export const noticeText = (kind: RolesAction["_tag"], name: string): string => `${fixedText[kind]} Agent: ${sanitizeName(name) || "Unnamed agent"}.`;
export const shouldFlush = (kind: RolesAction["_tag"]): boolean => [
  "roles.StallSeen", "roles.ReplaceAdvised", "roles.GaveUp", "roles.CrashRetried", "roles.TeamIdleReported", "roles.RunawayReported",
].includes(kind);

interface WakeContents {
  readonly posts: ReadonlyArray<{ readonly author: { readonly _tag: string; readonly service?: string; readonly agentId?: string } }>;
  readonly completions: ReadonlyArray<unknown>;
  readonly reminders: ReadonlyArray<unknown>;
  readonly noAnswers: ReadonlyArray<unknown>;
}
export const isSheepdogTurn = (wake: WakeContents): boolean => wake.posts.length > 0
  && wake.completions.length === 0 && wake.reminders.length === 0 && wake.noAnswers.length === 0
  && wake.posts.every((post) => post.author._tag === "service" && post.author.service === "roles.sheepdog");
export const deliveryIsSheepdogTurn = (snapshot: Snapshot, id: string): boolean => {
  const delivery = own(snapshot.deliveries, id);
  if (delivery === undefined) return false;
  if (delivery.sender._tag === "service" && delivery.sender.service === "roles.sheepdog") return true;
  if (delivery.source?._tag !== "piece" || delivery.source.namespace !== "board") return false;
  const board = snapshot.board as BoardView;
  const wake = own(board.wakes, delivery.source.id);
  if (wake === undefined) return false;
  const posts = wake.carried.map((post) => own(board.posts, post));
  return posts.every((post) => post !== undefined) && isSheepdogTurn({
    posts: posts.filter((post) => post !== undefined), completions: wake.completions, reminders: wake.reminders, noAnswers: wake.noAnswers,
  });
};

export type NoticeAction = RolesAction extends infer A ? A extends RolesAction ? Omit<A, "notice" | "postId"> : never : never;
export const recordAction = (action: RolesAction, rule: string, lists: EngineLists) => executeService(sheepdogCaller, "roles.record", {
  requestId: actionRequestId({ rule, subject: actionSubject(action), triggerSequence: action.triggerSequence,
    kind: `${action._tag}.record`, recipient: action.noticeRecipient, occurrence: action.occurrence }), action,
}, lists).pipe(Effect.catchTag("CommandRefused", () => Effect.logError("sheepdog action record refused")));

// The command replies carry the post id and receipts preserve it across a
// crash between posting, flushing and recording. No agent prose enters text.
export const sendNotice = (action: NoticeAction, rule: string, lists: EngineLists) => Effect.gen(function* () {
  const snapshot = yield* (yield* Views).snapshot;
  if (action._tag === "roles.TeamIdleReported"
    && (own((snapshot.roles as RolesView).snoozes, action.group) ?? -Infinity) > (yield* Clock.currentTimeMillis)) return;
  const id = (kind: string) => actionRequestId({ rule, subject: actionSubject(action), triggerSequence: action.triggerSequence,
    kind: `${action._tag}.${kind}`, recipient: action.noticeRecipient, occurrence: action.occurrence });
  let postId: string | undefined;
  let notice: "sent" | "board-off" = "sent";
  if (action.noticeRecipient !== "owner") {
    const status = yield* executeService(sheepdogCaller, "board.status", { requestId: id("status") }, lists);
    if (status.disabled === true) notice = "board-off";
    else {
      const post = yield* executeService(sheepdogCaller, "board.post", {
        requestId: id("post"), direct: { _tag: "agent", agentId: action.noticeRecipient }, to: [{ _tag: "agent", agentId: action.noticeRecipient }], reply: "none",
        text: action._tag === "roles.GaveUp" && action.cause === "capacity"
          ? `Capacity recovery has ended. Move the work to another model. Agent: ${sanitizeName(own(snapshot.agents, action.agentId)?.name ?? "Unnamed agent") || "Unnamed agent"}.`
          : noticeText(action._tag, own(snapshot.agents, action.agentId)?.name ?? "Unnamed agent"),
      }, lists).pipe(Effect.result);
      if (post._tag === "Failure") {
        if (post.failure._tag === "LogWriteFailed") return yield* post.failure;
        // A switch or a disappearing recipient can race the status read.
        const latest = yield* executeService(sheepdogCaller, "board.status", { requestId: id("status") }, lists);
        if (latest.disabled !== true) return yield* post.failure;
        notice = "board-off";
      } else {
        postId = post.success.postId as string;
        if (shouldFlush(action._tag)) yield* executeService(sheepdogCaller, "board.flush", {
          requestId: id("flush"), agentId: action.noticeRecipient,
        }, lists).pipe(Effect.catchTag("CommandRefused", () => Effect.void));
      }
    }
  }
  yield* recordAction({ ...action, notice, ...(postId === undefined ? {} : { postId }) } as RolesAction, rule, lists);
});

export const resendUnread = (sourceSequence: number, lists: EngineLists) => Effect.gen(function* () {
  const snapshot = yield* (yield* Views).snapshot;
  const latest = new Map<string, RolesActionRecord>();
  for (const record of (snapshot.roles as RolesView).actions) latest.set(JSON.stringify([
    record._tag, actionSubject(record), record.triggerSequence, record.occurrence,
  ]), record);
  for (const record of latest.values()) {
    const recipient = record.noticeRecipient;
    const state = own(snapshot.agents, recipient)?.state._tag;
    if (recipient === "owner" || record.noticeRead || record.notice !== "sent" || (state !== "crashed" && state !== "stopped")) continue;
    const next = noticeRecipient(snapshot, record.agentId);
    if (next === recipient) continue;
    const { sequence: _sequence, noticeRead: _read, notice: _notice, postId: _postId, ...action } = record;
    yield* sendNotice({ ...action, noticeRecipient: next, sourceSequence: sourceSequence as NoticeAction["sourceSequence"] }, "notice-reroute", lists);
  }
});

// DeliverySent is the turn's reliable origin. TurnStarted may repeat for that
// delivery, so the durable StallEnded record is keyed by this origin.
export const endStallForTurn = (envelope: EventEnvelope, sourceSequence: number, snapshot: Snapshot, lists: EngineLists) => Effect.gen(function* () {
  const event = envelope.event;
  if (event._tag !== "DeliverySent" || deliveryIsSheepdogTurn(snapshot, event.deliveryId)) return;
  const agent = own((snapshot.roles as RolesView).agents, event.agentId);
  if (agent?.openStall === undefined && !agent?.matters.some((matter) => matter.kind === "roles.stall")) return;
  yield* recordAction({ _tag: "roles.StallEnded", agentId: event.agentId, noticeRecipient: "owner", notice: "sent",
    triggerSequence: envelope.sequence, sourceSequence: sourceSequence as NoticeAction["sourceSequence"], occurrence: 1 }, "stall-ended", lists);
});
