import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { lstatSync, readdirSync, readlinkSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Deferred from "effect/Deferred"
import * as Fiber from "effect/Fiber"
import * as Redacted from "effect/Redacted"
import * as SqlClient from "effect/sql/SqlClient"
import { afterEach, beforeEach, expect, vi } from "vitest"
import { checkoutMainReason } from "../../src/project/lifecycle.ts"
import * as Lifecycle from "../../src/project/lifecycle.ts"
import { EventLog, LogWriteFailed } from "../../src/log/EventLog.ts"
import { RunnerRejected } from "../../src/runner/Runner.ts"
import { projectView } from "../../src/project/view.ts"
import * as Lanes from "../../src/routing/lanes.ts"
import { snapshot } from "../support/routingRig.ts"
import { makeFakeRunner } from "../support/fakeRunner.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { provideRestart, recover } from "../support/restartRig.ts"
import { agentCredential, appendSetup, eventOf, seedAgent, call, failureOf, freshRequest, harnessSettings, makeFakeSecrets, makeRig, ownerCredential as owner,
  provideRig, readLog, removeRig, seedAccount, seedHarness, success, type Fakes, type Rig } from "../support/handlerRig.ts"

const live = (name: string, body: () => Effect.Effect<unknown, unknown, any>) => it.live(name, () => body() as Effect.Effect<unknown, unknown, never>)
let rig: Rig
const git = (path: string, ...args: string[]) => execFileSync("git", ["-C", path, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
beforeEach(() => {
  rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder)
  git(rig.work, "init", "-b", "main")
  git(rig.work, "-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Initial")
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); removeRig(rig) })
const setup = () => Effect.gen(function* () {
  yield* registerRebuildCheck(); yield* seedAccount("primary", "cursor"); yield* seedHarness("cursor")
  success(yield* call(owner, "harnesses", { operation: "set", harness: harnessSettings("cursor", { adapterPath: process.execPath, reportedModes: [{ id: "default", level: "ask" }] }) }))
  success(yield* call(owner, "accounts set-secret", { accountId: "primary", name: "CURSOR_API_KEY", nonce: "test-project", value: Redacted.make("synthetic-project-credential-012345") }))
  success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "zsh" } }))
  return success(yield* call(owner, "project.repository.add", { name: "Product", path: rig.work, machineId: "local" })).repoId
})
const payload = (repoId: string, name = "Console") => ({ requestId: freshRequest(), name, goal: "Create real work", machineId: "local", repository: { _tag: "existing", repoId } })

// Fail only the final append, after the actual Git operation has succeeded.
// The wrapper leaves the production writer and its transaction intact.
const failCreated = (): NonNullable<Fakes["wrapLog"]> => {
  let once = true
  return (real) => ({ ...real, transact: (use) => real.transact((append) => use((actor, id, hash, events, rows, receipt) => {
    if (once && events.some((event) => event._tag === "project.Created")) { once = false; return Effect.fail(new LogWriteFailed({ reason: "injected before final creation append" })) }
    return append(actor, id, hash, events, rows, receipt)
  })) })
}

live("retains owned unrecorded worktree success and retries the same intent after a full restart without a second checkout or lead", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  const request = yield* provideRig(rig, { runner, secrets, wrapLog: failCreated() }, Effect.gen(function* () {
    const repoId = yield* setup(), request = payload(repoId)
    success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "bash", lead: { harness: "cursor", account: { _tag: "named", accountId: "primary" }, model: "test-model", effort: "high", permission: "ask" } } }))
    expect(failureOf(yield* call(owner, "project.create", request))?._tag).toBe("LogWriteFailed")
    const pending = success(yield* call(owner, "project.creations", {})).items
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ requestId: request.requestId, name: "Console", folderIdentity: expect.any(Object) })
    expect(git(pending[0].workspace.path, "branch", "--show-current")).toBe("console")
    expect(runner.callsOf("start")).toHaveLength(0)
    expect(Object.values(projectView(yield* snapshot).projects)).toHaveLength(0)
    return request
  }))
  yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* recover
    expect(failureOf(yield* call(owner, "project.create", { ...request, goal: "Changed" }))?.reason).toBe("request id reused")
    const created = success(yield* call(owner, "project.create", request))
    expect(success(yield* call(owner, "project.create", request))).toEqual(created)
    expect(runner.callsOf("start")).toHaveLength(1)
    expect(runner.callsOf("start")[0]?.input).toMatchObject({ model: "test-model", effort: "high", permission: "ask", account: { id: "primary" } })
    expect(success(yield* call(owner, "project.settings", {})).settings.lead).toMatchObject({ harness: "cursor", model: "test-model", effort: "high" })
    expect(git(rig.work, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(2)
    expect((yield* readLog).filter(({ event }) => event._tag === "project.Created")).toHaveLength(1)
    expect(success(yield* call(owner, "project.creations", {})).items).toEqual([])
    success(yield* call(owner, "project.archive", { projectId: created.projectId }))
  }), { secrets })
}))

