import { randomUUID } from "node:crypto";
import { type Event, type EventSequence, type RequestId } from "@lgtm/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { AlertSender } from "../client/alerts/AlertSender.ts";
import { makeNtfy } from "../client/alerts/carriers/ntfy.ts";
import { withNotificationLane } from "../client/alerts/lanes.ts";
import { alertPayload, sendNotification } from "../client/alerts/send.ts";
import { clientView } from "../client/alerts/view.ts";
import { sha256Hex } from "../identity/credential.ts";
import { LogWriteFailed } from "../log/EventLog.ts";
import { checkPieceBatch } from "./pieceBatch.ts";
import { refused, type Input, type Runtime } from "./internal.ts";

const testPayload = () => ({ alertId: `test-${randomUUID()}`, kind: "other" as const,
  title: "LGTM Studio test notification", team: [] });

// Test notifications have no alert, log event, or receipt. The reply describes
// the actual transport result, with no provider response body or credentials.
export function testNotification(input: Input, payload: Record<string, unknown>) {
  return Effect.gen(function* () {
    if (input.actor._tag !== "owner") return yield* refused();
    const state = clientView((yield* input.runtime.views.snapshot).client);
    const result = yield* sendNotification(makeNtfy(input.runtime.secrets), testPayload(), {
      carrier: state.carrier, ...(state.token === undefined ? {} : { token: state.token }),
    }).pipe(Effect.result);
    return { reply: { requestId: payload.requestId, accepted: result._tag === "Success",
      ...(result._tag === "Failure" ? { reason: result.failure } : {}) } };
  });
}

const deliverRetry = (runtime: Runtime, payload: Record<string, unknown>, bodyHash: string, sender: AlertSender["Service"]) => {
  const { sql, log, views } = runtime;
  const requestId = payload.requestId as RequestId;
  const alertId = payload.alertId as string;
  const generation = payload.generation as EventSequence;
  // A request lane protects receipts; the delivery lane also excludes the
  // automatic worker. Both are acquired outside the writer transaction.
  return withNotificationLane(sql, `request:${requestId}`)(
    withNotificationLane(sql, `${generation}:${alertId}`)(Effect.gen(function* () {
      // The short preflight also observes the writer's latched failure before
      // attempting a network side effect. The network never holds the writer.
      const prepared = yield* log.transact(() => Effect.gen(function* () {
        const receipts = yield* sql<{ body_hash: string; result_json: string }>`
          SELECT body_hash, result_json FROM receipts WHERE caller = 'owner' AND request_id = ${requestId}`;
        if (receipts[0] !== undefined) {
          if (receipts[0].body_hash !== bodyHash) return yield* refused("request id reused");
          const reply = yield* Effect.try({
            try: () => {
              const stored = JSON.parse(receipts[0]!.result_json);
              return Schema.decodeUnknownSync(Schema.toType(runtime.lists!.commands.requests.get("client.alerts.retry")!.successSchema))(stored.reply) as Record<string, unknown>;
            }, catch: () => new LogWriteFailed({ reason: "stored receipt is unreadable" }),
          });
          return { _tag: "receipt" as const, reply };
        }
        const current = yield* views.snapshot; const state = clientView(current.client);
        const alert = Object.hasOwn(state.alerts, alertId) ? state.alerts[alertId] : undefined;
        const mark = state.delivery[alertId];
        if (alert?.status !== "open" || state.generation !== generation || mark?.generation !== generation
          || mark.status !== "failed" || mark.attempt !== payload.attempt) return yield* refused("notification changed; refresh before retrying");
        return { _tag: "send" as const, current, state, alert, mark };
      }));
      if (prepared._tag === "receipt") return prepared.reply;
      const { current, state, alert, mark } = prepared;
      const attempt = mark.attempt + 1;
      const outcome = yield* sendNotification(sender, alertPayload(alert, current), {
        carrier: state.carrier, ...(state.token === undefined ? {} : { token: state.token }),
      }).pipe(Effect.result);
      const base = { alertId: alert.alertId, generation, attempt, carrier: "ntfy" as const };
      const event: Event = outcome._tag === "Success" ? { _tag: "client.AlertDelivered", ...base }
        : { _tag: "client.AlertDeliveryFailed", ...base, reason: outcome.failure, ...(attempt >= 5 ? { final: true } : {}) };
      const reply = { requestId, accepted: outcome._tag === "Success", ...(outcome._tag === "Failure" ? { reason: outcome.failure } : {}) };
      // Record the destination actually attempted, as the background worker
      // does. The reducer ignores an old generation if settings changed in flight,
      // and recording the result never reopens a cleared or dismissed alert.
      const changed = yield* log.transact((append) => Effect.gen(function* () {
        const current = yield* views.snapshot;
        const changed = clientView(current.client).generation !== generation;
        const events = yield* checkPieceBatch("client", current, { events: [event] }, { _tag: "owner" }, runtime.lists!);
        // Keep the actual old-destination attempt in history. A changed
        // destination earns no success receipt, and the old generation can
        // never become current again, so a repeated request cannot resend it.
        yield* append({ _tag: "owner" }, requestId, bodyHash, events, {}, changed ? false : () => reply);
        return changed;
      }));
      if (changed) return yield* refused("notification changed; refresh before retrying");
      return reply;
    })),
  );
};

// This action owns its short validation and result transactions so the carrier
// exchange stays outside the writer. Installing it in the read table also
// avoids an outer receipt or a nested writer transaction at the API boundary.
export function retryNotification(input: Input, payload: Record<string, unknown>) {
  return Effect.gen(function* () {
    if (input.actor._tag !== "owner") return yield* refused();
    if ((yield* input.runtime.log.redactText(payload.requestId as string)) !== payload.requestId) return yield* refused();
    // Explicit contract fields in canonical key order match ordinary command
    // hashing, and a token or extra caller field never enters the receipt hash.
    const bodyHash = sha256Hex(JSON.stringify({ command: "client.alerts.retry", payload: {
      alertId: payload.alertId, attempt: payload.attempt, generation: payload.generation,
    } }));
    const reply = yield* deliverRetry(input.runtime, payload, bodyHash, makeNtfy(input.runtime.secrets)).pipe(
      Effect.catchTag("RequestIdReused", () => Effect.fail(refused("request id reused"))),
    );
    return { reply };
  });
}
