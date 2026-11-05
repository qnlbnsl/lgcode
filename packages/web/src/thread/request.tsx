import { groupThreadItems } from "@shephrd/contracts/thread"
import { useRef, useState, type FormEvent } from "react"
import type { ClientEnvelope } from "@shephrd/client/browser"
import type { ClientSnapshot, Event } from "@shephrd/contracts"
import { Content, type ContentEvent } from "./content.tsx"
import { requestId, withClient } from "./client.ts"
import { actionJson, DataText, visibleText } from "./text.tsx"

type RequestEvent = Extract<Event, { _tag: "PermissionRequested" | "QuestionAsked" }>

export function PermissionAnswer({ event, items }: {
  readonly event: Extract<Event, { _tag: "PermissionAnswered" }>
  readonly items: ReadonlyArray<ClientEnvelope>
}) {
  const request = items.find((item) => item.event._tag === "PermissionRequested"
    && item.event.agentId === event.agentId && item.event.permissionRequestId === event.permissionRequestId)?.event
  const answer = event.answer
  const text = answer._tag === "cancelled" ? "Cancelled"
    : request?._tag === "PermissionRequested"
      ? request.options.find((option) => option.id === answer.optionId)?.name ?? answer.optionId
      : answer.optionId
  return <article aria-label="Permission answer">
    <h3>Permission answer</h3>
    <p>Request: {visibleText(event.permissionRequestId)}</p>
    <DataText text={text} />
  </article>
}

export function requestOpen(event: RequestEvent, sequence: number, items: ReadonlyArray<ClientEnvelope>, snapshot?: ClientSnapshot) {
  const permission = event._tag === "PermissionRequested"
  const id = permission ? event.permissionRequestId : event.questionId
  let open = true
  let latest = sequence
  let holder = event.holder
  for (const item of items) {
    const next = item.event
    if (item.sequence <= sequence) continue
    if (permission && "permissionRequestId" in next && next.permissionRequestId === id) {
      latest = item.sequence
      if (next._tag === "PermissionAnswered" || next._tag === "PermissionCancelled") open = false
      if (next._tag === "PermissionMoved") holder = next.to
    } else if (!permission && "questionId" in next && next.questionId === id) {
      latest = item.sequence
      if (next._tag === "QuestionAnswered") open = false
      if (next._tag === "QuestionMoved") holder = next.to
    }
  }
  if (snapshot !== undefined && snapshot.sequence >= latest) {
    const row = (permission ? snapshot.requests : snapshot.questions).find((candidate) => candidate.id === id)
    return row !== undefined && row.holder._tag === "owner"
  }
  return open && holder._tag === "owner"
}

export function Request({ event, open, items, signal }: {
  readonly event: RequestEvent
  readonly open: boolean
  readonly items: ReadonlyArray<ClientEnvelope>
  readonly signal: AbortSignal
}) {
  const locked = useRef(false)
  const [status, setStatus] = useState<"ready" | "sending" | "sent" | "failed">("ready")
  const permission = event._tag === "PermissionRequested"
  const id = permission ? event.permissionRequestId : event.questionId
  const answer = (value: string) => {
    if (locked.current || !open || signal.aborted) return
    locked.current = true
    setStatus("sending")
    void withClient((client) => permission
      ? client.answer({ requestId: requestId(), kind: "permission", id: event.permissionRequestId, optionId: value })
      : client.answer({ requestId: requestId(), kind: "question", id: event.questionId, text: value }), signal)
      .then(() => { if (!signal.aborted) setStatus("sent") })
      .catch(() => { if (!signal.aborted) setStatus("failed") })
  }
  const submitQuestion = (form: FormEvent<HTMLFormElement>) => {
    form.preventDefault()
    const field = form.currentTarget.elements.namedItem("answer") as HTMLTextAreaElement
    if (field.value.trim()) answer(field.value)
  }
  const matching = permission ? groupThreadItems(items).filter((item): item is ClientEnvelope & { event: ContentEvent } => {
    const candidate = item.event
    return candidate._tag === "ThreadItem" && candidate.agentId === event.agentId
      && (candidate.content._tag === "tool-call" || candidate.content._tag === "file-change")
      && candidate.content.callId === event.toolCallId
  }) : []
  const hidden = permission && (event.inputRedacted === true || event.inputTruncated === true
    || event.toolInput === undefined && matching.length === 0)

  return <section className="request-controls" aria-label={permission ? "Permission request" : "Question"} data-request-id={id}>
    <h3>{permission ? "Shephrd permission request" : "Shephrd question"}</h3>
    <p>Request: {visibleText(id)}</p>
    <DataText text={permission ? event.description : event.text} />
    {permission && <>
      <p>Tool kind: {event.toolKind ?? "unknown"}</p>
      {event.locations !== undefined && <><p>Locations</p><DataText text={actionJson(event.locations)} /></>}
      {event.toolInput !== undefined && <><p>Action input</p><DataText text={actionJson(event.toolInput)} /></>}
      {event.toolInput === undefined && matching.map((item) => <div key={item.sequence}>
        <p>Matching tool action</p><Content event={item.event} />
      </div>)}
      {hidden && <p role="note">The action's input is not visible.</p>}
      {event.inputRedacted && <p role="note">Part of the action's input is hidden, because redaction changed it.</p>}
      {event.inputTruncated && <p role="note">The action's input is cut at 8 KiB.</p>}
    </>}
    {!open ? <p>This request is closed or held elsewhere.</p> : permission ? <div className="request-options">
      {event.options.map((option) => <button key={option.id} disabled={status !== "ready"} onClick={() => answer(option.id)}>
        {visibleText(option.name)}{option.persistent ? " (persistent)" : ""}
      </button>)}
    </div> : <form aria-label="Answer question" onSubmit={submitQuestion}>
      <label>Answer<textarea name="answer" required disabled={status !== "ready"} /></label>
      <button type="submit" disabled={status !== "ready"}>Send answer</button>
    </form>}
    {status === "sending" && <p role="status">Sending answer…</p>}
    {status === "sent" && <p role="status">Answer sent.</p>}
    {status === "failed" && <p role="alert">Could not confirm the answer. Reopen the thread to check the request before trying again.</p>}
  </section>
}
