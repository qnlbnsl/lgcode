import { describe, expect, it } from "vitest"
import { mapSnapshot, type EngineRecords } from "../src/mapping.ts"
import { engineSnapshot } from "./fixtures.ts"

function relationships(s: EngineRecords) {
  const has = (key: keyof EngineRecords, id: string | null) => id === null || s[key].some((row) => row.id === id)
  for (const p of s.projects) { expect(has("repos", p.repo), `project ${p.id} repository`).toBe(true); expect(has("agents", p.lead), `project ${p.id} lead`).toBe(true); expect(has("machines", p.machine)).toBe(true) }
  for (const a of s.agents) { expect(has("projects", a.project), `agent ${a.id} project`).toBe(true); expect(has("teams", a.team)).toBe(true); if (a.subscription) expect(has("subscriptions", a.subscription)).toBe(true) }
  for (const t of s.teams) expect(has("projects", t.project)).toBe(true)
  for (const r of s.requests) { expect(has("projects", r.project), `request ${r.id} project`).toBe(true); expect(has("agents", r.agent), `request ${r.id} agent`).toBe(true); expect(has("agents", r.heldBy)).toBe(true); expect(has("tasks", r.task)).toBe(true) }
  for (const t of s.tasks) { expect(has("projects", t.project)).toBe(true); expect(has("teams", t.team)).toBe(true); expect(has("sprints", t.sprint)).toBe(true); expect(has("agents", t.owner)).toBe(true) }
  for (const sp of s.sprints) { expect(has("projects", sp.project)).toBe(true); expect(has("teams", sp.team)).toBe(true); for (const id of sp.dependsOn) expect(has("sprints", id)).toBe(true) }
  for (const w of s.worktrees) { expect(has("repos", w.repo)).toBe(true); expect(has("projects", w.project)).toBe(true); expect(has("teams", w.team)).toBe(true); expect(has("agents", w.owner)).toBe(true); expect(has("machines", w.machine)).toBe(true); if (w.parent !== null) expect(s.worktrees.some((p) => p.repo === w.repo && p.branch === w.parent)).toBe(true) }
}

describe("relationships in truncated snapshots (finding 2)", () => {
  for (const key of ["projects", "repositories", "workspaces", "teams", "sprints", "tasks", "agents"] as const) {
    it(`keeps references valid when project ${key} are omitted`, () => {
      const section = engineSnapshot.project!
      const s = mapSnapshot({ ...engineSnapshot, project: { ...section, truncated: true, [key]: [] } }, 1)
      relationships(s)
      if (key === "agents") {
        expect(s.requests.some((r) => r.id === "q-1")).toBe(true)
        expect(s.agents.find((a) => a.id === "ag-team-lead")?.team).toBe("tm-alpha")
      }
    })
  }
  it("handles partially omitted parents and roster entries", () => {
    const section = engineSnapshot.project!
    relationships(mapSnapshot({ ...engineSnapshot, agents: [], project: { ...section, truncated: true,
      projects: section.projects.slice(1), sprints: section.sprints.slice(1), teams: [] } }, 1))
  })
})
