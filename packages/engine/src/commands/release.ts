import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { EventLog } from "../log/EventLog.ts";
import { Runner } from "../runner/Runner.ts";
import { Views } from "../views/Views.ts";
import { dispatchQueued } from "../routing/deliveries.ts";
import { holderAbove, mayActForHolder } from "../routing/holders.ts";
import { refused, type Input, type Payload, type Plan } from "./internal.ts";

export const release = ({ actor, snapshot, runtime }: Input, { agentId, expectedHoldSequence }: Payload<"release">): Effect.Effect<Plan, ReturnType<typeof refused>> => {
  const held = snapshot.threads[agentId]?.findLast((row) => row.event._tag === "DeliveryHeld");
  if (snapshot.agents[agentId]?.capacityHeld !== true
    || expectedHoldSequence !== undefined && held?.sequence !== expectedHoldSequence
    || actor._tag !== "service" && !mayActForHolder(snapshot, actor, holderAbove(snapshot, agentId))) {
    return Effect.fail(refused());
  }
  return Effect.succeed({
    events: [{ _tag: "DeliveryReleased", agentId, ...(expectedHoldSequence === undefined ? {} : { holdSequence: expectedHoldSequence }) }],
    afterCommit: dispatchQueued(agentId, runtime.lists === undefined ? {} : { lists: runtime.lists }).pipe(
      Effect.catchTag("RequestIdReused", () => Effect.void),
      Effect.provideService(EventLog, runtime.log), Effect.provideService(Views, runtime.views),
      Effect.provideService(Runner, runtime.runner), Effect.provideService(SqlClient.SqlClient, runtime.sql),
    ),
  });
};
