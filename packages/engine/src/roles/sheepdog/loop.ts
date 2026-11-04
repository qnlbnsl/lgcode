import type { EventEnvelope } from "@shephrd/contracts";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { executeService, subscribeService } from "../../commands/services.ts";
import type { Snapshot } from "../../commands/internal.ts";
import type { EngineLists } from "../../pieces/lists.ts";
import { Restart } from "../../recovery/service.ts";
import { Views } from "../../views/Views.ts";
import type { RolesView } from "../view.ts";
import { endStallForTurn, resendUnread, sheepdogCaller } from "./notices.ts";
import { baselineRequestId } from "./requests.ts";
import { releaseHolds, sheepdogEnabled } from "./switch.ts";
import { boardTimer, crossedTimers, makeTimerReader, type ArmedTimer, type TimerOrigin } from "./timers.ts";

export interface RuleContext {
  readonly snapshot: Snapshot;
  readonly lists: EngineLists;
  readonly sourceSequence: number;
  readonly firstStart: boolean;
  readonly baselinePosition: number;
}
// WS-4 and WS-5 supply pure timer declarations and their action handlers.
// Only this consumer calls handlers, including after a restart, so a timer
// cannot write a cursor past an event still waiting in the subscription.
export interface SheepdogRule {
  readonly onStart?: (context: RuleContext) => Effect.Effect<void, unknown, any>;
  readonly onEvent?: (context: RuleContext, envelope: EventEnvelope) => Effect.Effect<void, unknown, any>;
  readonly timers?: (context: RuleContext) => ReadonlyArray<TimerOrigin>;
  readonly onTimer?: (context: RuleContext, timer: ArmedTimer) => Effect.Effect<void, unknown, any>;
}

