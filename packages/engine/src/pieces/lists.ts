import { serviceControlReads, serviceControlPlanners } from "../client/serviceControl.ts"
import { workflowReads } from "../workflows/commands.ts";
import {
  CommandsRpcGroup, Event, EventEnvelope, commandAccess, commandGroups, eventGroups, eventVisibility,
  holdUnsettled, requestHeld, type HoldCondition, type Caller, type CallerKind, type PieceNamespace, type VisibilityClass,
} from "@lgtm/contracts";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import type { PlannerTable, Snapshot } from "../commands/internal.ts";
import { planners } from "../commands/planners.ts";
import { reads, type ReadHandler } from "../api/reads.ts";
import { gitPlanners, gitReads } from "../project/gitCommands.ts";
import { previewProjectPlacement } from "../project/lifecycle.ts";
import { mockPlanners, mockReads } from "../project/mocks.ts";
import { setupPlanners, setupReads } from "../project/setup.ts";
import { designPlanners, designReads } from "../project/design.ts";
import { creationPlanners, projectPlanners, projectReads } from "../project/commands.ts";
import { snapshotFor as projectSnapshotFor } from "../project/snapshot.ts";
import { boardPlanners, boardReads } from "../board/commands.ts";
import { boardReactor } from "../board/reactor.ts";
import { snapshotFor as boardSnapshotFor } from "../board/snapshot.ts";
import { openMatters as boardOpenMatters, alertSource as boardAlertSource } from "../board/openMatters.ts";
import { pieceViews, type PieceView } from "./viewTables.ts";
import { snapshotFor as rolesSnapshotFor } from "../roles/snapshot.ts";
import { openMatters as rolesOpenMatters, alertSource as rolesAlertSource } from "../roles/openMatters.ts";
import { stallWatchLoop } from "../roles/stall-watch/loop.ts";

import { clientView } from "../client/alerts/view.ts";
import { alertDelivery } from "../client/alerts/delivery.ts";
import { carrierKeep, carrierPlanners } from "../client/alerts/token.ts";
import { alertReactor, type AlertSourceResult, type PieceAlertSourceRequest } from "../client/alerts/reactor.ts";
import { alertPlanners, alertReads } from "../client/alerts/commands.ts";

import { reach, sourceRules, type ReachInput } from "../routing/reach.ts";

export interface Migration { readonly id: number; readonly statements: ReadonlyArray<string> }
export interface EngineLists {
  readonly boardEnabled?: boolean;
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
  readonly event: Schema.Codec<import("@lgtm/contracts").Event, unknown>;
  readonly envelope: Schema.Codec<EventEnvelope, unknown>;
  readonly access: Readonly<Record<string, ReadonlyArray<CallerKind>>>;
  readonly planners: PlannerTable;
  readonly reads: Readonly<Record<string, ReadHandler>>;
  readonly views: Readonly<Record<PieceNamespace, PieceView>>;
  readonly migrations: Readonly<Record<PieceNamespace, ReadonlyArray<Migration>>>;
  readonly visibility: Readonly<Record<string, VisibilityClass>>;
  readonly pieceVisibility: Readonly<Record<string, (caller: Caller, envelope: EventEnvelope, view: Snapshot) => boolean>>;
  readonly snapshotSections: Readonly<Record<PieceNamespace, (caller: Caller, view: Snapshot) => unknown>>;
  readonly alertSources?: Readonly<Partial<Record<PieceNamespace, (envelope: EventEnvelope) => AlertSourceResult>>>;
  readonly openMatters?: Readonly<Partial<Record<PieceNamespace, (views: Snapshot) => ReadonlyArray<PieceAlertSourceRequest>>>>;
  readonly reactors: Readonly<Partial<Record<PieceNamespace, Effect.Effect<void, unknown, any>>>>;
}
const absent = () => undefined;
let reactors: EngineLists["reactors"] | undefined;
let plannerTable: EngineLists["planners"] | undefined;
let readTable: EngineLists["reads"] | undefined;
export const engineLists: EngineLists = {
  commandGroups, eventGroups, commands: CommandsRpcGroup, event: Event, envelope: EventEnvelope,
  reach, sourceRules, holdUnsettled, requestHeld, secretKeep: { client: carrierKeep, board: () => [], roles: () => [], project: () => [] },
  services: {
    "roles.stallWatch": ["subscribe", "client.event", "prompt", "compact", "resume", "release", "roles.record", "board.post", "board.flush", "board.status"],
    "roles.standing-rules": [],
  }, secretCommands: ["accounts set-secret", "client.alerts.carrier.set-token"],
  access: commandAccess,
  // Build these tables on first use after the cyclic modules initialize.
  // Cache the complete maps so every consumer keeps the same registrations.
  get planners() { return plannerTable ??= { ...planners, ...serviceControlPlanners, ...alertPlanners, ...carrierPlanners, ...boardPlanners, ...projectPlanners, ...creationPlanners, ...gitPlanners, ...mockPlanners, ...setupPlanners, ...designPlanners }; },
  get reads() { return readTable ??= { ...reads, ...serviceControlReads, ...workflowReads, ...alertReads, ...boardReads, ...projectReads, ...gitReads, ...mockReads, ...setupReads, ...designReads, "project.placement.preview": previewProjectPlacement }; },
  // The tables and reactors import engine services in this same module graph.
  // Resolve their values when used, after module initialization has completed.
  get views() { return pieceViews; },
  migrations: { client: [], board: [], roles: [], project: [] }, visibility: eventVisibility, pieceVisibility: {},
  snapshotSections: { client: (caller, view) => caller._tag === "owner"
    ? { pushPromptDismissed: clientView(view.client).pushPromptDismissed } : undefined, board: boardSnapshotFor, roles: rolesSnapshotFor, project: projectSnapshotFor },
  alertSources: { client: absent, board: boardAlertSource, roles: rolesAlertSource },
  openMatters: { client: () => [], board: boardOpenMatters, roles: rolesOpenMatters },
  get reactors() { return reactors ??= {
    client: Effect.all([alertReactor, alertDelivery], { concurrency: "unbounded", discard: true }), board: boardReactor, roles: stallWatchLoop,
  }; },
} satisfies EngineLists;
