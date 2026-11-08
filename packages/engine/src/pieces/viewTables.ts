import type { State } from "../views/apply.ts";
import { observeStalls } from "../roles/sheepdog/stallView.ts";
import { clientPieceView } from "../client/alerts/view.ts";
import type { Event, EventSequence, PieceNamespace } from "@lgcode/contracts";
import type { BoardView } from "@lgcode/contracts/board/view";
import { boardAfter, emptyBoard } from "../board/view.ts";
import { emptyRoles, apply as applyRoles, type RolesView } from "../roles/view.ts";

export interface PieceView {
  readonly empty: () => unknown;
  // Derived views that join engine and piece data observe the completed fold.
  readonly observe?: (snapshot: State, event: Event, sequence: number) => unknown;
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
  roles: { observe: observeStalls, empty: emptyRoles, reduce: (view, event, sequence) => applyRoles(view as RolesView, event as Event, sequence) },
};
