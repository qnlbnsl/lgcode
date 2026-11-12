import { useEffect, useRef, useState } from "react"
import type { Workspace } from "@lgtm/contracts"
import * as Effect from "effect/Effect"
import { requestId, withClient } from "../thread/client.ts"
import { DataText } from "../thread/text.tsx"
import { pathLabel, probeSession, readResult, safeReadFailure, type Conflict, type GitSession } from "./state.ts"

export function ConflictPane({ workspace, path, session, entryKey, disabled, revision, onSessionExpired }: {
  readonly workspace: Workspace; readonly path: string; readonly session: GitSession; readonly entryKey: string; readonly disabled: boolean; readonly revision: number; readonly onSessionExpired: () => void
}) {
  const [value, setValue] = useState<Conflict>()
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const pending = useRef<AbortController | undefined>(undefined)
  const expired = useRef(onSessionExpired); expired.current = onSessionExpired
  useEffect(() => {
    const controller = new AbortController(); pending.current = controller; setLoading(true); setValue(undefined); setError("")
    void withClient((client) => client["project.conflict"]({ requestId: requestId(), worktreeId: workspace.worktreeId, path }).pipe(Effect.result), controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        if (result._tag === "Success") setValue(readResult(result.success))
        else { setError(safeReadFailure(result.failure)); void probeSession(controller.signal, expired.current) }
      }).catch(() => { if (!controller.signal.aborted) { setError("Could not read the complete conflict. The file is unchanged."); void probeSession(controller.signal, expired.current) } })
      .finally(() => { if (!controller.signal.aborted) { pending.current = undefined; setLoading(false) } })
    return () => { controller.abort(); pending.current?.abort(); pending.current = undefined }
  }, [workspace.worktreeId, path, revision, refresh])
  const choose = (hunk: number, choice: "ours" | "theirs" | "both") => {
    if (disabled || !value || pending.current) return
    const controller = new AbortController(); pending.current = controller; setLoading(true)
    const selection = { path: value.path, fingerprint: value.fingerprint, head: value.head, choices: value.choices }
    void withClient((client) => client["project.conflict.choose"]({ requestId: requestId(), worktreeId: workspace.worktreeId, selection, hunk, choice }).pipe(Effect.result), controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        if (result._tag === "Success") { setValue(readResult(result.success)); setError("") }
        else { setError(safeReadFailure(result.failure)); setValue(undefined); void probeSession(controller.signal, expired.current) }
      }).catch(() => { if (!controller.signal.aborted) { setValue(undefined); setError("Could not validate this choice. Refresh the conflict before resolving."); void probeSession(controller.signal, expired.current) } })
      .finally(() => { if (!controller.signal.aborted) { pending.current = undefined; setLoading(false) } })
  }
  const resolve = () => {
    if (disabled || loading || !value || value.choices.some((choice) => choice === null)) return
    const payload = { requestId: requestId(), worktreeId: workspace.worktreeId,
      selection: { path: value.path, fingerprint: value.fingerprint, head: value.head, choices: value.choices } }
    void session.execute(entryKey, `Resolve ${pathLabel(path)}`, (client) => client["project.conflict.resolve"](payload), () => "Conflict resolved. Review and stage the resulting file.", expired.current)
  }
  let hunk = 0
  return <section className="git-conflict" aria-label={`Resolve ${pathLabel(path)}`}>
    <header><h3>{pathLabel(path)}</h3><button disabled={loading} onClick={() => setRefresh((n) => n + 1)}>Reload conflict</button></header>
    {loading && <p role="status">Reading the canonical conflict…</p>}{error && <p role="alert">{error}</p>}
    <p>Choices preview the server's content. Saving sends the conflict identity and choices. Secret text may be hidden in this preview.</p>
    {value && <><p>{value.choices.filter((choice) => choice === null).length} unresolved conflict hunks</p>
      {value.segments.map((segment, index) => {
        if (segment.kind === "context") return <div className="conflict-context" key={index}><DataText text={segment.context.join("")} /></div>
        const current = hunk++, choice = value.choices[current]
        const ours = segment.ours.join(""), theirs = segment.theirs.join("")
        const preview = choice === "ours" ? ours : choice === "theirs" ? theirs : choice === "both" ? ours + (ours && theirs && !ours.endsWith("\n") ? "\n" : "") + theirs : undefined
        return <section className={`conflict-hunk${choice ? " is-chosen" : ""}`} key={index} aria-label={`Conflict ${current + 1}`}>
          <h4>Conflict {current + 1}</h4><div className="conflict-sides">{([['ours', 'Ours', ours], ['base', 'Base', segment.base.join("")], ['theirs', 'Theirs', theirs]] as const).map(([side, label, content]) => <section className={`conflict-side ${side}`} key={side}><h5>{label}</h5><DataText text={content} /></section>)}</div>
          <div className="git-choice-buttons">{(["ours", "theirs", "both"] as const).map((next) => <button key={next} data-hunk={current} data-hunk-choice={next} aria-pressed={choice === next} disabled={disabled || loading} onClick={() => choose(current, next)}>{next === "ours" ? "Use ours" : next === "theirs" ? "Use theirs" : "Keep both"}</button>)}</div>
          {preview !== undefined && <div className="conflict-preview"><h5>Result preview</h5><DataText text={preview} /></div>}
        </section>
      })}
      <footer><button id="mark-resolved" disabled={disabled || loading || value.choices.some((choice) => choice === null)} onClick={resolve}>Mark resolved</button><button disabled={loading} onClick={() => setRefresh((n) => n + 1)}>Cancel choices</button></footer>
    </>}
  </section>
}
