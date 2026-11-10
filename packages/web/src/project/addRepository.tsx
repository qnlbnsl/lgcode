import { useEffect, useId, useRef, useSyncExternalStore } from "react"
import type { Repository } from "@lgcode/contracts"
import { RepositoryRegistration } from "./registration.ts"
import "./review.css"

export function AddRepository({ registration, disabled = false, onRegistered, onCancel }: {
  readonly registration: RepositoryRegistration; readonly disabled?: boolean
  readonly onRegistered: (repository: Repository) => void; readonly onCancel: () => void
}) {
  const state = useSyncExternalStore(registration.subscribe, registration.getSnapshot)
  const id = useId(), heading = useRef<HTMLHeadingElement>(null)
  const returned = useRef<Repository | undefined>(undefined)
  useEffect(() => { if (state.open) heading.current?.focus() }, [state.open])
  useEffect(() => {
    if (state.open && state.phase === "registered" && state.result !== undefined && returned.current !== state.result) {
      returned.current = state.result; onRegistered(state.result)
    }
  }, [state.open, state.phase, state.result, onRegistered])
  if (!state.open) return null
  return <section className="review-page" aria-labelledby={`${id}-title`}><h2 ref={heading} tabIndex={-1} id={`${id}-title`}>Add repository to this computer</h2>
    <p>Register an existing Git checkout. This does not clone a repository or create a project.</p>
    <form onSubmit={(event) => { event.preventDefault(); if (!disabled) void registration.submit() }}>
      <fieldset disabled={disabled || state.busy || state.attempt !== undefined}>
        <label>Name<input required maxLength={128} value={state.name} readOnly={state.repository !== undefined} onChange={(event) => registration.update({ name: event.target.value })} /></label>
        <label>Existing checkout folder<input required value={state.path} onChange={(event) => registration.update({ path: event.target.value })} /></label>
      </fieldset>
      {state.message && <p role="status">{state.message}</p>}
      {state.phase === "uncertain" && <p>The name, folder, and request stay locked until this operation is confirmed or refused.</p>}
      <footer><button type="button" disabled={state.busy} onClick={() => { registration.close(); onCancel() }}>Cancel</button>
        {state.phase === "registered" && state.result ? <button type="button" onClick={() => onRegistered(state.result!)}>Return to New project</button>
          : <button disabled={disabled || state.busy || !state.name.trim() || !state.path.trim()}>{state.attempt === undefined ? "Register checkout" : "Check same registration"}</button>}</footer>
    </form>
  </section>
}
