// Explicit, consequential authenticated read. This is outside test discovery.
// There is one project.diff call, no browser, no retry, and no custom Git limits.
import { createHash, randomBytes } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import * as SqliteClient from "../../../../third_party/t3code/node-sqlite/src/nodeSqliteClient.ts"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import { connectWith } from "../../../client/src/core.ts"
import { makeNodeSocket } from "../../../client/src/nodeSocket.ts"
import { buildServices } from "../../../engine/src/service.ts"
import { serve } from "../../../engine/src/client/web/server.ts"
import { makeRedactor } from "../../../engine/src/identity/redactor.ts"
import { engineLists } from "../../../engine/src/pieces/lists.ts"
import { Views } from "../../../engine/src/views/Views.ts"
import { projectView } from "../../../engine/src/project/view.ts"
import { unusedPort } from "../../../engine/test/support/browserWeb.ts"
import { makeFakeRunner } from "../../../engine/test/support/fakeRunner.ts"
import { call, freshRequest, harnessSettings, makeFakeSecrets, makeRig, ownerCredential, removeRig, seedAccount, success } from "../../../engine/test/support/handlerRig.ts"
import { registerRebuildCheck } from "../../../engine/test/support/rebuildCheck.ts"
import { parseDiff } from "../../src/git/diff.ts"
import { observeGit } from "../git-observation.ts"
import { aggregateInput, inputSha256, prepareAggregateInput } from "./git-aggregate-input.ts"

