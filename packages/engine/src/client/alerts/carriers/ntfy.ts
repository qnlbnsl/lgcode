import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { carrierTokenReference } from "@lgcode/contracts";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import type { SecretStore } from "../../../commands/SecretStore.ts";
import { AlertSender, type AlertDestination, type AlertPayload } from "../AlertSender.ts";
import { carrierOrigin } from "../transport.ts";

// Protocol: ntfy publishing documentation, read 2026-11-04.
// Publish with X-Sequence-ID; DELETE /<topic>/<sequence_id> removes it.
const exchange = (url: URL, method: string, headers: Record<string, string>, body?: string) =>
  Effect.callback<void, string>((resume) => {
    let done = false;
    const finish = (effect: Effect.Effect<void, string>) => { if (!done) { done = true; resume(effect); } };
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, { method, headers }, (response) => {
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 64 * 1024) { finish(Effect.fail("carrier response too large")); response.destroy(); request.destroy(); }
      });
      response.once("error", () => finish(Effect.fail("carrier response failed")));
      response.once("aborted", () => finish(Effect.fail("carrier response failed")));
      response.once("end", () => finish(response.statusCode! >= 200 && response.statusCode! < 300
        ? Effect.void : Effect.fail("carrier refused request")));
    });
    request.once("error", () => finish(Effect.fail("carrier transport failed")));
    request.end(body);
    return Effect.sync(() => { request.destroy(); });
  });

export const makeNtfy = (secrets: SecretStore["Service"]): AlertSender["Service"] => {
  const send = (id: string, destination: AlertDestination, payload?: AlertPayload) => Effect.gen(function* () {
    const carrier = destination.carrier;
    if (carrier._tag === "none") return;
    if (carrierOrigin(carrier.server) !== carrier.server || !/^[-_A-Za-z0-9]{1,64}$/.test(carrier.topic)) return yield* Effect.fail("invalid carrier destination");
    const headers: Record<string, string> = {};
    if (destination.token !== undefined) {
      if (destination.token.origin !== carrier.server) return yield* Effect.fail("token origin mismatch");
      const token = yield* secrets.resolve(carrierTokenReference(destination.token.carrierGeneration));
      if (token === undefined) return yield* Effect.fail("token missing");
      headers.authorization = `Bearer ${Redacted.value(token)}`;
    }
    if (payload === undefined) return yield* exchange(new URL(`/${carrier.topic}/${encodeURIComponent(id)}`, carrier.server), "DELETE", headers);
    headers["content-type"] = "text/plain; charset=utf-8";
    headers["x-sequence-id"] = id;
    headers.title = payload.title;
    if (payload.link !== undefined) headers.click = payload.link;
    yield* exchange(new URL(`/${carrier.topic}`, carrier.server), "POST", headers,
      [`Kind: ${payload.kind}`, ...(payload.agentName === undefined ? [] : [`Agent: ${payload.agentName}`]),
        `Team: ${payload.team.join(", ")}`].join("\n"));
  });
  return AlertSender.of({ send: (payload, destination) => send(payload.alertId, destination, payload), clear: send });
};
