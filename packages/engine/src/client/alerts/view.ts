import {
  alertPushDefaults, defaultWebSettings, type AlertKind, type CarrierSettings,
  type ClientEvent, type Event, type WebSettings,
} from "@shephrd/contracts";
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
  readonly webSettings: WebSettings;
  readonly webDown: boolean;
}
export const emptyClientView = (): ClientView => ({
  alerts: Object.create(null), push: { ...alertPushDefaults }, carrier: { _tag: "none" },
  tokenSet: false, webSettings: { ...defaultWebSettings }, webDown: false,
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
    case "client.AlertCarrierChanged": return { ...view, carrier: event.carrier };
    case "client.AlertCarrierTokenSet": return { ...view, tokenSet: true };
    case "client.AlertCarrierTokenCleared": return { ...view, tokenSet: false };
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