live("retains an initialized new repository before the final log and reuses it on retry", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  const { request, repoId } = yield* provideRig(rig, { runner, secrets, wrapLog: failCreated() }, Effect.gen(function* () {
    yield* setup()
    const request = { requestId: freshRequest(), name: "Fresh", goal: "Plan", machineId: "local", repository: { _tag: "new", name: "New repo" }, useWorktree: true }
    expect(failureOf(yield* call(owner, "project.create", request))?._tag).toBe("LogWriteFailed")
    const pending = success(yield* call(owner, "project.creations", {})).items[0]
    expect(git(pending.repository.path, "branch", "--show-current")).toBe("main")
    expect(pending.workspace).toMatchObject({ checkout: "worktree", branch: "fresh" })
    expect(pending.workspace.path).not.toBe(pending.repository.path)
    expect(git(pending.workspace.path, "branch", "--show-current")).toBe("fresh")
    return { request, repoId: pending.repository.repoId }
  }))
  yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* recover
    const result = success(yield* call(owner, "project.create", request))
    expect(projectView(yield* snapshot).projects[result.projectId]?.repoId).toBe(repoId)
    expect(runner.callsOf("start")).toHaveLength(1)
  }), { secrets })
}))

live("never adopts replaced owned folders or deletes unrelated files and exclusions after failure", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  const { request, pending, exclude, previous } = yield* provideRig(rig, { runner, secrets, wrapLog: failCreated() }, Effect.gen(function* () {
    const repoId = yield* setup(), request = payload(repoId)
    const exclude = join(rig.work, ".git/info/exclude"), previous = "private/\n!private/keep\n"
    writeFileSync(exclude, previous)
    expect(failureOf(yield* call(owner, "project.create", request))).toBeDefined()
    const pending = success(yield* call(owner, "project.creations", {})).items[0]
    renameSync(pending.workspace.path, pending.workspace.path + "-original")
    mkdirSync(pending.workspace.path); writeFileSync(join(pending.workspace.path, "mine.txt"), "Unrelated work")
    return { request, pending, exclude, previous }
  }))
  yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* recover
    expect(failureOf(yield* call(owner, "project.create", request))).toBeDefined()
    expect(readFileSync(join(pending.workspace.path, "mine.txt"), "utf8")).toBe("Unrelated work")
    expect(readFileSync(exclude, "utf8")).toBe(previous + "/.worktrees/\n")
    expect(runner.callsOf("start")).toHaveLength(0)
    expect(success(yield* call(owner, "project.creations", {})).items).toHaveLength(1)
  }), { secrets })
}))

live("keeps a recorded lead after a lost response and never launches a second lead on retry", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  let armed = true
  const wrapLog: Fakes["wrapLog"] = (real) => ({ ...real, transact: (use) => {
    let created = false
    return real.transact((append) => use((actor, id, hash, events, rows, receipt) => {
      if (events.some((event) => event._tag === "project.Created")) created = true
      return append(actor, id, hash, events, rows, receipt)
    })).pipe(Effect.flatMap((result) => {
      if (armed && created) { armed = false; return Effect.fail(new LogWriteFailed({ reason: "injected lost committed response" })) }
      return Effect.succeed(result)
    }))
  } })
  const request = yield* provideRig(rig, { runner, secrets, wrapLog }, Effect.gen(function* () {
    const repoId = yield* setup(), request = payload(repoId)
    expect(failureOf(yield* call(owner, "project.create", request))?._tag).toBe("LogWriteFailed")
    expect((yield* readLog).filter(({ event }) => event._tag === "AgentStarted")).toHaveLength(1)
    expect(runner.callsOf("start")).toHaveLength(0)
    return request
  }))
  yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* recover
    const result = success(yield* call(owner, "project.create", request))
    const row = projectView(yield* snapshot).projects[result.projectId]!
    expect((yield* snapshot).agents[row.leadAgentId]?.state._tag).not.toBe("idle")
    expect(runner.callsOf("start")).toHaveLength(1)
    expect(runner.callsOf("start")[0]?.input).toMatchObject({ agentId: row.leadAgentId })
    expect(success(yield* call(owner, "project.create", request))).toEqual(result)
    expect(runner.callsOf("start")).toHaveLength(1)
    expect((yield* readLog).filter(({ event }) => event._tag === "AgentStarted")).toHaveLength(1)
  }), { secrets })
}))

