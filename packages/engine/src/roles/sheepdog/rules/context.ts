import { parseRole, type Actor, type AgentId, type EventSequence, type RolesSettings } from "@shephrd/contracts";
import type { AgentRoles, RolesView } from "../../view.ts";
import type { NoticeAction } from "../notices.ts";
import { resolveSettings, roleSettings } from "../settings.ts";

export interface RuleAgent {
  readonly agentId: AgentId;
  readonly role?: string;
  readonly groups?: ReadonlyArray<string>;
  readonly parent?: Actor;
  readonly account?: string;
  readonly state?: { readonly _tag: string; readonly reason?: string; readonly resetAt?: number };
  readonly capacityHeld?: boolean;
  readonly sheepdog?: boolean;
  readonly pause?: { readonly reason: string; readonly resetAt?: number };
  readonly deliveries?: ReadonlyArray<{ readonly status: string; readonly sheepdog?: boolean }>;
  readonly startedSequence?: number;
  readonly turnStartSequence?: number;
  readonly turnOpen?: boolean;
  readonly crashSequence?: number;
}
export interface RuleInput {
  readonly now: number;
  readonly sourceSequence?: number;
  readonly clockFloorMillis?: number;
  readonly noticeRecipients?: Readonly<Record<string, NoticeAction["noticeRecipient"]>>;
  readonly agents: Readonly<Record<string, RuleAgent>>;
  readonly roles: {
    readonly settings?: RolesSettings & { readonly crashRetries?: number };
    readonly file?: RolesView["file"];
    readonly snoozes?: Readonly<Record<string, number>>;
    readonly actions?: RolesView["actions"];
    readonly agents?: Readonly<Record<string, Partial<AgentRoles>>>;
  };
  readonly accounts?: Readonly<Record<string, { readonly status: string; readonly resetAt?: number }>>;
  readonly eventTimes?: Readonly<Record<string, number>>;
  readonly groupOrigins?: Readonly<Record<string, number>>;
  readonly accountRecoveredAt?: number;
  readonly deliveries?: Readonly<Record<string, { readonly target?: string; readonly status: string; readonly sheepdog?: boolean }>>;
  readonly requests?: Readonly<Record<string, { readonly status: string; readonly agentId: string; readonly holder: Actor }>>;
  readonly waits?: Readonly<Record<string, { readonly status: string; readonly blocking: boolean; readonly agentId: string }>>;
  readonly turnExcludedMillis?: Readonly<Record<string, number>>;
  readonly turnExcluded?: Readonly<Record<string, boolean>>;
  readonly adviceKinds?: Readonly<Record<string, ReadonlyArray<AdviceKind>>>;
  readonly client?: { readonly alerts: Readonly<Record<string, { readonly kind: string; readonly agentId?: string; readonly status: string }>> | ReadonlyArray<{ readonly kind: string; readonly agentId?: string; readonly status: string }> };
}
export type AdviceKind = "start" | "owner" | "pass-up";
export const own = <T>(rows: Readonly<Record<string, T>> | undefined, key: string): T | undefined =>
  rows !== undefined && Object.hasOwn(rows, key) ? rows[key] : undefined;
export const agentRoles = (input: RuleInput, agent: RuleAgent) => ({ ...agent, ...own(input.roles.agents, agent.agentId) });
export const limitsFor = (input: RuleInput, agent: RuleAgent) => resolveSettings(input.roles.settings ?? {}, roleSettings(input.roles.file ?? null, agent.role ?? ""));
export const isWorker = (agent: RuleAgent) => parseRole(agent.role ?? "").kind === "worker";
export const ageLimitFor = (input: RuleInput, agent: RuleAgent): number | undefined => {
  const parsed = parseRole(agent.role ?? "");
  const name = parsed.flags.length === 0 ? parsed.name : undefined;
  const custom = name === undefined ? undefined : own(input.roles.file?.roles, name)?.limits.ageMinutes;
  return custom ?? (isWorker(agent) ? limitsFor(input, agent).ageMinutes : undefined);
};
export const live = (agent: RuleAgent) => agent.state?._tag !== "stopped" && agent.state?._tag !== "crashed";
export const recipientFor = (input: RuleInput, agent: RuleAgent): NoticeAction["noticeRecipient"] => {
  const routed = own(input.noticeRecipients, agent.agentId);
  if (routed !== undefined) return routed;
  let parent = agent.parent;
  const seen = new Set<string>([agent.agentId]);
  while (parent?._tag === "agent" && !seen.has(parent.agentId)) {
    seen.add(parent.agentId);
    const holder = own(input.agents, parent.agentId);
    // Compact rule inputs may omit the holder's row. Production inputs do not.
    if (holder === undefined) return parent.agentId;
    if (holder.state?._tag === "idle" || holder.state?._tag === "working" || holder.state === undefined) return parent.agentId;
    parent = holder.parent;
  }
  return "owner";
};
export const actionBase = (input: RuleInput, agent: RuleAgent, triggerSequence: number, occurrence = 1) => ({
  agentId: agent.agentId, noticeRecipient: recipientFor(input, agent),
  triggerSequence: triggerSequence as EventSequence,
  sourceSequence: (input.sourceSequence ?? triggerSequence) as EventSequence, occurrence,
});
export const timeOf = (input: RuleInput, sequence: number | undefined, fallback: string): number | undefined =>
  (sequence === undefined ? undefined : own(input.eventTimes, String(sequence))) ?? own(input.eventTimes, fallback);

export const ownerPause = (input: RuleInput, agent: RuleAgent): boolean => {
  if (!live(agent)) return false;
  const account = agent.account === undefined ? undefined : own(input.accounts, agent.account);
  const pause = agent.pause ?? agent.state;
  return account?.status === "needs-sign-in" || account?.status === "out-of-usage" && account.resetAt === undefined
    || agent.state?._tag === "paused" && (pause?.reason !== "limit" || pause.resetAt === undefined);
};
export const busy = (input: RuleInput, agent: RuleAgent): boolean => {
  if (!live(agent)) return false;
  const account = agent.account === undefined ? undefined : own(input.accounts, agent.account);
  const pause = agent.pause ?? agent.state;
  if (ownerPause(input, agent)) return false;
  if (agent.capacityHeld || account?.status === "out-of-usage" && account.resetAt !== undefined
    || agent.state?._tag === "paused" && pause?.reason === "limit" && pause.resetAt !== undefined) return true;
  const pending = [...(agent.deliveries ?? []), ...Object.values(input.deliveries ?? {}).filter((delivery) => delivery.target === agent.agentId)];
  return agent.state?._tag === "starting" || agent.state?._tag === "working" && !agent.sheepdog
    || pending.some((delivery) => (delivery.status === "queued" || delivery.status === "sent") && !delivery.sheepdog);
};
export const turnIsExcluded = (input: RuleInput, agent: RuleAgent): boolean =>
  agent.state?._tag === "paused" || agent.capacityHeld === true
  || Object.values(input.requests ?? {}).some((request) => request.status === "open"
    && (request.agentId === agent.agentId || request.holder._tag === "agent" && request.holder.agentId === agent.agentId))
  || Object.values(input.waits ?? {}).some((wait) => wait.status === "open" && wait.blocking && wait.agentId === agent.agentId);
