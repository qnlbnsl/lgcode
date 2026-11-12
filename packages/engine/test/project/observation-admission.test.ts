import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Redacted from "effect/Redacted"
import * as SqlClient from "effect/sql/SqlClient"
import { afterEach, beforeEach, expect, vi } from "vitest"
import * as Design from "../../src/project/design.ts"
import * as Mocks from "../../src/project/mocks.ts"
import * as Context from "../../src/project/context.ts"
import * as Registrations from "../../src/project/commands.ts"
import * as Lifecycle from "../../src/project/lifecycle.ts"
import { projectView } from "../../src/project/view.ts"
import { provideBoard, snapshot } from "../board/wakeFixtures.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { agentCredential, appendSetup, call, eventOf, failureOf, freshRequest, harnessSettings, makeRig, ownerCredential as owner,
  readLog, removeRig, seedAccount, seedAgent, seedHarness, success, type Rig } from "../support/handlerRig.ts"

let rig: Rig
const git = (path: string, ...args: string[]) => execFileSync("/usr/bin/git", ["-C", path, ...args], { stdio: "ignore" })
beforeEach(() => {
  rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder)
  git(rig.work, "init", "-b", "main")
  writeFileSync(join(rig.work, "screen.html"), "<h1>Observed bytes</h1>")
  writeFileSync(join(rig.work, "design.pen"), "Observed design bytes")
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); removeRig(rig) })
const setup = () => Effect.gen(function* () {
  yield* registerRebuildCheck(); yield* seedAccount(); yield* seedHarness()
  const lead = yield* seedAgent({ id: "lead" }), worker = yield* seedAgent({ id: "worker", parent: "lead" })
  success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "sh" } }))
  const repoId = success(yield* call(owner, "project.repository.add", { name: "Repo", path: rig.work, machineId: "local" })).repoId
  const worktreeId = success(yield* call(owner, "project.workspace.register", { repoId, machineId: "local", path: rig.work, branch: "main", checkout: "main" })).worktreeId
  yield* appendSetup([eventOf({ _tag: "project.Created", projectId: "project", repoId, worktreeId, machineId: "local", leadAgentId: lead.agentId, name: "Project", goal: "", stage: "design" })])
  return { lead, worker, repoId, worktreeId }
})
// Pause after the real physical probes, before the handler's final writer.
// No Git result, admission result or event batch is replaced by this seam.
const barrier = () => Effect.gen(function* () {
  const ready = yield* Deferred.make<void>(), release = yield* Deferred.make<void>()
  yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
  let used = false
  return { ready: Deferred.await(ready).pipe(Effect.timeout("5 seconds")), release: Deferred.succeed(release, undefined),
    pause: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.tap(() => Effect.gen(function* () {
      if (used) return
      used = true
      yield* Deferred.succeed(ready, undefined); yield* Deferred.await(release)
    }))) }
})
const noSuccess = (requestId: string, tags: ReadonlyArray<string>) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const events = (yield* readLog).filter((row) => row.requestId === requestId)
  expect(events.some((row) => tags.includes(row.event._tag))).toBe(false)
  expect(events.some((row) => row.event._tag === "CommandRefused")).toBe(true)
  const receipts = yield* sql<{ result_json: string }>`SELECT result_json FROM receipts WHERE request_id = ${requestId}`
  // Ordinary pre-effect refusals keep their existing receipt semantics.
  expect(receipts.every((row) => row.result_json.includes("CommandRefused"))).toBe(true)
})
const reassign = (agentId: string, repoId: string, worktreeId: string) => appendSetup([eventOf({ _tag: "project.Created",
  projectId: "other", repoId, worktreeId, machineId: "local", leadAgentId: agentId, name: "Other", goal: "" })])
const bundle = (worktreeId: string) => ({ sources: [{ sourceId: "screen", worktreeId, path: "screen.html", kind: "screens" }],
  screens: [{ screenId: "home", sourceId: "screen", name: "Home", route: "/", summary: "Observed", scenarioRoutes: [] }],
  scenarios: [], draftedFields: [], components: [] })

