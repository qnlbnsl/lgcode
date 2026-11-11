import { readFileSync } from "node:fs"
import * as Schema from "effect/Schema"
import { expect, it } from "vitest"
import { DesignRegistration, DesignTokensPath, ProjectEvent, ProjectRpcGroup, TaskStory, commandAccess, eventVisibility, projectAgentStatus, projectTeamGroup, sprintStatus } from "../src/index.ts"

it("decodes the relevant golden event shapes without loading sample data in production", () => {
  const rows = JSON.parse(readFileSync(new URL("../../../design/data/sample/events.json", import.meta.url), "utf8")) as { payload_json: string }[]
  const tags = new Set(ProjectEvent.members.map((member) => member.fields._tag.schema.literal))
  const inputs = rows.map((row) => JSON.parse(row.payload_json)).filter((event) => tags.has(event._tag))
  expect(inputs.length).toBeGreaterThan(20)
  for (const event of inputs) expect(Schema.decodeUnknownSync(ProjectEvent)(event)).toEqual(event)
})

it("derives sprint columns in priority order and keeps nonworking agents out of Working", () => {
  expect(sprintStatus({ completion: "verified" }, [{ state: "blocked" }])).toBe("done")
  expect(sprintStatus({}, [{ state: "review" }, { state: "blocked" }])).toBe("active")
  expect(sprintStatus({}, [{ state: "review" }, { state: "queue" }])).toBe("review")
  expect(sprintStatus({}, [{ state: "done" }])).toBe("planned")
  expect(sprintStatus({}, [])).toBe("planned")
  expect(projectAgentStatus({ needsOwner: true, state: "idle", tasks: [] })).toBe("Needs you")
  expect(projectAgentStatus({ needsOwner: false, state: "idle", tasks: [{ state: "review" }] })).toBe("Reviewing")
  expect(projectAgentStatus({ needsOwner: false, state: "working", tasks: [] })).toBe("Working")
  expect(projectAgentStatus({ needsOwner: false, state: "stopped", tasks: [{ state: "active" }] })).toBe("Ready")
  expect(projectAgentStatus({ needsOwner: false, state: "idle", tasks: [] })).toBe("Ready")
  expect(projectTeamGroup("project", "build")).toBe("team:project/build")
})

it("bounds a story so an accepted record fits a bounded read", () => {
  expect(Schema.is(TaskStory)({ summary: "A useful summary", done: [], activity: [] })).toBe(true)
  expect(Schema.is(TaskStory)({ summary: "", done: Array(128).fill("x".repeat(8192)), activity: [] })).toBe(false)
})

it("requires access and visibility decisions for every registered project operation", () => {
  for (const name of ProjectRpcGroup.requests.keys()) expect(commandAccess[name as keyof typeof commandAccess]).toContain("owner")
  expect(commandAccess["project.create"]).not.toContain("agent")
  expect(commandAccess["project.settings.set"]).not.toContain("agent")
  for (const event of ProjectEvent.members) expect(eventVisibility[event.fields._tag.schema.literal]).toBe("owner-only")
})

it.each(["abc", "hunter2", "sk-ant-api03-AAAAAAAAAAAAAAAA", "secret", "secret:", "SECRET:x y",
  "../outside.json", "/tmp/tokens.json", "design//tokens.json", "design/./tokens.json", "design/../tokens.json",
  "design\\tokens.json", "design/%2e%2e/tokens.json", "design/.git/tokens.json", ".codex/auth.json",
  ".env/tokens.json", "design/.env.local/tokens.json", "auth.json", "tokens.txt", "tokens.json/", "tokens\u0000.json"
])("refuses a raw value or unconfined token-document path at contract admission: %s", (tokensPath) => {
  expect(Schema.is(DesignTokensPath)(tokensPath)).toBe(false)
  expect(() => Schema.decodeUnknownSync(DesignRegistration)({ repoId: "repo", worktreeId: "workspace", file: "actual.pen", tokensPath, components: [] })).toThrow()
})

it.each(["tokens.json", "design/theme.JSON", "design tokens/colors.json"])("admits an explicit relative JSON token-document path: %s", (tokensPath) => {
  const registration = { repoId: "repo", worktreeId: "workspace", file: "actual.pen", tokensPath, components: [] }
  expect(Schema.decodeUnknownSync(DesignRegistration)(registration)).toEqual(registration)
})

it("retains an absent token document without inventing a path", () => {
  const registration = { repoId: "repo", worktreeId: "workspace", file: "actual.pen", components: [] }
  expect(Schema.decodeUnknownSync(DesignRegistration)(registration)).toEqual(registration)
})
