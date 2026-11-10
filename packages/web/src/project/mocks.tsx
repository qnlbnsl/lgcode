import { useCallback, useEffect, useRef, useState } from "react"
import type { MockRevision, ProjectId, RepositoryId, RequestId } from "@lgcode/contracts"
import * as Effect from "effect/Effect"
import { useAdminApi, requestId } from "../admin/api.ts"
import { DataText, visibleText } from "../thread/text.tsx"
import { approveMockRevision, artifactState, readMockHistory, screenRoute, type MockHistory } from "./mockRead.ts"
import { MockApprovalSession } from "./mockApproval.ts"
import { IsolatedDisplay } from "./display.tsx"
import "./review.css"

type MocksProps = {
  readonly projectId: ProjectId; readonly approvals: MockApprovalSession
  readonly repoId?: RepositoryId
  readonly refreshKey?: number; readonly disabled?: boolean; readonly onSessionExpired: () => void
}
export function Mocks(props: MocksProps) { return <MockContent key={props.projectId} {...props} /> }
function MockContent({ projectId, repoId, approvals, refreshKey, disabled = false, onSessionExpired }: MocksProps) {
  const api = useAdminApi(onSessionExpired)
  const [history, setHistory] = useState<MockHistory>()
  const [selected, setSelected] = useState<RequestId>()
  const [screenId, setScreenId] = useState("")
  const [scenario, setScenario] = useState("")
  const [pane, setPane] = useState("screens")
  const [artifacts, setArtifacts] = useState<ReadonlyArray<{ sourceId: string; state: string; text?: string; fingerprint?: string }>>()
  const [notice, setNotice] = useState("")
  const [confirm, setConfirm] = useState(false)
  const pending = approvals.get(projectId)
  const needsRefresh = useRef(true)
  const revision = history?.items.find((row) => row.revisionId === selected)
  const load = useCallback(async () => {
    setHistory(undefined); setArtifacts(undefined); setConfirm(false)
    const next = await api.run((client) => readMockHistory(client, projectId))
    if (next === undefined) return
    const attempt = approvals.get(projectId)
    if (attempt !== undefined && next.complete && next.approval?.revisionId === attempt.revisionId) {
      approvals.settle(projectId, attempt.requestId); setNotice("Approval confirmed by the current authoritative read.")
    }
    setHistory(next)
    const previous = approvals.get(projectId)?.revisionId
    setSelected((old) => next.items.some((row) => row.revisionId === previous) ? previous : next.items.some((row) => row.revisionId === old) ? old : next.items.at(-1)?.revisionId)
  }, [api.run, projectId, approvals])
  useEffect(() => { needsRefresh.current = true }, [refreshKey])
  useEffect(() => { if (!api.busy && needsRefresh.current) { needsRefresh.current = false; void load() } }, [api.busy, load, refreshKey])
  // The shell keys this page by project and login session; old scopes unmount.
  useEffect(() => { setArtifacts(undefined); setConfirm(false); setScreenId(""); setScenario("") }, [selected])
  const readArtifacts = async (row: MockRevision) => {
    setArtifacts(undefined)
    const next = await api.run((client) => Effect.gen(function* () {
      const rows = []
      for (const source of row.bundle.sources) {
        const reply = yield* client["project.mocks.artifact"]({ requestId: requestId(), projectId, revisionId: row.revisionId, sourceId: source.sourceId })
        rows.push("result" in reply ? { sourceId: source.sourceId, state: artifactState(row, source.sourceId, reply.result),
          ...(reply.result._tag === "available" ? { text: reply.result.text, fingerprint: reply.result.fingerprint } : {}) }
          : { sourceId: source.sourceId, state: "unavailable" })
      }
      return rows
    }))
    if (next !== undefined) setArtifacts(next)
  }
  const approve = async () => {
    if (revision === undefined || disabled) return
    const attempt = approvals.begin(projectId, revision.revisionId)
    if (attempt === undefined) return
    setConfirm(false)
    const outcome = await api.run((client) => approveMockRevision(client, projectId, attempt.revisionId, attempt.requestId))
    if (outcome === undefined || outcome.state === "uncertain") {
      setNotice("Approval is unconfirmed. Refresh, then retry this same approval."); return
    }
    approvals.settle(projectId, attempt.requestId); setHistory(outcome.history); setArtifacts(undefined)
    setNotice(outcome.state === "approved" ? "Approval recorded. The worklist goes to the project lead." : "Approval refused. Refresh the revision and its current artifacts before reviewing again.")
  }
  const route = revision === undefined ? undefined : screenRoute(revision, screenId || revision.bundle.screens[0]?.screenId || "", scenario || undefined)
  const selectedScreen = revision?.bundle.screens.find((row) => row.screenId === (screenId || revision.bundle.screens[0]?.screenId))
  const supportedScenarios = revision?.bundle.scenarios.filter((row) => selectedScreen !== undefined && screenRoute(revision, selectedScreen.screenId, row.scenarioId) !== undefined) ?? []
  const reviewedArtifacts = artifacts !== undefined && artifacts.length === revision?.bundle.sources.length && artifacts.every((row) => row.state === "current")
  const approved = history?.complete && history.approval?.revisionId === revision?.revisionId
  const approvalLabel = approved ? "Approved" : history?.complete && history.items.at(-1)?.revisionId === revision?.revisionId ? "Not approved" : "Approval not reported for this revision"
  return <section className="review-page" aria-label="Mocks">
    <header><h1>Mocks</h1><button disabled={api.busy} onClick={() => void load()}>Refresh mocks</button></header>
    {api.message && <p role="alert">{api.message}</p>}{notice && <p role="status">{notice}</p>}
    {disabled && <p role="status">Reconnect and refresh current project data before approving.</p>}
    {history === undefined ? <p role="status">Mock history is not loaded.</p> : <>
      {!history.complete && <p role="alert">{history.reason}</p>}
      {history.items.length === 0 && history.complete && <h2>No mocks have been recorded.</h2>}
      <label>Revision <select disabled={api.busy || pending !== undefined} value={selected ?? ""} onChange={(event) => setSelected(event.target.value as RequestId)}>
        {history.items.map((row) => <option key={row.revisionId} value={row.revisionId}>{visibleText(row.revisionId)} · {new Date(row.at).toLocaleString()}</option>)}
      </select></label>
    </>}
    {revision && <>
      <p>{revision.author._tag === "owner" ? "Owner" : visibleText(revision.author.agentId)} · <time dateTime={new Date(revision.at).toISOString()}>{new Date(revision.at).toLocaleString()}</time> · {approvalLabel}</p>
      <nav aria-label="Mock panes">{["screens", "data", "components", "tokens"].map((name) => <button key={name} aria-pressed={pane === name} onClick={() => setPane(name)}>{name[0]!.toUpperCase() + name.slice(1)}</button>)}</nav>
      {pane === "screens" && <>
        <div className="review-screen-layout"><nav className="review-screen-list" aria-label="Screens">{revision.bundle.screens.map((row) => <button key={row.screenId} aria-current={selectedScreen?.screenId === row.screenId} onClick={() => { setScreenId(row.screenId); setScenario("") }}>{visibleText(row.name)}</button>)}</nav><div>
        <div className="review-controls"><label>Scenario <select value={scenario} onChange={(event) => setScenario(event.target.value)}><option value="">Base view</option>{supportedScenarios.map((row) => <option key={row.scenarioId} value={row.scenarioId}>{visibleText(row.name)}</option>)}</select></label></div>
        <p>Recorded route: {route === undefined ? "Unavailable" : <code>{visibleText(route)}</code>}</p>
        <IsolatedDisplay title="Recorded mock preview" action="Open preview" disabled={disabled} onSessionExpired={onSessionExpired}
          {...(route === undefined || selectedScreen === undefined ? {} : { selection: { _tag: "mock" as const, projectId, revisionId: revision.revisionId, screenId: selectedScreen.screenId,
            ...(scenario === "" ? {} : { scenarioId: scenario }) } })} />
        {repoId === undefined || revision.bundle.designRevision === undefined
          ? <button disabled title="A registered editor design revision is required.">Edit design</button>
          : <IsolatedDisplay title="Mock design editor" action="Edit design" disabled={disabled} onSessionExpired={onSessionExpired}
            selection={{ _tag: "editor", repoId, projectId, revisionId: revision.bundle.designRevision }} />}
        <p>{revision.bundle.designRevision === undefined ? "No design revision is associated with these mocks." : <>Design revision: <code>{visibleText(revision.bundle.designRevision)}</code></>}</p>
        {selectedScreen?.summary !== undefined && <p>{visibleText(selectedScreen.summary)}</p>}
        <section aria-label="Recorded revisions"><h2>Changes</h2><ol>{history?.items.filter((row) => row.bundle.screens.some((screen) => screen.screenId === selectedScreen?.screenId)).slice().reverse().slice(0, 6).map((row) => <li key={row.revisionId}><code>{visibleText(row.revisionId)}</code> · {row.author._tag === "owner" ? "Owner" : visibleText(row.author.agentId)} · {new Date(row.at).toLocaleString()}</li>)}</ol></section>
        </div></div>
      </>}
      {pane === "data" && <><p>Comparisons are supplied with this revision for review.</p><div className="review-table"><table><thead><tr><th>Field</th><th>Draft type</th><th>Used on</th><th>Comparison</th><th>Description</th></tr></thead><tbody>{revision.comparisons.map((row, index) => <tr key={index}><td>{visibleText(`${row.field.entity ?? "Unknown entity"}.${row.field.name}`)}</td><td>{visibleText(row.field.type)}</td><td>{row.field.screens === undefined ? "Not reported" : row.field.screens.length === 0 ? "None" : row.field.screens.map((id) => visibleText(revision.bundle.screens.find((screen) => screen.screenId === id)?.name ?? id)).join(", ")}</td><td>{row.status}{row.known === undefined ? "" : ` · ${visibleText(row.known)}`}</td><td>{visibleText(row.field.description)}</td></tr>)}</tbody></table></div></>}
      {pane === "components" && <div className="review-table"><table><thead><tr><th>Component</th><th>Provenance</th><th>Used on</th><th>Reference</th></tr></thead><tbody>{revision.bundle.components.map((row) => <tr key={row.componentId}><td>{visibleText(row.name)}</td><td>{row.provenance === "shared" ? "Shared" : "Draft"}</td><td>{row.screens === undefined ? "Not reported" : row.screens.length === 0 ? "None" : row.screens.map((id) => visibleText(revision.bundle.screens.find((screen) => screen.screenId === id)?.name ?? id)).join(", ")}</td><td><code>{visibleText(row.reference)}</code><DataText text={row.fingerprint} /></td></tr>)}</tbody></table></div>}
      <h2>{pane === "tokens" ? "Token source evidence" : "Current artifact evidence"}</h2>
      <p>Revision metadata is immutable. These reads show current repository bytes, which may have changed.</p>
      <button disabled={api.busy} onClick={() => void readArtifacts(revision)}>Read current artifacts</button>
      {artifacts?.filter((row) => pane !== "tokens" || revision.bundle.sources.find((source) => source.sourceId === row.sourceId)?.kind === "tokens").map((row) => <details key={row.sourceId}><summary>{visibleText(row.sourceId)} · {row.state}</summary>{row.fingerprint && <DataText text={row.fingerprint} />}{row.text !== undefined && <DataText text={row.text} />}</details>)}
      {approved && history?.complete && history.approval && <><h2>Recorded implementation worklist</h2><p>Lead: {visibleText(history.approval.leadAgentId)}</p><DataText text={JSON.stringify(history.approval.worklist, null, 2)} /></>}
      {!approved && <><p>Read current artifacts before approving. Changed or unavailable evidence needs a new revision.</p><button disabled={disabled || api.busy || !reviewedArtifacts || pending !== undefined || !history?.complete || history.items.at(-1)?.revisionId !== revision.revisionId || revision.bundle.screens.length === 0} onClick={() => setConfirm(true)}>Approve mocks</button></>}
      {pending && <><p role="status">An approval remains unconfirmed. Its exact request and revision are kept for recovery.</p><button disabled={disabled || api.busy} onClick={() => void approve()}>Retry unconfirmed approval</button></>}
      {confirm && <section role="region" aria-label="Confirm mock approval"><h2>Approve this exact revision?</h2><DataText text={revision.revisionId} /><p>{revision.bundle.screens.length} screens and {revision.bundle.components.filter((row) => row.provenance === "draft").length} draft components go into the lead’s implementation worklist. Approval does not move component files.</p><button onClick={() => setConfirm(false)}>Cancel</button><button disabled={disabled || api.busy} onClick={() => void approve()}>Confirm approval</button></section>}
    </>}
  </section>
}
