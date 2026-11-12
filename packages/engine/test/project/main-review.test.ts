import { randomBytes } from "node:crypto"
import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { it } from "@effect/vitest"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { makeNodeSocket } from "@lgtm/client/nodeSocket"
import { connectWith, type Client } from "../../../client/src/core.ts"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Redacted from "effect/Redacted"
import * as SqlClient from "effect/sql/SqlClient"
import { afterEach, beforeEach, expect, vi } from "vitest"
import * as Server from "../../src/api/server.ts"
import { CommandHandler } from "../../src/commands/CommandHandler.ts"
import * as GitApi from "../../src/project/gitApi.ts"
import * as GitProcesses from "../../src/project/git/process.ts"
import { reviewPlanners } from "../../src/project/gitReview.ts"
import { makeGitService } from "../../src/project/git/index.ts"
import { makeFakeRunner } from "../support/fakeRunner.ts"
import { projectView } from "../../src/project/view.ts"
import { Views } from "../../src/views/Views.ts"
import { ancestryHeaders, authorization, socketUrl, upgradeStatus } from "../support/socketClient.ts"
import { provideBoard } from "../board/wakeFixtures.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { appendSetup, call, eventOf, freshRequest, harnessSettings, makeRig, ownerCredential as owner, readLog,
  removeRig, seedAccount, seedAgent, success, provideRig, makeFakeSecrets, type Fakes, type Rig } from "../support/handlerRig.ts"

let rig: Rig
const git = (path: string, ...args: string[]) => execFileSync("/usr/bin/git", ["-C", path, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
// Observe only the process boundary. Every operation still executes real Git.
const observeMerges = () => {
  const bin = join(rig.root, "observed-git"), calls = join(rig.root, "observed-merges")
  mkdirSync(bin)
  writeFileSync(join(bin, "git"), `#!${process.execPath}\nimport { appendFileSync } from 'node:fs';\nimport { spawnSync } from 'node:child_process';\nconst args=process.argv.slice(2);\nif(args.includes('merge')) appendFileSync(${JSON.stringify(calls)}, 'merge\\n');\nconst result=spawnSync('/usr/bin/git',args,{stdio:'inherit'});process.exit(result.status??1);\n`, { mode: 0o700 })
  vi.stubEnv("PATH", `${bin}:${process.env.PATH}`)
  return () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0
}
const noGitReceipt = (requestId: string) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  expect(yield* sql`SELECT request_id FROM receipts WHERE request_id = ${requestId}`).toHaveLength(0)
  expect(Object.values(projectView(yield* snapshot).gitAttempts).some((attempt) => attempt.requestId === requestId)).toBe(true)
  expect((yield* readLog).filter((row) => row.requestId === requestId && ["CommandRefused", "project.MainReviewDecided", "project.GitFinished"].includes(row.event._tag))).toEqual([])
})
const save = (path: string, name: string, text: string) => writeFileSync(join(path, name), text)
const commit = (path: string, title: string) => { git(path, "add", "--all"); git(path, "commit", "-m", title); return git(path, "rev-parse", "HEAD") }
const snapshot = Effect.gen(function* () { return yield* (yield* Views).snapshot })
const client = (socket: string, token: string) => connectWith({ attempts: 1, makeSocket: () => makeNodeSocket(socketUrl(socket), {
  headers: { ...authorization(token), ...ancestryHeaders() }
}).pipe(Effect.provide(NodeSocket.layerWebSocketConstructorWS)) })
const run = (api: Client, name: string, payload: Record<string, unknown> = {}) =>
  (api as unknown as Record<string, (p: any) => Effect.Effect<any, any>>)[name]!({ requestId: freshRequest(), ...payload })
const refusal = (effect: Effect.Effect<any, any>) => effect.pipe(Effect.result, Effect.map((r) => {
  expect(r._tag).toBe("Failure"); if (r._tag !== "Failure") throw new Error("expected refusal"); return r.failure.reason as string
}))
beforeEach(() => {
  rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder)
  git(rig.work, "init", "-b", "main"); git(rig.work, "config", "user.name", "Review fixture")
  git(rig.work, "config", "user.email", "review@example.invalid"); git(rig.work, "config", "commit.gpgsign", "false")
  save(rig.work, "file.txt", "base\n"); commit(rig.work, "Initial")
})
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig) })
const setup = (base = "main") => Effect.gen(function* () {
  yield* registerRebuildCheck()
  if (base !== "main") git(rig.work, "branch", "-m", base)
  yield* seedAccount("launch", "cursor")
  success(yield* call(owner, "harnesses", { operation: "set", harness: harnessSettings("cursor", { adapterPath: process.execPath, reportedModes: [{ id: "default", level: "ask" }] }) }))
  success(yield* call(owner, "accounts set-secret", { accountId: "launch", name: "CURSOR_API_KEY", nonce: "review-fixture", value: Redacted.make("synthetic-review-fixture-key") }))
  const socket = join(rig.stateFolder, "review.sock"), token = randomBytes(32).toString("base64url")
  yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(token), debug: false })
  expect((yield* Effect.promise(() => upgradeStatus(socket, ancestryHeaders()))).status).toBe(401)
  const api = yield* client(socket, token)
  yield* run(api, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "zsh" } })
  const { repoId } = yield* run(api, "project.repository.add", { name: "Product", path: rig.work, machineId: "local" })
  const { worktreeId: destinationId } = yield* run(api, "project.workspace.register", { repoId, path: rig.work, branch: base, checkout: "main", machineId: "local" })
  // The real lifecycle command creates and records the project/worktree. Only
  // its external harness is fake; Git, SQL, redactor, handler and wire are real.
  const { projectId } = yield* run(api, "project.create", { name: "Product work", goal: "Review actual changes", machineId: "local", repository: { _tag: "existing", repoId }, useWorktree: true })
  const view = projectView(yield* snapshot), project = view.projects[projectId]!, workspace = view.workspaces[project.worktreeId]!
  save(workspace.path, "feature.txt", "actual feature\n"); const head = commit(workspace.path, "Feature /tool <script>literal</script>")
  const member = yield* seedAgent({ id: "reviewer", parent: project.leadAgentId, folder: workspace.path })
  // A durable item from the fake harness supplies a genuine thread location.
  const [thread] = yield* appendSetup([eventOf({ _tag: "ThreadItem", agentId: member.agentId, itemId: "report-item", content: { _tag: "text", text: "Actual reported review, not engine-run tests" }, replay: false })])
  return { api, socket, repoId, projectId, worktreeId: workspace.worktreeId, destinationId, source: workspace.path,
    base, head, member, threadSequence: thread!.sequence, baseHead: git(rig.work, "rev-parse", "HEAD") }
})
const prepare = (f: Effect.Success<ReturnType<typeof setup>>) => run(f.api, "project.review.prepare", { projectId: f.projectId, worktreeId: f.worktreeId, destinationId: f.destinationId })
const approve = (f: Effect.Success<ReturnType<typeof setup>>, review: any, extra: Record<string, unknown> = {}) => run(f.api, "project.review.approve", {
  projectId: f.projectId, worktreeId: f.worktreeId, reviewId: review.reviewId, expectedHead: review.head, expectedBaseHead: review.baseHead,
  confirmed: true, decision: "approve_without_evidence", ...extra,
})
const report = (f: Effect.Success<ReturnType<typeof setup>>, api = f.api, extra: Record<string, unknown> = {}) => run(api, "project.review.report", {
  projectId: f.projectId, worktreeId: f.worktreeId, head: git(f.source, "rev-parse", "HEAD"), kind: "review", status: "failed",
  summary: "Reported failure /tool <script>literal</script>", threadAgentId: f.member.agentId, threadSequence: f.threadSequence, ...extra,
})

