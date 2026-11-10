import { useCallback, useEffect, useRef, useState } from "react"
import type { ProjectId, RepositoryId, RequestId, RepositoryDesignResult } from "@lgcode/contracts"
import { requestId, useAdminApi } from "../admin/api.ts"
import { DataText, visibleText } from "../thread/text.tsx"
import "./review.css"
import { IsolatedDisplay } from "./display.tsx"

// The route supplies an explicit registered repository identity. No project or
// component path is used as a substitute for an absent design registration.
type DesignProps = {
  readonly repoId: RepositoryId; readonly revisionId?: RequestId; readonly projectId?: ProjectId
  readonly refreshKey?: number; readonly onSessionExpired: () => void
}
export function RepositoryDesign(props: DesignProps) {
  return <DesignContent key={JSON.stringify([props.repoId, props.projectId, props.revisionId])} {...props} />
}
function DesignContent({ repoId, revisionId, projectId, refreshKey, onSessionExpired }: DesignProps) {
  const api = useAdminApi(onSessionExpired)
  const [result, setResult] = useState<typeof RepositoryDesignResult.Type>()
  const needsRefresh = useRef(true)
  const load = useCallback(async () => {
    setResult(undefined)
    const reply = await api.run((client) => client["project.design.read"]({ requestId: requestId(), repoId,
      ...(revisionId === undefined ? {} : { revisionId }), ...(projectId === undefined ? {} : { projectId }) }))
    if (reply !== undefined && "result" in reply) setResult(reply.result)
  }, [api.run, repoId, revisionId, projectId])
  useEffect(() => { needsRefresh.current = true }, [refreshKey])
  useEffect(() => { if (!api.busy && needsRefresh.current) { needsRefresh.current = false; void load() } }, [api.busy, load, refreshKey])
  return <section className="review-page" aria-label="Repository Design"><header><h1>Design</h1><button disabled={api.busy} onClick={() => void load()}>Refresh design</button></header>
    {api.message && <p role="alert">{api.message}</p>}
    {result === undefined ? <p role="status">Repository design is not loaded.</p> : result._tag === "unavailable" ? <h2>No design is registered for this repository.</h2> : <>
      <dl><dt>Repository</dt><dd>{visibleText(result.record.design.repoId)}</dd><dt>Worktree</dt><dd>{visibleText(result.record.design.worktreeId)}</dd>
        <dt>File</dt><dd><code>{visibleText(result.record.design.file)}</code></dd><dt>Revision</dt><dd><DataText text={result.record.revisionId} /></dd>
        <dt>Recorded by</dt><dd>{result.record.author._tag === "owner" ? "Owner" : visibleText(result.record.author.agentId)} · <time dateTime={new Date(result.record.at).toISOString()}>{new Date(result.record.at).toLocaleString()}</time></dd>
        <dt>File evidence</dt><dd>{result.file._tag === "available" ? "Current bytes match the recorded fingerprint." : "Current artifact is unavailable or changed."}</dd></dl>
      <IsolatedDisplay title="Registered repository design editor" action="Edit design" disabled={result.file._tag !== "available"} onSessionExpired={onSessionExpired}
        selection={{ _tag: "editor", repoId, revisionId: result.record.revisionId, projectId: result.record.projectId }} />
      <h2>Tokens</h2>
      {result.tokens._tag === "unavailable" ? <p>Token evidence is unavailable or changed.</p> : <><DataText text={result.tokens.fingerprint} /><dl className="review-tokens">{result.tokens.tokens.map((token) => <div key={token.name}><dt>{visibleText(token.name)}</dt><dd>{/^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(token.value) && <svg className="review-swatch" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><rect width="20" height="20" fill={token.value} /></svg>}{visibleText(token.value)}</dd></div>)}</dl></>}
      <h2>Shared components</h2>
      <div className="review-table"><table><thead><tr><th>Component</th><th>Reference</th><th>Variants</th><th>Current evidence</th><th>Preview</th></tr></thead><tbody>{result.components.map((row) => <tr key={row.componentId}><td>{visibleText(row.name)}</td><td><code>{visibleText(row.reference)}</code><DataText text={row.fingerprint} /></td><td>{row.variants === undefined ? "Not reported" : visibleText(row.variants)}</td><td>{row.availability._tag === "available" ? "Matches recorded fingerprint" : "Unavailable or changed"}</td><td>{/\.(?:html|svg)$/i.test(row.reference)
          ? <IsolatedDisplay title={`${visibleText(row.name)} preview`} action="View component" inert disabled={row.availability._tag !== "available" || result.file._tag !== "available"} onSessionExpired={onSessionExpired}
            selection={{ _tag: "component", repoId, revisionId: result.record.revisionId, componentId: row.componentId }} />
          : <p>Preview unavailable for this source format.</p>}</td></tr>)}</tbody></table></div>
    </>}
  </section>
}
