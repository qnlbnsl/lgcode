import { randomBytes, createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, lstatSync, readlinkSync } from "node:fs"
import { join } from "node:path"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { afterEach, beforeEach, expect, vi } from "vitest"
import * as Server from "../../src/api/server.ts"
import { projectView } from "../../src/project/view.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { makeFakeRunner } from "../support/fakeRunner.ts"
import { ancestryHeaders, connect, upgradeStatus } from "../support/socketClient.ts"
import { snapshot } from "../support/routingRig.ts"
import { call, failureOf, freshRequest, harnessSettings, makeFakeSecrets, makeRig, ownerCredential as owner, provideRig, readLog, removeRig, success, type Rig } from "../support/handlerRig.ts"

let rig: Rig
const git = (folder: string, ...args: string[]) => execFileSync("git", ["-C", folder, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
const files = (root: string): unknown => readdirSync(root).sort().map((name) => {
  const path = join(root, name), stat = lstatSync(path)
  return [name, stat.mode, stat.isSymbolicLink() ? readlinkSync(path) : stat.isDirectory() ? files(path) : createHash("sha256").update(readFileSync(path)).digest("hex")]
})
beforeEach(() => {
  rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder)
  git(rig.work, "init", "-b", "main"); git(rig.work, "config", "user.name", "Actual Git Owner")
})
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig) })
const configured = () => Effect.gen(function* () {
  success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.work, shell: "zsh" } }))
  success(yield* call(owner, "harnesses", { operation: "set", harness: harnessSettings("claude", { adapterPath: process.execPath, reportedModes: [{ id: "default", level: "ask" }] }) }))
  success(yield* call(owner, "accounts", { operation: "add", account: { id: "ready", harness: "claude", enabled: true } }))
  success(yield* call(owner, "accounts set-secret", { accountId: "ready", name: "ANTHROPIC_API_KEY", nonce: freshRequest(), value: Redacted.make("synthetic-first-run-credential") }))
})
it.live("persists authenticated monotonic progress and positive completion after every project is archived and the engine restarts", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  let completedAt: number | undefined
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    yield* registerRebuildCheck()
    const bearer = randomBytes(32).toString("base64url"), socket = join(rig.stateFolder, "setup.sock")
    yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false })
    expect((yield* Effect.promise(() => upgradeStatus(socket, ancestryHeaders()))).status).toBe(401)
    const api = yield* connect(socket, bearer)
    expect((yield* api["project.setup"]({ requestId: freshRequest() })).setup).toEqual({ step: "welcome" })
    expect((yield* api["project.setup.advance"]({ requestId: freshRequest(), step: "project" }).pipe(Effect.result))._tag).toBe("Failure")
    const advance = { requestId: freshRequest(), step: "found" as const }
    yield* api["project.setup.advance"](advance); yield* api["project.setup.advance"](advance)
    yield* api["project.setup.advance"]({ requestId: freshRequest(), step: "welcome" })
    expect((yield* api["project.setup"]({ requestId: freshRequest() })).setup.step).toBe("found")
    yield* configured()
    const scanBefore = yield* readLog, beforeFiles = files(rig.work), beforeHomes = files(rig.home)
    const scan = (yield* api["project.setup.discover"]({ requestId: freshRequest() })).result
    expect(scan.state).toBe("available"); expect(scan.repositories.map((row) => row.path)).toContain(rig.work)
    expect(scan.ownerNameSuggestion).toBe("Actual Git Owner")
    expect(scan.harnesses.map((row) => Object.keys(row).sort())).toEqual(scan.harnesses.map(() => ["accounts", "configured", "harness", "installed"]))
    expect(scan.readyDefaults).toMatchObject({ harness: "claude", account: { _tag: "named", accountId: "ready" } })
    expect(scan.harnesses.find((row) => row.harness === "claude")?.accounts).toEqual([{ accountId: "ready", state: "local-credential", remoteAuthentication: "not-checked" }])
    expect(yield* readLog).toEqual(scanBefore); expect(files(rig.work)).toEqual(beforeFiles); expect(files(rig.home)).toEqual(beforeHomes)
    expect(runner.callsOf("start")).toHaveLength(0)
    yield* api["project.setup.advance"]({ requestId: freshRequest(), step: "project" })
    expect((yield* api["project.setup.complete"]({ requestId: freshRequest(), projectId: "missing" as never }).pipe(Effect.result))._tag).toBe("Failure")
    yield* api["project.settings.set"]({ requestId: freshRequest(), settings: { workspaceFolder: rig.work, shell: "bash", lead: scan.readyDefaults!, displayName: "Edited Owner" } })
    yield* api["project.settings.set"]({ requestId: freshRequest(), settings: { workspaceFolder: rig.work, shell: "zsh", lead: scan.readyDefaults! } })
    expect((yield* api["project.settings"]({ requestId: freshRequest() })).settings?.displayName).toBe("Edited Owner")
    const create = { requestId: freshRequest(), name: "First project", goal: "A real first plan", machineId: "local", repository: { _tag: "new" as const, name: "Created" }, useWorktree: true }
    const beforeCreate = yield* readLog, beforeCreateFiles = files(rig.work)
    const refusals = [
      yield* api["project.placement.preview"]({ ...create, requestId: freshRequest(), useWorktree: false }).pipe(Effect.result),
      yield* api["project.create"]({ ...create, requestId: freshRequest(), useWorktree: false }).pipe(Effect.result),
    ]
    for (const refused of refusals) {
      expect(refused._tag === "Failure" && refused.failure.reason).toBe("projects require a dedicated worktree")
    }
    expect(yield* readLog).toEqual(beforeCreate); expect(files(rig.work)).toEqual(beforeCreateFiles)
    expect(runner.callsOf("start")).toHaveLength(0)
    const created = yield* api["project.create"](create)
    expect(yield* api["project.create"](create)).toEqual(created)
    expect(runner.callsOf("start")).toHaveLength(1)
    const placement = projectView(yield* snapshot), project = placement.projects[created.projectId]!, workspace = placement.workspaces[project.worktreeId]!
    expect(workspace).toMatchObject({ checkout: "worktree", branch: "first-project", path: join(rig.work, "created/.worktrees/first-project") })
    expect(runner.callsOf("start")[0]?.input.folder).toBe(workspace.path)
    const finish = { requestId: freshRequest(), projectId: created.projectId }
    yield* api["project.setup.complete"](finish); yield* api["project.setup.complete"](finish)
    expect((yield* api["project.setup.complete"]({ ...finish, requestId: freshRequest() }).pipe(Effect.result))._tag).toBe("Failure")
    completedAt = (yield* api["project.setup"]({ requestId: freshRequest() })).setup.completedAt
    expect(completedAt).toBeGreaterThan(0)
    yield* api["project.archive"]({ requestId: freshRequest(), projectId: created.projectId })
    expect(Object.values(projectView(yield* snapshot).projects).every((row) => row.archivedAt !== undefined)).toBe(true)
    expect((yield* readLog).filter((row) => row.event._tag === "project.SetupAdvanced")).toHaveLength(2)
    expect((yield* readLog).filter((row) => row.event._tag === "project.SetupCompleted")).toHaveLength(1)
    expect(JSON.stringify(yield* readLog)).not.toContain("synthetic-first-run-credential")
  }))
  const restartedRunner = yield* makeFakeRunner()
  yield* provideRig(rig, { runner: restartedRunner, secrets }, Effect.gen(function* () {
    yield* registerRebuildCheck()
    expect(success(yield* call(owner, "project.setup", {})).setup).toMatchObject({ step: "project", completedAt })
    expect(projectView(yield* snapshot).settings?.displayName).toBe("Edited Owner")
    expect(restartedRunner.callsOf("start")).toHaveLength(0)
  }))
}))

