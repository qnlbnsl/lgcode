import type { AgentId, DeliveryId, PermissionOption, SessionReference } from "@lgtm/contracts";
import type * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import {
  Runner, RunnerRejected,
  type ReplayItem, type RunnerCapabilities, type RunnerEvent, type SessionInfo,
} from "../../src/runner/Runner.ts";
import { sha256Hex } from "../../src/identity/credential.ts";

// The Runner test double of unit 5b.2 (decision rows 44 and 59), used by units
// 5b to 5d. It implements the row-44 interface without a child process: it
// records every call in order, answers from a script a test can replace, and
// lets a test push events into the stream the engine reads.
//
// Nothing here starts an adapter, opens a socket or touches a harness home.

type RunnerShape = Context.Service.Shape<typeof Runner>;
type Methods = Omit<RunnerShape, "capabilities" | "events">;
export type RunnerMethod = keyof Methods;
type Input<M extends RunnerMethod> = Parameters<Methods[M]>[0] &
  (M extends "prompt" | "compact" ? { readonly incarnation: string } : unknown);

export interface RunnerCall<M extends RunnerMethod = RunnerMethod> {
  readonly method: M;
  readonly input: Input<M>;
}

// A scripted reply gets the call's input and returns the effect the method
// returns. The default script succeeds and opens an `acp` session named after
// the agent.
type Script = {
  readonly [M in RunnerMethod]: (input: Input<M>) => ReturnType<Methods[M]>;
};

// Historical-log fixtures represent an already-running process. Register
// that process in the fake's table without calling a real start or changing
// the Runner interface. Each fake has its own table, keyed by its service.
const seededProcesses = new WeakMap<RunnerShape, (agentId: AgentId, token: string, live: boolean) => void>();
export const seedFakeProcess = (runner: RunnerShape, agentId: AgentId, token: string, live: boolean): void => {
  seededProcesses.get(runner)?.(agentId, token, live);
};

export const sessionFor = (agentId: AgentId, reloadable = true): SessionInfo => ({
  session: { _tag: "acp", sessionId: `fake-session-${agentId}` } satisfies SessionReference,
  protocolVersion: 2,
  reloadable,
});

const defaultCapabilities: RunnerCapabilities = {
  loadSession: true,
  resumeSession: false,
  setModeConfigOption: true,
};

// Unit 5c's runner events (decision rows 27, 50, 51, 67; issue 61). Unit 6a's
// real runner must produce exactly these shapes; the builder adds them to
// `RunnerEvent` in `src/runner/Runner.ts`.
//
// `incarnation` names the spawn an event belongs to: the SHA-256 hex of the
// token that spawn was given, which is the `token_hash` of its row in
// `agent_tokens`. The engine ignores an event whose incarnation is not an
// unrevoked token hash of that agent, so a late event from an earlier
// process cannot act on a later one.
//
// `permissionRequested`: the adapter asked to use a tool. `permissionRequestId`
// is the runner's own id for the held request, unique across agents; the
// engine records it as the request's `permissionRequestId` and passes it back
// as `requestId` to `answerPermission`. The options arrive already mapped onto
// LGTM Studio's scale (task 6a.3, rows 35b and 56), and `settingsWrite` says the
// tool would write a harness settings path.
export interface PermissionRequestedEvent {
  readonly _tag: "permissionRequested";
  readonly agentId: AgentId;
  readonly incarnation: string;
  readonly permissionRequestId: string;
  readonly toolCallId: string;
  readonly description: string;
  readonly options: ReadonlyArray<PermissionOption>;
  readonly settingsWrite: boolean;
}

// `turnEnded`: the named delivery's `session/prompt` reply ended its turn.
// The engine correlates it with the current turn before writing "turn ended"
// and passing up what the agent still holds (row 67).
export interface TurnEndedEvent {
  readonly _tag: "turnEnded";
  readonly agentId: AgentId;
  readonly incarnation: string;
  readonly deliveryId: DeliveryId;
  // Fixtures may omit this to end the latest send. Race tests name the
  // actual old reservation instead, just as the real runner does.
  readonly sentSequence?: number;
}

// `exited`: the agent's process ended (row 32). Fix round 1 of unit 5c,
// ruling 3 (issue 61): it carries the incarnation of the spawn that ended,
// like the other two tags, and the engine drops an exit whose incarnation is
// not a live token hash of the named agent.
export interface ExitedEvent {
  readonly _tag: "exited";
  readonly agentId: AgentId;
  readonly incarnation: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stderr: string;
}

