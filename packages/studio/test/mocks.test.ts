import { describe, expect, it } from "vitest"
import type { MockRevision, MockApproval, RepositoryDesignResult, Discovery } from "@lgtm/contracts"
import { mapMocks, mapDesign, mapMachineDetails, validDisplayFrame } from "../src/mocks.ts"
const revision = { projectId: "project", revisionId: "revision-2", at: 123, author: { _tag: "agent", agentId: "designer" }, artifacts: [{ sourceId: "screens", fingerprint: "abc" }],
  bundle: { sources: [], screens: [{ screenId: "requests", sourceId: "screens", name: "Requests", route: "/requests", scenarioRoutes: [], summary: "Actual summary" }],
    components: [{ name: "Card", provenance: "shared", screens: ["requests"] }], scenarios: [], draftedFields: [] },
  comparisons: [{ status: "differs", field: { entity: "request", name: "title", type: "string", description: "Actual field description", screens: ["requests"] } }] } as unknown as MockRevision

describe("mock records", () => {
  it("maps the exact head and whole revision approval without inventing per-screen changes", () => {
    const before = JSON.stringify(revision)
    const mapped = mapMocks([revision], { revisionId: "revision-2", at: 140 } as MockApproval)
    expect(mapped.screens[0]).toMatchObject({ id: "requests", name: "Requests", rev: "revision-2", status: "approved", comments: [], updatedAt: 123, kind: null, note: "Actual summary" })
    expect(mapped.screens[0]!.selection).toEqual({ _tag: "mock", projectId: "project", revisionId: "revision-2", screenId: "requests" })
    expect(mapped.changes[0]).toMatchObject({ to: "revision-2", from: null, text: "", seen: null, by: "designer" })
    expect(mapped.data[0]).toEqual({ field: "request.title", schema: "differs", on: "Requests", sample: "", note: "Actual field description" })
    expect(mapped.components[0]).toMatchObject({ real: true, uses: null, demo: null, on: ["Requests"] })
    expect(JSON.stringify(revision)).toBe(before)
  })
  it("does not carry an old approval onto a new head, and handles absent optional fields", () => {
    const next = { ...revision, revisionId: "new-head", bundle: { ...revision.bundle, screens: [{ ...revision.bundle.screens[0]!, summary: undefined }] } } as unknown as MockRevision
    const mapped = mapMocks([revision, next], { revisionId: revision.revisionId, at: 140 } as MockApproval)
    expect(mapped.approvedAt).toBeNull()
    expect(mapped.screens[0]).toMatchObject({ status: "draft", rev: "new-head", note: "" })
    expect(mapped.changes).toHaveLength(2)
    expect(mapMocks([])).toMatchObject({ screens: [], components: [], data: [], changes: [], approvedAt: null, revisionId: null })
  })
})
describe("repository design", () => {
  it("shows only registered components and actual token values", () => {
    const result = { _tag: "registered", record: { design: { file: "actual.pen" }, revisionId: "design-revision", projectId: "project", at: 123, author: { _tag: "owner" } }, file: { _tag: "available" },
      tokens: { _tag: "available", tokens: [{ name: "ink", value: "#123456" }] }, components: [{ componentId: "card", name: "Registered Card", reference: "card.html", variants: "Compact", availability: { _tag: "unavailable" } }] } as unknown as typeof RepositoryDesignResult.Type
    expect(mapDesign(result)).toMatchObject({ file: "actual.pen", changedBy: "owner", changedAt: 123, size: null, pages: null, frames: null, commit: null,
      tokens: [{ name: "ink", value: "#123456" }], components: [{ id: "card", variants: "Compact", available: false, preview: true }] })
    expect(mapDesign({ _tag: "unavailable", reason: "repository design is not registered" })).toBeNull()
    expect(mapDesign({ ...result, tokens: { _tag: "unavailable", reason: "artifact unavailable" } } as typeof RepositoryDesignResult.Type)?.tokens).toEqual([])
  })
})
describe("local machine details", () => {
  it("maps discovery readiness, saved workspace and port without invented versions or load", () => {
    const discovery = { state: "available", harnesses: [{ harness: "cursor", installed: true, accounts: [{ state: "local-credential" }, { state: "signed-out" }, { state: "unavailable" }] }] } as unknown as typeof Discovery.Type
    expect(mapMachineDetails(discovery, { workspaceFolder: "/srv/work", shell: "bash" }, 8794)).toEqual({ workspace: "/srv/work", port: 8794, harnesses: [{ id: "cursor", installed: true, signedIn: 1 }], reason: "" })
    expect(mapMachineDetails({ ...discovery, state: "unavailable" } as typeof Discovery.Type)).toMatchObject({ workspace: "", port: null, reason: "Discovery unavailable" })
  })
})
describe("isolated displays", () => {
  it("accepts only a live HTTPS frame on its separate authenticated origin", () => {
    const frame = { displayOrigin: "https://display.example.test", url: "https://display.example.test/session/private", expiresAt: 100 }
    expect(validDisplayFrame(frame, "studio.example.test", 1)).toBe(true)
    for (const patch of [{ displayOrigin: "https://display.example.test/path" }, { url: "https://other.example.test/" }, { url: "https://user:password@display.example.test/" }, { expiresAt: 0 }, { url: "bad" }])
      expect(validDisplayFrame({ ...frame, ...patch }, "studio.example.test", 1)).toBe(false)
    expect(validDisplayFrame(frame, "display.example.test", 1)).toBe(false)
    expect(validDisplayFrame({ displayOrigin: "http://display.example.test", url: "http://display.example.test/", expiresAt: 100 }, "studio.example.test", 1)).toBe(false)
  })
})

