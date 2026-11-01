import * as Effect from "effect/Effect";
import { WaitId, type Event } from "@shepherd/contracts";
import * as Schema from "effect/Schema";
import { targetGone } from "../routing/deliveries.ts";
import { moveHeld } from "../routing/holders.ts";
import { project } from "../routing/waits.ts";
import type { Agent, Input, Plan } from "./internal.ts";

export const stop = ({ runtime, snapshot }: Input, agent: Agent): Plan => {
  const stopped: ReadonlyArray<Event> = [
    { _tag: "AgentStopped", agentId: agent.agentId },
    ...moveHeld(snapshot, [agent.agentId]),
    ...Object.values(snapshot.waits).filter((wait) => wait.agentId === agent.agentId && wait.status === "open").map((wait) => ({
      _tag: "WaitCancelled" as const, agentId: agent.agentId, waitId: Schema.decodeUnknownSync(WaitId)(wait.waitId), reason: "agent stopped",
    })),
  ];
  return {
    events: [...stopped, ...targetGone(project(snapshot, stopped), agent.agentId, "stopped")],
    sideRows: { revokeAgentTokens: [agent.agentId] },
    afterCommit: Effect.suspend(() => runtime.runner.stop({ agentId: agent.agentId })).pipe(
      Effect.catchTag("RunnerRejected", () => Effect.void),
    ),
  };
};
