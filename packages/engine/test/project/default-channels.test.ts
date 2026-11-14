import { createHash } from "node:crypto"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Fiber from "effect/Fiber"
import { afterEach, beforeEach, expect, vi } from "vitest"
import * as Schema from "effect/Schema"
import { AgentId, type BoardView } from "@lgtm/contracts"
import * as defaults from "../../src/project/defaultChannels.ts"
import { withBoardEnabled } from "../../src/board/switch.ts"
import { boardReactor } from "../../src/board/reactor.ts"
import { channelMembers } from "../../src/board/access.ts"
import { checkPieceBatch } from "../../src/commands/pieceBatch.ts"
import { engineLists } from "../../src/pieces/lists.ts"
import { project } from "../../src/routing/waits.ts"
import { provideBoard } from "../board/wakeFixtures.ts"
import { decisionProject, decisionSetup } from "../support/projectDecisionFixtures.ts"
import { registerRebuildCheck } from "../support/rebuildCheck.ts"
import { snapshot, eventually } from "../support/routingRig.ts"
import { agentCredential, call, failureOf, ownerCredential, startPayload, success, appendSetup, eventOf, makeRig, readLog, removeRig, seedAgent, type Rig } from "../support/handlerRig.ts"

let rig: Rig
beforeEach(() => { rig = makeRig(); vi.stubEnv("HOME", rig.home); vi.stubEnv("LGTM_HOME", rig.stateFolder) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); removeRig(rig) })
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
  const scan = vi.spyOn(defaults, "defaultProjectChannelEvents")
  yield* boardReactor.pipe(Effect.forkScoped)
  expect(yield* eventually(Effect.sync(() => scan.mock.calls.length), (count) => count > 0)).toBeGreaterThan(0)
  expect(scan.mock.results.every((result) => result.type === "return" && result.value.length === 0)).toBe(true)
  expect((yield* readLog).length).toBe(count)
  expect(channels(yield* snapshot).find((c) => c.channelId === general.channelId)?.name).toBe("Project_discussion")
})))

const startChild = (credential: Parameters<typeof call>[0], role: string, groups: unknown[] = []) =>
  call(credential, "start", startPayload(rig, { name: "Agent", role, groups })).pipe(Effect.map(success))
const member = (agentId: string) => ({ _tag: "agent", agentId })
const hasMember = (state: Effect.Success<typeof snapshot>, channelId: string, agentId: string) =>
  channelMembers(state, channelId as never).some((m) => m._tag === "agent" && m.agentId === agentId)
const waitMember = (channelId: string, agentId: string) => eventually(snapshot, (s) => hasMember(s, channelId, agentId))
  .pipe(Effect.tap((s) => Effect.sync(() => expect(hasMember(s, channelId, agentId)).toBe(true))))

it.live("starts real lead roles and variants, and excludes workers and a second project's agents after a completed sync", () => provideBoard(rig, (runner) => Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* decisionSetup(), other = yield* decisionProject("two")
  yield* boardReactor.pipe(Effect.forkScoped)
  const lead = yield* startChild(f.leadCredential, "lead", [f.team.group])
  const variant = yield* startChild(f.leadCredential, "lead:build", [f.team.group])
  const nested = yield* startChild(agentCredential(Redacted.value(runner.callsOf("start").find((c) => c.input.agentId === lead.agentId)!.input.token)), "worker")
  const outsider = yield* startChild(other.leadCredential, "lead", [f.team.group])
  yield* startChild(f.leadCredential, "lead:design")
  yield* startChild(f.leadCredential, "lead", [other.team.group])
  const unknown = yield* startChild(f.leadCredential, "team-lead", [f.team.group])
  const sentinel = yield* startChild(f.leadCredential, "worker")
  const [general, leads] = defaults.openDefaultProjectChannels({ projectId: f.projectId as never, leadAgentId: f.leadId as never })
  const state = yield* waitMember(general!.channelId, sentinel.agentId as string)
  expect(channelMembers(state, general!.channelId)).toEqual(expect.arrayContaining([member(lead.agentId as string), member(variant.agentId as string), member(nested.agentId as string)]))
  expect(channelMembers(state, leads!.channelId)).toEqual([{ _tag: "owner" }, member(f.leadId), member(lead.agentId as string), member(variant.agentId as string)])
  expect(hasMember(state, general!.channelId, outsider.agentId as string)).toBe(false)
  expect(hasMember(state, leads!.channelId, unknown.agentId as string)).toBe(false)
})))

