import { startFailureText } from "@lgcode/contracts/startFailure"
import { useEffect, useRef, useState, type FormEvent } from "react"
import type { ClientEnvelope } from "@lgcode/client/browser"
import type { AgentId, Oversized } from "@lgcode/contracts"
import { groupThreadItems } from "@lgcode/contracts/thread"
import { Lifecycle } from "./lifecycle.tsx"
import { Content } from "./content.tsx"
import { DeliveryHistory } from "./delivery.tsx"
import { requestId, withClient } from "./client.ts"
import { PermissionAnswer, Request, requestOpen } from "./request.tsx"
import { AlertSubjects } from "./subjects/alerts.tsx"
import { DataText, visibleText } from "./text.tsx"
import { watchThread, type ThreadState } from "./watch.ts"

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

function Prompt({ agentId, signal, failure }: { readonly agentId: AgentId; readonly signal: AbortSignal; readonly failure?: string }) {
  const busy = useRef(false)
  const attempt = useRef<{ text: string; requestId: ReturnType<typeof requestId> } | undefined>(undefined)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState("")
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy.current || signal.aborted) return
    const field = event.currentTarget.elements.namedItem("prompt") as HTMLTextAreaElement
    const text = field.value
    if (!text.trim()) return
    if (failure !== undefined) { setMessage(`Failed to start: ${startFailureText(failure)}`); return }
    busy.current = true
    setSending(true)
    setMessage("")
    // An explicit retry of unchanged text uses the same idempotency key.
    if (attempt.current?.text !== text) attempt.current = { text, requestId: requestId() }
    const payload = { ...attempt.current!, agentId }
    void withClient((client) => client.prompt(payload), signal).then(() => {
      if (signal.aborted) return
      if (field.value === text) field.value = ""
      attempt.current = undefined
      setMessage("Prompt sent.")
    }).catch(() => { if (!signal.aborted) setMessage("Could not confirm the prompt. You can retry the same text.") })
      .finally(() => { if (!signal.aborted) { busy.current = false; setSending(false) } })
  }
  return <form aria-label="Prompt agent" onSubmit={submit}>
    <label>Prompt agent<textarea name="prompt" aria-label="Prompt agent" disabled={sending} required /></label>
    <button aria-label="Send prompt" type="submit" disabled={sending}>{sending ? "Sending…" : "Send prompt"}</button>
    {message && <p role="status">{message}</p>}
  </form>
}

export function Thread({ agentId, subject, onSessionExpired }: {
  readonly agentId: AgentId
  readonly subject?: string
  readonly onSessionExpired: () => void
}) {
  const [state, setState] = useState<ThreadState>({ items: [], loaded: false, connection: "Connecting" })
  const [controller] = useState(() => new AbortController())
  const watcher = useRef<ReturnType<typeof watchThread> | undefined>(undefined)
  const expired = useRef(onSessionExpired)
  expired.current = onSessionExpired
  useEffect(() => {
    watcher.current = watchThread(agentId, setState, () => expired.current(), controller.signal)
    return () => controller.abort()
  }, [agentId, controller])
  const envelopes = state.items.filter((item): item is ClientEnvelope => "event" in item)
  const agent = state.snapshot?.agents.find((row) => row.agentId === agentId)
  return <section aria-label="Thread">
    <nav><a href="/">Situation</a></nav>
    <h2>Thread: {visibleText(agent?.name ?? agentId)}</h2>
    <p role="status">{state.connection}</p>
    {agent?.state && <Lifecycle agent={agent} signal={controller.signal} />}
    <AlertSubjects agentId={agentId} {...(subject === undefined ? {} : { subject })}
      {...(state.snapshot === undefined ? {} : { sequence: state.snapshot.sequence })} />
    {!state.loaded && <p>Loading thread…</p>}
    {state.loaded && state.items.length === 0 && <p>No thread items.</p>}
    {groupThreadItems(state.items).map((item) => {
      if (!("event" in item)) return <LargeItem key={item.sequence} item={item} signal={controller.signal}
        onLoaded={(envelope) => watcher.current?.recover(envelope)} />
      const event = item.event
      switch (event._tag) {
        case "AgentStartFailed": return <article aria-label="Failed start" key={item.sequence}><p>Failed to start: {startFailureText(event.reason)}</p></article>
        case "ThreadItem": return <article aria-label="Agent message" key={`${item.sequence}:${event._tag}`}><p>Agent data</p><Content event={event} /></article>
        case "PromptSent": if (envelopes.some(({ event: source }) => (source._tag === "AgentStarted" ? source.firstPromptDelivery?.id : source._tag === "DeliveryQueued" ? source.delivery.id : undefined) === event.deliveryId)) return null
          return <article aria-label="Sent prompt" key={`${item.sequence}:${event._tag}`}><p>Prompt</p><DataText text={event.text} /></article>
        case "AgentStarted": case "DeliveryQueued": case "DeliverySent": case "DeliveryAccepted": case "DeliveryRequeued":
        case "DeliveryHeld": case "DeliveryReleased": case "DeliveryReturned": case "DeliveryWithdrawn":
          return <DeliveryHistory key={`${item.sequence}:${event._tag}`} event={event} items={envelopes} />
        case "QuestionAnswered": return <article aria-label="Question answer" key={`${item.sequence}:${event._tag}`}>
          <h3>Question answer</h3><p>Question: {visibleText(event.questionId)}</p><DataText text={event.text} />
        </article>
        case "PermissionRequested": case "QuestionAsked": return <Request key={`${item.sequence}:${event._tag}`} event={event}
          open={requestOpen(event, item.sequence, envelopes, state.snapshot)} items={envelopes} signal={controller.signal} />
        case "PermissionAnswered": return <PermissionAnswer key={`${item.sequence}:${event._tag}`} event={event} items={envelopes} />
        default: return null
      }
    })}
    {state.loaded && <Prompt agentId={agentId} signal={controller.signal} {...(agent?.startFailure === undefined ? {} : { failure: agent.startFailure })} />}
  </section>
}
