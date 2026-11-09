import { gitReportSample, gitReviewSample } from "../../../contracts/test/gitReviewFixtures.ts"
import { randomBytes } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Redacted from "effect/Redacted"
import * as SqlClient from "effect/sql/SqlClient"
import { afterEach, beforeEach, expect, vi } from "vitest"
import { ClientSnapshot, CommandsRpcGroup, Event, ProjectId, ProjectSnapshot, projectEventTags, sprintStatus } from "@lgcode/contracts"
import { EventLog } from "../../src/log/EventLog.ts"
import { engineLists } from "../../src/pieces/lists.ts"
import * as Server from "../../src/api/server.ts"
import { ancestryHeaders, connect, upgradeStatus } from "../support/socketClient.ts"
import { Views } from "../../src/views/Views.ts"
import { projectView, projectKey } from "../../src/project/view.ts"
import { snapshotFor } from "../../src/project/snapshot.ts"
import { channelMembers } from "../../src/board/access.ts"
import { provideBoard } from "../board/wakeFixtures.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { appendSetup, eventOf, harnessSettings, agentCredential, call, failureOf, seedAccount, seedAgent, seedHarness, success, ownerCredential as owner, makeRig, removeRig, freshRequest, type Rig } from "../support/handlerRig.ts"

let rig: Rig
const git = (folder: string, ...args: string[]) => execFileSync("git", ["-C", folder, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
beforeEach(() => {
  rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder)
  git(rig.work, "init", "-b", "main")
  git(rig.work, "-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Initialize")
})
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig) })
const snapshot = Effect.gen(function* () { return yield* (yield* Views).snapshot })

