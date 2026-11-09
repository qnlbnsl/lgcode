export type PieceNamespace = "client" | "board" | "roles" | "project"
export const pieceNamespaces = ["client", "board", "roles", "project"] as const satisfies ReadonlyArray<PieceNamespace>
