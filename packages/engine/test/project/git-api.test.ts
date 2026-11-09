import { randomBytes } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { makeNodeSocket } from "@lgcode/client/nodeSocket"
import { connectWith, type Client } from "../../../client/src/core.ts"
import { CommandsRpcGroup, Event, ProjectId, projectEventTags } from "@lgcode/contracts"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/sql/SqlClient"
import { afterEach, beforeEach, expect, vi } from "vitest"
import * as Server from "../../src/api/server.ts"
import { EventLog } from "../../src/log/EventLog.ts"
import { Views } from "../../src/views/Views.ts"
import { engineLists } from "../../src/pieces/lists.ts"
import { projectView } from "../../src/project/view.ts"
import { ancestryHeaders, authorization, socketUrl, upgradeStatus } from "../support/socketClient.ts"
import { provideBoard } from "../board/wakeFixtures.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { eventually } from "../support/routingRig.ts"
import { call, success, failureOf, seedAccount, seedHarness, seedAgent, ownerCredential as owner, freshRequest, makeRig, removeRig, type Rig } from "../support/handlerRig.ts"

let rig: Rig
const git = (folder: string, ...args: string[]) => execFileSync("/usr/bin/git", ["-C", folder, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
const save = (folder: string, path: string, content: string) => writeFileSync(join(folder, path), content)
const commit = (folder: string, message: string) => { git(folder, "add", "--all"); git(folder, "commit", "-m", message); return git(folder, "rev-parse", "HEAD") }
beforeEach(() => {
  rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder)
  git(rig.work, "init", "-b", "main")
  git(rig.work, "config", "user.name", "Test Author")
  git(rig.work, "config", "user.email", "test@example.test")
  git(rig.work, "config", "commit.gpgsign", "false")
  save(rig.work, "file.txt", "base\n"); commit(rig.work, "Initial")
})
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig) })
const snapshot = Effect.gen(function* () { return yield* (yield* Views).snapshot })
const actualClient = (socket: string, bearer: string) => connectWith({ attempts: 1, makeSocket: () => makeNodeSocket(socketUrl(socket), {
  headers: { ...authorization(bearer), ...ancestryHeaders() }
}).pipe(Effect.provide(NodeSocket.layerWebSocketConstructorWS)) })
const wire = () => Effect.gen(function* () {
  const bearer = randomBytes(32).toString("base64url"), socket = join(rig.stateFolder, "git.sock")
  yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false })
  expect((yield* Effect.promise(() => upgradeStatus(socket, ancestryHeaders()))).status).toBe(401)
  return { api: yield* actualClient(socket, bearer), socket }
})
// Existing Git authorization and shared-checkout histories are seeded through
// the real durable log. New project launch is proved by the lifecycle suite.
const historicProject = (fields: Record<string, unknown>) => Effect.gen(function* () {
  const log = yield* EventLog
  const requestId = freshRequest()
  const projectId = Schema.decodeUnknownSync(ProjectId)(`project-${requestId}`)
  const event = Schema.decodeUnknownSync(Event)({ _tag: "project.Created", ...fields, projectId })
  yield* log.append({ _tag: "owner" }, requestId, "b".repeat(64), [event], {}, () => ({ requestId, projectId }))
  return { projectId }
})
const setup = () => Effect.gen(function* () {
  yield* registerRebuildCheck(); yield* seedAccount(); yield* seedHarness()
  const lead = yield* seedAgent({ id: "lead", folder: rig.work })
  const worker = yield* seedAgent({ id: "worker", parent: "lead" })
  const stranger = yield* seedAgent({ id: "stranger" })
  success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "zsh" } }))
  const repoId = success(yield* call(owner, "project.repository.add", { name: "Product", path: rig.work, machineId: "local" })).repoId
  const worktreeId = success(yield* call(owner, "project.workspace.register", { repoId, machineId: "local", branch: "main", path: rig.work, checkout: "main" })).worktreeId
  const projectId = (yield* historicProject({ name: "Git", goal: "Real Git", leadAgentId: lead.agentId, repoId, worktreeId, machineId: "local" })).projectId
  return { repoId, worktreeId, projectId, worker, stranger }
})
const resultOf = (reply: any) => { expect(reply.result).toBeDefined(); return reply.result }
const run = (api: Client, name: string, payload: Record<string, unknown> = {}) =>
  (api as unknown as Record<string, (p: any) => Effect.Effect<any, any>>)[name]!({ requestId: freshRequest(), ...payload })
