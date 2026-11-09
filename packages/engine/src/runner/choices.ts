import { ChoiceId, type AgentChoice, type AgentChoices, type ChoiceList } from "@lgcode/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { ConfigOption } from "./config.ts";

export const validChoiceId = Schema.is(ChoiceId);
// Preserve Cursor's existing start-setting alias while exposing the actual
// protocol ID. New live choices still require a literal advertised ID.
export const configurationMatches = (harness: string, desired: AgentChoice, applied: AgentChoice) =>
  Object.entries(desired).every(([axis, value]) => applied[axis as keyof AgentChoice] === value
    || (harness === "cursor" && axis === "model" && value === "auto" && applied.model === "default[]"));
export const selector = (options: ReadonlyArray<ConfigOption>, category: string) => {
  const matches = options.filter((option) => option.category === category && option.type === "select");
  return matches.length === 1 ? matches[0] : undefined;
};
// ACP supports a flat select list or one level of groups. A label never grants support.
export const selectValues = (option: ConfigOption | undefined): ReadonlyArray<{ id: string; label?: string }> => {
  if (!Array.isArray(option?.options)) return [];
  const values = option.options.slice(0, 128).flatMap((value: unknown) => {
    if (typeof value !== "object" || value === null) return [];
    const item = value as Record<string, unknown>;
    return Array.isArray(item.options) ? item.options.slice(0, 128) : [item];
  });
  const seen = new Set<string>();
  return values.flatMap((value: unknown) => {
    if (typeof value !== "object" || value === null) return [];
    const item = value as Record<string, unknown>;
    if (!validChoiceId(item.value) || seen.has(item.value)) return [];
    seen.add(item.value);
    return [{ id: item.value, ...(typeof item.name === "string" ? { label: item.name } : {}) }];
  }).slice(0, 128);
};
export const reportedChoice = (options: ReadonlyArray<ConfigOption>): AgentChoice => {
  const model = selector(options, "model"), effort = selector(options, "thought_level");
  return {
    ...(validChoiceId(model?.currentValue) && selectValues(model).some((item) => item.id === model.currentValue) ? { model: model.currentValue } : {}),
    ...(validChoiceId(effort?.currentValue) && selectValues(effort).some((item) => item.id === effort.currentValue) ? { effort: effort.currentValue } : {}),
  };
};
export const configuredChoices = (models: ReadonlyArray<string>, efforts: ReadonlyArray<string>, clean: (value: string) => Effect.Effect<string>): Effect.Effect<AgentChoices> => {
  const list = (values: ReadonlyArray<string>): Effect.Effect<ChoiceList> => Effect.gen(function* () {
    const options: Array<{ id: string }> = [];
    for (const id of [...new Set(values)].filter(validChoiceId).slice(0, 128)) {
      if ((yield* clean(id)) === id) options.push({ id });
    }
    return { source: options.length === 0 ? "unavailable" : "configured", options };
  });
  return Effect.gen(function* () { return { models: yield* list(models), efforts: yield* list(efforts) }; });
};
export const negotiatedChoices = (options: ReadonlyArray<ConfigOption>, clean: (value: string) => Effect.Effect<string>): Effect.Effect<AgentChoices> => {
  const list = (category: string): Effect.Effect<ChoiceList> => Effect.gen(function* () {
    const result: Array<{ id: string; label?: string }> = [];
    for (const item of selectValues(selector(options, category))) {
      // IDs must survive redaction unchanged, since the adapter needs the exact ID.
      if ((yield* clean(item.id)) !== item.id) continue;
      const label = item.label === undefined ? undefined : (yield* clean(item.label)).replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 256);
      result.push({ id: item.id, ...(label === undefined ? {} : { label }) });
    }
    return { source: result.length === 0 ? "unavailable" : "negotiated", options: result };
  });
  return Effect.gen(function* () { return { models: yield* list("model"), efforts: yield* list("thought_level") }; });
};