// Unit 5d: notices name the delivery sent by the runner. Replay and
// available-commands notices never accept. Only pause errors requeue.
export interface DeliveryUpdateEvent {
  readonly _tag: "deliveryUpdate";
  readonly agentId: AgentId;
  readonly incarnation: string;
  readonly deliveryId: string;
  readonly kind: "message" | "plan" | "tool-call" | "file-change" | "available_commands_update";
  readonly replay: boolean;
  readonly text: string;
}

export interface PromptReplyEvent {
  readonly _tag: "promptReply";
  readonly agentId: AgentId;
  readonly incarnation: string;
  readonly deliveryId: string;
  readonly outcome:
    | { readonly _tag: "success" }
    | { readonly _tag: "capacity"; readonly error: string }
    | { readonly _tag: "pause"; readonly reason: "out-of-usage" | "signed-out"; readonly error: string; readonly resetAt?: number }
    | { readonly _tag: "error"; readonly error: string };
}

export type FakeRunnerEvent = RunnerEvent | PermissionRequestedEvent | TurnEndedEvent | ExitedEvent | DeliveryUpdateEvent | PromptReplyEvent;

// `emit` defaults an exit's incarnation to the current spawn and a turn end's
// deliveryId to the last delivery sent to that agent. Historical fixtures
// fall back to the latest DeliverySent in the real event log (lead #914).
export type EmittedEvent = FakeRunnerEvent | Omit<ExitedEvent, "incarnation"> | Omit<TurnEndedEvent, "deliveryId">;

// The incarnation of the agent's current spawn: its newest live token hash,
// or, when every token is revoked, its newest token hash. An agent with no
// token at all gets a value that matches no row.
export const currentIncarnation = (agentId: string) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ token_hash: string }>`
    SELECT token_hash FROM agent_tokens WHERE agent_id = ${agentId}
    ORDER BY revoked_at IS NULL DESC, rowid DESC LIMIT 1`;
  return rows[0]?.token_hash ?? "no-incarnation";
}).pipe(Effect.orDie);

// The incarnation of a spawn that was given `token` (a raw `shp_a_` value).
export const incarnationOf = (token: string): string => sha256Hex(token);

export interface FakeRunner {
  readonly layer: Layer.Layer<Runner>;
  // Every call to reach the simulated transport, oldest first, including
  // rejected calls. A held send is recorded when released; its script runs
  // only if the incarnation check succeeds. The array is live.
  readonly calls: ReadonlyArray<RunnerCall>;
  readonly callsOf: <M extends RunnerMethod>(method: M) => ReadonlyArray<RunnerCall<M>>;
  // Replace one method's reply. The replacement stays until `reset`.
  readonly script: <M extends RunnerMethod>(method: M, reply: Script[M]) => void;
  // Make the next `times` calls of a method fail with `RunnerRejected`. The
  // reason is a fixed text the test chooses; the call is still recorded.
  readonly rejectNext: (method: "start" | "load" | "prompt" | "setMode" | "compact", reason: string, times?: number) => void;
  // Suspends the next send before it reaches the process. `entered` proves
  // the engine has reserved it; release is idempotent and also safe in cleanup.
  readonly holdNext: (method: "prompt" | "compact") => {
    readonly entered: Effect.Effect<void>;
    readonly release: Effect.Effect<void>;
  };
  // Push an event into the stream the engine consumes. An `exited` event
  // without an incarnation gets the agent's current one, read at this call.
  readonly emit: (event: EmittedEvent) => Effect.Effect<void, never, SqlClient.SqlClient>;
  // Push any value, unchecked, as a misbehaving runner could: fix round 1
  // of unit 5c, ruling 1, needs events that break the event schema.
  readonly emitRaw: (event: unknown) => Effect.Effect<void>;
  // Succeeds once the engine has subscribed to `events`, so an event emitted
  // afterwards is not lost.
  readonly subscribed: Effect.Effect<void>;
  readonly reset: () => void;
}

