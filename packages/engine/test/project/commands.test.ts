import { randomBytes } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Redacted from "effect/Redacted"
import { afterEach, beforeEach, expect, vi } from "vitest"
import { ClientSnapshot, CommandsRpcGroup, ProjectSnapshot, sprintStatus } from "@lgcode/contracts"
import * as Server from "../../src/api/server.ts"
import { ancestryHeaders, connect, upgradeStatus } from "../support/socketClient.ts"
import { Views } from "../../src/views/Views.ts"
import { projectView, projectKey } from "../../src/project/view.ts"
import { snapshotFor } from "../../src/project/snapshot.ts"
import { channelMembers } from "../../src/board/access.ts"
import { provideBoard } from "../board/wakeFixtures.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { agentCredential, call, failureOf, seedAccount, seedAgent, seedHarness, success, ownerCredential as owner, makeRig, removeRig, freshRequest, type Rig } from "../support/handlerRig.ts"

let rig: Rig
const git = (folder: string, ...args: string[]) => execFileSync("git", ["-C", folder, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
beforeEach(() => {
  rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder)
  git(rig.work, "init", "-b", "main")
  git(rig.work, "-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Initialize")
})
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig) })
const snapshot = Effect.gen(function* () { return yield* (yield* Views).snapshot })
const foundation = () => Effect.gen(function* () {
  yield* registerRebuildCheck(); yield* seedAccount(); yield* seedHarness()
  const lead = agentCredential((yield* seedAgent({ id: "lead", folder: rig.work })).token)
  const worker = agentCredential((yield* seedAgent({ id: "worker", parent: "lead" })).token)
  const sibling = agentCredential((yield* seedAgent({ id: "sibling", parent: "lead" })).token)
  const stranger = agentCredential((yield* seedAgent({ id: "stranger" })).token)
  const repoId = success(yield* call(owner, "project.repository.add", { name: "Product", path: rig.work, machineId: "local" })).repoId
  const worktreeId = success(yield* call(owner, "project.workspace.register", { repoId, machineId: "local", branch: "main", path: rig.work, checkout: "main" })).worktreeId
  const projectId = success(yield* call(owner, "project.create", { name: "Console", goal: "Make work visible", leadAgentId: "lead", repoId, worktreeId, machineId: "local" })).projectId
  const team = success(yield* call(lead, "project.team.create", { projectId, name: "Build", worktreeId, stage: "build" }))
  success(yield* call(lead, "group", { agentId: "worker", add: [team.group], remove: [] }))
  success(yield* call(lead, "group", { agentId: "sibling", add: [team.group], remove: [] }))
  const sprintId = success(yield* call(lead, "project.sprint.create", { projectId, label: "SP-01", name: "Foundation", goal: "Store real work", phase: "Build", owner: "lead", needs: [] })).sprintId
  const taskPayload = { projectId, teamId: team.teamId, sprintId, worktreeId, owner: "worker", title: "Implement records", state: "queue" }
  return { lead, worker, sibling, stranger, repoId, projectId, worktreeId, team, sprintId, taskPayload }
})

