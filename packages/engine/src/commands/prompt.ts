import { randomUUID } from "node:crypto";
import { DeliveryId, describeContext } from "@lgcode/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { agentText, envelope, senderOf } from "../routing/envelope.ts";
import { resolveContext, type ContextFiles } from "../project/context.ts";
import type { Input, Payload } from "./internal.ts";

export const prompt = (input: Input, payload: Payload<"prompt">, files?: ContextFiles) => Effect.gen(function* () {
  const { actor } = input;
  const context = yield* resolveContext(input, payload.context, [{ _tag: "agent", agentId: payload.agentId }], files);
  const id = Schema.decodeUnknownSync(DeliveryId)(randomUUID());
  return { events: [{ _tag: "DeliveryQueued" as const, delivery: {
    id, target: payload.agentId, sender: senderOf(actor), content: { _tag: "prompt" as const,
      text: agentText(senderOf(actor), id, payload.text) + (context === undefined ? "" : `\n\n${envelope(id, describeContext(context))}`),
      ...(context === undefined ? {} : { context }) },
  } }] };
});
