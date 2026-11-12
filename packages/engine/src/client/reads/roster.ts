import { displayedState, type Caller, type RosterEntry } from "@lgtm/contracts";
import type { Snapshot } from "../../commands/internal.ts";
import { mayReadAgent } from "../../api/visibility.ts";

export const roster = (caller: Caller, view: Snapshot): ReadonlyArray<RosterEntry> =>
  Object.values(view.agents).filter((row) => mayReadAgent(caller, row.agentId, view)).map((row) => {
    const openPermissionRequests = Object.values(view.requests).filter((request) => request.agentId === row.agentId && request.status === "open").length;
    const openQuestionsAsked = Object.values(view.questions).filter((question) => question.agentId === row.agentId && question.status === "open").length;
    const start = view.threads[row.agentId]?.find(({ event }) => event._tag === "AgentStarted");
    return {
      agentId: row.agentId, name: row.name, role: row.role, groups: row.groups, parent: row.parent,
      ...(row.parent._tag === "agent" && view.agents[row.parent.agentId] !== undefined ? { parentName: view.agents[row.parent.agentId]!.name } : {}),
      ...(row.startFailure === undefined ? {} : { startFailure: row.startFailure }),
      state: row.state, displayedState: displayedState({ state: row.state, openPermissionRequests, openQuestionsAsked }),
      openPermissionRequests, openQuestionsAsked, harness: row.harness, account: row.account,
      ...(row.model === undefined ? {} : { model: row.model }), ...(row.effort === undefined ? {} : { effort: row.effort }),
      ...(caller._tag === "owner" && row.configuration !== undefined ? { configuration: row.configuration } : {}),
      permission: row.permission, folder: row.folder, ...(row.session === undefined ? {} : { session: row.session }), startedAt: start?.occurredAt ?? 0,
    } as RosterEntry;
  });
