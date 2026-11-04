import { randomUUID } from "node:crypto";
import { carrierTokenReference, type CarrierSettings } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { refused, type Input, type Snapshot } from "../../commands/internal.ts";
import { carrierOrigin } from "./transport.ts";
import { clientView } from "./view.ts";

export const carrierKeep = (snapshot: Snapshot): readonly string[] => {
  const view = clientView(snapshot.client);
  return view.carrier._tag === "ntfy" && view.token?.origin === view.carrier.server
    ? [carrierTokenReference(view.token.carrierGeneration)] : [];
};
export const carrierPlanners = {
  "client.alerts.carrier.set": ({ actor, snapshot }: Input, payload: Record<string, unknown>) => Effect.gen(function* () {
    if (actor._tag !== "owner") return yield* refused();
    let carrier = payload.carrier as CarrierSettings;
    if (carrier._tag === "ntfy") {
      const server = carrierOrigin(carrier.server);
      if (server === undefined || !/^[-_A-Za-z0-9]{1,64}$/.test(carrier.topic)) return yield* refused("invalid carrier destination");
      carrier = { ...carrier, server };
    }
    const view = clientView(snapshot.client);
    const clear = view.token !== undefined && (carrier._tag === "none" || carrier.server !== view.token.origin);
    return { events: [{ _tag: "client.AlertCarrierChanged" as const, carrier },
      ...(clear ? [{ _tag: "client.AlertCarrierTokenCleared" as const }] : [])],
      reply: () => ({ requestId: payload.requestId }) };
  }),
  "client.alerts.carrier.set-token": ({ actor, runtime, snapshot }: Input, payload: Record<string, unknown>) => Effect.gen(function* () {
    if (actor._tag !== "owner") return yield* refused();
    const carrier = clientView(snapshot.client).carrier;
    const origin = carrierOrigin(payload.origin as string);
    if (carrier._tag !== "ntfy" || origin !== carrier.server) return yield* refused("carrier origin does not match");
    const carrierGeneration = randomUUID();
    yield* runtime.secrets.put(carrierTokenReference(carrierGeneration), payload.value as Redacted.Redacted<string>);
    return { events: [{ _tag: "client.AlertCarrierTokenSet" as const, origin, carrierGeneration }],
      reply: () => ({ requestId: payload.requestId }) };
  }),
  "client.alerts.carrier.clear-token": ({ actor, snapshot }: Input, payload: Record<string, unknown>) =>
    actor._tag !== "owner" ? Effect.fail(refused()) : Effect.succeed({
      events: clientView(snapshot.client).token === undefined ? [] : [{ _tag: "client.AlertCarrierTokenCleared" as const }],
      reply: () => ({ requestId: payload.requestId }),
    }),
};