live("does not claim an archive after failed stop, preserves setup, and retries confirmed stops", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    const repoId = yield* setup(), result = success(yield* call(owner, "project.create", { ...payload(repoId), useWorktree: true }))
    const row = projectView(yield* snapshot).projects[result.projectId]!
    runner.script("stop", () => Effect.fail(new RunnerRejected({ reason: "synthetic-private-stop-output" })))
    const archive = { requestId: freshRequest(), projectId: row.projectId }
    expect(failureOf(yield* call(owner, "project.archive", archive))?.reason).toBe("project archive is unfinished because an agent could not stop")
    expect(projectView(yield* snapshot).projects[row.projectId]).toMatchObject({ archiving: true })
    expect(projectView(yield* snapshot).projects[row.projectId]?.archivedAt).toBeUndefined()
    expect((yield* snapshot).agents[row.leadAgentId]?.state._tag).toBe("idle")
    expect(failureOf(yield* call(owner, "project.restore", { projectId: row.projectId }))).toBeDefined()
    runner.script("stop", () => Effect.void)
    success(yield* call(owner, "project.archive", archive))
    expect(projectView(yield* snapshot).projects[row.projectId]?.archivedAt).toBeGreaterThan(0)
    success(yield* call(owner, "project.restore", { projectId: row.projectId }))
    expect(projectView(yield* snapshot).projects[row.projectId]).toMatchObject({ leadAgentId: row.leadAgentId, worktreeId: row.worktreeId, goal: row.goal })
    expect(runner.callsOf("start")).toHaveLength(1)
    expect(JSON.stringify(yield* readLog)).not.toContain("synthetic-private-stop-output")
  }))
}))

live("refuses unknown machines and unavailable defaults before mutations, and chooses ready defaults without assuming Claude", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    const repoId = yield* setup(), request = payload(repoId)
    expect(failureOf(yield* call(owner, "project.create", { ...request, machineId: "offline" }))?.reason).toContain("confirmed local")
    const defaults = { harness: "cursor", account: { _tag: "named", accountId: "primary" }, model: "test-model", effort: "high", permission: "ask" }
    success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "bash", lead: defaults } }))
    success(yield* call(owner, "accounts", { operation: "disable", accountId: "primary" }))
    expect(failureOf(yield* call(owner, "project.create", request))?.reason).toBe("no ready signed-in lead account is available")
    expect(success(yield* call(owner, "project.creations", {})).items).toHaveLength(0)
    success(yield* call(owner, "accounts", { operation: "set", account: { id: "primary", harness: "cursor", enabled: true, environment: { CURSOR_API_KEY: [...secrets.stored.keys()][0] } } }))
    const result = success(yield* call(owner, "project.create", request))
    const row = projectView(yield* snapshot).projects[result.projectId]!
    expect(runner.callsOf("start")[0]?.input).toMatchObject({ model: "test-model", effort: "high", permission: "ask" })
    expect((yield* snapshot).agents[row.leadAgentId]?.harness).toBe("cursor")
    expect(success(yield* call(owner, "project.settings", {})).settings.lead).toEqual(defaults)
  }))
}))


live("finishes the same service launch after caller cancellation at the committed receipt boundary", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  const committed = yield* Deferred.make<void>(), release = yield* Deferred.make<void>()
  const wrapLog: NonNullable<Fakes["wrapLog"]> = (real) => ({ ...real, transact: (use) => {
    let created = false
    return real.transact((append) => use((actor, id, hash, events, rows, receipt) => {
      if (events.some((event) => event._tag === "project.Created")) created = true
      return append(actor, id, hash, events, rows, receipt)
    })).pipe(Effect.tap(() => created ? Deferred.succeed(committed, undefined).pipe(Effect.andThen(Deferred.await(release))) : Effect.void))
  } })
  yield* provideRig(rig, { runner, secrets, wrapLog }, Effect.gen(function* () {
    const repoId = yield* setup(), request = payload(repoId)
    const caller = yield* call(owner, "project.create", request).pipe(Effect.forkScoped)
    yield* Deferred.await(committed)
    expect((yield* readLog).filter(({ event }) => event._tag === "AgentStarted")).toHaveLength(1)
    expect(runner.callsOf("start")).toHaveLength(0)
    yield* Fiber.interrupt(caller)
    yield* Deferred.succeed(release, undefined)
    const result = success(yield* call(owner, "project.create", request))
    const row = projectView(yield* snapshot).projects[result.projectId]!
    expect(runner.callsOf("start")).toHaveLength(1)
    expect(runner.callsOf("start")[0]?.input).toMatchObject({ agentId: row.leadAgentId })
    expect((yield* snapshot).agents[row.leadAgentId]?.state._tag).not.toBe("starting")
    expect(git(rig.work, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(2)
    expect((yield* readLog).filter(({ event }) => event._tag === "AgentStarted")).toHaveLength(1)
  }))
}))

