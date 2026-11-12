import type { EventEnvelope } from "@lgtm/contracts";
import { boardAlertSources } from "@lgtm/contracts/board/alerts";
import type { Snapshot } from "../commands/internal.ts";
import type { PieceAlertSourceRequest } from "../client/alerts/reactor.ts";
import { boardView } from "./wake.ts";
import { firstOwnerNoAnswer } from "./view.ts";

// The piece table accepts local subject ids. Its guarded boundary turns them
// into namespaced API subjects before validating or writing an alert.
export const openMatters = (snapshot: Snapshot): ReadonlyArray<PieceAlertSourceRequest> => {
  const sources: PieceAlertSourceRequest[] = [];
  const board = boardView(snapshot);
  for (const post of Object.values(board.posts)) {
    if (post.status !== "open" || post.reply === "none") continue;
    if (post.author._tag === "agent" && post.to.some((to) => to._tag === "owner")) sources.push({
      key: `post:${post.postId}`, kind: "board.post", agentId: post.author.agentId, subject: post.postId,
    });
    if (post.author._tag === "owner") {
      const agentId = firstOwnerNoAnswer(board, post.postId);
      if (agentId !== undefined) sources.push({
        key: `no-answer:${post.postId}`, kind: "board.no-answer", agentId, subject: post.postId,
      });
    }
  }
  return sources;
};

// Closing a post ends both of its possible alert identities in the same batch.
export const alertSource = (envelope: EventEnvelope) => boardAlertSources.flatMap((source) => {
  const action = source(envelope);
  return action === undefined ? [] : [action];
});
