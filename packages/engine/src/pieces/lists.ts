import {
  CommandsRpcGroup, Event, EventEnvelope, commandAccess, commandGroups, eventGroups, eventVisibility,
  type Actor, type CallerKind, type PieceNamespace, type VisibilityClass,
} from "@shephrd/contracts";
import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import type { Input, Plan, Snapshot, CommandRefused } from "../commands/internal.ts";
import { planners } from "../commands/planners.ts";
import { reads, type ReadHandler } from "../api/reads.ts";
import type { LogWriteFailed } from "../log/EventLog.ts";
import { pieceViews, type PieceView } from "./viewTables.ts";

export interface Migration { readonly id: number; readonly statements: ReadonlyArray<string> }
export interface EngineLists {
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
  readonly pieceVisibility: Readonly<Record<string, (caller: Actor, envelope: EventEnvelope, view: Snapshot) => boolean>>;
  readonly snapshotSections: Readonly<Record<PieceNamespace, (caller: Actor, view: Snapshot) => unknown>>;
  readonly reactors: Readonly<Partial<Record<PieceNamespace, Effect.Effect<void, unknown, any>>>>;
}
const absent = () => undefined;
export const engineLists: EngineLists = {
  commandGroups, eventGroups, commands: CommandsRpcGroup, event: Event, envelope: EventEnvelope,
  access: commandAccess, planners, reads, views: pieceViews,
  migrations: { client: [], board: [], roles: [] }, visibility: eventVisibility, pieceVisibility: {},
  snapshotSections: { client: absent, board: absent, roles: absent }, reactors: {},
} satisfies EngineLists;
