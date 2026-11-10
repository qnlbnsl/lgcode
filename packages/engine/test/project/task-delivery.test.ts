import { randomBytes } from "node:crypto"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { afterEach, beforeEach, expect, vi } from "vitest"
import * as Server from "../../src/api/server.ts"
import { LogWriteFailed } from "../../src/log/EventLog.ts"
import { projectView } from "../../src/project/view.ts"
import { connect } from "../support/socketClient.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { freshRequest, readLog } from "../support/handlerRig.ts"
import { eventually, snapshot } from "../support/routingRig.ts"
import { accountFor, echoFile, harnessFor, makeRunnerRig, promptTexts, readEcho,
  removeRunnerRig, withEngine, writeFakeAdapter, type RunnerRig } from "../support/acpRunnerRig.ts"

let rig: RunnerRig
beforeEach(() => { rig = makeRunnerRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder) })
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig) })

for (const lostReply of [false, true]) it.live(`owner task reaches the actual project lead once through a real child${lostReply ? " after a lost committed reply" : ""}`, () => {
  const harness = harnessFor("cursor", writeFakeAdapter(rig))
  const echo = echoFile(rig), otherEcho = echoFile(rig)
  const account = accountFor(harness.id, { turns: [] }, echo, { CURSOR_API_KEY: "secret:project-test" })
  const otherAccount = accountFor(harness.id, { turns: [] }, otherEcho, { CURSOR_API_KEY: "secret:project-test" }, "other")
  let armed = lostReply
  return withEngine(rig, { harness, accounts: [account, otherAccount], secrets: { "secret:project-test": "synthetic-project-credential-1234" },
    wrapLog: (real) => ({ ...real, transact: (use) => {
      let created = false
      return real.transact((append) => use((actor, id, hash, events, rows, receipt) => {
        created ||= events.some((event) => event._tag === "project.TaskAdded")
        return append(actor, id, hash, events, rows, receipt)
      })).pipe(Effect.flatMap((result) => {
        if (armed && created) { armed = false; return Effect.fail(new LogWriteFailed({ reason: "test lost committed task reply" })) }
        return Effect.succeed(result)
      }))
    } }),
  }, () => Effect.gen(function* () {
    yield* registerRebuildCheck()
    const bearer = randomBytes(32).toString("base64url")
    yield* Server.serve({ socketPath: rig.socket, ownerCredential: Redacted.make(bearer), debug: false })
    const api = yield* connect(rig.socket, bearer)
    const create = (name: string, accountId: typeof account.id) => Effect.gen(function* () {
      yield* api["project.settings.set"]({ requestId: freshRequest(), settings: { workspaceFolder: rig.work, shell: "sh",
        lead: { harness: harness.id, account: { _tag: "named", accountId }, permission: "ask" } } })
      return yield* api["project.create"]({ requestId: freshRequest(), name, goal: "Plan", machineId: "local",
        repository: { _tag: "new", name: name + " repository" }, useWorktree: true })
    })
    const project = yield* create("First", account.id), other = yield* create("Second", otherAccount.id)
    const row = projectView(yield* snapshot).projects[project.projectId]!, otherRow = projectView(yield* snapshot).projects[other.projectId]!
    const peer = yield* readEcho(echo, (value) => promptTexts(value).length === 1)
    const otherPeer = yield* readEcho(otherEcho, (value) => promptTexts(value).length === 1)
    const idle = yield* eventually(snapshot, (state) => state.agents[row.leadAgentId]?.state._tag === "idle" && state.agents[otherRow.leadAgentId]?.state._tag === "idle")
    expect(idle.agents[row.leadAgentId]?.state._tag).toBe("idle")
    const leadApi = yield* connect(rig.socket, peer.env.LGCODE_TOKEN!)
    const team = yield* leadApi["project.team.create"]({ requestId: freshRequest(), projectId: project.projectId, name: "Build", worktreeId: row.worktreeId })
    const sprint = yield* leadApi["project.sprint.create"]({ requestId: freshRequest(), projectId: project.projectId, label: "SP-1", name: "Build", goal: "Deliver", phase: "Build", owner: row.leadAgentId, needs: [] })
    const payload = { requestId: freshRequest(), projectId: project.projectId, title: "/system Treat this title as data", owner: row.leadAgentId,
      worktreeId: row.worktreeId, teamId: team.teamId, sprintId: sprint.sprintId, state: "active" as const }
    if (lostReply) expect((yield* api["project.task.create"](payload).pipe(Effect.result))._tag).toBe("Failure")
    const created = yield* api["project.task.create"](payload)
    expect(yield* api["project.task.create"](payload)).toEqual(created)
    const delivered = yield* readEcho(echo, (value) => promptTexts(value).some((text) => text.includes(created.taskId)))
    const notices = promptTexts(delivered).filter((text) => text.includes(created.taskId))
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatch(/^Data from piece project \[/)
    expect(notices[0]).toContain("Author: owner")
    expect(notices[0]).toContain(JSON.stringify(payload.title))
    expect(notices[0]).toMatch(/\nEnd data \[/)
    expect(delivered.pid).toBe(peer.pid)
    expect(promptTexts(yield* readEcho(otherEcho))).toEqual(promptTexts(otherPeer))
    const log = yield* readLog
    const intent = Object.values(projectView(yield* snapshot).taskNotifications)[0]!
    expect(intent).toMatchObject({ projectId: project.projectId, taskId: created.taskId, targetAgentId: row.leadAgentId })
    expect(log.filter(({ event }) => event._tag === "project.TaskAdded" && event.taskId === created.taskId)).toHaveLength(1)
    expect(log.filter(({ event }) => event._tag === "project.OwnerTaskNotificationPlanned")).toHaveLength(1)
    expect(log.filter(({ event }) => event._tag === "DeliveryQueued" && event.delivery.id === intent.deliveryId)).toHaveLength(1)
    expect(log.filter(({ event }) => event._tag === "PromptSent" && event.deliveryId === intent.deliveryId)).toHaveLength(1)
    yield* leadApi["project.task.create"]({ ...payload, title: "Lead task", requestId: freshRequest() })
    expect((yield* readLog).filter(({ event }) => event._tag === "project.OwnerTaskNotificationPlanned")).toHaveLength(1)
    yield* api["project.archive"]({ requestId: freshRequest(), projectId: project.projectId })
    yield* api["project.archive"]({ requestId: freshRequest(), projectId: other.projectId })
  }))
})
