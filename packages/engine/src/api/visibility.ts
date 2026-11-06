import type { Caller, EventEnvelope } from "@sheprd/contracts";
import type { Snapshot } from "../commands/internal.ts";
import { engineLists, type EngineLists } from "../pieces/lists.ts";
import { guardPiece } from "../pieces/guardPiece.ts";
import { holderAbove } from "../routing/holders.ts";

export const mayReadAgent = (caller: Caller, agentId: string, view: Snapshot): boolean => {
  if (caller._tag === "owner" || caller._tag === "service") return true;
  if (caller._tag !== "agent") return false;
  if (caller.agentId === agentId) return true;
  const parent = view.agents[agentId]?.parent;
  if (parent?._tag === "agent" && parent.agentId === caller.agentId) return true;
  const holder = holderAbove(view, agentId);
  return holder._tag === "agent" && holder.agentId === caller.agentId;
};
export const visibleTo = (caller: Caller, envelope: EventEnvelope, view: Snapshot, lists: EngineLists = engineLists): boolean => {
  if (caller._tag === "owner" || caller._tag === "service") return true;
  switch (lists.visibility[envelope.event._tag]) {
    case "agent-scoped": return envelope.agentId !== undefined && mayReadAgent(caller, envelope.agentId, view);
    case "piece-decided": {
      const tag = envelope.event._tag;
      return guardPiece("pieceVisibility", tag.split(".")[0]!, () => lists.pieceVisibility[tag]?.(caller, envelope, view) === true, false);
    }
    default: return false;
  }
};
