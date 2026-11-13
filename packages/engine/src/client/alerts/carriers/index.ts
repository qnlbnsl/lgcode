import type { CarrierName, CarrierSettings } from "@lgtm/contracts";
import * as Effect from "effect/Effect";
import type { SecretStore } from "../../../commands/SecretStore.ts";
import type { AlertSender } from "../AlertSender.ts";
import { ntfyCarrier } from "./ntfy.ts";
import { emailCarrier } from "./email.ts";

export interface CarrierDefinition {
  readonly make: (secrets: SecretStore["Service"]) => AlertSender["Service"];
  readonly normalize: (settings: CarrierSettings) => CarrierSettings | undefined;
  readonly origin: (settings: CarrierSettings) => string | undefined;
}
// Adding a transport requires one implementation and one entry in this list.
// Its public settings schema also belongs in the shared client contracts.
export const carriers: Record<CarrierName, CarrierDefinition> = {
  ntfy: ntfyCarrier,
  email: emailCarrier,
};
export const carrierDestinationOrigin = (settings: CarrierSettings) => settings._tag === "none" ? undefined : carriers[settings._tag].origin(settings);
export const makeCarriers = (secrets: SecretStore["Service"]): AlertSender["Service"] => {
  const transports = Object.fromEntries(Object.entries(carriers).map(([name, definition]) => [name, definition.make(secrets)]));
  return {
    send: (payload, destination) => transports[destination.carrier._tag]?.send(payload, destination) ?? Effect.fail("service missing"),
    clear: (id, destination) => transports[destination.carrier._tag]?.clear(id, destination) ?? Effect.void,
  };
};
