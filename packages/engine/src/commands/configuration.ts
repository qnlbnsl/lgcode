import { randomUUID } from "node:crypto";
import { type AgentChoice, type AgentChoices, type AgentConfiguration, type AgentId } from "@lgcode/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { EventLog, LogWriteFailed } from "../log/EventLog.ts";
import { Runner } from "../runner/Runner.ts";
import { configurationMatches, configuredChoices } from "../runner/choices.ts";
import { Views } from "../views/Views.ts";
import { freshRequest, readHarnesses, refused, type Agent, type Input, type Payload, type Plan } from "./internal.ts";

export const configurationOf = (agent: Agent): AgentConfiguration => agent.configuration ?? {
  desired: { ...(agent.model === undefined ? {} : { model: agent.model }), ...(agent.effort === undefined ? {} : { effort: agent.effort }) }, status: "pending",
};
export const liveToken = (input: Input, agentId: string) => input.runtime.sql<{ token_hash: string }>`
  SELECT token_hash FROM agent_tokens WHERE agent_id = ${agentId} AND revoked_at IS NULL ORDER BY rowid DESC LIMIT 1`.pipe(
  Effect.map((rows) => rows[0]?.token_hash), Effect.catchTag("SqlError", () => Effect.fail(new LogWriteFailed({ reason: "database read failed" }))));

export const choicesFor = (input: Input, agent: Agent): Effect.Effect<AgentChoices, LogWriteFailed> => Effect.gen(function* () {
  const harness = (yield* readHarnesses(input.runtime)).find((item) => item.id === agent.harness);
  const configured = yield* configuredChoices(harness?.models ?? [], harness?.efforts ?? [], input.runtime.log.redactText);
  const incarnation = yield* liveToken(input, agent.agentId);
  const live = incarnation === undefined ? undefined : yield* input.runtime.runner.choices({ agentId: agent.agentId, incarnation }).pipe(
    Effect.catchTag("RunnerRejected", () => Effect.succeed(undefined)));
  return { models: live?.models.source === "negotiated" ? live.models : configured.models,
    efforts: live?.efforts.source === "negotiated" ? live.efforts : configured.efforts };
});
export const configure = (input: Input, payload: Payload<"configure">): Effect.Effect<Plan, ReturnType<typeof refused> | LogWriteFailed> => Effect.gen(function* () {
  const agent = input.snapshot.agents[payload.agentId];
  if (input.actor._tag !== "owner" || agent === undefined || (payload.model === undefined && payload.effort === undefined)) return yield* refused();
  const choices = yield* choicesFor(input, agent);
  for (const [axis, list] of [["model", choices.models], ["effort", choices.efforts]] as const) {
    const value = payload[axis];
    if (value !== undefined && (!list.options.some((choice) => choice.id === value) || (yield* input.runtime.log.redactText(value)) !== value)) {
      return yield* refused(`${axis} is not an available choice`);
    }
  }
  const desired: AgentChoice = { ...configurationOf(agent).desired,
    ...(payload.model === undefined ? {} : { model: payload.model }), ...(payload.effort === undefined ? {} : { effort: payload.effort }) };
  return { events: [{ _tag: "AgentConfigurationChosen", agentId: agent.agentId, revision: payload.requestId, desired }] };
});

// The caller holds the same lane through this operation, DeliverySent and
// the actual prompt/compact write. No writer permit is held across ACP I/O.
export const applyPendingConfiguration = (agentId: AgentId) => Effect.gen(function* () {
  const log = yield* EventLog;
  const views = yield* Views;
  const runner = yield* Runner;
  const sql = yield* SqlClient.SqlClient;
  const agent = (yield* views.snapshot).agents[agentId];
  if (agent === undefined) return false;
  const configuration = configurationOf(agent);
  if (configuration.status === "applied") return true;
  if (configuration.status !== "pending") return false;
  const tokens = yield* sql<{ token_hash: string }>`SELECT token_hash FROM agent_tokens WHERE agent_id = ${agentId} AND revoked_at IS NULL ORDER BY rowid DESC LIMIT 1`;
  const incarnation = tokens[0]?.token_hash;
  if (incarnation === undefined) return false;
  const result = yield* runner.configure({ agentId, incarnation, desired: configuration.desired }).pipe(
    Effect.catchTag("RunnerRejected", () => Effect.succeed<Pick<AgentConfiguration, "applied" | "status" | "reason">>({ status: "unavailable", reason: "not-live" })));
  return yield* log.transact((append) => Effect.gen(function* () {
    const current = (yield* views.snapshot).agents[agentId];
    const live = yield* sql<{ token_hash: string }>`SELECT token_hash FROM agent_tokens WHERE agent_id = ${agentId} AND token_hash = ${incarnation} AND revoked_at IS NULL`;
    if (current === undefined || live.length === 0 || current.configuration?.revision !== configuration.revision
      || !["idle", "working"].includes(current.state._tag)) return false;
    const revision = configuration.revision === undefined ? {} : { revision: configuration.revision };
    const applied = result.applied ?? {};
    const acknowledged = result.status === "applied" && configurationMatches(current.harness, configuration.desired, applied);
    yield* append({ _tag: "owner" }, freshRequest(), randomUUID(), [acknowledged
      ? { _tag: "AgentConfigurationApplied", agentId, ...revision, applied }
      : { _tag: "AgentConfigurationRefused", agentId, ...revision, ...(result.applied === undefined ? {} : { applied: result.applied }),
        status: result.status === "applied" || result.status === "pending" ? "refused" : result.status, reason: result.reason ?? "not-acknowledged" }], {});
    return acknowledged;
  }));
}).pipe(Effect.catchTag("SqlError", () => Effect.fail(new LogWriteFailed({ reason: "database read failed" }))));
