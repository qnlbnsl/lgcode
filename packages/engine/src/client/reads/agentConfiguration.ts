import * as Effect from "effect/Effect";
import type { ReadHandler } from "../../api/reads.ts";
import { choicesFor, configurationOf, liveToken } from "../../commands/configuration.ts";
import { refused } from "../../commands/internal.ts";

export const agentConfiguration: ReadHandler = (input, payload) => Effect.gen(function* () {
  const agent = input.snapshot.agents[payload.agentId as string];
  if (input.actor._tag !== "owner" || agent === undefined) return yield* refused();
  const choices = yield* choicesFor(input, agent);
  return { reply: { requestId: payload.requestId, agentId: agent.agentId, configuration: configurationOf(agent), ...choices } };
});
export const agentContext: ReadHandler = (input, payload) => Effect.gen(function* () {
  const agent = input.snapshot.agents[payload.agentId as string];
  if (input.actor._tag !== "owner" || agent === undefined) return yield* refused();
  const incarnation = yield* liveToken(input, agent.agentId);
  const unavailable = { _tag: "unavailable" as const, reason: "not-live" as const };
  const context = incarnation === undefined ? unavailable : yield* input.runtime.runner.context({ agentId: agent.agentId, incarnation }).pipe(
    Effect.catchTag("RunnerRejected", () => Effect.succeed(unavailable)));
  return { reply: { requestId: payload.requestId, agentId: agent.agentId, context } };
});