it.live("honors owner removals after a later sync and a signalled reactor restart", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* decisionSetup()
  const reactor = yield* boardReactor.pipe(Effect.forkScoped)
  const lead = yield* startChild(f.leadCredential, "lead", [f.team.group])
  const [general, leads] = defaults.openDefaultProjectChannels({ projectId: f.projectId as never, leadAgentId: f.leadId as never })
  yield* waitMember(general!.channelId, lead.agentId as string)
  for (const channel of [general!, leads!]) success(yield* call(ownerCredential, "board.members", { channelId: channel.channelId, add: [], remove: [lead.agentId, f.leadId] }))
  const sentinel = yield* startChild(f.leadCredential, "worker")
  yield* waitMember(general!.channelId, sentinel.agentId as string)
  yield* Fiber.interrupt(reactor)
  const before = (yield* readLog).length
  const scan = vi.spyOn(defaults, "defaultProjectChannelEvents")
  yield* boardReactor.pipe(Effect.forkScoped)
  expect(yield* eventually(Effect.sync(() => scan.mock.calls.length), (n) => n > 0)).toBeGreaterThan(0)
  expect(scan.mock.results.every((result) => result.type === "return" && result.value.length === 0)).toBe(true)
  expect((yield* readLog).length).toBe(before)
  for (const channel of [general!, leads!]) {
    expect(hasMember(yield* snapshot, channel.channelId, lead.agentId as string)).toBe(false)
    expect(hasMember(yield* snapshot, channel.channelId, f.leadId)).toBe(false)
  }
})))

it.live("omits stopped and crashed agents, including an inactive project lead, during backfill", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* decisionSetup()
  yield* seedAgent({ id: "stopped-child", parent: f.leadId, state: "stopped" })
  yield* seedAgent({ id: "crashed-child", parent: f.leadId, state: "crashed" })
  yield* appendSetup([eventOf({ _tag: "AgentStopped", agentId: f.leadId })])
  const scan = vi.spyOn(defaults, "defaultProjectChannelEvents")
  yield* boardReactor.pipe(Effect.forkScoped)
  expect(yield* eventually(Effect.sync(() => scan.mock.calls.length), (n) => n > 0)).toBeGreaterThan(0)
  const state = yield* eventually(snapshot, (s) => channels(s).filter((c) => c.kind === "plain").length === 2)
  expect(channels(state).filter((c) => c.kind === "plain")).toHaveLength(2)
  for (const channel of channels(state).filter((c) => c.kind === "plain")) {
    expect(channel.members).not.toContainEqual(member(f.leadId))
    expect(channel.members).not.toContainEqual(member("stopped-child"))
    expect(channel.members).not.toContainEqual(member("crashed-child"))
  }
})))

it.live("neither opens nor adds members while a project is archived or archiving", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* decisionSetup()
  const original = yield* snapshot
  for (const tag of ["project.Archived", "project.ArchiveStarted"] as const) {
    const event = eventOf({ _tag: tag, projectId: f.projectId })
    const archived = project(original, [event], engineLists)
    expect(defaults.defaultProjectChannelEvents(archived)).toEqual([])
    yield* seedAgent({ id: `late-${tag}`, parent: f.leadId, state: "idle" })
    const opened = project(yield* snapshot, defaults.defaultProjectChannelEvents(original), engineLists)
    // The same snapshot would add the late descendant while the project is active.
    expect(defaults.defaultProjectChannelEvents(opened).some((e) => e._tag === "board.ChannelMembersChanged"
      && e.membersAdded.some((m) => m._tag === "agent" && m.agentId === `late-${tag}`))).toBe(true)
    expect(defaults.defaultProjectChannelEvents(project(opened, [event], engineLists))).toEqual([])
  }
})))

it.live("caps backfilled channels and writes each skipped admission once as an owner-visible service post", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  const f = yield* decisionSetup()
  for (let i = 0; i < 64; i++) yield* seedAgent({ id: `worker-${i}`, parent: f.leadId, state: "idle" })
  const reactor = yield* boardReactor.pipe(Effect.forkScoped)
  const general = defaults.openDefaultProjectChannels({ projectId: f.projectId as never, leadAgentId: f.leadId as never })[0]!
  const state = yield* eventually(snapshot, (s) => Object.values((s.board as BoardView).posts).some((p) => p.channelId === general.channelId))
  expect(channelMembers(state, general.channelId)).toHaveLength(64)
  const notices = Object.values((state.board as BoardView).posts).filter((p) => p.channelId === general.channelId)
  expect(notices).toHaveLength(3)
  expect(notices.every((p) => p.author._tag === "service" && p.text.includes("64") && p.reply === "none")).toBe(true)
  const fullChild = yield* startChild(f.leadCredential, "worker")
  const fullState = yield* eventually(snapshot, (s) => Object.values((s.board as BoardView).posts).filter((p) => p.channelId === general.channelId).length === 4)
  expect(channelMembers(fullState, general.channelId)).toHaveLength(64)
  expect(hasMember(fullState, general.channelId, fullChild.agentId as string)).toBe(false)
  const page = success(yield* call(ownerCredential, "board.peek", { channelId: general.channelId }))
  expect(page.items).toHaveLength(4)
  expect(JSON.stringify(page.items)).toContain(fullChild.agentId)
  success(yield* call(ownerCredential, "board.members", { channelId: general.channelId, add: [], remove: [f.workerId] }))
  const late = yield* startChild(f.leadCredential, "worker")
  yield* waitMember(general.channelId, late.agentId as string)
  yield* Fiber.interrupt(reactor)
  const before = (yield* readLog).length
  const scan = vi.spyOn(defaults, "defaultProjectChannelEvents")
  yield* boardReactor.pipe(Effect.forkScoped)
  expect(yield* eventually(Effect.sync(() => scan.mock.calls.length), (n) => n > 0)).toBeGreaterThan(0)
  expect(scan.mock.results.every((result) => result.type === "return" && result.value.length === 0)).toBe(true)
  expect((yield* readLog).length).toBe(before)
})))