const refusal = (effect: Effect.Effect<any, any>) => effect.pipe(Effect.result, Effect.map((outcome) => {
  expect(outcome._tag).toBe("Failure"); if (outcome._tag === "Failure") return outcome.failure.reason as string
  throw new Error("expected refusal")
}))

it.live("traces every public operation to a real handler and preserves the exact durable event inventory", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const reads = ["project.repository.discover", "project.branches", "project.checkouts", "project.changes", "project.diff", "project.history", "project.commit.files", "project.git.state", "project.discard.plan", "project.review", "project.conflict", "project.review.open", "project.conflict.choose"]
  const writes = ["project.stage", "project.unstage", "project.stage.all", "project.unstage.all", "project.discard", "project.commit", "project.fetch", "project.pull", "project.push", "project.integrate", "project.conflict.resolve"]
  for (const name of reads) { expect(Object.hasOwn(engineLists.reads, name), name).toBe(true); expect(Object.hasOwn(engineLists.planners, name), name).toBe(false) }
  for (const name of writes) { expect(Object.hasOwn(engineLists.planners, name), name).toBe(true); expect(Object.hasOwn(engineLists.reads, name), name).toBe(false) }
  expect([...CommandsRpcGroup.requests.keys()].filter((name) => reads.includes(name) || writes.includes(name)).sort()).toEqual([...reads, ...writes].sort())
  expect(projectEventTags).toEqual(["project.SetupAdvanced", "project.SetupCompleted", "project.MockRecorded", "project.MockApproved", "project.DesignRecorded", "project.SettingsChanged", "project.RepositoryAdded", "project.RepositoryLocated", "project.WorktreeCreated", "project.Created", "project.CreationPlanned", "project.CreationClaimed", "project.CreationFinished", "project.GoalChanged", "project.ArchiveStarted", "project.Archived", "project.Restored", "project.Placed", "project.PreferencesChanged", "project.Renamed", "project.StageChanged", "project.TeamAdded", "project.SprintAdded", "project.SprintChanged", "project.SprintCompleted", "project.TaskAdded", "project.TaskChanged", "project.TaskNoted"])
})).pipe(Effect.orDie))

it.live("uses the real authenticated client to register, enumerate, stage, unstage, commit, read history and rename paths", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(); const { api } = yield* wire()
  expect(resultOf(yield* run(api, "project.repository.discover")).items.map((row: any) => row.path)).toContain(rig.work)
  expect(resultOf(yield* run(api, "project.branches", { repoId: f.repoId })).items[0].name).toBe("main")
  expect(resultOf(yield* run(api, "project.checkouts", { repoId: f.repoId })).items[0].path).toBe(rig.work)
  const other = join(rig.root, "registered-over-wire"); mkdirSync(other); git(other, "init", "-b", "main")
  const registered = yield* run(api, "project.repository.add", { name: "Registered", path: other, machineId: "local" })
  yield* run(api, "project.repository.locate", { repoId: registered.repoId, machineId: "local", path: other })
  const registeredWorkspace = yield* run(api, "project.workspace.register", { repoId: registered.repoId, path: other, machineId: "local", branch: "main", checkout: "main" })
  expect(resultOf(yield* run(api, "project.git.state", { worktreeId: registeredWorkspace.worktreeId })).head).toBe(null)
  const p = { worktreeId: f.worktreeId }
  renameSync(join(rig.work, "file.txt"), join(rig.work, "renamed\tfile.txt")); git(rig.work, "add", "--all")
  save(rig.work, "renamed\tfile.txt", "base\nmore\n")
  expect(resultOf(yield* run(api, "project.changes", p)).items[0]).toMatchObject({ path: "renamed\tfile.txt", originalPath: "file.txt", staged: true, unstaged: true })
  expect(resultOf(yield* run(api, "project.diff", { ...p, path: "renamed\tfile.txt" })).patch).toContain("more")
  yield* run(api, "project.unstage", { ...p, path: "renamed\tfile.txt" })
  yield* run(api, "project.stage", { ...p, path: "renamed\tfile.txt" })
  yield* run(api, "project.stage.all", p); yield* run(api, "project.unstage.all", p)
  expect(resultOf(yield* run(api, "project.changes", p)).items.every((row: any) => !row.staged)).toBe(true)
  yield* run(api, "project.stage.all", p)
  const requestId = freshRequest(), payload = { ...p, requestId, message: "Real commit" }
  const committed = yield* api["project.commit"](payload)
  const head = resultOf(committed).head
  expect(git(rig.work, "rev-parse", "HEAD")).toBe(head)
  expect(yield* api["project.commit"](payload)).toEqual(committed)
  expect(git(rig.work, "rev-list", "--count", "HEAD")).toBe("2")
  const history = resultOf(yield* run(api, "project.history", { ...p, limit: 1 }))
  expect(history).toMatchObject({ truncated: true, items: [{ head, title: "Real commit" }] })
  const files = resultOf(yield* run(api, "project.commit.files", { ...p, commit: head })).items
  expect(files.some((row: any) => row.path === "renamed\tfile.txt")).toBe(true)
  expect(resultOf(yield* run(api, "project.diff", { ...p, path: "renamed\tfile.txt", commit: head })).patch).toContain("more")
  expect(resultOf(yield* run(api, "project.git.state", p)).head).toBe(head)
})).pipe(Effect.orDie))

