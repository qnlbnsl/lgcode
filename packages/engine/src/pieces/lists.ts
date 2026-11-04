import {
  CommandsRpcGroup, Event, EventEnvelope, commandAccess, commandGroups, eventGroups, eventVisibility,
  holdUnsettled, requestHeld, type HoldCondition, type AlertSourceRequest, type Caller, type CallerKind, type PieceNamespace, type VisibilityClass,
} from "@shephrd/contracts";
import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import type { Input, Plan, Snapshot, CommandRefused } from "../commands/internal.ts";
import { planners } from "../commands/planners.ts";
import { reads, type ReadHandler } from "../api/reads.ts";
import { boardPlaceholderPlanners, boardPlaceholderReads } from "../board/placeholders.ts";
import type { LogWriteFailed } from "../log/EventLog.ts";
import { pieceViews, type PieceView } from "./viewTables.ts";

import { alertReactor, type AlertSourceResult } from "../client/alerts/reactor.ts";
import { alertPlanners, alertReads } from "../client/alerts/commands.ts";

import { reach, sourceRules, type ReachInput } from "../routing/reach.ts";

export interface Migration { readonly id: number; readonly statements: ReadonlyArray<string> }
export interface EngineLists {
  readonly reach: Readonly<Record<PieceNamespace, (input: ReachInput) => boolean>>;
  readonly sourceRules: Readonly<Record<PieceNamespace, () => "withdraw" | "return">>;
  readonly holdUnsettled: Readonly<Record<PieceNamespace, HoldCondition>>;
  readonly requestHeld: Readonly<Record<PieceNamespace, HoldCondition>>;
  readonly secretKeep: Readonly<Record<PieceNamespace, (view: Snapshot) => ReadonlyArray<string>>>;
  readonly services: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly secretCommands: ReadonlyArray<string>;
  readonly commandGroups: ReadonlyArray<{ readonly namespace: string; readonly group: RpcGroup.RpcGroup<any> }>;
  readonly eventGroups: ReadonlyArray<{ readonly namespace: string; readonly events: Schema.Top }>;
  readonly commands: RpcGroup.RpcGroup<any>;
  readonly event: Schema.Codec<import("@shephrd/contracts").Event, unknown>;
  readonly envelope: Schema.Codec<EventEnvelope, unknown>;
  readonly access: Readonly<Record<string, ReadonlyArray<CallerKind>>>;
  readonly planners: Readonly<Record<string, (input: Input, payload: Record<string, unknown>) => Effect.Effect<Plan, CommandRefused | LogWriteFailed>>>;
  readonly reads: Readonly<Record<string, ReadHandler>>;
  readonly views: Readonly<Record<PieceNamespace, PieceView>>;
  readonly migrations: Readonly<Record<PieceNamespace, ReadonlyArray<Migration>>>;
  readonly visibility: Readonly<Record<string, VisibilityClass>>;
  readonly pieceVisibility: Readonly<Record<string, (caller: Caller, envelope: EventEnvelope, view: Snapshot) => boolean>>;
  readonly snapshotSections: Readonly<Record<PieceNamespace, (caller: Caller, view: Snapshot) => unknown>>;
  readonly alertSources?: Readonly<Partial<Record<PieceNamespace, (envelope: EventEnvelope) => AlertSourceResult>>>;
  readonly openMatters?: Readonly<Partial<Record<PieceNamespace, (views: Snapshot) => ReadonlyArray<AlertSourceRequest>>>>;
  readonly reactors: Readonly<Partial<Record<PieceNamespace, Effect.Effect<void, unknown, any>>>>;
}
const absent = () => undefined;
export const engineLists: EngineLists = {
  commandGroups, eventGroups, commands: CommandsRpcGroup, event: Event, envelope: EventEnvelope,
  reach, sourceRules, holdUnsettled, requestHeld, secretKeep: { client: () => [], board: () => [], roles: () => [] },
  services: {}, secretCommands: ["accounts set-secret"],
  access: commandAccess,
  planners: { ...planners, ...alertPlanners, ...boardPlaceholderPlanners },
  reads: { ...reads, ...alertReads, ...boardPlaceholderReads },
  views: pieceViews,
  migrations: { client: [], board: [], roles: [] }, visibility: eventVisibility, pieceVisibility: {},
  snapshotSections: { client: absent, board: absent, roles: absent },
  alertSources: { client: absent, board: absent, roles: absent },
  openMatters: { client: () => [], board: () => [], roles: () => [] },
  reactors: { client: alertReactor },
} satisfies EngineLists;