it.live("refuses project creation and team creation before side effects when the board is disabled", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  yield* seedAgent({ id: "lead", state: "idle" })
  yield* appendSetup([eventOf({ _tag: "project.Created", projectId: "disabled-project", repoId: "repo", worktreeId: "workspace", leadAgentId: "lead", machineId: "local", name: "Project", goal: "Build" })])
  const f = { projectId: "disabled-project", worktreeId: "workspace" }
  const before = (yield* readLog).length
  expect(failureOf(yield* call(ownerCredential, "project.create", { repository: { _tag: "new", name: "Repository" }, name: "Project", goal: "Build", machineId: "local" }))?.reason).toBe("board disabled")
  expect(failureOf(yield* call(ownerCredential, "project.team.create", { projectId: f.projectId, name: "Other", worktreeId: f.worktreeId }))?.reason).toBe("board disabled")
  expect((yield* readLog).slice(before).every((row) => row.event._tag === "CommandRefused")).toBe(true)
}), [], { lists: withBoardEnabled(engineLists, false) }))

it.live("permits exactly a new project's default channel batch and rejects every unrelated board write", () => provideBoard(rig, Effect.gen(function* () {
  yield* registerRebuildCheck()
  yield* decisionSetup()
  const state = yield* snapshot
  const created = eventOf({ _tag: "project.Created", projectId: "new-project", repoId: "one-repo", worktreeId: "one-workspace", leadAgentId: "one-lead", machineId: "local", name: "Project", goal: "Plan" })
  const defaults = ["General", "Leads"].map((name) => eventOf({ _tag: "board.ChannelOpened", channelId: `project-default:${createHash("sha256").update(JSON.stringify(["new-project", name.toLowerCase()])).digest("hex")}`, name, kind: "plain", manager: { _tag: "owner" }, opener: { _tag: "owner" }, anchorAgentId: "one-lead", members: [{ _tag: "owner" }, { _tag: "agent", agentId: "one-lead" }] }))
  const check = (events: typeof defaults, caller: Parameters<typeof checkPieceBatch>[3] = { _tag: "owner" }, s = state) => checkPieceBatch("project", s, { events }, caller, engineLists).pipe(Effect.result)
  expect((yield* check([created, ...defaults]))._tag).toBe("Success")
  expect((yield* checkPieceBatch("project", state, { events: [created, ...defaults] }, { _tag: "owner" }, withBoardEnabled(engineLists, false)).pipe(Effect.result))._tag).toBe("Failure")
  const variants = [defaults, [created, defaults[0]!], [created, ...defaults, defaults[0]!], [created, ...defaults, eventOf({ _tag: "board.ChannelOpened", channelId: "arbitrary", name: "Other", kind: "plain", opener: { _tag: "owner" }, manager: { _tag: "owner" }, members: [] })]]
  for (const fields of [{ opener: { _tag: "agent", agentId: "one-lead" } }, { name: "Other" }, { channelId: "arbitrary" }, { anchorAgentId: "outsider" }, { members: [] }, { manager: { _tag: "agent", agentId: "one-lead" } }, { group: "foreign" }]) variants.push([created, eventOf({ ...defaults[0], ...fields }), defaults[1]!])
  for (const events of variants) expect((yield* check(events))._tag).toBe("Failure")
  expect((yield* check([created, ...defaults], { _tag: "agent", agentId: Schema.decodeUnknownSync(AgentId)("one-lead") }))._tag).toBe("Failure")
  for (const caller of [undefined, { _tag: "service", service: "project" }, { _tag: "piece", namespace: "project" }] as const) {
    expect((yield* checkPieceBatch("project", state, { events: [created, ...defaults] }, caller, engineLists).pipe(Effect.result))._tag).toBe("Failure")
  }
  expect((yield* check([created, ...defaults], undefined, project(state, [created, ...defaults], engineLists)))._tag).toBe("Failure")
})))
