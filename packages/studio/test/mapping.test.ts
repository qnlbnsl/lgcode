import { describe, expect, it } from "vitest"
import {
  columnOf, mapAgent, mapAgentState, mapMachines, mapOwner, mapPermission, mapProject, mapRepository, mapRequest, mapRole,
  mapSnapshot, mapSprint, mapSubscriptions, mapStage, mapTask, mapTeam, mapWorktree, placeholderLead, prefixOf
} from "../src/mapping.ts"
import { engineSnapshot } from "./fixtures.ts"

const section = engineSnapshot.project!
const now = 1_800_000_000_000
const agent = (id: string) => engineSnapshot.agents.find((a) => a.agentId === id)!

describe("small pieces", () => {
  it("names the owner from Git's user name, or calls them the owner", () => {
    expect(mapOwner("Ada Lovelace")).toEqual({ name: "Ada Lovelace", initials: "AL" })
    expect(mapOwner("  ada ")).toEqual({ name: "ada", initials: "AD" })
    expect(mapOwner(undefined)).toEqual({ name: "Owner", initials: "O" })
    expect(mapOwner("   ")).toEqual({ name: "Owner", initials: "O" })
  })
  it("turns the engine's stages and permission levels into the page's words", () => {
    expect(mapStage("handover")).toBe("Hand over")
    expect(mapStage("build")).toBe("Build")
    expect(mapStage(undefined)).toBe("")
    expect(mapPermission("read-only")).toBe("Read only")
    expect(mapPermission("full")).toBe("Full access")
  })
  it("makes a task prefix from the project's name", () => {
    expect(prefixOf("Harvest report")).toBe("HR")
    expect(prefixOf("—")).toBe("PJ")
  })
  it("keeps the page's roles, maps leads, and calls other workers builders", () => {
    expect(mapRole("worker", true)).toBe("project-lead")
    expect(mapRole("reviewer", false)).toBe("reviewer")
    expect(mapRole("lead", false)).toBe("team-lead")
    expect(mapRole("worker", false)).toBe("builder")
  })
})

describe("machines, repositories and workspaces", () => {
  it("lists each machine the engine names once, with no invented figures", () => {
    const machines = mapMachines(section, now)
    expect(machines).toEqual([{ id: "local", name: "local", role: "master", status: "online", here: true,
      slots: { used: 0, limit: 0 }, lastSeen: now, address: "", os: "", workspace: "/srv/repos/orchard" }])
  })
  it("always lists the engine's own machine first, even with no workspace", () => {
    expect(mapMachines({ workspaces: [], projects: [] }, now)).toEqual([{ id: "local", name: "local", role: "master", status: "online", here: true,
      slots: { used: 0, limit: 0 }, lastSeen: now, address: "", os: "", workspace: "" }])
    const other = { ...section.workspaces[0]!, machineId: "worker-1" }
    expect(mapMachines({ workspaces: [other], projects: [] }, now).map((m) => [m.id, m.role, m.here])).toEqual([["local", "master", true], ["worker-1", "worker", false]])
  })
  it("gives a repository with no checkout yet its registered folder on the engine's machine", () => {
    expect(mapRepository(section.repositories[0]!, []).folders).toEqual({ local: section.repositories[0]!.path })
  })
  it("finds a repository's base branch and folder from its main checkout", () => {
    expect(mapRepository(section.repositories[0]!, section.workspaces)).toEqual({
      id: "rp-orchard", name: "orchard", main: "trunk", remote: null, folders: { local: "/srv/repos/orchard" }, design: false,
      description: "", describedAt: null, describedBy: null
    })
  })
  it("turns a workspace into a worktree of the right kind", () => {
    const [base, project, team] = section.workspaces.map((w) => mapWorktree(w, section.workspaces, section.projects))
    expect(base).toMatchObject({ id: "wt-main", kind: "base", parent: null, owner: null, project: null })
    expect(project).toMatchObject({ kind: "project", branch: "feature/harvest", parent: "trunk", owner: "ag-lead", project: "pj-orchard" })
    expect(team).toMatchObject({ kind: "team", parent: "feature/harvest", team: "tm-alpha", files: [], commits: [] })
  })
})

