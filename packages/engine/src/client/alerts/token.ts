import { randomUUID } from "node:crypto";
import { carrierNames, carrierTokenReference, type CarrierName, type CarrierSettings } from "@lgtm/contracts";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { refused, type Input, type Snapshot } from "../../commands/internal.ts";
import { carrierOrigin } from "./transport.ts";
import { destinationState } from "./destinations.ts";
import { carriers, carrierDestinationOrigin } from "./carriers/index.ts";
import { clientView } from "./view.ts";

export const carrierKeep = (snapshot: Snapshot): readonly string[] => {
  const view = clientView(snapshot.client);
  return carrierNames.flatMap((name) => {
    const state = destinationState(view, name);
    return state.token && state.carrier._tag !== "none" && state.token.origin === carrierDestinationOrigin(state.carrier)
      ? [carrierTokenReference(state.token.carrierGeneration)] : [];
  });
};
export const carrierPlanners = {
  "client.alerts.carrier.enabled.set": ({ actor, snapshot }: Input, payload: Record<string, unknown>) => Effect.gen(function* () {
    if (actor._tag !== "owner") return yield* refused();
    const name = payload.name as CarrierName;
    if (destinationState(clientView(snapshot.client), name).carrier._tag === "none") return yield* refused("Configure this carrier first.");
    return { events: [{ _tag: "client.AlertCarrierEnabled" as const, name, enabled: payload.enabled as boolean }], reply: () => ({ requestId: payload.requestId }) };
  }),
  "client.alerts.carrier.set": ({ actor, snapshot }: Input, payload: Record<string, unknown>) => Effect.gen(function* () {
    if (actor._tag !== "owner") return yield* refused();
    let carrier = payload.carrier as CarrierSettings;
    if (carrier._tag !== "none") {
      const normalized = carriers[carrier._tag].normalize(carrier);
      if (!normalized) return yield* refused("invalid carrier destination");
      carrier = normalized;
    }
    const view = clientView(snapshot.client);
    if (carrier._tag !== "ntfy" && carrier._tag !== "none") {
      const name = carrier._tag;
      const previous = destinationState(view, name);
      return { events: [{ _tag: "client.AlertDestinationChanged" as const, name, carrier },
        ...(previous.token && previous.token.origin !== carrierDestinationOrigin(carrier) ? [{ _tag: "client.AlertDestinationTokenCleared" as const, name }] : [])],
        reply: () => ({ requestId: payload.requestId }) };
    }
    const clear = view.token !== undefined && (carrier._tag === "none" || carrier.server !== view.token.origin);
    return { events: [{ _tag: "client.AlertCarrierChanged" as const, carrier },
      ...(clear ? [{ _tag: "client.AlertCarrierTokenCleared" as const }] : [])],
      reply: () => ({ requestId: payload.requestId }) };
  }),
  "client.alerts.carrier.set-token": ({ actor, runtime, snapshot }: Input, payload: Record<string, unknown>) => Effect.gen(function* () {
    if (actor._tag !== "owner") return yield* refused();
    const name = (payload.name ?? "ntfy") as CarrierName;
    const carrier = destinationState(clientView(snapshot.client), name).carrier;
    const origin = name === "ntfy" ? carrierOrigin(payload.origin as string) : payload.origin as string;
    if (origin === undefined || carrier._tag !== name || origin !== carrierDestinationOrigin(carrier)) return yield* refused("carrier origin does not match");
    const carrierGeneration = randomUUID();
    yield* runtime.secrets.put(carrierTokenReference(carrierGeneration), payload.value as Redacted.Redacted<string>);
    return { events: [name === "ntfy" ? { _tag: "client.AlertCarrierTokenSet" as const, origin, carrierGeneration } : { _tag: "client.AlertDestinationTokenSet" as const, name, origin, carrierGeneration }],
      reply: () => ({ requestId: payload.requestId }) };
  }),
  "client.alerts.carrier.clear-token": ({ actor, snapshot }: Input, payload: Record<string, unknown>) => Effect.gen(function* () {
    if (actor._tag !== "owner") return yield* refused();
    const name = (payload.name ?? "ntfy") as CarrierName;
    return { events: destinationState(clientView(snapshot.client), name).token === undefined ? []
      : [name === "ntfy" ? { _tag: "client.AlertCarrierTokenCleared" as const } : { _tag: "client.AlertDestinationTokenCleared" as const, name }],
      reply: () => ({ requestId: payload.requestId }) };
  }),
};