for (const change of ["binding", "head", "access"] as const) it.live(`issue 579/583: Design admission rejects stale ${change} after actual byte observation`, () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(), gate = yield* barrier(), actual = Design.prepareDesignRecord
  vi.spyOn(Design, "prepareDesignRecord").mockImplementation((...args) => gate.pause(actual(...args)))
  const request = { requestId: freshRequest(), projectId: "project", design: { repoId: f.repoId, worktreeId: f.worktreeId, file: "design.pen", components: [] } }
  const pending = yield* call(agentCredential(f.worker.token), "project.design.record", request).pipe(Effect.forkChild)
  yield* gate.ready
  if (change === "binding") {
    const workspace = projectView(yield* snapshot).workspaces[f.worktreeId]!
    yield* appendSetup([eventOf({ _tag: "project.WorktreeCreated", ...workspace, branch: "changed-binding" })])
  } else if (change === "head") {
    success(yield* call(owner, "project.design.record", { ...request, requestId: freshRequest() }))
  } else yield* reassign(f.worker.agentId, f.repoId, f.worktreeId)
  yield* gate.release
  const result = yield* Fiber.join(pending)
  expect(failureOf(result)?.reason).toBe(change === "head" ? "design revision changed; refresh and retry" : change === "access" ? "repository design is unavailable to this caller" : "project state changed; refresh and retry")
  yield* noSuccess(request.requestId, ["project.DesignRecorded"])
  expect(failureOf(yield* call(agentCredential(f.worker.token), "project.design.record", request))).toEqual(failureOf(result))
})).pipe(Effect.orDie))

for (const change of ["binding", "head", "access", "stage"] as const) it.live(`issue 579/583: mock recording reruns current ${change} admission`, () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(), gate = yield* barrier(), actual = Mocks.prepareMock
  vi.spyOn(Mocks, "prepareMock").mockImplementation((...args) => gate.pause(actual(...args)))
  const request = { requestId: freshRequest(), projectId: "project", bundle: bundle(f.worktreeId) }
  const pending = yield* call(agentCredential(f.worker.token), "project.mocks.record", request).pipe(Effect.forkChild)
  yield* gate.ready
  if (change === "binding") {
    const workspace = projectView(yield* snapshot).workspaces[f.worktreeId]!
    yield* appendSetup([eventOf({ _tag: "project.WorktreeCreated", ...workspace, path: rig.outside })])
  } else if (change === "head") success(yield* call(owner, "project.mocks.record", { ...request, requestId: freshRequest() }))
  else if (change === "access") yield* reassign(f.worker.agentId, f.repoId, f.worktreeId)
  else yield* appendSetup([eventOf({ _tag: "project.StageChanged", projectId: "project", stage: "plan" })])
  yield* gate.release
  const result = yield* Fiber.join(pending)
  expect(failureOf(result)?.reason).toBe(change === "head" ? "mock revision changed; refresh and retry" : change === "access" ? "project is unavailable to this caller" : change === "stage" ? "only a project lead or owner can change the stage" : "project state changed; refresh and retry")
  yield* noSuccess(request.requestId, ["project.MockRecorded", "project.StageChanged"])
})).pipe(Effect.orDie))

for (const change of ["head", "approval", "lead", "binding", "archive"] as const) it.live(`issue 579/583: mock approval observes current ${change} and never reuses a prepared handoff`, () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup()
  const revisionId = success(yield* call(owner, "project.mocks.record", { projectId: "project", bundle: bundle(f.worktreeId) })).revisionId
  const gate = yield* barrier(), actual = Mocks.prepareMock
  vi.spyOn(Mocks, "prepareMock").mockImplementation((...args) => gate.pause(actual(...args)))
  const request = { requestId: freshRequest(), projectId: "project", revisionId }
  const pending = yield* call(owner, "project.mocks.approve", request).pipe(Effect.forkChild)
  yield* gate.ready
  if (change === "head") success(yield* call(owner, "project.mocks.record", { projectId: "project", expectedRevision: revisionId, bundle: bundle(f.worktreeId) }))
  else if (change === "approval") success(yield* call(owner, "project.mocks.approve", { ...request, requestId: freshRequest() }))
  else if (change === "binding") {
    const workspace = projectView(yield* snapshot).workspaces[f.worktreeId]!
    yield* appendSetup([eventOf({ _tag: "project.WorktreeCreated", ...workspace, branch: "changed-binding" })])
  } else if (change === "archive") yield* appendSetup([eventOf({ _tag: "project.ArchiveStarted", projectId: "project" })])
  else yield* appendSetup([eventOf({ ...projectView(yield* snapshot).projects.project!, _tag: "project.Created", leadAgentId: f.worker.agentId })])
  yield* gate.release
  const result = yield* Fiber.join(pending)
  if (change === "lead") {
    success(result)
    const approval = projectView(yield* snapshot).mockApprovals[JSON.stringify(["project", request.requestId])]!
    expect(approval.leadAgentId).toBe(f.worker.agentId)
    expect((yield* readLog).filter((row) => row.requestId === request.requestId && row.event._tag === "DeliveryQueued").map((row) => row.event._tag === "DeliveryQueued" ? row.event.delivery.target : undefined)).toEqual([f.worker.agentId])
  } else {
    expect(failureOf(result)?.reason).toBe(change === "head" ? "mock revision changed; refresh and retry" : change === "binding" ? "project state changed; refresh and retry" : change === "archive" ? "project is unavailable to this caller" : "mock revision is already approved")
    yield* noSuccess(request.requestId, ["project.MockApproved", "project.StageChanged", "DeliveryQueued"])
  }
})).pipe(Effect.orDie))