for (const base of ["main", "master"]) it.live(`owner explicitly reviews and merges ${base} with missing or failed evidence; identical retry merges once`, () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(base)
  if (base === "master") yield* report(f)
  const { result: opened } = yield* prepare(f), review = opened.review
  expect(opened.comparison).toMatchObject({ head: f.head, baseHead: f.baseHead, base, files: { items: [{ path: "feature.txt" }], truncated: false } })
  expect(opened.comparison.diff.patch).toContain("+actual feature")
  expect(opened.comparison.commits.items[0].title).toContain("<script>literal</script>")
  expect(review.evidence.review).toMatchObject(base === "main" ? { state: "missing", report: null } : { state: "current", report: { status: "failed", provenance: "reported", threadAgentId: f.member.agentId, threadSequence: f.threadSequence } })
  expect(git(rig.work, "rev-parse", "HEAD")).toBe(f.baseHead)
  expect(existsSync(join(rig.work, "feature.txt"))).toBe(false)
  expect(yield* refusal(approve(f, review, { confirmed: false }))).toBe("Git: confirmation_required")
  const requestId = freshRequest(), payload = { requestId, projectId: f.projectId, worktreeId: f.worktreeId,
    reviewId: review.reviewId, expectedHead: f.head, expectedBaseHead: f.baseHead, confirmed: true, decision: "approve_without_evidence" }
  const merged = yield* run(f.api, "project.review.approve", payload)
  expect(merged.result).toMatchObject({ outcome: "merged", head: f.head, baseHead: f.baseHead, mergeHead: f.head, decision: "approve_without_evidence" })
  expect(git(rig.work, "rev-parse", "HEAD")).toBe(f.head)
  expect(readFileSync(join(rig.work, "feature.txt"), "utf8")).toBe("actual feature\n")
  expect(yield* run(f.api, "project.review.approve", payload)).toEqual(merged)
  expect(yield* refusal(run(f.api, "project.review.approve", { ...payload, decision: "approve" }))).toBe("request id reused")
  expect((yield* readLog).filter(({ event }) => event._tag === "project.MainReviewDecided")).toHaveLength(1)
  expect(yield* refusal(approve(f, review))).toBe("main review is unavailable; prepare a new review")
  expect((yield* run(f.api, "project.review.status", f)).result.review).toMatchObject({ outcome: "merged", head: f.head, baseHead: f.baseHead })
})).pipe(Effect.orDie))

it.live("reports actual head-bound provenance, rejects foreign or missing threads, and marks old reports stale", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(), member = yield* client(f.socket, f.member.token)
  yield* report(f, member, { status: "passed", summary: "Reported reviewer success" })
  yield* report(f, f.api, { kind: "tests", status: "passed", summary: "Reported tests succeeded" })
  const before = (yield* prepare(f)).result
  expect(before.review.evidence.tests.report).toMatchObject({ reportedBy: { _tag: "owner" }, provenance: "reported", status: "passed" })
  expect(before.review.evidence.review.report).toMatchObject({ reportedBy: { _tag: "agent", agentId: f.member.agentId }, status: "passed" })
  expect((yield* run(member, "project.review.status", f)).data).toContain("Reported reviewer success")
  expect(yield* refusal(report(f, member, { threadSequence: 999999 }))).toBe("review report requires an existing project thread item")
  const stranger = yield* seedAgent({ id: "stranger" })
  expect(yield* refusal(report(f, member, { threadAgentId: stranger.agentId }))).toBe("review report requires the caller's project thread")
  expect(yield* refusal(report(f, f.api, { threadAgentId: stranger.agentId }))).toBe("review report requires an existing project thread item")
  expect(yield* refusal(run(yield* client(f.socket, stranger.token), "project.review.status", f))).toBe("project is unavailable to this caller")
  save(f.source, "later", "new head\n"); commit(f.source, "After evidence")
  const after = (yield* prepare(f)).result.review
  expect(after.evidence.tests.state).toBe("stale"); expect(after.evidence.review.state).toBe("stale")
  expect(yield* refusal(report(f, member, { head: f.head }))).toBe("Git: stale_state")
  expect(yield* refusal(approve(f, before.review))).toBe("main review is unavailable; prepare a new review")
  expect((yield* approve(f, after, { decision: "approve" })).result).toMatchObject({ outcome: "merged", decision: "approve" })
})).pipe(Effect.orDie))

for (const side of ["source", "destination"] as const) it.live(`refuses changed reviewed ${side} head and requires a new owner review`, () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(), { review } = (yield* prepare(f)).result
  const folder = side === "source" ? f.source : rig.work
  save(folder, "later", "later\n"); const later = commit(folder, "Head changed")
  const result = (yield* approve(f, review)).result
  expect(result).toMatchObject({ outcome: "refused", reason: "stale_state", head: f.head, baseHead: f.baseHead, mergeHead: null })
  expect(git(rig.work, "rev-parse", "HEAD")).toBe(side === "source" ? f.baseHead : later)
  expect(yield* refusal(approve(f, review))).toBe("main review is unavailable; prepare a new review")
  const fresh = (yield* prepare(f)).result.review
  expect(fresh.head).toBe(git(f.source, "rev-parse", "HEAD")); expect(fresh.baseHead).toBe(git(rig.work, "rev-parse", "HEAD"))
  expect((yield* approve(f, fresh)).result.outcome).toBe("merged")
})).pipe(Effect.orDie))

for (const side of ["source", "destination"] as const) it.live(`preserves a dirty ${side} and persists an honest refused approval outcome`, () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(), { review } = (yield* prepare(f)).result
  const folder = side === "source" ? f.source : rig.work
  save(folder, "dirty", "keep these exact bytes\n")
  const requestId = freshRequest()
  const attempt = yield* approve(f, review, { requestId })
  expect(attempt.result).toMatchObject({ outcome: "refused", reason: `dirty_${side}`, mergeHead: null })
  expect(readFileSync(join(folder, "dirty"), "utf8")).toBe("keep these exact bytes\n")
  expect(git(rig.work, "rev-parse", "HEAD")).toBe(f.baseHead)
  rmSync(join(folder, "dirty"))
  expect(yield* approve(f, review, { requestId })).toEqual(attempt)
  expect((yield* approve(f, (yield* prepare(f)).result.review)).result.outcome).toBe("merged")
})).pipe(Effect.orDie))

