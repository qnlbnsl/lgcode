import { randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { afterEach, beforeEach, expect, vi } from "vitest"
import * as Server from "../../src/api/server.ts"
import { mockScreenKey, projectView } from "../../src/project/view.ts"
import { provideBoard, snapshot } from "../board/wakeFixtures.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { connect } from "../support/socketClient.ts"
import { agentCredential, call, failureOf, freshRequest, makeRig, ownerCredential as owner, readLog, removeRig, success, type Rig } from "../support/handlerRig.ts"
import { screenBundle, seedScreens } from "./mockScreenFixtures.ts"

let rig: Rig
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder) })
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig) })

it.live("stores a redacted plain text owner comment, exposes it to its project tools, and replays its recorded author and time", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* seedScreens(rig), requestId = freshRequest()
  const hostile = 'Please change <script>alert(1)</script> ; $(touch escaped) `touch escaped` --upload-pack=evil ../../outside\u0000\u001b\u0085 private-comment-token'
  const payload = { ...f.selection, requestId, text: hostile }
  success(yield* call(owner, "project.mocks.comment", payload))
  const beforeRetry = yield* readLog
  success(yield* call(owner, "project.mocks.comment", payload))
  expect(yield* readLog).toEqual(beforeRetry)
  const reply = success(yield* call(owner, "project.mocks.screen.read", f.selection))
  expect(reply.review.comments).toHaveLength(1)
  expect(reply.review.comments[0]).toMatchObject({ commentId: requestId, author: { _tag: "owner" }, at: expect.any(Number) })
  expect(reply.review.comments[0].text).toContain("<script>alert(1)</script>")
  expect(reply.review.comments[0].text).toContain("$(touch escaped)")
  expect(reply.review.comments[0].text).not.toMatch(/[\u0000\u001b\u0085]/)
  expect(reply.review.comments[0].text).not.toContain("private-comment-token")
  expect(existsSync(join(rig.work, "escaped"))).toBe(false)
  const agent = success(yield* call(agentCredential(f.designer.token), "project.mocks.screen.read", f.selection))
  expect(agent.data).toContain("Data from")
  expect(agent.data).toContain(requestId)
  expect(agent.data).not.toContain("private-comment-token")
  expect(failureOf(yield* call(agentCredential(f.stranger.token), "project.mocks.screen.read", f.selection))?.reason).toBe("project is unavailable to this caller")
  expect(failureOf(yield* call(agentCredential(f.designer.token), "project.mocks.comment", payload))?.reason).toBe("command refused")
  expect(projectView(yield* snapshot).mockScreenReviews[mockScreenKey("project", f.revisionId, "home")]?.comments).toEqual(reply.review.comments)
}), ["private-comment-token"]))

it.live("refuses empty, oversized, absent-screen and stale comments without altering the review", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* seedScreens(rig)
  for (const [patch, reason] of [
    [{ text: "\u0000 \u001b" }, "mock comment must contain between 1 and 4096 characters"],
    [{ text: "x".repeat(4097) }, "command refused"],
    [{ screenId: "../../outside", text: "hello" }, "mock screen is unavailable"]
  ] as const) expect(failureOf(yield* call(owner, "project.mocks.comment", { ...f.selection, ...patch }))?.reason).toBe(reason)
  expect(success(yield* call(owner, "project.mocks.screen.read", f.selection)).review.comments).toEqual([])
  success(yield* call(owner, "project.mocks.record", { projectId: "project", expectedRevision: f.revisionId, bundle: screenBundle() }))
  expect(failureOf(yield* call(owner, "project.mocks.comment", { ...f.selection, text: "late comment" }))?.reason).toBe("mock revision changed; refresh and retry")
})))

it.live("returns exact public reasons through the authenticated screen API", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* seedScreens(rig), bearer = randomBytes(32).toString("base64url"), socket = join(rig.stateFolder, "screen.sock")
  yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false })
  const api = yield* connect(socket, bearer), agent = yield* connect(socket, f.designer.token)
  const payload = { requestId: freshRequest(), ...f.selection, text: "owner feedback" } as never
  const refused = yield* agent["project.mocks.comment"](payload).pipe(Effect.result)
  expect(refused._tag).toBe("Failure")
  if (refused._tag === "Failure") expect(refused.failure).toMatchObject({ reason: "command refused" })
  yield* api["project.mocks.comment"](payload)
  const read = yield* api["project.mocks.screen.read"]({ requestId: freshRequest(), ...f.selection } as never)
  expect(read).toMatchObject({ review: { comments: [{ text: "owner feedback" }] } })
  success(yield* call(owner, "project.mocks.record", { projectId: "project", expectedRevision: f.revisionId, bundle: screenBundle() }))
  const staleComment = yield* api["project.mocks.comment"]({ ...f.selection, requestId: freshRequest(), text: "stale comment" } as never).pipe(Effect.result)
  expect(staleComment._tag).toBe("Failure")
  if (staleComment._tag === "Failure") expect(staleComment.failure).toMatchObject({ reason: "mock revision changed; refresh and retry" })
  const staleApproval = yield* api["project.mocks.screen.approve"]({ ...f.selection, requestId: freshRequest(), approved: true } as never).pipe(Effect.result)
  expect(staleApproval._tag).toBe("Failure")
  if (staleApproval._tag === "Failure") expect(staleApproval.failure).toMatchObject({ reason: "mock revision changed; refresh and retry" })
})))

