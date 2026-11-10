import { randomBytes } from "node:crypto"
import { join } from "node:path"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as SqlClient from "effect/sql/SqlClient"
import { afterEach, beforeEach, expect, vi } from "vitest"
import * as Server from "../../src/api/server.ts"
import { projectKey, projectView } from "../../src/project/view.ts"
import { taskDeliveryReach, taskNotificationSource } from "../../src/project/taskDelivery.ts"
import { dispatchQueued } from "../../src/routing/deliveries.ts"
import { permissionRequested } from "../../src/routing/permissions.ts"
import { checkPieceBatch } from "../../src/commands/pieceBatch.ts"
import { engineLists } from "../../src/pieces/lists.ts"
import { LogWriteFailed } from "../../src/log/EventLog.ts"
import { decisionProject, decisionSetup } from "../support/projectDecisionFixtures.ts"
import { provideBoard } from "../board/wakeFixtures.ts"
import { connect } from "../support/socketClient.ts"
import { unwrap } from "../client/support/readRig.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { snapshot, requestPermission } from "../support/routingRig.ts"
import { makeFakeRunner } from "../support/fakeRunner.ts"
import { appendSetup, call, eventOf, failureOf, freshRequest, makeFakeSecrets, makeRig, ownerCredential as owner, provideRig, readLog, removeRig, success, type Rig, type Fakes } from "../support/handlerRig.ts"

let rig: Rig
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder) })
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig) })
const tasks = (projectId: string) => Effect.gen(function* () { return success(yield* call(owner, "project.read", { projectId, collection: "tasks" })).items as Array<{ taskId: string; state: string }> })
const taskState = (projectId: string, taskId: string) => tasks(projectId).pipe(Effect.map((rows) => rows.find((row) => row.taskId === taskId)!.state))
const createTask = (f: Effect.Success<ReturnType<typeof decisionProject>>, extra: Record<string, unknown> = {}) => Effect.gen(function* () {
  return success(yield* call(f.leadCredential, "project.task.create", { ...f.task, ...extra })).taskId as string
})

it.live("authenticated linked answer completes only its task atomically, preserves holder authority, and reads do not manufacture turns or marks", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* decisionSetup(), other = yield* decisionProject("two")
  const taskId = yield* createTask(f), sibling = yield* createTask(f), otherTask = yield* createTask(other)
  const bearer = randomBytes(32).toString("base64url"), socket = join(rig.stateFolder, "decisions.sock")
  yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false })
  const ownerApi = yield* connect(socket, bearer), leadApi = yield* connect(socket, f.lead.token), workerApi = yield* connect(socket, f.worker.token), otherApi = yield* connect(socket, other.lead.token)
  const ask = { requestId: freshRequest(), text: "Choose the release", taskId: taskId as never, projectId: f.projectId as never, sprintId: f.sprintId as never, title: "/Choose" }
  const question = yield* workerApi.ask(ask)
  expect(yield* workerApi.ask(ask)).toEqual(question)
  yield* leadApi["pass-up"]({ requestId: freshRequest(), subject: { _tag: "question", id: question.questionId } })
  expect(yield* taskState(f.projectId, taskId)).toBe("blocked")
  const before = yield* readLog
  const leadReply = yield* leadApi["project.requests"]({ requestId: freshRequest(), projectId: f.projectId as never })
  if (!("data" in leadReply)) return yield* Effect.die(new Error("An agent request read must return a data envelope"))
  const shown = unwrap(leadReply)
  expect(shown.items).toHaveLength(1)
  expect(shown.items[0]).toMatchObject({ id: question.questionId, projectId: f.projectId, taskId, sprintId: f.sprintId, canAnswer: false, holder: { _tag: "owner" } })
  expect(yield* readLog).toEqual(before)
  expect((yield* workerApi["project.requests"]({ requestId: freshRequest(), projectId: f.projectId as never }).pipe(Effect.result))._tag).toBe("Failure")
  expect((yield* otherApi["project.requests"]({ requestId: freshRequest(), projectId: f.projectId as never }).pipe(Effect.result))._tag).toBe("Failure")
  expect((yield* leadApi.answer({ requestId: freshRequest(), kind: "question", id: question.questionId, text: "Unauthorized" }).pipe(Effect.result))._tag).toBe("Failure")
  const answer = { requestId: freshRequest(), kind: "question" as const, id: question.questionId, text: "Release the sidebar" }
  const result = yield* ownerApi.answer(answer)
  expect(yield* ownerApi.answer(answer)).toEqual(result)
  expect((yield* ownerApi.answer({ ...answer, requestId: freshRequest() }).pipe(Effect.result))._tag).toBe("Failure")
  expect((yield* ownerApi.answer({ ...answer, text: "Changed" }).pipe(Effect.result))._tag).toBe("Failure")
  expect(yield* taskState(f.projectId, taskId)).toBe("done")
  expect(yield* taskState(f.projectId, sibling)).toBe("active"); expect(yield* taskState(other.projectId, otherTask)).toBe("active")
  const events = yield* readLog
  const batch = events.filter((row) => row.requestId === answer.requestId)
  expect(batch.filter((row) => row.event._tag === "QuestionAnswered")).toHaveLength(1)
  expect(batch.filter((row) => row.event._tag === "project.TaskChanged").map((row) => row.event)).toEqual([expect.objectContaining({ taskId, state: "done" })])
  const rows = yield* (yield* SqlClient.SqlClient)<{ sequence: number; occurred_at: number }>`SELECT sequence, occurred_at FROM events ORDER BY sequence`
  const history = success(yield* call(owner, "project.task.history", { projectId: f.projectId, taskId })).items
  const indexed = yield* ownerApi["client.requests"]({ requestId: freshRequest(), after: 0 as never, limit: 200 })
  const stored = indexed.items.find((row) => row.id === question.questionId)!
  expect(stored).toMatchObject({ status: "answered", answer: answer.text, canAnswer: false, taskId })
  expect(stored.openedAt).toBe(rows.find((row) => row.sequence === stored.sourceSequence)!.occurred_at)
  expect(stored.answeredAt).toBe(rows.find((row) => row.sequence === stored.closedSequence)!.occurred_at)
  expect(history.filter((row: { title: string }) => row.title === "Question asked")).toEqual([expect.objectContaining({ at: stored.openedAt, state: "blocked" })])
  expect(history.filter((row: { title: string }) => row.title === "Question answered")).toEqual([expect.objectContaining({ at: stored.answeredAt, state: "done" })])
  const unlinked = yield* workerApi.ask({ requestId: freshRequest(), text: "Carry on?" })
  yield* ownerApi.answer({ requestId: freshRequest(), kind: "question", id: unlinked.questionId, text: "Yes" })
  expect(yield* taskState(f.projectId, sibling)).toBe("active")
})).pipe(Effect.orDie))

