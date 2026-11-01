import * as Effect from "effect/Effect";
import { WaitId } from "@shepherd/contracts";
import * as Schema from "effect/Schema";
import type { Agent, Input, Plan } from "./internal.ts";

export const stop = ({ runtime, snapshot }: Input, agent: Agent): Plan => ({
  events: [
    { _tag: "AgentStopped", agentId: agent.agentId },
    ...Object.values(snapshot.waits).filter((wait) => wait.agentId === agent.agentId && wait.status === "open").map((wait) => ({
      _tag: "WaitCancelled" as const, agentId: agent.agentId, waitId: Schema.decodeUnknownSync(WaitId)(wait.waitId), reason: "agent stopped",
    })),
  ],
  sideRows: { revokeAgentTokens: [agent.agentId] },
  afterCommit: Effect.suspend(() => runtime.runner.stop({ agentId: agent.agentId })).pipe(
    Effect.catchTag("RunnerRejected", () => Effect.void),
  ),
});