describe("search over loaded navigation records", () => {
  it("indexes engine goals, branches and sprints without sample prose or agent activity", async () => {
    const { mapSnapshot } = await import("../src/mapping.ts")
    const { engineSnapshot } = await import("./fixtures.ts")
    const { mapSearchText } = await import("../src/mocks.ts")
    const records = mapSnapshot(engineSnapshot, 1)
    const before = JSON.stringify(records)
    const text = mapSearchText(records)
    expect(text.repositories).toEqual({ "rp-orchard": "" })
    expect(text.projects["pj-orchard"]).toContain("Count the apples every morning.")
    expect(text.projects["pj-orchard"]).toContain("feature/harvest")
    expect(text.projects["pj-orchard"]).toContain("Mail it.")
    expect(text.projects["pj-orphan"]).toBeUndefined()
    expect(text.agents["ag-worker"]).toContain("Alpha team")
    expect(text.agents["ag-worker"]).not.toContain("Waiting on a permission")
    expect(text.agents["ag-gone"]).toBeUndefined()
    expect(JSON.stringify(records)).toBe(before)
  })
  it("keeps the mock's word ranking, name weighting and role boost", async () => {
    const { searchScore } = await import("../../../design/mock/js/dialogs.js" as string) as { searchScore(query: string, item: { label: string; text: string; kind: string; boost?: number }): number }
    const title = { label: "Apple report", text: "", kind: "Project" }
    const body = { label: "Daily totals", text: "apple report", kind: "Project" }
    expect(searchScore("apple reports", title)).toBeGreaterThan(searchScore("apple reports", body))
    expect(searchScore("project", title)).toBeGreaterThan(searchScore("project", { ...title, kind: "Agent" }))
    expect(searchScore("the of", title)).toBe(0)
    expect(searchScore("unrelated", title)).toBe(0)
    expect(searchScore("lead", { label: "Project lead", text: "", kind: "Agent", boost: 0.5 })).toBeGreaterThan(searchScore("lead", { label: "Project lead", text: "", kind: "Agent" }))
  })
})