for (const command of ["prompt", "board.post"] as const) for (const change of ["binding", "source-access", "recipient"] as const) it.live(`issue 579/583: ${command} rechecks ${change} after real file observation`, () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup()
  const channelId = command === "board.post" ? success(yield* call(owner, "board.open", { name: "Context" })).channelId : undefined
  if (channelId !== undefined) success(yield* call(owner, "board.members", { channelId, add: [f.worker.agentId], remove: [] }))
  const gate = yield* barrier(), actual = Context.prepareContextFiles
  vi.spyOn(Context, "prepareContextFiles").mockImplementation((...args) => gate.pause(actual(...args)))
  const context = [{ _tag: "file", projectId: "project", repoId: f.repoId, worktreeId: f.worktreeId, path: "screen.html" }]
  const credential = change === "source-access" ? agentCredential(f.lead.token) : owner
  const request = { requestId: freshRequest(), text: "Use the reference", context,
    ...(command === "prompt" ? { agentId: f.worker.agentId } : { channelId, to: [], reply: "none" }) }
  // A plain channel is owner-managed. Give the lead membership before testing
  // loss of its project access; channel authority remains unchanged.
  if (command === "board.post" && change === "source-access") success(yield* call(owner, "board.members", { channelId, add: [f.lead.agentId], remove: [] }))
  const pending = yield* call(credential, command, request).pipe(Effect.forkChild)
  yield* gate.ready
  if (change === "binding") {
    const workspace = projectView(yield* snapshot).workspaces[f.worktreeId]!
    yield* appendSetup([eventOf({ _tag: "project.WorktreeCreated", ...workspace, branch: "changed-binding" })])
  } else yield* reassign(change === "source-access" ? f.lead.agentId : f.worker.agentId, f.repoId, f.worktreeId)
  yield* gate.release
  const result = yield* Fiber.join(pending)
  expect(failureOf(result)?.reason).toBe(change === "binding" ? "project state changed; refresh and retry" : "context is unavailable to this conversation")
  yield* noSuccess(request.requestId, ["DeliveryQueued", "board.PostWritten", "board.ChannelOpened"])
  expect(failureOf(yield* call(credential, command, request))).toEqual(failureOf(result))
})).pipe(Effect.orDie))

it.live("issue 579/583: registered parent changes invalidate a physical checkout observation", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(), gate = yield* barrier(), actual = Registrations.prepareRegistration
  git(rig.work, "config", "user.name", "Observation fixture"); git(rig.work, "config", "user.email", "observation@example.invalid")
  git(rig.work, "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Initial")
  const path = join(rig.root, "child"); git(rig.work, "worktree", "add", "-b", "child", path)
  vi.spyOn(Registrations, "prepareRegistration").mockImplementation((...args) => gate.pause(actual(...args)))
  const request = { requestId: freshRequest(), repoId: f.repoId, machineId: "local", path, branch: "child", checkout: "worktree", parentId: f.worktreeId }
  const pending = yield* call(owner, "project.workspace.register", request).pipe(Effect.forkChild)
  yield* gate.ready
  const parent = projectView(yield* snapshot).workspaces[f.worktreeId]!
  yield* appendSetup([eventOf({ _tag: "project.WorktreeCreated", ...parent, path: rig.outside })])
  yield* gate.release
  const result = yield* Fiber.join(pending)
  expect(failureOf(result)?.reason).toBe("project state changed; refresh and retry")
  yield* noSuccess(request.requestId, ["project.WorktreeCreated"])
  expect(failureOf(yield* call(owner, "project.workspace.register", request))).toEqual(failureOf(result))
})).pipe(Effect.orDie))

