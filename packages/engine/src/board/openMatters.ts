import type { EventEnvelope } from "@shephrd/contracts";
import { boardAlertSources } from "@shephrd/contracts/board/alerts";
import type { Snapshot } from "../commands/internal.ts";
import type { PieceAlertSourceRequest } from "../client/alerts/reactor.ts";
import { boardView, readerKey } from "./wake.ts";
import { own } from "./access.ts";

// The piece table accepts local subject ids. Its guarded boundary turns them
// into namespaced API subjects before validating or writing an alert.
export const openMatters = (snapshot: Snapshot): ReadonlyArray<PieceAlertSourceRequest> => {
  const sources: PieceAlertSourceRequest[] = [];
  for (const post of Object.values(boardView(snapshot).posts)) {
    if (post.status !== "open" || post.reply === "none") continue;
    if (post.author._tag === "agent" && post.to.some((to) => to._tag === "owner")) sources.push({
      key: `post:${post.postId}`, kind: "board.post", agentId: post.author.agentId, subject: post.postId,
    });
    if (post.author._tag === "owner") {
      const addressee = post.to.find((to) => to._tag === "agent" && own(post.dispositions, readerKey(to)) === "no-answer");
      if (addressee?._tag === "agent") sources.push({
        key: `no-answer:${post.postId}`, kind: "board.no-answer", agentId: addressee.agentId, subject: post.postId,
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
