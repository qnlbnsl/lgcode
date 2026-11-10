import { useEffect, useRef, useState } from "react"
import type { ContextSearchResult } from "@lgcode/contracts"
import { requestId, withClient } from "./client.ts"
import { referenceKey, type ContextScope, type SelectedContext } from "./conversationState.tsx"
import { visibleText } from "./text.tsx"

export function ContextPicker({ scope, selected, initialQuery = "", apply, close }: {
  readonly scope?: ContextScope
  readonly selected: ReadonlyArray<SelectedContext>
  readonly initialQuery?: string
  readonly apply: (items: ReadonlyArray<SelectedContext>) => void
  readonly close: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState(initialQuery)
  const [selection, setSelection] = useState(selected)
  const [result, setResult] = useState<typeof ContextSearchResult.Type>()
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading")
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const previous = document.activeElement
    dialog.current?.showModal()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  useEffect(() => {
    if (scope === undefined) { setStatus("unavailable"); return }
    const controller = new AbortController()
    setStatus("loading")
    setResult(undefined)
    const timer = setTimeout(() => {
      void withClient((client) => client["project.context.search"]({ requestId: requestId(), ...scope, query, limit: 50 }), controller.signal)
        .then((reply) => { if (!controller.signal.aborted) { if ("result" in reply) { setResult(reply.result); setStatus("ready") } else setStatus("unavailable") } })
        .catch(() => { if (!controller.signal.aborted) setStatus("unavailable") })
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [scope?.projectId, scope?.teamId, scope?.worktreeId, query, retry])
  return <dialog ref={dialog} className="context-picker" aria-label="Add context" onCancel={(event) => { event.preventDefault(); close() }}>
    <h2>Add context</h2>
    <label>Find tasks or files<input autoFocus value={query} maxLength={256} onChange={(event) => setQuery(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); apply(selection); close() } }} /></label>
    <p>Attach identities from this project. File contents are not included.</p>
    {status === "loading" && <p role="status">Searching…</p>}
    {status === "unavailable" && <p role="status">Context search is unavailable.{scope !== undefined && <button onClick={() => setRetry((value) => value + 1)}>Retry search</button>}</p>}
    {status === "ready" && result?.items.length === 0 && <p>No matching tasks or files.</p>}
    <div className="context-results">{(["task", "file"] as const).map((kind) => <section key={kind} hidden={!result?.items.some((item) => item.reference._tag === kind)} aria-label={kind === "task" ? "Tasks" : "Files"}>
      <h3>{kind === "task" ? "Tasks" : "Files"}</h3>{result?.items.filter((item) => item.reference._tag === kind).map((item) => {
      const key = referenceKey(item.reference)
      const checked = selection.some((row) => referenceKey(row.reference) === key)
      return <label key={key}><input type="checkbox" checked={checked} disabled={!checked && selection.length >= 16}
        onChange={() => setSelection((previous) => checked ? previous.filter((row) => referenceKey(row.reference) !== key) : [...previous, item])} />
        <span>{item.reference._tag === "task" ? "Task: " : "File: "}{visibleText(item.label)}</span></label>
    })}</section>)}</div>
    {result?.truncated && <p role="status">Only the first matching results are shown. Refine your search.</p>}
    <p>{selection.length} of 16 references selected.</p>
    <footer><button onClick={close}>Cancel</button><button onClick={() => { apply(selection); close() }}>Add selected context</button></footer>
  </dialog>
}
