import type { AgentId, PermissionOption, SessionReference } from "@shepherd/contracts";
import type * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import {
  Runner, RunnerRejected,
  type RunnerCapabilities, type RunnerEvent, type SessionInfo,
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
type Input<M extends RunnerMethod> = Parameters<Methods[M]>[0];

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
// Shepherd's scale (task 6a.3, rows 35b and 56), and `settingsWrite` says the
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

// `turnEnded`: the agent's current turn finished (the `session/prompt` reply
// arrived). The engine writes "turn ended" and, in the same transaction,
// passes up what the agent still holds (row 67).
export interface TurnEndedEvent {
  readonly _tag: "turnEnded";
  readonly agentId: AgentId;
  readonly incarnation: string;
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

export type FakeRunnerEvent = RunnerEvent | PermissionRequestedEvent | TurnEndedEvent | ExitedEvent;

// What `emit` takes: an `exited` event may leave out its incarnation, and
// then gets the agent's current one (see `currentIncarnation`).
export type EmittedEvent = FakeRunnerEvent | Omit<ExitedEvent, "incarnation">;

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
  // Every call so far, oldest first. The array is live: read it after the
  // command under test has returned.
  readonly calls: ReadonlyArray<RunnerCall>;
  readonly callsOf: <M extends RunnerMethod>(method: M) => ReadonlyArray<RunnerCall<M>>;
  // Replace one method's reply. The replacement stays until `reset`.
  readonly script: <M extends RunnerMethod>(method: M, reply: Script[M]) => void;
  // Make the next `times` calls of a method fail with `RunnerRejected`. The
  // reason is a fixed text the test chooses; the call is still recorded.
  readonly rejectNext: (method: "start" | "load" | "prompt" | "setMode" | "compact", reason: string, times?: number) => void;
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
    const defaults: Script = {
      start: (input) => Effect.succeed(sessionFor(input.agentId)),
      load: (input) => Effect.succeed({ ...sessionFor(input.agentId), session: input.session }),
      prompt: () => Effect.void,
      cancel: () => Effect.void,
      answerPermission: () => Effect.void,
      setMode: () => Effect.void,
      compact: () => Effect.void,
      stop: () => Effect.void,
    } as Script;
    let script: Script = { ...defaults };
    const rejections = new Map<RunnerMethod, Array<string>>();

    const call = <M extends RunnerMethod>(method: M) => (input: Input<M>): ReturnType<Methods[M]> => {
      calls.push({ method, input } as RunnerCall);
      const reason = rejections.get(method)?.shift();
      if (reason !== undefined) return Effect.fail(new RunnerRejected({ reason })) as ReturnType<Methods[M]>;
      return (script[method] as (input: Input<M>) => ReturnType<Methods[M]>)(input);
    };

    const service: RunnerShape = {
      start: call("start"),
      load: call("load"),
      prompt: call("prompt"),
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

    return {
      layer: Layer.succeed(Runner, service),
      calls,
      callsOf: <M extends RunnerMethod>(method: M) =>
        calls.filter((entry): entry is RunnerCall<M> => entry.method === method),
      script: (method, reply) => { script = { ...script, [method]: reply }; },
      rejectNext: (method, reason, times = 1) => {
        rejections.set(method, [...(rejections.get(method) ?? []), ...Array.from({ length: times }, () => reason)]);
      },
      emit: (event) => Effect.gen(function* () {
        const complete: FakeRunnerEvent = event._tag === "exited" && !("incarnation" in event)
          ? { ...event, incarnation: yield* currentIncarnation(event.agentId) }
          : event as FakeRunnerEvent;
        yield* PubSub.publish(pubsub, complete);
      }),
      emitRaw: (event) => PubSub.publish(pubsub, event as FakeRunnerEvent).pipe(Effect.asVoid),
      subscribed: Deferred.await(subscribedSignal),
      reset: () => { calls.length = 0; script = { ...defaults }; rejections.clear(); },
    } satisfies FakeRunner;
  });