it.live("rejects unknown and cross-project links without admitting questions or completing another project", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* decisionSetup(), other = yield* decisionProject("two")
  const taskId = yield* createTask(f), otherTask = yield* createTask(other)
  for (const link of [{ taskId: "missing" }, { sprintId: "missing" }, { projectId: other.projectId, taskId: otherTask }, { taskId: otherTask }, { taskId, sprintId: other.sprintId }]) {
    expect(failureOf(yield* call(f.workerCredential, "ask", { text: "Bad join", ...link }))?.reason).toBe("invalid question links")
  }
  expect((yield* readLog).filter((row) => row.event._tag === "QuestionAsked")).toEqual([])
  expect((yield* readLog).filter((row) => row.event._tag === "project.TaskChanged")).toEqual([])
  expect(yield* taskState(other.projectId, otherTask)).toBe("active")
})).pipe(Effect.orDie))

for (const optionId of ["once", "reject"] as const) it.live(`a permission selects only the first durable active/review task and ${optionId} clears only its blocker`, () => provideBoard(rig, (runner) => Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* decisionSetup(), other = yield* decisionProject("two")
  const first = yield* createTask(f, { label: "99", state: "review" }), second = yield* createTask(f, { label: "1" }), queued = yield* createTask(f, { state: "queue" }), done = yield* createTask(f, { state: "done" }), elsewhere = yield* createTask(other)
  const permission = yield* requestPermission(runner, { agentId: f.workerId, token: f.worker.token }, { settingsWrite: true })
  expect(permission.row).toMatchObject({ projectId: f.projectId, taskId: first, sprintId: f.sprintId })
  expect(yield* taskState(f.projectId, first)).toBe("blocked")
  expect(yield* taskState(f.projectId, second)).toBe("active"); expect(yield* taskState(f.projectId, queued)).toBe("queue"); expect(yield* taskState(f.projectId, done)).toBe("done"); expect(yield* taskState(other.projectId, elsewhere)).toBe("active")
  // A repeated real notification is admitted by the same deduplication path.
  expect(yield* permissionRequested(yield* snapshot, { _tag: "permissionRequested", agentId: f.workerId as never, permissionRequestId: permission.id, toolCallId: "duplicate", description: "Duplicate", options: permission.row.options, settingsWrite: true } as never)).toEqual([])
  const answer = { requestId: freshRequest(), kind: "permission", id: permission.id, optionId }
  const result = success(yield* call(owner, "answer", answer)); expect(success(yield* call(owner, "answer", answer))).toEqual(result)
  expect(yield* taskState(f.projectId, first)).toBe("review"); expect(yield* taskState(f.projectId, second)).toBe("active")
  expect((yield* readLog).filter((row) => row.event._tag === "QuestionAsked")).toEqual([])
  expect((yield* readLog).filter((row) => row.event._tag === "project.TaskChanged")).toEqual([])
})).pipe(Effect.orDie))

