import { clientPieceView } from "../client/alerts/view.ts";
import type { Event, EventSequence, PieceNamespace } from "@shephrd/contracts";
import type { BoardView } from "@shephrd/contracts/board/view";
import { boardAfter, emptyBoard } from "../board/view.ts";
import { emptyRoles, apply as applyRoles, type RolesView } from "../roles/view.ts";

export interface PieceView {
  readonly empty: () => unknown;
  readonly reduce: (view: unknown, event: Readonly<Record<string, unknown>>, sequence: number) => unknown;
}
export const pieceViews: Record<PieceNamespace, PieceView> = {
  client: clientPieceView,
  board: {
    empty: emptyBoard,
    reduce: (view, event, sequence) => boardAfter(view as BoardView, {
      event: event as Event, sequence: sequence as EventSequence,
    }),
  },
  roles: { empty: emptyRoles, reduce: (view, event, sequence) => applyRoles(view as RolesView, event as Event, sequence) },
};
