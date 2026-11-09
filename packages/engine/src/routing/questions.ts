import { senderOf } from "../routing/envelope.ts";
import { randomUUID } from "node:crypto";
import { QuestionId } from "@lgcode/contracts";
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
    ...Object.fromEntries(["title", "recommendation", "proposedAnswer", "taskId", "sprintId"]
      .flatMap((key) => payload[key as keyof typeof payload] === undefined ? [] : [[key, payload[key as keyof typeof payload]]])),
  }, ...routedDelivery(actor.agentId, holder, deliveryId, { _tag: "question", id: questionId }, payload.text)] });
};

export const answerQuestion = (
  { actor, snapshot }: Input, payload: Extract<Payload<"answer">, { kind: "question" }>,
): Effect.Effect<Plan, ReturnType<typeof refused>> => {
  if (actor._tag !== "owner" && actor._tag !== "agent") return Effect.fail(refused());
  const row = snapshot.questions[payload.id];
  if (row === undefined || row.status !== "open" || !mayActForHolder(snapshot, actor, row.holder)) return Effect.fail(refused());
  const deliveryId = freshDelivery();
  return Effect.succeed({ events: [{
    _tag: "QuestionAnswered", agentId: row.agentId, questionId: payload.id, answeredBy: actor, text: payload.text, deliveryId,
  }, ...withdrawQueued(snapshot, row.deliveryId), {
    _tag: "DeliveryQueued", delivery: {
      id: deliveryId, target: row.agentId, sender: senderOf(actor), source: { _tag: "question", id: payload.id },
      content: { _tag: "prompt", text: envelope(deliveryId,
        `Answer to question ${payload.id}:\n${actor._tag === "agent" ? escapeLeadingSlash(payload.text) : payload.text}`) },
    },
  }] });
};