it.live("denies agents, service/caller-less execution, missing approval and unrelated registered destinations", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(), member = yield* client(f.socket, f.member.token), { review } = (yield* prepare(f)).result
  expect(yield* refusal(run(member, "project.review.prepare", f))).toBe("command refused")
  const payload = { projectId: f.projectId, worktreeId: f.worktreeId, reviewId: review.reviewId, expectedHead: f.head, expectedBaseHead: f.baseHead, confirmed: true, decision: "approve_without_evidence", actor: { _tag: "owner" } }
  expect(yield* refusal(run(member, "project.review.approve", payload))).toBe("command refused")
  expect(yield* refusal(run(f.api, "project.integrate", { worktreeId: f.worktreeId, destinationId: f.destinationId, expectedHead: f.head }))).toBe("integration requires a registered team source and its project workspace")
  const service = makeGitService({ workspaceFolder: rig.root })
  const reviewed = (yield* service.reviewMain(f.source, rig.work))
  for (const caller of [undefined, { _tag: "agent", agentId: f.member.agentId } as const, { _tag: "piece", namespace: "project" } as const]) {
    expect(yield* refusal(service.approveMain(f.source, rig.work, reviewed, caller, true))).toBe("owner_required")
  }
  expect(yield* refusal(service.mergeTeam(f.source, rig.work, f.head))).toBe("base_requires_review")
  const handler = yield* CommandHandler
  // The typed client rejects a missing field before transport. Exercise the
  // same malformed input at the actual production command admission boundary.
  expect(yield* refusal(handler.execute(owner, "project.review.approve", { requestId: freshRequest(), ...payload, confirmed: undefined }))).toBe("command refused")
  expect(yield* refusal(handler.execute({ _tag: "service", service: "test.board" }, "project.review.approve", { requestId: freshRequest(), ...payload }))).toBe("command refused")
  const pieceInput = yield* handler.input({ _tag: "piece", namespace: "project" })
  expect(yield* refusal(reviewPlanners["project.review.approve"](pieceInput, { requestId: freshRequest(), ...payload }))).toBe("Git: owner_required")
  const other = join(rig.root, "other"); mkdirSync(other); git(other, "init", "-b", "main")
  git(other, "config", "user.name", "Other"); git(other, "config", "user.email", "other@example.invalid"); git(other, "config", "commit.gpgsign", "false")
  save(other, "own", "other\n"); commit(other, "Other initial")
  const { repoId } = yield* run(f.api, "project.repository.add", { name: "Other", machineId: "local", path: other })
  const { worktreeId: otherId } = yield* run(f.api, "project.workspace.register", { repoId, machineId: "local", path: other, branch: "main", checkout: "main" })
  expect(yield* refusal(prepare({ ...f, destinationId: otherId }))).toBe("main review requires the registered project and its repository base")
  expect(yield* refusal(prepare({ ...f, worktreeId: f.destinationId }))).toBe("project is unavailable to this caller")
  const invalidId = freshRequest(), invalid = { ...f, projectId: "different-project" }
  expect(yield* refusal(approve(invalid, review, { requestId: invalidId }))).toBe("main review is unavailable; prepare a new review")
  expect(yield* refusal(approve(invalid, review, { requestId: invalidId }))).toBe("main review is unavailable; prepare a new review")
  const sql = yield* SqlClient.SqlClient
  expect(yield* sql`SELECT request_id FROM receipts WHERE request_id = ${invalidId}`).toHaveLength(1)
  expect((yield* readLog).filter((row) => row.requestId === invalidId).map((row) => row.event)).toEqual([
    { _tag: "CommandRefused", command: "project.review.approve", reason: "main review is unavailable; prepare a new review" }
  ])
  expect(Object.values(projectView(yield* snapshot).gitAttempts)).toEqual([])
  expect(git(rig.work, "rev-parse", "HEAD")).toBe(f.baseHead)
})).pipe(Effect.orDie))

it.live("issue 590: records a proven conflicting owner merge as refused, replays it and permits a fresh review after resolution", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup()
  save(f.source, "file.txt", "theirs\n"); commit(f.source, "Project edit")
  save(rig.work, "file.txt", "ours\n"); commit(rig.work, "Base edit")
  const { review } = (yield* prepare(f)).result
  const mergeCalls = observeMerges(), requestId = freshRequest()
  const rejected = yield* approve(f, review, { requestId })
  expect(rejected.result).toMatchObject({ outcome: "refused", reason: "conflicts" })
  expect(git(rig.work, "rev-parse", "MERGE_HEAD")).toBe(review.head)
  const unresolved = readFileSync(join(rig.work, "file.txt"), "utf8")
  expect(unresolved).toContain("<<<<<<<"); expect(unresolved).toContain("ours\n"); expect(unresolved).toContain("theirs\n")
  expect(projectView(yield* snapshot).gitReviews[f.worktreeId]).toMatchObject({ outcome: "refused", reason: "conflicts" })
  expect(Object.values(projectView(yield* snapshot).gitAttempts)).toHaveLength(0)
  expect(yield* approve(f, review, { requestId })).toEqual(rejected)
  expect(mergeCalls()).toBe(1)
  expect(readFileSync(join(rig.work, "file.txt"), "utf8")).toBe(unresolved)
  expect(Object.values(projectView(yield* snapshot).gitAttempts)).toHaveLength(0)
  // The ordinary service admission still refuses a new merge before effects.
  const service = makeGitService({ workspaceFolder: rig.root })
  expect(yield* refusal(service.approveMain(f.source, rig.work, review, { _tag: "owner" }, true))).toBe("dirty_destination")
  expect(mergeCalls()).toBe(1)
  const p = { worktreeId: f.destinationId, path: "file.txt" }
  const conflict = (yield* run(f.api, "project.conflict", p)).result
  expect(conflict).toMatchObject({ ours: "ours\n", base: "base\n", theirs: "theirs\n" })
  const chosen = (yield* run(f.api, "project.conflict.choose", { worktreeId: f.destinationId, selection: conflict, hunk: 0, choice: "both" })).result
  yield* run(f.api, "project.conflict.resolve", { worktreeId: f.destinationId, selection: chosen })
  expect(readFileSync(join(rig.work, "file.txt"), "utf8")).toBe("ours\ntheirs\n")
  yield* run(f.api, "project.stage.all", { worktreeId: f.destinationId })
  yield* run(f.api, "project.commit", { worktreeId: f.destinationId, message: "Resolve the reviewed merge" })
  const actual = git(rig.work, "rev-parse", "HEAD")
  expect(git(rig.work, "merge-base", "--is-ancestor", review.head, actual)).toBe("")
  expect(git(rig.work, "merge-base", "--is-ancestor", review.baseHead, actual)).toBe("")
  expect((yield* run(f.api, "project.git.state", { worktreeId: f.destinationId })).result.mergeHead).toBe(null)
  expect(yield* approve(f, review, { requestId })).toEqual(rejected)
  const freshReview = (yield* prepare(f)).result.review
  const reconciled = yield* approve(f, freshReview)
  expect(reconciled.result).toMatchObject({ outcome: "merged", mergeHead: actual })
  expect(yield* approve(f, review, { requestId })).toEqual(rejected)
  expect(mergeCalls()).toBe(1)
  expect((yield* readLog).filter((row) => row.requestId === requestId && row.event._tag === "project.MainReviewDecided")).toHaveLength(1)
})).pipe(Effect.orDie))

