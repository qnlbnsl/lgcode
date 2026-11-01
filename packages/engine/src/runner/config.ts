import type { AcpClient } from "@shepherd/t3-effect-acp/client";
import * as Effect from "effect/Effect";
import { RunnerRejected } from "./Runner.ts";

export interface ConfigOption {
  readonly id?: string;
  readonly configId?: string;
  readonly category?: string | null;
  readonly currentValue?: unknown;
}
export const setConfig = (client: AcpClient["Service"], sessionId: string, options: ReadonlyArray<ConfigOption>, category: string, value: string, version: number) => Effect.gen(function* () {
  const option = options.find((option) => option.category === category);
  const configId = option?.id ?? option?.configId;
  if (configId !== undefined) {
    const response = yield* client.agent.setSessionConfigOption({ sessionId, configId, value }).pipe(
      Effect.mapError(() => new RunnerRejected({ reason: "adapter rejected configuration" })),
    );
    return response.configOptions as ReadonlyArray<ConfigOption>;
  }
  // Only the negotiated older generation supports these compatibility calls.
  if (version === 1 && category === "mode") {
    yield* client.agent.setSessionMode({ sessionId, modeId: value }).pipe(Effect.mapError(() => new RunnerRejected({ reason: "adapter rejected mode" })));
    return options;
  }
  if (version === 1 && category === "model") {
    yield* client.agent.setSessionModel({ sessionId, modelId: value }).pipe(Effect.mapError(() => new RunnerRejected({ reason: "adapter rejected model" })));
    return options;
  }
  return yield* new RunnerRejected({ reason: "adapter cannot set requested configuration" });
});
