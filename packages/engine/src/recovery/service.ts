import type { Event } from "@shepherd/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import type { LogWriteFailed } from "../log/EventLog.ts";

type Cause = Extract<Event, { _tag: "AccountAvailable" }>["cause"];

// Fix round 1, ruling 3: a second `recover` after an earlier one started and
// did not complete. The reason is fixed text.
export class RecoveryAttempted extends Data.TaggedError("RecoveryAttempted")<{
  readonly reason: "recovery already attempted; start a new engine";
}> {}

// Restart recovery (decision rows 52 and 66, steps 3 to 10). The service is
// built before the command handler. While it is present, the handler refuses
// commands with "recovering" and its dispatch and account-return followers
// wait on `whenReady` (issue 88). `ready` turns true after step 9 and before
// step 10 sends. A rig or service without this layer keeps the ordinary
// start-up behaviour. It lives apart from `restart.ts` so the followers can
// name it without importing recovery itself.
export class Restart extends Context.Service<Restart, {
  readonly ready: Effect.Effect<boolean>;
  readonly whenReady: Effect.Effect<void>;
  // Steps 3 to 10, run at most once per service. After a run completed,
  // `recover` is a no-op. A run that failed or was interrupted is fatal to
  // this service: every later `recover` fails at once with
  // `RecoveryAttempted` and writes nothing (no token revocation, no sweep, no
  // interrupt), and the gate stays shut. Unit 7a must then start a fresh
  // engine, whose new service runs recovery again over the same log. Timers
  // it starts belong to the caller's scope.
  readonly recover: Effect.Effect<void, LogWriteFailed | RecoveryAttempted, Scope.Scope>;
  // Row 66: an "account available" returns the account's paused agents. One
  // without a live process (after a restart) is reloaded first, and then its
  // queue is sent once.
  readonly returnAccount: (accountId: string, cause: Cause) => Effect.Effect<void, LogWriteFailed>;
}>()("shepherd/engine/recovery/Restart") {}