live("retries a mkdir whose claim append failed, using only its own filesystem witness", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  let armed = true
  const wrapLog: NonNullable<Fakes["wrapLog"]> = (real) => ({ ...real, transact: (use) => real.transact((append) => use((actor, id, hash, events, rows, receipt) => {
    if (armed && events.some((event) => event._tag === "project.CreationClaimed")) {
      armed = false
      return Effect.fail(new LogWriteFailed({ reason: "injected before directory claim append" }))
    }
    return append(actor, id, hash, events, rows, receipt)
  })) })
  const request = yield* provideRig(rig, { runner, secrets, wrapLog }, Effect.gen(function* () {
    const repoId = yield* setup(), request = payload(repoId)
    expect(failureOf(yield* call(owner, "project.create", request))?._tag).toBe("LogWriteFailed")
    const row = success(yield* call(owner, "project.creations", {})).items[0]
    expect(row.folderIdentity).toBeUndefined()
    expect(readFileSync(join(row.workspace.path, ".lgtm-project-creation"), "utf8")).toContain(request.requestId)
    return request
  }))
  yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* recover
    const result = success(yield* call(owner, "project.create", request))
    expect(projectView(yield* snapshot).projects[result.projectId]).toBeDefined()
    expect(runner.callsOf("start")).toHaveLength(1)
    expect(success(yield* call(owner, "project.creations", {})).items).toEqual([])
  }), { secrets })
}))

const repositoryBytes = (root: string): unknown => {
  const visit = (path: string): unknown => {
    const info = lstatSync(path)
    return { mode: info.mode, ...(info.isSymbolicLink() ? { link: readlinkSync(path) }
      : info.isDirectory() ? { children: Object.fromEntries(readdirSync(path).sort().map((name) => [name, visit(join(path, name))])) }
      : { hash: createHash("sha256").update(readFileSync(path)).digest("hex") }) }
  }
  return visit(root)
}

live("issue 579: an archive holding a reused request can still acquire its member lane while stop queues, then both finish with honest receipts", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  const archivedStart = yield* Deferred.make<void>(), releaseArchive = yield* Deferred.make<void>()
  const wrapLog: NonNullable<Fakes["wrapLog"]> = (real) => ({ ...real, transact: (use) => {
    let started = false
    return real.transact((append) => use((actor, id, hash, events, rows, receipt) => {
      started ||= events.some((event) => event._tag === "project.ArchiveStarted")
      return append(actor, id, hash, events, rows, receipt)
    })).pipe(Effect.tap(() => started ? Deferred.succeed(archivedStart, undefined).pipe(Effect.andThen(Deferred.await(releaseArchive))) : Effect.void))
  } })
  yield* provideRig(rig, { runner, secrets, wrapLog }, Effect.gen(function* () {
    yield* Effect.addFinalizer(() => Deferred.succeed(releaseArchive, undefined))
    const repoId = yield* setup(), created = success(yield* call(owner, "project.create", payload(repoId)))
    const row = projectView(yield* snapshot).projects[created.projectId]!, log = yield* EventLog
    const requestId = freshRequest(), requestKey = JSON.stringify(["request", "owner", requestId])
    const realWithLane = Lanes.withLane
    let requestAttempts = 0
    const observed: typeof Lanes.withLane = (target, key) => (effect) => Effect.sync(() => {
      if (key === requestKey) requestAttempts++
    }).pipe(Effect.andThen(realWithLane(target, key)(effect)))
    vi.spyOn(Lanes, "withLane").mockImplementation(observed)
    const archiveRequest = { requestId, projectId: row.projectId }
    const archiving = yield* call(owner, "project.archive", archiveRequest).pipe(Effect.forkScoped)
    yield* Deferred.await(archivedStart)
    expect(projectView(yield* snapshot).projects[row.projectId]?.archiving).toBe(true)
    expect(runner.callsOf("stop")).toHaveLength(0)
    const stopping = yield* call(owner, "stop", { requestId, agentId: row.leadAgentId }).pipe(Effect.forkScoped)
    yield* Effect.addFinalizer(() => Fiber.interrupt(stopping).pipe(Effect.andThen(Deferred.succeed(releaseArchive, undefined))))
    const attemptedBy = Date.now() + 5000
    while (requestAttempts < 2 && Date.now() < attemptedBy) yield* Effect.sleep("10 millis")
    expect(requestAttempts).toBe(2)
    // Positive acquisition, after the real stop reached its request-lane
    // attempt, distinguishes the ordering from a merely slow command.
    const probe = yield* realWithLane(log, row.leadAgentId)(Effect.succeed("member available")).pipe(Effect.timeoutOption(5000))
    expect(probe._tag).toBe("Some")
    if (probe._tag === "Some") expect(probe.value).toBe("member available")
    yield* Deferred.succeed(releaseArchive, undefined)
    const archived = yield* Fiber.join(archiving).pipe(Effect.timeoutOption(5000))
    const stopped = yield* Fiber.join(stopping).pipe(Effect.timeoutOption(5000))
    expect(archived._tag).toBe("Some"); expect(stopped._tag).toBe("Some")
    if (archived._tag === "Some") expect(success(yield* call(owner, "project.archive", archiveRequest))).toEqual(success(archived.value))
    if (stopped._tag === "Some") expect(failureOf(stopped.value)?.reason).toBe("request id reused")
    expect(runner.callsOf("stop")).toHaveLength(1)
    expect(projectView(yield* snapshot).projects[row.projectId]?.archivedAt).toBeGreaterThan(0)
    expect((yield* snapshot).agents[row.leadAgentId]?.state._tag).toBe("stopped")
    expect((yield* readLog).filter(({ event }) => event._tag === "project.Archived")).toHaveLength(1)
    expect((yield* readLog).filter(({ event }) => event._tag === "AgentStopped")).toHaveLength(1)
  }))
}))

