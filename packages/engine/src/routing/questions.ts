import { randomUUID } from "node:crypto";
import { QuestionId } from "@shepherd/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { refused, type Input, type Payload, type Plan } from "../commands/internal.ts";
import { envelope, escapeLeadingSlash } from "./envelope.ts";
import { freshDelivery, holderAbove, mayActForHolder, routedDelivery, withdrawQueued } from "./holders.ts";

export const ask = ({ actor, snapshot }: Input, payload: Payload<"ask">): Effect.Effect<Plan, ReturnType<typeof refused>> => {
  if (actor._tag !== "agent") return Effect.fail(refused());
  const questionId = Schema.decodeUnknownSync(QuestionId)(randomUUID());
  const holder = holderAbove(snapshot, actor.agentId);
  const deliveryId = freshDelivery();
  return Effect.succeed({ events: [{
    _tag: "QuestionAsked", agentId: actor.agentId, questionId, holder, deliveryId, text: payload.text,
  }, ...routedDelivery(actor.agentId, holder, deliveryId, { _tag: "question", id: questionId }, payload.text)] });
};

export const answerQuestion = (
  { actor, snapshot }: Input, payload: Extract<Payload<"answer">, { kind: "question" }>,
): Effect.Effect<Plan, ReturnType<typeof refused>> => {
  const row = snapshot.questions[payload.id];
  if (row === undefined || row.status !== "open" || !mayActForHolder(snapshot, actor, row.holder)) return Effect.fail(refused());
  const deliveryId = freshDelivery();
  return Effect.succeed({ events: [{
    _tag: "QuestionAnswered", agentId: row.agentId, questionId: payload.id, answeredBy: actor, text: payload.text, deliveryId,
  }, ...withdrawQueued(snapshot, row.deliveryId), {
    _tag: "DeliveryQueued", delivery: {
      id: deliveryId, target: row.agentId, sender: actor, source: { _tag: "question", id: payload.id },
      content: { _tag: "prompt", text: envelope(deliveryId,
        `Answer to question ${payload.id}:\n${actor._tag === "agent" ? escapeLeadingSlash(payload.text) : payload.text}`) },
    },
  }] });
};
