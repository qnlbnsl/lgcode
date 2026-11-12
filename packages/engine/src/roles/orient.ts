import { parseRole, roleAdvice } from "@lgtm/contracts";
import * as Effect from "effect/Effect";
import { agentReadReply } from "../client/reads/index.ts";
import { roster } from "../client/reads/roster.ts";
import { refused, type Input } from "../commands/internal.ts";
import { escapeLeadingSlash } from "../routing/envelope.ts";
import type { RolesView } from "./view.ts";

export const orient = (input: Input, payload: Record<string, unknown>) => {
  if (input.actor._tag !== "agent") return Effect.fail(refused());
  const agentId = input.actor.agentId;
  const agents = roster(input.actor, input.snapshot);
  const self = agents.find((row) => row.agentId === agentId);
  if (self === undefined) return Effect.fail(refused());
  const role = parseRole(self.role);
  const file = (input.snapshot.roles as RolesView).file;
  const advice = role.flags.length === 0 && role.name !== undefined && file !== null && Object.hasOwn(file.roles, role.name)
    ? file.roles[role.name]!.advice : roleAdvice[role.kind];
  return Effect.succeed({ reply: agentReadReply(payload.requestId, {
    agentId: self.agentId, name: self.name, kind: role.kind,
    ...(role.name === undefined ? {} : { roleName: role.name }), parent: self.parent,
    ...(self.parentName === undefined ? {} : { parentName: self.parentName }),
    openPermissionRequests: self.openPermissionRequests, openQuestionsAsked: self.openQuestionsAsked,
    agents, advice: escapeLeadingSlash(advice),
  }) });
};
