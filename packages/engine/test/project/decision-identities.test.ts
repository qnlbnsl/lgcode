import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import { afterEach, beforeEach, expect, vi } from "vitest"
import { projectKey, projectView } from "../../src/project/view.ts"
import { provideBoard } from "../board/wakeFixtures.ts"
import { decisionProject, decisionSetup } from "../support/projectDecisionFixtures.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { requestPermission, snapshot } from "../support/routingRig.ts"
import { appendSetup, call, eventOf, freshRequest, makeRig, ownerCredential as owner, readLog, removeRig, seedAccount, seedHarness, success, type Rig } from "../support/handlerRig.ts"

let rig: Rig
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder) })
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig) })

it.live("real writer preserves colliding decision joins and question activity identities, redacts prose, and replays original history times", () => Effect.gen(function* () {
  const secrets = ["collision-marker"]
  const saved = yield* provideBoard(rig, (runner) => Effect.gen(function* () {
    yield* registerRebuildCheck(); yield* seedAccount(); yield* seedHarness()
    const f = yield* decisionProject("collision-marker")
    const sprintId = "sprint-collision-marker", taskId = "task-collision-marker"
    yield* appendSetup([
      eventOf({ _tag: "project.SprintAdded", projectId: f.projectId, sprintId, label: "SP-2", name: "Sprint", goal: "Hide collision-marker", phase: "Build", owner: f.leadId, needs: [] }),
      eventOf({ _tag: "project.TaskAdded", ...f.task, taskId, sprintId, title: "Hide collision-marker" }),
    ])
    const ask = { requestId: freshRequest(), text: "Hide collision-marker", taskId, sprintId, projectId: f.projectId, title: "Hide collision-marker", recommendation: "Hide collision-marker", proposedAnswer: "Hide collision-marker" }
    const asked = success(yield* call(f.workerCredential, "ask", ask))
    secrets.push(asked.questionId)
    const story = { summary: "Hide collision-marker", done: ["Hide collision-marker"], activity: [{ question: asked.questionId,
      open: { title: "Hide collision-marker", detail: "Hide collision-marker" }, answered: { title: "Hide collision-marker", detail: "Hide collision-marker" } }] }
    const extra = success(yield* call(f.leadCredential, "project.task.create", { ...f.task, story }))
    const permission = yield* requestPermission(runner, { agentId: f.workerId, token: f.worker.token }, { settingsWrite: true })
    expect(permission.row).toMatchObject({ projectId: f.projectId, taskId, sprintId })
    success(yield* call(owner, "answer", { kind: "permission", id: permission.id, optionId: "reject" }))
    success(yield* call(f.leadCredential, "pass-up", { subject: { _tag: "question", id: asked.questionId } }))
    const answer = { kind: "question", id: asked.questionId, text: "Hide collision-marker" }
    success(yield* call(owner, "answer", answer))
    const state = yield* snapshot
    expect(state.questions[asked.questionId]).toMatchObject({ projectId: f.projectId, taskId, sprintId, status: "answered", text: "Hide [REDACTED]", answer: "Hide [REDACTED]" })
    const task = projectView(state).tasks[projectKey(f.projectId, extra.taskId)]!
    const expectedStory = { summary: "Hide [REDACTED]", done: ["Hide [REDACTED]"], activity: [{ question: asked.questionId,
      open: { title: "Hide [REDACTED]", detail: "Hide [REDACTED]" }, answered: { title: "Hide [REDACTED]", detail: "Hide [REDACTED]" } }] }
    expect(task.story).toEqual({ ...expectedStory, activity: [{ ...expectedStory.activity[0], at: task.history[0]!.at }] })
    const sql = yield* SqlClient.SqlClient
    const stored = yield* sql<{ payload_json: string }>`SELECT payload_json FROM events WHERE event_type IN ('QuestionAsked', 'PermissionRequested')`
    for (const row of stored) expect(JSON.parse(row.payload_json)).toMatchObject({ projectId: f.projectId, taskId, sprintId })
    const receipts = yield* sql<{ result_json: string }>`SELECT result_json FROM receipts WHERE json_extract(result_json, '$.reply.taskId') = ${extra.taskId}`
    expect(receipts).toHaveLength(1)
    const receipt = JSON.parse(receipts[0]!.result_json)
    expect(receipt.envelopes.find((row: { event: { _tag: string } }) => row.event._tag === "project.TaskAdded").event.story).toEqual(expectedStory)
    const questionReceipts = yield* sql<{ result_json: string }>`SELECT result_json FROM receipts WHERE caller = ${`agent:${f.workerId}`} AND request_id = ${ask.requestId}`
    expect(questionReceipts).toHaveLength(1)
    const questionReceipt = JSON.parse(questionReceipts[0]!.result_json)
    expect(questionReceipt.reply.questionId).toBe(asked.questionId)
    const questionEvents = questionReceipt.envelopes.filter((row: { event: { _tag: string } }) => row.event._tag === "QuestionAsked")
    expect(questionEvents).toHaveLength(1)
    expect(questionEvents[0].event).toMatchObject({ questionId: asked.questionId, projectId: f.projectId, taskId, sprintId, text: "Hide [REDACTED]" })
    const history = success(yield* call(owner, "project.task.history", { projectId: f.projectId, taskId })).items
    const requests = success(yield* call(owner, "project.requests", { projectId: f.projectId })).items
    expect(history.map((row: { title: string }) => row.title)).toEqual(["Task added", "Question asked", "Approval requested", "Approval answered", "Question answered", "Task updated"])
    return { projectId: f.projectId, taskId, extraId: extra.taskId, history, requests, events: yield* readLog }
  }), secrets)
  yield* provideBoard(rig, Effect.gen(function* () {
    yield* registerRebuildCheck()
    expect(yield* readLog).toEqual(saved.events)
    expect(success(yield* call(owner, "project.task.history", { projectId: saved.projectId, taskId: saved.taskId })).items).toEqual(saved.history)
    expect(success(yield* call(owner, "project.requests", { projectId: saved.projectId })).items).toEqual(saved.requests)
    const view = projectView(yield* snapshot)
    expect(view.tasks[projectKey(saved.projectId, saved.taskId)]!.state).toBe("done")
    expect(view.tasks[projectKey(saved.projectId, saved.extraId)]!.state).toBe("active")
  }), secrets)
}).pipe(Effect.orDie))

it.live("old provisional task metadata stays readable without gaining completion authority on replay", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck(); const f = yield* decisionSetup()
  const taskId = success(yield* call(f.leadCredential, "project.task.create", f.task)).taskId
  yield* appendSetup([eventOf({ _tag: "QuestionAsked", agentId: f.workerId, questionId: "old-question", deliveryId: "old-delivery", holder: { _tag: "owner" }, text: "Historical", taskId, sprintId: f.sprintId })])
  const row = success(yield* call(owner, "project.requests", { projectId: f.projectId })).items[0]
  expect(row).toMatchObject({ id: "old-question", projectId: f.projectId, display: { taskId, sprintId: f.sprintId } })
  expect(row.taskId).toBeUndefined()
  success(yield* call(owner, "answer", { kind: "question", id: "old-question", text: "Answered" }))
  expect(projectView(yield* snapshot).tasks[projectKey(f.projectId, taskId)]!.state).toBe("active")
})).pipe(Effect.orDie))
