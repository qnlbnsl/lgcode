// Pure adapters for Home, agent conversations, and the roster. The JavaScript screens
// receive these functions from live.ts; the standalone mock never loads this module.
import type { ClientRequest, EventEnvelope, ContextUsage, AgentChoices, AgentConfiguration, ContextReference } from "@lgtm/contracts"
import { groupThreadItems, toolText } from "@lgtm/contracts/thread"
import { mapRequest, type StoreAgent } from "./mapping.ts"

export function mapHomeRequest(row: ClientRequest, agents: ReadonlyArray<StoreAgent>, source?: EventEnvelope) {
  const base = mapRequest(row, row.kind === "permission" ? "approval" : "question", agents)
  if (!base) return undefined
  const event = source?.sequence === row.sourceSequence ? source.event : undefined
  const question = event?._tag === "QuestionAsked" && event.questionId === row.id && event.agentId === row.agentId ? event : undefined
  const permission = event?._tag === "PermissionRequested" && event.permissionRequestId === row.id && event.agentId === row.agentId ? event : undefined
  const options = permission?.options ?? row.display?.options ?? []
  const proposed = question?.proposedAnswer ?? row.display?.proposedAnswer
  const input = permission?.toolInput
  const command = input && typeof input === "object" && "command" in input && typeof input.command === "string" ? input.command : null
  return { ...base, sourceSequence: row.sourceSequence, status: row.status, canAnswer: row.canAnswer,
    sprint: row.sprintId ?? question?.sprintId ?? permission?.sprintId ?? null,
    project: row.projectId ?? base.project, task: row.taskId ?? base.task,
    title: question?.title ?? base.title, body: question?.text ?? permission?.description ?? base.body,
    recommendation: question?.recommendation ?? base.recommendation, command,
    blind: row.display?.inputAvailable === false || row.display?.inputRedacted === true,
    options: row.kind === "question" ? (proposed ? [{ id: "proposed", label: proposed, primary: true }] : [])
      : options.map((o) => ({ id: o.id, label: o.name, primary: o.kind === "allow_once" })),
    answer: row.answer ?? options.find((o) => o.id === row.optionId)?.name ?? row.optionId ?? row.reason ?? "",
    answeredAt: row.answeredAt ?? null }
}

export function mapFailedStart(agent: StoreAgent) {
  if (!agent.failure) return undefined
  return { id: `failed:${agent.id}`, kind: "failed", agent: agent.id, project: agent.project, task: null,
    title: `${agent.name} failed to start`, body: agent.failure.reason, createdAt: agent.startedAt,
    status: "open", heldBy: null, options: [], command: null, folder: "", tool: null, recommendation: null }
}

export function contextLabel(reference: ContextReference): string {
  return reference._tag === "file" ? reference.path : reference.taskId
}

export function mapThread(items: ReadonlyArray<EventEnvelope>, agentId: string) {
  let pending = false
  let delivery: string | undefined
  let lastOutputAt: number | null = null
  let runMode: string | null = null
  const rows: Array<Record<string, unknown>> = []
  for (const item of groupThreadItems(items)) {
    const e = item.event
    if (!("agentId" in e) || e.agentId !== agentId) continue
    if (e._tag === "AgentStarted") runMode = e.runMode
    const base = { id: String(item.sequence), ts: item.occurredAt }
    if (e._tag === "DeliverySent") { pending = true; delivery = e.deliveryId }
    if (e._tag === "StateChanged" && e.state._tag !== "working"
      || ["TurnEnded", "AgentStopped", "AgentInterrupted", "AgentCrashed", "AgentReloadFailed"].includes(e._tag)
      || (e._tag === "DeliveryReturned" || e._tag === "DeliveryRequeued" || e._tag === "DeliveryHeld") && e.deliveryId === delivery) pending = false
    if (e._tag === "PromptSent") rows.push({ ...base, type: "user", text: e.text,
      ...(e.sender._tag === "agent" ? { from: e.sender.agentId } : {}), context: e.context?.map(contextLabel) ?? [] })
    else if (e._tag === "ThreadItem") {
      lastOutputAt = Math.max(lastOutputAt ?? 0, item.occurredAt)
      const c = e.content
      if (c._tag === "text") rows.push({ ...base, type: "agent", text: c.text })
      else if (c._tag === "tool-call") rows.push({ ...base, type: "tools", summary: c.title,
        lines: [{ verb: c.status ?? "", arg: c.input ? toolText(c.input) : "", res: c.output ? toolText(c.output) : "" }] })
      else if (c._tag === "plan") rows.push({ ...base, type: "agent", text: c.entries.map((p) => `${p.status}: ${p.content}`).join("\n") })
      else rows.push({ ...base, type: "agent", text: `${c.path}\n\n${c.diff}` })
    } else if (e._tag === "QuestionAsked" || e._tag === "PermissionRequested") rows.push({ ...base, type: "request", requestId: e._tag === "QuestionAsked" ? e.questionId : e.permissionRequestId })
    else if (e._tag === "TurnEnded" && e.stopped) rows.push({ ...base, type: "note", text: "This reply stopped." })
    else if (e._tag === "AgentStopped") rows.push({ ...base, type: "note", text: "The agent stopped." })
  }
  // The first delta owns the display identity, but the last delta owns the output time.
  for (const item of items) if (item.event._tag === "ThreadItem" && item.event.agentId === agentId) lastOutputAt = Math.max(lastOutputAt ?? 0, item.occurredAt)
  return { items: rows, pending, lastOutputAt, runMode }
}

export function mapAgentDetails(reply: { context?: ContextUsage; configuration?: AgentConfiguration; models?: AgentChoices["models"]; efforts?: AgentChoices["efforts"] }) {
  return { ...reply.configuration?.desired, context: reply.context?._tag === "available" ? reply.context.percent : null,
    contextReason: reply.context?._tag === "unavailable" ? reply.context.reason : null,
    configuration: reply.configuration ?? null, models: reply.models?.options ?? [], efforts: reply.efforts?.options ?? [] }
}

export function mapRosterDetails(agent: StoreAgent, tasks: ReadonlyArray<{ owner: string; label: string; state: string }>, actions: ReadonlyArray<{ _tag: string; agentId: string; sequence: number }>) {
  const stall = actions.filter((a) => a.agentId === agent.id && ["roles.StallSeen", "roles.StallEnded"].includes(a._tag)).sort((a, b) => b.sequence - a.sequence)[0]
  return { workState: agent.state === "idle" ? "ready" : agent.workState, task: tasks.find((t) => t.owner === agent.id && !["done", "cancelled"].includes(t.state))?.label ?? null,
    stalled: stall?._tag === "roles.StallSeen" }
}

export function mapPhoneOffer(settings: { carrier: { _tag: string }; pushPromptDismissed?: boolean }) {
  return { phoneOffer: settings.pushPromptDismissed || settings.carrier._tag !== "none" ? "declined" : "open" }
}
