import { comparePermission, rolesActionKinds, type AgentId, type Event, type PermissionLevel, type RolesActionRecord, type RolesSettings } from "@shephrd/contracts";
import { emptyRoleFile, reduceRoleFile, type RoleFileState } from "./roleFile.ts";

export interface Matter {
  readonly key: string;
  readonly kind: "roles.stall" | "roles.replace" | "roles.runaway";
  readonly agentId: AgentId;
}
export interface AgentRoles {
  readonly highestPermission: PermissionLevel;
  readonly startedSequence: number;
  readonly turnStartSequence?: number;
  readonly turnEndSequence?: number;
  readonly crashSequence?: number;
  readonly turnOpen: boolean;
  readonly stallCount: number;
  readonly capacityRetries: number;
  readonly crashRetries: number;
  readonly openCrash?: RolesActionRecord;
  readonly openStall?: RolesActionRecord;
  readonly matters: ReadonlyArray<Matter>;
}
interface Wake { readonly agentId: string; readonly postIds: ReadonlyArray<string> }
export interface RolesView extends RoleFileState {
  readonly settings: RolesSettings;
  readonly snoozes: Readonly<Record<string, number>>;
  readonly actions: ReadonlyArray<RolesActionRecord>;
  readonly agents: Readonly<Record<string, AgentRoles>>;
  readonly position: number;
  readonly baseline?: { readonly position: number; readonly on: boolean; readonly sequence: number; readonly firstSequence: number };
  readonly wakes: Readonly<Record<string, Wake>>;
  readonly deliveryWakes: Readonly<Record<string, string>>;
}
const keyed = <T>(): Readonly<Record<string, T>> => Object.create(null) as Record<string, T>;
const get = <T>(rows: Readonly<Record<string, T>>, key: string): T | undefined => Object.hasOwn(rows, key) ? rows[key] : undefined;
export const emptyRoles = (): RolesView => ({
  ...emptyRoleFile(), settings: {}, snoozes: keyed(), actions: [], agents: keyed(), position: 0,
  wakes: keyed(), deliveryWakes: keyed(),
});
const change = (view: RolesView, id: string, update: (agent: AgentRoles) => AgentRoles): RolesView => {
  const agent = get(view.agents, id);
  return agent === undefined ? view : { ...view, agents: { ...view.agents, [id]: update(agent) } };
};
const closeCrash = ({ openCrash: _openCrash, ...agent }: AgentRoles): AgentRoles => agent;
const closeStall = ({ openStall: _openStall, ...agent }: AgentRoles): AgentRoles => agent;
const matterFor = (record: RolesActionRecord): Matter | undefined => {
  let kind: Matter["kind"];
  switch (record._tag) {
    case "roles.StallSeen":
    case "roles.TeamIdleReported": kind = "roles.stall"; break;
    case "roles.ReplaceAdvised": kind = "roles.replace"; break;
    case "roles.RunawayReported": kind = "roles.runaway"; break;
    case "roles.GaveUp":
      if (record.engineAlertOpen || (record.noticeRecipient !== "owner" && record.notice !== "board-off")) return;
      return { kind: "roles.stall", key: `stall:${record.agentId}`, agentId: record.agentId };
    default: return;
  }
  return record.noticeRecipient === "owner"
    ? { kind, key: `${kind.slice("roles.".length)}:${record.agentId}`, agentId: record.agentId } : undefined;
};
const markRead = (view: RolesView, recipient: string, postIds: ReadonlyArray<string>): RolesView => {
  const ids = new Set(postIds);
  return { ...view, actions: view.actions.map((record) => record.notice === "sent"
    && record.noticeRecipient === recipient && record.postId !== undefined && ids.has(record.postId)
    ? { ...record, noticeRead: true } : record) };
};
const actionTags = new Set<string>(rolesActionKinds.map((kind) => `roles.${kind}`));