it.live("recovers a failed scan and keeps missing executables, signed-out accounts, unavailable credentials and private homes separate", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* configured()
    success(yield* call(owner, "harnesses", { operation: "set", harness: harnessSettings("codex", { adapterPath: process.execPath }) }))
    success(yield* call(owner, "accounts", { operation: "add", account: { id: "private", harness: "codex", enabled: true } }))
    mkdirSync(join(rig.home, ".codex")); writeFileSync(join(rig.home, ".codex/auth.json"), JSON.stringify({ tokens: { access_token: "shared-only-token" } }))
    const homes = files(rig.home), before = yield* readLog
    const scan = () => call(owner, "project.setup.discover", {}).pipe(Effect.map((result) => success(result).result))
    const first = yield* scan()
    expect(first.harnesses.find((row: any) => row.harness === "codex").accounts).toEqual([{ accountId: "private", state: "signed-out", remoteAuthentication: "not-checked" }])
    expect(existsSync(join(rig.stateFolder, "providers/codex/private/shadow"))).toBe(false)
    expect(files(rig.home)).toEqual(homes); expect(yield* readLog).toEqual(before)
    success(yield* call(owner, "harnesses", { operation: "set", harness: harnessSettings("codex", { adapterPath: rig.outside }) }))
    expect((yield* scan()).harnesses.find((row: any) => row.harness === "codex").accounts[0].state).toBe("missing-executable")
    success(yield* call(owner, "harnesses", { operation: "set", harness: harnessSettings("codex", { adapterPath: process.execPath }) }))
    const privateHome = join(rig.stateFolder, "providers/codex/private/shadow")
    mkdirSync(privateHome, { recursive: true }); writeFileSync(join(privateHome, "auth.json"), "not-json")
    expect((yield* scan()).harnesses.find((row: any) => row.harness === "codex").accounts[0].state).toBe("unavailable")
    writeFileSync(join(privateHome, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "private-only-token" }))
    expect((yield* scan()).harnesses.find((row: any) => row.harness === "codex").accounts[0].state).toBe("local-credential")
    success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.outside, shell: "sh" } }))
    renameSync(rig.outside, rig.outside + "-moved")
    const failed = yield* scan()
    expect(failed).toMatchObject({ state: "unavailable", reason: "discovery unavailable; retry or change the workspace folder", repositories: [] })
    success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.work, shell: "sh" } }))
    expect((yield* scan()).state).toBe("available")
    expect(runner.callsOf("start")).toHaveLength(0)
    expect(Object.values(projectView(yield* snapshot).projects)).toEqual([])
    expect(Object.values((yield* snapshot).accounts).map((row) => row.id).sort()).toEqual(["private", "ready"])
  }))
}))

