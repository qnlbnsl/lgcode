import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";

// Unit 6b supplies the persistent store. Values stay wrapped at this seam.
export class SecretStore extends Context.Service<SecretStore, {
  readonly put: (reference: string, value: Redacted.Redacted<string>) => Effect.Effect<void>;
  readonly resolve: (reference: string) => Effect.Effect<Redacted.Redacted<string> | undefined>;
}>()("shepherd/engine/commands/SecretStore") {
  static readonly layer: Layer.Layer<SecretStore> = Layer.effect(SecretStore, Effect.sync(() => {
    const values = new Map<string, Redacted.Redacted<string>>();
    return SecretStore.of({
      put: (reference, value) => Effect.sync(() => { values.set(reference, value); }),
      resolve: (reference) => Effect.sync(() => values.get(reference)),
    });
  }));
}
