import { eventVisibility, type EventEnvelope } from "@lgcode/contracts";
import type { emptyViews } from "../../src/views/apply.ts";

// Independent specification oracle: structural children stay readable, and
// otherwise the first idle/working ancestor holds the thread. Do not import
// the production visibility or holder helpers here.
export const currentVisibilityOracle = (self: string, row: { readonly event: EventEnvelope["event"]; readonly agentId?: string }, view: ReturnType<typeof emptyViews>): boolean => {
  const subject = row.agentId ?? ("agentId" in row.event ? row.event.agentId : undefined);
  if (eventVisibility[row.event._tag] !== "agent-scoped" || subject === undefined) return false;
  if (subject === self) return true;
  const parent = view.agents[subject]?.parent;
  if (parent?._tag === "agent" && parent.agentId === self) return true;
  const seen = new Set([subject]);
  let cursor = parent;
  while (cursor?._tag === "agent" && !seen.has(cursor.agentId)) {
    seen.add(cursor.agentId);
    const ancestor = view.agents[cursor.agentId];
    if (!ancestor) return false;
    if (["idle", "working"].includes(ancestor.state._tag)) return cursor.agentId === self;
    cursor = ancestor.parent;
  }
  return false;
};