it.live("refuses partial or binary review data instead of issuing an all-files approval ticket", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup()
  save(f.source, "large", "line\n".repeat(35000)); commit(f.source, "Large patch")
  expect(yield* refusal(prepare(f))).toBe("Git: unsupported_review")
  expect((yield* run(f.api, "project.review.status", f)).result.review).toBe(null)
  git(f.source, "reset", "--hard", f.head)
  save(f.source, "binary", "\0binary"); commit(f.source, "Binary change")
  expect(yield* refusal(prepare(f))).toBe("Git: unsupported_review")
  git(f.source, "reset", "--hard", f.head)
  for (let i = 0; i < 201; i++) save(f.source, `file-${i}`, "bounded file list\n")
  commit(f.source, "Too many files for complete review")
  expect(yield* refusal(prepare(f))).toBe("Git: unsupported_review")
  expect((yield* run(f.api, "project.review.status", f)).result.review).toBe(null)
  git(f.source, "reset", "--hard", f.head)
  expect((yield* prepare(f)).result.review.outcome).toBe("open")
})).pipe(Effect.orDie))

it.live("redacts reports, comparison prose and durable outcomes through the production redactor while preserving protocol enums", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup()
  save(f.source, "secret.txt", "git-review-secret\n"); commit(f.source, "Literal git-review-secret /tool")
  yield* report(f, f.api, { summary: "failed current reported git-review-secret", status: "failed" })
  const opened = yield* prepare(f)
  expect(JSON.stringify(opened)).not.toContain("git-review-secret")
  expect(opened.result.comparison.diff.patch).toContain("[REDACTED]")
  expect(opened.result.review.evidence.review).toMatchObject({ state: "current", report: { status: "failed", provenance: "reported", summary: "[REDACTED] [REDACTED] [REDACTED] [REDACTED]" } })
  const merged = yield* approve(f, opened.result.review)
  expect(merged.result.outcome).toBe("merged")
  const sql = yield* SqlClient.SqlClient
  const events = yield* sql<{ payload_json: string }>`SELECT payload_json FROM events`
  const receipts = yield* sql<{ result_json: string }>`SELECT result_json FROM receipts`
  expect(JSON.stringify(events)).not.toContain("git-review-secret"); expect(JSON.stringify(receipts)).not.toContain("git-review-secret")
  expect(readFileSync(join(rig.work, "secret.txt"), "utf8")).toBe("git-review-secret\n")
}), ["git-review-secret", "failed", "current", "reported"]).pipe(Effect.orDie))

for (const base of ["main", "master"]) for (const [options, divergent] of [
  ["--squash", false],
  ["--no-ff --no-commit", true],
  ["--squash --no-commit --ff-only -s ours", true],
] as const) it.live(`owner merge into ${base} ignores merge defaults ${options} and records actual ancestry`, () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(base)
  if (divergent) { save(rig.work, "base-only.txt", "independent base work\n"); commit(rig.work, "Base work") }
  git(rig.work, "config", `branch.${base}.mergeOptions`, options)
  git(rig.work, "config", "merge.ff", "only")
  git(rig.work, "config", "merge.twohead", "ours")
  git(rig.work, "config", "merge.autoStash", "true")
  const { review } = (yield* prepare(f)).result
  const member = yield* client(f.socket, f.member.token)
  expect(yield* refusal(run(member, "project.review.approve", { ...f, reviewId: review.reviewId,
    expectedHead: review.head, expectedBaseHead: review.baseHead, confirmed: true,
    decision: "approve_without_evidence", actor: { _tag: "owner" } }))).toBe("command refused")
  const requestId = freshRequest(), merged = yield* approve(f, review, { requestId })
  const actual = git(rig.work, "rev-parse", `refs/heads/${base}`)
  expect(merged.result).toMatchObject({ outcome: "merged", mergeHead: actual, head: f.head, baseHead: review.baseHead })
  expect(git(rig.work, "merge-base", "--is-ancestor", f.head, actual)).toBe("")
  expect(git(rig.work, "status", "--porcelain=v1")).toBe("")
  expect(existsSync(join(rig.work, ".git", "MERGE_HEAD"))).toBe(false)
  expect(readFileSync(join(rig.work, "feature.txt"), "utf8")).toBe("actual feature\n")
  if (divergent) {
    expect(git(rig.work, "rev-list", "--parents", "-n", "1", actual).split(" ").slice(1)).toEqual([review.baseHead, f.head])
    expect(readFileSync(join(rig.work, "base-only.txt"), "utf8")).toBe("independent base work\n")
  } else expect(actual).toBe(f.head)
  expect(yield* approve(f, review, { requestId })).toEqual(merged)
  expect(git(rig.work, "rev-parse", "HEAD")).toBe(actual)
  expect((yield* readLog).filter(({ event }) => event._tag === "project.MainReviewDecided")).toHaveLength(1)
  // Only this invocation overrides defaults; the user's settings are preserved.
  expect(git(rig.work, "config", `branch.${base}.mergeOptions`)).toBe(options)
})).pipe(Effect.orDie))

for (const base of ["main", "master"]) it.live(`already-contained reviewed commit in ${base} is a verified no-op`, () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(base)
  git(rig.work, "merge", "--ff-only", f.head)
  save(rig.work, "later-base.txt", "later base work\n"); const contained = commit(rig.work, "After integration")
  const { review } = (yield* prepare(f)).result
  expect(review.head).toBe(f.head); expect(review.baseHead).toBe(contained)
  const requestId = freshRequest(), result = yield* approve(f, review, { requestId })
  expect(result.result).toMatchObject({ outcome: "merged", mergeHead: contained })
  expect(git(rig.work, "rev-parse", "HEAD")).toBe(contained)
  expect(git(rig.work, "merge-base", "--is-ancestor", f.head, contained)).toBe("")
  expect(git(rig.work, "status", "--porcelain=v1")).toBe("")
  expect(readFileSync(join(rig.work, "feature.txt"), "utf8")).toBe("actual feature\n")
  expect(readFileSync(join(rig.work, "later-base.txt"), "utf8")).toBe("later base work\n")
  expect(yield* approve(f, review, { requestId })).toEqual(result)
  expect((yield* readLog).filter(({ event }) => event._tag === "project.MainReviewDecided")).toHaveLength(1)
})).pipe(Effect.orDie))

