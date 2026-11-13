import { describe, it, expect } from "vitest"
import * as board from "../src/board.ts"
import { mapSnapshot } from "../src/mapping.ts"
import { engineSnapshot } from "./fixtures.ts"
import type { BoardPost, TaskHistoryEntry, Discovery, SetupState } from "@lgtm/contracts"
const section = engineSnapshot.project!

describe("the real project board", () => {
  it("derives all four columns from completion and task state, independently of phase", () => {
    const { completion: _, ...row } = section.sprints[0]!
    const sprint = { ...row, phase: "Build" as const }
    const task = { ...section.tasks[0]!, sprintId: sprint.sprintId }
    expect(board.sprintColumn(sprint, [])).toBe("Planned")
    expect(board.sprintColumn(sprint, [{ ...task, state: "review" }])).toBe("Review")
    for (const state of ["active", "blocked"] as const) expect(board.sprintColumn(sprint, [{ ...task, state }])).toBe("In progress")
    expect(board.sprintColumn({ ...sprint, completion: "Merged" }, [task])).toBe("Done")
  })
  it("preserves workspace and team identifiers without filling unsupported fields", () => {
    const before = JSON.stringify(engineSnapshot)
    const mapped = board.mapBoardRecords(engineSnapshot, mapSnapshot(engineSnapshot, 1))
    expect(mapped.projects[0]!.prefix).toBe("")
    expect(mapped.projects[0]!.tests).toBe("")
    expect(mapped.tasks[0]).toMatchObject({ worktreeId: section.tasks[0]!.worktreeId, points: null })
    expect(mapped.teams[0]).toMatchObject({ channelId: section.teams[0]!.channelId ?? null })
    expect(JSON.stringify(engineSnapshot)).toBe(before)
  })
  it("maps task history with no invented author and the actual worktree", () => {
    expect(board.mapTaskDetails([{ at: 10, title: "Assigned", detail: "Build the counter", state: "queue", sequence: 1 } as TaskHistoryEntry],
      { files: [{ path: "src/counter.ts" }] }, section.workspaces[0])).toMatchObject({
      files: ["src/counter.ts"], history: [{ ts: 10, who: null, text: "Assigned: Build the counter", state: "queue" }], branch: "trunk"
    })
  })
  it("sends the derived project name and the real repository union on the local machine", () => {
    expect(board.projectPayload({ repo: "rp-orchard", goal: "Count apples" }, "Apples")).toEqual({ name: "Apples", goal: "Count apples", machineId: "local", repository: { _tag: "existing", repoId: "rp-orchard" } })
    expect(board.projectPayload({ newRepo: "new-repo", goal: "Count apples" }, "Apples").repository).toEqual({ _tag: "new", name: "new-repo" })
  })
})
describe("messages", () => {
  it("links team and direct channels by membership and keeps their actual names", () => {
    const snapshot = { ...engineSnapshot, project: { ...section, teams: [{ ...section.teams[0]!, channelId: "ch-alpha" as never }] } }
    const mapped = board.mapBoardRecords(snapshot, mapSnapshot(snapshot, 1))
    const channels = board.mapChannels([{ channelId: "ch-alpha", name: "Team_internal", kind: "group", group: section.teams[0]!.group!, members: [] },
      { channelId: "direct", name: "Direct", kind: "direct", members: [{ _tag: "owner" }, { _tag: "agent", agentId: section.projects[0]!.leadAgentId }] }], mapped)
    expect(channels[0]).toMatchObject({ project: "pj-orchard", team: "tm-alpha", name: "Alpha team", kind: "team" })
    expect(channels[0]!.members).toContain("ag-worker")
    expect(channels[1]).toMatchObject({ project: "pj-orchard", kind: "dm", members: ["owner", "ag-lead"] })
  })
  it("takes post times only from envelopes and keeps engine status and service authors", () => {
    const post = { postId: "post", channelId: "channel", author: { _tag: "service", service: "foundry" }, text: "Waiting", to: [], reply: "all", sequence: 2, status: "closed", outcome: "withdrawn", acknowledged: [], dispositions: [] } as unknown as BoardPost
    expect(board.mapPost(post)).toMatchObject({ ts: null, kind: null, from: "service:foundry", closed: true, outcome: "withdrawn" })
    expect(board.mapPost(post, 123).ts).toBe(123)
  })
  it("takes unread counts only for the owner", () => {
    expect(board.mapUnread({ unread: [{ channelId: "c", member: { _tag: "owner" }, count: 7 }, { channelId: "c", member: { _tag: "agent" }, count: 99 }] })).toEqual({ c: 7 })
    expect(board.mapUnread(undefined)).toEqual({})
  })
  it("expands Everyone here into real addressees when a reply is wanted", () => {
    expect(board.postPayload({ channel: "c", text: " Hello ", action: "needs-reply", to: [] }, ["owner", "ag-worker"]))
      .toEqual({ channelId: "c", text: "Hello", reply: "any", to: [{ _tag: "agent", agentId: "ag-worker" }] })
    expect(board.postPayload({ channel: "c", text: "Reply", action: "fyi", to: ["owner"], replyTo: "p" }, [])).toMatchObject({ reply: "none", to: [{ _tag: "owner" }], replyTo: "p" })
  })
})
describe("setup and model choices", () => {
  it("keeps configured choice ids and an unavailable context empty", () => {
    expect(board.mapAgentDetails({ models: { source: "negotiated", options: [{ id: "model-id", label: "Model" }] }, efforts: { source: "unavailable", options: [] } })).toEqual({ models: [{ id: "model-id", label: "Model" }], efforts: [], context: null })
  })
  it("maps the saved setup step, repositories, settings and lead defaults", () => {
    const discovery = { state: "available", repositories: [{ name: "orchard", path: "/orchard" }], harnesses: [], truncated: false } as typeof Discovery.Type
    expect(board.mapSetup({ step: "found" } as SetupState, discovery, { workspaceFolder: "/work", shell: "zsh", displayName: "Owner" })).toMatchObject({ step: 1, completed: false, workspace: "/work", repositories: discovery.repositories, lead: null })
  })
})


describe("engine stall records", () => {
  it("uses current roles actions and clears a stall only after its durable end", () => {
    const roles = (ended: number) => ({ agents: { items: [{ agentId: "ag-worker", actions: [
      { _tag: "roles.StallSeen", sequence: 10, stalledPostId: "post" }, { _tag: "roles.StallEnded", sequence: ended }
    ] }] } })
    expect(board.mapStalls(roles(9))).toEqual({ agents: ["ag-worker"], posts: ["post"] })
    expect(board.mapStalls(roles(11))).toEqual({ agents: [], posts: [] })
    expect(board.mapStalls(undefined)).toEqual({ agents: [], posts: [] })
  })
})
