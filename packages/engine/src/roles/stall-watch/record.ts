import type { Payload, PiecePlan, Input } from "../../commands/internal.ts";
import { refused } from "../../commands/internal.ts";
import * as Effect from "effect/Effect";

// The RPC schema is the closed union of action kinds, pending stall notices and the baseline. The
// handler validates it again in-process and sends this batch through E23.
export const record = (input: Input, payload: Payload<"roles.record">): Effect.Effect<PiecePlan, ReturnType<typeof refused>> => {
  if (input.actor._tag !== "service" || input.actor.service !== "roles.stallWatch") return Effect.fail(refused());
  const position = payload.action._tag === "roles.StallWatchBaseline" ? payload.action.position : payload.action.sourceSequence;
  if (position > input.snapshot.sequence) return Effect.fail(refused());
  return Effect.succeed({
    events: [payload.action],
    reply: (batch) => ({ requestId: payload.requestId, sequence: batch[0]!.sequence }),
  });
};