for (const mode of ["noop", "squash", "changed-head"]) it.live(`zero-exit ${mode} without reviewed ancestry retains uncertainty and actual state`, () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(), { review } = (yield* prepare(f)).result
  const bin = join(rig.root, "merge-probe-bin"), calls = join(rig.root, "merge-calls")
  mkdirSync(bin)
  // Inject the process boundary only for merge. Other commands, including
  // postcondition reads, use actual Git. Squash leaves genuine staged bytes;
  // the changed-head case creates a real commit without the reviewed source.
  writeFileSync(join(bin, "git"), `#!${process.execPath}\nimport { appendFileSync } from 'node:fs';\nimport { spawnSync } from 'node:child_process';\nconst args=process.argv.slice(2);\nif(args.includes('merge')) {\n appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args)+'\\n');\n const mode=${JSON.stringify(mode)};\n if(mode==='noop') process.exit(0);\n const changed=mode==='squash' ? ['merge','--squash',args.at(-1)] : ['commit','--allow-empty','-m','Unrelated destination change'];\n const r=spawnSync('/usr/bin/git',['-c','core.hooksPath=/dev/null',...changed],{stdio:'inherit'}); process.exit(r.status ?? 1);\n}\nconst r=spawnSync('/usr/bin/git',args,{stdio:'inherit'}); process.exit(r.status ?? 1);\n`, { mode: 0o700 })
  vi.stubEnv("PATH", `${bin}:${process.env.PATH}`)
  const requestId = freshRequest(), result = yield* refusal(approve(f, review, { requestId }))
  const actual = git(rig.work, "rev-parse", "HEAD"), status = git(rig.work, "status", "--porcelain=v1")
  expect(result).toBe("Git outcome is uncertain; refresh Git state")
  expect(git(rig.work, "rev-list", actual).split("\n")).not.toContain(f.head)
  expect(actual === f.baseHead).toBe(mode !== "changed-head")
  if (mode === "squash") {
    expect(status).toBe("A  feature.txt")
    expect(readFileSync(join(rig.work, "feature.txt"), "utf8")).toBe("actual feature\n")
  } else { expect(status).toBe(""); expect(existsSync(join(rig.work, "feature.txt"))).toBe(false) }
  expect(yield* refusal(approve(f, review, { requestId }))).toBe(result)
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1)
  expect(git(rig.work, "rev-parse", "HEAD")).toBe(actual)
  expect(git(rig.work, "status", "--porcelain=v1")).toBe(status)
  const decided = (yield* readLog).filter(({ event }) => event._tag === "project.MainReviewDecided")
  expect(decided).toHaveLength(0)
  expect(Object.values(projectView(yield* snapshot).gitAttempts)).toHaveLength(1)
  yield* noGitReceipt(requestId)
  const sql = yield* SqlClient.SqlClient
  const receipts = yield* sql<{ result_json: string }>`SELECT result_json FROM receipts WHERE request_id = ${requestId}`
  expect(receipts).toHaveLength(0)
  const wrongBody = yield* refusal(approve(f, review, { requestId, confirmed: false }))
  expect(wrongBody).toBe("request id reused")
  expect(yield* refusal(run(f.api, "project.preferences.set", { requestId, projectId: f.projectId, shell: "bash" }))).toBe("request id reused")
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1)
  // A real state refresh clears the bulky attempt but reserves its identity as
  // terminal uncertainty. It neither decides the open review nor runs Git again.
  const openReview = projectView(yield* snapshot).gitReviews[f.worktreeId]
  yield* run(f.api, "project.git.state", { worktreeId: f.worktreeId })
  expect(Object.values(projectView(yield* snapshot).gitAttempts)).toHaveLength(0)
  expect(projectView(yield* snapshot).gitReviews[f.worktreeId]).toEqual(openReview)
  expect(yield* refusal(approve(f, review, { requestId }))).toBe(result)
  expect(yield* refusal(approve(f, review, { requestId, confirmed: false }))).toBe("request id reused")
  expect(yield* refusal(run(f.api, "project.preferences.set", { requestId, projectId: f.projectId, shell: "bash" }))).toBe("request id reused")
  const finished = (yield* readLog).filter((row) => row.requestId === requestId).map((row) => row.event)
  expect(finished.filter((event) => event._tag === "project.GitFinished")).toMatchObject([{ outcome: "uncertain" }])
  expect(finished.filter((event) => event._tag === "CommandRefused")).toEqual([])
  expect(yield* sql`SELECT result_json FROM receipts WHERE caller = 'owner' AND request_id = ${requestId}`).toHaveLength(1)
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1)
})).pipe(Effect.orDie))

for (const withEvidence of [false, true]) it.live(`review status and owner approval complete while overlapped, recorded evidence=${withEvidence}`, () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup()
  if (withEvidence) yield* report(f)
  const statusPayload = { projectId: f.projectId, worktreeId: f.worktreeId }
  const expectedEvidence = withEvidence ? "current" : "missing"
  expect((yield* run(f.api, "project.review.status", statusPayload)).result.evidence.review.state).toBe(expectedEvidence)
  const { review } = (yield* prepare(f)).result
  const sql = yield* SqlClient.SqlClient
  const bin = join(rig.root, "overlap-bin"), hold = join(rig.root, "hold-git")
  const entered = join(rig.root, "git-entered"), writer = join(rig.root, "writer-entered")
  mkdirSync(bin); writeFileSync(hold, "hold")
  // The real child blocks inside status's Git gate. All commands still run
  // actual Git; the wrapper only establishes the otherwise racy ordering.
  writeFileSync(join(bin, "git"), `#!${process.execPath}\nimport { existsSync, writeFileSync } from 'node:fs';\nimport { spawnSync } from 'node:child_process';\nconst args = process.argv.slice(2);\nif (args.includes('rev-parse') && existsSync(${JSON.stringify(hold)})) {\n writeFileSync(${JSON.stringify(entered)}, JSON.stringify({ pid: process.pid, args }));\n while (existsSync(${JSON.stringify(hold)})) await new Promise(resolve => setTimeout(resolve, 10));\n}\nconst result = spawnSync('/usr/bin/git', args, { stdio: 'inherit' });\nprocess.exit(result.status ?? 1);\n`, { mode: 0o700 })
  vi.stubEnv("PATH", `${bin}:${process.env.PATH}`)
  let armed = false, statusDone = false, approvalDone = false
  let statusReply: any, approvalReply: any
  const transaction = sql.withTransaction.bind(sql)
  // SqlClient runs the body only after acquiring the actual connection and
  // executing BEGIN. This observes ownership; it does not supply a fake lock.
  const observer = vi.spyOn(sql, "withTransaction").mockImplementation((effect) => transaction(Effect.gen(function* () {
    if (armed) {
      const active = yield* Effect.serviceOption(sql.transactionService)
      expect(active._tag).toBe("Some")
      writeFileSync(writer, "SQL connection owned after BEGIN")
    }
    return yield* effect
  })))
  const waitFor = (ready: () => boolean) => Effect.gen(function* () {
    for (let attempt = 0; attempt < 1000 && !ready(); attempt++) yield* Effect.sleep(10)
    expect(ready()).toBe(true)
  })
  try {
    yield* run(f.api, "project.review.status", statusPayload).pipe(
      Effect.tap((reply) => Effect.sync(() => { statusReply = reply; statusDone = true })), Effect.forkChild)
    yield* waitFor(() => existsSync(entered))
    expect(statusDone).toBe(false)
    const child = JSON.parse(readFileSync(entered, "utf8"))
    expect(child.args).toContain("rev-parse"); expect(child.pid).toBeGreaterThan(0)
    armed = true
    const requestId = freshRequest()
    yield* approve(f, review, { requestId }).pipe(
      Effect.tap((reply) => Effect.sync(() => { approvalReply = reply; approvalDone = true })), Effect.forkChild)
    yield* waitFor(() => existsSync(writer))
    expect(readFileSync(writer, "utf8")).toBe("SQL connection owned after BEGIN")
    expect(approvalDone).toBe(false); expect(statusDone).toBe(false)
    rmSync(hold)
    yield* waitFor(() => statusDone && approvalDone)
    expect(statusReply.result.evidence.review.state).toBe(expectedEvidence)
    if (withEvidence) expect(statusReply.result.evidence.review.report).toMatchObject({
      head: f.head, provenance: "reported", status: "failed", threadAgentId: f.member.agentId, threadSequence: f.threadSequence,
    })
    const actual = git(rig.work, "rev-parse", "HEAD")
    expect(approvalReply.result).toMatchObject({ outcome: "merged", head: f.head, baseHead: f.baseHead, mergeHead: actual })
    expect(git(rig.work, "merge-base", "--is-ancestor", review.head, actual)).toBe("")
    expect(readFileSync(join(rig.work, "feature.txt"), "utf8")).toBe("actual feature\n")
    expect(git(rig.work, "status", "--porcelain=v1")).toBe("")
    expect(yield* approve(f, review, { requestId })).toEqual(approvalReply)
    const events = (yield* readLog).filter(({ event }) => event._tag === "project.MainReviewDecided")
    expect(events).toHaveLength(1)
    expect(events[0]!.event).toMatchObject({ review: approvalReply.result })
    const receipts = yield* sql<{ result_json: string }>`SELECT result_json FROM receipts WHERE request_id = ${requestId}`
    expect(receipts).toHaveLength(1)
    expect(JSON.parse(receipts[0]!.result_json).reply).toEqual(approvalReply)
    expect((yield* run(f.api, "project.review.status", statusPayload)).result.review).toEqual(approvalReply.result)
    // setup's finalizer also rebuilds the live projections from durable events.
  } finally {
    rmSync(hold, { force: true })
    observer.mockRestore()
  }
})).pipe(Effect.orDie))


