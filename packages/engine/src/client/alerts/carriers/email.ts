import nodemailer from "nodemailer";
import { carrierTokenReference, type CarrierSettings } from "@lgtm/contracts";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import type { SecretStore } from "../../../commands/SecretStore.ts";
import type { AlertSender } from "../AlertSender.ts";

export const emailOrigin = (carrier: Extract<CarrierSettings, { _tag: "email" }>) =>
  JSON.stringify([carrier.host, carrier.port, carrier.security, carrier.username]);
export const validEmail = (carrier: Extract<CarrierSettings, { _tag: "email" }>) =>
  /^[A-Za-z0-9.-]+$/.test(carrier.host) && !/[\r\n\x00]/.test(carrier.username)
  && /^[^\s<>@,;]+@[^\s<>@,;]+$/.test(carrier.from) && /^[^\s<>@,;]+@[^\s<>@,;]+$/.test(carrier.to)
  && (carrier.security !== "plain" || carrier.host === "127.0.0.1");

// Nodemailer owns SMTP, MIME encoding, authentication and TLS. No remote presets,
// file attachments, URL content, debug output or maker-operated relay are used.
export const makeEmail = (secrets: SecretStore["Service"]): AlertSender["Service"] => ({
  send: (payload, destination) => Effect.gen(function* () {
    const carrier = destination.carrier;
    if (carrier._tag !== "email" || !validEmail(carrier)) return yield* Effect.fail("invalid carrier destination");
    if (!destination.token || destination.token.origin !== emailOrigin(carrier)) return yield* Effect.fail("token missing");
    const secret = yield* secrets.resolve(carrierTokenReference(destination.token.carrierGeneration));
    if (!secret) return yield* Effect.fail("token missing");
    yield* Effect.callback<void, string>((resume, signal) => {
      const transport = nodemailer.createTransport({ host: carrier.host, port: carrier.port,
        secure: carrier.security === "tls", requireTLS: carrier.security === "starttls", ignoreTLS: carrier.security === "plain",
        auth: { user: carrier.username, pass: Redacted.value(secret) },
        connectionTimeout: 8_000, greetingTimeout: 8_000, socketTimeout: 8_000,
        logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
      });
      transport.sendMail({ signal, from: carrier.from, to: carrier.to, subject: payload.title,
        text: [`Kind: ${payload.kind}`, ...(payload.agentName ? [`Agent: ${payload.agentName}`] : []),
          `Team: ${payload.team.join(", ")}`, ...(payload.link ? [payload.link] : [])].join("\n") }, (error, info) => {
        // Acceptance means the owner's SMTP server accepted the recipient. It
        // cannot prove final mailbox delivery, and raw server text stays private.
        resume(error || !info.accepted?.length ? Effect.fail("carrier delivery failed") : Effect.void);
      });
      return Effect.sync(() => transport.close());
    });
  }),
  clear: () => Effect.void,
});

export const emailCarrier: import("./index.ts").CarrierDefinition = {
  make: makeEmail,
  normalize: (settings) => settings._tag === "email" && validEmail(settings) ? settings : undefined,
  origin: (settings) => settings._tag === "email" ? emailOrigin(settings) : undefined,
};
