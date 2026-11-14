import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { afterEach, beforeEach, expect, vi } from "vitest"
import { projectView } from "../../src/project/view.ts"
import { LogWriteFailed } from "../../src/log/EventLog.ts"
import { provideBoard, snapshot } from "../board/wakeFixtures.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { agentCredential, appendSetup, call, eventOf, failureOf, freshRequest, makeFakeSecrets, makeRig, ownerCredential as owner, provideRig, readLog, removeRig, success, type Fakes, type Rig } from "../support/handlerRig.ts"
import { makeFakeRunner } from "../support/fakeRunner.ts"
import { screenBundle, seedScreens } from "./mockScreenFixtures.ts"

let rig: Rig
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder) })
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig) })

it.live("review item 1: reads project feedback in one bounded reply including historical versions and wrapped agent data", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* seedScreens(rig)
  success(yield* call(owner, "project.mocks.comment", { ...f.selection, text: "Historical feedback" }))
  const next = success(yield* call(owner, "project.mocks.record", { projectId: "project", expectedRevision: f.revisionId, bundle: screenBundle() }))
  const body = success(yield* call(owner, "project.mocks.reviews.read", { projectId: "project" }))
  expect(body).toMatchObject({ revisionId: next.revisionId, reviews: expect.arrayContaining([
    expect.objectContaining({ ...f.selection, comments: [expect.objectContaining({ text: "Historical feedback" })] })
  ]) })
  expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(256 * 1024)
  expect(success(yield* call(agentCredential(f.designer.token), "project.mocks.reviews.read", { projectId: "project" })).data).toContain("Historical feedback")
})))

it.live("review item 1: marks displayed versions with one atomic event and refuses an invalid batch without partial marks", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* seedScreens(rig)
  const next = success(yield* call(owner, "project.mocks.record", { projectId: "project", expectedRevision: f.revisionId, bundle: screenBundle() }))
  const versions = [{ revisionId: f.revisionId, screenId: "home" }, { revisionId: next.revisionId, screenId: "home" }]
  expect(failureOf(yield* call(owner, "project.mocks.seen.batch", { projectId: "project", versions: [...versions, { revisionId: next.revisionId, screenId: "absent" }] }))?.reason).toBe("mock screen is unavailable")
  expect(success(yield* call(owner, "project.mocks.screen.read", f.selection)).review.seen).toBeUndefined()
  const requestId = freshRequest(), payload = { projectId: "project", versions, requestId }
  success(yield* call(owner, "project.mocks.seen.batch", payload))
  const rows = yield* readLog
  expect(rows.filter((row) => row.requestId === requestId).map((row) => row.event)).toMatchObject([
    { _tag: "project.MockScreensSeen", projectId: "project", versions, author: { _tag: "owner" } }
  ])
  for (const version of versions) expect(success(yield* call(owner, "project.mocks.screen.read", { projectId: "project", ...version })).review.seen).toMatchObject({ author: { _tag: "owner" }, at: expect.any(Number) })
  success(yield* call(owner, "project.mocks.seen.batch", payload))
  expect(yield* readLog).toEqual(rows)
})))

it.live("review item 1: refuses an oversized historical bulk reply instead of returning partial feedback", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* seedScreens(rig)
  let revisionId = f.revisionId
  for (let version = 0; version < 3; version++) {
    yield* appendSetup(Array.from({ length: 32 }, () => eventOf({
      _tag: "project.MockScreenCommented", projectId: "project", revisionId, screenId: "home",
      commentId: freshRequest(), author: { _tag: "owner" }, text: "x".repeat(4096)
    })))
    revisionId = success(yield* call(owner, "project.mocks.record", { projectId: "project", expectedRevision: revisionId, bundle: screenBundle() })).revisionId
  }
  for (const caller of [owner, agentCredential(f.designer.token)])
    expect(failureOf(yield* call(caller, "project.mocks.reviews.read", { projectId: "project" }))?.reason).toBe("mock screen feedback exceeds the read budget")
})))

it.live("review item 2: the comment limit never suggests discarding feedback by recording a revision", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* seedScreens(rig)
  for (let n = 0; n < 32; n++) success(yield* call(owner, "project.mocks.comment", { ...f.selection, text: "Feedback " + n }))
  expect(failureOf(yield* call(owner, "project.mocks.comment", { ...f.selection, text: "One more" }))?.reason).toBe("mock screen comment limit reached")
})))

