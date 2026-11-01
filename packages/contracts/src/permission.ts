import * as Schema from "effect/Schema"

export const permissionLevels = ["read-only", "ask", "edit", "full"] as const
export const PermissionLevel = Schema.Literals(permissionLevels)
export type PermissionLevel = typeof PermissionLevel.Type

export const comparePermission = (a: PermissionLevel, b: PermissionLevel): number =>
  permissionLevels.indexOf(a) - permissionLevels.indexOf(b)

export const acpPermissionOptionKinds = ["allow_once", "allow_always", "reject_once", "reject_always"] as const

export function permissionForOptionKind(kind: string): { readonly level: PermissionLevel; readonly persistent: boolean } {
  switch (kind) {
    case "allow_once": return { level: "ask", persistent: false }
    case "allow_always": return { level: "edit", persistent: true }
    case "reject_once": return { level: "read-only", persistent: false }
    case "reject_always": return { level: "read-only", persistent: true }
    // The ACP protocol permits unknown strings. Fail closed to owner routing.
    default: return { level: "full", persistent: true }
  }
}
