import type { Event } from "@shepherd/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import type { LogWriteFailed } from "../log/EventLog.ts";

type Cause = Extract<Event, { _tag: "AccountAvailable" }>["cause"];

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
  // Steps 3 to 10. A completed run repeated is a no-op; an interrupted run
  // can be repeated, also from a new service over the same log. Timers it
  // starts belong to the caller's scope.
  readonly recover: Effect.Effect<void, LogWriteFailed, Scope.Scope>;
  // Row 66: an "account available" returns the account's paused agents. One
  // without a live process (after a restart) is reloaded first, and then its
  // queue is sent once.
  readonly returnAccount: (accountId: string, cause: Cause) => Effect.Effect<void, LogWriteFailed>;
}>()("shepherd/engine/recovery/Restart") {}