it.live("requires a current discard confirmation and remains usable after refusal", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(); const { api } = yield* wire(); const p = { worktreeId: f.worktreeId }
  save(rig.work, "file.txt", "staged\n"); yield* run(api, "project.stage.all", p)
  save(rig.work, "file.txt", "unstaged\n"); save(rig.work, "untracked", "discard me\n")
  const plan = resultOf(yield* run(api, "project.discard.plan", p))
  expect(plan.paths).toEqual(["file.txt", "untracked"])
  expect(yield* refusal(run(api, "project.discard", { ...p, plan, confirmed: false }))).toBe("Git: confirmation_required")
  save(rig.work, "file.txt", "newer\n")
  expect(yield* refusal(run(api, "project.discard", { ...p, plan, confirmed: true }))).toBe("Git: stale_state")
  const current = resultOf(yield* run(api, "project.discard.plan", p))
  yield* run(api, "project.discard", { ...p, plan: current, confirmed: true })
  expect(readFileSync(join(rig.work, "file.txt"), "utf8")).toBe("staged\n")
  expect(existsSync(join(rig.work, "untracked"))).toBe(false)
  expect(resultOf(yield* run(api, "project.changes", p)).items[0]).toMatchObject({ staged: true, unstaged: false })
  yield* run(api, "project.commit", { ...p, message: "After failed discard" })
})).pipe(Effect.orDie))

it.live("enforces own-project reads, refuses all agent Git writes and paths outside authoritative identities", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(); const { api, socket } = yield* wire()
  const worker = yield* actualClient(socket, f.worker.token), stranger = yield* actualClient(socket, f.stranger.token)
  save(rig.work, "file.txt", "agent text /tool\n")
  const p = { worktreeId: f.worktreeId, projectId: f.projectId }
  const own = yield* run(worker, "project.diff", p)
  expect(own.data).toContain("Data from another agent ["); expect(own.data).toContain("agent text /tool")
  expect(yield* refusal(run(stranger, "project.changes", p))).toBe("project is unavailable to this caller")
  expect(yield* refusal(run(worker, "project.changes", { worktreeId: f.worktreeId }))).toBe("project is unavailable to this caller")
  for (const name of ["project.stage", "project.unstage", "project.stage.all", "project.unstage.all", "project.discard", "project.commit", "project.fetch", "project.pull", "project.push", "project.integrate", "project.review.open", "project.conflict.choose", "project.conflict.resolve"]) {
    const raw = { ...p, path: "file.txt", message: "Denied", plan: { paths: [], fingerprint: "f" }, confirmed: true, destinationId: f.worktreeId, expectedHead: "abc", base: "main", selection: { path: "file.txt", fingerprint: "f", head: "abc", choices: [] }, hunk: 0, choice: "ours" }
    expect(yield* refusal(run(worker, name, raw)), name).toBe("command refused")
  }
  expect(git(rig.work, "diff", "--cached")).toBe("")
  expect(yield* refusal(run(api, "project.diff", { ...p, path: "../outside/file" }))).toBe("Git: invalid_path")
  symlinkSync(join(rig.outside, "private"), join(rig.work, "link"))
  expect(yield* refusal(run(api, "project.diff", { ...p, path: "link" }))).toBe("Git: invalid_path")
  expect(yield* refusal(run(api, "project.diff", { ...p, path: ".git/config" }))).toBe("Git: invalid_path")
  expect(yield* refusal(run(api, "project.changes", { worktreeId: "../outside", path: rig.outside }))).toBe("registered workspace not found")
  expect(yield* refusal(run(api, "project.repository.add", { name: "Remote", path: rig.work, machineId: "unknown" }))).toContain("only the local machine")
  success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.outside, shell: "zsh" } }))
  expect(yield* refusal(run(api, "project.changes", p))).toBe("Git: invalid_path")
  expect(projectView(yield* snapshot).repositories[f.repoId]?.path).toBe(rig.work)
  success(yield* call(owner, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "zsh" } }))
  expect(resultOf(yield* run(api, "project.changes", p)).items.length).toBeGreaterThan(0)
})).pipe(Effect.orDie))

