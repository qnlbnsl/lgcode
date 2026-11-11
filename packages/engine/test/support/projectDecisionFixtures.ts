import * as Effect from "effect/Effect"
import { agentCredential, appendSetup, call, eventOf, seedAccount, seedAgent, seedHarness, success } from "./handlerRig.ts"

// Historical project records enter through the real typed writer. New requests,
// teams, sprints and tasks use the authenticated handler. Lifecycle launch is
// exercised separately by the real-child notification journey.
export const decisionProject = (prefix = "one") => Effect.gen(function* () {
  const leadId = `${prefix}-lead`, workerId = `${prefix}-worker`
  const lead = yield* seedAgent({ id: leadId, state: "working" })
  const worker = yield* seedAgent({ id: workerId, parent: leadId, state: "working" })
  const projectId = `${prefix}-project`, repoId = `${prefix}-repo`, worktreeId = `${prefix}-workspace`
  yield* appendSetup([
    eventOf({ _tag: "project.RepositoryAdded", repoId, name: "Repository", path: "/tmp" }),
    eventOf({ _tag: "project.WorktreeCreated", repoId, worktreeId, branch: "topic", path: "/tmp", machineId: "local" }),
    eventOf({ _tag: "project.Created", projectId, repoId, worktreeId, leadAgentId: leadId, machineId: "local", name: "Project", goal: "Real decisions" }),
  ])
  const credential = agentCredential(lead.token)
  const team = success(yield* call(credential, "project.team.create", { projectId, name: "Build", worktreeId }))
  success(yield* call(credential, "group", { agentId: workerId, add: [team.group], remove: [] }))
  const sprintId = success(yield* call(credential, "project.sprint.create", { projectId, label: "SP-1", name: "Sprint", goal: "Decide", phase: "Build", owner: leadId, needs: [] })).sprintId as string
  const task = { projectId, teamId: team.teamId, sprintId, worktreeId, owner: workerId, title: "Work", state: "active" }
  return { projectId, repoId, worktreeId, leadId, workerId, lead, worker, leadCredential: credential, workerCredential: agentCredential(worker.token), sprintId, team, task }
})
export const decisionSetup = () => Effect.gen(function* () { yield* seedAccount(); yield* seedHarness(); return yield* decisionProject() })
