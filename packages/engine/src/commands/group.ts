import type { Agent, Payload, Plan } from "./internal.ts";

export const group = (agent: Agent, payload: Payload<"group">): Plan => ({
  events: [{ _tag: "AgentGrouped", agentId: agent.agentId,
    groups: [...new Set([...agent.groups, ...payload.add])].filter((label) => !payload.remove.includes(label)),
  }],
});
