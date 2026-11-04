import type { PieceNamespace } from "@shephrd/contracts";

export interface PieceView {
  readonly empty: () => unknown;
  readonly reduce: (view: unknown, event: Readonly<Record<string, unknown>>, sequence: number) => unknown;
}
const empty = (): unknown => ({});
const reduce: PieceView["reduce"] = (view) => view;
export const pieceViews: Record<PieceNamespace, PieceView> = {
  client: { empty, reduce }, board: { empty, reduce }, roles: { empty, reduce },
};
