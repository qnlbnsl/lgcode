import type { ClientSnapshot } from "@lgcode/contracts";
import type { BoardOwedCompletion } from "@lgcode/contracts/board/view";
import type { BoardPost } from "@lgcode/contracts/board/schemas";
import * as Effect from "effect/Effect";

type Agent = Pick<ClientSnapshot["agents"][number], "agentId" | "state" | "account" | "reloadable" | "capacityHeld">;
interface RecoverySnapshot {
  readonly agents: ReadonlyArray<Agent>;
  readonly accounts?: ClientSnapshot["accounts"];
  readonly board?: unknown;
  readonly failedSections?: ReadonlyArray<string>;
}
interface RecoveryBoard {
  readonly disabled: boolean;
  readonly truncated: boolean;
  readonly posts: ReadonlyArray<Pick<BoardPost, "reply" | "to" | "dispositions">>;
  readonly completions: ReadonlyArray<BoardOwedCompletion>;
  readonly noAnswers: ReadonlyArray<BoardOwedCompletion>;
}

// The socket's recovery gate opens before the board's asynchronous startup
// scan and dispatcher finish. Boot-time assertions need that scan's actual
// resolutions and immediately dispatchable notices, rather than a timing gap
// between a post's close and its completion's send. Read only the owner API.
// An active turn, a capacity hold or unavailable account may intentionally
// keep a notice queued; boot must not wait for that agent to finish its work.
export const waitForBoardRecovery = <E, R>(read: Effect.Effect<RecoverySnapshot, E, R>, limit = 20_000) => Effect.gen(function* () {
  const deadline = Date.now() + limit;
  for (;;) {
    const snapshot = yield* read;
    if (snapshot.failedSections?.includes("board")) return yield* Effect.die(new Error("The board recovery snapshot is unavailable"));
    const board = snapshot.board as RecoveryBoard | undefined;
    if (board === undefined || board.disabled) return;
    if (board.truncated) return yield* Effect.die(new Error("The board recovery snapshot is truncated"));
    const agents = new Map(snapshot.agents.map((agent) => [agent.agentId as string, agent]));
    const unresolved = board.posts.some((post) => post.reply !== "none" && post.to.some((target) => {
      if (target._tag !== "agent") return false;
      const disposition = post.dispositions.find((row) => row.addressee._tag === "agent" && row.addressee.agentId === target.agentId)?.disposition;
      if (disposition !== undefined && disposition !== "no-answer") return false;
      const agent = agents.get(target.agentId);
      return agent?.state._tag === "stopped" || agent?.state._tag === "crashed"
        || (agent?.state._tag === "interrupted" && agent.reloadable !== true);
    }));
    const unsent = [...board.completions, ...board.noAnswers].some((debt) => {
      const agent = agents.get(debt.authorAgentId);
      return debt.returns < 2 && agent?.state._tag === "idle" && !agent.capacityHeld
        && !snapshot.accounts?.some((account) => account.id === agent.account && account.status === "needs-sign-in");
    });
    if (!unresolved && !unsent) return;
    if (Date.now() >= deadline) return yield* Effect.die(new Error("Timed out waiting for board recovery resolutions and notifications"));
    yield* Effect.sleep(25);
  }
});
