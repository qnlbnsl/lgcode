import type { BoardView } from "@lgcode/contracts/board/view";
import type { ReachInput } from "../routing/reach.ts";
import { canCarryCompletion, canCarryPost, own } from "./access.ts";

export const boardReach = ({ snapshot, source, target, deliveryId }: ReachInput): boolean => {
  if (source.namespace !== "board") return false;
  const board = snapshot.board as BoardView;
  const wake = own(board.wakes, source.id);
  if (wake === undefined || wake.targetAgentId !== target
    || (wake.deliveryId !== undefined && wake.deliveryId !== deliveryId)) return false;
  const delivery = own(snapshot.deliveries, deliveryId);
  if (delivery !== undefined && (delivery.target !== target || delivery.source?._tag !== "piece"
    || delivery.source.namespace !== "board" || delivery.source.id !== source.id)) return false;

  // Reminders carry post text too. No-answer notices contain metadata only.
  if (![...wake.carried, ...wake.mustReply, ...wake.reminders].every((id) => canCarryPost(snapshot, target, id))) return false;
  if (wake.completionReplyText.some((id) => !wake.completions.includes(id))) return false;
  return wake.completions.every((id) => canCarryCompletion(snapshot, target, id, wake.completionReplyText.includes(id)));
};
