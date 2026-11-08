import type { EventEnvelope, EventSequence } from "@lgcode/contracts";
import { EventSequence as EventSequenceSchema } from "@lgcode/contracts";
import * as SqliteClient from "@lgcode/t3-node-sqlite/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { LogReadFailed } from "../log/subscribe.ts";
import { engineLists, type EngineLists } from "../pieces/lists.ts";
import { applyWith, emptyViews } from "./apply.ts";
import { rebuild } from "./rebuild.ts";

// The live views: the state of every agent, thread, request, question, wait,
// delivery and account, kept in memory and updated by the event
// writer after each COMMIT. `applyCommitted` has no error channel: `apply` is
// pure, so a defect in it is a defect and never a failed append.
export class Views extends Context.Service<
  Views,
  {
    readonly lists?: EngineLists;
    readonly snapshot: Effect.Effect<ReturnType<typeof emptyViews>>;
    readonly applyCommitted: (batch: ReadonlyArray<EventEnvelope>) => Effect.Effect<void>;
  }
>()("lgcode/engine/views/Views") {}

const decodeSequence = Schema.decodeUnknownSync(EventSequenceSchema);

// Loads the live views from the stored log, so a restart sees what was
// committed before it. Build this layer before `EventLog.layer` and before
// any writer opens: the writer then finds the log already read.
export const makeLayer = (lists: EngineLists = engineLists): Layer.Layer<Views, LogReadFailed, SqlClient.SqlClient> => Layer.effect(Views, Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Issue 45: the copied client's reader pool turns itself off for good if
  // its first reader opens a file that is not yet in WAL mode, so WAL comes
  // before the first rebuild. Setting it again on a WAL file changes nothing.
  yield* sql`PRAGMA journal_mode = WAL`;
  const rows = yield* SqliteClient.readOnly(sql<{ head: number }>`
    SELECT COALESCE(MAX(sequence), 0) AS head FROM events`);
  const head: EventSequence = decodeSequence(rows[0]!.head);
  const state = yield* Ref.make(yield* rebuild(head, lists));
  return Views.of({
    lists,
    snapshot: Ref.get(state),
    applyCommitted: (batch) => Ref.update(state, (current) => batch.reduce((state, envelope) => applyWith(state, envelope, lists.views), current)),
  });
}).pipe(Effect.mapError((error) => error._tag === "SqlError"
  ? new LogReadFailed({ reason: "database read failed" })
  : error)));

export const layer = Layer.unwrap(Effect.sync(() => makeLayer()));