it.live("roundtrips every project event and receipt identity while keeping workspace owner and nested prose redacted", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const marker = "collision-marker"
  const ids = { repoId: `repo-${marker}`, worktreeId: `workspace-${marker}`, projectId: `project-${marker}`,
    teamId: `team-${marker}`, sprintId: `sprint-${marker}`, taskId: `task-${marker}`, leadAgentId: `lead-${marker}` }
  const { repoId, worktreeId, projectId, teamId, sprintId, taskId, leadAgentId } = ids
  const parentId = `parent-${marker}`
  const ownerId = `worker-${marker}`
  const needs = [`dependency-${marker}`]
  const events = (text: string) => [
    { _tag: "project.GitEvidenceReported", report: { ...gitReportSample, summary: text } },
    { _tag: "project.MainReviewOpened", review: { ...gitReviewSample, branch: text } },
    { _tag: "project.MainReviewDecided", review: { ...gitReviewSample, branch: text, decision: "approve_without_evidence", outcome: "refused", reason: text, decidedAt: 2000 } },
    { _tag: "project.SettingsChanged", settings: { workspaceFolder: text, shell: text,
      lead: { harness: `harness-${marker}`, account: { _tag: "named", accountId: `account-${marker}` }, permission: "ask", model: text, effort: text } } },
    { _tag: "project.CreationPlanned", creation: { requestId: `creation-${marker}`, bodyHash: `hash-${marker}`, projectId,
      repository: { repoId, name: text, path: text }, workspace: { worktreeId, repoId, machineId: text, branch: text, path: text },
      workspaceFolder: text, newRepository: false, name: text, goal: text, shell: text, leadName: text,
      lead: { harness: `harness-${marker}`, account: { _tag: "named", accountId: `account-${marker}` }, permission: "ask", model: text },
      repositoryIdentity: { device: `device-${marker}`, inode: `inode-${marker}` } } },
    { _tag: "project.CreationClaimed", creationRequestId: `creation-${marker}`, kind: "folder", identity: { device: `device-${marker}`, inode: `inode-${marker}` } },
    { _tag: "project.CreationFinished", creationRequestId: `creation-${marker}` },
    { _tag: "project.GoalChanged", projectId, goal: text },
    { _tag: "project.ArchiveStarted", projectId }, { _tag: "project.Archived", projectId }, { _tag: "project.Restored", projectId },
    { _tag: "project.RepositoryAdded", repoId, name: text, path: text },
    { _tag: "project.RepositoryLocated", repoId, machineId: text, path: text },
    { _tag: "project.WorktreeCreated", worktreeId, repoId, machineId: text, branch: text, path: text, projectId, teamId, parentId, owner: text, activity: text },
    { _tag: "project.Created", projectId, repoId, name: text, goal: text, leadAgentId, worktreeId, machineId: text },
    { _tag: "project.Placed", projectId, worktreeId, machineId: text },
    { _tag: "project.PreferencesChanged", projectId, shell: text },
    { _tag: "project.Renamed", projectId, name: text },
    { _tag: "project.StageChanged", projectId, stage: "build" },
    { _tag: "project.TeamAdded", projectId, teamId, worktreeId, name: text, area: text },
    { _tag: "project.SprintAdded", projectId, sprintId, label: text, name: text, goal: text, phase: "Build", owner: ownerId, needs },
    { _tag: "project.SprintChanged", projectId, sprintId, name: text, goal: text, owner: leadAgentId, needs },
    { _tag: "project.SprintCompleted", projectId, sprintId, completion: text, evidence: text },
    { _tag: "project.TaskAdded", projectId, taskId, teamId, sprintId, worktreeId, owner: ownerId, title: text, state: "queue",
      story: { summary: text, done: [text], activity: [{ title: text, detail: text }, { question: text, open: { title: text, detail: text }, answered: { title: text, detail: text } }] } },
    { _tag: "project.TaskChanged", projectId, taskId, teamId, sprintId, worktreeId, owner: leadAgentId, title: text, note: text, state: "active" },
    { _tag: "project.TaskNoted", projectId, taskId, title: text, detail: text },
  ].map((event) => Schema.decodeUnknownSync(Event)(event))
  const input = events(marker)
  expect(input.map((event) => event._tag).sort()).toEqual([...projectEventTags].sort())
  const log = yield* EventLog
  const requestId = freshRequest()
  // Mutation replies return these six identities. Lead and parent references
  // occur in events, not at the root of a mutation reply.
  const receiptIds = { repoId, worktreeId, projectId, teamId, sprintId, taskId }
  const reply = { requestId, ...receiptIds, owner: marker, needs: [marker], text: marker, nested: { projectId: marker } }
  const batch = yield* log.append({ _tag: "owner" }, requestId, "a".repeat(64), input, {}, (envelopes) => ({ ...reply, envelopes }))
  expect(batch.map((row) => row.event)).toEqual(events("[REDACTED]"))
  const sql = yield* SqlClient.SqlClient
  const stored = yield* sql<{ payload_json: string }>`SELECT payload_json FROM events WHERE request_id = ${requestId} ORDER BY sequence`
  expect(stored.map((row) => JSON.parse(row.payload_json))).toEqual(events("[REDACTED]"))
  const rows = yield* sql<{ result_json: string }>`SELECT result_json FROM receipts WHERE request_id = ${requestId}`
  const receipt = JSON.parse(rows[0]!.result_json)
  expect(receipt.envelopes).toEqual(batch)
  expect(receipt.reply).toEqual({ requestId, ...receiptIds, owner: "[REDACTED]", needs: ["[REDACTED]"], text: "[REDACTED]", nested: { projectId: "[REDACTED]" }, envelopes: batch })
  // A repeated receipt must replay the original identities and envelope times.
  expect(yield* log.append({ _tag: "owner" }, requestId, "a".repeat(64), input, {}, () => reply)).toEqual(batch)
}), ["collision-marker"]).pipe(Effect.orDie))
const historicProject = (fields: Record<string, unknown>, requestId = freshRequest()) => Effect.gen(function* () {
  const log = yield* EventLog
  const projectId = Schema.decodeUnknownSync(ProjectId)(`project-${requestId}`)
  const event = eventOf({ _tag: "project.Created", ...fields, projectId })
  yield* log.append({ _tag: "owner" }, requestId, "b".repeat(64), [event], {}, () => ({ requestId, projectId }))
  return { requestId, projectId }
})
const launchSettings = () => Effect.gen(function* () {
  yield* seedAccount("launch", "cursor")
  success(yield* call(owner, "harnesses", { operation: "set", harness: harnessSettings("cursor", { adapterPath: process.execPath, reportedModes: [{ id: "default", level: "ask" }] }) }))
  success(yield* call(owner, "accounts set-secret", { accountId: "launch", name: "CURSOR_API_KEY", nonce: "project-test", value: Redacted.make("synthetic-project-test-key") }))
  success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "zsh" } }))
})
const foundation = () => Effect.gen(function* () {
  yield* registerRebuildCheck(); yield* seedAccount(); yield* seedHarness()
  const lead = agentCredential((yield* seedAgent({ id: "lead", folder: rig.work })).token)
  const worker = agentCredential((yield* seedAgent({ id: "worker", parent: "lead" })).token)
  const sibling = agentCredential((yield* seedAgent({ id: "sibling", parent: "lead" })).token)
  const stranger = agentCredential((yield* seedAgent({ id: "stranger" })).token)
  success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "zsh" } }))
  const repoId = success(yield* call(owner, "project.repository.add", { name: "Product", path: rig.work, machineId: "local" })).repoId
  const worktreeId = success(yield* call(owner, "project.workspace.register", { repoId, machineId: "local", branch: "main", path: rig.work, checkout: "main" })).worktreeId
  const projectId = (yield* historicProject({ name: "Console", goal: "Make work visible", leadAgentId: "lead", repoId, worktreeId, machineId: "local" })).projectId
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
  yield* launchSettings()
  const create = { name: "CONSOLE", goal: "", repository: { _tag: "existing", repoId: f.repoId }, machineId: "local", useWorktree: false }
  expect(failureOf(yield* call(owner, "project.create", create))?.reason).toContain("name already exists")
  expect(failureOf(yield* call(owner, "project.create", { ...create, name: "Other", repository: { _tag: "existing", repoId: "missing" } }))).toBeDefined()
  expect(failureOf(yield* call(owner, "project.create", { ...create, name: "Other", machineId: "missing" }))).toBeDefined()
  expect(failureOf(yield* call(owner, "project.create", { name: "Other", goal: "", repoId: f.repoId, worktreeId: f.worktreeId, leadAgentId: "worker", machineId: "local" }))).toBeDefined()
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
  const otherProject = success(yield* call(owner, "project.create", { ...create, repository: { _tag: "existing", repoId: otherRepo } })).projectId
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
  yield* launchSettings()
  const payload = { requestId: freshRequest(), name: "Wire project", goal: "A real API record", repository: { _tag: "existing" as const, repoId: f.repoId }, useWorktree: false, machineId: "local" }
  const created = yield* api["project.create"](payload)
  const invalidCursor = yield* api["project.read"]({ requestId: freshRequest(), projectId: created.projectId, collection: "projects", after: "missing" }).pipe(Effect.result)
  expect(invalidCursor._tag === "Failure" && invalidCursor.failure.reason).toBe("invalid cursor")
  const missingProject = yield* api["project.read"]({ requestId: freshRequest(), collection: "tasks" }).pipe(Effect.result)
  expect(missingProject._tag === "Failure" && missingProject.failure.reason).toBe("projectId is required for this collection")
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

