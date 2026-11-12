import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { AgentChoices } from "@lgtm/contracts";
import { expect } from "vitest";
import { configuredChoices, negotiatedChoices, reportedChoice } from "../../src/runner/choices.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
const secret = "planted-credential-0123456789";
const clean = (value: string) => Effect.succeed(value.replaceAll(secret, "[REDACTED]"));

it.effect("W05c choices: grouped negotiated IDs stay exact, labels are redacted before truncation, and credentials never become choices", () => Effect.gen(function* () {
  const choices = yield* negotiatedChoices([{ type: "select", category: "model", currentValue: "large", options: [
    { group: "models", name: "Models", options: [
      { value: "large", name: `${"x".repeat(250)}${secret}\nlabel` },
      { value: secret, name: "Credential disguised as a model" },
      { value: "large", name: "Duplicate" },
      { name: "Only a label" },
      { value: "bad\nidentifier", name: "Bad identifier" },
    ] },
  ] }], clean);
  expect(choices.models).toEqual({ source: "negotiated", options: [{ id: "large", label: `${"x".repeat(250)}[REDAC` }] });
  expect(JSON.stringify(choices)).not.toContain(secret);
  expect(Schema.is(AgentChoices)(choices)).toBe(true);
}));

it.effect("W05c choices: configured fallback is also redacted and bounded; no surviving IDs means unavailable", () => Effect.gen(function* () {
  const choices = yield* configuredChoices([secret, "usable", "usable", "bad\nidentifier", ...Array.from({ length: 200 }, (_, i) => `model-${i}`)], [secret], clean);
  expect(choices.models.source).toBe("configured");
  expect(choices.models.options).toHaveLength(127);
  expect(choices.models.options[0]).toEqual({ id: "usable" });
  expect(choices.efforts).toEqual({ source: "unavailable", options: [] });
  expect(JSON.stringify(choices)).not.toContain(secret);
  expect(Schema.is(AgentChoices)(choices)).toBe(true);
}));

it.effect("W05c choices: ambiguous selectors and label-only current values cannot establish applied configuration", () => Effect.gen(function* () {
  const first = { type: "select", category: "model", currentValue: "Large label", options: [{ value: "large", name: "Large label" }] };
  expect(reportedChoice([first])).toEqual({});
  const choices = yield* negotiatedChoices([first, { ...first, currentValue: "large" }], clean);
  expect(choices.models).toEqual({ source: "unavailable", options: [] });
  expect(reportedChoice([first, { ...first, currentValue: "large" }])).toEqual({});
}));