// This fold deliberately receives no clock or envelope metadata. Projection,
// live publication and replay all compute the same timer origins.
export const apply = (view: RolesView, event: Event, sequence: number): RolesView => {
  if (actionTags.has(event._tag)) {
    const record = { ...event, sequence, noticeRead: false } as RolesActionRecord;
    const next = { ...view, actions: [...view.actions, record], position: Math.max(view.position, record.sourceSequence) };
    return change(next, record.agentId, (agent) => {
      const matter = matterFor(record);
      let updated = { ...agent, matters: matter === undefined ? agent.matters
        : [...agent.matters.filter((row) => row.key !== matter.key), matter] };
      switch (record._tag) {
        case "roles.StallSeen": updated = { ...updated, openStall: record, stallCount: Math.max(agent.stallCount, record.occurrence) }; break;
        case "roles.TeamIdleReported": updated = { ...updated, openStall: record }; break;
        case "roles.StallEnded": return { ...closeStall(updated), matters: updated.matters.filter((row) => row.kind !== "roles.stall") };
        case "roles.CapacityRetried": updated = { ...updated, capacityRetries: Math.max(agent.capacityRetries, record.occurrence) }; break;
        case "roles.CrashAdmitted": return { ...updated, crashRetries: Math.max(agent.crashRetries, record.occurrence), openCrash: record };
        case "roles.CrashRetried":
          updated = { ...updated, crashRetries: Math.max(agent.crashRetries, record.occurrence) };
          return agent.openCrash?.triggerSequence === record.triggerSequence ? closeCrash(updated) : updated;
        case "roles.GaveUp": return agent.openCrash?.triggerSequence === record.triggerSequence ? closeCrash(updated) : updated;
      }
      return updated;
    });
  }
  switch (event._tag) {
    case "roles.RoleFileSet": return reduceRoleFile(view, event) as RolesView;
    case "roles.SettingsChanged": return { ...view, settings: event.settings };
    case "roles.Snoozed": return { ...view, snoozes: { ...view.snoozes, [event.group]: event.until } };
    case "roles.SheepdogBaseline": return {
      ...view, position: Math.max(view.position, event.position),
      baseline: { position: event.position, on: event.on, sequence, firstSequence: view.baseline?.firstSequence ?? sequence },
      agents: event.on ? view.agents : Object.fromEntries(Object.entries(view.agents).map(([id, agent]) => [id, closeCrash(agent)])),
    };
    case "AgentStarted": return { ...view, agents: { ...view.agents, [event.agentId]: {
      highestPermission: event.permission, startedSequence: sequence, turnOpen: false,
      stallCount: 0, capacityRetries: 0, crashRetries: 0, matters: [],
    } } };
    case "ModeChanged": return change(view, event.agentId, (agent) => comparePermission(event.level, agent.highestPermission) > 0
      ? { ...agent, highestPermission: event.level } : agent);
    case "DeliverySent": return change(view, event.agentId, (agent) => ({ ...agent, turnStartSequence: sequence, turnOpen: true }));
    case "TurnStarted": return change(view, event.agentId, (agent) => agent.turnOpen ? agent : { ...agent, turnStartSequence: sequence, turnOpen: true });
    case "TurnEnded": return change(view, event.agentId, (agent) => ({ ...agent, turnEndSequence: sequence, turnOpen: false,
      matters: agent.matters.filter((row) => row.kind !== "roles.runaway") }));
    case "AgentCrashed": return change(view, event.agentId, (agent) => ({ ...agent, crashSequence: sequence, turnOpen: false }));
    case "AgentStopped": return change(view, event.agentId, (agent) => ({ ...closeStall(closeCrash(agent)), turnOpen: false, matters: [] }));
    case "board.Read": return markRead(view, event.reader._tag === "owner" ? "owner" : event.reader.agentId, event.postIds);
    case "board.WakeBuilt": return { ...view, wakes: { ...view.wakes, [event.wakeId]: { agentId: event.targetAgentId, postIds: event.carried } } };
    case "DeliveryQueued": return event.delivery.source?._tag === "piece" && event.delivery.source.namespace === "board"
      ? { ...view, deliveryWakes: { ...view.deliveryWakes, [event.delivery.id]: event.delivery.source.id } } : view;
    case "DeliveryAccepted": {
      const id = get(view.deliveryWakes, event.deliveryId);
      const wake = id === undefined ? undefined : get(view.wakes, id);
      return wake?.agentId === event.agentId ? markRead(view, event.agentId, wake.postIds) : view;
    }
    default: return view;
  }
};