live("issue 579: a stop holding the same request through its process continuation makes archive refuse before ArchiveStarted", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    const repoId = yield* setup(), created = success(yield* call(owner, "project.create", payload(repoId)))
    const row = projectView(yield* snapshot).projects[created.projectId]!
    const processEntered = yield* Deferred.make<void>(), releaseProcess = yield* Deferred.make<void>()
    runner.script("stop", () => Deferred.succeed(processEntered, undefined).pipe(Effect.andThen(Deferred.await(releaseProcess))))
    yield* Effect.addFinalizer(() => Deferred.succeed(releaseProcess, undefined))
    const requestId = freshRequest(), requestKey = JSON.stringify(["request", "owner", requestId])
    const realWithLane = Lanes.withLane
    let requestAttempts = 0
    const observed: typeof Lanes.withLane = (target, key) => (effect) => Effect.sync(() => {
      if (key === requestKey) requestAttempts++
    }).pipe(Effect.andThen(realWithLane(target, key)(effect)))
    vi.spyOn(Lanes, "withLane").mockImplementation(observed)
    const stopRequest = { requestId, agentId: row.leadAgentId }
    const stopping = yield* call(owner, "stop", stopRequest).pipe(Effect.forkScoped)
    yield* Deferred.await(processEntered)
    expect((yield* snapshot).agents[row.leadAgentId]?.state._tag).toBe("stopped")
    const archiving = yield* call(owner, "project.archive", { requestId, projectId: row.projectId }).pipe(Effect.forkScoped)
    const attemptedBy = Date.now() + 5000
    while (requestAttempts < 2 && Date.now() < attemptedBy) yield* Effect.sleep("10 millis")
    expect(requestAttempts).toBe(2)
    yield* Deferred.succeed(releaseProcess, undefined)
    const stopped = yield* Fiber.join(stopping).pipe(Effect.timeoutOption(5000))
    const archived = yield* Fiber.join(archiving).pipe(Effect.timeoutOption(5000))
    expect(stopped._tag).toBe("Some"); expect(archived._tag).toBe("Some")
    if (stopped._tag === "Some") expect(success(yield* call(owner, "stop", stopRequest))).toEqual(success(stopped.value))
    if (archived._tag === "Some") expect(failureOf(archived.value)?.reason).toBe("request id reused")
    expect(runner.callsOf("stop")).toHaveLength(1)
    expect(projectView(yield* snapshot).projects[row.projectId]?.archiving).not.toBe(true)
    expect(projectView(yield* snapshot).projects[row.projectId]?.archivedAt).toBeUndefined()
    expect((yield* readLog).filter(({ event }) => ["project.ArchiveStarted", "project.Archived"].includes(event._tag))).toEqual([])
  }))
}))