const integration = (api: Client, repoId: string, shared = false) => Effect.gen(function* () {
  const destination = join(rig.root, "project-workspace"), source = join(rig.root, "team-workspace")
  git(rig.work, "worktree", "add", "-b", "project-branch", destination)
  git(rig.work, "worktree", "add", "-b", "team-branch", source)
  const register = (path: string, branch: string, parentId?: string) => run(api, "project.workspace.register", { repoId, path, branch, machineId: "local", checkout: "worktree", ...(parentId === undefined ? {} : { parentId }) })
  const destinationId = (yield* register(destination, "project-branch")).worktreeId
  const sourceId = (yield* register(source, "team-branch", destinationId)).worktreeId
  if (shared) {
    yield* seedAgent({ id: "earlier-lead", folder: destination })
    yield* historicProject({ name: "Earlier project sharing the checkout", goal: "Preserve existing records", repoId, worktreeId: destinationId, leadAgentId: "earlier-lead", machineId: "local" })
  }
  yield* seedAgent({ id: "integration-lead", folder: destination })
  const projectId = (yield* historicProject({ name: "Integration", goal: "Merge real work", repoId, worktreeId: destinationId, leadAgentId: "integration-lead", machineId: "local" })).projectId
  yield* run(api, "project.team.create", { projectId, name: "Build", worktreeId: sourceId })
  return { source, destination, sourceId, destinationId, projectId }
})
it.live("refuses a dirty destination, merges the actual source into its project, and resolves canonical conflicts", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(); const { api } = yield* wire(); const i = yield* integration(api, f.repoId, true)
  save(i.source, "team.txt", "team change\n"); const sourceHead = commit(i.source, "Team commit")
  save(i.destination, "dirty", "keep this\n")
  const merge = { worktreeId: i.sourceId, destinationId: i.destinationId, expectedHead: sourceHead }
  expect(yield* refusal(run(api, "project.integrate", merge))).toBe("Git: dirty_destination")
  expect(readFileSync(join(i.destination, "dirty"), "utf8")).toBe("keep this\n")
  rmSync(join(i.destination, "dirty")); yield* run(api, "project.integrate", merge)
  expect(git(i.destination, "rev-parse", "HEAD")).toBe(sourceHead)
  expect(readFileSync(join(i.destination, "team.txt"), "utf8")).toBe("team change\n")
  save(i.destination, "file.txt", "ours\n"); commit(i.destination, "Project edit")
  save(i.source, "file.txt", "theirs\n"); const conflictingHead = commit(i.source, "Team edit")
  expect(yield* refusal(run(api, "project.integrate", { ...merge, expectedHead: conflictingHead }))).toBe("Git: conflicts")
  const p = { worktreeId: i.destinationId }
  const conflict = resultOf(yield* run(api, "project.conflict", { ...p, path: "file.txt" }))
  expect(conflict).toMatchObject({ ours: "ours\n", base: "base\n", theirs: "theirs\n", choices: [null] })
  expect(yield* refusal(run(api, "project.conflict.resolve", { ...p, selection: conflict }))).toBe("Git: incomplete_choices")
  const chosen = resultOf(yield* run(api, "project.conflict.choose", { ...p, selection: conflict, hunk: 0, choice: "both" }))
  expect(chosen.choices).toEqual(["both"])
  // Unknown caller-supplied content is stripped by the payload schema. Only
  // current canonical index stages and these choices can determine the write.
  yield* run(api, "project.conflict.resolve", { ...p, selection: { ...chosen, ours: "injected", theirs: "injected", segments: [{ kind: "context", context: ["injected"] }] } })
  expect(readFileSync(join(i.destination, "file.txt"), "utf8")).toBe("ours\ntheirs\n")
  expect(resultOf(yield* run(api, "project.changes", p)).items).toMatchObject([{ path: "file.txt", staged: false, conflict: false, unstaged: true }])
  yield* run(api, "project.stage.all", p); yield* run(api, "project.commit", { ...p, message: "Resolve team integration" })
  expect(resultOf(yield* run(api, "project.git.state", p)).mergeHead).toBe(null)
  expect(resultOf(yield* run(api, "project.review", { ...p, base: "main" })).commits.items.length).toBeGreaterThan(1)
  // Even a registered project on main is never a direct integration target.
  const mainSource = join(rig.root, "main-team"); git(rig.work, "worktree", "add", "-b", "main-team", mainSource)
  const mainSourceId = (yield* run(api, "project.workspace.register", { repoId: f.repoId, machineId: "local", branch: "main-team", path: mainSource, checkout: "worktree", parentId: f.worktreeId })).worktreeId
  yield* run(api, "project.team.create", { projectId: f.projectId, name: "Main source", worktreeId: mainSourceId })
  expect(yield* refusal(run(api, "project.integrate", { worktreeId: mainSourceId, destinationId: f.worktreeId, expectedHead: git(mainSource, "rev-parse", "HEAD") }))).toBe("Git: base_requires_review")
})).pipe(Effect.orDie))

