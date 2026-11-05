import type { EventEnvelope, EventSequence, PostId, AgentId } from "@shephrd/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type { RolesView } from "../../view.ts";
import type { RuleContext, SheepdogRule } from "../loop.ts";
import { noticeRecipient, sendNotice, sheepdogCaller } from "../notices.ts";
import { executeService } from "../../../commands/services.ts";
import { parseActionRequestId } from "../requests.ts";
import { stallInput, stallKey } from "../stallView.ts";
import { evaluateStall } from "./stall.ts";

// Episode two has two recipients. If the process stops between their records,
// finish the holder notice with the original identity before arming clocks.
const completeHolderNotices = ({ snapshot, lists }: RuleContext) => Effect.gen(function* () {
  const roles = snapshot.roles as RolesView;
  for (const clock of Object.values(roles.stalls)) {
    if (clock.occurrence !== 2) continue;
    const nudge = roles.actions.findLast((row) => row._tag === "roles.StallSeen" && row.stalledPostId === clock.postId
      && row.agentId === clock.agentId && row.noticeRecipient === clock.agentId && row.occurrence === 2);
    if (nudge?._tag !== "roles.StallSeen" || roles.actions.some((row) => row._tag === "roles.StallSeen"
      && row.stalledPostId === clock.postId && row.agentId === clock.agentId && row.triggerSequence === nudge.triggerSequence
      && row.occurrence === 2 && row.noticeRecipient !== clock.agentId)) continue;
    const { sequence: _sequence, noticeRead: _read, notice: _notice, postId: _postId, ...action } = nudge;
    yield* sendNotice({ ...action, noticeRecipient: noticeRecipient(snapshot, clock.agentId) }, "stall", lists);
  }
});

const completePostedNotices = (context: RuleContext) => Effect.gen(function* () {
  const roles = context.snapshot.roles as RolesView;
  // Flushing a nudge can change the stall clock before its action commits.
  // Its posted notice retains the original subject and episode identity.
  for (let sequence = roles.position + 1; sequence <= context.snapshot.sequence; sequence++) {
    const reply = yield* executeService(sheepdogCaller, "client.event", { requestId: `roles:stall-recover:${sequence}`, sequence }, context.lists);
    const row = reply.envelope as EventEnvelope;
    if (row.event._tag !== "board.PostWritten" || row.caller._tag !== "service" || row.caller.service !== "roles.sheepdog" || row.requestId === undefined) continue;
    const id = parseActionRequestId(row.requestId);
    if (id?.rule !== "stall" || id.kind !== "roles.StallSeen.post" && id.kind !== "roles.ReplaceAdvised.post") continue;
    let subject: unknown;
    try { subject = JSON.parse(id.subject); } catch { continue; }
    if (!Array.isArray(subject) || subject.length !== 2 || typeof subject[0] !== "string" || typeof subject[1] !== "string") continue;
    const tag = id.kind === "roles.StallSeen.post" ? "roles.StallSeen" : "roles.ReplaceAdvised";
    if (roles.actions.some((action) => action._tag === tag && action.agentId === subject[0] && action.stalledPostId === subject[1]
      && action.triggerSequence === id.triggerSequence && action.occurrence === id.occurrence && action.noticeRecipient === id.recipient)) continue;
    yield* sendNotice({ _tag: tag, agentId: subject[0] as AgentId, stalledPostId: subject[1] as PostId,
      noticeRecipient: id.recipient as AgentId, triggerSequence: id.triggerSequence as EventSequence,
      sourceSequence: context.sourceSequence as EventSequence, occurrence: id.occurrence }, "stall", context.lists);
  }
});

export const stallRule: SheepdogRule = {
  onStart: (context) => completePostedNotices(context).pipe(Effect.andThen(completeHolderNotices(context))),
  onEvent: (context) => completeHolderNotices(context),
  timers: ({ snapshot, lists }: RuleContext) => {
    if (lists.boardEnabled === false) return [];
    const input = stallInput(snapshot);
    const roles = snapshot.roles as RolesView;
    return Object.values(roles.stalls).flatMap((clock) => {
      const limit = input.snapshot.agents[clock.agentId]?.stallMinutes;
      return clock.originSequence === undefined || clock.occurrence >= 3 || limit === undefined ? [] : [{
        key: stallKey(clock.postId, clock.agentId), rule: "stall" as const,
        originSequence: clock.originSequence, delayMillis: limit * 60_000,
      }];
    });
  },
  onTimer: (context, timer) => Effect.gen(function* () {
    const { snapshot, lists } = context;
    const roles = snapshot.roles as RolesView;
    const clock = Object.hasOwn(roles.stalls, timer.key) ? roles.stalls[timer.key] : undefined;
    if (clock?.originSequence !== timer.originSequence) return;
    const input = stallInput(snapshot, lists.boardEnabled !== false);
    const post = input.status.posts?.find((row) => row.postId === clock.postId);
    if (post === undefined) return;
    const now = yield* Clock.currentTimeMillis;
    const actions = evaluateStall({ ...input, now, episode: {
      post, addressee: clock.agentId, elapsed: now - timer.dueAt + timer.delayMillis,
      occurrence: clock.occurrence, originSequence: timer.originSequence,
    } });
    for (const action of actions) yield* sendNotice({ ...action, sourceSequence: context.sourceSequence as typeof action.sourceSequence }, "stall", lists);
  }),
};