it.live("uses real handlers for ownership, project inheritance, team groups, and paged reads", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* foundation()
  const later = agentCredential((yield* seedAgent({ id: "later", parent: "worker", groups: [f.team.group] })).token)
  success(yield* call(f.lead, "group", { agentId: "worker", add: [f.team.group], remove: [] }))
  const state = yield* snapshot
  expect(projectView(state).agentProjects).toMatchObject({ lead: f.projectId, worker: f.projectId, later: f.projectId })
  expect(channelMembers(state, f.team.channelId).map((row) => row._tag === "agent" ? row.agentId : row._tag)).toEqual(["lead", "worker", "sibling", "later"])
  expect(failureOf(yield* call(f.stranger, "project.read", { projectId: f.projectId, collection: "tasks" }))).toBeDefined()
  expect(failureOf(yield* call(f.worker, "project.sprint.create", { projectId: f.projectId, label: "SP-02", name: "Bad", goal: "", phase: "Plan", owner: "worker", needs: [] }))).toBeDefined()
  expect(failureOf(yield* call(f.lead, "project.settings.set", { settings: { workspaceFolder: rig.work, shell: "zsh" } }))).toBeDefined()
  success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.work, shell: "zsh" } }))
  expect(success(yield* call(owner, "project.settings", {})).settings).toEqual({ workspaceFolder: rig.work, shell: "zsh" })
  const taskId = success(yield* call(f.lead, "project.task.create", f.taskPayload)).taskId
  success(yield* call(f.worker, "project.task.update", { projectId: f.projectId, taskId, state: "active" }))
  expect(failureOf(yield* call(f.sibling, "project.task.update", { projectId: f.projectId, taskId, state: "done" }))).toBeDefined()
  expect(failureOf(yield* call(f.worker, "project.task.update", { projectId: f.projectId, taskId, owner: "sibling" }))).toBeDefined()
  expect(failureOf(yield* call(f.worker, "project.task.create", f.taskPayload))).toBeDefined()
  success(yield* call(owner, "project.task.update", { projectId: f.projectId, taskId, owner: "sibling" }))
  expect(failureOf(yield* call(f.worker, "project.task.note", { projectId: f.projectId, taskId, title: "Old owner", detail: "Denied" }))).toBeDefined()
  success(yield* call(f.sibling, "project.task.note", { projectId: f.projectId, taskId, title: "/tool is data", detail: "Handed to review" }))
  const first = success(yield* call(owner, "project.task.history", { projectId: f.projectId, taskId, limit: 2 }))
  expect(first.items).toHaveLength(2); expect(first.next).toBe("1")
  const second = success(yield* call(owner, "project.task.history", { projectId: f.projectId, taskId, after: first.next }))
  expect(second.items).toHaveLength(2)
  expect([...first.items, ...second.items].every((row) => row.at > 0)).toBe(true)
  const read = success(yield* call(later, "project.read", { projectId: f.projectId, collection: "tasks" }))
  expect(read.data).toContain("Implement records")
  expect(read.data).not.toContain("history")
  Schema.decodeUnknownSync(CommandsRpcGroup.requests.get("project.read")!.successSchema as never)(read)
  expect(failureOf(yield* call(owner, "project.read", { projectId: f.projectId, collection: "tasks", after: "missing" }))).toBeDefined()
  success(yield* call(f.lead, "ask", { text: "Choose the handoff target." }))
  const client = success(yield* call(owner, "client.snapshot", {}))
  Schema.decodeUnknownSync(ClientSnapshot)(client)
  expect(client.project.projects[0].goal).toBe("Make work visible")
  expect(client.project.agents.find((row: { agentId: string }) => row.agentId === "lead").status).toBe("Needs you")
})).pipe(Effect.orDie))

