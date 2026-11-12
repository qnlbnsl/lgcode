import { createHash } from "node:crypto";
import { join } from "node:path";

import { EventSequence, RequestId, type Actor, type Event } from "@lgtm/contracts";
import * as SqliteClient from "@lgtm/t3-node-sqlite/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";

import * as EventLog from "../../src/log/EventLog.ts";
import { migrate } from "../../src/log/migrations.ts";
import * as Redactor from "../../src/log/Redactor.ts";
import * as Views from "../../src/views/Views.ts";
import { owner } from "./viewFixtures.ts";

export const sequence = Schema.decodeUnknownSync(EventSequence);
export type LiveViews = Context.Service.Shape<typeof Views.Views>;

export const append = (name: string, events: ReadonlyArray<Event>, caller: Actor = owner) => Effect.gen(function* () {
  const log = yield* EventLog.EventLog;
  return yield* log.append(caller, Schema.decodeUnknownSync(RequestId)(name),
    createHash("sha256").update(JSON.stringify(events)).digest("hex"), events, {});
});

export const withViews = <A, E>(
  home: string,
  program: Effect.Effect<A, E, EventLog.EventLog | Views.Views | SqlClient.SqlClient | Scope.Scope>,
  options: {
    readonly replace?: (real: LiveViews) => LiveViews;
  } = {},
) => {
  // Replace the service at the same seam EventLog consumes. The deliberate
  // event-dropping test retains the real reducer and the real durable writer.
  const live = options.replace === undefined ? Views.layer : Layer.effect(Views.Views,
    Effect.gen(function* () {
      const real = yield* Views.Views;
      return options.replace!(real);
    }),
  ).pipe(Layer.provide(Views.layer));
  const services = EventLog.layer.pipe(Layer.provideMerge(live), Layer.provide(Redactor.layer));
  return Effect.gen(function* () {
    yield* migrate;
    // Views starts before EventLog in this layer graph. Enable WAL before
    // its first rebuild so the reader pool does not fall back permanently.
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA journal_mode = WAL`;
    return yield* Effect.scoped(program).pipe(Effect.provide(services));
  }).pipe(
    Effect.provide(SqliteClient.layer({ filename: join(home, "events.sqlite"), readerWorker: true })),
    Effect.scoped,
  );
};
