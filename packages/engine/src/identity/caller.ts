import type { Caller } from "@lgcode/contracts";

// The caller as stored in `events.caller` and `receipts.caller`. It is built
// field by field so the text does not depend on property order or on extra
// runtime properties.
export const callerKey = (actor: Caller): string => {
  switch (actor._tag) {
    case "owner": return "owner";
    case "agent": return `agent:${actor.agentId}`;
    case "service": return `service:${actor.service}`;
    case "piece": return `piece:${actor.namespace}`;
  }
};
