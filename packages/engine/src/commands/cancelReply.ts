import * as Effect from "effect/Effect";
import { currentSend } from "../routing/deliveries.ts";
import { holderAbove } from "../routing/holders.ts";
import { refused, type Input, type Payload, type Plan } from "./internal.ts";

export const cancelReply = ({ actor, snapshot, runtime }: Input, payload: Payload<"cancel-reply">): Effect.Effect<Plan, ReturnType<typeof refused>> => {
  const holder = holderAbove(snapshot, payload.agentId);
  if (actor._tag !== "owner" && !(actor._tag === "agent" && holder._tag === "agent" && holder.agentId === actor.agentId)) return Effect.fail(refused());
  const sent = currentSend(snapshot, payload.agentId);
  if (sent === undefined) return Effect.fail(refused("no active reply"));
  return Effect.succeed({
    events: [],
    // CommandHandler holds the send lane through this call. The runner also
    // checks the reservation, so a reply that ended meanwhile cannot cancel
    // another turn. Only the runner's terminal event confirms a stopped reply.
    afterCommit: Effect.suspend(() => runtime.runner.cancel({ agentId: payload.agentId,
      deliveryId: sent.event.deliveryId, sentSequence: sent.sequence })).pipe(
      Effect.catchTag("RunnerRejected", () => Effect.fail(refused("reply is no longer active or cancellation failed"))),
    ),
  });
};
