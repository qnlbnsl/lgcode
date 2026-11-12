import { groupThreadItems } from "@lgtm/contracts/thread"
import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import type { ClientEnvelope } from "@lgtm/client/browser"
import type { ClientRequest, ClientSnapshot, Event, EventSequence } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import { Content, type ContentEvent } from "./content.tsx"
import { requestId, withClient } from "./client.ts"
import { actionJson, DataText, visibleText } from "./text.tsx"
import { useMutationDisabled } from "../data/ShellDataProvider.tsx"
import { useRequestAttempt } from "./requestAttempt.ts"

export type RequestEvent = Extract<Event, { _tag: "PermissionRequested" | "QuestionAsked" }>

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

export function Request({ event, open, items, signal, disabled = false, focus = false, onChanged }: {
  readonly event: RequestEvent
  readonly open: boolean
  readonly items: ReadonlyArray<ClientEnvelope>
  readonly signal: AbortSignal
  readonly disabled?: boolean
  readonly focus?: boolean
  readonly onChanged?: () => void
}) {
  const anchor = useId()
  const disconnected = useMutationDisabled()
  disabled = disabled || disconnected
  const section = useRef<HTMLElement>(null)
  const [refreshed, setRefreshed] = useState<ClientRequest>()
  const [refreshing, setRefreshing] = useState(false)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const permission = event._tag === "PermissionRequested"
  const id = permission ? event.permissionRequestId : event.questionId
  const { state: submission, entry } = useRequestAttempt(JSON.stringify([event.agentId, permission ? "permission" : "question", id]))
  const status = submission.status
  const answerable = open && (refreshed === undefined || refreshed.canAnswer && refreshed.holder._tag === "owner" && refreshed.status === "open")
  useEffect(() => { if (focus) section.current?.focus({ preventScroll: true }) }, [focus])
  const answer = (value: string) => {
    if (entry.state.locked || !answerable || disabled || signal.aborted) return
    const command = entry.state.command?.value === value ? entry.state.command : { value, requestId: requestId() }
    entry.update({ status: "sending", locked: true, command })
    const commandId = command.requestId
    void withClient((client) => Effect.result(permission
      ? client.answer({ requestId: commandId, kind: "permission", id: event.permissionRequestId, optionId: value })
      : client.answer({ requestId: commandId, kind: "question", id: event.questionId, text: value })), signal)
      .then((result) => {
        if (signal.aborted) { entry.update({ ...entry.state, status: "failed", locked: true }); return }
        if (result._tag === "Failure") {
          entry.update(result.failure._tag === "CommandError" ? { status: "failed", locked: true } : { ...entry.state, status: "failed", locked: true })
        } else { entry.update({ status: "sent", locked: true }); onChanged?.() }
      })
      .catch(() => { entry.update({ ...entry.state, status: "failed", locked: true }) })
  }
  // An unsuccessful submission stays locked until this explicit authoritative
  // read. Retrying unchanged text then reuses the original command identity.
  const refresh = () => {
    if (refreshing || disabled || signal.aborted) return
    setRefreshing(true)
    setRefreshFailed(false)
    void withClient((client) => Effect.gen(function* () {
      let after = 0 as EventSequence
      for (;;) {
        const page = yield* client["client.requests"]({ requestId: requestId(), after, limit: 200, agentId: event.agentId,
          kind: permission ? "permission" : "question" })
        const row = page.items.find((row) => row.id === id)
        if (row !== undefined) {
          const source = items.find((item) => item.event === event)
          if (source !== undefined && row.sourceSequence !== source.sequence) return yield* Effect.fail(new Error("Request identity changed"))
          return row
        }
        if (page.next === undefined) return yield* Effect.fail(new Error("Request unavailable"))
        if (!page.items.length || page.next <= after) return yield* Effect.fail(new Error("Request cursor did not advance"))
        after = page.next
      }
    }), signal).then((row) => {
      if (signal.aborted) return
      setRefreshed(row)
      if (row.canAnswer && row.status === "open" && row.holder._tag === "owner") {
        entry.update({ ...entry.state, status: "ready", locked: false })
      } else entry.update({ status: "checked", locked: true })
      onChanged?.()
    }).catch(() => { if (!signal.aborted) setRefreshFailed(true) })
      .finally(() => { if (!signal.aborted) setRefreshing(false) })
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

  const inputFields = permission && event.toolInput !== undefined && event.toolInput !== null && typeof event.toolInput === "object" && !Array.isArray(event.toolInput)
    ? Object.entries(event.toolInput) : undefined
  return <section ref={section} id={`request-${anchor}`} tabIndex={-1} className={`request request-controls is-${permission ? "approval" : "question"}${answerable ? " is-open" : ""}`}
    aria-label={permission ? "Permission request" : "Question"} data-request-id={id} data-request-kind={permission ? "permission" : "question"}>
    <p className="request-label">{permission ? "Approval" : "Question"}</p>
    <h3>{visibleText(permission ? event.description : event.title ?? event.text)}</h3>
    <DataText text={permission ? event.description : event.text} />
    {!permission && event.recommendation && <DataText text={event.recommendation} />}
    {permission && <>
      {event.locations !== undefined && <><p>Locations</p><DataText text={actionJson(event.locations)} /></>}
      {inputFields !== undefined ? <dl className="request-fields">{inputFields.map(([key, value]) => <div key={key}>
        <dt>{visibleText(({ command: "Command", cwd: "Folder", path: "Path" } as Record<string, string>)[key] ?? key)}</dt>
        <dd><code>{typeof value === "string" ? visibleText(value) : actionJson(value)}</code></dd>
      </div>)}</dl> : event.toolInput !== undefined && <><p>Action input</p><DataText text={actionJson(event.toolInput)} /></>}
      {event.toolInput === undefined && matching.map((item) => <div key={item.sequence}>
        <p>Matching tool action</p><Content event={item.event} />
      </div>)}
      {hidden && <p role="note">The action's input is not visible.</p>}
      {event.inputRedacted && <p role="note">Part of the action's input is hidden, because redaction changed it.</p>}
      {event.inputTruncated && <p role="note">The action's input is cut at 8 KiB.</p>}
    </>}
    {!answerable ? <p>This request is closed or held elsewhere.</p> : permission ? <div className="request-options">
      {event.options.map((option) => <button key={option.id} disabled={disabled || status !== "ready"} onClick={() => answer(option.id)}>
        {visibleText(option.name)}{option.persistent ? " (persistent)" : ""}
      </button>)}
    </div> : <form aria-label="Answer question" onSubmit={submitQuestion}>
      <label>Answer<textarea name="answer" required defaultValue={event.proposedAnswer ?? ""} disabled={disabled || status !== "ready"} /></label>
      <button type="submit" disabled={disabled || status !== "ready"}>Send answer</button>
    </form>}
    <details className="request-details"><summary>Details</summary><p>Request: {visibleText(id)}</p>
      {permission && <><p>Tool kind: {event.toolKind ?? "unknown"} · Call: {visibleText(event.toolCallId)}</p>
        {event.toolInput !== undefined && <DataText text={actionJson(event.toolInput)} />}</>}
    </details>
    {status === "sending" && <p role="status">Sending answer…</p>}
    {status === "sent" && <p role="status">Answer sent.</p>}
    {status === "checked" && <p role="status">Request refreshed. It is closed or held elsewhere.</p>}
    {status === "failed" && <><p role="alert">Could not confirm the answer. Reopen the thread to check the request before trying again.</p>
      <button disabled={disabled || refreshing} onClick={refresh}>{refreshing ? "Refreshing…" : "Refresh this request"}</button></>}
    {refreshFailed && <p role="alert">Could not refresh this request. Answer controls remain locked.</p>}
  </section>
}