it.live("reads absent settings over a fresh authenticated socket, then saves, rereads and rebuilds", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck(); yield* seedAccount()
  const bearer = randomBytes(32).toString("base64url")
  const socket = join(rig.stateFolder, "settings.sock")
  yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false })
  const api = yield* connect(socket, bearer)
  expect(Object.hasOwn(success(yield* call(owner, "project.settings", {})), "settings")).toBe(false)
  const empty = yield* api["project.settings"]({ requestId: freshRequest() })
  expect(Object.hasOwn(empty, "settings")).toBe(false)
  expect(projectView(yield* snapshot).settings).toBeUndefined()
  const settings = { workspaceFolder: rig.work, shell: "zsh" }
  yield* api["project.settings.set"]({ requestId: freshRequest(), settings })
  expect((yield* api["project.settings"]({ requestId: freshRequest() })).settings).toEqual(settings)
  expect(projectView(yield* snapshot).settings).toEqual(settings)
})).pipe(Effect.orDie))

it.live("keeps arbitrary read failures generic and scopes project refusal text to project commands", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck(); yield* seedAccount()
  const bearer = randomBytes(32).toString("base64url")
  const socket = join(rig.stateFolder, "refusals.sock")
  const lists = { ...engineLists, reads: { ...engineLists.reads,
    "project.read": () => Effect.fail({ reason: "synthetic-private-error" }),
    "client.roster": () => Effect.fail({ reason: "invalid cursor" }),
  } }
  yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false, lists })
  const api = yield* connect(socket, bearer)
  const arbitrary = yield* api["project.read"]({ requestId: freshRequest(), collection: "projects" }).pipe(Effect.result)
  expect(arbitrary._tag === "Failure" && arbitrary.failure.reason).toBe("command refused")
  const outside = yield* api["client.roster"]({ requestId: freshRequest() }).pipe(Effect.result)
  expect(outside._tag === "Failure" && outside.failure.reason).toBe("command refused")
  expect(Object.hasOwn(yield* api["project.settings"]({ requestId: freshRequest() }), "settings")).toBe(false)
})).pipe(Effect.orDie))

