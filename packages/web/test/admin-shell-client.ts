import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"

export const adminSnapshot = {
  requestId: "snapshot", sequence: 7, agents: [], requests: [], questions: [], requestsWithoutDisplay: 0, questionsWithoutDisplay: 0,
  project: { sequence: 7, truncated: false, projects: [], repositories: [], workspaces: [], teams: [], sprints: [], tasks: [], agents: [] }
}
export const adminShellClient = () => ({
  "client.snapshot": () => Effect.succeed(adminSnapshot),
  "client.subscribe": () => Stream.never,
  "client.requests": () => Effect.succeed({ requestId: "requests", sequence: 7, items: [] }),
  "client.alerts.list": () => Effect.succeed({ requestId: "alerts", items: [] }),
  "client.sequence": () => Effect.succeed({ requestId: "sequence", sequence: 7 })
})
