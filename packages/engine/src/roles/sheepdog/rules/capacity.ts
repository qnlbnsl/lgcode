import type { Event, EventEnvelope } from "@shephrd/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { clientView } from "../../../client/alerts/view.ts";
import { capacityHoldCount } from "../../../routing/deliveries.ts";
import type { RolesView } from "../../view.ts";
import { callForAction } from "../actions.ts";
import type { RuleContext, SheepdogRule } from "../loop.ts";
import { noticeRecipient, sendNotice, type NoticeAction } from "../notices.ts";
import { resolveSettings, roleSettings } from "../settings.ts";
import type { TimerOrigin } from "../timers.ts";

type CapacityEvent = { readonly _tag: "DeliveryHeld" | "DeliveryReturned"; readonly agentId: string;
  readonly deliveryId: string; readonly cause?: string } | { readonly _tag: "TurnEnded"; readonly agentId: string };
type CapacityDecision = { readonly _tag: "none" }
  | { readonly _tag: "release"; readonly agentId: string; readonly deliveryId: string }
  | { readonly _tag: "gave-up"; readonly agentId: string; readonly cause: "capacity" }
  | { readonly _tag: "reset-outage"; readonly agentId: string };

// The count is supplied by the engine's outage fold, including manual releases.
export const capacityDecision = (input: {
  readonly event: CapacityEvent; readonly now: number; readonly heldAt: number;
  readonly releasedCount: number; readonly capacityRetryLimit: number;
  readonly gaveUpForOutage?: boolean; readonly backoffMillis?: number;
}): CapacityDecision => {
  const { event } = input;
  if (event._tag === "TurnEnded" || event._tag === "DeliveryReturned" && event.cause !== "capacity")
    return { _tag: "reset-outage", agentId: event.agentId };
  if (event._tag === "DeliveryReturned") return input.gaveUpForOutage ? { _tag: "none" }
    : { _tag: "gave-up", agentId: event.agentId, cause: "capacity" };
  return input.releasedCount < input.capacityRetryLimit && input.now - input.heldAt >= (input.backoffMillis ?? 300_000)
    ? { _tag: "release", agentId: event.agentId, deliveryId: event.deliveryId } : { _tag: "none" };
};

const limitsFor = (ctx: RuleContext, agentId: string) => {
  const roles = ctx.snapshot.roles as RolesView;
  return resolveSettings(roles.settings, roleSettings(roles.file, ctx.snapshot.agents[agentId]!.role));
};
const openHolds = (ctx: RuleContext): ReadonlyArray<EventEnvelope & { readonly event: Extract<Event, { _tag: "DeliveryHeld" }> }> =>
  Object.values(ctx.snapshot.agents).filter((agent) => agent.capacityHeld).flatMap((agent) => {
    const held = ctx.snapshot.threads[agent.agentId]?.findLast((row) => row.event._tag === "DeliveryHeld");
    return held?.event._tag === "DeliveryHeld" ? [{ ...held, event: held.event }] : [];
  });
const keyFor = (agentId: string) => JSON.stringify(["capacity", agentId]);

export const capacityRule: SheepdogRule = {
  timers: (ctx): ReadonlyArray<TimerOrigin> => openHolds(ctx).map((held) => ({
    key: keyFor(held.event.agentId), rule: "capacity", originSequence: held.sequence,
    delayMillis: limitsFor(ctx, held.event.agentId).capacityBackoffMinutes * 60_000,
  })),
  onTimer: (ctx, timer) => Effect.gen(function* () {
    const held = openHolds(ctx).find((row) => keyFor(row.event.agentId) === timer.key && row.sequence === timer.originSequence);
    if (held === undefined) return;
    const limits = limitsFor(ctx, held.event.agentId);
    // DeliveryHeld already increments the engine count. The current hold is
    // the attempt being released, rather than an additional completed retry.
    const count = capacityHoldCount(ctx.snapshot, held.event.agentId);
    const decision = capacityDecision({ event: held.event, now: yield* Clock.currentTimeMillis,
      heldAt: timer.dueAt - timer.delayMillis, releasedCount: count - 1,
      // A lower setting refuses future holds; it must not strand a hold the
      // engine already admitted under the previous setting.
      capacityRetryLimit: Math.max(limits.capacityRetries, count), backoffMillis: timer.delayMillis });
    if (decision._tag !== "release") return;
    const action = { _tag: "roles.CapacityRetried", agentId: held.event.agentId, triggerSequence: held.sequence,
      noticeRecipient: noticeRecipient(ctx.snapshot, held.event.agentId), occurrence: count } as const;
    yield* callForAction(action, "capacity", "release", { expectedHoldSequence: held.sequence }, ctx.lists).pipe(
      Effect.catchTag("CommandRefused", () => Effect.void));
  }),
  onEvent: (ctx, envelope) => Effect.gen(function* () {
    const event = envelope.event;
    // The release's event survives a kill before roles.record. Replaying this
    // envelope completes the action with the same notice and record receipts.
    if (event._tag === "DeliveryReleased" && event.holdSequence !== undefined
      && envelope.caller._tag === "service" && envelope.caller.service === "roles.sheepdog") {
      const thread = (ctx.snapshot.threads[event.agentId] ?? []).filter((row) => row.sequence < envelope.sequence);
      const held = thread.find((row) => row.sequence === event.holdSequence);
      if (held?.event._tag !== "DeliveryHeld") return;
      const occurrence = capacityHoldCount({ ...ctx.snapshot, threads: { ...ctx.snapshot.threads, [event.agentId]: thread } }, event.agentId);
      yield* sendNotice({ _tag: "roles.CapacityRetried", agentId: event.agentId, triggerSequence: held.sequence,
        sourceSequence: ctx.sourceSequence as NoticeAction["sourceSequence"], occurrence,
        noticeRecipient: noticeRecipient(ctx.snapshot, event.agentId) }, "capacity", ctx.lists);
      return;
    }
    if (event._tag !== "DeliveryReturned" || event.cause !== "capacity" || envelope.sequence <= ctx.baselinePosition) return;
    const roles = ctx.snapshot.roles as RolesView;
    const decision = capacityDecision({ event, now: 0, heldAt: 0, releasedCount: 0, capacityRetryLimit: 0,
      gaveUpForOutage: roles.actions.some((action) => action._tag === "roles.GaveUp" && action.cause === "capacity"
        && action.agentId === event.agentId && action.triggerSequence === envelope.sequence) });
    if (decision._tag !== "gave-up") return;
    yield* sendNotice({ _tag: "roles.GaveUp", agentId: event.agentId, cause: "capacity",
      noticeRecipient: noticeRecipient(ctx.snapshot, event.agentId), triggerSequence: envelope.sequence,
      sourceSequence: ctx.sourceSequence as NoticeAction["sourceSequence"], occurrence: 1,
      engineAlertOpen: Object.values(clientView(ctx.snapshot.client).alerts).some((alert) =>
        alert.kind === "failure" && alert.agentId === event.agentId && alert.status === "open"),
    }, "capacity", ctx.lists);
  }),
};
