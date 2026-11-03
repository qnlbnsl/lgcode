import { randomUUID } from "node:crypto";
import {
  DeliveryId, PermissionRequestId, QuestionId,
  type Actor, type AgentId, type Event,
} from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { refused, type Input, type Payload, type Plan, type Snapshot } from "../commands/internal.ts";
import { envelope, escapeLeadingSlash } from "./envelope.ts";

type Subject = Payload<"pass-up">["subject"];

const available = (snapshot: Snapshot, id: string): boolean => {
  const state = snapshot.agents[id]?.state._tag;
  return state === "idle" || state === "working";
};

// Start above the given agent, including when a subject has already moved.
// A broken or cyclic ancestry fails closed to the owner.
export const holderAbove = (snapshot: Snapshot, id: string, leaving: ReadonlyArray<string> = []): Actor => {
  const seen = new Set([id]);
  let parent = snapshot.agents[id]?.parent;
  while (parent?._tag === "agent") {
    if (seen.has(parent.agentId)) break;
    seen.add(parent.agentId);
    const row = snapshot.agents[parent.agentId];
    if (row === undefined) break;
    if (!leaving.includes(parent.agentId) && available(snapshot, parent.agentId)) return parent;
    parent = row.parent;
  }
  return { _tag: "owner" };
};

export const mayActForHolder = (snapshot: Snapshot, actor: Actor, holder: Actor): boolean => {
  if (actor._tag === "owner") return true;
  if (holder._tag === "owner") return false;
  const effective = available(snapshot, holder.agentId) ? holder : holderAbove(snapshot, holder.agentId);
  return effective._tag === "agent" && effective.agentId === actor.agentId;
};

export const freshDelivery = (): DeliveryId => Schema.decodeUnknownSync(DeliveryId)(randomUUID());

// Rows 38 and 58: the asker's text goes inside the envelope, escaped, after
// a label the engine writes. Issue 67: the asker is the delivery's sender.
export const routedDelivery = (
  agentId: AgentId, holder: Actor, deliveryId: DeliveryId, subject: Subject, text: string,
): ReadonlyArray<Event> => holder._tag === "owner" ? [{
  _tag: "OwnerNeeded", agentId, subject, reason: "request needs the owner",
}] : [{
  _tag: "DeliveryQueued", delivery: {
    id: deliveryId, target: holder.agentId, sender: { _tag: "agent", agentId }, source: subject,
    content: { _tag: "prompt", text: envelope(deliveryId, `${subject._tag === "permission" ? "Permission request" : "Question"} ${subject.id} from agent ${agentId}:\n${escapeLeadingSlash(text)}`) },
  },
}];

export const withdrawQueued = (
  snapshot: Snapshot, deliveryId: string, reason: "request closed" | "request moved" = "request closed",
): ReadonlyArray<Event> => {
  const delivery = snapshot.deliveries[deliveryId];
  return delivery?.status === "queued" ? [{
    _tag: "DeliveryWithdrawn", agentId: delivery.target, deliveryId: delivery.id, reason,
  }] : [];
};

const rowFor = (snapshot: Snapshot, subject: Subject) =>
  subject._tag === "permission" ? snapshot.requests[subject.id] : snapshot.questions[subject.id];

const subjects = (snapshot: Snapshot): ReadonlyArray<Subject> => [
  ...Object.values(snapshot.requests).map((row): Subject => ({
    _tag: "permission", id: Schema.decodeUnknownSync(PermissionRequestId)(row.permissionRequestId),
  })),
  ...Object.values(snapshot.questions).map((row): Subject => ({
    _tag: "question", id: Schema.decodeUnknownSync(QuestionId)(row.questionId),
  })),
];

const move = (snapshot: Snapshot, subject: Subject, leaving: ReadonlyArray<string> = []): ReadonlyArray<Event> => {
  const row = rowFor(snapshot, subject);
  if (row === undefined || row.status !== "open" || row.holder._tag !== "agent") return [];
  const to = holderAbove(snapshot, row.holder.agentId, leaving);
  const deliveryId = freshDelivery();
  const moved: Event = subject._tag === "permission"
    ? { _tag: "PermissionMoved", agentId: row.agentId, permissionRequestId: subject.id, from: row.holder, to, deliveryId }
    : { _tag: "QuestionMoved", agentId: row.agentId, questionId: subject.id, from: row.holder, to, deliveryId };
  const text = "description" in row ? row.description : row.text;
  return [moved, ...withdrawQueued(snapshot, row.deliveryId, "request moved"),
    ...routedDelivery(row.agentId, to, deliveryId, subject, text)];
};

// Stop, crash, pause and recovery append these events with their own cause.
export const moveHeld = (snapshot: Snapshot, leaving: ReadonlyArray<AgentId | string> = []): ReadonlyArray<Event> =>
  subjects(snapshot).flatMap((subject) => {
    const row = rowFor(snapshot, subject)!;
    return row.holder._tag === "agent" && (leaving.includes(row.holder.agentId) || !available(snapshot, row.holder.agentId))
      ? move(snapshot, subject, leaving) : [];
  });

// Recovery step 9 (rows 52 and 66): only a subject whose holder stayed
// interrupted moves. A paused or reloaded holder keeps holding.
export const moveFromInterrupted = (snapshot: Snapshot): ReadonlyArray<Event> =>
  subjects(snapshot).flatMap((subject) => {
    const row = rowFor(snapshot, subject)!;
    return row.holder._tag === "agent" && snapshot.agents[row.holder.agentId]?.state._tag === "interrupted"
      ? move(snapshot, subject) : [];
  });

export const passUp = ({ actor, snapshot }: Input, { subject }: Payload<"pass-up">): Effect.Effect<Plan, ReturnType<typeof refused>> => {
  const row = rowFor(snapshot, subject);
  if (row === undefined || row.status !== "open" || row.holder._tag === "owner" || !mayActForHolder(snapshot, actor, row.holder)) {
    return Effect.fail(refused());
  }
  return Effect.succeed({ events: move(snapshot, subject) });
};

export const passAtTurnEnd = (snapshot: Snapshot, agentId: AgentId): ReadonlyArray<Event> =>
  subjects(snapshot).flatMap((subject) => {
    const row = rowFor(snapshot, subject)!;
    return row.holder._tag === "agent" && row.holder.agentId === agentId
      && snapshot.deliveries[row.deliveryId]?.status === "accepted" ? move(snapshot, subject) : [];
  });
