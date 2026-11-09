import { randomBytes } from "node:crypto"
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as SqlClient from "effect/sql/SqlClient"
import { afterEach, beforeEach, expect, vi } from "vitest"
import * as Server from "../../src/api/server.ts"
import { projectView, projectKey } from "../../src/project/view.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { connect } from "../support/socketClient.ts"
import { boardState, provideBoard, snapshot } from "../board/wakeFixtures.ts"
import { appendSetup, eventOf, freshRequest, makeRig, readLog, removeRig, seedAccount, seedAgent, seedHarness, type Rig } from "../support/handlerRig.ts"

const git = (folder: string, ...args: string[]) => execFileSync("git", ["-C", folder, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
let rig: Rig
beforeEach(() => {
  rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGCODE_HOME", rig.stateFolder)
  git(rig.work, "init", "-b", "main")
  git(rig.work, "-c", "user.name=Test", "-c", "user.email=test@example.test", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Initialize")
})
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig) })
const foundation = () => Effect.gen(function* () {
  yield* registerRebuildCheck(); yield* seedAccount(); yield* seedHarness()
  const lead = yield* seedAgent({ id: "review-lead", folder: rig.work })
  const member = yield* seedAgent({ id: "review-member", parent: "review-lead" })
  const bearer = randomBytes(32).toString("base64url"), socket = join(rig.stateFolder, "review.sock")
  yield* Server.serve({ socketPath: socket, ownerCredential: Redacted.make(bearer), debug: false })
  const owner = yield* connect(socket, bearer), agent = yield* connect(socket, member.token)
  yield* owner["project.settings.set"]({ requestId: freshRequest(), settings: { workspaceFolder: rig.root, shell: "sh" } as never })
  const repoId = (yield* owner["project.repository.add"]({ requestId: freshRequest(), name: "Actual repository" as never, path: rig.work as never, machineId: "local" as never })).repoId
  const worktreeId = (yield* owner["project.workspace.register"]({ requestId: freshRequest(), repoId, machineId: "local" as never, branch: "main" as never, path: rig.work as never, checkout: "main" })).worktreeId
  // Only the historical project/agent fixture is seeded. Both team creations,
  // every workspace registration, mock recording and all reads use real sockets.
  const projectId = "review-project" as never
  yield* appendSetup([eventOf({ _tag: "project.Created", projectId, name: "Review", goal: "Reproduce the exact source findings", repoId, worktreeId, leadAgentId: lead.agentId, machineId: "local" })])
  return { owner, agent, repoId, worktreeId, projectId, lead }
})
const receipts = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return yield* sql`SELECT caller, request_id, body_hash, result_json, first_sequence FROM receipts ORDER BY caller, request_id`
})

