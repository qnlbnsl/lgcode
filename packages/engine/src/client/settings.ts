import { defaultWebSettings, PublicWebAddress, publicAddressError, type WebSettings } from "@lgtm/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { refused, type Input } from "../commands/internal.ts";
import type { Views } from "../views/Views.ts";

export interface ClientWebView {
  readonly webSettings?: WebSettings;
  readonly webDown?: boolean;
}
export interface WebRuntime {
  readonly settings: () => WebSettings;
  readonly serverState: () => "running" | "off" | "port-taken" | "no-password";
  readonly changed: Effect.Effect<void>;
}
// Runtime state is scoped to the engine views. No credential or session is durable.
const runtimes = new WeakMap<Views["Service"], WebRuntime>();
export const installWebRuntime = (views: Views["Service"], runtime: WebRuntime) => {
  runtimes.set(views, runtime);
  return () => { if (runtimes.get(views) === runtime) runtimes.delete(views); };
};
export const webSettingsCommitted = (views: Views["Service"]) => runtimes.get(views)?.changed ?? Effect.void;
export const settingsOf = (view: unknown) => (view as ClientWebView | undefined)?.webSettings;

export const setWebSettings = (_input: Input, payload: Record<string, unknown>) => Effect.gen(function* () {
  const settings = payload.settings as WebSettings;
  if (settings.proxyMode && settings.publicAddress === undefined) return yield* refused("Proxy mode requires an HTTPS public address.");
  if (settings.publicAddress !== undefined && !Schema.is(PublicWebAddress)(settings.publicAddress)) {
    return yield* refused(publicAddressError);
  }
  return { events: [{ _tag: "client.WebSettingsChanged" as const, settings }], reply: () => ({ requestId: payload.requestId }) };
});
export const readWebSettings = (input: Input, payload: Record<string, unknown>) => Effect.sync(() => {
  const runtime = runtimes.get(input.runtime.views);
  const settings = runtime?.settings() ?? settingsOf(input.snapshot.client) ?? defaultWebSettings;
  return { reply: { requestId: payload.requestId, ...settings, serverState: runtime?.serverState() ?? (settings.enabled ? "no-password" : "off") } };
});
