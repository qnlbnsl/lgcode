import { randomBytes } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { afterEach, beforeEach, expect, vi } from "vitest"
import * as Server from "../../src/api/server.ts"
import { LogWriteFailed } from "../../src/log/EventLog.ts"
import { call, failureOf, success, ownerCredential } from "../support/handlerRig.ts"
import { projectView } from "../../src/project/view.ts"
import { ancestryHeaders, connect, upgradeStatus } from "../support/socketClient.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { agentRow, freshRequest, readLog } from "../support/handlerRig.ts"
import { snapshot, eventually } from "../support/routingRig.ts"
import { accountFor, alive, echoFile, effortOption, harnessFor, makeRunnerRig, modelOption, modeOption, readEcho,
  removeRunnerRig, withEngine, writeFakeAdapter, type RunnerRig } from "../support/acpRunnerRig.ts"

let rig: RunnerRig
const git = (path: string, ...args: string[]) => execFileSync("git", ["-C", path, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
beforeEach(() => {
  rig = makeRunnerRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder)
  git(rig.work, "init", "-b", "main")
  git(rig.work, "-c", "commit.gpgsign=false", "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "--allow-empty", "-m", "Initial")
})
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig) })

it.live("creates through the authenticated API, launches saved defaults, inherits children and archives/restores real processes", () => {
  const harness = harnessFor("cursor", writeFakeAdapter(rig), { models: ["model-small", "model-large"], efforts: ["low", "high"] })
  const echo = echoFile(rig), childEcho = echoFile(rig)
  const options = [{ optionId: "yes", name: "Allow", kind: "allow_once" }, { optionId: "no", name: "Deny", kind: "reject_once" }]
  const account = accountFor(harness.id, { configOptions: [modeOption(), modelOption(), effortOption()],
    turns: [[{ step: "permission", toolCallId: "creation-permission", title: "Write project notes", options }]] }, echo, { CURSOR_API_KEY: "secret:project-test" })
  const childAccount = accountFor(harness.id, { turns: [] }, childEcho, { CURSOR_API_KEY: "secret:project-test" }, "child")
  return withEngine(rig, { harness, accounts: [account, childAccount], secrets: { "secret:project-test": "synthetic-project-credential-1234" } }, () => Effect.gen(function* () {
    yield* registerRebuildCheck()
    const bearer = randomBytes(32).toString("base64url")
    yield* Server.serve({ socketPath: rig.socket, ownerCredential: Redacted.make(bearer), debug: false })
    expect((yield* Effect.promise(() => upgradeStatus(rig.socket, ancestryHeaders()))).status).toBe(401)
    const api = yield* connect(rig.socket, bearer)
    const lead = { harness: harness.id, account: { _tag: "named" as const, accountId: account.id }, model: "model-large", effort: "high", permission: "edit" as const }
    yield* api["project.settings.set"]({ requestId: freshRequest(), settings: { workspaceFolder: rig.work, shell: "zsh", lead } })
    expect((yield* api["project.settings"]({ requestId: freshRequest() })).settings?.lead).toEqual(lead)
    const { repoId } = yield* api["project.repository.add"]({ requestId: freshRequest(), name: "Product", path: rig.work, machineId: "local" })
    git(rig.work, "branch", "console")
    const exclude = join(rig.work, ".git/info/exclude"), previous = "# Personal exclusions\ncache/\n!cache/keep\n"
    writeFileSync(exclude, previous)
    const payload = { requestId: freshRequest(), repository: { _tag: "existing" as const, repoId }, name: "Console", goal: "Shape the first plan", machineId: "local" }
    const created = yield* api["project.create"](payload)
    const row = projectView(yield* snapshot).projects[created.projectId]!
    const workspace = projectView(yield* snapshot).workspaces[row.worktreeId]!
    expect(workspace.path).toBe(join(rig.work, ".worktrees/console-2"))
    expect(git(workspace.path, "branch", "--show-current")).toBe("console-2")
    expect(readFileSync(exclude, "utf8")).toBe(previous + "/.worktrees/\n")
    const peer = yield* readEcho(echo, (value) => value.inbound.some((frame) => frame.method === "session/prompt"))
    expect(peer.cwd).toBe(workspace.path)
    expect(peer.inbound.filter((frame) => frame.method === "session/set_config_option").map((frame) => frame.params)).toEqual(expect.arrayContaining([
      expect.objectContaining({ configId: "model", value: "model-large" }), expect.objectContaining({ configId: "effort", value: "high" }),
      expect.objectContaining({ configId: "mode", value: "accept-edits" })
    ]))
    expect((yield* agentRow(row.leadAgentId))?.permission).toBe("edit")
    expect(yield* api["project.create"](payload)).toEqual(created)
    expect((yield* readLog).filter(({ event }) => event._tag === "AgentStarted")).toHaveLength(1)
    expect((yield* api["project.create"]({ ...payload, name: "Different" }).pipe(Effect.result))._tag).toBe("Failure")
    const leadApi = yield* connect(rig.socket, peer.env.LGTM_TOKEN!)
    const childPayload = { requestId: freshRequest(), name: "Worker", role: "worker", harness: harness.id,
      account: { _tag: "named" as const, accountId: childAccount.id }, permission: "ask" as const, folder: workspace.path }
    expect((yield* leadApi.start({ ...childPayload, permission: "full" }).pipe(Effect.result))._tag).toBe("Failure")
    const child = yield* leadApi.start({ ...childPayload, requestId: freshRequest() })
    const childPeer = yield* readEcho(childEcho)
    expect(projectView(yield* snapshot).agentProjects[child.agentId]).toBe(created.projectId)
    yield* leadApi.ask({ requestId: freshRequest(), text: "Which part comes first?" })
    const requested = yield* eventually(snapshot, (state) => Object.values(state.requests).some((request) => request.status === "open"))
    expect(Object.values(requested.requests).some((request) => request.status === "open")).toBe(true)
    yield* api["project.rename"]({ requestId: freshRequest(), projectId: created.projectId, name: "Renamed" })
    yield* api["project.goal.set"]({ requestId: freshRequest(), projectId: created.projectId, goal: "Deliver a reviewed plan" })
    yield* api["project.preferences.set"]({ requestId: freshRequest(), projectId: created.projectId, shell: "bash" })
    expect(projectView(yield* snapshot).workspaces[row.worktreeId]).toEqual(workspace)
    const archive = { requestId: freshRequest(), projectId: created.projectId }
    yield* api["project.archive"](archive)
    yield* api["project.archive"](archive)
    expect(alive(peer.pid)).toBe(false); expect(alive(childPeer.pid)).toBe(false)
    const after = yield* snapshot
    expect(Object.values(after.requests).every((request) => request.status !== "open")).toBe(true)
    expect(Object.values(after.questions).some((question) => question.status === "open")).toBe(true)
    expect(projectView(after).projects[created.projectId]?.archivedAt).toBeGreaterThan(0)
    expect((yield* api.resume({ requestId: freshRequest(), agentId: row.leadAgentId, fresh: true }).pipe(Effect.result))._tag).toBe("Failure")
    yield* api["project.restore"]({ requestId: freshRequest(), projectId: created.projectId })
    expect(projectView(yield* snapshot).projects[created.projectId]).toMatchObject({ name: "Renamed", goal: "Deliver a reviewed plan", shell: "bash", leadAgentId: row.leadAgentId })
    expect(projectView(yield* snapshot).projects[created.projectId]?.archivedAt).toBeUndefined()
    expect((yield* agentRow(row.leadAgentId))?.state._tag).toBe("stopped")
    expect((yield* readLog).filter(({ event }) => event._tag === "AgentStarted")).toHaveLength(2)
    expect((yield* api["project.creations"]({ requestId: freshRequest() })).items).toEqual([])
    expect(JSON.stringify(yield* readLog)).not.toContain("synthetic-project-credential-1234")
  }))
})

