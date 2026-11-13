import { discoverHarnessChoices } from "../client/reads/harnessChoices.ts";
import { randomUUID } from "node:crypto";
import { type AgentChoice, type AgentChoices, type AgentConfiguration, type AgentId } from "@lgtm/contracts";
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

export const choicesFor = (input: Input, agent: Agent, allowConfigured = false, model = configurationOf(agent).desired.model): Effect.Effect<AgentChoices, LogWriteFailed> => Effect.gen(function* () {
  const incarnation = yield* liveToken(input, agent.agentId);
  const live = incarnation === undefined ? undefined : yield* input.runtime.runner.choices({ agentId: agent.agentId, incarnation }).pipe(
    Effect.catchTag("RunnerRejected", () => Effect.succeed(undefined)));
  const harness = (yield* readHarnesses(input.runtime)).find((item) => item.id === agent.harness);
  const configured = yield* configuredChoices(harness?.models ?? [], harness?.efforts ?? [], input.runtime.log.redactText);
  const limitList = (reported: AgentChoices["models"], configured: AgentChoices["models"]): AgentChoices["models"] => {
    if (!configured.options.length) return reported;
    if (!reported.options.length) return configured;
    const options = reported.options.filter((option) => configured.options.some((item) => item.id === option.id));
    return { ...reported, options, ...(options.length ? {} : { reason: "The reported choices are outside this harness's configured list." }) };
  };
  const limit = (reported: AgentChoices): AgentChoices => ({
    models: limitList(reported.models, configured.models), efforts: limitList(reported.efforts, configured.efforts),
  });
  if (live !== undefined && !(agent.state._tag === "starting" && live.models.source === "unavailable")) {
    const choices = {
      models: live.models.options.length ? live.models : { ...live.models, reason: "This harness did not report model choices." },
      efforts: live.efforts.options.length ? live.efforts : { ...live.efforts, reason: "This harness did not report effort choices." },
    };
    // Live peers remain authoritative. Explicit lists can record a pending
    // desire when a live peer does not support reporting or applying it.
    return allowConfigured ? {
      models: live.models.source === "negotiated" ? live.models : configured.models,
      efforts: live.efforts.source === "negotiated" ? live.efforts : configured.efforts,
    } : choices;
  }
  // The planner runs with the engine writer permit. It may only use a report
  // already fetched by the client; it must never start discovery here.
  const base = yield* discoverHarnessChoices(input, agent.harness, agent.account, false, undefined, allowConfigured);
  const specific = model !== undefined && base.models.options.some((o) => o.id === model)
    ? yield* discoverHarnessChoices(input, agent.harness, agent.account, false, model, allowConfigured) : undefined;
  const report = specific !== undefined && (!allowConfigured || specific.models.options.length) ? specific : base;
  return limit({ models: { ...report.models, ...(report.reason ? { reason: report.reason } : {}) },
    efforts: { ...report.efforts, ...(report.effortReason ? { reason: report.effortReason } : {}) } });
});
export const configure = (input: Input, payload: Payload<"configure">): Effect.Effect<Plan, ReturnType<typeof refused> | LogWriteFailed> => Effect.gen(function* () {
  const agent = input.snapshot.agents[payload.agentId];
  if (input.actor._tag !== "owner" || agent === undefined || (payload.model === undefined && payload.effort === undefined)) return yield* refused();
  const choices = yield* choicesFor(input, agent, true, payload.model ?? configurationOf(agent).desired.model);
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
