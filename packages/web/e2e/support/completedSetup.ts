import * as Effect from "effect/Effect"
import { appendSetup, call, eventOf, ownerCredential, seedAgent, success } from "../../../engine/test/support/handlerRig.ts"

// Existing pre-project browser journeys now run after positive setup. Their
// historical stopped lead/project enter through the typed writer, just like
// decisionProject; actual progress and completion use authenticated handlers.
// First-run tests do not call this helper.
export const completedSetup = (existingProjectId?: string, path = "/tmp", repositoryName = "Setup history") => Effect.gen(function* () {
  let projectId = existingProjectId
  if (projectId === undefined) {
    const lead = yield* seedAgent({ id: "setup-history-lead", state: "stopped" })
    projectId = "setup-history-project"
    yield* appendSetup([
      eventOf({ _tag: "project.RepositoryAdded", repoId: "setup-history-repo", name: repositoryName, path }),
      eventOf({ _tag: "project.RepositoryLocated", repoId: "setup-history-repo", machineId: "local", path }),
      eventOf({ _tag: "project.WorktreeCreated", repoId: "setup-history-repo", worktreeId: "setup-history-worktree", branch: "main", path, machineId: "local" }),
      eventOf({ _tag: "project.Created", projectId, repoId: "setup-history-repo", worktreeId: "setup-history-worktree", leadAgentId: lead.agentId, name: "Setup history", goal: "Historical completed setup", machineId: "local" })
    ])
  }
  success(yield* call(ownerCredential, "project.setup.advance", { step: "found" }))
  success(yield* call(ownerCredential, "project.setup.advance", { step: "project" }))
  success(yield* call(ownerCredential, "project.setup.complete", { projectId }))
})
