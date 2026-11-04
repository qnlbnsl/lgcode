import * as Effect from "effect/Effect";
import { WaitId, PermissionRequestId, type Event } from "@shephrd/contracts";
import * as Schema from "effect/Schema";
import { targetGone } from "../routing/deliveries.ts";
import { moveHeld, withdrawQueued } from "../routing/holders.ts";
import { project } from "../routing/waits.ts";
import type { Agent, Input, Plan } from "./internal.ts";

export const stop = ({ runtime, snapshot }: Input, agent: Agent): Plan => {
  const cancelled: ReadonlyArray<Event> = Object.values(snapshot.requests).filter((row) => row.agentId === agent.agentId && row.status === "open").flatMap((row): ReadonlyArray<Event> => [
    { _tag: "PermissionCancelled", agentId: row.agentId, permissionRequestId: Schema.decodeUnknownSync(PermissionRequestId)(row.permissionRequestId), reason: "agent stopped" },
    ...withdrawQueued(snapshot, row.deliveryId),
  ]);
  const stopped: ReadonlyArray<Event> = [
    ...cancelled,
    { _tag: "AgentStopped", agentId: agent.agentId },
    ...moveHeld(project(snapshot, cancelled, runtime.lists), [agent.agentId]),
    ...Object.values(snapshot.waits).filter((wait) => wait.agentId === agent.agentId && wait.status === "open").map((wait) => ({
      _tag: "WaitCancelled" as const, agentId: agent.agentId, waitId: Schema.decodeUnknownSync(WaitId)(wait.waitId), reason: "agent stopped",
    })),
  ];
  return {
    events: [...stopped, ...targetGone(project(snapshot, stopped), agent.agentId, "stopped", runtime.lists)],
    sideRows: { revokeAgentTokens: [agent.agentId] },
    afterCommit: Effect.suspend(() => runtime.runner.stop({ agentId: agent.agentId })).pipe(
      Effect.catchTag("RunnerRejected", () => Effect.void),
    ),
  };
};
