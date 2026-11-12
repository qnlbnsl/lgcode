import type { NoticeAction } from "../notices.ts";
import { actionBase, busy, limitsFor, live, own, ownerPause, timeOf, type RuleInput } from "./context.ts";

export const idleGroups = (input: RuleInput) => {
  const members = Object.values(input.agents);
  const groups = new Map<string, typeof members>();
  for (const agent of members) for (const group of new Set(agent.groups ?? [])) {
    const rows = groups.get(group) ?? [];
    if (!groups.has(group)) groups.set(group, rows);
    rows.push(agent);
  }
  return [...groups].filter(([, rows]) => rows.some((agent) => live(agent) && agent.state?._tag !== "paused")
    && !rows.some((agent) => busy(input, agent) || ownerPause(input, agent)));
};

export const latestIdleReport = (input: RuleInput, group: string, agentId: string, origin: number) => {
  const reports = (input.roles.actions ?? []).filter((record) => record._tag === "roles.TeamIdleReported"
    && record.group === group && record.agentId === agentId && record.triggerSequence === origin);
  const occurrence = Math.max(0, ...reports.map((report) => report.occurrence));
  // Rerouting an unread notice retains its occurrence. Its later record must
  // not postpone the next hourly nudge.
  return reports.find((report) => report.occurrence === occurrence);
};

export const evaluateTeamIdle = (input: RuleInput): ReadonlyArray<NoticeAction> => {
  if (input.roles.settings?.stallWatch === false) return [];
  const actions: NoticeAction[] = [];
  for (const [group, members] of idleGroups(input)) {
    if ((own(input.roles.snoozes, group) ?? -Infinity) > input.now) continue;
    const tops = members.filter((agent) => {
      const parent = agent.parent;
      return live(agent) && agent.state?._tag !== "paused"
        && (parent?._tag !== "agent" || !members.some((member) => member.agentId === parent.agentId));
    });
    for (const agent of tops) {
      const origin = own(input.groupOrigins, group) ?? 0;
      const started = timeOf(input, origin, `group:${group}`);
      if (started === undefined) continue;
      const previous = latestIdleReport(input, group, agent.agentId, origin);
      const since = previous === undefined ? started : timeOf(input, previous.sequence, `report:${group}`) ?? input.now;
      if (input.now - Math.max(since, input.accountRecoveredAt ?? -Infinity) < limitsFor(input, agent).teamIdleMinutes * 60_000) continue;
      actions.push({ _tag: "roles.TeamIdleReported", ...actionBase(input, agent, origin, (previous?.occurrence ?? 0) + 1), group });
    }
  }
  return actions;
};
