import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import type { ClientEnvelope } from "@lgtm/client/browser"
import type { AgentChoices, ClientRequest, ClientSnapshot } from "@lgtm/contracts"
import { startFailureText } from "@lgtm/contracts/startFailure"
import { useMutationDisabled, useShellData } from "../data/ShellDataProvider.tsx"
import { shellHref } from "../routes.ts"
import { requestId, withClient } from "../thread/client.ts"
import { Lifecycle } from "../thread/lifecycle.tsx"
import { Request, type RequestEvent } from "../thread/request.tsx"
import { DataText, visibleText } from "../thread/text.tsx"
import { Time, agentName } from "../pages/common.tsx"

export const requestKey = (row: ClientRequest) => `${row.kind}:${row.id}`
export const byRequestAge = (a: ClientRequest, b: ClientRequest) => a.openedAt - b.openedAt || a.sourceSequence - b.sourceSequence
export const requestTitle = (row: ClientRequest) => visibleText(row.display?.title ?? row.display?.preview ?? (row.kind === "permission" ? "Approval request" : "Question"))
function PermissionCommand({ request }: { readonly request: ClientRequest }) {
  const { requestSources } = useShellData()
  const [command, setCommand] = useState<string>()
  useEffect(() => {
    const controller = new AbortController()
    void requestSources.read(request.sourceSequence).then((envelope) => {
      if (controller.signal.aborted || envelope.sequence !== request.sourceSequence) return
      const event = envelope.event
      if (event._tag !== "PermissionRequested" || event.permissionRequestId !== request.id || event.agentId !== request.agentId) { requestSources.discard(envelope); return }
      const input = event.toolInput
      if (input !== null && typeof input === "object" && "command" in input && typeof input.command === "string") setCommand(input.command)
    }).catch(() => { /* A summary never substitutes for the full approval input. */ })
    return () => controller.abort()
  }, [request.id, request.agentId, request.sourceSequence, requestSources])
  if (command === undefined) return null
  const text = [...visibleText(command)]
  return <code className="home-row-command" title={visibleText(command)}>{text.slice(0, 60).join("")}{text.length > 60 ? "…" : ""}</code>
}
export function Wait({ since }: { readonly since: number }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer) }, [])
  const minutes = Math.max(0, Math.floor((now - since) / 60_000))
  return <time dateTime={new Date(since).toISOString()} title={new Date(since).toLocaleString()} className={minutes >= 60 ? "is-long" : ""}>
    {minutes < 1 ? "Just now" : minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`}
  </time>
}

export function RequestBlock({ request, focus = false }: { readonly request: ClientRequest; readonly focus?: boolean }) {
  const { complete, retry, requestSources } = useShellData()
  const disabled = useMutationDisabled()
  const [controller] = useState(() => new AbortController())
  const [source, setSource] = useState<ClientEnvelope>()
  const [answer, setAnswer] = useState<ClientEnvelope>()
  const [failed, setFailed] = useState(false)
  const [generation, setGeneration] = useState(0)
  useEffect(() => () => controller.abort(), [controller])
  useEffect(() => {
    const read = new AbortController()
    setFailed(false)
    void requestSources.read(request.sourceSequence)
      .then((envelope) => {
        if (read.signal.aborted) return
        if (envelope.sequence !== request.sourceSequence) throw new Error("Request unavailable")
        const event = envelope.event
        if (!("agentId" in event) || event.agentId !== request.agentId || (request.kind === "permission"
          ? event._tag !== "PermissionRequested" || event.permissionRequestId !== request.id
          : event._tag !== "QuestionAsked" || event.questionId !== request.id)) { requestSources.discard(envelope); throw new Error("Request identity changed") }
        setSource(envelope)
      }).catch(() => { if (!read.signal.aborted) setFailed(true) })
    return () => read.abort()
  }, [request.kind, request.id, request.agentId, request.sourceSequence, generation, requestSources])
  useEffect(() => {
    if (request.closedSequence === undefined) return
    const read = new AbortController()
    void requestSources.read(request.closedSequence).then((envelope) => {
      if (read.signal.aborted || envelope.sequence !== request.closedSequence) return
      const event = envelope.event
      if ("agentId" in event && event.agentId === request.agentId && (event._tag === "QuestionAnswered" && event.questionId === request.id
        || (event._tag === "PermissionAnswered" || event._tag === "PermissionCancelled") && event.permissionRequestId === request.id)) setAnswer(envelope)
    }).catch(() => { /* The durable bounded answer remains visible. */ })
    return () => read.abort()
  }, [request.closedSequence, request.id, request.agentId, requestSources])
  const event = source?.event
  const loaded = event?._tag === "PermissionRequested" || event?._tag === "QuestionAsked" ? event as RequestEvent : undefined
  const answerEvent = answer?.event
  const outcome = answerEvent?._tag === "QuestionAnswered" ? answerEvent.text : request.answer
    ?? (request.optionId === undefined ? undefined : loaded?._tag === "PermissionRequested"
      ? loaded.options.find((option) => option.id === request.optionId)?.name ?? request.optionId : request.optionId)
  return <div className="shared-request-block">
    {loaded === undefined ? <div role={failed ? "alert" : "status"}><p>{failed ? "Could not load the full request. Answer controls are unavailable." : "Loading the full request…"}</p>
      {failed && <button onClick={() => setGeneration((value) => value + 1)}>Try again</button>}</div>
      : <Request event={loaded} open={request.status === "open" && request.canAnswer && request.holder._tag === "owner"}
        items={[source!]} signal={controller.signal} disabled={disabled || !complete} focus={focus} onChanged={retry} />}
    {request.status !== "open" && <div className="request-outcome">
      {request.status === "cancelled" ? <p>Cancelled. No answer was sent.</p> : <><p>Answer recorded.</p>{outcome !== undefined && <DataText text={outcome} />}</>}
      {request.answeredAt !== undefined && <p><Time at={request.answeredAt} /></p>}
    </div>}
    <div className="home-detail-footer"><a href={shellHref({ page: "thread", agentId: request.agentId, subject: requestKey(request) })}>Open conversation</a>
      {request.taskId !== undefined && request.projectId !== undefined && <a href={shellHref({ page: "task", projectId: request.projectId, taskId: request.taskId })}>Open task</a>}
    </div>
  </div>
}

export function RequestList({ requests, compact = false, empty }: { readonly requests: readonly ClientRequest[]; readonly compact?: boolean; readonly empty?: ReactNode }) {
  const { snapshot, navigation } = useShellData()
  const [selected, setSelected] = useState<string>()
  const [limit, setLimit] = useState(100)
  const instance = useId()
  const list = useRef<HTMLDivElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const prior = useRef<readonly string[]>([])
  const focusWasInside = useRef(false)
  const visible = requests.slice(0, compact ? 6 : limit)
  const keys = visible.map(requestKey)
  useEffect(() => {
    if (selected !== undefined && !keys.includes(selected) && focusWasInside.current) {
      const index = Math.max(0, prior.current.indexOf(selected))
      const next = keys[Math.min(index, keys.length - 1)]
      if (next === undefined) list.current?.focus()
      else (buttons.current.get(next) ?? list.current)?.focus()
      setSelected(undefined)
    }
    prior.current = keys
  }, [keys.join("\0"), selected])
  return <div ref={list} tabIndex={-1} className={compact ? "request-list compact" : "request-list"}
    onFocusCapture={() => { focusWasInside.current = true }} onBlurCapture={(event) => { if (event.relatedTarget !== null && !event.currentTarget.contains(event.relatedTarget)) focusWasInside.current = false }}>
    {!requests.length ? empty === undefined ? <p>No open requests.</p> : empty : <ul className="home-open-list">{visible.map((row) => {
      const key = requestKey(row)
      const project = navigation?.projects.find((project) => project.projectId === row.projectId)
      const expanded = selected === key
      const id = `request-detail-${instance}-${encodeURIComponent(key)}`
      return <li key={key}>
        <button ref={(button) => { if (button === null) buttons.current.delete(key); else buttons.current.set(key, button) }}
          className="home-request-row" data-home-item={key} aria-expanded={expanded} aria-controls={id}
          onClick={() => setSelected(expanded ? undefined : key)}>
          <span className="home-kind">{row.kind === "permission" ? "Approval" : "Question"}</span>
          <strong title={requestTitle(row)}>{requestTitle(row)}{row.kind === "permission" && <PermissionCommand request={row} />}{row.taskId && <small>Blocks {visibleText(row.taskId)}</small>}</strong>
          <span className="home-row-project">{visibleText(project?.name ?? "")}</span>
          <span className="home-row-agent">{agentName(snapshot?.agents, row.agentId)}</span>
          <span className="home-row-machine">{visibleText(project?.machineId ?? "")}</span>
          <span className="home-row-status">{row.status === "open" ? <Wait since={row.openedAt} /> : <>{row.status === "cancelled" ? "Cancelled" : "Answered"}{row.answeredAt !== undefined && <> <Time at={row.answeredAt} /></>}</>}</span>
          <span className="home-row-sub"><span>{row.kind === "permission" ? "Approval" : "Question"}</span> · {visibleText(project?.name ?? "")} · {agentName(snapshot?.agents, row.agentId)}</span>
        </button>
        {expanded && <section className="home-detail" id={id} aria-label={requestTitle(row)}><RequestBlock request={row} /></section>}
      </li>
    })}</ul>}{!compact && requests.length > visible.length && <button onClick={() => setLimit((value) => value + 100)}>Load more requests</button>}
  </div>
}

type Agent = ClientSnapshot["agents"][number]
export function FailedStartBlock({ agent }: { readonly agent: Agent }) {
  const { retry, complete } = useShellData()
  const disabled = useMutationDisabled()
  const [controller] = useState(() => new AbortController())
  const [choices, setChoices] = useState<AgentChoices>()
  const [model, setModel] = useState("")
  const [effort, setEffort] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const lock = useRef(false)
  const attempt = useRef<{ key: string; id: ReturnType<typeof requestId> } | undefined>(undefined)
  useEffect(() => {
    void withClient((client) => client["client.agent.configuration"]({ requestId: requestId(), agentId: agent.agentId }), controller.signal)
      .then((value) => { if (!controller.signal.aborted) setChoices(value) }).catch(() => { /* Keep unavailable choices honest. */ })
    return () => controller.abort()
  }, [agent.agentId, controller])
  const apply = () => {
    if (lock.current || disabled || !complete || !model && !effort
      || model && !choices?.models.options.some((row) => row.id === model)
      || effort && !choices?.efforts.options.some((row) => row.id === effort)) return
    lock.current = true
    setBusy(true)
    const key = JSON.stringify([model, effort])
    if (attempt.current?.key !== key) attempt.current = { key, id: requestId() }
    void withClient((client) => client.configure({ requestId: attempt.current!.id, agentId: agent.agentId,
      ...(model ? { model } : {}), ...(effort ? { effort } : {}) }), controller.signal).then(() => {
      if (!controller.signal.aborted) { setMessage("Choices requested. Resume the agent to try again."); retry() }
    }).catch(() => { if (!controller.signal.aborted) setMessage("Could not confirm the choices. Retry the same choices before resuming.") })
      .finally(() => { if (!controller.signal.aborted) { lock.current = false; setBusy(false) } })
  }
  return <section className="request is-failed" aria-label="Failed start">
    <p className="request-label">Failed start</p><h3>{visibleText(agent.name)}</h3>
    <p>{startFailureText(agent.startFailure ?? "could-not-start")}</p>
    {(agent.startFailure === "not-signed-in" || agent.startFailure === "private-login-not-signed-in") && <a href={shellHref({ page: "service", service: "subscriptions" })}>Open subscriptions</a>}
    {(agent.startFailure === "model-refused" || agent.startFailure === "effort-refused") && <fieldset disabled={disabled || !complete || busy} className="failure-choice">
      <legend>Retry choices</legend>{(["models", "efforts"] as const).map((kind) => <label key={kind}>{kind === "models" ? "Model" : "Effort"}
        <select value={kind === "models" ? model : effort} onChange={(event) => (kind === "models" ? setModel : setEffort)(event.target.value)}>
          <option value="">Keep current</option>{choices?.[kind].options.map((option) => <option key={option.id} value={option.id}>{visibleText(option.label ?? option.id)}</option>)}
        </select></label>)}
      {choices === undefined || choices.models.source === "unavailable" && choices.efforts.source === "unavailable" ? <p>Model and effort choices are unavailable.</p> : <button disabled={!model && !effort} onClick={apply}>Apply choices</button>}
    </fieldset>}
    <Lifecycle agent={agent} signal={controller.signal} disabled={disabled || !complete || busy} />
    {message && <p role="status">{message}</p>}
    <a href={shellHref({ page: "thread", agentId: agent.agentId })}>Open conversation</a>
  </section>
}

export function FailedStartList({ agents }: { readonly agents: ClientSnapshot["agents"] }) {
  return <div className="failed-start-list">{agents.filter((agent) => agent.startFailure !== undefined).map((agent) => <details key={agent.agentId}>
    <summary><span className="home-kind failed">Failed start</span><strong>{visibleText(agent.name)}</strong><span>{startFailureText(agent.startFailure!)}</span></summary>
    <FailedStartBlock agent={agent} />
  </details>)}</div>
}