const output = ".scratch/w09-evidence/isolated-direct-aggregate-01"
mkdirSync(output, { recursive: true })
const observation = observeGit(undefined, join(output, "git-observations.json"))
const lists = observation.registeredReads(engineLists)
const summary: Record<string, unknown> = { version: 1, expectedInputSha256: inputSha256, requestCount: 0, attempts: 1,
  browserUsed: false, customGitLimits: false, deadlineMs: 120_000, deadlineFired: false, pendingAtFiveSeconds: false, passed: false }
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex")
const git = (folder: string, ...args: string[]) => execFileSync("/usr/bin/git", ["-C", folder, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
let stage = "fixture-setup"
async function main() {
  const rig = makeRig(), previous = process.env.LGCODE_HOME
  process.env.LGCODE_HOME = rig.stateFolder
  observation.boundary("fixture-start")
  try {
    git(rig.work, "init", "-b", "main"); git(rig.work, "config", "user.name", "Browser Git fixture"); git(rig.work, "config", "user.email", "browser@example.invalid"); git(rig.work, "config", "commit.gpgsign", "false")
    writeFileSync(join(rig.work, "file.txt"), "base\n"); git(rig.work, "add", "--all"); git(rig.work, "commit", "-m", "Initial")
    const password = randomBytes(32).toString("base64url"), port = await unusedPort(), origin = `http://127.0.0.1:${port}`
    const staticRoot = join(rig.root, "page"); mkdirSync(staticRoot)
    const program = Effect.gen(function* () {
      const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
      const run = Effect.gen(function* () {
        yield* registerRebuildCheck(); yield* seedAccount("launch", "cursor")
        success(yield* call(ownerCredential, "harnesses", { operation: "set", harness: harnessSettings("cursor", { adapterPath: process.execPath, reportedModes: [{ id: "default", level: "ask" }] }) }))
        success(yield* call(ownerCredential, "accounts set-secret", { accountId: "launch", name: "CURSOR_API_KEY", nonce: "browser-git", value: Redacted.make("synthetic-browser-git-key") }))
        success(yield* call(ownerCredential, "project.settings.set", { settings: { workspaceFolder: rig.root, shell: "zsh" } }))
        const added = success(yield* call(ownerCredential, "project.repository.add", { name: "Real browser repository", path: rig.work, machineId: "local" }))
        success(yield* call(ownerCredential, "project.workspace.register", { repoId: added.repoId, path: rig.work, branch: "main", machineId: "local", checkout: "main" }))
        const created = success(yield* call(ownerCredential, "project.create", { name: "Browser work", goal: "Prove the owned Git component", machineId: "local", repository: { _tag: "existing", repoId: added.repoId }, useWorktree: true }))
        const view = projectView(yield* (yield* Views).snapshot), project = view.projects[created.projectId]!, source = view.workspaces[project.worktreeId]!
        prepareAggregateInput({ source })
        const before = aggregateInput(source.path), head = git(source.path, "rev-parse", "HEAD"), status = git(source.path, "status", "--porcelain=v1", "-z", "--untracked-files=all")
        const untracked = git(source.path, "ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean).sort()
        const inputValid = before.sha256 === inputSha256 && JSON.stringify(untracked) === JSON.stringify(before.files.map((file) => file.path))
          && readFileSync(join(source.path, "file.txt"), "utf8") === "base\n"
        summary.inputBefore = before; summary.inputValid = inputValid; summary.headBefore = head; summary.statusBeforeSha256 = sha(status)
        if (!inputValid) return yield* Effect.fail("fixed input mismatch")
        observation.boundary("fixture-prepared")
        yield* serve({ password: Redacted.make(password), staticRoot, lists, settings: { enabled: true, port, heartbeatSeconds: 25, proxyMode: false } })
        stage = "authenticate"
        const cookie = yield* Effect.tryPromise(async () => {
          const response = await fetch(`${origin}/api/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ password }) })
          summary.loginStatus = response.status
          const value = response.headers.getSetCookie()[0]?.split(";")[0]
          if (response.status !== 204 || value === undefined) throw new Error("authentication failed")
          return value
        })
        stage = "connect"
        const client = yield* connectWith({ attempts: 1, makeSocket: () => makeNodeSocket(`ws://127.0.0.1:${port}/api`,
          { headers: { Cookie: cookie, Origin: origin }, openTimeout: 5_000 }).pipe(Effect.provide(NodeSocket.layerWebSocketConstructorWS)) })
        const request = { requestId: freshRequest(), worktreeId: source.worktreeId }
        summary.payloadSha256 = sha(JSON.stringify(request)); summary.requestCount = 1; summary.requestUnixMs = Date.now()
        observation.boundary("direct-call-start")
        stage = "aggregate-read"
        // This timer only records pending state. It neither aborts nor retries.
        const timer = setTimeout(() => { summary.pendingAtFiveSeconds = true; summary.pendingObservationUnixMs = Date.now() }, 5_000)
        const started = performance.now()
        const result = yield* observation.client("project.diff", request, client["project.diff"](request)).pipe(
          Effect.result, Effect.ensuring(Effect.sync(() => clearTimeout(timer))))
        summary.callDurationMs = performance.now() - started; summary.settledUnixMs = Date.now(); summary.delivered = result._tag === "Success"
        observation.boundary("direct-call-settled", result._tag)
        stage = "readback"
        if (result._tag === "Success" && "result" in result.success) {
          const diff = result.success.result, parsed = parseDiff(diff)
          summary.reply = { patchBytes: Buffer.byteLength(diff.patch), patchSha256: sha(diff.patch), truncated: diff.truncated,
            binary: diff.binary, additions: diff.additions, deletions: diff.deletions, parsedComplete: parsed.complete,
            parsedFiles: parsed.complete ? parsed.files.length : undefined }
          summary.passed = parsed.complete && parsed.files.length === 71 && !diff.truncated && !diff.binary
        }
        const after = aggregateInput(source.path)
        summary.inputAfter = after; summary.headAfter = git(source.path, "rev-parse", "HEAD")
        summary.statusAfterSha256 = sha(git(source.path, "status", "--porcelain=v1", "-z", "--untracked-files=all"))
        summary.inputsUnchanged = after.sha256 === before.sha256 && summary.headAfter === head && summary.statusAfterSha256 === summary.statusBeforeSha256
          && readFileSync(join(source.path, "file.txt"), "utf8") === "base\n"
        summary.passed = summary.passed === true && summary.inputsUnchanged === true
      })
      const redactor = makeRedactor({ secrets: () => [Redacted.make("synthetic-browser-git-key")], tokenHashes: () => new Set() })
      const dependencies = Layer.mergeAll(runner.layer, secrets.layer, redactor.layer)
      yield* Effect.scoped(run.pipe(Effect.onExit((exit) => Effect.sync(() => observation.boundary("fixture-scope-closing", exit._tag)))))
        .pipe(Effect.onExit((exit) => Effect.sync(() => observation.boundary("fixture-scope-closed", exit._tag))),
          Effect.provide(buildServices(rig, lists).pipe(Layer.provide(dependencies))), Effect.provide(runner.layer))
    }).pipe(Effect.provide(SqliteClient.layer({ filename: rig.database, readerWorker: true })), Effect.scoped)
    const exit = await Effect.runPromiseExit(program.pipe(Effect.timeout(120_000)) as Effect.Effect<void, unknown>)
    summary.programExit = exit._tag
    if (exit._tag === "Failure") { summary.interrupted = Cause.hasInterrupts(exit.cause); summary.defect = Cause.hasDies(exit.cause); summary.passed = false
      const error = Cause.findError(exit.cause)
      summary.deadlineFired = error._tag === "Success" && typeof error.success === "object" && error.success !== null && "_tag" in error.success && error.success._tag === "TimeoutError" }
  } catch { summary.passed = false; summary.setupOrCleanupFailure = true }
  finally {
    summary.finalStage = stage
    observation.boundary("rig-cleanup-start")
    try { if (previous === undefined) delete process.env.LGCODE_HOME; else process.env.LGCODE_HOME = previous; removeRig(rig) }
    catch { summary.passed = false; summary.setupOrCleanupFailure = true }
    finally {
      observation.boundary("rig-cleanup-end"); observation.finish()
      try { writeFileSync(join(output, "result.json"), JSON.stringify(summary, null, 2) + "\n") }
      catch { summary.passed = false; process.stderr.write("W09 direct probe artifact could not be written.\n") }
    }
  }
  process.stdout.write(summary.passed === true ? "W09 direct authenticated aggregate read completed and preserved inputs.\n" : "W09 direct authenticated aggregate probe failed; collect the bounded observations.\n")
  process.exitCode = summary.passed === true ? 0 : 1
}
await main()
