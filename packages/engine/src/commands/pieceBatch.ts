import { openDefaultProjectChannels } from "../project/defaultChannels.ts";
import { randomUUID } from "node:crypto";
import { eventEffect, pieceNamespaces, projectTeamGroup, type Caller, type Event, type EventSequence, type PieceNamespace } from "@lgtm/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { own, projectView, projectKey } from "../project/view.ts";
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
  // A project team and its group channel are one atomic record operation.
  // This exception permits only the matching channel, never arbitrary board writes.
  const teamChannel = (event: Event): boolean => {
    if (lists.boardEnabled === false || namespace !== "project" || event._tag !== "board.ChannelOpened" || event.kind !== "group") return false;
    const team = batch.events.find((row) => row._tag === "project.TeamAdded" && row.channelId === event.channelId);
    if (team?._tag !== "project.TeamAdded") return false;
    const project = own(projectView(snapshot).projects, team.projectId);
    const expected = projectTeamGroup(team.projectId, team.teamId);
    return project !== undefined && team.group === expected && event.group === expected
      && event.anchorAgentId === project.leadAgentId && event.manager?._tag === "agent" && event.manager.agentId === project.leadAgentId
      && event.opener._tag === "agent" && event.opener.agentId === project.leadAgentId && event.members.length === 0
      && own(projectView(snapshot).teams, projectKey(team.projectId, team.teamId)) === undefined
      && !Object.hasOwn((snapshot.board as import("@lgtm/contracts").BoardView).channels, event.channelId)
      && (caller?._tag === "owner" || caller?._tag === "agent" && caller.agentId === project.leadAgentId);
  };
  // Only an owner-created, absent project can carry its complete initial set.
  // Match every field, reject duplicate ids, and leave all other board events
  // subject to the existing namespace boundary.
  const defaultChannels = new Set<Event>();
  if (lists.boardEnabled !== false && namespace === "project" && caller?._tag === "owner") {
    const created = batch.events.filter((event) => event._tag === "project.Created");
    if (created.length === 1) {
      const project = created[0]!;
      if (own(projectView(snapshot).projects, project.projectId) === undefined) {
        const expected = openDefaultProjectChannels(project);
        const sameAuthor = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
        const matches = expected.map((wanted) => batch.events.filter((event) => event._tag === "board.ChannelOpened"
          && event.channelId === wanted.channelId && event.name === wanted.name && event.kind === wanted.kind
          && event.anchorAgentId === wanted.anchorAgentId && event.group === undefined
          && sameAuthor(event.opener, wanted.opener) && sameAuthor(event.manager, wanted.manager)
          && sameAuthor(event.members, wanted.members)
          && !Object.hasOwn((snapshot.board as import("@lgtm/contracts").BoardView).channels, event.channelId)
          && batch.events.filter((row) => row._tag === "board.ChannelOpened" && row.channelId === event.channelId).length === 1));
        if (matches.every((rows) => rows.length === 1)) for (const rows of matches) defaultChannels.add(rows[0]!);
      }
    }
  }
  if (batch.events.some((event) => !event._tag.startsWith(`${namespace}.`) && event._tag !== "DeliveryWithdrawn" && !teamChannel(event) && !defaultChannels.has(event))) return yield* refused();
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
    if (delivery.source?._tag !== "piece" || request.context !== undefined && namespace !== "board"
      || !canReach({ ...(caller === undefined ? {} : { caller }), ...(request.context === undefined ? {} : { context: request.context }),
        target: delivery.target, deliveryId: delivery.id, source: delivery.source, snapshot: state }, lists)) return yield* refused();
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