it.live("refuses duplicate project names and invalid repository, workspace, sprint, and task links", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* foundation()
  const create = { name: "CONSOLE", goal: "", repoId: f.repoId, worktreeId: f.worktreeId, machineId: "local", leadAgentId: "stranger" }
  expect(failureOf(yield* call(owner, "project.create", create))?.reason).toContain("name already exists")
  expect(failureOf(yield* call(owner, "project.create", { ...create, name: "Other", repoId: "missing" }))).toBeDefined()
  expect(failureOf(yield* call(owner, "project.create", { ...create, name: "Other", machineId: "missing" }))).toBeDefined()
  expect(failureOf(yield* call(owner, "project.create", { ...create, name: "Other", leadAgentId: "worker" }))).toBeDefined()
  expect(failureOf(yield* call(owner, "project.repository.add", { name: "Subfolder", path: rig.home, machineId: "local" }))).toBeDefined()
  expect(failureOf(yield* call(owner, "project.repository.add", { name: "Wrong machine", path: rig.work, machineId: "worker-machine" }))).toBeDefined()
  expect(failureOf(yield* call(owner, "project.workspace.register", { repoId: f.repoId, machineId: "local", path: rig.work, branch: "invented", checkout: "main" }))).toBeDefined()
  expect(failureOf(yield* call(f.lead, "project.task.create", { ...f.taskPayload, teamId: "missing" }))).toBeDefined()
  expect(failureOf(yield* call(f.lead, "project.task.create", { ...f.taskPayload, owner: "stranger" }))).toBeDefined()
  yield* seedAgent({ id: "unlabelled", parent: "lead" })
  expect(failureOf(yield* call(f.lead, "project.task.create", { ...f.taskPayload, owner: "unlabelled" }))).toBeDefined()
  expect(failureOf(yield* call(f.lead, "project.task.create", { ...f.taskPayload, sprintId: "missing" }))).toBeDefined()
  const otherPath = join(rig.root, "other"); mkdirSync(otherPath); git(otherPath, "init", "-b", "main")
  const otherRepo = success(yield* call(owner, "project.repository.add", { name: "Other", path: otherPath, machineId: "local" })).repoId
  const otherWorkspace = success(yield* call(owner, "project.workspace.register", { repoId: otherRepo, machineId: "local", path: otherPath, branch: "main", checkout: "main" })).worktreeId
  expect(failureOf(yield* call(owner, "project.repository.locate", { repoId: f.repoId, machineId: "local", path: otherPath }))).toBeDefined()
  expect(failureOf(yield* call(f.lead, "project.team.create", { projectId: f.projectId, name: "Wrong", worktreeId: otherWorkspace }))).toBeDefined()
  yield* seedAgent({ id: "other-lead", folder: otherPath })
  const otherProject = success(yield* call(owner, "project.create", { ...create, repoId: otherRepo, worktreeId: otherWorkspace, leadAgentId: "other-lead" })).projectId
  expect(otherProject).not.toBe(f.projectId)
  expect(snapshotFor({ _tag: "agent", agentId: "worker" as never }, yield* snapshot)?.projects.map((row) => row.projectId)).toEqual([f.projectId])
  expect(snapshotFor({ _tag: "agent", agentId: "stranger" as never }, yield* snapshot)?.projects).toEqual([])
})).pipe(Effect.orDie))

it.live("requires completion evidence, refuses new tasks after completion, and prevents dependency cycles", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* foundation()
  const taskId = success(yield* call(f.lead, "project.task.create", f.taskPayload)).taskId
  const complete = { projectId: f.projectId, sprintId: f.sprintId, completion: "verified", evidence: "Tests and review passed at commit abc123" }
  expect(failureOf(yield* call(f.lead, "project.sprint.complete", complete))?.reason).toBe("sprint tasks are incomplete")
  expect(failureOf(yield* call(f.lead, "project.sprint.complete", { ...complete, evidence: "   " }))).toBeDefined()
  const dependent = success(yield* call(f.lead, "project.sprint.create", { projectId: f.projectId, label: "SP-02", name: "After", goal: "", phase: "Review", owner: "lead", needs: [f.sprintId] })).sprintId
  expect(failureOf(yield* call(f.lead, "project.sprint.update", { projectId: f.projectId, sprintId: f.sprintId, needs: [dependent] }))).toBeDefined()
  expect(failureOf(yield* call(f.lead, "project.sprint.complete", { ...complete, sprintId: dependent }))?.reason).toBe("sprint dependencies are incomplete")
  expect(sprintStatus({}, [{ state: "queue" }, { state: "review" }, { state: "active" }])).toBe("active")
  success(yield* call(f.worker, "project.task.update", { projectId: f.projectId, taskId, state: "done" }))
  success(yield* call(f.lead, "project.sprint.complete", complete))
  expect(failureOf(yield* call(f.lead, "project.task.create", f.taskPayload))?.reason).toContain("completed sprint")
  expect(failureOf(yield* call(f.lead, "project.sprint.update", { projectId: f.projectId, sprintId: f.sprintId, phase: "Plan" }))).toBeDefined()
  const state = projectView(yield* snapshot)
  expect(state.sprints[projectKey(f.projectId, f.sprintId)]?.completedAt).toBeGreaterThan(0)
  expect(sprintStatus(state.sprints[projectKey(f.projectId, f.sprintId)]!, [])).toBe("done")
  success(yield* call(f.lead, "project.sprint.complete", { ...complete, sprintId: dependent }))
})).pipe(Effect.orDie))

