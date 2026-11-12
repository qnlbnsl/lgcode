import type { AcpClient } from "@lgtm/t3-effect-acp/client";
import * as Effect from "effect/Effect";
import { RunnerRejected } from "./Runner.ts";

export interface ConfigOption {
  readonly id?: string;
  readonly configId?: string;
  readonly type?: string;
  readonly category?: string | null;
  readonly currentValue?: unknown;
  readonly options?: unknown;
}
export const setConfig = (client: AcpClient["Service"], sessionId: string, options: ReadonlyArray<ConfigOption>, category: string, value: string, version: number) => Effect.gen(function* () {
  const startFailure = category === "model" ? "model-refused" : category === "thought_level" ? "effort-refused" : "mode-refused";
  const option = options.find((option) => option.category === category && option.type === "select")
    ?? options.find((option) => option.category === category);
  const configId = option?.id ?? option?.configId;
  if (configId !== undefined) {
    const response = yield* client.agent.setSessionConfigOption({ sessionId, configId, value }).pipe(
      Effect.mapError((error) => new RunnerRejected({ startFailure, reason: "adapter rejected configuration",
        configurationUncertain: error._tag !== "AcpRequestError" })),
    );
    return response.configOptions as ReadonlyArray<ConfigOption>;
  }
  // Only the negotiated older generation supports these compatibility calls.
  if (version === 1 && category === "mode") {
    yield* client.agent.setSessionMode({ sessionId, modeId: value }).pipe(Effect.mapError(() => new RunnerRejected({ startFailure, reason: "adapter rejected mode" })));
    return options;
  }
  if (version === 1 && category === "model") {
    yield* client.agent.setSessionModel({ sessionId, modelId: value }).pipe(Effect.mapError(() => new RunnerRejected({ startFailure, reason: "adapter rejected model" })));
    return options;
  }
  return yield* new RunnerRejected({ startFailure, reason: "adapter cannot set requested configuration" });
});
