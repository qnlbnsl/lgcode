import { randomUUID } from "node:crypto";
import { eventEffect, pieceNamespaces, type Caller, type Event, type EventSequence, type PieceNamespace } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { engineLists, type EngineLists } from "../pieces/lists.ts";
import { EventLog } from "../log/EventLog.ts";
import { Restart } from "../recovery/service.ts";
import { canReach } from "../routing/reach.ts";
import { pieceDelivery, type DeliveryRequest } from "../routing/pieceDelivery.ts";
import { project, withWaitChecks } from "../routing/waits.ts";
import { Views } from "../views/Views.ts";
import { freshRequest, refused, type Snapshot } from "./internal.ts";
import type { SideRows } from "../log/EventLog.ts";

export interface PieceBatch {
  readonly events: ReadonlyArray<Event>;
  readonly deliveries?: ReadonlyArray<DeliveryRequest> | undefined;
  readonly sideRows?: SideRows | undefined;
}
export const pieceNamespace = (name: string): PieceNamespace | undefined =>
  pieceNamespaces.find((namespace) => name.startsWith(`${namespace}.`));

// Every piece writer calls these checks under the log's writer permit.
export const checkPieceBatch = (namespace: PieceNamespace, snapshot: Snapshot, batch: PieceBatch, caller: Caller | undefined, lists: EngineLists) => Effect.gen(function* () {
  if (Object.keys(batch.sideRows ?? {}).some((table) => !table.startsWith(`${namespace}_`))) return yield* refused();
  if (batch.events.some((event) => !event._tag.startsWith(`${namespace}.`) && event._tag !== "DeliveryWithdrawn")) return yield* refused();
  const events: Array<Event> = [];
  let state = snapshot;
  for (const event of batch.events) {
    if (event._tag === "DeliveryWithdrawn") {
      const delivery = state.deliveries[event.deliveryId];
      const target = delivery === undefined ? undefined : state.agents[delivery.target];
      if (target === undefined || event.agentId !== delivery?.target || eventEffect(target.state._tag, event._tag) === "invalid") return yield* refused();
      if (delivery?.status !== "queued" || delivery.source?._tag !== "piece" || delivery.source.namespace !== namespace) return yield* refused();
    }
    events.push(event);
    state = project(state, [event], lists);
  }
  for (const request of batch.deliveries ?? []) {
    const event = pieceDelivery(namespace, request, caller);
    const target = state.agents[request.target];
    if (target === undefined || eventEffect(target.state._tag, event._tag) === "invalid") return yield* refused();
    const delivery = event.delivery;
    if (delivery.source?._tag !== "piece" || !canReach({ ...(caller === undefined ? {} : { caller }), target: delivery.target, deliveryId: delivery.id, source: delivery.source, snapshot: state }, lists)) return yield* refused();
    events.push(event);
    state = project(state, [event], lists);
  }
  return withWaitChecks(snapshot, events, lists);
});

export const writePieceBatch = (input: {
  readonly namespace: PieceNamespace;
  readonly kind: "reactor";
  readonly sourceSequence: number | ((snapshot: Snapshot) => number);
  readonly build: (snapshot: Snapshot) => PieceBatch;
}, lists: EngineLists = engineLists) => Effect.gen(function* () {
  const log = yield* EventLog;
  const views = yield* Views;
  const recovery = yield* Effect.serviceOption(Restart);
  if (Option.isSome(recovery) && !(yield* recovery.value.ready)) return yield* refused("recovering");
  yield* log.transact((append) => Effect.gen(function* () {
    const snapshot = yield* views.snapshot;
    const batch = input.build(snapshot);
    // A level scan with no duty is a read. Running wait checks for it would
    // make an unrelated target's scan write engine events of its own.
    if (batch.events.length === 0 && (batch.deliveries?.length ?? 0) === 0 && Object.keys(batch.sideRows ?? {}).length === 0) return;
    const caller = { _tag: "piece", namespace: input.namespace } as const;
    // Reactors have no calling owner or agent at the reach boundary.
    const checked = yield* checkPieceBatch(input.namespace, snapshot, batch, undefined, lists).pipe(Effect.result);
    if (checked._tag === "Failure") {
      const sourceSequence = typeof input.sourceSequence === "number" ? input.sourceSequence : input.sourceSequence(snapshot);
      yield* append(caller, freshRequest(), randomUUID(), [{ _tag: "CommandRefused", command: `${input.namespace}.reactor`, reason: checked.failure.reason, sourceSequence: sourceSequence as EventSequence }], {}, false);
    } else {
      yield* append(caller, freshRequest(), randomUUID(), checked.success, batch.sideRows ?? {}, false);
    }
  }));
});
