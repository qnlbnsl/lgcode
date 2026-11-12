import { parseRole, type RoleFile, type RoleKind, type RoleLimits, type RolesSettings } from "@lgtm/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import { refused, type Input, type Payload, type PiecePlan } from "../../commands/internal.ts";
import type { RolesView } from "../view.ts";

export const defaultLimits = {
  crashRetries: 1, capacityRetries: 12, capacityBackoffMinutes: 5,
  stallMinutes: 10, teamIdleMinutes: 60, turnMinutes: 120, ageMinutes: 120,
} as const;
const issues = SchemaIssue.makeFormatterStandardSchemaV1({ leafHook: () => "invalid setting value", checkHook: () => "invalid setting value" });
export const settingsRefusal = (error: unknown) => {
  if (!Schema.isSchemaError(error)) return refused();
  const path = (issues(error.issue).issues[0]?.path ?? []).map((part) => typeof part === "object" ? String(part.key) : String(part));
  return refused(`roles settings error: ${JSON.stringify(path)}: invalid setting value`);
};
export const resolveSettings = (settings: RolesSettings, role: { readonly limits: RoleLimits; readonly kind?: RoleKind } | undefined) => ({
  ...defaultLimits, ...(role?.kind === "lead" || role?.kind === "orchestrator" ? { stallMinutes: 20 } : {}),
  ...settings.limits, ...role?.limits,
});
export const roleSettings = (file: RoleFile | null, role: string) => {
  const { kind, name, flags } = parseRole(role);
  const definition = flags.length === 0 && name !== undefined && file !== null && Object.hasOwn(file.roles, name) ? file.roles[name] : undefined;
  return { kind, limits: definition?.limits ?? {} };
};
export const setSettings = (input: Input, payload: Payload<"roles.settings.set">): Effect.Effect<PiecePlan, ReturnType<typeof refused>> =>
  input.actor._tag !== "owner" ? Effect.fail(refused()) : Effect.succeed({
    events: [{ _tag: "roles.SettingsChanged", settings: payload.settings }],
    reply: () => ({ requestId: payload.requestId }),
  });
export const getSettings = (input: Input, payload: Record<string, unknown>) => input.actor._tag !== "owner"
  ? Effect.fail(refused()) : Effect.succeed({ reply: { requestId: payload.requestId, settings: (input.snapshot.roles as RolesView).settings } });
export const snooze = (input: Input, payload: Payload<"roles.snooze">): Effect.Effect<PiecePlan, ReturnType<typeof refused>> => {
  const view = input.snapshot.roles as RolesView;
  if (input.actor._tag !== "owner" || !Object.hasOwn(view.snoozes, payload.group) && Object.keys(view.snoozes).length >= 200) return Effect.fail(refused());
  return Effect.succeed({ events: [{ _tag: "roles.Snoozed", group: payload.group, until: payload.until }], reply: () => ({ requestId: payload.requestId }) });
};
