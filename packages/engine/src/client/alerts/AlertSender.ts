import type { AlertKind, CarrierSettings } from "@sheprd/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export interface AlertPayload {
  readonly alertId: string;
  readonly kind: AlertKind;
  readonly agentName?: string;
  readonly team: readonly string[];
  readonly title: string;
  readonly link?: string;
}
// Captured from one snapshot before a send. Credentials remain in the store.
export interface AlertDestination {
  readonly carrier: CarrierSettings;
  readonly token?: { readonly origin: string; readonly carrierGeneration: string };
}
export class AlertSender extends Context.Service<AlertSender, {
  readonly send: (payload: AlertPayload, destination: AlertDestination) => Effect.Effect<void, unknown>;
  readonly clear: (alertId: string, destination: AlertDestination) => Effect.Effect<void, unknown>;
}>()("sheprd/client/AlertSender") {}
