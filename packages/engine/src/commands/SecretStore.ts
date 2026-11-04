import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";

import { LogWriteFailed } from "../log/EventLog.ts";

// The persistent store is `accounts/SecretStore.ts`. Values stay wrapped at
// this seam, and a failed write is reported without the value.
export class SecretStore extends Context.Service<SecretStore, {
  readonly put: (reference: string, value: Redacted.Redacted<string>) => Effect.Effect<void, LogWriteFailed>;
  readonly removeCarrierValue?: (generation: string) => Effect.Effect<void, LogWriteFailed>;
  readonly resolve: (reference: string) => Effect.Effect<Redacted.Redacted<string> | undefined>;
  // Issue 119: removes every stored value whose reference is not in `keep`.
  // Restart recovery calls it, before any command can store a new value.
  readonly retainOnly?: (keep: ReadonlySet<string>) => Effect.Effect<void, LogWriteFailed>;
}>()("shephrd/engine/commands/SecretStore") {
  static readonly layer: Layer.Layer<SecretStore> = Layer.effect(SecretStore, Effect.sync(() => {
    const values = new Map<string, Redacted.Redacted<string>>();
    return SecretStore.of({
      put: (reference, value) => Effect.sync(() => { values.set(reference, value); }),
      removeCarrierValue: (generation) => !/^[A-Za-z0-9_-]+$/.test(generation) ? Effect.void : Effect.sync(() => { values.delete(`secret:client.alerts.carrier.${generation}`); }),
      resolve: (reference) => Effect.sync(() => values.get(reference)),
      retainOnly: (keep) => Effect.sync(() => { for (const reference of [...values.keys()]) if (!keep.has(reference)) values.delete(reference); }),
    });
  }));
}
