import { expect, it, vi } from "vitest"
import * as Effect from "effect/Effect"
import type { Client } from "@lgcode/client/browser"
import type { ClientSnapshot } from "@lgcode/contracts"
import { readNavigation, stringPages } from "../src/data/projectReads.ts"

const snapshot = (project?: object, failedSections?: string[]) => ({ sequence: 1, agents: [], requests: [], questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0,
  ...(project ? { project } : {}), ...(failedSections ? { failedSections } : {}) }) as unknown as ClientSnapshot
const repo = { repoId: "r", name: "Repository", path: "/real" }
const workspace = { worktreeId: "w", repoId: "r", branch: "main", machineId: "local", path: "/real" }
const project = { projectId: "p", repoId: "r", name: "Project", goal: "Ship", leadAgentId: "lead", worktreeId: "w", machineId: "local" }
const section = { sequence: 1, truncated: false, projects: [project], repositories: [repo], workspaces: [workspace], teams: [], agents: [], sprints: [], tasks: [] }

it("uses a complete engine section directly without an alternate projection", async () => {
  const read = vi.fn()
  const result = await Effect.runPromise(readNavigation({ "project.read": read } as unknown as Client, snapshot(section)))
  expect(result).toEqual(section)
  expect(read).not.toHaveBeenCalled()
})
it.each([snapshot({ ...section, truncated: true }), snapshot(undefined, ["project"])])("recovers an omitted or truncated navigation section with scoped paged real reads", async (initial) => {
  const read = vi.fn(({ collection, projectId: selected }: { collection: string; projectId?: string }) => {
    if (collection !== "projects") expect(selected).toBe("p")
    return Effect.succeed({ items: collection === "projects" ? [project] : [] })
  })
  const result = await Effect.runPromise(readNavigation({
    "project.repositories": () => Effect.succeed({ items: [repo] }),
    "project.workspaces": () => Effect.succeed({ items: [workspace] }),
    "project.read": read
  } as unknown as Client, initial))
  expect(result.projects).toEqual([project])
  expect(result.repositories).toEqual([repo])
  expect(read.mock.calls.map(([payload]) => payload.collection)).toEqual(["projects", "teams", "agents"])
})
it("follows distinct string cursors and refuses repeated or empty continuation pages", async () => {
  const read = vi.fn(({ after }: { after?: string }) => Effect.succeed(after === undefined ? { items: [1], next: "a" } : { items: [2] }))
  expect(await Effect.runPromise(stringPages(read))).toEqual([1, 2])
  expect(read.mock.calls[1]).toEqual([{ after: "a" }])
  await expect(Effect.runPromise(stringPages(() => Effect.succeed({ items: [1], next: "a" })))).rejects.toThrow()
  await expect(Effect.runPromise(stringPages(() => Effect.succeed({ items: [], next: "a" })))).rejects.toThrow()
})
it("refuses a recovered project with a missing workspace rather than publishing an empty or broken tree", async () => {
  const client = { "project.repositories": () => Effect.succeed({ items: [repo] }), "project.workspaces": () => Effect.succeed({ items: [] }),
    "project.read": ({ collection }: { collection: string }) => Effect.succeed({ items: collection === "projects" ? [project] : [] }) }
  await expect(Effect.runPromise(readNavigation(client as unknown as Client, snapshot(undefined, ["project"])))).rejects.toThrow()
})