it.live("issue 576: creates an empty main commit and recorded main destination before the project worktree", () => {
  const harness = harnessFor("cursor", writeFakeAdapter(rig))
  const echo = echoFile(rig), account = accountFor(harness.id, { turns: [] }, echo, { CURSOR_API_KEY: "secret:project-test" }, "ready")
  const unready = accountFor(harness.id, { turns: [] }, echoFile(rig), {}, "a-unready")
  return withEngine(rig, { harness, accounts: [unready, account], secrets: { "secret:project-test": "synthetic-project-credential-1234" } }, () => Effect.gen(function* () {
    yield* registerRebuildCheck()
    const { call, success, ownerCredential } = yield* Effect.promise(() => import("../support/handlerRig.ts"))
    success(yield* call(ownerCredential, "project.settings.set", { settings: { workspaceFolder: rig.work, shell: "sh" } }))
    const result = success(yield* call(ownerCredential, "project.create", { name: "Fresh", goal: "Plan a new product", machineId: "local", repository: { _tag: "new", name: "New Product" } }))
    const view = projectView(yield* snapshot), row = view.projects[result.projectId]!, workspace = view.workspaces[row.worktreeId]!
    expect(workspace.path).toBe(join(rig.work, "new-product/.worktrees/fresh"))
    expect(git(workspace.path, "branch", "--show-current")).toBe("fresh")
    const repository = view.repositories[row.repoId]!
    const main = Object.values(view.workspaces).find((item) => item.repoId === row.repoId && item.checkout === "main")!
    expect(main).toMatchObject({ path: repository.path, branch: "main", machineId: "local" })
    expect(main.worktreeId).not.toBe(workspace.worktreeId)
    const initial = git(repository.path, "rev-parse", "HEAD")
    expect(git(workspace.path, "rev-parse", "HEAD")).toBe(initial)
    expect(git(repository.path, "ls-tree", "-r", initial)).toBe("")
    writeFileSync(join(workspace.path, "product.txt"), "Lead-authored product\n")
    git(workspace.path, "add", "product.txt")
    git(workspace.path, "-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "-m", "First product work")
    expect(git(repository.path, "rev-parse", "HEAD")).toBe(initial)
    const prepared = success(yield* call(ownerCredential, "project.review.prepare", { projectId: row.projectId, worktreeId: row.worktreeId, destinationId: main.worktreeId })).result.review
    const decided = success(yield* call(ownerCredential, "project.review.approve", { projectId: row.projectId, worktreeId: row.worktreeId, reviewId: prepared.reviewId, expectedHead: prepared.head, expectedBaseHead: prepared.baseHead, confirmed: true, decision: "approve_without_evidence" })).result
    expect(decided.outcome).toBe("merged")
    expect(readFileSync(join(repository.path, "product.txt"), "utf8")).toBe("Lead-authored product\n")
    expect(yield* agentRow(row.leadAgentId)).toMatchObject({ harness: harness.id, account: account.id })
    success(yield* call(ownerCredential, "project.archive", { projectId: row.projectId }))
  }))
})


it.live("stops the actual process when session recording fails after a committed project launch", () => {
  const harness = harnessFor("cursor", writeFakeAdapter(rig))
  const echo = echoFile(rig), account = accountFor(harness.id, { turns: [] }, echo, { CURSOR_API_KEY: "secret:project-test" })
  let armed = true
  return withEngine(rig, { harness, accounts: [account], secrets: { "secret:project-test": "synthetic-project-credential-1234" },
    wrapLog: (real) => ({ ...real, transact: (use) => real.transact((append) => use((actor, id, hash, events, rows, receipt) => {
      if (armed && events.some((event) => event._tag === "SessionOpened")) {
        armed = false; return Effect.fail(new LogWriteFailed({ reason: "injected session recording failure" }))
      }
      return append(actor, id, hash, events, rows, receipt)
    })) }) }, () => Effect.gen(function* () {
    yield* registerRebuildCheck()
    success(yield* call(ownerCredential, "project.settings.set", { settings: { workspaceFolder: rig.work, shell: "sh" } }))
    const request = { requestId: freshRequest(), name: "Fresh", goal: "Plan", machineId: "local", repository: { _tag: "new", name: "Fresh repo" }, useWorktree: true }
    expect(failureOf(yield* call(ownerCredential, "project.create", request))?._tag).toBe("LogWriteFailed")
    const peer = yield* readEcho(echo)
    expect(alive(peer.pid)).toBe(false)
    const view = projectView(yield* snapshot)
    expect(Object.values(view.projects)).toHaveLength(1)
    expect(Object.values(view.creations)).toHaveLength(0)
    expect((yield* readLog).filter(({ event }) => event._tag === "AgentStarted")).toHaveLength(1)
    expect((yield* readLog).filter(({ event }) => event._tag === "SessionOpened")).toHaveLength(0)
    // A real writer fault latches all writes, including receipt replay. It
    // requires service recovery; a retry cannot spawn another process here.
    expect(failureOf(yield* call(ownerCredential, "project.create", request))?._tag).toBe("LogWriteFailed")
    expect(alive(peer.pid)).toBe(false)
  }))
})

it.live("keeps one visible lead and closes a real adapter rejected during setup", () => {
  const harness = harnessFor("cursor", writeFakeAdapter(rig))
  const echo = echoFile(rig), account = accountFor(harness.id, { sessionError: "Unexpected PRIVATE_SETUP_OUTPUT" }, echo, { CURSOR_API_KEY: "secret:project-test" })
  return withEngine(rig, { harness, accounts: [account], secrets: { "secret:project-test": "synthetic-project-credential-1234" } }, () => Effect.gen(function* () {
    yield* registerRebuildCheck()
    success(yield* call(ownerCredential, "project.settings.set", { settings: { workspaceFolder: rig.work, shell: "sh" } }))
    const request = { requestId: freshRequest(), name: "Fresh", goal: "Plan", machineId: "local", repository: { _tag: "new", name: "Fresh repo" }, useWorktree: true }
    const result = success(yield* call(ownerCredential, "project.create", request))
    const row = projectView(yield* snapshot).projects[result.projectId]!
    const peer = yield* readEcho(echo)
    expect(alive(peer.pid)).toBe(false)
    expect((yield* agentRow(row.leadAgentId))?.state._tag).toBe("stopped")
    expect(success(yield* call(ownerCredential, "project.create", request))).toEqual(result)
    expect((yield* readLog).filter(({ event }) => event._tag === "AgentStarted")).toHaveLength(1)
    expect((yield* readLog).filter(({ event }) => event._tag === "AgentStartFailed").map(({ event }) => event)).toEqual([{ _tag: "AgentStartFailed", agentId: row.leadAgentId, reason: "could-not-start" }])
  }))
})


it.live("issue 685: creates both default channels atomically and lets the owner post", () => {
  const harness = harnessFor("cursor", writeFakeAdapter(rig))
  const account = accountFor(harness.id, { turns: [] }, echoFile(rig), { CURSOR_API_KEY: "secret:project-test" })
  return withEngine(rig, { harness, accounts: [account], secrets: { "secret:project-test": "synthetic-project-credential-1234" } }, () => Effect.gen(function* () {
    yield* registerRebuildCheck()
    success(yield* call(ownerCredential, "project.settings.set", { settings: { workspaceFolder: rig.work, shell: "sh" } }))
    const payload = { requestId: freshRequest(), name: "Board", goal: "Plan", machineId: "local", repository: { _tag: "new", name: "Board repo" } }
    const created = success(yield* call(ownerCredential, "project.create", payload))
    const events = yield* readLog
    const creation = events.find((row) => row.event._tag === "project.Created")!
    const channels = events.filter((row) => row.event._tag === "board.ChannelOpened" && row.requestId === creation.requestId)
    expect(channels.map((row) => row.event._tag === "board.ChannelOpened" && row.event.name)).toEqual(["General", "Leads"])
    for (const row of channels) {
      if (row.event._tag !== "board.ChannelOpened") continue
      expect(row.event.members).toEqual([{ _tag: "owner" }, { _tag: "agent", agentId: projectView(yield* snapshot).projects[created.projectId]!.leadAgentId }])
      success(yield* call(ownerCredential, "board.post", { channelId: row.event.channelId, text: "Owner post", to: [], reply: "none" }))
    }
    expect(success(yield* call(ownerCredential, "project.create", payload))).toEqual(created)
    expect((yield* readLog).filter((row) => row.event._tag === "board.ChannelOpened")).toHaveLength(2)
  }))
})
