import {
  alertPushDefaults, defaultWebSettings, type AlertKind, type CarrierSettings,
  type AlertDelivery, type ClientEvent, type Event, type EventSequence, type WebSettings,
} from "@sheprd/contracts";
import type { PieceView } from "../../pieces/viewTables.ts";

type Raised = Extract<ClientEvent, { _tag: "client.AlertRaised" }>;
export interface AlertRow extends Raised {
  readonly sequence: number;
  readonly status: "open" | "cleared";
  readonly clearedSequence?: number;
}
export interface ClientView {
  readonly position?: number;
  readonly alerts: Readonly<Record<string, AlertRow>>;
  readonly push: Readonly<Record<AlertKind, boolean>>;
  readonly carrier: CarrierSettings;
  readonly tokenSet: boolean;
  readonly generation: number;
  readonly token?: { readonly origin: string; readonly carrierGeneration: string } | undefined;
  readonly retiredTokens: readonly string[];
  readonly delivery: Readonly<Record<string, AlertDelivery & { readonly failureSequence?: number }>>;
  readonly webSettings: WebSettings;
  readonly webDown: boolean;
}
export const emptyClientView = (): ClientView => ({
  alerts: Object.create(null), push: { ...alertPushDefaults }, carrier: { _tag: "none" },
  tokenSet: false, generation: 0, retiredTokens: [], delivery: Object.create(null), webSettings: { ...defaultWebSettings }, webDown: false,
});
export const clientView = (value: unknown): ClientView => value as ClientView;
const reduce = (view: ClientView, event: Event, sequence: number): ClientView => {
  let next = view;
  switch (event._tag) {
    case "client.AlertBaseline":
      return { ...view, position: Math.max(view.position ?? 0, event.position) };
    case "client.AlertRaised":
      next = { ...view, alerts: { ...view.alerts, [event.alertId]: { ...event, sequence, status: "open" } } };
      break;
    case "client.AlertCleared": {
      const row = Object.hasOwn(view.alerts, event.alertId) ? view.alerts[event.alertId] : undefined;
      if (row?.status === "open") next = { ...view, alerts: { ...view.alerts,
        [event.alertId]: { ...row, status: "cleared", clearedSequence: sequence },
      } };
      break;
    }
    case "client.AlertSettingsChanged": return { ...view, push: { ...view.push, [event.kind]: event.push } };
    case "client.AlertCarrierChanged": return { ...view, carrier: event.carrier, generation: sequence, delivery: Object.create(null) };
    case "client.AlertCarrierTokenSet":
    case "client.AlertCarrierTokenCleared": {
      const delivery = Object.fromEntries(Object.entries(view.delivery).filter(([, mark]) => mark.status === "delivered")
        .map(([id, mark]) => [id, { ...mark, generation: sequence as EventSequence }]));
      return { ...view, generation: sequence, delivery, tokenSet: event._tag === "client.AlertCarrierTokenSet",
        token: event._tag === "client.AlertCarrierTokenSet" ? { origin: event.origin, carrierGeneration: event.carrierGeneration } : undefined,
        retiredTokens: view.token === undefined ? view.retiredTokens : [...view.retiredTokens, view.token.carrierGeneration] };
    }
    case "client.AlertDelivered":
    case "client.AlertDeliveryFailed":
      if (event.generation !== view.generation) return view;
      return { ...view, delivery: { ...view.delivery, [event.alertId]: {
        generation: event.generation, attempt: event.attempt,
        ...(event._tag === "client.AlertDeliveryFailed" ? {
          status: "failed", failureSequence: sequence, final: event.final === true,
          // Historical events allow arbitrary strings. Only fixed diagnostics
          // belong in owner reads, never raw carrier responses or credentials.
          reason: event.reason === "token missing" ? "token missing" : "carrier delivery failed",
        } : { status: "delivered" }),
      } } };
    case "client.WebSettingsChanged": return { ...view, webSettings: event.settings,
      webDown: event.settings.enabled && view.webDown };
    case "client.WebServerDown": return { ...view, webDown: true };
    case "client.WebServerUp": return { ...view, webDown: false };
  }
  // Planner dismissals have no source. Refusals belong to this reactor only.
  if (((event._tag === "client.AlertRaised" || event._tag === "client.AlertCleared")
    || (event._tag === "CommandRefused" && event.command === "client.reactor"))
    && event.sourceSequence !== undefined) {
    next = { ...next, position: Math.max(next.position ?? 0, event.sourceSequence) };
  }
  return next;
};
export const clientPieceView: PieceView = {
  empty: emptyClientView,
  reduce: (view, event, sequence) => reduce(clientView(view), event as Event, sequence),
};
