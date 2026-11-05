export type PieceNamespace = "client" | "board" | "roles"
export const pieceNamespaces = ["client", "board", "roles"] as const satisfies ReadonlyArray<PieceNamespace>
