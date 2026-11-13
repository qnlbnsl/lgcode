// Pure adapters for Home, agent conversations, and the roster. The JavaScript screens
// receive these functions from live.ts; the standalone mock never loads this module.
import type { ClientRequest, EventEnvelope, ContextUsage, AgentChoices, AgentConfiguration, ContextReference } from "@lgtm/contracts"
import { groupThreadItems, toolText } from "@lgtm/contracts/thread"
import { mapRequest, type StoreAgent, type StoreSubscription } from "./mapping.ts"

// A harness often names a permission request with the command itself. The card then says what
// is being attempted in plain words, and the command stays under "Details".
const scriptNames: Record<string, string> = { python: "Python", python3: "Python", node: "Node.js", bash: "shell", sh: "shell", zsh: "shell", ruby: "Ruby", perl: "Perl" }
export function attemptTitle(title: string, command: string | null, toolKind?: string | null): string {
  const first = (text: string) => text.split("\n").find((line) => line.trim() !== "")?.trim() ?? ""
  if (command === null) return title
  const whole = command
  // A backslash at the end of a line continues one command.
  command = command.replace(/\\\n\s*/g, " ")
  if (title !== "Permission request" && first(title) !== first(whole).slice(0, first(title).length)) return title
  const words = first(command).split(/\s+/).filter((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word))
  const program = (words[0] ?? "").split("/").at(-1) ?? ""
  const lines = command.trim().split("\n").length
  const script = scriptNames[program]
  if (script && (lines > 1 || words[1] === "-c" || words[1] === "-e")) return `Run a ${script} script${lines > 1 ? ` of ${lines} lines` : ""}`
  if (toolKind && toolKind !== "execute" && program === "") return title
  const more = /&&|\|\||;|\|/.test(command) || lines > 1
  return program ? `Run "${program}"${more ? " and other commands" : ""} in the terminal` : "Run a terminal command"
}
export function mapHomeRequest(row: ClientRequest, agents: ReadonlyArray<StoreAgent>, source?: EventEnvelope) {
  const base = mapRequest(row, row.kind === "permission" ? "approval" : "question", agents)
  if (!base) return undefined
  const event = source?.sequence === row.sourceSequence ? source.event : undefined
  const question = event?._tag === "QuestionAsked" && event.questionId === row.id && event.agentId === row.agentId ? event : undefined
  const permission = event?._tag === "PermissionRequested" && event.permissionRequestId === row.id && event.agentId === row.agentId ? event : undefined
  const options = permission?.options ?? row.display?.options ?? []
  const proposed = question?.proposedAnswer ?? row.display?.proposedAnswer
  const input = permission?.toolInput
  const kind = row.display?.toolKind ?? permission?.toolKind
  const cut = kind === "execute" && (permission?.inputTruncated ?? row.display?.inputTruncated) === true
  // The engine marks a very long command's input as cut, and it is then not a readable input.
  // The harness's description is the command in that case, and only in that case.
  const command = input && typeof input === "object" && "command" in input && typeof input.command === "string" ? input.command
    : cut && permission?.description ? permission.description : null
  const cwd = input && typeof input === "object" && "cwd" in input && typeof input.cwd === "string" ? input.cwd : null
  return { ...base, sourceSequence: row.sourceSequence, status: row.status, canAnswer: row.canAnswer,
    sprint: row.sprintId ?? question?.sprintId ?? permission?.sprintId ?? null,
    project: row.projectId ?? base.project, task: row.taskId ?? base.task,
    title: question?.title ?? (row.kind === "permission" ? attemptTitle(base.title, command ?? (cut && base.body ? base.body : null), kind) : base.title),
    body: question?.text ?? permission?.description ?? base.body,
    ...(cwd ? { folder: cwd } : {}),
    recommendation: question?.recommendation ?? base.recommendation, command,
    blind: row.display?.inputAvailable === false || row.display?.inputRedacted === true,
    options: row.kind === "question" ? (proposed ? [{ id: "proposed", label: proposed, primary: true }] : [])
      : options.map((o) => ({ id: o.id, label: o.name, kind: o.kind, primary: o.kind === "allow_once" })),
    answer: row.answer ?? options.find((o) => o.id === row.optionId)?.name ?? row.optionId ?? row.reason ?? (row.status === "cancelled" ? "Cancelled" : ""),
    answerKind: options.find((o) => o.id === row.optionId)?.kind ?? null,
    answeredAt: row.answeredAt ?? null }
}

export function mapFailedStart(agent: StoreAgent) {
  if (!agent.failure) return undefined
  return { id: `failed:${agent.id}`, kind: "failed", agent: agent.id, project: agent.project, task: null,
    title: `${agent.name} failed to start`, body: agent.failure.reason, createdAt: agent.startedAt,
    status: "open", heldBy: null, options: [], command: null, folder: "", tool: null, recommendation: null }
}

