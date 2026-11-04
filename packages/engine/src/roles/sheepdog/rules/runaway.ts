import type { NoticeAction } from "../notices.ts";
import { actionBase, ageLimitFor, agentRoles, limitsFor, live, own, timeOf, turnIsExcluded, type RuleInput } from "./context.ts";

export const evaluateRunaway = (input: RuleInput): ReadonlyArray<NoticeAction> => {
  if (input.roles.settings?.sheepdog === false) return [];
  const actions: NoticeAction[] = [];
  for (const agent of Object.values(input.agents)) {
    if (!live(agent)) continue;
    const role = agentRoles(input, agent);
    const limits = limitsFor(input, agent);
    const seen = (sequence: number) => (input.roles.actions ?? []).some((record) => record._tag === "roles.RunawayReported"
      && record.agentId === agent.agentId && record.triggerSequence === sequence);
    const turn = role.turnStartSequence;
    const sent = timeOf(input, turn, "sent");
    if (role.turnOpen && turn !== undefined && sent !== undefined && !seen(turn)
      && !(own(input.turnExcluded, agent.agentId) ?? turnIsExcluded(input, agent))
      && input.now - Math.max(sent, input.clockFloorMillis ?? -Infinity) - (own(input.turnExcludedMillis, agent.agentId) ?? 0) > limits.turnMinutes * 60_000) {
      actions.push({ _tag: "roles.RunawayReported", ...actionBase(input, agent, turn) });
    }
    const started = role.startedSequence;
    const began = timeOf(input, started, "started");
    // The worker cap is independent of its turn. A lead's age cap is opt-in.
    const ageLimit = ageLimitFor(input, agent);
    if (started !== undefined && began !== undefined && ageLimit !== undefined && !seen(started)
      && input.now - Math.max(began, input.clockFloorMillis ?? -Infinity) > ageLimit * 60_000) actions.push({ _tag: "roles.RunawayReported", ...actionBase(input, agent, started) });
  }
  return actions;
};
