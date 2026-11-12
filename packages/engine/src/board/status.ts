import { holdsIncoming, holdsUnsettled, ownerHeld } from "@lgtm/contracts/board/conditions";
import type { BoardView } from "@lgtm/contracts/board/view";
import type { Snapshot } from "../commands/internal.ts";

// In-process services use one snapshot for both the board and engine answers.
// Unlike network pages, this answer is complete and contains no post text.
export const boardStatus = (snapshot: Snapshot, enabled = true) => {
  const board = snapshot.board as BoardView;
  const ids = Object.keys(snapshot.agents);
  return {
    sequence: snapshot.sequence, disabled: !enabled,
    ownerHeld: enabled ? ownerHeld(board) : [],
    holdsIncoming: enabled ? ids.filter((id) => holdsIncoming(id, board)) : [],
    holdsUnsettled: enabled ? ids.filter((id) => holdsUnsettled(id, board, snapshot.deliveries)) : [],
    posts: enabled ? Object.values(board.posts).filter((post) => post.status === "open" && post.reply !== "none").map((post) => ({
      postId: post.postId, author: post.author, reply: post.reply, to: post.to,
      dispositions: post.dispositions, sequence: post.sequence,
    })) : [],
  };
};