it.live("registers actual worktrees and bounds the encoded snapshot and task pages", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* foundation()
  const path = join(rig.root, "worktree")
  git(rig.work, "worktree", "add", "-b", "team-work", path)
  const worktreeId = success(yield* call(owner, "project.workspace.register", { repoId: f.repoId, machineId: "local", path, branch: "team-work", checkout: "worktree", parentId: f.worktreeId })).worktreeId
  success(yield* call(f.lead, "project.team.create", { projectId: f.projectId, name: "Review", worktreeId }))
  for (let index = 0; index < 40; index++) success(yield* call(f.lead, "project.task.create", { ...f.taskPayload, title: `Task ${index}`,
    story: { summary: "x".repeat(8192), done: [], activity: [] } }))
  const ownerSnapshot = snapshotFor({ _tag: "owner" }, yield* snapshot)!
  expect(ownerSnapshot.truncated).toBe(true)
  expect(Buffer.byteLength(JSON.stringify(ownerSnapshot))).toBeLessThanOrEqual(256 * 1024)
  Schema.decodeUnknownSync(ProjectSnapshot)(ownerSnapshot)
  const seen = new Set(); let after: string | undefined
  do {
    const result = success(yield* call(owner, "project.read", { projectId: f.projectId, collection: "tasks", ...(after === undefined ? {} : { after }) }))
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(256 * 1024)
    for (const task of result.items) { expect(seen.has(task.taskId)).toBe(false); seen.add(task.taskId) }
    after = result.next
  } while (after !== undefined)
  expect(seen.size).toBe(40)
})).pipe(Effect.orDie))


it.live("serves project commands through the authenticated typed client API with fixed refusal text", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* foundation()
  const bearer = randomBytes(32).toString("base64url")
  const socket = join(rig.stateFolder, "project.sock")
  yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false })
  expect((yield* Effect.promise(() => upgradeStatus(socket, ancestryHeaders()))).status).toBe(401)
  const api = yield* connect(socket, bearer)
  yield* seedAgent({ id: "wire-lead", folder: rig.work })
  const payload = { requestId: freshRequest(), name: "Wire project", goal: "A real API record", repoId: f.repoId,
    worktreeId: f.worktreeId, leadAgentId: "wire-lead" as never, machineId: "local" }
  const created = yield* api["project.create"](payload)
  const reply = yield* api["project.read"]({ requestId: freshRequest(), projectId: created.projectId, collection: "projects" })
  expect("items" in reply && reply.items.some((row) => "goal" in row && row.goal === "A real API record")).toBe(true)
  const duplicate = yield* api["project.rename"]({ requestId: freshRequest(), projectId: created.projectId, name: "CONSOLE" }).pipe(Effect.result)
  expect(duplicate._tag === "Failure" && duplicate.failure.reason).toBe("project name already exists in this repository")
  const wire = yield* seedAgent({ id: "wire-worker", parent: "lead" })
  const workerApi = yield* connect(socket, wire.token)
  const visible = yield* workerApi["project.read"]({ requestId: freshRequest(), collection: "projects" })
  expect("data" in visible && visible.data.includes("Console")).toBe(true)
  expect(JSON.stringify(visible)).not.toContain("Wire project")
  const denied = yield* workerApi["project.create"]({ ...payload, requestId: freshRequest(), name: "Denied" }).pipe(Effect.result)
  expect(denied._tag).toBe("Failure")
})).pipe(Effect.orDie))