for (const repository of ["new", "existing"] as const) live(`issue 576: refuses false ${repository} placement and preview without effects, then creates one dedicated checkout`, () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    const repoId = yield* setup()
    const request = { ...payload(repoId), repository: repository === "existing" ? { _tag: "existing", repoId } : { _tag: "new", name: "New dedicated repo" }, useWorktree: false }
    const bytes = repositoryBytes(rig.work), root = readdirSync(rig.root).sort(), before = yield* readLog
    for (let retry = 0; retry < 2; retry++) {
      expect(failureOf(yield* call(owner, "project.placement.preview", request))?.reason).toBe("projects require a dedicated worktree")
      expect(failureOf(yield* call(owner, "project.create", request))?.reason).toBe("projects require a dedicated worktree")
      expect(repositoryBytes(rig.work)).toEqual(bytes)
      expect(readdirSync(rig.root).sort()).toEqual(root)
      expect(yield* readLog).toEqual(before)
      expect(Object.values(projectView(yield* snapshot).creations)).toEqual([])
      expect(Object.values(projectView(yield* snapshot).projects)).toEqual([])
      expect(runner.callsOf("start")).toHaveLength(0)
    }
    const checked = { ...request, requestId: freshRequest(), useWorktree: true }
    const preview = success(yield* call(owner, "project.placement.preview", checked)).result
    expect(preview).toMatchObject({ checkout: "worktree", branch: "console", reserved: false })
    expect(preview.path).toBe(join(preview.repositoryPath, ".worktrees/console"))
    expect(repositoryBytes(rig.work)).toEqual(bytes); expect(yield* readLog).toEqual(before)
    const created = success(yield* call(owner, "project.create", checked))
    expect(success(yield* call(owner, "project.create", checked))).toEqual(created)
    expect(failureOf(yield* call(owner, "project.create", { ...checked, useWorktree: false }))?.reason).toBe("request id reused")
    const view = projectView(yield* snapshot), row = view.projects[created.projectId]!, workspace = view.workspaces[row.worktreeId]!
    const main = Object.values(view.workspaces).find((item) => item.repoId === row.repoId && item.checkout === "main")!
    expect(workspace).toMatchObject({ path: preview.path, branch: preview.branch, checkout: "worktree" })
    expect(main.path).toBe(preview.repositoryPath); expect(main.worktreeId).not.toBe(workspace.worktreeId)
    expect(git(workspace.path, "branch", "--show-current")).toBe(preview.branch)
    expect(git(main.path, "branch", "--show-current")).toBe("main")
    expect(git(main.path, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(2)
    expect(runner.callsOf("start")).toHaveLength(1)
    expect(runner.callsOf("start")[0]?.input.folder).toBe(workspace.path)
  }))
}))

live("issue 576: refuses a schema-valid saved main-checkout intent before effects, retaining its reservation for explicit abandonment", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  // Model a readable old placement at the real intent append boundary. The
  // current request asks for a worktree, so this also tests the saved plan's
  // admission independently of the incoming false-option check.
  const wrapLog: NonNullable<Fakes["wrapLog"]> = (real) => ({ ...real, transact: (use) => real.transact((append) => use((actor, id, hash, events, rows, receipt) =>
    append(actor, id, hash, events.map((event) => event._tag !== "project.CreationPlanned" ? event : eventOf({ ...event,
      creation: { ...event.creation, workspace: { ...event.creation.workspace, checkout: "main", path: event.creation.repository.path, branch: "main" } },
    })), rows, receipt))) })
  const request = yield* provideRig(rig, { runner, secrets, wrapLog }, Effect.gen(function* () {
    const repoId = yield* setup(), request = { ...payload(repoId), useWorktree: true }
    const bytes = repositoryBytes(rig.work)
    expect(failureOf(yield* call(owner, "project.create", request))?.reason).toBe("projects require a dedicated worktree")
    expect(repositoryBytes(rig.work)).toEqual(bytes)
    const pending = success(yield* call(owner, "project.creations", {})).items
    expect(pending).toHaveLength(1)
    expect(pending[0].workspace).toMatchObject({ path: rig.work, checkout: "main" })
    expect(runner.callsOf("start")).toHaveLength(0)
    return request
  }))
  yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* recover
    const bytes = repositoryBytes(rig.work), before = yield* readLog
    expect(failureOf(yield* call(owner, "project.create", request))?.reason).toBe("projects require a dedicated worktree")
    expect(failureOf(yield* call(owner, "project.create", { ...request, goal: "Changed" }))?.reason).toBe("request id reused")
    expect(repositoryBytes(rig.work)).toEqual(bytes); expect(yield* readLog).toEqual(before)
    expect(success(yield* call(owner, "project.creations", {})).items).toHaveLength(1)
    expect(Object.values(projectView(yield* snapshot).projects)).toEqual([])
    expect(runner.callsOf("start")).toHaveLength(0)
    success(yield* call(owner, "project.creation.abandon", { creationRequestId: request.requestId }))
    expect(repositoryBytes(rig.work)).toEqual(bytes)
    const created = success(yield* call(owner, "project.create", { ...request, requestId: freshRequest() }))
    const view = projectView(yield* snapshot)
    expect(view.workspaces[view.projects[created.projectId]!.worktreeId]?.checkout).toBe("worktree")
    expect(runner.callsOf("start")).toHaveLength(1)
  }), { secrets })
}))

