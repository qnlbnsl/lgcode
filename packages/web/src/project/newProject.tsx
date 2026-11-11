import { useEffect, useId, useRef, useSyncExternalStore } from "react"
import type { Project } from "@lgcode/contracts"
import { visibleText } from "../thread/text.tsx"
import { NewProjectSession } from "./creation.ts"
import "./newProject.css"

export interface NewProjectProps {
  readonly creation: NewProjectSession
  readonly presentation?: "dialog" | "setup"
  readonly disabled?: boolean
  readonly onAddRepository: () => void
  readonly onSettings: () => void
  readonly onCreated: (project: Project) => void
  readonly onOpenLead?: (project: Project) => void
}

// Home and setup render exactly this form, using the same session instance.
// A setup mount renders inline; the ordinary mount uses native modal focus,
// background inertness, and Escape. No protected data enters browser storage.
export function NewProjectDialog({ creation, presentation = "dialog", disabled = false, onAddRepository, onSettings, onCreated, onOpenLead = onCreated }: NewProjectProps) {
  const state = useSyncExternalStore(creation.subscribe, creation.getSnapshot)
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const focus = useRef<HTMLSelectElement>(null)
  const delivered = useRef<Project["projectId"] | undefined>(undefined)
  const inline = presentation === "setup"
  useEffect(() => {
    if (inline) return
    if (state.open && !dialog.current?.open) { dialog.current?.showModal(); focus.current?.focus() }
    else if (!state.open && dialog.current?.open) dialog.current.close()
  }, [state.open, inline])
  useEffect(() => {
    if (state.phase !== "created" || state.project === undefined || delivered.current === state.project.projectId) return
    delivered.current = state.project.projectId
    onCreated(state.project)
  }, [state.phase, state.project, onCreated])
  const draft = state.draft, locked = state.attempt !== undefined
  const planned = state.pending.find((row) => row.requestId === state.attempt?.requestId)
  const lead = planned?.lead ?? state.discovery?.readyDefaults
  const ready = state.loaded && state.discovery?.readyDefaults !== undefined && state.settings !== undefined
  const canCreate = !disabled && !state.busy && ready && state.previewState === "ready" && state.pending.length === 0 && !locked
  const repositoryValue = draft.repository?._tag === "new" ? "__new" : draft.repository?._tag === "existing" ? draft.repository.repoId : ""
  const retry = locked && (state.phase === "uncertain" || state.phase === "refused")
  const body = <form onSubmit={(event) => { event.preventDefault(); if (!disabled) void creation.start() }}>
    <header><h2 id={`${id}-title`}>{inline ? "First project" : "New project"}</h2>
      {!inline && <button type="button" aria-label="Close project setup" onClick={creation.close}>×</button>}</header>
    <p>The project’s lead turns your goal into sprints and teams.</p>
    <fieldset disabled={disabled || locked || state.busy}>
      <label htmlFor={`${id}-repository`}>Repository</label>
      <select id={`${id}-repository`} value={repositoryValue} onChange={(event) => {
        const value = event.currentTarget.value
        if (value === "__new") creation.update({ repository: { _tag: "new", name: "" } })
        else {
          const repository = state.repositories.find((row) => row.repoId === value)
          if (repository) creation.update({ repository: { _tag: "existing", repoId: repository.repoId } })
        }
      }}>
        <option value="" disabled>{state.loaded ? "Choose a repository" : "Repositories unavailable"}</option>
        {state.repositories.map((row) => <option value={row.repoId} key={row.repoId}>{visibleText(row.name)}</option>)}
        <option value="__new">New repository…</option>
      </select>
      {draft.repository?._tag === "new" && <><label htmlFor={`${id}-repository-name`}>Repository name</label>
        <input id={`${id}-repository-name`} required maxLength={128} value={draft.repository.name} placeholder="billing-api"
          onChange={(event) => creation.update({ repository: { _tag: "new", name: event.currentTarget.value } })} /></>}
      <button className="inline-link" type="button" onClick={() => { creation.addRepository(); onAddRepository() }}>Add repository</button>
      <label htmlFor={`${id}-machine`}>Run on</label>
      <select ref={focus} id={`${id}-machine`} value={draft.machineId} disabled={disabled || locked || !state.loaded}
        onChange={(event) => creation.update({ machineId: event.currentTarget.value })}>
        {draft.machineId !== "local" && <option value={draft.machineId}>{visibleText(draft.machineId)} · Unavailable</option>}
        <option value="local">This computer{!state.loaded ? " · Unavailable" : ""}</option>
      </select>
      <label htmlFor={`${id}-name`}>Project name</label>
      <input id={`${id}-name`} required maxLength={128} placeholder="Billing export" value={draft.name} onChange={(event) => creation.update({ name: event.currentTarget.value })} />
      {!inline && <><label htmlFor={`${id}-goal`}>Goal</label>
      <input id={`${id}-goal`} maxLength={8192} placeholder="Optional. What should this project achieve?" value={draft.goal}
        onChange={(event) => creation.update({ goal: event.currentTarget.value })} /></>}
    </fieldset>
    {state.loading && <p role="status">Reading this computer, repositories, and lead readiness…</p>}
    {state.loaded && state.repositories.length === 0 && <p>No repositories are registered. Choose New repository or Add repository above.</p>}
    {state.loaded && !ready && <div role="status"><p>{state.settings === undefined ? "Set the workspace folder before creating a project."
      : "No ready lead defaults are available. Configure an executable harness, its account, and valid model and effort choices."}</p>
      <button className="inline-link" type="button" onClick={onSettings}>Open Settings</button></div>}
    {lead && <div className="new-project-lead"><p>{planned ? "Planned lead subscription" : "Lead subscription"}: {visibleText(lead.harness)}
      {lead.account._tag === "named" && <> · {visibleText(lead.account.accountId)}</>}{lead.model && <> · {visibleText(lead.model)}</>}{lead.effort && <> · {visibleText(lead.effort)}</>}</p>
      {!locked && <button className="inline-link" type="button" onClick={onSettings}>Change lead defaults in Settings</button>}
      <p>Local readiness only. Provider authentication is checked when the lead starts.</p></div>}
    <div role="status" aria-label="Project placement" className="new-project-preview">
      {state.previewState === "ready" && state.preview !== undefined ? <><dl><dt>Branch</dt><dd><code>{visibleText(state.preview.branch)}</code></dd>
        <dt>Folder</dt><dd><code>{visibleText(state.preview.path)}</code></dd></dl>
        <p>This preview reserves nothing. Creation checks the current branches and folders again.</p></>
        : state.previewState === "loading" ? <p>Checking placement…</p>
        : state.previewState === "unavailable" ? <p>{state.previewReason === "repository location not found"
          ? `This computer does not have ${visibleText(state.repositories.find((row) => draft.repository?._tag === "existing" && row.repoId === draft.repository.repoId)?.name ?? "this repository")}.`
          : `Placement is unavailable${state.previewReason ? `: ${visibleText(state.previewReason)}` : ". Check the name, repository on this computer, and lead settings."}`} <button className="inline-link" type="button" onClick={() => { creation.addRepository(); onAddRepository() }}>Add repository</button></p>
        : draft.repository?._tag === "new" && !draft.repository.name.trim() ? <p>Name the repository to see where it will go.</p>
        : <p>Choose a repository and project name to see where it will go.</p>}
    </div>
    {state.pending.length > 0 && <section aria-label="Unfinished project creations"><h3>Unfinished project creations</h3>
      {state.pending.map((row) => <p key={row.requestId}>{visibleText(row.name)} · {visibleText(row.workspace.branch)}<br /><code>{visibleText(row.workspace.path)}</code></p>)}
      {!planned && <p>The engine retained these plans. Their original request bodies are not available in this page session. Resolve the original operation before starting another project.</p>}
    </section>}
    {state.message && <p role="alert">{state.message}</p>}
    <footer>
      {!inline && <button type="button" className="secondary" onClick={creation.close}>Cancel</button>}
      <button type="button" disabled={state.loading || state.busy || disabled} onClick={() => { void creation.refresh() }}>Refresh</button>
      {state.phase === "refused" && !planned && <button type="button" disabled={state.busy || disabled} onClick={creation.correctRefusal}>Correct form</button>}
      {retry ? <button type="button" className="primary" disabled={state.busy || disabled} onClick={() => { void creation.start() }}>Check same creation</button>
        : state.phase === "created" && state.project !== undefined ? <button type="button" className="primary" onClick={() => onOpenLead(state.project!)}>Open lead conversation</button>
        : <button type="submit" className="primary" disabled={!canCreate}>{state.busy ? "Creating project…" : "Create project"}</button>}
    </footer>
  </form>
  return inline ? <section className="new-project" aria-labelledby={`${id}-title`}>{body}</section>
    : <dialog ref={dialog} className="new-project" aria-labelledby={`${id}-title`} onKeyDown={(event) => {
      if (event.defaultPrevented || event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>("a[href],button,input,select,textarea,[tabindex]")]
        .filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && !element.closest("[hidden],[inert]")
          && element.getClientRects().length > 0 && getComputedStyle(element).visibility === "visible")
      const first = items[0], last = items.at(-1)
      if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
        event.preventDefault()
        ;(event.shiftKey ? last : first)?.focus()
      }
    }} onClose={creation.restoreFocus} onCancel={(event) => { event.preventDefault(); creation.close() }}>{body}</dialog>
}
