import type { AgentId, Caller, ContextReference, Event, PieceNamespace } from "@lgtm/contracts";
import { agentText } from "./envelope.ts";
import { freshDelivery } from "./holders.ts";
export interface DeliveryRequest { readonly target: AgentId; readonly body: string; readonly sourceId: string; readonly context?: ReadonlyArray<ContextReference> }
export const pieceDelivery = (namespace: PieceNamespace, request: DeliveryRequest, caller?: Caller): Extract<Event, { _tag: "DeliveryQueued" }> => {
  const id = freshDelivery();
  const sender = { _tag: "piece", namespace } as const;
  const author = caller?._tag === "agent" ? `Author: agent ${caller.agentId}` : caller?._tag === "owner" ? "Author: owner"
    : caller?._tag === "service" ? `Author: service ${caller.service}` : `Author: piece ${namespace}`;
  return { _tag: "DeliveryQueued", delivery: { id, target: request.target, sender,
    source: { _tag: "piece", namespace, id: request.sourceId },
    content: { _tag: "prompt", text: agentText(sender, id, `${author}\n${request.body.replace(/^([\p{White_Space}\p{Cf}]*)\//u, "$1\\/")}`),
      ...(request.context === undefined ? {} : { context: request.context }) },
  } };
};
