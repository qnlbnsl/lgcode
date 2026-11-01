import type { Snapshot } from "../commands/internal.ts";

type Row = Snapshot["accounts"][string];
export type Selection = { readonly _tag: "any" } | { readonly _tag: "named"; readonly accountId: string };

// Agents that hold a seat on their account. Stopped, crashed and interrupted
// agents run no process, so they do not count (row 28).
const seated = new Set(["starting", "working", "idle", "paused"]);

// Row 28 and issue 63: among the enabled, signed-in accounts of the harness
// that are not out of usage, take the one with the fewest agents, and break a
// tie by the lowest id. A named account is used only when it qualifies. Only
// a logged "account available" returns an account to this list (row 53).
export const pickAccount = (snapshot: Snapshot, harness: string, selection: Selection): Row | undefined => {
  const load = new Map<string, number>();
  for (const agent of Object.values(snapshot.agents)) {
    if (seated.has(agent.state._tag)) load.set(agent.account, (load.get(agent.account) ?? 0) + 1);
  }
  return Object.values(snapshot.accounts)
    .filter((row) => row.harness === harness && row.enabled !== false && row.status === "available"
      && (selection._tag === "any" || row.id === selection.accountId))
    .sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
};