export const makeSheepdogLoop = (rules: ReadonlyArray<SheepdogRule>): Effect.Effect<void, unknown, any> => Effect.scoped(Effect.gen(function* () {
  const views = yield* Views;
  const recovery = yield* Effect.serviceOption(Restart);
  if (Option.isSome(recovery)) yield* recovery.value.whenReady;
  const lists = views.lists!;
  let snapshot = yield* views.snapshot;
  const firstStart = (snapshot.roles as RolesView).baseline === undefined;
  let recordedBoardOn = (snapshot.roles as RolesView).boardClock?.on ?? lists.boardEnabled !== false;
  const baseline = (position: number, on: boolean, first = false, requestId = baselineRequestId(first ? undefined : position), boardOn = recordedBoardOn) => executeService(sheepdogCaller, "roles.record", {
    requestId, action: { _tag: "roles.SheepdogBaseline", position, on, boardOn },
  }, lists).pipe(Effect.as(true), Effect.catchTag("CommandRefused", () => Effect.logError("sheepdog baseline refused").pipe(Effect.as(false))));
  if (firstStart) {
    if (!(yield* baseline(snapshot.sequence, sheepdogEnabled(snapshot), true))) return;
    snapshot = yield* views.snapshot;
  }
  const initial = snapshot.roles as RolesView;
  const startupHead = snapshot.sequence;
  let boardTransition = initial.boardClock !== undefined && initial.boardClock.on !== (lists.boardEnabled !== false);
  let on = initial.baseline!.on;
  let cursor = initial.position;
  const baselinePosition = initial.baseline!.position;
  const reader = makeTimerReader(lists);
  const context = (): Effect.Effect<RuleContext, never, Views> => views.snapshot.pipe(Effect.map((live) => ({
    snapshot: { ...live, roles: { ...live.roles as RolesView, settings: { ...(live.roles as RolesView).settings, sheepdog: on } } },
    lists, sourceSequence: cursor, firstStart, baselinePosition,
  })));
  if (!on) yield* releaseHolds(snapshot, lists);
  else {
    yield* resendUnread(cursor, lists);
    for (const rule of rules) if (rule.onStart !== undefined) yield* rule.onStart(yield* context());
  }
  type Message = { readonly _tag: "event"; readonly envelope: EventEnvelope } | { readonly _tag: "tick" };
  const queue = yield* Queue.make<Message, unknown>({ capacity: 256 });
  yield* subscribeService("roles.sheepdog", cursor, lists).pipe(
    Stream.map((envelope): Message => ({ _tag: "event", envelope })), Stream.runIntoQueue(queue), Effect.forkScoped,
  );
  let nextDeadline = Infinity;
  let timerChanged = yield* Deferred.make<void>();
  yield* Effect.forever(Effect.gen(function* () {
    const changed = timerChanged;
    const now = yield* Clock.currentTimeMillis;
    const elapsed = yield* Effect.raceFirst(
      Effect.sleep(Math.min(60_000, Math.max(0, nextDeadline - now))).pipe(Effect.as(true)),
      Deferred.await(changed).pipe(Effect.as(false)),
    );
    if (elapsed) {
      // One queued tick owns this deadline until the consumer re-arms it.
      nextDeadline = Infinity;
      yield* Queue.offer(queue, { _tag: "tick" });
    }
  })).pipe(Effect.forkScoped);
  const attempted = new Set<string>();
  const timers = (restarting: boolean) => Effect.gen(function* () {
    if (!on) { nextDeadline = Infinity; return; }
    const ctx = yield* context();
    const state = ctx.snapshot.roles as RolesView;
    const floor = state.baseline!.firstSequence;
    const owners = rules.flatMap((rule) => (rule.timers?.(ctx) ?? []).map((origin) => ({ rule, origin })));
    const origins = owners.map(({ origin }) => origin).filter((origin) => !boardTimer(origin.rule) || lists.boardEnabled !== false && !boardTransition);
    const armed = yield* reader.arm(origins, floor, Math.max(floor, state.boardClock?.sequence ?? floor));
    const now = yield* Clock.currentTimeMillis;
    const keys = new Set(armed.map((timer) => JSON.stringify([timer.key, timer.originSequence, timer.delayMillis])));
    for (const key of attempted) if (!keys.has(key)) attempted.delete(key);
    for (const timer of armed) {
      const key = JSON.stringify([timer.key, timer.originSequence, timer.delayMillis]);
      if (attempted.has(key) || timer.dueAt > now) continue;
      if (crossedTimers([timer], now, restarting).length > 0) {
        const owner = owners.find(({ origin }) => origin.key === timer.key)?.rule;
        if (owner?.onTimer !== undefined) yield* owner.onTimer(yield* context(), timer);
      }
      attempted.add(key);
    }
    nextDeadline = Math.min(Infinity, ...armed.filter((timer) => !attempted.has(JSON.stringify([
      timer.key, timer.originSequence, timer.delayMillis,
    ]))).map((timer) => timer.dueAt));
    const changed = timerChanged;
    timerChanged = yield* Deferred.make<void>();
    yield* Deferred.succeed(changed, undefined);
  });
  yield* timers(true);
  for (;;) {
    const message = yield* Queue.take(queue);
    if (message._tag === "tick") { yield* timers(false); continue; }
    const envelope = message.envelope;
    let rearming = false;
    if (on) reader.remember(envelope);
    // Use the preceding cursor until all actions for this event have finished.
    // A kill between two actions therefore replays the trigger, with receipts
    // suppressing commands already committed for its deterministic ids.
    if (envelope.event._tag === "roles.SettingsChanged") {
      const next = envelope.event.settings.sheepdog !== false;
      if (next !== on) {
        yield* baseline(envelope.sequence, next);
        on = next;
        rearming = next;
        attempted.clear();
        if (!on) yield* releaseHolds(yield* views.snapshot, lists);
      }
    } else if (on) {
      const ctx = yield* context();
      yield* endStallForTurn(envelope, cursor, ctx.snapshot, lists);
      yield* resendUnread(cursor, lists);
      for (const rule of rules) if (rule.onEvent !== undefined) yield* rule.onEvent(yield* context(), envelope);
    }
    cursor = envelope.sequence;
    // The board switch is a startup setting, so it has no stream event of its
    // own. Record it only after catch-up reaches the captured head. This
    // preserves every pending event and gives re-enabled board clocks a
    // durable origin without resetting capacity clocks or the first baseline.
    if (boardTransition && cursor >= startupHead) {
      recordedBoardOn = lists.boardEnabled !== false;
      yield* baseline(cursor, on, false, `roles:board-baseline:${cursor}:${recordedBoardOn}`, recordedBoardOn);
      boardTransition = false;
      rearming = true;
    }
    // Event-triggered work re-evaluates deadlines without waiting a full tick.
    yield* timers(rearming);
  }
}));

export const sheepdogLoop = makeSheepdogLoop([]);
