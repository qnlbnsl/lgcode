// Engine records shaped as `client.snapshot` returns them, for the mapping tests. The names
// are made up for these tests and share nothing with the website's sample in design/mock.
import type { ClientSnapshot } from "@lgtm/contracts"

const roster = (agentId: string, o: Record<string, unknown> = {}) => ({
  agentId, name: "Worker", role: "worker", groups: [], parent: { _tag: "owner" }, state: { _tag: "working" },
  displayedState: "Working", openPermissionRequests: 0, openQuestionsAsked: 0, harness: "claude", account: "acct-main",
  model: "opus", effort: "high", permission: "edit", folder: "/srv/repos/orchard", startedAt: 1_700_000_000_000, ...o
})

export const engineSnapshot = {
  sequence: 42,
  agents: [
    roster("ag-lead", { name: "Lead of orchard", role: "project-lead", state: { _tag: "idle" }, displayedState: "Idle" }),
    roster("ag-team-lead", { name: "Team lead", role: "lead", groups: ["grp-alpha"] }),
    roster("ag-worker", { name: "Worker one", role: "worker", groups: ["grp-alpha"], openPermissionRequests: 1, displayedState: "Waiting on a permission" }),
    roster("ag-failed", { name: "Worker two", groups: ["grp-alpha"], startFailure: "not-signed-in", state: { _tag: "stopped" }, displayedState: "Stopped" }),
    roster("ag-outside", { name: "Orchestrator", role: "orchestrator" })
  ],
  requests: [
    { id: "perm-1", agentId: "ag-worker", holder: { _tag: "owner" }, sourceSequence: 30, openedAt: 1_700_000_100_000,
      display: { preview: "Run the orchard checks\nnpm test", options: [
        { id: "allow", name: "Allow once", kind: "allow_once", level: "edit", persistent: false },
        { id: "deny", name: "Deny", kind: "reject_once", level: "read-only", persistent: false }], optionCount: 2, bytes: 40, toolKind: "execute" } },
    { id: "perm-held", agentId: "ag-worker", holder: { _tag: "agent", agentId: "ag-team-lead" }, sourceSequence: 31,
      display: { preview: "Held by the lead", options: [], optionCount: 0, bytes: 16 } }
  ],
  questions: [
    { id: "q-1", agentId: "ag-team-lead", holder: { _tag: "owner" }, sourceSequence: 33, openedAt: 1_700_000_200_000,
      display: { title: "Which branch should the release use?", recommendation: "Use the release branch.", preview: "Long text", options: [], optionCount: 0, bytes: 9, projectId: "pj-orchard", taskId: "tk-1" } },
    { id: "q-stray", agentId: "ag-outside", holder: { _tag: "owner" }, sourceSequence: 34 }
  ],
  requestsWithoutDisplay: 0, questionsWithoutDisplay: 0,
  project: {
    sequence: 42, truncated: false,
    repositories: [{ repoId: "rp-orchard", name: "orchard", path: "/srv/repos/orchard" }],
    workspaces: [
      { worktreeId: "wt-main", repoId: "rp-orchard", machineId: "local", branch: "trunk", path: "/srv/repos/orchard", checkout: "main" },
      { worktreeId: "wt-project", repoId: "rp-orchard", machineId: "local", branch: "feature/harvest", path: "/srv/repos/orchard/.worktrees/harvest", checkout: "worktree", projectId: "pj-orchard", parentId: "wt-main" },
      { worktreeId: "wt-team", repoId: "rp-orchard", machineId: "local", branch: "feature/harvest/alpha", path: "/srv/repos/orchard/.worktrees/harvest-alpha", checkout: "worktree", projectId: "pj-orchard", teamId: "tm-alpha", parentId: "wt-project" }
    ],
    projects: [
      { projectId: "pj-orchard", repoId: "rp-orchard", name: "Harvest report", goal: "Count the apples every morning.", leadAgentId: "ag-lead", worktreeId: "wt-project", machineId: "local", stage: "build", shell: "bash" },
      { projectId: "pj-orphan", repoId: "rp-orchard", name: "Old idea", goal: "Nothing yet.", leadAgentId: "ag-gone", worktreeId: "wt-main", machineId: "local", archivedAt: 1_700_000_300_000 }
    ],
    teams: [{ projectId: "pj-orchard", teamId: "tm-alpha", name: "Alpha team", worktreeId: "wt-team", stage: "build", group: "grp-alpha" }],
    sprints: [
      { projectId: "pj-orchard", sprintId: "sp-a", label: "HR-1", name: "Count apples", goal: "A number each morning.", phase: "Build", owner: "ag-team-lead", needs: [] },
      { projectId: "pj-orchard", sprintId: "sp-b", label: "HR-2", name: "Send the report", goal: "Mail it.", phase: "Plan", owner: "ag-lead", needs: ["sp-a"], completedAt: 1_700_000_400_000 }
    ],
    tasks: [{ projectId: "pj-orchard", taskId: "tk-1", label: "HR-11", title: "Write the counter", owner: "ag-worker", teamId: "tm-alpha", sprintId: "sp-a", state: "active", worktreeId: "wt-team" }],
    agents: [
      { agentId: "ag-lead", projectId: "pj-orchard", status: "Ready" },
      { agentId: "ag-team-lead", projectId: "pj-orchard", status: "Working" },
      { agentId: "ag-worker", projectId: "pj-orchard", status: "Needs you" },
      { agentId: "ag-failed", projectId: "pj-orchard", status: "Ready" }
    ]
  }
} as unknown as ClientSnapshot
