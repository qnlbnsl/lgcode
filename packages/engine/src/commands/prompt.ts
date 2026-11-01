import { randomUUID } from "node:crypto";
import { DeliveryId } from "@shepherd/contracts";
import * as Schema from "effect/Schema";
import type { Input, Payload, Plan } from "./internal.ts";

export const prompt = ({ actor }: Input, payload: Payload<"prompt">): Plan => ({
  events: [{ _tag: "DeliveryQueued", delivery: {
    id: Schema.decodeUnknownSync(DeliveryId)(randomUUID()), target: payload.agentId, sender: actor,
    content: { _tag: "prompt", text: payload.text },
  } }],
});