it.live("issue 575: an unrecorded real merge reconciles the reviewed ancestry before rejecting the changed base", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* setup(), { review } = (yield* prepare(f)).result
  // This is the exact durable state a crash after Git and before append leaves:
  // a real merge, an open persisted review, and no approval receipt.
  git(rig.work, "merge", "--no-edit", review.head)
  const requestId = freshRequest()
  const merged = yield* approve(f, review, { requestId })
  expect(merged.result).toMatchObject({ outcome: "merged", head: review.head, baseHead: review.baseHead, mergeHead: git(rig.work, "rev-parse", "HEAD") })
  expect(yield* approve(f, review, { requestId })).toEqual(merged)
  const sql = yield* SqlClient.SqlClient
  expect(yield* sql`SELECT request_id FROM receipts WHERE request_id = ${requestId}`).toHaveLength(1)
})).pipe(Effect.orDie))

it.live("issue 579: an independent real writer completes while an approval Git subprocess is pending", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* setup(), { review } = (yield* prepare(f)).result
  const bin = join(rig.root, "controlled-bin"), hold = join(rig.root, "hold"), started = join(rig.root, "started")
  mkdirSync(bin); writeFileSync(hold, "hold")
  // Only scheduling is controlled. All subprocess replies come from real Git.
  writeFileSync(join(bin, "git"), `#!${process.execPath}\nimport { existsSync, writeFileSync } from 'node:fs';\nimport { spawnSync } from 'node:child_process';\nconst args=process.argv.slice(2);\nif(args.includes('merge')) { writeFileSync(${JSON.stringify(started)},'started'); while(existsSync(${JSON.stringify(hold)})) await new Promise(r=>setTimeout(r,10)); }\nconst result=spawnSync('/usr/bin/git',args,{stdio:'inherit'}); process.exit(result.status ?? 1);\n`, { mode: 0o700 })
  vi.stubEnv("PATH", `${bin}:${process.env.PATH}`)
  const merge = yield* approve(f, review).pipe(Effect.forkChild)
  yield* Effect.addFinalizer(() => Effect.sync(() => { rmSync(hold, { force: true }) }))
  const startedBy = Date.now() + 5000
  while (!existsSync(started) && Date.now() < startedBy) yield* Effect.sleep("10 millis")
  expect(existsSync(started)).toBe(true)
  let completed = false
  let writerAttempted = false
  const writer = yield* Effect.sync(() => { writerAttempted = true }).pipe(Effect.andThen(run(f.api, "project.preferences.set", { projectId: f.projectId, shell: "bash" }))).pipe(Effect.tap(() => Effect.sync(() => { completed = true })), Effect.forkChild)
  const writerBy = Date.now() + 5000
  while (!completed && Date.now() < writerBy) yield* Effect.sleep("10 millis")
  expect(writerAttempted).toBe(true)
  const completedWhilePending = completed && existsSync(hold)
  rmSync(hold)
  yield* Fiber.join(merge); yield* Fiber.join(writer)
  expect(completedWhilePending).toBe(true)
})).pipe(Effect.orDie))

it.live("issue 579/583: queued registration and creation do not block a positive independent writer while real Git is held", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup(), { review } = (yield* prepare(f)).result
  git(rig.outside, "init", "-b", "main")
  const bin = join(rig.root, "registration-git"), hold = join(rig.root, "registration-hold"), started = join(rig.root, "registration-started")
  mkdirSync(bin); writeFileSync(hold, "owned hold")
  writeFileSync(join(bin, "git"), `#!${process.execPath}\nimport { existsSync, writeFileSync } from 'node:fs';\nimport { spawnSync } from 'node:child_process';\nconst args=process.argv.slice(2);\nif(args.includes('merge')) { writeFileSync(${JSON.stringify(started)},'started'); while(existsSync(${JSON.stringify(hold)})) await new Promise(r=>setTimeout(r,10)); }\nconst result=spawnSync('/usr/bin/git',args,{stdio:'inherit'}); process.exit(result.status ?? 1);\n`, { mode: 0o700 })
  vi.stubEnv("PATH", `${bin}:${process.env.PATH}`)
  const merge = yield* approve(f, review).pipe(Effect.forkChild)
  yield* Effect.addFinalizer(() => Effect.sync(() => { rmSync(hold, { force: true }); vi.restoreAllMocks() }))
  const startedBy = Date.now() + 5000
  while (!existsSync(started) && Date.now() < startedBy) yield* Effect.sleep("10 millis")
  expect(existsSync(started)).toBe(true)
  let gateAttempts = 0
  const realWithGit = GitApi.withGit
  const observed: typeof GitApi.withGit = (input, body) => Effect.sync(() => { gateAttempts++ }).pipe(Effect.andThen(realWithGit(input, body)))
  vi.spyOn(GitApi, "withGit").mockImplementation(observed)
  const registerRequest = { requestId: freshRequest(), name: "Queued repository", path: rig.outside, machineId: "local" }
  const createRequest = { requestId: freshRequest(), name: "Queued project", goal: "Observe without holding the writer", machineId: "local", repository: { _tag: "existing", repoId: f.repoId }, useWorktree: true }
  const registration = yield* call(owner, "project.repository.add", registerRequest).pipe(Effect.forkChild)
  const creation = yield* call(owner, "project.create", createRequest).pipe(Effect.forkChild)
  const queuedBy = Date.now() + 5000
  while (gateAttempts < 2 && Date.now() < queuedBy) yield* Effect.sleep("10 millis")
  expect(gateAttempts).toBeGreaterThanOrEqual(2)
  // Positive completion is observed after both physical paths reach the gate.
  // A delay or a merely forked request is not the scheduling oracle.
  let completed = false
  const writer = yield* run(f.api, "project.preferences.set", { projectId: f.projectId, shell: "bash" }).pipe(
    Effect.tap(() => Effect.sync(() => { completed = true })), Effect.forkChild)
  const writerBy = Date.now() + 5000
  while (!completed && Date.now() < writerBy) yield* Effect.sleep("10 millis")
  const completedWhileHeld = completed && existsSync(hold)
  expect(projectView(yield* snapshot).projects[f.projectId]?.shell).toBe("bash")
  rmSync(hold)
  yield* Fiber.join(merge); yield* Fiber.join(writer)
  const registered = success(yield* Fiber.join(registration)), created = success(yield* Fiber.join(creation))
  expect(completedWhileHeld).toBe(true)
  expect(success(yield* call(owner, "project.repository.add", registerRequest))).toEqual(registered)
  expect(success(yield* call(owner, "project.create", createRequest))).toEqual(created)
})).pipe(Effect.orDie))


