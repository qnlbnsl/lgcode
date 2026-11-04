import type { Event, EventEnvelope } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { Input } from "../commands/internal.ts";
import { refused } from "../commands/internal.ts";
import { subscribe } from "../log/subscribe.ts";
import { compareViews } from "../views/compare.ts";
import { visibleTo } from "./visibility.ts";

export interface ReadReply { readonly reply: Record<string, unknown>; readonly marks?: ReadonlyArray<Event> }
export type ReadHandler = (input: Input, payload: Record<string, unknown>) =>
  Effect.Effect<ReadReply, any, any> | Stream.Stream<EventEnvelope, any, any>;
export const reads: Record<"subscribe" | "debug.compare-views", ReadHandler> = {
  subscribe: (input: Input, payload: Record<string, unknown>) => subscribe(payload.after as number).pipe(
    Stream.filterEffect((envelope) => input.runtime.views.snapshot.pipe(
      Effect.map((view) => visibleTo(input.actor, envelope, view, input.runtime.lists)),
    )),
  ),
  "debug.compare-views": (input: Input, payload: Record<string, unknown>) => input.actor._tag !== "owner" ? Effect.fail(refused())
    : compareViews().pipe(Effect.map((result) => ({ reply: {
      requestId: payload.requestId, sequence: result.sequence, equal: result.differences.length === 0,
      differences: result.differences.map((difference) => difference.path.join(".")),
    } }))),
} satisfies Record<string, ReadHandler>;
