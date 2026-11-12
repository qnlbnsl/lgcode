import { senderOf } from "../routing/envelope.ts";
import { randomUUID } from "node:crypto";
import { DeliveryId } from "@lgtm/contracts";
import * as Schema from "effect/Schema";
import type { Input, Payload, Plan } from "./internal.ts";

export const compact = ({ actor }: Input, payload: Payload<"compact">): Plan => ({
  events: [{ _tag: "DeliveryQueued", delivery: {
    id: Schema.decodeUnknownSync(DeliveryId)(randomUUID()), target: payload.agentId, sender: senderOf(actor),
    content: { _tag: "compact" },
  } }],
});
