import {
  defaultQuietHours, type QuietHours, type CarrierName, alertPushDefaults, defaultWebSettings, type AlertKind, type CarrierSettings,
  type AlertDelivery, type ClientEvent, type Event, type EventSequence, type WebSettings,
} from "@lgtm/contracts";
import { sameDeliveryDestination } from "./destinations.ts";
import type { PieceView } from "../../pieces/viewTables.ts";

type Raised = Extract<ClientEvent, { _tag: "client.AlertRaised" }>;
export interface AlertRow extends Raised {
  readonly sequence: number;
  readonly status: "open" | "cleared";
  readonly clearedSequence?: number;
}
export interface CarrierView {
  readonly carrier: CarrierSettings;
  readonly enabled: boolean;
  readonly tokenSet: boolean;
  readonly token?: { readonly origin: string; readonly carrierGeneration: string } | undefined;
  readonly generation: number;
  readonly delivery: ClientView["delivery"];
}
export interface ClientView {
  readonly destinations: Readonly<Partial<Record<CarrierName, CarrierView>>>;
  readonly ntfyEnabled: boolean;
  readonly quiet: QuietHours;
  readonly position?: number;
  readonly alerts: Readonly<Record<string, AlertRow>>;
  readonly push: Readonly<Record<AlertKind, boolean>>;
  readonly carrier: CarrierSettings;
  readonly tokenSet: boolean;
  readonly generation: number;
  readonly token?: { readonly origin: string; readonly carrierGeneration: string } | undefined;
  readonly retiredTokens: readonly string[];
  readonly delivery: Readonly<Record<string, AlertDelivery & { readonly sequence: number; readonly failureSequence?: number }>>;
  readonly webSettings: WebSettings;
  readonly webDown: boolean;
  readonly pushPromptDismissed: boolean;
}
export const emptyClientView = (): ClientView => ({
  destinations: {}, ntfyEnabled: true, quiet: { ...defaultQuietHours },
  alerts: Object.create(null), push: { ...alertPushDefaults }, carrier: { _tag: "none" },
  pushPromptDismissed: false, tokenSet: false, generation: 0, retiredTokens: [], delivery: Object.create(null), webSettings: { ...defaultWebSettings }, webDown: false,
});
export const clientView = (value: unknown): ClientView => value as ClientView;
const reduce = (view: ClientView, event: Event, sequence: number): ClientView => {
  let next = view;
  switch (event._tag) {
    case "client.AlertQuietChanged": return { ...view, quiet: event.quiet };
    case "client.AlertCarrierEnabled": {
      if (event.name === "ntfy") return { ...view, ntfyEnabled: event.enabled };
      const state = view.destinations[event.name];
      return state ? { ...view, destinations: { ...view.destinations, [event.name]: { ...state, enabled: event.enabled } } } : view;
    }
    case "client.AlertDestinationChanged": {
      const previous = view.destinations[event.name];
      if (event.carrier._tag === "none") {
        const { [event.name]: _removed, ...destinations } = view.destinations;
        return { ...view, destinations, retiredTokens: previous?.token
          ? [...view.retiredTokens, previous.token.carrierGeneration] : view.retiredTokens };
      }
      const same = previous !== undefined && sameDeliveryDestination(previous.carrier, event.carrier);
      return { ...view, destinations: { ...view.destinations, [event.name]: {
        // Old destination events implied activation. New configuration plans
        // explicitly disable a fresh carrier until its password is installed.
        carrier: event.carrier, enabled: previous?.enabled ?? true, tokenSet: previous?.tokenSet ?? false, token: previous?.token,
        generation: same ? previous.generation : sequence, delivery: same ? previous.delivery : {},
      } } };
    }
    case "client.AlertDestinationTokenSet":
    case "client.AlertDestinationTokenCleared": {
      const state = view.destinations[event.name]; if (!state) return view;
      const token = event._tag === "client.AlertDestinationTokenSet" ? { origin: event.origin, carrierGeneration: event.carrierGeneration } : undefined;
      return { ...view, retiredTokens: state.token ? [...view.retiredTokens, state.token.carrierGeneration] : view.retiredTokens,
        destinations: { ...view.destinations, [event.name]: { ...state, enabled: token === undefined ? false : state.enabled, token, tokenSet: token !== undefined, generation: sequence,
          delivery: Object.fromEntries(Object.entries(state.delivery).filter(([, mark]) => mark.status === "delivered").map(([id, mark]) => [id, { ...mark, generation: sequence }])) } } };
    }
    case "client.AlertPromptDismissed": return { ...view, pushPromptDismissed: true };
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
    case "client.AlertCarrierChanged": {
      const same = sameDeliveryDestination(view.carrier, event.carrier);
      return { ...view, carrier: event.carrier, generation: same ? view.generation : sequence,
        delivery: same ? view.delivery : Object.create(null) };
    }
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
      if (event.carrier !== "ntfy") {
        const state = view.destinations[event.carrier]; if (!state || state.generation !== event.generation) return view;
        const mark: ClientView["delivery"][string] = event._tag === "client.AlertDelivered" ? { status: "delivered" as const, sequence, generation: event.generation, attempt: event.attempt }
          : { status: "failed" as const, sequence, failureSequence: sequence, generation: event.generation, attempt: event.attempt,
            reason: event.reason === "token missing" || event.reason === "service missing" ? event.reason : "carrier delivery failed" as const, final: event.final === true };
        return { ...view, destinations: { ...view.destinations, [event.carrier]: { ...state, delivery: { ...state.delivery, [event.alertId]: mark } } } };
      }
      if (event.generation !== view.generation) return view;
      return { ...view, delivery: { ...view.delivery, [event.alertId]: {
        sequence, generation: event.generation, attempt: event.attempt,
        ...(event._tag === "client.AlertDeliveryFailed" ? {
          status: "failed", failureSequence: sequence, final: event.final === true,
          // Historical events allow arbitrary strings. Only fixed diagnostics
          // belong in owner reads, never raw carrier responses or credentials.
          reason: event.reason === "token missing" || event.reason === "service missing" ? event.reason : "carrier delivery failed",
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
