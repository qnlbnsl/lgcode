import { PermissionLevel, type Event } from "@shepherd/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { refused, type Input, type Payload, type Plan, type Snapshot } from "../commands/internal.ts";
import { canAnswerOption } from "../identity/ceiling.ts";
import type { RunnerEvent } from "../runner/Runner.ts";
import { freshDelivery, holderAbove, mayActForHolder, routedDelivery, withdrawQueued } from "./holders.ts";
import { answerQuestion } from "./questions.ts";

export const permissionRequested = (
  snapshot: Snapshot, event: Extract<RunnerEvent, { _tag: "permissionRequested" }>,
): Effect.Effect<ReadonlyArray<Event>> => Effect.gen(function* () {
  // A repeated notification must never reopen or overwrite a subject.
  const existing = snapshot.requests[event.permissionRequestId];
  if (existing !== undefined) {
    if (existing.agentId !== event.agentId) yield* Effect.logWarning("permission request id collision");
    return [];
  }
  const permissionRequestId = event.permissionRequestId;
  const holder = event.settingsWrite ? { _tag: "owner" as const } : holderAbove(snapshot, event.agentId);
  const deliveryId = freshDelivery();
  return [{
    _tag: "PermissionRequested", agentId: event.agentId, permissionRequestId, holder, deliveryId,
    toolCallId: event.toolCallId, description: event.description, options: event.options, settingsWrite: event.settingsWrite,
  }, ...routedDelivery(event.agentId, holder, deliveryId, { _tag: "permission", id: permissionRequestId }, event.description)];
});

// Called only inside CommandHandler's writer transaction. The runner effect
// is suspended until after the answer and its receipt have committed.
export const answer = (input: Input, payload: Payload<"answer">): Effect.Effect<Plan, ReturnType<typeof refused>> => {
  if (payload.kind === "question") return answerQuestion(input, payload);
  const { actor, snapshot, runtime } = input;
  const row = snapshot.requests[payload.id];
  if (row === undefined || row.status !== "open" || !mayActForHolder(snapshot, actor, row.holder)) return Effect.fail(refused());
  const option = row.options.find((option) => option.id === payload.optionId);
  if (option === undefined) return Effect.fail(refused());
  if (actor._tag === "agent") {
    const mode = snapshot.agents[actor.agentId]?.permission;
    if (row.settingsWrite || mode === undefined || canAnswerOption({
      caller: actor, mode: Schema.decodeUnknownSync(PermissionLevel)(mode), option,
    }) !== "allow") return Effect.fail(refused());
  }
  return Effect.succeed({
    events: [{
      _tag: "PermissionAnswered", agentId: row.agentId, permissionRequestId: payload.id,
      answeredBy: actor, answer: { _tag: "selected", optionId: option.id },
    }, ...withdrawQueued(snapshot, row.deliveryId)],
    afterCommit: Effect.suspend(() => runtime.runner.answerPermission({
      agentId: row.agentId, requestId: payload.id, optionId: option.id,
    })).pipe(
      // The service installs identity/logger.ts before building its runner.
      // Never attach the runner's failure or any request content to this log.
      Effect.catchTag("RunnerRejected", () => Effect.logWarning("permission answer delivery failed")),
    ),
  });
};