it.live("approves and withdraws one screen as the owner without moving the stage or granting agents approval authority", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* seedScreens(rig), requestId = freshRequest(), payload = { ...f.selection, approved: true, requestId }
  expect(failureOf(yield* call(agentCredential(f.designer.token), "project.mocks.screen.approve", payload))?.reason).toBe("command refused")
  success(yield* call(owner, "project.mocks.screen.approve", payload))
  const rows = yield* readLog
  success(yield* call(owner, "project.mocks.screen.approve", payload))
  expect(yield* readLog).toEqual(rows)
  const approved = success(yield* call(owner, "project.mocks.screen.read", f.selection)).review.approval
  expect(approved).toMatchObject({ approved: true, author: { _tag: "owner" }, at: expect.any(Number) })
  expect(projectView(yield* snapshot).projects.project?.stage).toBe("design")
  expect(Object.values(projectView(yield* snapshot).mockApprovals)).toEqual([])
  expect(success(yield* call(agentCredential(f.designer.token), "project.mocks.screen.read", f.selection)).data).toContain('"approved":true')
  success(yield* call(owner, "project.mocks.screen.approve", { ...f.selection, approved: false }))
  expect(success(yield* call(owner, "project.mocks.screen.read", f.selection)).review.approval).toMatchObject({ approved: false, author: { _tag: "owner" } })
  expect(projectView(yield* snapshot).projects.project?.stage).toBe("design")
  for (const screenId of ['../../outside', '$(touch escaped)', '--upload-pack=evil', '`touch escaped`'])
    expect(failureOf(yield* call(owner, "project.mocks.screen.approve", { ...f.selection, screenId, approved: true }))?.reason).toBe("mock screen is unavailable")
  expect(existsSync(join(rig.work, "escaped"))).toBe(false)
  const next = success(yield* call(owner, "project.mocks.record", { projectId: "project", expectedRevision: f.revisionId, bundle: screenBundle() }))
  expect(success(yield* call(owner, "project.mocks.screen.read", { ...f.selection, revisionId: next.revisionId })).review.approval).toBeUndefined()
  expect(failureOf(yield* call(owner, "project.mocks.screen.approve", { ...f.selection, approved: true }))?.reason).toBe("mock revision changed; refresh and retry")
})))

it.live("stores seen marks at an exact version and keeps historical marks from clearing a new version", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* seedScreens(rig), requestId = freshRequest()
  expect(failureOf(yield* call(agentCredential(f.designer.token), "project.mocks.seen", f.selection))?.reason).toBe("command refused")
  success(yield* call(owner, "project.mocks.seen", { ...f.selection, requestId }))
  const rows = yield* readLog
  success(yield* call(owner, "project.mocks.seen", { ...f.selection, requestId }))
  expect(yield* readLog).toEqual(rows)
  const first = success(yield* call(owner, "project.mocks.screen.read", f.selection)).review
  expect(first.seen).toMatchObject({ author: { _tag: "owner" }, at: expect.any(Number) })
  const next = success(yield* call(owner, "project.mocks.record", { projectId: "project", expectedRevision: f.revisionId, bundle: screenBundle() }))
  expect(success(yield* call(owner, "project.mocks.screen.read", { ...f.selection, revisionId: next.revisionId })).review.seen).toBeUndefined()
  success(yield* call(owner, "project.mocks.seen", f.selection))
  expect(success(yield* call(owner, "project.mocks.screen.read", { ...f.selection, revisionId: next.revisionId })).review.seen).toBeUndefined()
  for (const screenId of ['../../outside', '$(touch escaped)', '--upload-pack=evil', '`touch escaped`'])
    expect(failureOf(yield* call(owner, "project.mocks.seen", { ...f.selection, screenId }))?.reason).toBe("mock screen is unavailable")
  expect(existsSync(join(rig.work, "escaped"))).toBe(false)
  expect(success(yield* call(agentCredential(f.designer.token), "project.mocks.screen.read", f.selection)).data).toContain('"seen":')
})))