live("issue 578: owner abandonment releases only the intent, preserves every repository byte and mode, and replays after restart", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  const failed = yield* provideRig(rig, { runner, secrets, wrapLog: failCreated() }, Effect.gen(function* () {
    const repoId = yield* setup(), request = payload(repoId)
    expect(failureOf(yield* call(owner, "project.create", request))?._tag).toBe("LogWriteFailed")
    const pending = success(yield* call(owner, "project.creations", {})).items[0]
    return { request, pending, repoId }
  }))
  const saved = yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* recover
    const { request, pending, repoId } = failed
    const member = yield* seedAgent({ id: "cannot-abandon" })
    const abandon = { requestId: freshRequest(), creationRequestId: request.requestId }
    const bytes = repositoryBytes(rig.work)
    expect(failureOf(yield* call(agentCredential(member.token), "project.creation.abandon", abandon))?._tag).toBe("CommandRefused")
    expect(success(yield* call(owner, "project.creations", {})).items).toHaveLength(1)
    const before = yield* readLog
    const result = success(yield* call(owner, "project.creation.abandon", abandon))
    expect(success(yield* call(owner, "project.creation.abandon", abandon))).toEqual(result)
    expect(repositoryBytes(rig.work)).toEqual(bytes)
    expect((yield* readLog).slice(before.length).map((row) => row.event)).toEqual([{ _tag: "project.CreationFinished", creationRequestId: request.requestId }])
    expect(success(yield* call(owner, "project.creations", {})).items).toEqual([])
    const preview = success(yield* call(owner, "project.placement.preview", payload(repoId))).result
    expect(preview.reserved).toBe(false)
    expect(git(pending.workspace.path, "branch", "--show-current")).toBe("console")
    return { abandon, result, bytes }
  }), { secrets })
  yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* recover
    expect(success(yield* call(owner, "project.creation.abandon", saved.abandon))).toEqual(saved.result)
    expect(repositoryBytes(rig.work)).toEqual(saved.bytes)
    expect(success(yield* call(owner, "project.creations", {})).items).toEqual([])
  }), { secrets })
}))

for (const state of ["paused", "interrupted", "idle"] as const) for (const canStop of [false, true]) {
  live(`issue 584: restart of an archiving ${state} member, stop succeeds=${canStop}`, () => Effect.gen(function* () {
    const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
    yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* seedAccount(); yield* seedHarness()
      const member = yield* seedAgent({ id: "archiving-member", state })
      yield* appendSetup([
        eventOf({ _tag: "project.RepositoryAdded", repoId: "archive-repo", name: "Archive", path: rig.work }),
        eventOf({ _tag: "project.WorktreeCreated", repoId: "archive-repo", worktreeId: "archive-worktree", machineId: "local", path: rig.work, branch: "main" }),
        eventOf({ _tag: "project.Created", repoId: "archive-repo", worktreeId: "archive-worktree", projectId: "archive-project", machineId: "local", leadAgentId: member.agentId, name: "Archive", goal: "" }),
        eventOf({ _tag: "project.ArchiveStarted", projectId: "archive-project" }),
      ])
    }))
    if (!canStop) runner.script("stop", () => Effect.fail(new RunnerRejected({ reason: "Synthetic stop failure" })))
    const calls = runner.calls.length, logLines: string[] = []
    yield* provideRestart(rig, runner.layer, Effect.gen(function* () {
      yield* registerRebuildCheck(); yield* recover
      const view = projectView(yield* snapshot), project = view.projects["archive-project"]!
      const member = (yield* snapshot).agents["archiving-member"]!
      expect(runner.calls.slice(calls).filter((call) => ["start", "load", "resume", "prompt"].includes(call.method))).toEqual([])
      if (canStop) { expect(project.archivedAt).toBeGreaterThan(0); expect(member.state._tag).toBe("stopped") }
      else {
        expect(project.archiving).toBe(true); expect(project.archivedAt).toBeUndefined()
        expect(logLines.join("\n")).toContain("project archive is unfinished")
        expect(failureOf(yield* call(owner, "resume", { agentId: member.agentId, fresh: true }))?._tag).toBe("CommandRefused")
        success(yield* call(owner, "accounts mark-available", { accountId: "primary" }))
        expect(runner.calls.slice(calls).filter((call) => ["start", "load", "resume", "prompt"].includes(call.method))).toEqual([])
      }
    }), { secrets, logLines })
  }))
}