it.live("cancellation removes its permission blocker, while an open question survives stop with the original timestamp", () => provideBoard(rig, (runner) => Effect.gen(function* () {
  yield* registerRebuildCheck(); const f = yield* decisionSetup(), taskId = yield* createTask(f)
  const permission = yield* requestPermission(runner, { agentId: f.workerId, token: f.worker.token }, { settingsWrite: true })
  const question = success(yield* call(f.workerCredential, "ask", { text: "Keep this open", taskId }))
  const original = (yield* snapshot).questions[question.questionId]!.openedAt
  success(yield* call(owner, "stop", { agentId: f.workerId }))
  const state = yield* snapshot
  expect(state.requests[permission.id]!.status).toBe("cancelled")
  expect(state.questions[question.questionId]).toMatchObject({ status: "open", openedAt: original })
  expect(yield* taskState(f.projectId, taskId)).toBe("blocked")
  success(yield* call(owner, "answer", { kind: "question", id: question.questionId, text: "Done" }))
  expect(yield* taskState(f.projectId, taskId)).toBe("done")
})).pipe(Effect.orDie))

for (const boundary of ["write", "reply"] as const) it.live(`${boundary} failure at a real answer boundary recovers without a partial or duplicate completion`, () => Effect.gen(function* () {
  const runner = yield* makeFakeRunner(), secrets = makeFakeSecrets()
  let armed = true
  let failWrite: Effect.Effect<void> = Effect.die(new Error("The write-failure fixture was not initialized"))
  const wrapLog: NonNullable<Fakes["wrapLog"]> = (real) => ({ ...real, transact: (use) => {
    let answered = false
    return real.transact((append) => use((actor, id, hash, events, side, receipt) => {
      answered ||= events.some((event) => event._tag === "QuestionAnswered")
      if (armed && answered && boundary === "write") {
        armed = false
        return Effect.gen(function* () {
          yield* failWrite
          return yield* append(actor, id, hash, events, side, receipt)
        })
      }
      return append(actor, id, hash, events, side, receipt)
    })).pipe(Effect.flatMap((result) => {
      if (armed && answered && boundary === "reply") { armed = false; return Effect.fail(new LogWriteFailed({ reason: "test lost committed answer reply" })) }
      return Effect.succeed(result)
    }))
  } })
  const saved = yield* provideRig(rig, { runner, secrets, wrapLog }, Effect.gen(function* () {
    const writer = yield* SqlClient.SqlClient
    failWrite = writer`PRAGMA query_only = ON`.pipe(Effect.orDie, Effect.asVoid)
    yield* registerRebuildCheck(); const f = yield* decisionSetup(), taskId = yield* createTask(f), sibling = yield* createTask(f)
    const question = success(yield* call(f.workerCredential, "ask", { text: "Choose", taskId }))
    const request = { requestId: freshRequest(), kind: "question" as const, id: question.questionId, text: "Approved" }
    const bearer = randomBytes(32).toString("base64url")
    yield* Server.serve({ socketPath: join(rig.stateFolder, "failure.sock"), ownerCredential: Redacted.make(bearer), debug: false })
    const api = yield* connect(join(rig.stateFolder, "failure.sock"), bearer)
    expect((yield* api.answer(request).pipe(Effect.result))._tag).toBe("Failure")
    const state = yield* snapshot
    expect(state.questions[question.questionId]!.status).toBe(boundary === "write" ? "open" : "answered")
    expect(projectView(state).tasks[projectKey(f.projectId, taskId)]!.state).toBe(boundary === "write" ? "active" : "done")
    expect(yield* taskState(f.projectId, sibling)).toBe("active")
    if (boundary === "write") expect(failureOf(yield* call(owner, "answer", request))?._tag).toBe("LogWriteFailed")
    else {
      const repeated = success(yield* call(owner, "answer", request))
      expect(success(yield* call(owner, "answer", request))).toEqual(repeated)
    }
    return { projectId: f.projectId, taskId, sibling, request }
  }))
  yield* provideRig(rig, { runner, secrets }, Effect.gen(function* () {
    yield* registerRebuildCheck()
    const result = success(yield* call(owner, "answer", saved.request))
    expect(success(yield* call(owner, "answer", saved.request))).toEqual(result)
    expect(yield* taskState(saved.projectId, saved.taskId)).toBe("done"); expect(yield* taskState(saved.projectId, saved.sibling)).toBe("active")
    const events = (yield* readLog).filter((row) => row.requestId === saved.request.requestId)
    expect(events.filter((row) => row.event._tag === "QuestionAnswered")).toHaveLength(1)
    expect(events.filter((row) => row.event._tag === "project.TaskChanged")).toHaveLength(1)
    const sql = yield* SqlClient.SqlClient
    const receipt = yield* sql<{ result_json: string }>`SELECT result_json FROM receipts WHERE request_id = ${saved.request.requestId}`
    expect(receipt).toHaveLength(1)
    expect(success(yield* call(owner, "project.requests", { projectId: saved.projectId, status: "answered" })).items).toHaveLength(1)
  }))
}).pipe(Effect.orDie))

