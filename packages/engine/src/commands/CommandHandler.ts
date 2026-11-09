import { acceptCache, type CacheTarget } from "./cache.ts";
import { randomUUID } from "node:crypto";
import {
  EventEnvelope, commandOutcome, publicAddressError,
  type Caller, type Event, type HarnessSettings, type RequestId,
} from "@lgcode/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as RpcSchema from "effect/rpc/RpcSchema";
import * as SqlClient from "effect/sql/SqlClient";

import { followAvailability } from "../accounts/available.ts";
import { sha256Hex } from "../identity/credential.ts";
import { verifyAgentToken } from "../identity/tokens.ts";
import { EventLog, InvalidEvent, LogWriteFailed, callerKey, type SideRows } from "../log/EventLog.ts";
import { crashEvents } from "../recovery/crash.ts";
import { Restart } from "../recovery/service.ts";
import { Runner, RunnerEvent } from "../runner/Runner.ts";
import { dispatchCommitted, deliveryUpdate, promptReply, turnEnded } from "../routing/deliveries.ts";
import { settingsRefusal } from "../roles/sheepdog/settings.ts";
import { holderAbove } from "../routing/holders.ts";
import { preempt, withLane } from "../routing/lanes.ts";
import { permissionRequested } from "../routing/permissions.ts";
import { waitReply, withWaitChecks } from "../routing/waits.ts";
import { Views } from "../views/Views.ts";
import { apply } from "../views/apply.ts";
import { engineLists, type EngineLists } from "../pieces/lists.ts";
import { checkPieceBatch, pieceNamespace } from "./pieceBatch.ts";
import { SecretStore } from "./SecretStore.ts";
import { loadFirstDefaults } from "./harnesses.ts";
import { webSettingsCommitted } from "../client/settings.ts";
import { prepareProjectLifecycle, projectLifecycleCommand } from "../project/lifecycle.ts";
import { CommandRefused, freshRequest, readHarnesses, refused, type Input, type Runtime, type Snapshot } from "./internal.ts";

export { CommandRefused } from "./internal.ts";

type Credential =
  | { readonly _tag: "owner" }
  | Extract<Caller, { _tag: "service" }>
  | { readonly _tag: "agent"; readonly token: Redacted.Redacted<string> };

export class CommandHandler extends Context.Service<CommandHandler, {
  readonly cache: (target: CacheTarget) => Effect.Effect<"flush" | "compact" | undefined, CommandRefused | LogWriteFailed>;
  readonly input: (actor: Caller) => Effect.Effect<Input>;
  readonly execute: (credential: Credential, name: string, payload: unknown) => Effect.Effect<Record<string, unknown>, CommandRefused | LogWriteFailed>;
}>()("lgcode/engine/commands/CommandHandler") {}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const replyFor = (snapshot: Snapshot, name: string, requestId: RequestId, envelopes: ReadonlyArray<EventEnvelope>, settings: ReadonlyArray<HarnessSettings>) => {
  const events = envelopes.map((envelope) => envelope.event);
  const failure = events.find((event) => event._tag === "CommandRefused");
  if (failure !== undefined) return { failure: refused(failure.reason) };
  const reply: Record<string, unknown> = { requestId };
  const started = events.find((event) => event._tag === "AgentStarted");
  if (started !== undefined) reply.agentId = started.agentId;
  const asked = events.find((event) => event._tag === "QuestionAsked");
  if (asked !== undefined) reply.questionId = asked.questionId;
  const queued = events.find((event) => event._tag === "DeliveryQueued");
  if (queued !== undefined && name !== "wait") reply.deliveryId = queued.delivery.id;
  if (name === "wait") Object.assign(reply, waitReply(events));
  if (name === "accounts") reply.accounts = Object.values(envelopes.reduce((state, envelope) => apply(state, envelope), snapshot).accounts);
  if (name === "harnesses") {
    const harnesses = new Map(settings.map((harness) => [harness.id, harness]));
    for (const event of events) if (event._tag === "HarnessChanged") harnesses.set(event.harness.id, event.harness);
    reply.harnesses = [...harnesses.values()];
  }
  return { reply };
};

