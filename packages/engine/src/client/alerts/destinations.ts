import { carrierNames, type CarrierName } from "@lgtm/contracts";
import { type ClientView, type CarrierView } from "./view.ts";

// The original ntfy projection and events remain readable without a migration.
export const destinationState = (view: ClientView, name: CarrierName): CarrierView => name === "ntfy"
  ? { carrier: view.carrier, tokenSet: view.tokenSet, token: view.token, generation: view.generation,
    delivery: view.delivery, enabled: view.ntfyEnabled && view.carrier._tag !== "none" }
  : view.destinations[name] ?? { carrier: { _tag: "none" }, enabled: false, tokenSet: false, generation: 0, delivery: {} };
export const enabledDestinations = (view: ClientView) => carrierNames.map((name) => ({ name, ...destinationState(view, name) }))
  .filter((state) => state.enabled && state.carrier._tag !== "none");
