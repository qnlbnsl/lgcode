import type { Caller, ContextReference, Delivery, PieceNamespace } from "@lgcode/contracts";
import type { Snapshot } from "../commands/internal.ts";
import type { EngineLists } from "../pieces/lists.ts";
import { guardPiece } from "../pieces/guardPiece.ts";
import { taskDeliveryReach } from "../project/taskDelivery.ts";
import { boardReach } from "../board/reach.ts";
export interface ReachInput {
  readonly caller?: Caller;
  readonly target: string;
  readonly deliveryId: string;
  readonly context?: ReadonlyArray<ContextReference>;
  readonly source: Extract<NonNullable<Delivery["source"]>, { _tag: "piece" }>;
  readonly snapshot: Snapshot;
}
export const reach = { client: () => false, board: boardReach, roles: () => false, project: taskDeliveryReach } satisfies Record<PieceNamespace, (input: ReachInput) => boolean>;
export const sourceRules = { client: () => "withdraw" as const, board: () => "withdraw" as const, roles: () => "withdraw" as const, project: () => "withdraw" as const } satisfies Record<PieceNamespace, () => "withdraw" | "return">;
export const canReach = (input: ReachInput, lists: EngineLists): boolean =>
  guardPiece("reach", input.source.namespace, () => lists.reach[input.source.namespace](input), false);
