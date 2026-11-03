import { randomUUID } from "node:crypto";
import * as Effect from "effect/Effect";

import type { LogWriteFailed } from "../log/EventLog.ts";
import { freshRequest, readHarnesses, refused, type Input, type Payload, type Plan, type Runtime } from "./internal.ts";

export const harnesses = (input: Input, payload: Payload<"harnesses">): Effect.Effect<Plan, ReturnType<typeof refused>> =>
  Effect.gen(function* () {
    switch (payload.operation) {
      case "list": return { events: [] };
      case "set": return { events: [{ _tag: "HarnessChanged", harness: payload.harness }] };
      // Fix round 1, N-1: the owner's way back to the defaults. A harness the
      // defaults do not name, such as one the owner added, is left as it is.
      case "reset": {
        const defaults = input.runtime.harnessDefaults;
        if (defaults === undefined) return yield* refused("harness defaults are unavailable");
        return { events: (yield* defaults).map((harness) => ({ _tag: "HarnessChanged" as const, harness })) };
      }
    }
  });

// Fix round 1, N-1: a service that finds no harness settings in its log loads
// the defaults, as the owner's own changes, in one batch. Settings that exist
// are never touched, so a start with settings changes nothing.
export const loadFirstDefaults = (runtime: Runtime): Effect.Effect<void, LogWriteFailed> => {
  const defaults = runtime.harnessDefaults;
  if (defaults === undefined) return Effect.void;
  return runtime.log.transact((append) => Effect.gen(function* () {
    if ((yield* readHarnesses(runtime)).length > 0) return;
    const harnesses = yield* defaults;
    if (harnesses.length === 0) return;
    yield* append({ _tag: "owner" }, freshRequest(), randomUUID(), harnesses.map((harness) => ({ _tag: "HarnessChanged" as const, harness })), {});
  })).pipe(Effect.catchTag("RequestIdReused", () => Effect.void));
};
