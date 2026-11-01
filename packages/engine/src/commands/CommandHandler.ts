import { randomUUID } from "node:crypto";
import {
  CommandsRpcGroup, EventEnvelope, commandOutcome, ownerOnlyCommands,
  type Actor, type Event, type HarnessSettings, type RequestId,
} from "@shepherd/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import { sha256Hex } from "../identity/credential.ts";
import { verifyDeviceCredential } from "../identity/devices.ts";
import { verifyAgentToken } from "../identity/tokens.ts";
import { EventLog, LogWriteFailed, type SideRows } from "../log/EventLog.ts";
import { Runner, RunnerEvent } from "../runner/Runner.ts";
import { dispatchCommitted, deliveryUpdate, promptReply, targetGone, turnEnded } from "../routing/deliveries.ts";
import { holderAbove, moveHeld, passUp } from "../routing/holders.ts";
import { withLane } from "../routing/lanes.ts";
import { answer, permissionRequested } from "../routing/permissions.ts";
import { ask } from "../routing/questions.ts";
import { project, wait, waitReply, withWaitChecks } from "../routing/waits.ts";
import { Views } from "../views/Views.ts";
import { apply } from "../views/apply.ts";
import { SecretStore } from "./SecretStore.ts";
import { accounts, setSecret, markAvailable } from "./accounts.ts";
import { compact } from "./compact.ts";
import { group } from "./group.ts";
import { harnesses } from "./harnesses.ts";
import { prompt } from "./prompt.ts";
import { resume } from "./resume.ts";
import { start } from "./start.ts";
import { stop } from "./stop.ts";
import { CommandRefused, freshRequest, readHarnesses, refused, type Input, type Payload, type Plan, type Runtime, type Snapshot } from "./internal.ts";

export { CommandRefused } from "./internal.ts";

type Credential =
  | { readonly _tag: "owner" }
  | { readonly _tag: "device"; readonly credential: Redacted.Redacted<string> }
  | { readonly _tag: "agent"; readonly token: Redacted.Redacted<string> };

export class CommandHandler extends Context.Service<CommandHandler, {
  readonly execute: (credential: Credential, name: string, payload: unknown) => Effect.Effect<Record<string, unknown>, CommandRefused | LogWriteFailed>;
}>()("shepherd/engine/commands/CommandHandler") {}

const supported = new Set(["start", "prompt", "stop", "resume", "compact", "group", "accounts", "accounts set-secret", "accounts mark-available", "harnesses", "answer", "pass-up", "ask", "wait"]);
const targeted = new Set(["prompt", "stop", "resume", "compact", "group"]);
const owners = new Set<string>(ownerOnlyCommands);
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

// Payloads have been checked with their contract's decoded-value schema.
const planCommand = (input: Input, name: string, payload: Record<string, unknown>): Effect.Effect<Plan, CommandRefused | LogWriteFailed> =>
  Effect.gen(function* () {
    const { actor, snapshot } = input;
    if (!supported.has(name) || (owners.has(name) && actor._tag !== "owner")) return yield* refused();
    const agentId = payload.agentId as string;
    const agent = snapshot.agents[agentId];
    if (targeted.has(name)) {
      if (agent === undefined || commandOutcome(agent.state._tag, name as "prompt" | "stop" | "resume" | "compact" | "group") === "refused") return yield* refused();
      const holder = holderAbove(snapshot, agentId);
      if (actor._tag === "agent" && (holder._tag !== "agent" || holder.agentId !== actor.agentId)) return yield* refused();
    }
    switch (name) {
      case "start": return yield* start(input, payload as Payload<"start">);
      case "prompt": return prompt(input, payload as Payload<"prompt">);
      case "answer": return yield* answer(input, payload as Payload<"answer">);
      case "pass-up": return yield* passUp(input, payload as Payload<"pass-up">);
      case "ask": return yield* ask(input, payload as Payload<"ask">);
      case "wait": return yield* wait(input, payload as Payload<"wait">);
      case "compact": return compact(input, payload as Payload<"compact">);
      case "stop": return stop(input, agent!);
      case "resume": return yield* resume(input, agent!, payload as Payload<"resume">);
      case "group": return group(agent!, payload as Payload<"group">);
      case "accounts": return yield* accounts(input, payload as Payload<"accounts">);
      case "accounts set-secret": return yield* setSecret(input, payload as Payload<"accounts set-secret">);
      case "accounts mark-available": return yield* markAvailable(input, payload as Payload<"accounts mark-available">);
      case "harnesses": return harnesses(payload as Payload<"harnesses">);
      default: return yield* refused();
    }
  });

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
  if (name === "accounts") reply.accounts = Object.values(envelopes.reduce(apply, snapshot).accounts);
  if (name === "harnesses") {
    const harnesses = new Map(settings.map((harness) => [harness.id, harness]));
    for (const event of events) if (event._tag === "HarnessChanged") harnesses.set(event.harness.id, event.harness);
    reply.harnesses = [...harnesses.values()];
  }
  return { reply };
};