it.live("task-specific reach validates durable source, task, actual lead and exact delivery even without a caller", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck(); const f = yield* decisionSetup(), other = yield* decisionProject("two")
  const request = { requestId: freshRequest(), ...f.task }
  const result = success(yield* call(owner, "project.task.create", request))
  expect(success(yield* call(owner, "project.task.create", request))).toEqual(result)
  const state = yield* snapshot, intent = Object.values(projectView(state).taskNotifications)[0]!
  const delivery = state.deliveries[intent.deliveryId!]!
  const input = { snapshot: state, target: f.leadId, deliveryId: delivery.id, source: { _tag: "piece" as const, namespace: "project" as const, id: taskNotificationSource(intent.notificationId) } }
  expect(taskDeliveryReach(input)).toBe(true)
  for (const patch of [{ target: other.leadId }, { deliveryId: "forged" }, { source: { ...input.source, id: "mock-approval:" + intent.notificationId } }, { source: { ...input.source, id: "task-notification:unknown" } }]) expect(taskDeliveryReach({ ...input, ...patch })).toBe(false)
  expect(delivery.sender).toEqual({ _tag: "piece", namespace: "project" })
  expect(delivery.content._tag === "prompt" && delivery.content.text).toMatch(/^Data from piece project \[/)
  expect(JSON.stringify(delivery.content)).toContain("Author: owner")
  expect((yield* readLog).filter((row) => row.event._tag === "project.OwnerTaskNotificationPlanned")).toHaveLength(1)
  const invalid = yield* checkPieceBatch("project", state, { events: [], deliveries: [{ target: other.leadId as never, sourceId: input.source.id, body: "Unreachable" }] }, undefined, engineLists).pipe(Effect.result)
  expect(invalid._tag).toBe("Failure")
  // Later dispatch rechecks the durable lead. An obsolete queued target is
  // withdrawn, without sending a raw owner prompt or creating another intent.
  yield* appendSetup([eventOf({ _tag: "project.Created", ...projectView(state).projects[f.projectId], leadAgentId: other.leadId })])
  yield* appendSetup([eventOf({ _tag: "StateChanged", agentId: f.leadId, state: { _tag: "idle" } })])
  yield* dispatchQueued(f.leadId as never)
  expect((yield* snapshot).deliveries[delivery.id]!.status).toBe("withdrawn")
  expect((yield* readLog).filter((row) => row.event._tag === "PromptSent" && row.event.deliveryId === delivery.id)).toEqual([])
})).pipe(Effect.orDie))