it.live("keeps a colliding validated lead and task owner through the production writer, receipts and access checks", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck(); yield* seedAccount(); yield* seedHarness()
  const leadId = "agent-collision-marker"
  const workerId = "worker-collision-marker"
  const lead = agentCredential((yield* seedAgent({ id: leadId, folder: rig.work })).token)
  const worker = agentCredential((yield* seedAgent({ id: workerId, parent: leadId })).token)
  success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "zsh" } }))
  const repoId = success(yield* call(owner, "project.repository.add", { name: "Product", path: rig.work, machineId: "local" })).repoId
  const worktreeId = success(yield* call(owner, "project.workspace.register", { repoId, machineId: "local", branch: "main", path: rig.work, checkout: "main" })).worktreeId
  const requestId = freshRequest()
  const payload = { requestId, name: "Collision", goal: "Hide collision-marker here", leadAgentId: leadId, repoId, worktreeId, machineId: "local" }
  const created = yield* historicProject(payload, requestId)
  const projectId = created.projectId
  expect(yield* historicProject(payload, requestId)).toEqual(created)
  expect(projectView(yield* snapshot).projects[projectId]).toMatchObject({ projectId, repoId, worktreeId, leadAgentId: leadId, goal: "Hide [REDACTED] here" })
  expect(projectView(yield* snapshot).agentProjects).toMatchObject({ [leadId]: projectId, [workerId]: projectId })
  expect(success(yield* call(lead, "project.read", { projectId, collection: "projects" })).data).toContain(leadId)
  success(yield* call(lead, "project.stage.set", { projectId, stage: "build" }))
  const team = success(yield* call(lead, "project.team.create", { projectId, name: "Build", worktreeId }))
  success(yield* call(lead, "group", { agentId: workerId, add: [team.group], remove: [] }))
  const sprintId = success(yield* call(lead, "project.sprint.create", { projectId, label: "SP-01", name: "Build", goal: "", phase: "Build", owner: leadId, needs: [] })).sprintId
  const taskId = success(yield* call(lead, "project.task.create", { projectId, teamId: team.teamId, sprintId, worktreeId, owner: workerId, title: "Build records", state: "queue" })).taskId
  success(yield* call(worker, "project.task.update", { projectId, taskId, state: "active", note: "Hide collision-marker" }))
  const view = projectView(yield* snapshot)
  expect(view.sprints[projectKey(projectId, sprintId)]?.owner).toBe(leadId)
  expect(view.tasks[projectKey(projectId, taskId)]).toMatchObject({ owner: workerId, state: "active" })
  expect(view.tasks[projectKey(projectId, taskId)]?.history.at(-1)?.detail).toBe("Hide [REDACTED]")
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ result_json: string }>`SELECT result_json FROM receipts WHERE request_id = ${requestId}`
  const receipt = JSON.parse(rows[0]!.result_json)
  expect(receipt.reply).toEqual(created)
  expect(receipt.envelopes[0].event).toMatchObject({ projectId, repoId, worktreeId, leadAgentId: leadId, goal: "Hide [REDACTED] here" })
}), ["collision-marker"]).pipe(Effect.orDie))