it.live("runs fetch, pull and push against a real local remote, keeping remote failures bounded and recoverable", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(); const { api } = yield* wire(); const p = { worktreeId: f.worktreeId }
  expect(yield* refusal(run(api, "project.fetch", p))).toBe("Git: missing_remote")
  const remote = join(rig.root, "origin.git"); git(rig.root, "init", "--bare", "--initial-branch=main", remote)
  git(rig.work, "remote", "add", "origin", remote)
  yield* run(api, "project.push", p)
  expect(git(remote, "rev-parse", "main")).toBe(git(rig.work, "rev-parse", "HEAD"))
  const clone = join(rig.root, "other-client"); git(rig.root, "clone", remote, clone)
  git(clone, "config", "user.name", "Remote Author"); git(clone, "config", "user.email", "remote@example.test"); git(clone, "config", "commit.gpgsign", "false")
  save(clone, "remote.txt", "remote work\n"); const remoteHead = commit(clone, "Remote commit"); git(clone, "push")
  yield* run(api, "project.fetch", p)
  expect(resultOf(yield* run(api, "project.git.state", p)).behind).toBe(1)
  yield* run(api, "project.pull", p)
  expect(git(rig.work, "rev-parse", "HEAD")).toBe(remoteHead)
  expect(readFileSync(join(rig.work, "remote.txt"), "utf8")).toBe("remote work\n")
  expect(yield* refusal(run(api, "project.review.open", { ...p, base: "main", expectedHead: remoteHead }))).toBe("Git: unsupported_provider")
  git(rig.work, "remote", "set-url", "origin", "https://private-user:private-password@127.0.0.1:1/private.git")
  const reason = yield* refusal(run(api, "project.fetch", p))
  expect(reason).toMatch(/^Git: (network_failed|git_failed)$/)
  expect(reason).not.toMatch(/private-user|private-password|127|fatal|https/)
  expect(Buffer.byteLength(reason)).toBeLessThan(128)
  git(rig.work, "remote", "set-url", "origin", remote)
  yield* run(api, "project.fetch", p)
  yield* run(api, "project.stage.all", p)
})).pipe(Effect.orDie))

it.live("redacts every Git string through the actual redactor and refuses oversized serialized replies", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(); const { api } = yield* wire(); const p = { worktreeId: f.worktreeId }
  git(rig.work, "config", "user.name", "git-secret-value")
  save(rig.work, "git-secret-value.txt", "git-secret-value\n")
  yield* run(api, "project.stage.all", p)
  yield* run(api, "project.commit", { ...p, message: "Message git-secret-value" })
  git(rig.work, "branch", "git-secret-value-branch")
  save(rig.work, "git-secret-value.txt", "git-secret-value new\n")
  for (const [name, payload] of [
    ["project.changes", p], ["project.diff", p], ["project.history", p],
    ["project.commit.files", { ...p, commit: "HEAD" }], ["project.branches", { repoId: f.repoId }], ["project.review", { ...p, base: "main" }]
  ] as const) {
    const reply = yield* run(api, name, payload)
    expect(JSON.stringify(reply), name).not.toContain("git-secret-value")
    if (name !== "project.review") expect(JSON.stringify(reply), name).toContain("[REDACTED]")
    expect(Buffer.byteLength(JSON.stringify(reply))).toBeLessThanOrEqual(256 * 1024)
  }
  save(rig.work, "big", "x".repeat(500_000))
  const patch = resultOf(yield* run(api, "project.diff", { ...p, path: "big" }))
  expect(patch.truncated).toBe(true); expect(Buffer.byteLength(patch.patch)).toBeLessThanOrEqual(128 * 1024)
  // A line full of JSON-escaped controls exceeds the aggregate wire budget
  // even though the subprocess byte budget remains respected.
  save(rig.work, "big", "\u0001".repeat(150_000))
  expect(yield* refusal(run(api, "project.diff", { ...p, path: "big" }))).toBe("Git reply exceeds the read budget; select a smaller file or page")
  expect(resultOf(yield* run(api, "project.history", { ...p, limit: 1 })).items[0].title).toContain("[REDACTED]")
  const sql = yield* SqlClient.SqlClient
  const receipts = yield* sql<{ result_json: string }>`SELECT result_json FROM receipts`
  expect(JSON.stringify(receipts)).not.toContain("git-secret-value")
}), ["git-secret-value"]).pipe(Effect.orDie))