export const makeFakeRunner = (options: { readonly capabilities?: Partial<RunnerCapabilities> } = {}): Effect.Effect<FakeRunner> =>
  Effect.gen(function* () {
    const calls: Array<RunnerCall> = [];
    const pubsub = yield* PubSub.unbounded<FakeRunnerEvent>();
    const subscribedSignal = yield* Deferred.make<void>();
    const configurationFor = (input: Input<"start">) => ({
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.effort === undefined ? {} : { effort: input.effort }),
    });
    const defaults: Script = {
      // The fake peer advertises the fixture's model lists on discovery. Live
      // agent reads remain unavailable unless a test scripts them explicitly.
      discover: ({ harness }) => Effect.succeed({
        models: { source: "negotiated", options: harness.models.map((id) => ({ id, label: id })) },
        efforts: { source: "negotiated", options: harness.efforts.map((id) => ({ id, label: id })) },
      }),
      start: (input) => Effect.succeed({ ...sessionFor(input.agentId), configuration: configurationFor(input) }),
      load: (input) => Effect.succeed({ ...sessionFor(input.agentId), session: input.session, configuration: configurationFor(input) }),
      prompt: () => Effect.void,
      configure: ({ desired }) => Effect.succeed({ status: "applied", applied: desired }),
      choices: () => Effect.succeed({ models: { source: "unavailable", options: [] }, efforts: { source: "unavailable", options: [] } }),
      context: () => Effect.succeed({ _tag: "unavailable", reason: "not-reported" }),
      cancel: () => Effect.void,
      answerPermission: () => Effect.void,
      setMode: () => Effect.void,
      compact: () => Effect.void,
      stop: () => Effect.void,
    } as Script;
    let script: Script = { ...defaults };
    const rejections = new Map<RunnerMethod, Array<string>>();
    const holds = new Map<RunnerMethod, Array<{ entered: Deferred.Deferred<void>; release: Deferred.Deferred<void> }>>();
    const lastDelivery = new Map<AgentId, DeliveryId>();
    const incarnations = new Map<AgentId, string>();
    // Unit 6d fix round 1 (issue 154): the real runner returns a load's replay
    // with its result. Replay updates a load script emits for its own spawn
    // are collected here and returned the same way.
    const loading = new Map<string, { readonly incarnation: string; readonly items: Array<ReplayItem> }>();
    const noteReplay = (event: unknown) => {
      if (event === null || typeof event !== "object") return;
      const update = event as { _tag?: unknown; agentId?: unknown; incarnation?: unknown; kind?: unknown; replay?: unknown; role?: unknown; text?: unknown };
      if (update._tag !== "deliveryUpdate" || update.replay !== true || update.kind === "available_commands_update" || typeof update.text !== "string") return;
      const capture = loading.get(String(update.agentId));
      if (capture === undefined || capture.incarnation !== update.incarnation) return;
      capture.items.push(update.kind === "message" && update.role === "user" ? { _tag: "user", text: update.text } : { _tag: "break" });
    };

    const call = <M extends RunnerMethod>(method: M) => (input: Input<M>): ReturnType<Methods[M]> => Effect.gen(function* () {
      if (method === "prompt" || method === "compact") {
        const hold = holds.get(method)?.shift();
        if (hold !== undefined) {
          yield* Deferred.succeed(hold.entered, undefined);
          yield* Deferred.await(hold.release);
        }
      }
      calls.push({ method, input } as RunnerCall);
      if (method === "prompt" || method === "compact") {
        const send = input as Input<"prompt">;
        if (send.incarnation === undefined || send.incarnation !== incarnations.get(send.agentId)) {
          return yield* Effect.fail(new RunnerRejected({ reason: "stale incarnation" }));
        }
        lastDelivery.set(send.agentId, send.delivery.id);
      }
      const reason = rejections.get(method)?.shift();
      if (reason !== undefined) return yield* Effect.fail(new RunnerRejected({ reason }));
      const capture = method === "load"
        ? { incarnation: incarnationOf(Redacted.value((input as Input<"load">).token)), items: [] as Array<ReplayItem> } : undefined;
      if (capture !== undefined) loading.set((input as Input<"load">).agentId, capture);
      let result = yield* (script[method] as (input: Input<M>) => ReturnType<Methods[M]>)(input).pipe(
        Effect.ensuring(Effect.sync(() => {
          if (capture !== undefined && loading.get((input as Input<"load">).agentId) === capture) loading.delete((input as Input<"load">).agentId);
        })));
      if (capture !== undefined && (result as unknown as SessionInfo).replay === undefined) {
        result = { ...(result as unknown as SessionInfo), replay: capture.items } as unknown as typeof result;
      }
      if (method === "start" || method === "load") {
        const spawn = input as Input<"start">;
        incarnations.set(spawn.agentId, incarnationOf(Redacted.value(spawn.token)));
      } else if (method === "stop") incarnations.delete((input as Input<"stop">).agentId);
      return result;
    }) as ReturnType<Methods[M]>;

    const service: RunnerShape = {
      discover: call("discover"),
      start: call("start"),
      load: call("load"),
      prompt: call("prompt"),
      configure: call("configure"),
      choices: call("choices"),
      context: call("context"),
      cancel: call("cancel"),
      answerPermission: call("answerPermission"),
      setMode: call("setMode"),
      compact: call("compact"),
      stop: call("stop"),
      capabilities: { ...defaultCapabilities, ...options.capabilities },
      // Subscribe before signalling, so nothing emitted after `subscribed` is lost.
      events: Stream.unwrap(Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(pubsub);
        yield* Deferred.succeed(subscribedSignal, undefined);
        return Stream.fromSubscription(subscription) as Stream.Stream<RunnerEvent>;
      })),
    } as RunnerShape;
    seededProcesses.set(service, (agentId, token, live) => {
      if (live) incarnations.set(agentId, incarnationOf(token));
      else incarnations.delete(agentId);
    });

    return {
      layer: Layer.succeed(Runner, service),
      calls,
      callsOf: <M extends RunnerMethod>(method: M) =>
        calls.filter((entry): entry is RunnerCall<M> => entry.method === method),
      script: (method, reply) => { script = { ...script, [method]: reply }; },
      rejectNext: (method, reason, times = 1) => {
        rejections.set(method, [...(rejections.get(method) ?? []), ...Array.from({ length: times }, () => reason)]);
      },
      holdNext: (method) => {
        const entered = Deferred.makeUnsafe<void>();
        const release = Deferred.makeUnsafe<void>();
        holds.set(method, [...(holds.get(method) ?? []), { entered, release }]);
        return { entered: Deferred.await(entered), release: Deferred.succeed(release, undefined).pipe(Effect.asVoid) };
      },
      emit: (event) => Effect.gen(function* () {
        let lastSent: DeliveryId | undefined;
        if (event._tag === "turnEnded" && !("deliveryId" in event) && !lastDelivery.has(event.agentId)) {
          const sql = yield* SqlClient.SqlClient;
          const rows = yield* sql<{ payload_json: string }>`
            SELECT payload_json FROM events WHERE event_type = 'DeliverySent'
            AND json_extract(payload_json, '$.agentId') = ${event.agentId}
            ORDER BY sequence DESC LIMIT 1`;
          lastSent = rows[0] === undefined ? undefined : (JSON.parse(rows[0].payload_json) as { deliveryId: DeliveryId }).deliveryId;
        }
        let complete: FakeRunnerEvent = event._tag === "exited" && !("incarnation" in event)
          ? { ...event, incarnation: yield* currentIncarnation(event.agentId) }
          : event._tag === "turnEnded" && !("deliveryId" in event)
            ? { ...event, deliveryId: lastDelivery.get(event.agentId) ?? lastSent ?? "no-delivery" as DeliveryId }
            : event as FakeRunnerEvent;
        if (complete._tag === "turnEnded" && complete.sentSequence === undefined) {
          const sql = yield* SqlClient.SqlClient;
          const rows = yield* sql<{ sequence: number }>`
            SELECT sequence FROM events WHERE event_type = 'DeliverySent'
            AND json_extract(payload_json, '$.agentId') = ${complete.agentId}
            AND json_extract(payload_json, '$.deliveryId') = ${complete.deliveryId}
            ORDER BY sequence DESC LIMIT 1`;
          complete = { ...complete, sentSequence: rows[0]?.sequence ?? 0 };
        }
        if (complete._tag === "exited" && complete.incarnation === incarnations.get(complete.agentId)) incarnations.delete(complete.agentId);
        noteReplay(complete);
        yield* PubSub.publish(pubsub, complete);
      }).pipe(Effect.orDie),
      emitRaw: (event) => Effect.sync(() => noteReplay(event)).pipe(
        Effect.andThen(PubSub.publish(pubsub, event as FakeRunnerEvent)), Effect.asVoid),
      subscribed: Deferred.await(subscribedSignal),
      reset: () => { calls.length = 0; script = { ...defaults }; rejections.clear(); holds.clear(); },
    } satisfies FakeRunner;
  });