it.live("previews actual branch and folder collisions without reservation, filesystem writes or a lead", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* configured()
    git(rig.work, "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Initial")
    git(rig.work, "branch", "console")
    mkdirSync(join(rig.work, ".worktrees/console-2"), { recursive: true })
    const repoId = success(yield* call(owner, "project.repository.add", { name: "Product", path: rig.work, machineId: "local" })).repoId
    const before = files(rig.work), log = yield* readLog
    const request = { requestId: freshRequest(), name: "Console", goal: "Plan", repository: { _tag: "existing", repoId }, machineId: "local" }
    const preview = success(yield* call(owner, "project.placement.preview", request)).result
    expect(preview).toEqual({ repositoryPath: rig.work, path: join(rig.work, ".worktrees/console-3"), branch: "console-3", checkout: "worktree", reserved: false })
    expect(files(rig.work)).toEqual(before); expect(yield* readLog).toEqual(log); expect(runner.callsOf("start")).toHaveLength(0)
    expect(failureOf(yield* call(owner, "project.placement.preview", { ...request, useWorktree: false }))?.reason).toBe("projects require a dedicated worktree")
    expect(files(rig.work)).toEqual(before); expect(yield* readLog).toEqual(log); expect(runner.callsOf("start")).toHaveLength(0)
    mkdirSync(preview.path)
    const later = success(yield* call(owner, "project.placement.preview", { ...request, requestId: freshRequest() })).result
    expect(later.branch).toBe("console-4")
    const created = success(yield* call(owner, "project.create", { ...request, requestId: freshRequest() }))
    const view = projectView(yield* snapshot)
    expect(view.workspaces[view.projects[created.projectId]!.worktreeId]?.path).toBe(later.path)
  }))
}))
