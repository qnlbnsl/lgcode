import type { Client } from "@lgcode/client/browser"
import { Project, Team, ProjectAgentSummary, type ClientSnapshot } from "@lgcode/contracts"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { requestId } from "../thread/client.ts"

type ProjectSection = NonNullable<ClientSnapshot["project"]>
export type NavigationData = Pick<ProjectSection, "projects" | "repositories" | "workspaces" | "teams" | "agents">

// The engine owns these collections. Page the real read APIs only when the
// bounded snapshot cannot supply a complete navigation tree.
export const readNavigation = (client: Client, snapshot: ClientSnapshot) => Effect.gen(function* () {
  if (snapshot.project !== undefined && !snapshot.project.truncated && !snapshot.failedSections?.includes("project")) return snapshot.project satisfies NavigationData
  const repositories = yield* stringPages((after) => client["project.repositories"]({ requestId: requestId(), limit: 200, ...after }))
  const workspaces = yield* stringPages((after) => client["project.workspaces"]({ requestId: requestId(), limit: 200, ...after }))
  const read = (collection: "projects" | "teams" | "agents", projectId?: Project["projectId"]) => stringPages((after) =>
    client["project.read"]({ requestId: requestId(), collection, limit: 200, ...after, ...(projectId === undefined ? {} : { projectId }) }).pipe(
      Effect.flatMap((reply) => "items" in reply ? Effect.succeed(reply) : Effect.fail(new Error("Navigation unavailable")))))
  const projects = (yield* read("projects")).map((row) => Schema.decodeUnknownSync(Project)(row))
  const teams: Team[] = []
  const agents: Array<typeof ProjectAgentSummary.Type> = []
  for (const project of projects) {
    teams.push(...(yield* read("teams", project.projectId)).map((row) => Schema.decodeUnknownSync(Team)(row)))
    agents.push(...(yield* read("agents", project.projectId)).map((row) => Schema.decodeUnknownSync(ProjectAgentSummary)(row)))
  }
  if (projects.some((row) => !repositories.some((repo) => repo.repoId === row.repoId) || !workspaces.some((workspace) => workspace.worktreeId === row.worktreeId))
    || teams.some((row) => !workspaces.some((workspace) => workspace.worktreeId === row.worktreeId))) return yield* Effect.fail(new Error("Incomplete navigation relations"))
  return { projects, repositories, workspaces, teams, agents } satisfies NavigationData
})

export function stringPages<A, E>(read: (after: { after?: string }) => Effect.Effect<{ readonly items: ReadonlyArray<A>; readonly next?: string }, E>) {
  return Effect.gen(function* () {
    const items: A[] = []
    const seen = new Set<string>()
    let after: string | undefined
    for (;;) {
      const page = yield* read(after === undefined ? {} : { after })
      items.push(...page.items)
      if (page.next === undefined) return items
      if (!page.items.length || seen.has(page.next)) return yield* Effect.fail(new Error("Navigation cursor did not advance"))
      seen.add(page.next)
      after = page.next
    }
  })
}