for (const target of ["designer", "project-lead", null]) it.live(`review item 3: atomically stores feedback and notifies ${target ?? "nobody when both roles are unavailable"}`, () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* seedScreens(rig)
  if (target !== "designer") yield* appendSetup([eventOf({ _tag: "AgentStopped", agentId: f.designer.agentId })])
  if (target === null) yield* appendSetup([eventOf({ _tag: "AgentStopped", agentId: f.lead.agentId })])
  const requestId = freshRequest(), payload = { ...f.selection, requestId, text: "Please adjust <script>plain data</script> $(touch escaped)" }
  const reply = success(yield* call(owner, "project.mocks.comment", payload))
  expect(reply.notified).toBe(target !== null)
  const rows = (yield* readLog).filter((row) => row.requestId === requestId)
  expect(rows.some((row) => row.event._tag === "project.MockScreenCommented")).toBe(true)
  const posts = rows.map((row) => row.event).filter((event) => event._tag === "board.PostWritten")
  expect(posts).toHaveLength(target === null ? 0 : 1)
  if (target !== null) expect(posts[0]).toMatchObject({ text: expect.stringContaining(payload.text), to: [{ _tag: "agent", agentId: target }] })
  else expect(reply.notificationReason).toBe("No available designer or project lead was notified.")
  const before = yield* readLog
  success(yield* call(owner, "project.mocks.comment", payload))
  expect(yield* readLog).toEqual(before)
})))

it.live("review item 3: a failed comment append leaves neither a comment nor a board notice", () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner()
  const wrapLog: NonNullable<Fakes["wrapLog"]> = (real) => ({ ...real, transact: (use) => real.transact((append) => use((actor, id, hash, events, rows, receipt) =>
    events.some((event) => event._tag === "project.MockScreenCommented")
      ? Effect.fail(new LogWriteFailed({ reason: "injected atomic comment failure" })) : append(actor, id, hash, events, rows, receipt))) })
  yield* provideRig(rig, { runner, secrets: makeFakeSecrets(), wrapLog }, Effect.gen(function* () {
    yield* registerRebuildCheck()
    const f = yield* seedScreens(rig), requestId = freshRequest()
    expect(failureOf(yield* call(owner, "project.mocks.comment", { ...f.selection, requestId, text: "Atomic feedback" }))?._tag).toBe("LogWriteFailed")
    expect((yield* readLog).filter((row) => row.requestId === requestId)).toEqual([])
    expect(success(yield* call(owner, "project.mocks.screen.read", f.selection)).review.comments).toEqual([])
  }))
}))

it.live("review item 10: a member of a second real project is refused every Mocks read and write", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* seedScreens(rig), other = join(rig.root, "other-product")
  mkdirSync(other)
  execFileSync("git", ["-C", other, "init", "-b", "main"], { stdio: "ignore" })
  const repoId = success(yield* call(owner, "project.repository.add", { name: "Other product", path: other, machineId: "local" })).repoId
  yield* appendSetup([
    eventOf({ _tag: "project.WorktreeCreated", worktreeId: "other-workspace", repoId, machineId: "local", branch: "main", path: other, checkout: "main" }),
    eventOf({ _tag: "project.Created", projectId: "other-project", name: "Other project", goal: "Separate feedback", repoId, worktreeId: "other-workspace", leadAgentId: f.stranger.agentId, machineId: "local" })
  ])
  expect(projectView(yield* snapshot).agentProjects[f.stranger.agentId]).toBe("other-project")
  const caller = agentCredential(f.stranger.token)
  for (const name of ["project.mocks.read", "project.mocks.screen.read", "project.mocks.reviews.read", "project.mocks.artifact"])
    expect(failureOf(yield* call(caller, name, { ...f.selection, sourceId: "page" }))?.reason).toBe("project is unavailable to this caller")
  for (const [name, extra] of [
    ["project.mocks.comment", { text: "Foreign feedback" }], ["project.mocks.screen.approve", { approved: true }],
    ["project.mocks.seen", {}], ["project.mocks.seen.batch", { versions: [{ revisionId: f.revisionId, screenId: "home" }] }],
    ["project.mocks.editor.save", { designRevision: "design", worktreeId: "workspace", content: "ZXhwb3J0", confirmed: true }]
  ] as const) expect(failureOf(yield* call(caller, name, { ...f.selection, ...extra }))?.reason).toBe("command refused")
})))
