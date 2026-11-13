import { describe, expect, it } from "vitest"
import type { ClientRequest, EventEnvelope } from "@lgtm/contracts"
import { mapAgentDetails, mapFailedStart, mapHomeRequest, mapRosterDetails, mapThread, contextLabel } from "../src/chat.ts"
import { mapSnapshot } from "../src/mapping.ts"
import { engineSnapshot } from "./fixtures.ts"

const agents = mapSnapshot(engineSnapshot, 1).agents
const envelope = (sequence: number, event: object) => ({ sequence, occurredAt: sequence * 1000, event }) as EventEnvelope
const question = { ...engineSnapshot.questions[0], kind: "question", status: "open", canAnswer: true } as ClientRequest

describe("Home mapping", () => {
  it("uses full source text and proposed answer, preserves owner identity and task links", () => {
    const row = mapHomeRequest(question, agents, envelope(question.sourceSequence, {
      _tag: "QuestionAsked", agentId: question.agentId, questionId: question.id, title: "Release question", text: "Full question", proposedAnswer: "Use trunk", recommendation: "Keep one branch"
    }))!
    expect(row).toMatchObject({ title: "Release question", body: "Full question", options: [{ id: "proposed", label: "Use trunk", primary: true }], task: "tk-1", status: "open" })
  })
  it("does not associate a source with a different request or agent", () => {
    const row = mapHomeRequest(question, agents, envelope(question.sourceSequence, { _tag: "QuestionAsked", agentId: "other", questionId: question.id, text: "wrong" }))!
    expect(row.body).toBe("Long text")
    expect(row.options).toEqual([])
  })
  it("keeps harness option ids, complete options and answered labels", () => {
    const row = { ...engineSnapshot.requests[0], kind: "permission", status: "answered", canAnswer: false, optionId: "custom-yes", answeredAt: 99 } as ClientRequest
    const result = mapHomeRequest(row, agents, envelope(row.sourceSequence, { _tag: "PermissionRequested", permissionRequestId: row.id, agentId: row.agentId, description: "Run checks", toolInput: { command: "pnpm test" }, options: [{ id: "custom-yes", name: "Allow this check", kind: "allow_once" }, { id: "custom-no", name: "Refuse", kind: "reject_once" }] }))!
    expect(result).toMatchObject({ command: "pnpm test", body: "Run checks", status: "answered", answer: "Allow this check", answeredAt: 99, options: [{ id: "custom-yes", label: "Allow this check", primary: true }, { id: "custom-no", label: "Refuse", primary: false }] })
  })
  it("preserves cancellation and agent-held identity", () => {
    expect(mapHomeRequest({ ...question, status: "cancelled", holder: { _tag: "agent", agentId: "ag-lead" as never } }, agents)).toMatchObject({ status: "cancelled", heldBy: "ag-lead" })
  })
  it("derives failures from the roster only", () => {
    expect(mapFailedStart(agents.find((a) => a.id === "ag-failed")!)).toMatchObject({ kind: "failed", id: "failed:ag-failed", body: expect.any(String) })
    expect(mapFailedStart(agents[0]!)).toBeUndefined()
  })
})

describe("thread mapping", () => {
  it("folds deltas and tool updates, deduplicates replay, keeps last output and pending state", () => {
    const items = [envelope(1, { _tag: "DeliverySent", agentId: "ag-worker", deliveryId: "d1" }),
      envelope(2, { _tag: "ThreadItem", agentId: "ag-worker", itemId: "text", content: { _tag: "text", text: "Hello " } }),
      envelope(3, { _tag: "ThreadItem", agentId: "ag-worker", itemId: "text", content: { _tag: "text", text: "owner" } }),
      envelope(4, { _tag: "ThreadItem", agentId: "ag-worker", itemId: "tool", content: { _tag: "tool-call", callId: "c1", title: "Checks", input: "pnpm test" } }),
      envelope(5, { _tag: "ThreadItem", agentId: "ag-worker", itemId: "tool", content: { _tag: "tool-call", callId: "c1", title: "", status: "completed", output: "passed" } })]
    const result = mapThread([...items, items[2]!], "ag-worker")
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({ id: "2", text: "Hello owner" })
    expect(result.items[1]).toMatchObject({ summary: "Checks", lines: [{ verb: "completed", arg: "pnpm test", res: "passed" }] })
    expect(result).toMatchObject({ pending: true, lastOutputAt: 5000 })
    expect(mapThread([...items, envelope(6, { _tag: "TurnEnded", agentId: "ag-worker", stopped: true })], "ag-worker").pending).toBe(false)
  })
  it("renders owner and peer prompts, requests, plans and file changes as data", () => {
    const items = [envelope(1, { _tag: "PromptSent", agentId: "ag-worker", sender: { _tag: "owner" }, text: "hi" }),
      envelope(2, { _tag: "PromptSent", agentId: "ag-worker", sender: { _tag: "agent", agentId: "ag-lead" }, text: "handoff" }),
      envelope(3, { _tag: "QuestionAsked", agentId: "ag-worker", questionId: "q1" }),
      envelope(4, { _tag: "ThreadItem", agentId: "ag-worker", content: { _tag: "plan", entries: [{ content: "Build", status: "pending" }] } }),
      envelope(5, { _tag: "ThreadItem", agentId: "ag-worker", content: { _tag: "file-change", path: "src/a.ts", diff: "<script>data</script>" } })]
    const result = mapThread(items, "ag-worker")
    expect(result.items).toMatchObject([{ type: "user", text: "hi" }, { type: "user", from: "ag-lead" }, { type: "request", requestId: "q1" }, { type: "agent", text: "pending: Build" }, { text: "src/a.ts\n\n<script>data</script>" }])
    expect(mapThread(items, "other").items).toEqual([])
    expect(contextLabel({ _tag: "task", projectId: "p" as never, taskId: "t" as never })).toBe("t")
  })
  it("stops pending when a delivery is held or an agent becomes idle", () => {
    const start = envelope(1, { _tag: "DeliverySent", agentId: "ag-worker", deliveryId: "d" })
    expect(mapThread([start, envelope(2, { _tag: "DeliveryHeld", agentId: "ag-worker", deliveryId: "d" })], "ag-worker").pending).toBe(false)
    expect(mapThread([start, envelope(2, { _tag: "StateChanged", agentId: "ag-worker", state: { _tag: "idle" } })], "ag-worker").pending).toBe(false)
  })
})

it("maps per-agent choices and context without fabricating unavailable values", () => {
  expect(mapAgentDetails({ context: { _tag: "available", used: 25, window: 100, percent: 25, reportedAt: 1 as never }, models: { source: "negotiated", options: [{ id: "model-a", label: "Model A" }] } })).toMatchObject({ context: 25, models: [{ id: "model-a", label: "Model A" }] })
  expect(mapAgentDetails({ context: { _tag: "unavailable", reason: "not-live" } })).toMatchObject({ context: null, contextReason: "not-live", models: [] })
})
it("maps task ownership and the most recent stall decision", () => {
  const agent = agents.find((a) => a.id === "ag-worker")!
  const actions = [{ agentId: agent.id, sequence: 20, _tag: "roles.StallSeen" }, { agentId: agent.id, sequence: 22, _tag: "roles.StallEnded" }]
  expect(mapRosterDetails(agent, [{ owner: agent.id, label: "HR-11", state: "active" }], actions)).toEqual({ task: "HR-11", stalled: false })
  expect(mapRosterDetails(agent, [], actions.slice(0, 1))).toEqual({ task: null, stalled: true })
})
