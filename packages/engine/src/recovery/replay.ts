import * as Effect from "effect/Effect";

import type { RunnerEvent } from "../runner/Runner.ts";

type Update = Extract<RunnerEvent, { _tag: "deliveryUpdate" }>;

// Rows 29, 51 and 66: while an agent's session reloads, the replayed history
// is scanned for delivery ids that were sent but not accepted. Only user
// message content counts, after joining consecutive user chunks: an agent
// chunk, a plan, a tool call or a file change ends the user's run. A live
// update and an update from another spawn are ignored.
//
// The command handler is the one consumer of the runner's events, so it
// passes each replay update here (`observeReplay`); a reload opens a capture
// for the spawn it is loading. Captures belong to one event log, like the
// send lanes (routing/lanes.ts), and nothing outlives the reload.
interface Capture {
  readonly incarnation: string;
  readonly runs: Array<string>;
  open: boolean;
}

const registry = new WeakMap<object, Map<string, Capture>>();

export const observeReplay = (log: object, event: Update): Effect.Effect<void> => Effect.sync(() => {
  if (!event.replay || event.kind === "available_commands_update") return;
  const capture = registry.get(log)?.get(event.agentId);
  if (capture === undefined || capture.incarnation !== event.incarnation) return;
  if (event.kind !== "message" || event.role !== "user") {
    capture.open = false;
    return;
  }
  if (capture.open) capture.runs[capture.runs.length - 1] += event.text;
  else {
    capture.runs.push(event.text);
    capture.open = true;
  }
});

// The runner publishes every replay update before its load returns, but the
// handler reads them in its own fiber. Yielding lets that fiber drain what
// is already published before the scan is read. Nothing else is awaited.
const SETTLE_YIELDS = 64;
const settle = Effect.gen(function* () {
  for (let round = 0; round < SETTLE_YIELDS; round++) yield* Effect.yieldNow;
});

// Runs `load` with a capture open for one spawn, and returns its result with
// the joined user runs it replayed.
export const capturingReplay = <A, E, R>(log: object, agentId: string, incarnation: string, load: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      let captures = registry.get(log);
      if (captures === undefined) registry.set(log, captures = new Map());
      const capture: Capture = { incarnation, runs: [], open: false };
      captures.set(agentId, capture);
      return capture;
    }),
    // The runs are read only after the settle, never when the effect is built.
    (capture) => load.pipe(Effect.flatMap((result) => settle.pipe(
      Effect.map(() => ({ result, runs: [...capture.runs] as ReadonlyArray<string> })),
    ))),
    (capture) => Effect.sync(() => {
      const captures = registry.get(log);
      if (captures?.get(agentId) === capture) captures.delete(agentId);
    }),
  );
