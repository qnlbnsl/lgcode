import { randomUUID } from "node:crypto";
import {
  CommandsRpcGroup, Event as EventSchema, RequestId,
  type Caller, type Event, type EventEnvelope, type HarnessSettings,
} from "@lgcode/contracts";
import type * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/sql/SqlClient";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";

import type { EngineLists } from "../pieces/lists.ts";
import { LogWriteFailed, type EventLog, type SideRows } from "../log/EventLog.ts";
import type { Runner } from "../runner/Runner.ts";
import type { Views } from "../views/Views.ts";
import type { SecretStore } from "./SecretStore.ts";

export type Payload<N extends string> = Rpc.Payload<Extract<RpcGroup.Rpcs<typeof CommandsRpcGroup>, { readonly _tag: N }>>;
export type Snapshot = Effect.Success<Context.Service.Shape<typeof Views>["snapshot"]>;
export type Agent = Snapshot["agents"][string];

export class CommandRefused extends Data.TaggedError("CommandRefused")<{ readonly reason: string }> {}
export const refused = (reason = "command refused") => new CommandRefused({ reason });

export interface Runtime {
  readonly lists?: EngineLists;
  readonly sql: SqlClient.SqlClient;
  readonly log: Context.Service.Shape<typeof EventLog>;
  readonly runner: Context.Service.Shape<typeof Runner>;
  readonly secrets: Context.Service.Shape<typeof SecretStore>;
  readonly views: Context.Service.Shape<typeof Views>;
  readonly home: string;
  readonly stateFolder: string;
  readonly pluginRoot: string;
  // The harness defaults of this installation, when the service has them.
  readonly harnessDefaults?: Effect.Effect<ReadonlyArray<HarnessSettings>>;
}
export interface Input {
  readonly runtime: Runtime;
  readonly actor: Caller;
  readonly snapshot: Snapshot;
}
export interface Plan {
  readonly events: ReadonlyArray<Event>;
  readonly deliveries?: ReadonlyArray<import("../routing/pieceDelivery.ts").DeliveryRequest>;
  readonly sideRows?: SideRows;
  readonly reply?: (batch: ReadonlyArray<EventEnvelope>) => Record<string, unknown>;
  // Runs after the commit. A blocking command returns its final reply here.
  readonly afterCommit?: Effect.Effect<void | Record<string, unknown>, LogWriteFailed>;
}

// Piece planners cannot run engine hooks or omit their committed-batch reply.
export type PiecePlan = Omit<Plan, "afterCommit" | "reply"> & {
  readonly reply: (batch: ReadonlyArray<EventEnvelope>) => Record<string, unknown>;
  readonly afterCommit?: never;
};

export type Planner = (input: Input, payload: Record<string, unknown>) => Effect.Effect<Plan, CommandRefused | LogWriteFailed>;
export type PiecePlanner = (input: Input, payload: Record<string, unknown>) => Effect.Effect<PiecePlan, CommandRefused | LogWriteFailed>;
export type PlannerTable = Readonly<Record<string, Planner> & Record<`${import("@lgcode/contracts").PieceNamespace}.${string}`, PiecePlanner>>;

export const freshRequest = () => Schema.decodeUnknownSync(RequestId)(randomUUID());
export const readHarnesses = (runtime: Runtime): Effect.Effect<ReadonlyArray<HarnessSettings>, LogWriteFailed> =>
  Effect.gen(function* () {
    const rows = yield* runtime.sql<{ payload_json: string }>`
      SELECT payload_json FROM events WHERE event_type = 'HarnessChanged' ORDER BY sequence`;
    return yield* Effect.try({
      try: () => {
        const settings = new Map<string, HarnessSettings>();
        for (const row of rows) {
          const event = Schema.decodeUnknownSync(EventSchema)(JSON.parse(row.payload_json));
          if (event._tag === "HarnessChanged") settings.set(event.harness.id, event.harness);
        }
        return [...settings.values()];
      },
      catch: () => new LogWriteFailed({ reason: "stored harness settings are unreadable" }),
    });
  }).pipe(Effect.catchTag("SqlError", () => Effect.fail(new LogWriteFailed({ reason: "database read failed" }))));
