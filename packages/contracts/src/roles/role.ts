export const roleKinds = ["orchestrator", "lead", "worker"] as const
export type RoleKind = typeof roleKinds[number]
export interface ParsedRole {
  readonly kind: RoleKind
  readonly name?: string
  readonly flags: ReadonlyArray<"unknown-kind">
}

export const parseRole = (text: string): ParsedRole => {
  const separator = text.indexOf(":")
  const kind = separator < 0 ? text : text.slice(0, separator)
  const name = separator < 0 ? undefined : text.slice(separator + 1)
  const known = roleKinds.find((candidate) => candidate === kind)
  return {
    kind: known ?? "worker",
    ...(name === undefined || name.length === 0 ? {} : { name }),
    flags: known === undefined ? ["unknown-kind"] : [],
  }
}

// Team-specific names and instructions come from the owner's role file.
export const roleAdvice = {
  orchestrator: "Coordinate the team through its leads. Give work to leads and answer their questions.",
  lead: "Start your own workers, wait on their work, and answer their questions. Run board.acknowledge when starting to respond to a post.",
  worker: "Report your work and questions to your lead. Do not start agents. Do not ask the owner. Run board.acknowledge when starting to respond to a post.",
} satisfies Record<RoleKind, string>
