import { Composer } from "./composer.tsx"
import { AgentTools } from "./agentTools.tsx"
import { activeReply, ReplyControls } from "./replyControls.tsx"
import { BoundedText } from "./boundedText.tsx"
import { useConversationReading } from "./reading.tsx"
import { projectAgentIds, selectedScope, teamAgents } from "../shell/model.ts"

import { startFailureText } from "@lgcode/contracts/startFailure"
import { displayedState } from "@lgcode/contracts"
import { useEffect, useMemo, useRef, useState } from "react"
import type { ClientEnvelope } from "@lgcode/client/browser"
import type { AgentId, Oversized } from "@lgcode/contracts"
import { groupThreadItems } from "@lgcode/contracts/thread"
import { Lifecycle } from "./lifecycle.tsx"
import { Content } from "./content.tsx"
import { DeliveryHistory } from "./delivery.tsx"
import { requestId, withClient } from "./client.ts"
import { PermissionAnswer, Request, requestOpen } from "./request.tsx"
import { AlertSubjects } from "./subjects/alerts.tsx"
import { visibleText } from "./text.tsx"
import { watchThread, type ThreadState } from "./watch.ts"
import { MutationProvider, useConversation, useMutationDisabled, useShellData } from "../data/ShellDataProvider.tsx"