for (const cancel of [false, true]) it.live(`serializes concurrent authenticated calls across settings changes${cancel ? " after client cancellation" : ""} without releasing an in-flight owner`, () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(); const { api } = yield* wire(); const p = { worktreeId: f.worktreeId }
  const bin = join(rig.root, "bin"), hold = join(rig.root, "hold"), started = join(rig.root, "started"), overlap = join(rig.root, "overlap")
  mkdirSync(bin); writeFileSync(hold, "hold")
  // This test-only executable delays an actual Git status. Every Git command
  // still executes the real binary, and no reply is synthesized.
  writeFileSync(join(bin, "git"), `#!${process.execPath}\nimport { existsSync, writeFileSync } from 'node:fs';\nimport { spawnSync } from 'node:child_process';\nconst args=process.argv.slice(2);\nif(existsSync(${JSON.stringify(started)}) && existsSync(${JSON.stringify(hold)})) writeFileSync(${JSON.stringify(overlap)},'overlap');\nif(args.includes('status')) { writeFileSync(${JSON.stringify(started)},'started'); while(existsSync(${JSON.stringify(hold)})) await new Promise(r=>setTimeout(r,10)); }\nconst result=spawnSync('/usr/bin/git',args,{stdio:'inherit'}); process.exit(result.status ?? 1);\n`, { mode: 0o700 })
  vi.stubEnv("PATH", `${bin}:${process.env.PATH}`)
  const first = yield* run(api, "project.changes", p).pipe(Effect.forkChild)
  expect(yield* eventually(Effect.sync(() => existsSync(started)), Boolean)).toBe(true)
  if (cancel) yield* Fiber.interrupt(first)
  yield* run(api, "project.settings.set", { settings: { workspaceFolder: rig.work, shell: "zsh" } })
  const second = yield* run(api, "project.changes", p).pipe(Effect.forkChild)
  yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 100)))
  expect(existsSync(overlap)).toBe(false)
  rmSync(hold)
  if (!cancel) expect(resultOf(yield* Fiber.join(first)).items).toEqual([])
  expect(resultOf(yield* Fiber.join(second)).items).toEqual([])
  expect(existsSync(overlap)).toBe(false)
  // The replacement root is narrower, but it never replaces repository identity.
  expect(projectView(yield* snapshot).repositories[f.repoId]?.path).toBe(rig.work)
})).pipe(Effect.orDie))

it.live("preserves conflict protocol choices when a short secret overlaps their spelling", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(); const { api } = yield* wire(); const i = yield* integration(api, f.repoId)
  save(i.destination, "file.txt", "ours\n"); commit(i.destination, "Project edit")
  save(i.source, "file.txt", "theirs\n"); const head = commit(i.source, "Team edit")
  expect(yield* refusal(run(api, "project.integrate", { worktreeId: i.sourceId, destinationId: i.destinationId, expectedHead: head }))).toBe("Git: conflicts")
  const p = { worktreeId: i.destinationId }
  const conflict = resultOf(yield* run(api, "project.conflict", { ...p, path: "file.txt" }))
  expect(conflict.ours).toBe("[REDACTED]\n")
  expect(conflict.segments[0].kind).toBe("conflict")
  const chosen = resultOf(yield* run(api, "project.conflict.choose", { ...p, selection: conflict, hunk: 0, choice: "ours" }))
  expect(chosen.choices).toEqual(["ours"])
  yield* run(api, "project.conflict.resolve", { ...p, selection: chosen })
  expect(readFileSync(join(i.destination, "file.txt"), "utf8")).toBe("ours\n")
}), ["ours", "conflict"]).pipe(Effect.orDie))
