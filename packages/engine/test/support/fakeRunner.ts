import type { AgentId, SessionReference } from "@shepherd/contracts";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import {
  Runner, RunnerRejected,
  type RunnerCapabilities, type RunnerEvent, type SessionInfo,
} from "../../src/runner/Runner.ts";

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
  // Push an event into the stream the engine consumes.
  readonly emit: (event: RunnerEvent) => Effect.Effect<void>;
  readonly reset: () => void;
}

export const makeFakeRunner = (options: { readonly capabilities?: Partial<RunnerCapabilities> } = {}): Effect.Effect<FakeRunner> =>
  Effect.gen(function* () {
    const calls: Array<RunnerCall> = [];
    const pubsub = yield* PubSub.unbounded<RunnerEvent>();
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
      events: Stream.fromPubSub(pubsub),
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
      emit: (event) => PubSub.publish(pubsub, event).pipe(Effect.asVoid),
      reset: () => { calls.length = 0; script = { ...defaults }; rejections.clear(); },
    } satisfies FakeRunner;
  });
