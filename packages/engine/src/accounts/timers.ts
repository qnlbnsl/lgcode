import { randomUUID } from "node:crypto";
import type { AccountId, Event } from "@lgtm/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import type * as Scope from "effect/Scope";

import { freshRequest } from "../commands/internal.ts";
import { EventLog } from "../log/EventLog.ts";
import { Views } from "../views/Views.ts";

// Rows 28 and 53. An out-of-usage account that reported a reset time returns
// at that wall-clock time, by the engine's own "account available" event with
// the cause "usage reset". A deadline is a wall-clock time, read from the log
// and compared with the wall clock at least once a minute, so a host that was
// suspended or a process that was down does not delay it. The timer never
// clears a signed-out account (only the owner can) and never acts on a
// deadline the log has since replaced.
const RECHECK_MILLIS = 60_000;
const owner = { _tag: "owner" } as const;

const accountEvent = (event: Event): boolean => event._tag === "AccountOutOfUsage" || event._tag === "AccountAvailable"
  || event._tag === "AccountNeedsSignIn" || event._tag === "AccountChanged";

export const startAccountTimers: Effect.Effect<void, never, Scope.Scope | EventLog | Views> = Effect.gen(function* () {
  const log = yield* EventLog;
  const views = yield* Views;
  // Subscribe before the first look at the views, so no account change
  // committed after it is missed.
  const committed = yield* log.subscribeCommitted;

  const release = (accountId: AccountId, resetAt: number) => log.transact((append) => Effect.gen(function* () {
    const account = (yield* views.snapshot).accounts[accountId];
    if (account?.status !== "out-of-usage" || account.resetAt !== resetAt) return;
    yield* append(owner, freshRequest(), randomUUID(), [{ _tag: "AccountAvailable", accountId, cause: "usage reset" }], {});
  })).pipe(
    Effect.catchTag("RequestIdReused", () => Effect.void),
    Effect.catchTag("LogWriteFailed", () => Effect.logWarning("account timer release failed")),
  );

  const deadlines = Effect.gen(function* () {
    const accounts = Object.values((yield* views.snapshot).accounts);
    return accounts.flatMap((row) => row.status === "out-of-usage" && row.resetAt !== undefined
      ? [{ accountId: row.id, resetAt: row.resetAt }] : []);
  });

  // Returns how long to wait before the next look: the nearest deadline, but
  // never more than a minute.
  const tick = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const attempted = new Map<AccountId, number>();
    for (const due of (yield* deadlines).filter((entry) => entry.resetAt <= now)) {
      attempted.set(due.accountId, due.resetAt);
      yield* release(due.accountId, due.resetAt);
    }
    const later = yield* Clock.currentTimeMillis;
    // Only a deadline actually attempted above gets the one-minute retry.
    // One that became due during this check needs an immediate recheck.
    const next = (yield* deadlines)
      .filter((entry) => attempted.get(entry.accountId) !== entry.resetAt)
      .map((entry) => Math.max(0, entry.resetAt - later));
    return Math.min(RECHECK_MILLIS, ...next);
  }).pipe(Effect.catchCause((cause) => Cause.hasInterrupts(cause)
    ? Effect.failCause(cause)
    : Effect.logWarning("account timer check failed").pipe(Effect.as(RECHECK_MILLIS))));

  const changed = Effect.gen(function* () {
    for (;;) if (accountEvent((yield* PubSub.take(committed)).event)) return;
  });

  // The first check runs before this returns, so a deadline that passed while
  // the engine was down is released at once.
  const first = yield* tick;
  yield* Effect.gen(function* () {
    let wait = first;
    for (;;) {
      yield* Effect.raceFirst(Effect.sleep(wait), changed);
      wait = yield* tick;
    }
  }).pipe(Effect.forkScoped);
});
