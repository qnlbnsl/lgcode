import { rolesMaxima, type Caller, type RolesActionRecord, type RolesSettings } from "@lgtm/contracts";
import type { Snapshot } from "../commands/internal.ts";
import { encodedBytes } from "../client/reads/display.ts";
import type { Matter, RolesView } from "./view.ts";

interface CutList<T> { items: T[]; truncated: boolean }
export interface RolesSection {
  roleFile: { name: string; roleFileHash: string } | null;
  settings: RolesSettings;
  matters: CutList<Matter>;
  snoozes: CutList<{ group: string; until: number }>;
  agents: CutList<{ agentId: string; actions: RolesActionRecord[] }>;
}
// Open matters have a maximum too, independently of their encoded byte cap.
export const snapshotMatterLimit = 3 * rolesMaxima.snapshotAgents;
export const snapshotFor = (caller: Caller, snapshot: Snapshot): RolesSection | undefined => {
  if (caller._tag === "agent") return;
  const view = snapshot.roles as RolesView;
  const summary: RolesSection = {
    roleFile: view.file === null || view.roleFileHash === null ? null : { name: view.file.name, roleFileHash: view.roleFileHash },
    settings: view.settings, matters: { items: [], truncated: false },
    snoozes: { items: [], truncated: false }, agents: { items: [], truncated: false },
  };
  const fill = <T>(list: CutList<T>, items: ReadonlyArray<T>, maximum: number): void => {
    // Reserve the larger false flag encoding for every list from the start.
    // Changing it to true when cutting can only reduce the section size.
    for (const item of items.slice(0, maximum)) {
      list.items.push(item);
      if (encodedBytes(summary) > rolesMaxima.snapshotBytes) { list.items.pop(); break; }
    }
    list.truncated = list.items.length < items.length;
  };
  fill(summary.matters, Object.values(view.agents).flatMap((agent) => agent.matters), snapshotMatterLimit);
  fill(summary.snoozes, Object.entries(view.snoozes).map(([group, until]) => ({ group, until })), rolesMaxima.snoozes);
  const latest = new Map<string, Map<string, RolesActionRecord>>();
  for (const record of view.actions) {
    let kinds = latest.get(record.agentId);
    if (kinds === undefined) { kinds = new Map(); latest.set(record.agentId, kinds); }
    kinds.set(record._tag, record);
  }
  const agents = Object.entries(view.agents).filter(([id]) => Object.hasOwn(snapshot.agents, id) && snapshot.agents[id]!.state._tag !== "stopped")
    .sort(([, a], [, b]) => b.startedSequence - a.startedSequence)
    .map(([agentId]) => ({ agentId, actions: [...(latest.get(agentId)?.values() ?? [])].sort((a, b) => b.sequence - a.sequence) }));
  fill(summary.agents, agents, rolesMaxima.snapshotAgents);
  return summary;
};