describe("projects and teams", () => {
  it("maps a project with its branch, folder, stage and lead", () => {
    expect(mapProject(section.projects[0]!, section.workspaces)).toEqual({
      id: "pj-orchard", repo: "rp-orchard", name: "Harvest report", prefix: "HR", goal: "Count the apples every morning.",
      stage: "Build", phase: "build", branch: "feature/harvest", folder: "/srv/repos/orchard/.worktrees/harvest", machine: "local",
      lead: "ag-lead", shell: "bash", createdAt: null, archived: false, hasMocks: false, tests: "on", agentReview: "on"
    })
    expect(mapProject(section.projects[1]!, section.workspaces)).toMatchObject({ archived: true, stage: "", shell: "" })
  })
  it("keeps a team's own name and its branch", () => {
    expect(mapTeam(section.teams[0]!, section.workspaces)).toEqual({
      id: "tm-alpha", project: "pj-orchard", name: "Alpha team", stage: "Build", area: null, branch: "feature/harvest/alpha", needToKnow: false
    })
  })
})

describe("agents", () => {
  it("reads the state the page shows from the engine's lifecycle and open requests", () => {
    expect(mapAgentState(agent("ag-lead"))).toBe("idle")
    expect(mapAgentState(agent("ag-worker"))).toBe("waiting")
    expect(mapAgentState(agent("ag-failed"))).toBe("failed")
    expect(mapAgentState({ ...agent("ag-lead"), state: { _tag: "interrupted", previous: "working" } })).toBe("stopped")
    expect(mapAgentState({ ...agent("ag-lead"), state: { _tag: "crashed" } })).toBe("failed")
  })
  it("places an agent in its project and its team", () => {
    expect(mapAgent(agent("ag-lead"), section)).toMatchObject({ project: "pj-orchard", team: null, role: "project-lead", activity: "" })
    expect(mapAgent(agent("ag-worker"), section)).toMatchObject({
      project: "pj-orchard", team: "tm-alpha", role: "builder", state: "waiting", activity: "Waiting on a permission",
      permission: "Edit files without asking", harness: "claude", subscription: "acct-main", model: "opus", effort: "high"
    })
    expect(mapAgent(agent("ag-team-lead"), section)).toMatchObject({ role: "team-lead", team: "tm-alpha" })
  })
  it("gives a failed start its reason", () => {
    expect(mapAgent(agent("ag-failed"), section)?.failure).toEqual({ reason: "Not signed in" })
  })
  it("leaves out an agent that is in no project", () => {
    expect(mapAgent(agent("ag-outside"), section)).toBeUndefined()
  })
  it("makes a stopped lead for a project whose lead is not in the roster", () => {
    const lead = placeholderLead(mapProject(section.projects[1]!, section.workspaces))
    expect(lead).toMatchObject({ id: "ag-gone", project: "pj-orphan", role: "project-lead", state: "stopped" })
  })
})

describe("requests", () => {
  const agents = engineSnapshot.agents.flatMap((a) => mapAgent(a, section) ?? [])
  it("maps a permission request as an approval with its options", () => {
    expect(mapRequest(engineSnapshot.requests[0]!, "approval", agents)).toEqual({
      sourceSequence: 30, id: "perm-1", kind: "approval", agent: "ag-worker", project: "pj-orchard", task: null, title: "Run the orchard checks",
      body: "Run the orchard checks\nnpm test", command: null, folder: "", tool: "execute", recommendation: null,
      options: [{ id: "allow", label: "Allow once", primary: true }, { id: "deny", label: "Deny" }],
      createdAt: 1_700_000_100_000, status: "open", heldBy: null
    })
  })
  it("keeps a question's title, recommendation, project and task", () => {
    expect(mapRequest(engineSnapshot.questions[0]!, "question", agents)).toMatchObject({
      kind: "question", title: "Which branch should the release use?", recommendation: "Use the release branch.", project: "pj-orchard", task: "tk-1"
    })
  })
  it("marks a request that an agent holds", () => {
    expect(mapRequest(engineSnapshot.requests[1]!, "approval", agents)?.heldBy).toBe("ag-team-lead")
  })
  it("leaves out a request that belongs to no project", () => {
    expect(mapRequest(engineSnapshot.questions[1]!, "question", agents)).toBeUndefined()
  })
})

