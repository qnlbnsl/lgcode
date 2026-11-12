import { randomBytes } from "node:crypto"
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import type { MockBundle } from "@lgtm/contracts"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { afterEach, beforeEach, expect, vi } from "vitest"
import * as Server from "../../src/api/server.ts"
import { projectView } from "../../src/project/view.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { freshRequest, readLog } from "../support/handlerRig.ts"
import { connect } from "../support/socketClient.ts"
import { eventually, snapshot } from "../support/routingRig.ts"
import { accountFor, echoFile, harnessFor, makeRunnerRig, readEcho, removeRunnerRig, withEngine, writeFakeAdapter, type RunnerRig } from "../support/acpRunnerRig.ts"
let rig: RunnerRig
beforeEach(() => {
  rig = makeRunnerRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder)
  execFileSync("git", ["-C", rig.work, "init", "-b", "main"], { stdio: "ignore" })
})
afterEach(() => { vi.unstubAllEnvs(); removeRunnerRig(rig) })
it.live("delivers owner approval over the real authenticated engine and ACP child without spawning a scripted planning team", () => {
  const harness = harnessFor("cursor", writeFakeAdapter(rig)), echo = echoFile(rig)
  const account = accountFor(harness.id, { turns: [[], []] }, echo, { CURSOR_API_KEY: "secret:handoff" })
  return withEngine(rig, { harness, accounts: [account], secrets: { "secret:handoff": "synthetic-handoff-provider-key" } }, () => Effect.gen(function* () {
    yield* registerRebuildCheck()
    const bearer = randomBytes(32).toString("base64url")
    yield* Server.serve({ socketPath: rig.socket, ownerCredential: Redacted.make(bearer), debug: false })
    const api = yield* connect(rig.socket, bearer)
    yield* api["project.settings.set"]({ requestId: freshRequest(), settings: { workspaceFolder: rig.work, shell: "sh" } })
    const created = yield* api["project.create"]({ requestId: freshRequest(), name: "Review", goal: "Review actual artifacts", machineId: "local", repository: { _tag: "new", name: "Review repository" }, useWorktree: true })
    const view = projectView(yield* snapshot), project = view.projects[created.projectId]!, workspace = view.workspaces[project.worktreeId]!
    const peer = yield* readEcho(echo, (value) => value.inbound.some((frame) => frame.method === "session/prompt"))
    const settled = yield* eventually(snapshot, (state) => state.agents[project.leadAgentId]?.state._tag === "idle")
    expect(settled.agents[project.leadAgentId]?.state._tag).toBe("idle")
    writeFileSync(join(workspace.path, "review.html"), "<h1>Repository-authored screen</h1>")
    const lead = yield* connect(rig.socket, peer.env.LGTM_TOKEN!)
    const bundle: typeof MockBundle.Type = {
      sources: [{ sourceId: "screen" as never, worktreeId: workspace.worktreeId, path: "review.html", kind: "screens" }],
      screens: [{ screenId: "home" as never, sourceId: "screen" as never, name: "Home", route: "/home",
        scenarioRoutes: [{ scenarioId: "empty" as never, route: "/home?case=zero" }] },
        { screenId: "details" as never, sourceId: "screen" as never, name: "Details", route: "/details",
          scenarioRoutes: [{ scenarioId: "busy" as never, route: "/details?case=many" }] }],
      scenarios: [{ scenarioId: "empty" as never, name: "Empty", description: "No records" },
        { scenarioId: "busy" as never, name: "Busy", description: "Many records" },
        { scenarioId: "error" as never, name: "Error", description: "A failure" }], draftedFields: [], components: [] }
    const recorded = yield* lead["project.mocks.record"]({ requestId: freshRequest(), projectId: created.projectId, bundle })
    const approval = { requestId: freshRequest(), projectId: created.projectId, revisionId: recorded.revisionId }
    yield* api["project.mocks.approve"](approval); yield* api["project.mocks.approve"](approval)
    const delivered = yield* readEcho(echo, (value) => value.inbound.filter((frame) => frame.method === "session/prompt").length >= 2)
    const prompts = delivered.inbound.filter((frame) => frame.method === "session/prompt")
    expect(prompts).toHaveLength(2)
    expect(JSON.stringify(prompts[1])).toContain(recorded.revisionId)
    expect(JSON.stringify(prompts[1])).toContain("owner approved")
    expect(delivered.pid).toBe(peer.pid)
    const read = yield* lead["project.mocks.read"]({ requestId: freshRequest(), projectId: created.projectId })
    if (!("data" in read)) throw new Error("Lead read must use the agent envelope")
    const handed = JSON.parse(read.data.split("\n")[1]!)
    expect(handed.items[0].bundle).toEqual(bundle)
    expect(handed.approval).toMatchObject({ revisionId: recorded.revisionId, worklist: { screens: ["home", "details"] } })
    const log = yield* readLog
    expect(log.filter((row) => row.event._tag === "AgentStarted")).toHaveLength(1)
    expect(log.filter((row) => row.event._tag === "project.MockApproved")).toHaveLength(1)
    expect(log.some((row) => ["project.TeamAdded", "project.SprintAdded", "project.TaskAdded"].includes(row.event._tag))).toBe(false)
    expect(JSON.stringify(log)).not.toContain("synthetic-handoff-provider-key")
    yield* api["project.archive"]({ requestId: freshRequest(), projectId: created.projectId })
  }))
})
