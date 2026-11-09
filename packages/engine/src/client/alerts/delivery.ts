import { type Event, type EventSequence } from "@lgcode/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import type * as Scope from "effect/Scope";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { SecretStore } from "../../commands/SecretStore.ts";
import { writePieceBatch } from "../../commands/pieceBatch.ts";
import { subscribe } from "../../log/subscribe.ts";
import { Views } from "../../views/Views.ts";
import { AlertSender } from "./AlertSender.ts";
import { alertPayload } from "./send.ts";
import { withNotificationLane } from "./lanes.ts";
import { clientView, type AlertRow, type ClientView } from "./view.ts";

const pending = (view: ClientView, row: AlertRow): boolean => row.status === "open" && !row.baseline
  && view.push[row.kind] && view.carrier._tag !== "none" && view.delivery[row.alertId]?.status !== "delivered";
const retryDelay = (attempt: number) => [5_000, 30_000, 120_000, 600_000][Math.min(attempt - 1, 3)]!;

export const alertDelivery = Effect.scoped(Effect.gen(function* () {
  const views = yield* Views; const sender = yield* AlertSender;
  const sql = yield* SqlClient.SqlClient; const secrets = yield* SecretStore;
  const lists = views.lists!;
  const stopped = yield* Deferred.make<never, unknown>();
  const active = new Set<string>(); const removed = new Set<string>();
  const initial = yield* views.snapshot;
  const reconcile = (): Effect.Effect<void, unknown, Effect.Services<ReturnType<typeof writePieceBatch>> | Scope.Scope> => Effect.gen(function* () {
    const snapshot = yield* views.snapshot; const view = clientView(snapshot.client);
    for (const generation of view.retiredTokens) {
      if (removed.has(generation)) continue;
      yield* (secrets.removeCarrierValue?.(generation) ?? Effect.void); removed.add(generation);
    }
    for (const row of Object.values(view.alerts)) {
      const key = `${view.generation}:${row.alertId}`;
      if (!pending(view, row) || active.has(key)) continue;
      active.add(key);
      const generation = view.generation;
      const work = Effect.gen(function* () {
        const ready = yield* Effect.gen(function* () {
          while (true) {
            // Cleanup can suspend a scan before it claims this key. Read the
            // failure under the key, then recheck it after every wait or read.
            const snapshot = yield* views.snapshot; const view = clientView(snapshot.client);
            const rowNow = view.alerts[row.alertId];
            if (view.generation !== generation || rowNow === undefined || !pending(view, rowNow)) return;
            const mark = view.delivery[row.alertId];
            if (mark?.failureSequence !== undefined) {
              const times = yield* sql<{ occurred_at: number }>`SELECT occurred_at FROM events WHERE sequence = ${mark.failureSequence}`;
              const remaining = times[0]!.occurred_at + retryDelay(mark.attempt) - (yield* Clock.currentTimeMillis);
              if (remaining > 0) { yield* Effect.sleep(remaining); continue; }
            }
            const current = yield* views.snapshot; const state = clientView(current.client);
            const alert = state.alerts[row.alertId];
            if (state.generation !== generation || alert === undefined || !pending(state, alert)) return;
            if (state.delivery[row.alertId]?.failureSequence !== mark?.failureSequence) continue;
            return { current, state, alert };
          }
        });
        if (ready === undefined) return;
        yield* withNotificationLane(sql, `${generation}:${row.alertId}`)(Effect.gen(function* () {
          // A manual retry may have completed while this worker waited for its lane.
          const current = yield* views.snapshot; const state = clientView(current.client);
          const alert = state.alerts[row.alertId];
          if (state.generation !== generation || alert === undefined || !pending(state, alert)
            || state.delivery[row.alertId]?.failureSequence !== ready.state.delivery[row.alertId]?.failureSequence) return;
          const attempt = (state.delivery[row.alertId]?.attempt ?? 0) + 1;
          const result = yield* sender.send(alertPayload(alert, current), { carrier: state.carrier,
            ...(state.token === undefined ? {} : { token: state.token }) }).pipe(Effect.timeout(10_000),
            Effect.catchCause((cause) => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
              : Effect.fail(cause.reasons.some((reason) => reason._tag === "Fail" && reason.error === "token missing")
                ? "token missing" : "carrier delivery failed")), Effect.result);
          const base = { alertId: alert.alertId, generation: generation as EventSequence, attempt, carrier: "ntfy" as const };
          const event: Event = result._tag === "Success" ? { _tag: "client.AlertDelivered", ...base }
            : { _tag: "client.AlertDeliveryFailed", ...base,
              reason: result.failure === "token missing" ? "token missing" : "carrier delivery failed",
              ...(attempt >= 5 ? { final: true } : {}) };
          yield* writePieceBatch({ namespace: "client", kind: "reactor", sourceSequence: 0, build: () => ({ events: [event] }) }, lists);
        }));
      });
      yield* work.pipe(Effect.ensuring(Effect.sync(() => { active.delete(key); })),
        Effect.andThen(Effect.suspend(reconcile)),
        Effect.catchCause((cause) => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
          : Deferred.failCause(stopped, cause).pipe(Effect.asVoid)), Effect.forkScoped);
    }
  });
  yield* reconcile();
  const follow = subscribe(initial.sequence).pipe(Stream.runForEach((envelope) => Effect.gen(function* () {
    if (envelope.event._tag === "client.AlertCleared") {
      const view = clientView((yield* views.snapshot).client);
      yield* sender.clear(envelope.event.alertId, { carrier: view.carrier,
        ...(view.token === undefined ? {} : { token: view.token }) }).pipe(
        Effect.timeout(10_000), Effect.catchCause(() => Effect.logWarning("alert carrier clear failed")), Effect.forkScoped);
    }
    yield* reconcile();
  })));
  yield* Effect.raceFirst(follow, Deferred.await(stopped));
}));