live("issue 591: stale branch-refusal admission creates no terminal receipt until current binding is restored", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    const repoId = yield* setup(), request = payload(repoId)
    git(rig.work, "checkout", "-b", "feature")
    const ready = yield* Deferred.make<void>(), release = yield* Deferred.make<void>()
    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
    const actual = Lifecycle.prepareProjectLifecycle
    vi.spyOn(Lifecycle, "prepareProjectLifecycle").mockImplementation((...args) => actual(...args).pipe(Effect.tap(() =>
      Deferred.succeed(ready, undefined).pipe(Effect.andThen(Deferred.await(release))))))
    const pending = yield* call(owner, "project.create", request).pipe(Effect.forkChild)
    yield* Deferred.await(ready).pipe(Effect.timeout("5 seconds"))
    success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.work, shell: "bash" } }))
    yield* Deferred.succeed(release, undefined)
    expect(failureOf(yield* Fiber.join(pending))?.reason).toBe("project state changed; refresh and retry")
    const sql = yield* SqlClient.SqlClient
    expect(yield* sql`SELECT request_id FROM receipts WHERE request_id = ${request.requestId}`).toEqual([])
    expect(projectView(yield* snapshot).creations).toEqual({})
    expect((yield* readLog).some((row) => row.event._tag === "project.CreationPlanned")).toBe(false)
    expect(runner.callsOf("start")).toHaveLength(0)
    vi.restoreAllMocks()
    success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "zsh" } }))
    expect(failureOf(yield* call(owner, "project.create", request))?.reason).toBe(checkoutMainReason)
    expect(yield* sql`SELECT request_id FROM receipts WHERE request_id = ${request.requestId}`).toHaveLength(1)
    git(rig.work, "checkout", "main")
    expect(failureOf(yield* call(owner, "project.create", request))?.reason).toBe(checkoutMainReason)
    expect(projectView(yield* snapshot).creations).toEqual({})
    expect(runner.callsOf("start")).toHaveLength(0)
  }))
}))

for (const branch of ["feature", "detached"]) live(`issue 591: refuses an existing ${branch} main checkout before an intent or filesystem effect`, () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    const repoId = yield* setup()
    if (branch === "detached") git(rig.work, "checkout", "--detach")
    else git(rig.work, "checkout", "-b", branch)
    const before = repositoryBytes(rig.work), request = payload(repoId)
    for (const name of ["project.placement.preview", "project.create"]) {
      const refused = yield* call(owner, name, request)
      expect(failureOf(refused)?.reason).toBe(checkoutMainReason)
      expect(failureOf(yield* call(owner, name, request))?.reason).toBe(checkoutMainReason)
      expect(repositoryBytes(rig.work)).toEqual(before)
    }
    expect(projectView(yield* snapshot).creations).toEqual({})
    expect(projectView(yield* snapshot).workspaces).toEqual({})
    expect(runner.callsOf("start")).toHaveLength(0)
    expect((yield* readLog).filter((row) => row.event._tag === "project.CreationPlanned")).toEqual([])
    const refusalRows = (yield* readLog).filter((row) => row.requestId === request.requestId)
    expect(refusalRows.map((row) => row.event)).toMatchObject([{ _tag: "CommandRefused", command: "project.create", reason: checkoutMainReason }])
    expect(failureOf(yield* call(owner, "project.create", { ...request, goal: "Changed" }))?.reason).toBe("request id reused")
    git(rig.work, "checkout", "main")
    // The initial refusal receipt remains exact; a corrected form uses a new id.
    expect(failureOf(yield* call(owner, "project.create", request))?.reason).toBe(checkoutMainReason)
    expect((yield* readLog).filter((row) => row.requestId === request.requestId)).toEqual(refusalRows)
    const result = success(yield* call(owner, "project.create", { ...request, requestId: freshRequest() }))
    expect(projectView(yield* snapshot).projects[result.projectId]).toBeDefined()
    expect(Object.values(projectView(yield* snapshot).workspaces).find((row) => row.checkout === "main")?.branch).toBe("main")
    expect(runner.callsOf("start")).toHaveLength(1)
  }))
}))

live("issue 591: an existing master checkout remains a usable owner review destination", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    const repoId = yield* setup()
    git(rig.work, "branch", "-m", "master")
    const request = payload(repoId), preview = success(yield* call(owner, "project.placement.preview", request)).result
    const created = success(yield* call(owner, "project.create", request))
    expect(success(yield* call(owner, "project.create", request))).toEqual(created)
    const view = projectView(yield* snapshot), project = view.projects[created.projectId]!
    const main = Object.values(view.workspaces).find((row) => row.checkout === "main")!
    expect(main.branch).toBe("master")
    expect(view.workspaces[project.worktreeId]!.path).toBe(preview.path)
    const reviewed = success(yield* call(owner, "project.review.prepare", { projectId: project.projectId, worktreeId: project.worktreeId, destinationId: main.worktreeId })).result.review
    expect(reviewed).toMatchObject({ base: "master", outcome: "open" })
    expect(runner.callsOf("start")).toHaveLength(1)
  }))
}))
