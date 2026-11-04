import type { Event, EventSequence, PieceNamespace } from "@shephrd/contracts";
import type { BoardView } from "@shephrd/contracts/board/view";
import { boardAfter, emptyBoard } from "../board/view.ts";
import { emptyRoleFile, reduceRoleFile } from "../roles/roleFile.ts";

export interface PieceView {
  readonly empty: () => unknown;
  readonly reduce: (view: unknown, event: Readonly<Record<string, unknown>>, sequence: number) => unknown;
}
const empty = (): unknown => ({});
const reduce: PieceView["reduce"] = (view) => view;
export const pieceViews: Record<PieceNamespace, PieceView> = {
  client: { empty, reduce },
  board: {
    empty: emptyBoard,
    reduce: (view, event, sequence) => boardAfter(view as BoardView, {
      event: event as Event, sequence: sequence as EventSequence,
    }),
  },
  roles: { empty: emptyRoleFile, reduce: reduceRoleFile },
};
