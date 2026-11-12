import type { AgentId } from "@lgtm/contracts";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type * as EventLog from "../../src/log/EventLog.ts";
import type { Runner } from "../../src/runner/Runner.ts";
import type * as Views from "../../src/views/Views.ts";

// Missing production seams load only in the tests that need them. This keeps
// an absent recovery/envelope module from preventing the handler tests in the
// same file from executing. No production stub or alternate implementation.
type Environment = EventLog.EventLog | Views.Views | SqlClient.SqlClient | Runner;
type WriteError = EventLog.LogWriteFailed | EventLog.RequestIdReused;
export interface DeliveriesModule {
  readonly dispatchQueued: (agentId: AgentId) => Effect.Effect<void, WriteError, Environment>;
}
export interface WaitsModule {
  readonly recheckWaits: () => Effect.Effect<void, WriteError, Environment>;
}
export interface EnvelopeModule {
  readonly envelope: (deliveryId: string, text: string) => string;
}
export const loadDeliveries = () => {
  const path: string = "../../src/routing/deliveries.ts";
  return Effect.promise(() => import(path) as Promise<DeliveriesModule>);
};
export const loadWaits = () => {
  const path: string = "../../src/routing/waits.ts";
  return Effect.promise(() => import(path) as Promise<WaitsModule>);
};
export const loadEnvelope = () => {
  const path: string = "../../src/routing/envelope.ts";
  return Effect.promise(() => import(path) as Promise<EnvelopeModule>);
};
