import { randomUUID } from "node:crypto";
import type { Account } from "@shepherd/contracts";
import * as Effect from "effect/Effect";
import type { LogWriteFailed } from "../log/EventLog.ts";
import { refused, type Input, type Payload, type Plan } from "./internal.ts";

// A view's availability fields are derived, never part of AccountChanged.
const accountData = (account: Account): Account => ({
  id: account.id, harness: account.harness,
  ...(account.displayName === undefined ? {} : { displayName: account.displayName }),
  ...(account.home === undefined ? {} : { home: account.home }),
  ...(account.secret === undefined ? {} : { secret: account.secret }),
  ...(account.environment === undefined ? {} : { environment: account.environment }),
  ...(account.enabled === undefined ? {} : { enabled: account.enabled }),
});

export const accounts = ({ snapshot }: Input, payload: Payload<"accounts">): Effect.Effect<Plan, ReturnType<typeof refused>> =>
  Effect.gen(function* () {
    switch (payload.operation) {
      case "list": return { events: [] };
      case "add":
      case "set": {
        const existing = snapshot.accounts[payload.account.id];
        if ((payload.operation === "add" && existing !== undefined) || (payload.operation === "set" && existing === undefined)) return yield* refused();
        return { events: [{ _tag: "AccountChanged", accountId: payload.account.id, account: payload.account }] };
      }
      case "remove":
      case "disable": {
        const account = snapshot.accounts[payload.accountId];
        if (account === undefined) return yield* refused();
        return { events: [{ _tag: "AccountChanged", accountId: account.id,
          ...(payload.operation === "remove" ? {} : { account: { ...accountData(account), enabled: false } }),
        }] };
      }
    }
  });

export const setSecret = ({ runtime, snapshot }: Input, payload: Payload<"accounts set-secret">): Effect.Effect<Plan, ReturnType<typeof refused> | LogWriteFailed> =>
  Effect.gen(function* () {
    const account = snapshot.accounts[payload.accountId];
    if (account === undefined) return yield* refused();
    const reference = `secret:${randomUUID()}`;
    const environment = Object.fromEntries([...Object.entries(account.environment ?? {}), [payload.name, reference]]);
    // Store before committing a reference. A failed log write may leave an
    // unreferenced secret, but never a committed reference with no value.
    yield* runtime.secrets.put(reference, payload.value);
    return {
      events: [{ _tag: "AccountChanged", accountId: account.id, account: { ...accountData(account), environment } }],
    };
  });

export const markAvailable = ({ snapshot }: Input, payload: Payload<"accounts mark-available">): Effect.Effect<Plan, ReturnType<typeof refused>> =>
  snapshot.accounts[payload.accountId] === undefined ? Effect.fail(refused()) : Effect.succeed({
    events: [{ _tag: "AccountAvailable", accountId: payload.accountId, cause: "owner cleared" }],
  });
