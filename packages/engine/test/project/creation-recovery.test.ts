import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Deferred from "effect/Deferred"
import * as Fiber from "effect/Fiber"
import * as Redacted from "effect/Redacted"
import { afterEach, beforeEach, expect, vi } from "vitest"
import { LogWriteFailed, type EventLog } from "../../src/log/EventLog.ts"
import { RunnerRejected } from "../../src/runner/Runner.ts"
import { projectView } from "../../src/project/view.ts"
import { snapshot } from "../support/routingRig.ts"
import { makeFakeRunner } from "../support/fakeRunner.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { provideRestart, recover } from "../support/restartRig.ts"
import { call, failureOf, freshRequest, harnessSettings, makeFakeSecrets, makeRig, ownerCredential as owner,
  provideRig, readLog, removeRig, seedAccount, seedHarness, success, type Fakes, type Rig } from "../support/handlerRig.ts"

const live = (name: string, body: () => Effect.Effect<unknown, unknown, any>) => it.live(name, () => body() as Effect.Effect<unknown, unknown, never>)
let rig: Rig
const git = (path: string, ...args: string[]) => execFileSync("git", ["-C", path, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
beforeEach(() => {
  rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder)
  git(rig.work, "init", "-b", "main")
  git(rig.work, "-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Initial")
})
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig) })
const setup = () => Effect.gen(function* () {
  yield* registerRebuildCheck(); yield* seedAccount(); yield* seedHarness()
  success(yield* call(owner, "harnesses", { operation: "set", harness: harnessSettings("first", { adapterPath: process.execPath, reportedModes: [{ id: "default", level: "ask" }] }) }))
  success(yield* call(owner, "accounts set-secret", { accountId: "primary", name: "TEST_API_KEY", nonce: "test-project", value: Redacted.make("synthetic-project-credential-012345") }))
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
    success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "bash", lead: { harness: "first", account: { _tag: "named", accountId: "primary" }, model: "test-model", effort: "high", permission: "ask" } } }))
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
    expect(success(yield* call(owner, "project.settings", {})).settings.lead).toMatchObject({ harness: "first", model: "test-model", effort: "high" })
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
    const request = { requestId: freshRequest(), name: "Fresh", goal: "Plan", machineId: "local", repository: { _tag: "new", name: "New repo" }, useWorktree: false }
    expect(failureOf(yield* call(owner, "project.create", request))?._tag).toBe("LogWriteFailed")
    const pending = success(yield* call(owner, "project.creations", {})).items[0]
    expect(git(pending.repository.path, "branch", "--show-current")).toBe("main")
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
    const repoId = yield* setup(), result = success(yield* call(owner, "project.create", { ...payload(repoId), useWorktree: false }))
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
    const defaults = { harness: "first", account: { _tag: "named", accountId: "primary" }, model: "test-model", effort: "high", permission: "ask" }
    success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "bash", lead: defaults } }))
    success(yield* call(owner, "accounts", { operation: "disable", accountId: "primary" }))
    expect(failureOf(yield* call(owner, "project.create", request))?.reason).toBe("no ready signed-in lead account is available")
    expect(success(yield* call(owner, "project.creations", {})).items).toHaveLength(0)
    success(yield* call(owner, "accounts", { operation: "set", account: { id: "primary", harness: "first", enabled: true, environment: { TEST_API_KEY: [...secrets.stored.keys()][0] } } }))
    const result = success(yield* call(owner, "project.create", request))
    const row = projectView(yield* snapshot).projects[result.projectId]!
    expect(runner.callsOf("start")[0]?.input).toMatchObject({ model: "test-model", effort: "high", permission: "ask" })
    expect((yield* snapshot).agents[row.leadAgentId]?.harness).toBe("first")
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
    expect(readFileSync(join(row.workspace.path, ".lgcode-project-creation"), "utf8")).toContain(request.requestId)
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
