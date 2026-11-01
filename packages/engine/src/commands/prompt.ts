import { randomUUID } from "node:crypto";
import { DeliveryId } from "@shepherd/contracts";
import * as Schema from "effect/Schema";
import { agentText } from "../routing/envelope.ts";
import type { Input, Payload, Plan } from "./internal.ts";

export const prompt = ({ actor }: Input, payload: Payload<"prompt">): Plan => {
  const id = Schema.decodeUnknownSync(DeliveryId)(randomUUID());
  return { events: [{ _tag: "DeliveryQueued", delivery: {
    id, target: payload.agentId, sender: actor, content: { _tag: "prompt", text: agentText(actor, id, payload.text) },
  } }] };
};