export function contextLabel(reference: ContextReference, tasks: ReadonlyArray<{ id: string; label: string }> = []): string {
  return reference._tag === "file" ? reference.path : tasks.find((task) => task.id === reference.taskId)?.label ?? reference.taskId
}

// The text inside the engine's delivery wrapper, or undefined when the text has none.
// The wrapper is made by packages/engine/src/routing/envelope.ts.
export function unwrapDelivery(text: string): string | undefined {
  return /^Data from [^\[\n]+ \[([A-Za-z0-9_-]+)\] \(delivery [^)\n]+\):\n([\s\S]*)\nEnd data \[\1\]$/.exec(text)?.[2]
}
export function mapThread(items: ReadonlyArray<EventEnvelope>, agentId: string, tasks: ReadonlyArray<{ id: string; label: string }> = []) {
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
    if (e._tag === "PromptSent") {
      const data = unwrapDelivery(e.text)
      const answer = data === undefined ? null : /^Answer to question [^:\n]+:\n([\s\S]*)$/.exec(data)
      // The engine wraps what it passes to an agent, for the agent's safety. The owner reads
      // the content. An answer already shows on its question, so it is one short line here.
      if (answer) rows.push({ ...base, type: "note", text: `Answer delivered: ${answer[1]!.trim()}` })
      else rows.push({ ...base, type: "user", text: data ?? e.text,
        ...(e.sender._tag === "agent" ? { from: e.sender.agentId } : {}), context: e.context?.map((ref) => contextLabel(ref, tasks)) ?? [] })
    }
    else if (e._tag === "ThreadItem") {
      lastOutputAt = Math.max(lastOutputAt ?? 0, item.occurredAt)
      const c = e.content
      if (c._tag === "text") rows.push({ ...base, type: "agent", text: c.text })
      else if (c._tag === "tool-call") {
        // The closed row shows one line. A long command and its output open in boxes that scroll.
        const firstLine = c.title.split("\n").find((line) => line.trim() !== "")?.trim() ?? c.title
        const output = c.output ? toolText(c.output) : ""
        const short = output.length <= 60 && !output.includes("\n")
        rows.push({ ...base, type: "tools", summary: firstLine,
          lines: [{ verb: c.status ?? "", arg: c.input ? toolText(c.input) : "", res: short ? output : "" }],
          ...(c.title.trim() !== firstLine || firstLine.length > 80 ? { full: c.title } : {}), ...(output && !short ? { output } : {}) })
      }
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
  return { ...reply.configuration?.desired, context: reply.context?._tag === "available" ? Math.round(reply.context.percent) : null,
    contextReason: reply.context?._tag === "unavailable" ? reply.context.reason : null,
    configuration: reply.configuration ?? null, models: reply.models?.options ?? [], efforts: reply.efforts?.options ?? [] }
}

export function mapRosterDetails(agent: StoreAgent, tasks: ReadonlyArray<{ owner: string; label: string; state: string }>, actions: ReadonlyArray<{ _tag: string; agentId: string; sequence: number }>) {
  const stall = actions.filter((a) => a.agentId === agent.id && ["roles.StallSeen", "roles.StallEnded"].includes(a._tag)).sort((a, b) => b.sequence - a.sequence)[0]
  const owned = tasks.filter((task) => task.owner === agent.id)
  const workState = ["idle", "working"].includes(agent.state) ? owned.some((task) => task.state === "review") ? "reviewing"
    : agent.state === "working" || owned.some((task) => task.state === "active") ? "working" : "ready" : agent.workState
  return { workState, task: owned.find((t) => !["done", "cancelled"].includes(t.state))?.label ?? null,
    stalled: stall?._tag === "roles.StallSeen" }
}

export function mapPhoneOffer(settings: { carrier: { _tag: string }; pushPromptDismissed?: boolean }) {
  return { phoneOffer: settings.pushPromptDismissed || settings.carrier._tag !== "none" ? "declined" : "open" }
}

export function mapContextSearch(result: { items: ReadonlyArray<{ reference: ContextReference; label: string }> }) {
  return result.items.map((item) => ({ ...item, k: JSON.stringify(item.reference), icon: item.reference._tag === "task" ? "list-checks" : "file-code" }))
}

export function mapSubscriptionNames(subscriptions: ReadonlyArray<StoreSubscription>, accounts: ReadonlyArray<{ id: string; harness: string; displayName?: string }>) {
  return subscriptions.map((subscription) => ({ ...subscription,
    name: accounts.find((account) => account.id === subscription.id && account.harness === subscription.harness)?.displayName ?? subscription.id }))
}
