import type { EventEnvelope } from "@shephrd/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { executeService } from "../../commands/services.ts";
import type { EngineLists } from "../../pieces/lists.ts";
import { sheepdogCaller } from "./notices.ts";

export type TimerRule = "stall" | "team-idle" | "capacity" | "notice-cache" | "compact-cache";
export const missedDeadlineAction = (rule: TimerRule): "recheck" | "drop" => rule === "notice-cache" || rule === "compact-cache" ? "drop" : "recheck";
export const boardTimer = (rule: TimerRule): boolean => rule !== "capacity" && rule !== "compact-cache";
export interface TimerOrigin {
  readonly key: string;
  readonly rule: TimerRule;
  readonly originSequence: number;
  readonly delayMillis: number;
  // A model cache has a real expiry, which a service baseline cannot extend.
  readonly absoluteDueAt?: number;
}
export interface ArmedTimer extends TimerOrigin { readonly dueAt: number }
export const deadline = (occurredAt: number, delayMillis: number): number => occurredAt + delayMillis;

// This cache lasts one subscription. Only the envelope read through the
// service entry point supplies time; no reducer uses envelope metadata.
export const makeTimerReader = (lists: EngineLists) => {
  const times = new Map<number, number>();
  const remember = (envelope: EventEnvelope) => { times.set(envelope.sequence, envelope.occurredAt); };
  const time = (sequence: number) => Effect.gen(function* () {
    const cached = times.get(sequence);
    if (cached !== undefined) return cached;
    const reply = yield* executeService(sheepdogCaller, "client.event", {
      requestId: `roles:clock:${sequence}`, sequence,
    }, lists);
    const envelope = reply.envelope as EventEnvelope;
    remember(envelope);
    return envelope.occurredAt;
  });
  const arm = (origins: ReadonlyArray<TimerOrigin>, floorSequence: number, boardFloorSequence = floorSequence) => Effect.gen(function* () {
    const floor = yield* time(floorSequence);
    const boardFloor = origins.some((origin) => boardTimer(origin.rule)) ? yield* time(boardFloorSequence) : floor;
    const armed: ArmedTimer[] = [];
    for (const origin of origins) armed.push({ ...origin, dueAt: origin.absoluteDueAt ?? deadline(Math.max(
      boardTimer(origin.rule) ? boardFloor : floor, yield* time(origin.originSequence),
    ), origin.delayMillis) });
    // Do not let long-lived service subscriptions retain the whole log.
    const keep = new Set([floorSequence, boardFloorSequence, ...origins.map((origin) => origin.originSequence)]);
    for (const sequence of times.keys()) if (!keep.has(sequence)) times.delete(sequence);
    return armed;
  });
  return { remember, time, arm };
};

// Recheck wall time at least once a minute to catch host suspend and clock
// jumps, as the account timers do. A deadline crossed during a rule's work
// gets zero wait on the next loop, never an extra full tick.
export const timerWait = (timers: ReadonlyArray<ArmedTimer>) => Clock.currentTimeMillis.pipe(Effect.map((now) =>
  Math.min(60_000, ...timers.map((timer) => Math.max(0, timer.dueAt - now)))));
export const crossedTimers = (timers: ReadonlyArray<ArmedTimer>, now: number, restarting: boolean): ReadonlyArray<ArmedTimer> =>
  timers.filter((timer) => timer.dueAt <= now && (!restarting || missedDeadlineAction(timer.rule) === "recheck"));