export const layer = (configuration: Pick<Runtime, "home" | "stateFolder" | "pluginRoot" | "harnessDefaults"> & { readonly capacityHoldCondition?: import("../routing/deliveries.ts").CapacityHoldCondition }, lists: EngineLists = engineLists) =>
  Layer.effect(CommandHandler, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const log = yield* EventLog;
    const views = yield* Views;
    const runner = yield* Runner;
    const secrets = yield* SecretStore;
    const engineScope = yield* Effect.scope;
    // Project creation and archive own real side effects beyond an HTTP/RPC
    // request's lifetime. Register their complete, serialized operation in the
    // engine scope before allowing caller cancellation. Their normal bounded
    // runner setup and stop pre-emption remain interruptible. Engine shutdown
    // still closes them, and durable intents/receipts cover the next boot.
    const engineOwned = <A, E, R>(operation: Effect.Effect<A, E, R>) => Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
      const fiber = yield* Effect.forkIn(operation, engineScope);
      return yield* restore(Fiber.join(fiber));
    }));
    const runtime: Runtime = { ...configuration, lists, sql, log, runner, secrets, views };
    // Fix round 1, N-1: the first start loads the harness defaults.
    yield* loadFirstDefaults(runtime);
    // Issue 88 and row 52: while restart recovery is present and has not
    // finished step 9, no command runs.
    const recovery = yield* Effect.serviceOption(Restart);

    const handleRunnerEvent = (rawEvent: unknown) => Effect.gen(function* () {
      // A bad adapter event cannot reach the views or the writer, and its
      // validation error must not expose any of the input it describes.
      const decoded = yield* Schema.decodeUnknownEffect(RunnerEvent)(rawEvent).pipe(Effect.result);
      if (decoded._tag === "Failure") return yield* Effect.logWarning("runner event dropped: malformed");
      const event = decoded.success;
      const consume = Effect.gen(function* () {
        let resetMode = false;
        yield* log.transact((append) => Effect.gen(function* () {
          const snapshot = yield* views.snapshot;
          const agent = snapshot.agents[event.agentId];
          if (agent === undefined || !["starting", "working", "idle", "paused"].includes(agent.state._tag)) return;
          const tokens = yield* sql<{ agent_id: string }>`
            SELECT agent_id FROM agent_tokens WHERE token_hash = ${event.incarnation}
            AND agent_id = ${event.agentId} AND revoked_at IS NULL`;
          if (tokens.length === 0) return;
          // Every batch carries the wait checks it causes (rows 25 and 50).
          const write = (events: ReadonlyArray<Event>, sideRows: SideRows = {}) => events.length === 0 ? Effect.void
            : append({ _tag: "owner" }, freshRequest(), randomUUID(), withWaitChecks(snapshot, events, lists), sideRows).pipe(Effect.asVoid);
          switch (event._tag) {
            case "configurationReported": return yield* write([{ _tag: "AgentConfigurationObserved", agentId: event.agentId, applied: event.applied }]);
            case "permissionRequested": return yield* write(yield* permissionRequested(snapshot, event));
            case "turnEnded": return yield* write(turnEnded(snapshot, event));
            case "deliveryUpdate": return yield* write(deliveryUpdate(snapshot, event));
            case "modeReported": {
              resetMode = event.level === undefined;
              return yield* write([event.level === undefined
                ? { _tag: "ModeRefused", agentId: event.agentId, mode: event.mode, ceiling: event.ceiling, reason: "mode exceeds permission ceiling" }
                : { _tag: "ModeChanged", agentId: event.agentId, mode: event.mode, level: event.level }]);
            }
            case "promptReply": return yield* write(yield* promptReply(snapshot, event, log.redactText, configuration.capacityHoldCondition));
            case "exited": {
              return yield* write(crashEvents(snapshot, event, lists),
                { revokeAgentTokens: [event.agentId] });
            }
          }
        }));
        if (event._tag === "modeReported" && resetMode) {
          yield* runner.setMode({ agentId: event.agentId, permission: event.ceiling }).pipe(
            Effect.catchTag("RunnerRejected", () => Effect.logWarning("mode set-back failed")),
          );
        }
      });
      yield* event._tag === "modeReported" ? withLane(log, event.agentId)(consume) : consume;
    // A failed event is isolated, but scope closure must still stop the stream.
    }).pipe(Effect.catchCause((cause) => Cause.hasInterrupts(cause)
      ? Effect.failCause(cause)
      : Effect.logWarning("runner event dropped: processing failed")));
    yield* runner.events.pipe(Stream.runForEach(handleRunnerEvent), Effect.forkScoped);
    yield* dispatchCommitted;
    yield* followAvailability;

    // Fix round 1, F3: a command that changes a target's process holds the
    // target's send lane from before its writer transaction through its
    // runner call. The lane always comes before the writer (lanes.ts). The
    // payload is not decoded yet, so only a string id picks a lane; a lane
    // for a bad id is harmless.
    const laneFor = (name: string, rawPayload: unknown): string | undefined => {
      if (projectLifecycleCommand(name)) return "project-lifecycle";
      if ((name !== "stop" && name !== "resume" && name !== "cancel-reply" && name !== "configure") || typeof rawPayload !== "object" || rawPayload === null) return undefined;
      const agentId = (rawPayload as { readonly agentId?: unknown }).agentId;
      return typeof agentId === "string" ? agentId : undefined;
    };
    // Fix round 1, A3: before `stop` queues for the lane, it signals a start of
    // that agent whose setup is still running (lanes.ts), so the lane frees at
    // once. The signal is sent only for a stop this caller could commit: the
    // credential, the payload, the agent's state and the holder are checked
    // here as the transaction checks them. The checks cannot see every refusal
    // (a reused request id, a writer failure), so the signal is not trusted
    // to mean the stop commits: the result is the step that tells the start
    // how the stop ended, and the start finishes the agent itself when the
    // stop did not (lanes.ts, round 2 F-1).
    const resolveCredential = (credential: Credential, name: string): Effect.Effect<Exclude<Caller, { _tag: "piece" }>, CommandRefused> => Effect.gen(function* () {
      if (credential._tag === "owner") return { _tag: "owner" } as const;
      if (credential._tag === "service") {
        if (!Object.hasOwn(lists.services, credential.service) || !lists.services[credential.service]?.includes(name)
          || (pieceNamespace(name) === undefined && !["prompt", "compact", "resume", "release", "subscribe"].includes(name))) return yield* refused();
        return credential;
      }
      const agentId = yield* verifyAgentToken(Redacted.value(credential.token)).pipe(Effect.mapError(() => refused("invalid credential")));
      const current = (yield* views.snapshot).agents[agentId];
      if (current === undefined || current.state._tag === "stopped" || current.state._tag === "crashed") return yield* refused("invalid credential");
      return { _tag: "agent", agentId } as const;
    }).pipe(Effect.provideService(SqlClient.SqlClient, sql));

    const preemptStart = (credential: Credential, name: string, rawPayload: unknown) => Effect.gen(function* () {
      const agentId = name === "stop" ? laneFor(name, rawPayload) : undefined;
      const rpc = lists.commands.requests.get("stop");
      if (agentId === undefined || rpc === undefined) return Effect.void;
      yield* Effect.try({
        try: () => Schema.decodeUnknownSync(Schema.toType(rpc.payloadSchema))(rawPayload),
        catch: () => refused(),
      });
      const caller = yield* resolveCredential(credential, name);
      const snapshot = yield* views.snapshot;
      const target = snapshot.agents[agentId];
      if (target === undefined || (target.state._tag !== "starting" && target.state._tag !== "paused")
        || commandOutcome(target.state._tag, "stop") === "refused") return Effect.void;
      if (caller._tag === "agent") {
        const current = snapshot.agents[caller.agentId];
        const holder = holderAbove(snapshot, agentId);
        if (current === undefined || current.state._tag === "stopped" || current.state._tag === "crashed"
          || holder._tag !== "agent" || holder.agentId !== caller.agentId) return Effect.void;
      }
      return yield* preempt(log, agentId);
    }).pipe(Effect.orElseSucceed((): Effect.Effect<void> => Effect.void), Effect.provideService(SqlClient.SqlClient, sql));
    // Issue 77: a blocking wait commits its opening and registers its
    // cancellation in one uninterruptible step (waits.ts, `block`). Every
    // other command stays interruptible throughout, as before.
    const isBlockingWait = (name: string, rawPayload: unknown) => name === "wait" && typeof rawPayload === "object"
      && rawPayload !== null && (rawPayload as { readonly block?: unknown }).block === true;

    // Direct callers use the same read table as the transport. A read always
    // rechecks current credentials and access, and never creates a receipt.
    const executeRead = (credential: Credential, name: string, rawPayload: unknown) => Effect.gen(function* () {
      if (Option.isSome(recovery) && !(yield* recovery.value.ready)) return yield* refused("recovering");
      const actor = yield* resolveCredential(credential, name);
      const rpc = lists.commands.requests.get(name);
      if (rpc === undefined || RpcSchema.isStreamSchema(rpc.successSchema) || !lists.access[name]?.includes(actor._tag)) return yield* refused();
      const payload = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(Schema.toType(rpc.payloadSchema))(rawPayload) as Record<string, unknown>,
        catch: () => refused(),
      });
      const snapshot = yield* views.snapshot;
      const read = lists.reads[name]!({ runtime, actor, snapshot }, payload);
      if (!Effect.isEffect(read)) return yield* refused();
      const result = yield* (read as Effect.Effect<import("../api/reads.ts").ReadReply, unknown, EventLog | Views | SqlClient.SqlClient>);
      const marks = result.marks ?? [];
      if (marks.length > 0 || (result.deliveries?.length ?? 0) > 0 || Object.keys(result.sideRows ?? {}).length > 0) {
        const namespace = pieceNamespace(name);
        if (namespace === undefined) return yield* refused();
        yield* log.transact((append) => Effect.gen(function* () {
          const current = yield* views.snapshot;
          const events = yield* checkPieceBatch(namespace, current, { events: marks, deliveries: result.deliveries, sideRows: result.sideRows }, actor, lists);
          yield* append(actor, freshRequest(), "read marks", events, result.sideRows ?? {}, false);
        }));
      }
      return result.reply;
    }).pipe(
      Effect.provideService(EventLog, log), Effect.provideService(Views, views), Effect.provideService(SqlClient.SqlClient, sql),
      Effect.mapError((error) => error instanceof CommandRefused || error instanceof LogWriteFailed ? error : refused()),
    );

    return CommandHandler.of({
      cache: (target) => Effect.gen(function* () {
        if (Option.isSome(recovery) && !(yield* recovery.value.ready)) return yield* refused("recovering");
        return yield* acceptCache(runtime, lists, target);
      }),
      input: (actor) => views.snapshot.pipe(Effect.map((snapshot) => ({ runtime, actor, snapshot }))),
      execute: (credential, name, rawPayload) => Object.hasOwn(lists.reads, name) ? executeRead(credential, name, rawPayload)
        : Effect.acquireUseRelease(preemptStart(credential, name, rawPayload), () => Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
        if (Option.isSome(recovery) && !(yield* recovery.value.ready)) return yield* refused("recovering");
        const step = isBlockingWait(name, rawPayload) ? <A, E, R>(effect: Effect.Effect<A, E, R>) => effect : restore;
        if (projectLifecycleCommand(name)) yield* step(Effect.gen(function* () {
          const actor = yield* resolveCredential(credential, name);
          const rpc = lists.commands.requests.get(name);
          if (actor._tag !== "owner" || rpc === undefined || !lists.access[name]?.includes(actor._tag)) return yield* refused();
          const payload = yield* Effect.try({ try: () => Schema.decodeUnknownSync(Schema.toType(rpc.payloadSchema))(rawPayload) as Record<string, unknown>, catch: () => refused() });
          const { requestId, ...body } = payload;
          if (typeof requestId !== "string" || (yield* log.redactText(requestId)) !== requestId) return yield* refused();
          const bodyHash = sha256Hex(canonical({ command: name, payload: body }));
          const receipts = yield* sql<{ body_hash: string }>`SELECT body_hash FROM receipts WHERE caller = 'owner' AND request_id = ${requestId}`;
          if (receipts[0] !== undefined) {
            if (receipts[0].body_hash !== bodyHash) return yield* refused("request id reused");
            return;
          }
          yield* prepareProjectLifecycle({ runtime, actor, snapshot: yield* views.snapshot }, name, payload, bodyHash);
        }));
        const outcome = yield* step(log.transact((append) => Effect.gen(function* () {
          // Invalid credentials never write an event or retrieve a receipt.
          const actor = yield* resolveCredential(credential, name);
          const rpc = lists.commands.requests.get(name);
          if (rpc === undefined || !Object.hasOwn(lists.planners, name)) return yield* refused();
          const payload = yield* Effect.try({
            try: () => {
              // The transport supplies decoded values. Normalize the wrapper's
              // label before validating it; the label is not secret data.
              let value = rawPayload;
              if (lists.secretCommands.includes(name) && typeof value === "object" && value !== null
                && "value" in value && Redacted.isRedacted(value.value)) {
                value = { ...value, value: Redacted.make(Redacted.value(value.value), { label: "secret value" }) };
              }
              return Schema.decodeUnknownSync(Schema.toType(rpc.payloadSchema))(value) as Record<string, unknown>;
            },
            catch: (error) => name === "roles.settings.set" ? settingsRefusal(error)
              : name === "client.web.settings.set" ? refused(`Invalid web settings. ${publicAddressError}`) : refused(),
          });
          const { requestId: id, ...body } = payload;
          const requestId = id as RequestId;
          // The rollback switch also refuses requests with an old receipt.
          if (name.startsWith("board.") && lists.boardEnabled === false) return yield* refused("board disabled");
          // Identifiers bypass event-text redaction. Reject a secret-bearing
          // id before looking up a receipt or planning even a refusal event.
          if ((yield* log.redactText(requestId)) !== requestId) return yield* refused();
          const bodyHash = sha256Hex(canonical(lists.secretCommands.includes(name)
            ? { command: name, payload: Object.fromEntries(Object.entries(body).filter(([key]) => key !== "value")) }
            : { command: name, payload: body }));
          const caller = callerKey(actor);
          const receipts = yield* sql<{ body_hash: string; result_json: string }>`
            SELECT body_hash, result_json FROM receipts WHERE caller = ${caller} AND request_id = ${requestId}`;
          const snapshot = yield* views.snapshot;
          const settings = name === "harnesses" ? yield* readHarnesses(runtime) : [];
          const decodeReceipt = (resultJson: string) => Effect.try({
            try: () => {
              const data: unknown = JSON.parse(resultJson);
              if (Array.isArray(data)) {
                const envelopes = Schema.decodeUnknownSync(Schema.Array(lists.envelope))(data);
                return replyFor(snapshot, name, requestId, envelopes as ReadonlyArray<EventEnvelope>, settings);
              }
              const result = Schema.decodeUnknownSync(Schema.Struct({ envelopes: Schema.Array(lists.envelope), reply: Schema.Unknown }))(data);
              return { reply: Schema.decodeUnknownSync(Schema.toType(rpc.successSchema))(result.reply) as Record<string, unknown> };
            },
            catch: () => new LogWriteFailed({ reason: "stored receipt is unreadable" }),
            });
          const receipt = receipts[0];
          if (receipt !== undefined) {
            if (receipt.body_hash !== bodyHash) return yield* refused("request id reused");
            const stored = yield* decodeReceipt(receipt.result_json);
            return { ...stored, afterCommit: undefined };
          }
          const planned = yield* Effect.gen(function* () {
            if (!lists.access[name]?.includes(actor._tag)) return yield* refused();
            const plan = yield* lists.planners[name]!({ runtime, actor, snapshot }, payload);
            const namespace = pieceNamespace(name);
            if (namespace !== undefined && !projectLifecycleCommand(name)) {
              if (plan.afterCommit !== undefined) return yield* refused();
              const events = yield* checkPieceBatch(namespace, snapshot, plan, actor, lists);
              return { ...plan, events };
            }
            return plan;
          }).pipe(Effect.result);
          if (planned._tag === "Failure") {
            if (planned.failure._tag === "LogWriteFailed") return yield* planned.failure;
            const failure = planned.failure;
            yield* append(actor, requestId, bodyHash, [{ _tag: "CommandRefused", command: name, reason: failure.reason }], {},
              failure.reason === "no usable account" || projectLifecycleCommand(name) ? false : undefined);
            return { failure, afterCommit: undefined };
          }
          const plan = planned.success;
          yield* append(actor, requestId, bodyHash, (pieceNamespace(name) === undefined || projectLifecycleCommand(name)) ? withWaitChecks(snapshot, plan.events, lists) : plan.events, plan.sideRows ?? {}, (batch) =>
            plan.reply === undefined ? replyFor(snapshot, name, requestId, batch, settings).reply : plan.reply(batch));
          // Return precisely the redacted result that a later retry reads.
          const written = yield* sql<{ result_json: string }>`
            SELECT result_json FROM receipts WHERE caller = ${caller} AND request_id = ${requestId}`;
          if (written[0] === undefined) return yield* new LogWriteFailed({ reason: "receipt insert returned no result" });
          return { ...(yield* decodeReceipt(written[0].result_json)), afterCommit: plan.afterCommit };
        })));
        if (outcome.failure !== undefined) return yield* outcome.failure;
        if (name === "client.web.settings.set") yield* webSettingsCommitted(views);
        const late = outcome.afterCommit === undefined ? undefined : yield* step(outcome.afterCommit);
        return late ?? outcome.reply!;
      })).pipe(
        (effect) => {
          const lane = laneFor(name, rawPayload);
          return lane === undefined ? effect : withLane(log, lane)(effect);
        },
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.catchTag("RequestIdReused", () => Effect.fail(refused("request id reused"))),
        Effect.catchTag("LogWriteFailed", (error) => Effect.fail(error instanceof InvalidEvent ? refused(error.reason) : error)),
        Effect.catchTag("SqlError", () => Effect.fail(new LogWriteFailed({ reason: "database read failed" }))),
      ), (settle) => settle).pipe((operation) => projectLifecycleCommand(name) ? engineOwned(operation) : operation),
    });
  }));
