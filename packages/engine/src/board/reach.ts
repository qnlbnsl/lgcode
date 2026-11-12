import type { BoardView } from "@lgtm/contracts/board/view";
import type { ReachInput } from "../routing/reach.ts";
import { canCarryCompletion, canCarryPost, own } from "./access.ts";
import { canReadContext } from "../project/context.ts";

export const boardReach = ({ snapshot, source, target, deliveryId, context }: ReachInput): boolean => {
  if (source.namespace !== "board") return false;
  const board = snapshot.board as BoardView;
  const wake = own(board.wakes, source.id);
  if (wake === undefined || wake.targetAgentId !== target
    || (wake.deliveryId !== undefined && wake.deliveryId !== deliveryId)) return false;
  // A reactor has no sender credential. It may repeat only this wake's
  // admitted manifest, never resolve new references on a caller's behalf.
  if (JSON.stringify(context ?? []) !== JSON.stringify(wake.context ?? [])
    || !canReadContext(snapshot, { _tag: "agent", agentId: wake.targetAgentId }, context)) return false;
  const delivery = own(snapshot.deliveries, deliveryId);
  if (delivery !== undefined && (delivery.target !== target || delivery.source?._tag !== "piece"
    || delivery.source.namespace !== "board" || delivery.source.id !== source.id)) return false;

  // Reminders carry post text too. No-answer notices contain metadata only.
  if (![...wake.carried, ...wake.mustReply, ...wake.reminders].every((id) => canCarryPost(snapshot, target, id))) return false;
  if (wake.completionReplyText.some((id) => !wake.completions.includes(id))) return false;
  return wake.completions.every((id) => canCarryCompletion(snapshot, target, id, wake.completionReplyText.includes(id)));
};
