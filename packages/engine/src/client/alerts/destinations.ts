import { carrierNames, type CarrierSettings, type CarrierName } from "@lgtm/contracts";
import { type ClientView, type CarrierView } from "./view.ts";

// The original ntfy projection and events remain readable without a migration.
export const destinationState = (view: ClientView, name: CarrierName): CarrierView => name === "ntfy"
  ? { carrier: view.carrier, tokenSet: view.tokenSet, token: view.token, generation: view.generation,
    delivery: view.delivery, enabled: view.ntfyEnabled && view.carrier._tag !== "none" }
  : view.destinations[name] ?? { carrier: { _tag: "none" }, enabled: false, tokenSet: false, generation: 0, delivery: {} };
export const enabledDestinations = (view: ClientView) => carrierNames.map((name) => ({ name, ...destinationState(view, name) }))
  .filter((state) => state.enabled && state.carrier._tag !== "none");

// The sender address changes presentation. The remaining email fields select
// where an alert goes, so only those changes earn a new delivery generation.
export const sameDeliveryDestination = (left: CarrierSettings, right: CarrierSettings): boolean => {
  switch (left._tag) {
    case "none": return right._tag === "none";
    case "ntfy": return right._tag === "ntfy" && left.server === right.server && left.topic === right.topic;
    case "email": return right._tag === "email" && left.host === right.host && left.port === right.port
      && left.security === right.security && left.username === right.username && left.to === right.to;
  }
};
