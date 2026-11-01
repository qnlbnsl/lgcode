import type { ProviderInstanceId } from "./providerInstance.ts";
import type { CodexSettings } from "./settings.ts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { resolveCodexHomeLayout } from "./CodexHomeLayout.ts";

export const resolveManagedCodexHomeLayout = Effect.fn("resolveManagedCodexHomeLayout")(function* (
  stateDir: string,
  instanceId: ProviderInstanceId,
  config: CodexSettings,
) {
  const path = yield* Path.Path;
  return yield* resolveCodexHomeLayout({
    ...config,
    shadowHomePath:
      config.shadowHomePath.trim() ||
      (instanceId === "codex"
        ? ""
        : path.join(stateDir, "providers", "codex", instanceId, "shadow")),
  });
});
