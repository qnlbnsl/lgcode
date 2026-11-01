import type { EventSequence } from "@shepherd/contracts";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";

import * as EventLog from "../log/EventLog.ts";
import type { LogReadFailed } from "../log/subscribe.ts";
import { rebuild } from "./rebuild.ts";
import * as Views from "./Views.ts";

interface Difference {
  readonly path: ReadonlyArray<string>;
  readonly live: unknown;
  readonly rebuilt: unknown;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

// Every place the two values differ, as the path to it and both values. An
// absent key and an `undefined` value are the same; arrays are compared by
// index, so a missing last item is one difference.
const diff = (live: unknown, rebuilt: unknown, path: ReadonlyArray<string>, out: Array<Difference>): void => {
  if (Object.is(live, rebuilt)) return;
  if (isRecord(live) && isRecord(rebuilt) && Array.isArray(live) === Array.isArray(rebuilt)) {
    const keys = new Set([...Object.keys(live), ...Object.keys(rebuilt)]);
    for (const key of keys) diff(live[key], rebuilt[key], [...path, key], out);
    return;
  }
  out.push({ path, live, rebuilt });
};

// Row 62: the live views are copied at head N while the writer's permit is
// held, so no committed batch is half-applied in the copy. The permit is
// released before the rebuild, which reads rows 1 through N on a read
// connection; those rows never change, so appends beyond N cannot move it.
// If the live views are not at N, the sequences themselves differ.
export const compareViews = (N: EventSequence): Effect.Effect<
  { readonly sequence: EventSequence; readonly differences: ReadonlyArray<Difference> },
  LogReadFailed,
  EventLog.EventLog | Views.Views | SqlClient.SqlClient
> => Effect.gen(function* () {
  const log = yield* EventLog.EventLog;
  const views = yield* Views.Views;
  const live = yield* log.withWriterPermit(views.snapshot);
  const rebuilt = yield* rebuild(N);
  const differences: Array<Difference> = [];
  diff(live, rebuilt, [], differences);
  return { sequence: N, differences };
});