describe("subscriptions", () => {
  it("lists each account the engine or an agent names, with its harness and sign-in", () => {
    const accounts = [{ id: "acct-main", status: "available", enabled: true, environment: [] }, { id: "codex", status: "needs-sign-in", enabled: false, environment: [] },
      { id: "acct-unknown", status: "available", enabled: true, environment: [] }] as never
    expect(mapSubscriptions(accounts, engineSnapshot.agents, "local")).toEqual([
      { id: "acct-main", harness: "claude", name: "acct-main", machine: "local", enabled: true, signedIn: true, useForNew: false, usage: null, window: null, account: null, model: "" },
      { id: "codex", harness: "codex", name: "codex", machine: "local", enabled: false, signedIn: false, useForNew: false, usage: null, window: null, account: null, model: "" }
    ])
  })
})

describe("sprints and tasks", () => {
  it("puts a sprint in the board column of its phase", () => {
    expect(columnOf({ phase: "Plan" })).toBe("Planned")
    expect(columnOf({ phase: "Verify" })).toBe("In progress")
    expect(columnOf({ phase: "Hand over" })).toBe("Review")
    expect(columnOf({ phase: "Build", completedAt: 1 as never })).toBe("Done")
    expect(mapSprint(section.sprints[0]!, section.tasks)).toMatchObject({ id: "sp-a", label: "HR-1", column: "In progress", team: "tm-alpha", dependsOn: [] })
    expect(mapSprint(section.sprints[1]!, section.tasks)).toMatchObject({ column: "Done", team: null, dependsOn: ["sp-a"] })
  })
  it("maps a task with its label, sprint, team and owner", () => {
    expect(mapTask(section.tasks[0]!)).toEqual({ id: "tk-1", project: "pj-orchard", label: "HR-11", title: "Write the counter",
      sprint: "sp-a", team: "tm-alpha", owner: "ag-worker", state: "active", points: null, files: [], history: [] })
  })
})

describe("a whole snapshot", () => {
  it("fills every collection, and every project has a lead", () => {
    const records = mapSnapshot(engineSnapshot, now)
    expect(records.repos.map((r) => r.id)).toEqual(["rp-orchard"])
    expect(records.projects.map((p) => p.id)).toEqual(["pj-orchard", "pj-orphan"])
    expect(records.agents.map((a) => a.id)).toEqual(["ag-lead", "ag-team-lead", "ag-worker", "ag-failed", "ag-gone"])
    expect(records.requests.map((r) => r.id)).toEqual(["perm-1", "perm-held", "q-1"])
    expect(records.teams).toHaveLength(1)
    expect(records.worktrees).toHaveLength(3)
    expect(records.machines.map((m) => m.id)).toEqual(["local"])
    for (const project of records.projects) expect(records.agents.some((a) => a.id === project.lead)).toBe(true)
  })
  it("gives empty collections for a snapshot without a project section", () => {
    const { project: _, ...rest } = engineSnapshot
    const records = mapSnapshot({ ...rest, agents: [], requests: [], questions: [] }, now)
    expect(records.machines.map((m) => m.id)).toEqual(["local"])
    expect({ ...records, machines: [] }).toEqual({ machines: [], subscriptions: [], repos: [], projects: [], teams: [], agents: [], requests: [], worktrees: [], sprints: [], tasks: [] })
  })
  it("does not change the engine's records", () => {
    const before = JSON.stringify(engineSnapshot)
    mapSnapshot(engineSnapshot, now)
    expect(JSON.stringify(engineSnapshot)).toBe(before)
  })
})
