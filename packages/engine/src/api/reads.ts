import type { Event, EventEnvelope } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { Input } from "../commands/internal.ts";
import { refused } from "../commands/internal.ts";
import { subscribe } from "../log/subscribe.ts";
import { compareViews } from "../views/compare.ts";
import { visibleTo } from "./visibility.ts";
import { getRoleFile } from "../roles/roleFile.ts";

export interface ReadReply { readonly reply: Record<string, unknown>; readonly marks?: ReadonlyArray<Event>; readonly deliveries?: ReadonlyArray<import("../routing/pieceDelivery.ts").DeliveryRequest>; readonly sideRows?: import("../log/EventLog.ts").SideRows }
export type ReadHandler = (input: Input, payload: Record<string, unknown>) =>
  Effect.Effect<ReadReply, any, any> | Stream.Stream<EventEnvelope, any, any>;
export const reads: Record<string, ReadHandler> = {
  "roles.role-file.get": getRoleFile,
  "roles.orient": () => Effect.fail(refused()),
  "roles.handoff": () => Effect.fail(refused()),
  "roles.settings.get": () => Effect.fail(refused()),
  "roles.actions.list": () => Effect.fail(refused()),
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