for (const divergent of [false, true]) it.live(`issue 575: actual SQL failure after ${divergent ? "divergent" : "fast-forward"} Git merge retains the restart latch and terminal uncertainty after rebuild`, () => Effect.gen(function* () {
  const observedProcesses = vi.spyOn(GitProcesses, "gitProcess")
  yield* Effect.addFinalizer(() => Effect.sync(() => observedProcesses.mockRestore()))
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  let armed = true
  let breakWriter: Effect.Effect<void> = Effect.die(new Error("uninitialized SQL fault"))
  const wrapLog: NonNullable<Fakes["wrapLog"]> = (real) => ({ ...real, transact: (use) => real.transact((append) => use((actor, id, hash, events, side, receipt) => {
    if (armed && events.some((event) => event._tag === "project.MainReviewDecided")) {
      armed = false
      return breakWriter.pipe(Effect.andThen(append(actor, id, hash, events, side, receipt)))
    }
    return append(actor, id, hash, events, side, receipt)
  })) })
  const saved = yield* provideRig(rig, { runner, secrets, wrapLog }, Effect.gen(function* () {
    yield* registerRebuildCheck()
    const sql = yield* SqlClient.SqlClient
    breakWriter = sql`PRAGMA query_only = ON`.pipe(Effect.orDie, Effect.asVoid)
    const f = yield* setup()
    if (divergent) { save(rig.work, "base-only.txt", "base work\n"); commit(rig.work, "Base divergence") }
    const { review } = (yield* prepare(f)).result
    const request = { requestId: freshRequest(), projectId: f.projectId, worktreeId: f.worktreeId, reviewId: review.reviewId,
      expectedHead: review.head, expectedBaseHead: review.baseHead, confirmed: true, decision: "approve_without_evidence" }
    const failed = yield* call(owner, "project.review.approve", request)
    expect(failed._tag).toBe("Failure")
    if (failed._tag === "Failure") expect(failed.failure._tag).toBe("LogWriteFailed")
    const actual = git(rig.work, "rev-parse", "HEAD")
    expect(git(rig.work, "merge-base", "--is-ancestor", review.head, actual)).toBe("")
    expect(git(rig.work, "merge-base", "--is-ancestor", review.baseHead, actual)).toBe("")
    expect(projectView(yield* snapshot).gitReviews[f.worktreeId]!.outcome).toBe("open")
    expect(yield* sql`SELECT request_id FROM receipts WHERE request_id = ${request.requestId}`).toHaveLength(0)
    expect((yield* call(owner, "project.review.approve", request))._tag).toBe("Failure")
    expect((yield* readLog).filter((row) => row.event._tag === "project.MainReviewDecided")).toHaveLength(0)
    return { request, actual }
  }))
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    yield* registerRebuildCheck()
    const prior = yield* call(owner, "project.review.approve", saved.request)
    expect(prior._tag).toBe("Failure")
    if (prior._tag === "Failure") expect(prior.failure.reason).toBe("Git outcome is uncertain; refresh Git state")
    expect(projectView(yield* snapshot).gitReviews[saved.request.worktreeId]?.outcome).toBe("open")
    success(yield* call(owner, "project.git.state", { worktreeId: saved.request.worktreeId, projectId: saved.request.projectId }))
    expect(Object.values(projectView(yield* snapshot).gitAttempts)).toHaveLength(0)
    const terminal = yield* call(owner, "project.review.approve", saved.request)
    expect(terminal._tag).toBe("Failure")
    if (terminal._tag === "Failure") expect(terminal.failure.reason).toBe("Git outcome is uncertain; refresh Git state")
    // A new owner request uses the existing containment proof, without another
    // merge or retroactive success on the old uncertain identity.
    const fresh = { ...saved.request, requestId: freshRequest() }
    const result = success(yield* call(owner, "project.review.approve", fresh))
    expect(result.result).toMatchObject({ outcome: "merged", mergeHead: saved.actual })
    expect(success(yield* call(owner, "project.review.approve", fresh))).toEqual(result)
    expect(git(rig.work, "rev-parse", "HEAD")).toBe(saved.actual)
    expect((yield* readLog).filter((row) => row.event._tag === "project.MainReviewDecided")).toHaveLength(1)
  }))
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    yield* registerRebuildCheck()
    const old = yield* call(owner, "project.review.approve", saved.request)
    expect(old._tag).toBe("Failure")
    if (old._tag === "Failure") expect(old.failure.reason).toBe("Git outcome is uncertain; refresh Git state")
    expect(Object.values(projectView(yield* snapshot).gitAttempts)).toHaveLength(0)
  }))
  expect(observedProcesses.mock.calls.filter(([, args]) => args.includes("merge"))).toHaveLength(1)
}).pipe(Effect.orDie))