it.live("issue 579/583: final creation admission refuses changed settings after real verification, retains the owned intent, and recovers on the same body", () => provideBoard(rig, Effect.gen(function* () {
  yield* setup()
  yield* seedAccount("launch", "cursor")
  success(yield* call(owner, "harnesses", { operation: "set", harness: harnessSettings("cursor", { adapterPath: process.execPath, reportedModes: [{ id: "default", level: "ask" }] }) }))
  success(yield* call(owner, "accounts set-secret", { accountId: "launch", name: "CURSOR_API_KEY", nonce: "observation-fixture", value: Redacted.make("synthetic-observation-fixture-key") }))
  const gate = yield* barrier(), actual = Lifecycle.prepareProjectLifecycle
  vi.spyOn(Lifecycle, "prepareProjectLifecycle").mockImplementation((...args) => gate.pause(actual(...args)))
  const request = { requestId: freshRequest(), name: "Fresh", goal: "Keep the final admission current", machineId: "local", repository: { _tag: "new", name: "Fresh repository" }, useWorktree: true }
  const pending = yield* call(owner, "project.create", request).pipe(Effect.forkChild)
  yield* gate.ready
  const intent = projectView(yield* snapshot).creations[request.requestId]!
  expect(intent.repositoryIdentity).toBeDefined(); expect(intent.folderIdentity).toBeDefined()
  success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "bash" } }))
  yield* gate.release
  const result = yield* Fiber.join(pending)
  expect(failureOf(result)?.reason).toBe("project state changed; refresh and retry")
  yield* noSuccess(request.requestId, ["project.Created", "AgentStarted", "project.CreationFinished"])
  const sql = yield* SqlClient.SqlClient
  expect(yield* sql`SELECT request_id FROM receipts WHERE request_id = ${request.requestId}`).toHaveLength(0)
  expect(projectView(yield* snapshot).creations[request.requestId]).toEqual(intent)
  success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "sh" } }))
  const created = success(yield* call(owner, "project.create", request))
  expect(success(yield* call(owner, "project.create", request))).toEqual(created)
  expect(projectView(yield* snapshot).creations[request.requestId]).toBeUndefined()
  expect((yield* readLog).filter((row) => row.requestId === request.requestId && row.event._tag === "AgentStarted")).toHaveLength(1)
})).pipe(Effect.orDie))

it.live("issue 579/583: recorded Design fingerprints describe observed bytes and a later read reports changed bytes unavailable", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(), gate = yield* barrier(), actual = Design.prepareDesignRecord
  vi.spyOn(Design, "prepareDesignRecord").mockImplementation((...args) => gate.pause(actual(...args)))
  const request = { requestId: freshRequest(), projectId: "project", design: { repoId: f.repoId, worktreeId: f.worktreeId, file: "design.pen", components: [] } }
  const pending = yield* call(owner, "project.design.record", request).pipe(Effect.forkChild)
  yield* gate.ready
  writeFileSync(join(rig.work, "design.pen"), "Changed after the physical observation")
  yield* gate.release
  const recorded = success(yield* Fiber.join(pending))
  const result = success(yield* call(owner, "project.design.read", { repoId: f.repoId, projectId: "project", revisionId: recorded.revisionId })).result
  expect(result.file).toEqual({ _tag: "unavailable", reason: "artifact unavailable" })
  expect(result.record.revisionId).toBe(recorded.revisionId)
  expect(success(yield* call(owner, "project.design.record", request))).toEqual(recorded)
})).pipe(Effect.orDie))

it.live("issue 579/583: prompt rechecks the current holder after preparing real file context", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(), gate = yield* barrier(), actual = Context.prepareContextFiles
  vi.spyOn(Context, "prepareContextFiles").mockImplementation((...args) => gate.pause(actual(...args)))
  const request = { requestId: freshRequest(), agentId: f.worker.agentId, text: "Read this", context: [{ _tag: "file", projectId: "project", repoId: f.repoId, worktreeId: f.worktreeId, path: "screen.html" }] }
  const pending = yield* call(agentCredential(f.lead.token), "prompt", request).pipe(Effect.forkChild)
  yield* gate.ready
  // A paused parent remains authenticated but is no longer the active holder.
  yield* appendSetup([eventOf({ _tag: "StateChanged", agentId: f.lead.agentId, state: { _tag: "paused", reason: "limit", midTurn: false } })])
  yield* gate.release
  expect(failureOf(yield* Fiber.join(pending))?.reason).toBe("command refused")
  yield* noSuccess(request.requestId, ["DeliveryQueued"])
})).pipe(Effect.orDie))

it.live("issue 579/583: a newly added channel recipient must have current source access", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(), stranger = yield* seedAgent({ id: "stranger" })
  const channelId = success(yield* call(owner, "board.open", { name: "Members" })).channelId
  success(yield* call(owner, "board.members", { channelId, add: [f.worker.agentId], remove: [] }))
  const gate = yield* barrier(), actual = Context.prepareContextFiles
  vi.spyOn(Context, "prepareContextFiles").mockImplementation((...args) => gate.pause(actual(...args)))
  const request = { requestId: freshRequest(), channelId, text: "Current members only", to: [], reply: "none", context: [{ _tag: "file", projectId: "project", repoId: f.repoId, worktreeId: f.worktreeId, path: "screen.html" }] }
  const pending = yield* call(owner, "board.post", request).pipe(Effect.forkChild)
  yield* gate.ready
  success(yield* call(owner, "board.members", { channelId, add: [stranger.agentId], remove: [] }))
  yield* gate.release
  expect(failureOf(yield* Fiber.join(pending))?.reason).toBe("context is unavailable to this conversation")
  yield* noSuccess(request.requestId, ["board.PostWritten", "DeliveryQueued"])
})).pipe(Effect.orDie))