function LargeItem({ item, signal, onLoaded }: {
  readonly item: typeof Oversized.Type
  readonly signal: AbortSignal
  readonly onLoaded: (envelope: ClientEnvelope) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const loading = useRef(false)
  const load = () => {
    if (loading.current || signal.aborted) return
    loading.current = true
    setBusy(true)
    setError(false)
    void withClient((client) => client["client.event"]({ requestId: requestId(), sequence: item.sequence }), signal)
      .then((reply) => {
        if (signal.aborted) return
        if ("envelope" in reply && reply.envelope.sequence === item.sequence
          && reply.envelope.event._tag === "ThreadItem" && reply.envelope.event.agentId === item.agentId) onLoaded(reply.envelope)
        else setError(true)
      }).catch(() => { if (!signal.aborted) setError(true) })
      .finally(() => { if (!signal.aborted) { loading.current = false; setBusy(false) } })
  }
  return <article aria-label="Large thread item">
    <p>Large thread item ({item.bytes} bytes).</p>
    <button aria-label="Load full thread item" disabled={busy} onClick={load}>{busy ? "Loading…" : "Load full item"}</button>
    {error && <p role="alert">Could not load this item. Try again.</p>}
  </article>
}

interface ThreadProps {
  readonly agentId: AgentId
  readonly subject?: string
  readonly onSessionExpired: () => void
}
export function Thread(props: ThreadProps) { return <AgentThread key={props.agentId} {...props} /> }
function AgentThread({ agentId, subject, onSessionExpired }: ThreadProps) {
  const [state, setState] = useState<ThreadState>({ items: [], loaded: false, connection: "Connecting" })
  const [controller] = useState(() => new AbortController())
  const watcher = useRef<ReturnType<typeof watchThread> | undefined>(undefined)
  const expired = useRef(onSessionExpired)
  const shellDisabled = useMutationDisabled()
  const { requestSources, navigation, snapshot: shellSnapshot, requests } = useShellData()
  const conversation = useConversation({ _tag: "agent", agentId })
  const root = useRef<HTMLElement>(null)
  const focusedSubject = useRef<string | undefined>(undefined)
  expired.current = onSessionExpired
  useEffect(() => {
    watcher.current = watchThread(agentId, setState, () => expired.current(), controller.signal, requestSources)
    return () => controller.abort()
  }, [agentId, controller, requestSources])
  const envelopes = state.items.filter((item): item is ClientEnvelope => "event" in item)
  const agent = state.snapshot?.agents.find((row) => row.agentId === agentId)
  const scope = selectedScope({ page: "thread", agentId }, navigation, state.snapshot)
  const contextScope = scope.project && scope.assignedWorkspace ? { projectId: scope.project.projectId,
    worktreeId: scope.assignedWorkspace.worktreeId, ...(scope.team ? { teamId: scope.team.teamId } : {}) } : undefined
  const grouped = groupThreadItems(state.items)
  const count = conversation.state.historyCount
  const focusedIndex = subject === undefined ? -1 : grouped.findIndex((item) => "event" in item && (
    item.event._tag === "PermissionRequested" ? subject === `permission:${item.event.permissionRequestId}`
      : item.event._tag === "QuestionAsked" ? subject === `question:${item.event.questionId}` : false))
  const start = Math.max(0, Math.min(grouped.length - count, focusedIndex < 0 ? grouped.length : focusedIndex))
  const revision = useMemo(() => [state.items, count], [state.items, count])
  const reading = useConversationReading({ _tag: "agent", agentId }, revision, state.loaded)
  const disabled = shellDisabled || state.connection !== "Live"
  const reply = activeReply(envelopes, agentId)
  useEffect(() => {
    const attempt = conversation.entry.state.cancelAttempt
    if (!state.loaded || !attempt) return
    const sent = envelopes.find((row) => row.sequence === attempt.sentSequence)?.event
    const terminal = envelopes.find((row) => row.sequence > attempt.sentSequence && "agentId" in row.event && row.event.agentId === agentId && (
      row.event._tag === "TurnEnded" || row.event._tag === "StateChanged" && row.event.state._tag !== "working"
      || ["AgentStopped", "AgentInterrupted", "AgentCrashed", "AgentReloadFailed"].includes(row.event._tag)
      || (row.event._tag === "DeliveryReturned" || row.event._tag === "DeliveryRequeued" || row.event._tag === "DeliveryHeld") && sent?._tag === "DeliverySent" && row.event.deliveryId === sent.deliveryId))
    if (terminal) conversation.entry.update({ cancelAttempt: undefined, cancelMessage: terminal.event._tag === "TurnEnded"
      ? terminal.event.stopped ? "Reply stopped." : "Reply ended." : "The reply is no longer active." })
  }, [state.loaded, state.items, conversation.entry, conversation.state.cancelAttempt, agentId])
  const halted = agent?.startFailure !== undefined ? `Failed to start: ${startFailureText(agent.startFailure)}`
    : agent?.state._tag === "stopped" ? "This agent is stopped."
    : agent?.state._tag === "crashed" ? "This agent crashed. Resume to continue." : undefined
  const waiting = state.snapshot?.requests.filter((row) => row.agentId === agentId).length ?? 0
  const questions = state.snapshot?.questions.filter((row) => row.agentId === agentId).length ?? 0
  const projectMembers = scope.project === undefined ? undefined : projectAgentIds(scope.project, navigation)
  const members = scope.team === undefined ? [] : teamAgents(scope.team, shellSnapshot).filter((row) => projectMembers?.has(row.agentId))
  const leadMembers = scope.project?.leadAgentId === agentId ? projectMembers
    : scope.team && (agent?.role === "lead" || members.some((row) => row.parent._tag === "agent" && row.parent.agentId === agentId))
      ? new Set(members.map((row) => row.agentId)) : undefined
  const teamRequests = leadMembers === undefined || requests === undefined ? undefined
    : requests.filter((row) => row.status === "open" && leadMembers.has(row.agentId)).length
  const activity = agent === undefined ? "Loading…" : agent.startFailure !== undefined ? `Failed to start: ${startFailureText(agent.startFailure)}`
    : teamRequests && (agent.state._tag === "idle" || agent.state._tag === "working")
      ? `Waiting on ${teamRequests} request${teamRequests === 1 ? "" : "s"}` : displayedState(agent)
  useEffect(() => {
    if (subject === undefined) { focusedSubject.current = undefined; return }
    if (!state.loaded || focusedSubject.current === subject) return
    const separator = subject.indexOf(":")
    const kind = subject.slice(0, separator)
    const id = subject.slice(separator + 1)
    const target = kind === "permission" || kind === "question"
      ? [...(root.current?.querySelectorAll<HTMLElement>("[data-request-id]") ?? [])].find((node) => node.dataset.requestId === id && node.dataset.requestKind === kind)
      : [...(root.current?.querySelectorAll<HTMLElement>("[data-subject]") ?? [])].find((node) => node.dataset.subject === subject)
    if (target) { target.focus(); target.scrollIntoView?.({ block: "nearest" }); focusedSubject.current = subject }
  }, [subject, state.loaded, state.items])
  return <MutationProvider value={shellDisabled || state.connection !== "Live"}><section ref={root} aria-label="Thread" className="conversation">
    <header className="conversation-heading"><h2>{visibleText(agent?.name ?? agentId)}</h2>{agent && <span className="conversation-role">{visibleText(agent.role)}</span>}
      <span role="status" aria-label="Agent activity">{activity}</span>
      <span className="visually-hidden" role="status" aria-label="Thread connection">{state.connection}</span></header>
    <div className="conversation-turns" ref={reading.scroller} onScroll={reading.onScroll} tabIndex={0} aria-label="Conversation messages">
    <AlertSubjects agentId={agentId} {...(subject === undefined ? {} : { subject })}
      {...(state.snapshot === undefined ? {} : { sequence: state.snapshot.sequence })} />
    {!state.loaded && <p>Loading thread…</p>}
    {state.loaded && state.items.length === 0 && <p>No thread items.</p>}
    {start > 0 && <button onClick={() => conversation.entry.update({ historyCount: count + 100 })}>Show earlier messages</button>}
    {grouped.slice(start).map((item) => <div data-sequence={item.sequence} key={item.sequence}>{(() => {
      if (!("event" in item)) return <LargeItem key={item.sequence} item={item} signal={controller.signal}
        onLoaded={(envelope) => watcher.current?.recover(envelope)} />
      const event = item.event
      switch (event._tag) {
        case "AgentStartFailed": return <article aria-label="Failed start" key={item.sequence}><p>Failed to start: {startFailureText(event.reason)}</p></article>
        case "ThreadItem": return <article aria-label="Agent message" key={`${item.sequence}:${event._tag}`}><Content event={event} compact /></article>
        case "PromptSent": if (envelopes.some(({ event: source }) => (source._tag === "AgentStarted" ? source.firstPromptDelivery?.id : source._tag === "DeliveryQueued" ? source.delivery.id : undefined) === event.deliveryId)) return null
          return <article aria-label="Sent prompt" key={`${item.sequence}:${event._tag}`}><p>Prompt</p><BoundedText text={event.text} label="Prompt" /></article>
        case "AgentStarted": case "DeliveryQueued": case "DeliverySent": case "DeliveryAccepted": case "DeliveryRequeued":
        case "DeliveryHeld": case "DeliveryReleased": case "DeliveryReturned": case "DeliveryWithdrawn":
          return <DeliveryHistory key={`${item.sequence}:${event._tag}`} event={event} items={envelopes} />
        case "QuestionAnswered": return <article aria-label="Question answer" key={`${item.sequence}:${event._tag}`}>
          <h3>Question answer</h3><p>Question: {visibleText(event.questionId)}</p><BoundedText text={event.text} label="Answer" />
        </article>
        case "PermissionRequested": case "QuestionAsked": return <Request key={`${item.sequence}:${event._tag}`} event={event}
          open={requestOpen(event, item.sequence, envelopes, state.snapshot)} items={envelopes} signal={controller.signal} />
        case "PermissionAnswered": return <PermissionAnswer key={`${item.sequence}:${event._tag}`} event={event} items={envelopes} />
        default: return null
      }
    })()}</div>)}
    </div>
    {reading.away && <button className="conversation-latest" onClick={reading.latest}>Latest messages</button>}
    {(waiting > 0 || questions > 0 || teamRequests || agent?.state._tag === "working") ? <p className="conversation-busy" role="status">{teamRequests ? activity : waiting > 0 ? `Waiting on ${waiting} approval${waiting === 1 ? "" : "s"}` : questions > 0 ? `Waiting on ${questions} answer${questions === 1 ? "" : "s"}` : "Working on your message"}</p> : null}
    {agent && <div className="lifecycle-controls"><Lifecycle agent={agent} signal={controller.signal} /></div>}
    {state.loaded && <Composer identity={{ _tag: "agent", agentId }} recipient={agent?.name ?? agentId} disabled={disabled}
      {...(halted === undefined ? {} : { halt: halted })} {...(contextScope ? { scope: contextScope } : {})}
      tools={<AgentTools agentId={agentId} disabled={disabled} {...(agent ? { account: { id: agent.account, harness: agent.harness } } : {})}
        {...(state.snapshot ? { sequence: state.snapshot.sequence } : {})} />}
      {...(reply ? { action: <ReplyControls agentId={agentId} items={envelopes} disabled={disabled} compact /> } : {})} />}
    {conversation.state.cancelMessage && <p role="status">{conversation.state.cancelMessage}</p>}
  </section></MutationProvider>
}