it.live("multiple blockers prevent sprint completion, and bounded history keeps the state at each durable decision", () => provideBoard(rig, (runner) => Effect.gen(function* () {
  yield* registerRebuildCheck(); const f = yield* decisionSetup(), taskId = yield* createTask(f)
  const first = success(yield* call(f.workerCredential, "ask", { text: "x".repeat(9000), taskId }))
  const second = success(yield* call(f.workerCredential, "ask", { text: "Another decision", taskId }))
  const permission = yield* requestPermission(runner, { agentId: f.workerId, token: f.worker.token }, { settingsWrite: true })
  const complete = { projectId: f.projectId, sprintId: f.sprintId, completion: "Verified", evidence: "All linked work finished" }
  success(yield* call(owner, "answer", { kind: "question", id: first.questionId, text: "Done" }))
  expect(yield* taskState(f.projectId, taskId)).toBe("blocked")
  expect(failureOf(yield* call(f.leadCredential, "project.sprint.complete", complete))?.reason).toBe("sprint tasks are incomplete")
  const before = success(yield* call(owner, "project.task.history", { projectId: f.projectId, taskId })).items
  expect(before.find((row: { title: string; detail: string }) => row.title === "Question asked" && row.detail.startsWith("x"))).toMatchObject({ detail: "x".repeat(8192) })
  expect(before.find((row: { title: string }) => row.title === "Question answered").state).toBe("blocked")
  success(yield* call(owner, "answer", { kind: "permission", id: permission.id, optionId: "reject" }))
  expect(yield* taskState(f.projectId, taskId)).toBe("blocked")
  success(yield* call(owner, "answer", { kind: "question", id: second.questionId, text: "Done too" }))
  expect(yield* taskState(f.projectId, taskId)).toBe("done")
  const after = success(yield* call(owner, "project.task.history", { projectId: f.projectId, taskId })).items
  expect(after.find((row: { title: string }) => row.title === "Approval answered").state).toBe("blocked")
  expect(after.filter((row: { title: string }) => row.title === "Question answered").map((row: { state: string }) => row.state)).toEqual(["blocked", "done"])
  expect((yield* readLog).filter((row) => row.event._tag === "project.TaskChanged" && row.event.taskId === taskId && row.event.state === "done")).toHaveLength(1)
  success(yield* call(f.leadCredential, "project.sprint.complete", complete))
})).pipe(Effect.orDie))


it.live("issue 577: another worker cannot link a task; task owner and project lead can", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* decisionSetup()
  const leadTask = yield* createTask(f, { owner: f.leadId })
  const before = (yield* readLog).filter((row) => row.event._tag === "QuestionAsked")
  expect(failureOf(yield* call(f.workerCredential, "ask", { text: "Finish somebody else's task", taskId: leadTask }))?.reason).toBe("invalid question links")
  expect((yield* readLog).filter((row) => row.event._tag === "QuestionAsked")).toEqual(before)
  expect(yield* taskState(f.projectId, leadTask)).toBe("active")
  const ownTask = yield* createTask(f)
  for (const [credential, taskId] of [[f.workerCredential, ownTask], [f.leadCredential, leadTask]] as const) {
    const question = success(yield* call(credential, "ask", { text: "Finish authorized task", taskId }))
    success(yield* call(owner, "answer", { kind: "question", id: question.questionId, text: "Done" }))
    expect(yield* taskState(f.projectId, taskId)).toBe("done")
  }
})).pipe(Effect.orDie))

it.live("issue 592: a reassigned linked task receives the answer without unauthorized completion or a stuck blocker", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* decisionSetup(), taskId = yield* createTask(f)
  const question = success(yield* call(f.workerCredential, "ask", { text: "Choose", taskId }))
  success(yield* call(f.leadCredential, "project.task.update", { projectId: f.projectId, taskId, owner: f.leadId }))
  expect(yield* taskState(f.projectId, taskId)).toBe("blocked")
  const request = { requestId: freshRequest(), kind: "question", id: question.questionId, text: "Answer answer-secret-value" }
  expect(failureOf(yield* call(f.workerCredential, "answer", request))).toBeDefined()
  const before = yield* readLog
  const result = success(yield* call(f.leadCredential, "answer", request))
  expect(success(yield* call(f.leadCredential, "answer", request))).toEqual(result)
  const written = (yield* readLog).slice(before.length)
  expect(written.filter((row) => row.event._tag === "QuestionAnswered")).toHaveLength(1)
  expect(written.filter((row) => row.event._tag === "project.TaskChanged")).toEqual([])
  expect(JSON.stringify(written)).not.toContain("answer-secret-value")
  const state = yield* snapshot
  expect(state.questions[question.questionId]).toMatchObject({ status: "answered", answer: "Answer [REDACTED]" })
  expect(projectView(state).tasks[projectKey(f.projectId, taskId)]).toMatchObject({ owner: f.leadId, state: "active" })
  expect(yield* taskState(f.projectId, taskId)).toBe("active")
  const history = success(yield* call(owner, "project.task.history", { projectId: f.projectId, taskId })).items
  expect(history.find((row: any) => row.title === "Question answered")).toMatchObject({ state: "active" })
  expect((yield* readLog).filter((row) => row.requestId === request.requestId && row.event._tag === "QuestionAnswered")).toHaveLength(1)
  const sql = yield* SqlClient.SqlClient
  expect(yield* sql`SELECT request_id FROM receipts WHERE caller = ${`agent:${f.leadId}`} AND request_id = ${request.requestId}`).toHaveLength(1)
}), ["answer-secret-value"]).pipe(Effect.orDie))