for (const merging of [false, true]) it.live(`issue 575: commit uncertainty after actual SQL failure preserves merge parent=${merging}`, () => Effect.gen(function* () {
  const observedProcesses = vi.spyOn(GitProcesses, "gitProcess")
  yield* Effect.addFinalizer(() => Effect.sync(() => observedProcesses.mockRestore()))
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  let requestId = "", armed = true
  let breakWriter: Effect.Effect<void> = Effect.die(new Error("The writer fault was not initialized"))
  const wrapLog: NonNullable<Fakes["wrapLog"]> = (real) => ({ ...real, transact: (use) => real.transact((append) => use((actor, id, hash, events, rows, receipt) => {
    if (armed && id === requestId && events.some((event) => event._tag === "project.GitFinished")) {
      armed = false
      return breakWriter.pipe(Effect.andThen(append(actor, id, hash, events, rows, receipt)))
    }
    return append(actor, id, hash, events, rows, receipt)
  })) })
  const saved = yield* provideRig(rig, { runner, secrets, wrapLog }, Effect.gen(function* () {
    yield* registerRebuildCheck()
    const sql = yield* SqlClient.SqlClient
    breakWriter = sql`PRAGMA query_only = ON`.pipe(Effect.orDie, Effect.asVoid)
    const f = yield* setup()
    const before = git(f.source, "rev-parse", "HEAD")
    let mergeHead: string | undefined
    const branch = git(f.source, "branch", "--show-current")
    if (merging) {
      git(f.source, "checkout", "-b", "side")
      save(f.source, "side.txt", "Side parent\n"); mergeHead = commit(f.source, "Side work")
      git(f.source, "checkout", branch)
      save(f.source, "primary.txt", "Primary parent\n"); commit(f.source, "Primary work")
      git(f.source, "merge", "--no-ff", "--no-commit", "side")
    } else {
      save(f.source, "intended.txt", "Frozen index content\n")
      success(yield* call(owner, "project.stage", { projectId: f.projectId, worktreeId: f.worktreeId, path: "intended.txt" }))
    }
    const parent = git(f.source, "rev-parse", "HEAD"), tree = git(f.source, "write-tree")
    requestId = freshRequest()
    const request = { requestId, projectId: f.projectId, worktreeId: f.worktreeId, message: "Intended frozen message" }
    const failed = yield* call(owner, "project.commit", request)
    expect(failed._tag).toBe("Failure")
    if (failed._tag === "Failure") expect(failed.failure._tag).toBe("LogWriteFailed")
    const actual = git(f.source, "rev-parse", "HEAD")
    expect(actual).not.toBe(before)
    expect(git(f.source, "show", "-s", "--format=%P", actual).split(" ")).toEqual(mergeHead === undefined ? [parent] : [parent, mergeHead])
    expect(git(f.source, "show", "-s", "--format=%T", actual)).toBe(tree)
    expect(yield* sql`SELECT request_id FROM receipts WHERE request_id = ${requestId}`).toHaveLength(0)
    expect(Object.values(projectView(yield* snapshot).gitAttempts)).toHaveLength(1)
    expect((yield* call(owner, "project.commit", request))._tag).toBe("Failure")
    return { request, actual, source: f.source }
  }))
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    yield* registerRebuildCheck()
    expect((yield* call(owner, "project.commit", { ...saved.request, message: "Different body" }))._tag).toBe("Failure")
    const prior = yield* call(owner, "project.commit", saved.request)
    expect(prior._tag).toBe("Failure")
    if (prior._tag === "Failure") expect(prior.failure.reason).toBe("Git outcome is uncertain; refresh Git state")
    success(yield* call(owner, "project.git.state", { projectId: saved.request.projectId, worktreeId: saved.request.worktreeId }))
    const terminal = yield* call(owner, "project.commit", saved.request)
    expect(terminal._tag).toBe("Failure")
    if (terminal._tag === "Failure") expect(terminal.failure.reason).toBe("Git outcome is uncertain; refresh Git state")
    expect((yield* call(owner, "project.commit", { ...saved.request, message: "Different body" }))._tag).toBe("Failure")
    expect(git(saved.source, "rev-parse", "HEAD")).toBe(saved.actual)
    expect(Object.values(projectView(yield* snapshot).gitAttempts)).toHaveLength(0)
    const sql = yield* SqlClient.SqlClient
    expect(yield* sql`SELECT request_id FROM receipts WHERE request_id = ${saved.request.requestId}`).toHaveLength(1)
    const events = (yield* readLog).filter((row) => row.requestId === saved.request.requestId).map((row) => row.event)
    expect(events).toMatchObject([{ _tag: "project.GitFinished", outcome: "uncertain" }])
  }))
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    yield* registerRebuildCheck()
    const old = yield* call(owner, "project.commit", saved.request)
    expect(old._tag).toBe("Failure")
    if (old._tag === "Failure") expect(old.failure.reason).toBe("Git outcome is uncertain; refresh Git state")
    expect(Object.values(projectView(yield* snapshot).gitAttempts)).toHaveLength(0)
  }))
  expect(observedProcesses.mock.calls.filter(([, args]) => args.includes("commit"))).toHaveLength(1)
}).pipe(Effect.orDie))

it.live("issue 595: partial main checkout permission failure leaves the review open and its request uncertain", () => provideBoard(rig, Effect.gen(function* () {
  const f = yield* setup()
  mkdirSync(join(rig.work, "dir")); save(rig.work, "dir/existing", "tracked directory\n")
  save(rig.work, "a.txt", "before a\n"); save(rig.work, "z.txt", "before z\n"); commit(rig.work, "Permission base")
  git(f.source, "merge", "--no-edit", "main")
  save(f.source, "a.txt", "after a\n"); save(f.source, "z.txt", "after z\n"); save(f.source, "dir/new", "cannot create\n"); commit(f.source, "Incoming files")
  const { review } = (yield* prepare(f)).result, before = git(rig.work, "rev-parse", "HEAD"), mergeCalls = observeMerges()
  const request = { requestId: freshRequest(), projectId: f.projectId, worktreeId: f.worktreeId, reviewId: review.reviewId,
    expectedHead: review.head, expectedBaseHead: review.baseHead, confirmed: true, decision: "approve_without_evidence" }
  chmodSync(join(rig.work, "dir"), 0o555)
  yield* Effect.addFinalizer(() => Effect.sync(() => chmodSync(join(rig.work, "dir"), 0o755)))
  const failed = yield* call(owner, "project.review.approve", request)
  expect(failed._tag).toBe("Failure")
  if (failed._tag === "Failure") expect(failed.failure).toMatchObject({ reason: "Git outcome is uncertain; refresh Git state" })
  expect(readFileSync(join(rig.work, "a.txt"), "utf8")).toBe("after a\n")
  expect(readFileSync(join(rig.work, "z.txt"), "utf8")).toBe("after z\n")
  expect(git(rig.work, "rev-parse", "HEAD")).toBe(before)
  expect(projectView(yield* snapshot).gitReviews[f.worktreeId]?.outcome).toBe("open")
  const sql = yield* SqlClient.SqlClient
  expect(yield* sql`SELECT request_id FROM receipts WHERE request_id = ${request.requestId}`).toHaveLength(0)
  expect((yield* readLog).filter((row) => row.event._tag === "project.MainReviewDecided")).toHaveLength(0)
  const retry = yield* call(owner, "project.review.approve", request)
  expect(retry._tag).toBe("Failure")
  if (retry._tag === "Failure") expect(retry.failure.reason).toBe("Git outcome is uncertain; refresh Git state")
  expect(mergeCalls()).toBe(1)
  yield* run(f.api, "project.git.state", { projectId: f.projectId, worktreeId: f.worktreeId })
  expect(Object.values(projectView(yield* snapshot).gitAttempts)).toHaveLength(0)
  const afterRefresh = yield* call(owner, "project.review.approve", request)
  expect(afterRefresh._tag).toBe("Failure")
  if (afterRefresh._tag === "Failure") expect(afterRefresh.failure.reason).toBe("Git outcome is uncertain; refresh Git state")
  expect(mergeCalls()).toBe(1)
  expect(projectView(yield* snapshot).gitReviews[f.worktreeId]?.outcome).toBe("open")
})).pipe(Effect.orDie))
