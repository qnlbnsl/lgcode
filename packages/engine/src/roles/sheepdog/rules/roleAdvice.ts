import type { EventEnvelope } from "@lgtm/contracts";
import type { NoticeAction } from "../notices.ts";
import { actionBase, isWorker, own, type AdviceKind, type RuleInput } from "./context.ts";

type AdviceViews = Omit<RuleInput, "now"> & { readonly now?: number };
export const adviceKind = (envelope: Pick<EventEnvelope, "event" | "caller">): AdviceKind | undefined => {
  if (envelope.caller._tag !== "agent") return;
  const event = envelope.event;
  if (event._tag === "AgentStarted" && event.parent._tag === "agent" && event.parent.agentId === envelope.caller.agentId) return "start";
  if (event._tag === "QuestionAsked" && event.agentId === envelope.caller.agentId && event.holder._tag === "owner") return "owner";
  if (event._tag === "board.PostWritten" && event.author._tag === "agent" && event.author.agentId === envelope.caller.agentId
    && event.to.some((to) => to._tag === "owner")) return "owner";
  // The envelope's caller is the actor. The question's asker may be someone else.
  if (event._tag === "QuestionMoved") return "pass-up";
  return;
};
export const evaluateRoleAdvice = (views: AdviceViews, envelope: EventEnvelope): ReadonlyArray<NoticeAction> => {
  if (envelope.caller._tag !== "agent" || views.roles.settings?.sheepdog === false) return [];
  const agent = own(views.agents, envelope.caller.agentId);
  const kind = adviceKind(envelope);
  if (agent === undefined || !isWorker(agent) || kind === undefined || own(views.adviceKinds, agent.agentId)?.includes(kind)) return [];
  return [{ _tag: "roles.RoleAdviceBroken", ...actionBase({ ...views, now: views.now ?? envelope.occurredAt }, agent, envelope.sequence) }];
};
