import type { PieceNamespace } from "@shephrd/contracts";
import { emptyRoleFile, reduceRoleFile } from "../roles/roleFile.ts";

export interface PieceView {
  readonly empty: () => unknown;
  readonly reduce: (view: unknown, event: Readonly<Record<string, unknown>>, sequence: number) => unknown;
}
const empty = (): unknown => ({});
const reduce: PieceView["reduce"] = (view) => view;
export const pieceViews: Record<PieceNamespace, PieceView> = {
  client: { empty, reduce }, board: { empty, reduce }, roles: { empty: emptyRoleFile, reduce: reduceRoleFile },
};