for (const firstArea of [undefined, "API"] as const) {
  it.live(`admits an area-less Build team ${firstArea === undefined ? "before" : "after"} an area-labelled peer, retaining names, channels and receipts`, () => provideBoard(rig, Effect.gen(function* () {
    const f = yield* foundation()
    const firstRequest = { requestId: freshRequest(), projectId: f.projectId, name: "Ignored" as never, worktreeId: f.worktreeId,
      stage: "build" as const, ...(firstArea === undefined ? {} : { area: firstArea as never }) }
    const first = yield* f.owner["project.team.create"](firstRequest)
    const firstLog = yield* readLog
    expect(yield* f.owner["project.team.create"](firstRequest)).toEqual(first)
    expect(yield* readLog).toEqual(firstLog)
    expect((yield* f.owner["project.team.create"]({ ...firstRequest, area: "Changed" as never }).pipe(Effect.result))._tag).toBe("Failure")
    const childPath = join(rig.root, "web-team")
    git(rig.work, "worktree", "add", "-b", "review-web", childPath)
    const child = yield* f.owner["project.workspace.register"]({ requestId: freshRequest(), repoId: f.repoId, machineId: "local" as never,
      branch: "review-web" as never, path: childPath as never, checkout: "worktree", parentId: f.worktreeId })
    const secondRequest = { requestId: freshRequest(), projectId: f.projectId, name: "Ignored" as never, worktreeId: child.worktreeId,
      stage: "build" as const, ...(firstArea === undefined ? { area: "Web" as never } : {}) }
    const beforeSecond = yield* readLog
    const second = yield* f.owner["project.team.create"](secondRequest)
    const afterSecond = yield* readLog
    expect(afterSecond.slice(beforeSecond.length).map((row) => row.event._tag)).toEqual(["project.TeamAdded", "board.ChannelOpened"])
    expect(yield* f.owner["project.team.create"](secondRequest)).toEqual(second)
    expect(yield* readLog).toEqual(afterSecond)
    const state = yield* snapshot, teams = projectView(state).teams, board = yield* boardState
    const rows = [first, second].map((reply) => teams[projectKey(f.projectId, reply.teamId)]!)
    expect(rows.map((row) => row.name)).toEqual(firstArea === undefined ? ["Build", "Build · Web"] : ["Build · API", "Build"])
    for (const [index, reply] of [first, second].entries()) {
      expect(rows[index]).toMatchObject({ stage: "build", group: `team:${f.projectId}/${reply.teamId}`, channelId: reply.channelId })
      expect(board.channels[reply.channelId]).toMatchObject({ kind: "group", group: reply.group, anchorAgentId: f.lead.agentId })
    }
    expect(Object.hasOwn(rows[firstArea === undefined ? 0 : 1]!, "area")).toBe(false)
    expect(rows[firstArea === undefined ? 1 : 0]!.area).toBe(firstArea ?? "Web")
    // Use a third unclaimed real worktree, so duplicate-name refusals cannot
    // accidentally pass at the earlier workspace-ownership guard.
    const extraPath = join(rig.root, "third-team")
    git(rig.work, "worktree", "add", "-b", "review-third", extraPath)
    const extra = yield* f.owner["project.workspace.register"]({ requestId: freshRequest(), repoId: f.repoId, machineId: "local" as never,
      branch: "review-third" as never, path: extraPath as never, checkout: "worktree", parentId: f.worktreeId })
    for (const area of [undefined, firstArea === undefined ? "web" : "api"]) {
      const before = yield* readLog
      const refused = yield* f.owner["project.team.create"]({ requestId: freshRequest(), projectId: f.projectId, name: "Ignored" as never,
        worktreeId: extra.worktreeId, stage: "build", ...(area === undefined ? {} : { area: area as never }) }).pipe(Effect.result)
      expect(refused._tag).toBe("Failure")
      expect((yield* readLog).slice(before.length).map((row) => row.event)).toEqual([
        { _tag: "CommandRefused", command: "project.team.create", reason: "team name already exists" }
      ])
      expect(projectView(yield* snapshot).teams).toEqual(teams)
    }
    const legacy = yield* f.owner["project.team.create"]({ requestId: freshRequest(), projectId: f.projectId, name: "Independent" as never, worktreeId: extra.worktreeId })
    const legacyRow = projectView(yield* snapshot).teams[projectKey(f.projectId, legacy.teamId)]!
    expect(legacyRow.name).toBe("Independent")
    expect(Object.hasOwn(legacyRow, "stage")).toBe(false); expect(Object.hasOwn(legacyRow, "area")).toBe(false)
  })))
}

for (const actor of ["owner", "member"] as const) for (const available of [true, false]) {
  const label = `${actor}-${available ? "available" : "unavailable"}`
  it.live(`the final wrapped ${label} artifact reply must fit 256 KiB`, () => provideBoard(rig, Effect.gen(function* () {
    const f = yield* foundation(), path = available ? "artifact.html" : "missing.html"
    if (available) writeFileSync(join(rig.work, path), "<p>Real artifact</p>")
    const recorded = yield* f.agent["project.mocks.record"]({ requestId: freshRequest(), projectId: f.projectId,
      bundle: { sources: [{ sourceId: "page", worktreeId: f.worktreeId, path, kind: "screens" }], screens: [], scenarios: [], draftedFields: [], components: [] } as never })
    const client = actor === "owner" ? f.owner : f.agent
    const before = yield* snapshot, beforeLog = yield* readLog, beforeReceipts = yield* receipts
    const payload = { projectId: f.projectId, revisionId: recorded.revisionId, sourceId: "page" as never }
    const control = yield* client["project.mocks.artifact"]({ ...payload, requestId: freshRequest() })
    expect(Buffer.byteLength(JSON.stringify(control))).toBeLessThanOrEqual(256 * 1024)
    if ("result" in control) expect(control.result).toMatchObject({ _tag: available ? "available" : "unavailable" })
    else {
      expect(control.data).toContain("Data from another agent")
      expect(control.data).toContain(available ? "Real artifact" : "artifact unavailable")
    }
    const requestId = '"'.repeat(140_000), request = { ...payload, requestId: requestId as never }
    const outcome = yield* client["project.mocks.artifact"](request).pipe(Effect.result)
    const replyBytes = outcome._tag === "Success" ? Buffer.byteLength(JSON.stringify(outcome.success)) : undefined
    const after = yield* snapshot, afterLog = yield* readLog, afterReceipts = yield* receipts
    expect(afterLog).toEqual(beforeLog); expect(afterReceipts).toEqual(beforeReceipts); expect(after).toEqual(before)
    expect(outcome._tag).toBe("Failure")
    if (outcome._tag === "Failure") expect(outcome.failure).toEqual({ _tag: "CommandError", requestId, reason: "command refused" })
    // Keep the original byte-budget invariant alongside the strict refusal.
    if (outcome._tag === "Success") expect(replyBytes).toBeLessThanOrEqual(256 * 1024)
  })))
}
