import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { expect } from "vitest";
import { negotiatedChoices } from "../../src/runner/choices.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";
registerRebuildCheck({ noLog: true });

it.effect("legacy discovered models keep exact safe IDs, redact labels, reject duplicate and malformed IDs, and never override a configuration report", () => Effect.gen(function* () {
  const credential = "discovery-planted-credential";
  const clean = (value: string) => Effect.succeed(value.replaceAll(credential, "[REDACTED]"));
  const legacy = { currentModelId: "reported", availableModels: [
    { modelId: "reported", name: `Reported ${credential}\nmodel` },
    { modelId: "reported", name: "Duplicate" }, { modelId: credential, name: "Secret" },
    { modelId: "bad\nidentifier", name: "Invalid" }, { name: "No identifier" },
  ] };
  const result = yield* negotiatedChoices([], clean, legacy);
  expect(result.models).toEqual({ source: "negotiated", options: [{ id: "reported", label: "Reported [REDACTED] model" }] });
  expect(result.efforts).toEqual({ source: "unavailable", options: [] });
  const selector = { type: "select", category: "model", currentValue: "configured", options: [{ value: "configured", name: "Configured report" }] };
  expect((yield* negotiatedChoices([selector], clean, legacy)).models.options.map((o) => o.id)).toEqual(["configured"]);
  expect((yield* negotiatedChoices([selector, selector], clean, legacy)).models.options).toEqual([]);
}));
