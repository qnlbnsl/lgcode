import { randomUUID } from "node:crypto";
import type { Account } from "@shephrd/contracts";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import type { LogWriteFailed } from "../log/EventLog.ts";
import { harnessLogin, homeConflict, loginRefusal } from "../runner/harnesses.ts";
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

// Fix round 2, F-3: the value the child would get, so a `secret:` reference is
// compared by what it names. An unresolvable reference becomes an empty string,
// which is never the same folder as a home. The resolved value stays inside
// this comparison and is never returned, logged or put in a reason.
const effectiveValue = (secrets: Input["runtime"]["secrets"], value: string): Effect.Effect<string> =>
  value.startsWith("secret:")
    ? secrets.resolve(value).pipe(Effect.map((secret) => (secret === undefined ? "" : Redacted.value(secret))))
    : Effect.succeed(value);

// The reason an account's login fields are refused, if any: first a field the
// harness has no variable for, then a home that disagrees with an explicit
// login variable. `supplied` is a value just given for one environment name.
const loginReason = (secrets: Input["runtime"]["secrets"], account: Account, supplied?: { readonly name: string; readonly value: string }) =>
  Effect.gen(function* () {
    if (account.secret?.startsWith("secret:client.") || Object.values(account.environment ?? {}).some((value) => value.startsWith("secret:client."))) return "reserved secret reference";
    const unsupported = loginRefusal(account.harness, account);
    if (unsupported !== undefined) return unsupported;
    const variable = harnessLogin(account.harness).homeVariable;
    if (variable === undefined || account.home === undefined) return undefined;
    const raw = account.environment?.[variable];
    const explicit = supplied?.name === variable ? supplied.value : raw === undefined ? undefined : yield* effectiveValue(secrets, raw);
    const conflict = homeConflict(account.harness, account.home, explicit);
    return conflict === undefined ? undefined : `account home differs from ${conflict}`;
  });

export const accounts = ({ runtime, snapshot }: Input, payload: Payload<"accounts">): Effect.Effect<Plan, ReturnType<typeof refused>> =>
  Effect.gen(function* () {
    switch (payload.operation) {
      case "list": return { events: [] };
      case "add":
      case "set": {
        const existing = snapshot.accounts[payload.account.id];
        if ((payload.operation === "add" && existing !== undefined) || (payload.operation === "set" && existing === undefined)) return yield* refused();
        // Fix round 1, A9: a home and an explicit login variable that name
        // different folders leave no way to tell which login the owner meant.
        const reason = yield* loginReason(runtime.secrets, payload.account);
        if (reason !== undefined) return yield* refused(reason);
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
    const reason = yield* loginReason(runtime.secrets, { ...account, environment }, { name: payload.name, value: Redacted.value(payload.value) });
    if (reason !== undefined) return yield* refused(reason);
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
