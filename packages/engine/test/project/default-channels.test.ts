import { createHash } from "node:crypto"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { afterEach, beforeEach, expect, vi } from "vitest"
import * as Schema from "effect/Schema"
import { AgentId, type BoardView } from "@lgtm/contracts"
import { boardReactor } from "../../src/board/reactor.ts"
import { channelMembers } from "../../src/board/access.ts"
import { checkPieceBatch } from "../../src/commands/pieceBatch.ts"
import { engineLists } from "../../src/pieces/lists.ts"
import { project } from "../../src/routing/waits.ts"
import { provideBoard } from "../board/wakeFixtures.ts"
import { decisionSetup } from "../support/projectDecisionFixtures.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { snapshot, eventually } from "../support/routingRig.ts"
import { appendSetup, eventOf, makeRig, readLog, removeRig, seedAgent, type Rig } from "../support/handlerRig.ts"

let rig: Rig
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder) })
afterEach(() => { vi.unstubAllEnvs(); removeRig(rig) })
const channels = (state: Effect.Success<typeof snapshot>) => Object.values((state.board as BoardView).channels)

it.live("backfills only missing defaults on startup, preserves events and names, and is idempotent on restart", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* decisionSetup()
  yield* appendSetup([eventOf({ _tag: "board.ChannelOpened",
    channelId: `project-default:${createHash("sha256").update(JSON.stringify([f.projectId, "general"])).digest("hex")}`,
    name: "General", kind: "plain", opener: { _tag: "owner" }, manager: { _tag: "owner" }, anchorAgentId: f.leadId,
    members: [{ _tag: "owner" }, { _tag: "agent", agentId: f.leadId }] })])
  const before = yield* readLog
  const reactor = yield* boardReactor.pipe(Effect.forkScoped)
  const state = yield* eventually(snapshot, (s) => channels(s).some((c) => c.name === "Leads"))
  expect(channels(state).map((c) => c.name)).toEqual(expect.arrayContaining(["General", "Leads"]))
  expect((yield* readLog).slice(0, before.length)).toEqual(before)
  expect((yield* readLog).slice(before.length).filter((row) => row.event._tag === "board.ChannelOpened")).toHaveLength(1)
  expect(channelMembers(state, f.team.channelId)).toContainEqual({ _tag: "agent", agentId: f.workerId })
  const general = channels(state).find((c) => c.name === "General")!
  yield* appendSetup([eventOf({ _tag: "board.ManagerChanged", channelId: general.channelId, manager: { _tag: "owner" }, name: "Project_discussion" })])
  yield* Fiber.interrupt(reactor)
  const count = (yield* readLog).length
  yield* boardReactor.pipe(Effect.forkScoped)
  yield* Effect.sleep("100 millis")
  expect((yield* readLog).length).toBe(count)
  expect(channels(yield* snapshot).find((c) => c.channelId === general.channelId)?.name).toBe("Project_discussion")
})))

it.live("adds project descendants to General and team leads to Leads without admitting workers or outsiders to Leads", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* decisionSetup()
  yield* boardReactor.pipe(Effect.forkScoped)
  yield* eventually(snapshot, (s) => channels(s).some((c) => c.name === "Leads"))
  yield* appendSetup([eventOf({ _tag: "AgentStarted", agentId: "team-lead", name: "Team lead", parent: { _tag: "agent", agentId: f.leadId }, role: "team-lead", groups: [f.team.group], harness: "first", account: "primary", permission: "ask", folder: rig.work, runMode: "acp" })])
  yield* seedAgent({ id: "nested-worker", parent: "team-lead", state: "idle" })
  yield* appendSetup([eventOf({ _tag: "AgentStarted", agentId: "outsider", name: "Team lead", parent: { _tag: "owner" }, role: "team-lead", groups: [f.team.group], harness: "first", account: "primary", permission: "ask", folder: rig.work, runMode: "acp" })])
  const state = yield* eventually(snapshot, (s) => channels(s).some((c) => c.name === "General" && c.members.some((m) => m._tag === "agent" && m.agentId === "nested-worker")))
  const general = channels(state).find((c) => c.name === "General")!, leads = channels(state).find((c) => c.name === "Leads")!
  expect(channelMembers(state, general.channelId)).toEqual(expect.arrayContaining([{ _tag: "owner" }, { _tag: "agent", agentId: f.leadId }, { _tag: "agent", agentId: f.workerId }, { _tag: "agent", agentId: "team-lead" }, { _tag: "agent", agentId: "nested-worker" }]))
  expect(channelMembers(state, leads.channelId)).toEqual([{ _tag: "owner" }, { _tag: "agent", agentId: f.leadId }, { _tag: "agent", agentId: "team-lead" }])
})))

it.live("permits exactly a new project's default channel batch and rejects every unrelated board write", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  yield* decisionSetup()
  const state = yield* snapshot
  const created = eventOf({ _tag: "project.Created", projectId: "new-project", repoId: "one-repo", worktreeId: "one-workspace", leadAgentId: "one-lead", machineId: "local", name: "Project", goal: "Plan" })
  const defaults = ["General", "Leads"].map((name) => eventOf({ _tag: "board.ChannelOpened", channelId: `project-default:${createHash("sha256").update(JSON.stringify(["new-project", name.toLowerCase()])).digest("hex")}`, name, kind: "plain", manager: { _tag: "owner" }, opener: { _tag: "owner" }, anchorAgentId: "one-lead", members: [{ _tag: "owner" }, { _tag: "agent", agentId: "one-lead" }] }))
  const check = (events: typeof defaults, caller: Parameters<typeof checkPieceBatch>[3] = { _tag: "owner" }, s = state) => checkPieceBatch("project", s, { events }, caller, engineLists).pipe(Effect.result)
  expect((yield* check([created, ...defaults]))._tag).toBe("Success")
  const variants = [defaults, [created, defaults[0]!], [created, ...defaults, defaults[0]!], [created, ...defaults, eventOf({ _tag: "board.ChannelOpened", channelId: "arbitrary", name: "Other", kind: "plain", opener: { _tag: "owner" }, manager: { _tag: "owner" }, members: [] })]]
  for (const fields of [{ opener: { _tag: "agent", agentId: "one-lead" } }, { name: "Other" }, { channelId: "arbitrary" }, { anchorAgentId: "outsider" }, { members: [] }, { manager: { _tag: "agent", agentId: "one-lead" } }, { group: "foreign" }]) variants.push([created, eventOf({ ...defaults[0], ...fields }), defaults[1]!])
  for (const events of variants) expect((yield* check(events))._tag).toBe("Failure")
  expect((yield* check([created, ...defaults], { _tag: "agent", agentId: Schema.decodeUnknownSync(AgentId)("one-lead") }))._tag).toBe("Failure")
  for (const caller of [undefined, { _tag: "service", service: "project" }, { _tag: "piece", namespace: "project" }] as const) {
    expect((yield* checkPieceBatch("project", state, { events: [created, ...defaults] }, caller, engineLists).pipe(Effect.result))._tag).toBe("Failure")
  }
  expect((yield* check([created, ...defaults], undefined, project(state, [created, ...defaults], engineLists)))._tag).toBe("Failure")
})))
