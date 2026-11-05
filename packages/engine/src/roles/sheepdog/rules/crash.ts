import type { NoticeAction } from "../notices.ts";
import { actionBase, agentRoles, limitsFor, own, timeOf, type RuleInput } from "./context.ts";

export interface CrashInput extends RuleInput {
  readonly event?: { readonly _tag: string; readonly agentId?: string; readonly sequence?: number; readonly occurredAt?: number };
}
export const engineAlertOpen = (input: RuleInput, agentId: string): boolean => Object.values(input.client?.alerts ?? {}).some(
  (alert) => alert.kind === "failure" && alert.agentId === agentId && alert.status === "open",
);
export const evaluateCrash = (input: CrashInput): ReadonlyArray<NoticeAction> => {
  if (input.roles.settings?.sheepdog === false || input.event?._tag !== "AgentCrashed" || input.event.agentId === undefined) return [];
  const agent = own(input.agents, input.event.agentId);
  if (agent === undefined) return [];
  const role = agentRoles(input, agent);
  if (role.openCrash !== undefined) return [];
  const sequence = input.event.sequence ?? role.crashSequence;
  if (sequence === undefined || agent.state?._tag !== "crashed" || role.crashSequence !== sequence) return [];
  const records = (input.roles.actions ?? []).filter((record) => record.agentId === agent.agentId);
  // An admitted attempt that ended in a later crash covers that later crash
  // too. Replaying its envelope must not produce a second give-up notice.
  if (records.some((record) => record._tag === "roles.GaveUp" && record.cause === "crash"
    && record.sequence >= sequence && record.triggerSequence <= sequence)) return [];
  if (records.some((record) => record.triggerSequence === sequence
    && ["roles.CrashAdmitted", "roles.CrashRetried", "roles.GaveUp"].includes(record._tag))) return [];
  const recent = records.filter((record) => record._tag === "roles.CrashAdmitted"
    && input.now - (timeOf(input, record.sequence, String(record.triggerSequence)) ?? input.now) < 60 * 60_000);
  const retries = input.roles.settings?.crashRetries ?? limitsFor(input, agent).crashRetries;
  const base = actionBase(input, agent, sequence);
  return retries === 0 || recent.length >= retries
    ? [{ _tag: "roles.GaveUp", ...base, cause: "crash", engineAlertOpen: engineAlertOpen(input, agent.agentId) }]
    : [{ _tag: "roles.CrashAdmitted", ...base }];
};