export const layer = (configuration: { readonly home: string; readonly stateFolder: string; readonly pluginRoot: string }) =>
  Layer.effect(CommandHandler, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const log = yield* EventLog;
    const views = yield* Views;
    const runner = yield* Runner;
    const secrets = yield* SecretStore;
    const runtime: Runtime = { ...configuration, sql, log, runner, secrets, views };

    // stderr is deliberately omitted. Even a failed adapter can echo a raw
    // credential there; the contract's required text field receives no data.
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
            : append({ _tag: "owner" }, freshRequest(), randomUUID(), withWaitChecks(snapshot, events), sideRows).pipe(Effect.asVoid);
          switch (event._tag) {
            case "permissionRequested": return yield* write(yield* permissionRequested(snapshot, event));
            case "turnEnded": return yield* write(turnEnded(snapshot, event));
            case "deliveryUpdate": return yield* write(deliveryUpdate(snapshot, event));
            case "modeReported": {
              resetMode = event.level === undefined;
              return yield* write([event.level === undefined
                ? { _tag: "ModeRefused", agentId: event.agentId, mode: event.mode, ceiling: event.ceiling, reason: "mode exceeds permission ceiling" }
                : { _tag: "ModeChanged", agentId: event.agentId, mode: event.mode, level: event.level }]);
            }
            case "promptReply": return yield* write(yield* promptReply(snapshot, event, log.redactText));
            case "exited": {
              const crashed: ReadonlyArray<Event> = [{
                _tag: "AgentCrashed", agentId: event.agentId, exitCode: event.exitCode, signal: event.signal, stderr: "",
              }, ...moveHeld(snapshot, [event.agentId])];
              return yield* write([...crashed, ...targetGone(project(snapshot, crashed), event.agentId, "crashed")],
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

    // Fix round 1, F3: a command that changes a target's process holds the
    // target's send lane from before its writer transaction through its
    // runner call. The lane always comes before the writer (lanes.ts). The
    // payload is not decoded yet, so only a string id picks a lane; a lane
    // for a bad id is harmless.
    const laneFor = (name: string, rawPayload: unknown): string | undefined => {
      if ((name !== "stop" && name !== "resume") || typeof rawPayload !== "object" || rawPayload === null) return undefined;
      const agentId = (rawPayload as { readonly agentId?: unknown }).agentId;
      return typeof agentId === "string" ? agentId : undefined;
    };
    // Issue 77: a blocking wait commits its opening and registers its
    // cancellation in one uninterruptible step (waits.ts, `block`). Every
    // other command stays interruptible throughout, as before.
    const isBlockingWait = (name: string, rawPayload: unknown) => name === "wait" && typeof rawPayload === "object"
      && rawPayload !== null && (rawPayload as { readonly block?: unknown }).block === true;

    return CommandHandler.of({
      execute: (credential, name, rawPayload) => Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
        const step = isBlockingWait(name, rawPayload) ? <A, E, R>(effect: Effect.Effect<A, E, R>) => effect : restore;
        const outcome = yield* step(log.transact((append) => Effect.gen(function* () {
          // Invalid credentials never write an event or retrieve a receipt.
          let actor: Actor;
          if (credential._tag === "owner") actor = { _tag: "owner" };
          else if (credential._tag === "device") {
            yield* verifyDeviceCredential(Redacted.value(credential.credential)).pipe(Effect.mapError(() => refused("invalid credential")));
            actor = { _tag: "owner" };
          } else {
            const agentId = yield* verifyAgentToken(Redacted.value(credential.token)).pipe(Effect.mapError(() => refused("invalid credential")));
            const current = (yield* views.snapshot).agents[agentId];
            if (current === undefined || current.state._tag === "stopped" || current.state._tag === "crashed") return yield* refused("invalid credential");
            actor = { _tag: "agent", agentId };
          }
          const rpc = CommandsRpcGroup.requests.get(name);
          if (rpc === undefined || !supported.has(name)) return yield* refused();
          const payload = yield* Effect.try({
            try: () => {
              // The transport supplies decoded values. Normalize the wrapper's
              // label before validating it; the label is not secret data.
              let value = rawPayload;
              if (name === "accounts set-secret" && typeof value === "object" && value !== null
                && "value" in value && Redacted.isRedacted(value.value)) {
                value = { ...value, value: Redacted.make(Redacted.value(value.value), { label: "secret value" }) };
              }
              return Schema.decodeUnknownSync(Schema.toType(rpc.payloadSchema))(value) as Record<string, unknown>;
            },
            catch: () => refused(),
          });
          const { requestId: id, ...body } = payload;
          const requestId = id as RequestId;
          // Identifiers bypass event-text redaction. Reject a secret-bearing
          // id before looking up a receipt or planning even a refusal event.
          if ((yield* log.redactText(requestId)) !== requestId) return yield* refused();
          const bodyHash = sha256Hex(canonical(name === "accounts set-secret"
            ? { command: name, accountId: payload.accountId, nonce: payload.nonce }
            : { command: name, payload: body }));
          const caller = actor._tag === "owner" ? "owner" : `agent:${actor.agentId}`;
          const receipts = yield* sql<{ body_hash: string; result_json: string }>`
            SELECT body_hash, result_json FROM receipts WHERE caller = ${caller} AND request_id = ${requestId}`;
          const snapshot = yield* views.snapshot;
          const settings = name === "harnesses" ? yield* readHarnesses(runtime) : [];
          const decodeReceipt = (resultJson: string) => Effect.try({
            try: () => {
              const data: unknown = JSON.parse(resultJson);
              if (Array.isArray(data)) {
                const envelopes = Schema.decodeUnknownSync(Schema.Array(EventEnvelope))(data);
                return replyFor(snapshot, name, requestId, envelopes, settings);
              }
              const result = Schema.decodeUnknownSync(Schema.Struct({ envelopes: Schema.Array(EventEnvelope), reply: Schema.Unknown }))(data);
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
          const planned = yield* planCommand({ runtime, actor, snapshot }, name, payload).pipe(Effect.result);
          if (planned._tag === "Failure") {
            if (planned.failure._tag === "LogWriteFailed") return yield* planned.failure;
            const failure = planned.failure;
            yield* append(actor, requestId, bodyHash, [{ _tag: "CommandRefused", command: name, reason: failure.reason }], {},
              failure.reason === "no usable account" ? false : undefined);
            return { failure, afterCommit: undefined };
          }
          const plan = planned.success;
          yield* append(actor, requestId, bodyHash, withWaitChecks(snapshot, plan.events), plan.sideRows ?? {}, (batch) =>
            replyFor(snapshot, name, requestId, batch, settings).reply);
          // Return precisely the redacted result that a later retry reads.
          const written = yield* sql<{ result_json: string }>`
            SELECT result_json FROM receipts WHERE caller = ${caller} AND request_id = ${requestId}`;
          if (written[0] === undefined) return yield* new LogWriteFailed({ reason: "receipt insert returned no result" });
          return { ...(yield* decodeReceipt(written[0].result_json)), afterCommit: plan.afterCommit };
        })));
        if (outcome.failure !== undefined) return yield* outcome.failure;
        const late = outcome.afterCommit === undefined ? undefined : yield* step(outcome.afterCommit);
        return late ?? outcome.reply!;
      })).pipe(
        (effect) => {
          const lane = laneFor(name, rawPayload);
          return lane === undefined ? effect : withLane(log, lane)(effect);
        },
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.catchTag("RequestIdReused", () => Effect.fail(refused("request id reused"))),
        Effect.catchTag("SqlError", () => Effect.fail(new LogWriteFailed({ reason: "database read failed" }))),
      ),
    });
  }));
