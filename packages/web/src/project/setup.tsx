import * as Effect from "effect/Effect"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import type { Discovery, Project, ProjectId, ProjectSettings, RequestId, SetupState } from "@lgcode/contracts"
import { requestId, useAdminApi } from "../admin/api.ts"
import { visibleText } from "../thread/text.tsx"
import { setupHarnessGuidance } from "../setup-guidance.ts"
import { advanceSetup, changeSetupSettings, completeSetup, readSetup, setupCompletionRefused } from "./setupRead.ts"
import "./review.css"

type Step = SetupState["step"]
type SetupRead = { readonly setup: SetupState; readonly settings?: ProjectSettings; readonly discovery: typeof Discovery.Type; readonly projects: ReadonlyArray<Project> | undefined }

// Mounted only inside the authenticated owner session. The supplied project
// form remains mounted during Back so its single session-owned draft survives.
export function Setup({ renderProject, onOpenLead, onCompleted, onLogout, onSessionExpired }: {
  readonly renderProject: (onCreated: (project: Project) => void, disabled: boolean) => ReactNode
  readonly onOpenLead?: (project: Project) => void
  readonly onCompleted: (projectId?: ProjectId) => void; readonly onLogout: () => void
  readonly onSessionExpired: () => void
}) {
  const api = useAdminApi(onSessionExpired)
  const [read, setRead] = useState<SetupRead>()
  const [page, setPage] = useState<Step>("welcome")
  const [startedForm, setStartedForm] = useState(false)
  const [changingFolder, setChangingFolder] = useState(false)
  const [folder, setFolder] = useState("")
  const [shell, setShell] = useState("")
  const [name, setName] = useState("")
  const [notice, setNotice] = useState("")
  const [createdProject, setCreatedProject] = useState<ProjectId>()
  const nameEdited = useRef(false)
  const initialized = useRef(false)
  const finish = useRef<{ projectId: ProjectId; requestId: RequestId } | undefined>(undefined)
  const heading = useRef<HTMLHeadingElement>(null)
  const completed = useRef(onCompleted)
  completed.current = onCompleted
  const refresh = useCallback(async () => {
    const next = await api.run(readSetup)
    if (next === undefined) return
    if (next.setup.completedAt !== undefined) { completed.current(next.setup.projectId); return }
    setRead(next)
    if (!initialized.current) { initialized.current = true; setPage(next.setup.step) }
    if (next.setup.step === "project") setStartedForm(true)
    setFolder(next.settings?.workspaceFolder ?? "")
    setShell(next.settings?.shell ?? "")
    if (!nameEdited.current) setName(next.settings?.displayName ?? next.discovery.ownerNameSuggestion ?? "")
  }, [api.run])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { heading.current?.focus() }, [page])
  const go = async (step: Step) => {
    const order: Step[] = ["welcome", "found", "project"]
    if (read === undefined) return
    if (order.indexOf(step) <= order.indexOf(read.setup.step)) { setPage(step); if (step === "project") { setStartedForm(true); setRead({ ...read, projects: undefined }); await refresh() }; return }
    const next = await api.run((client) => advanceSetup(client, step))
    if (next !== undefined) { setRead({ ...read, setup: next, projects: undefined }); setPage(step); if (step === "project") { setStartedForm(true); await refresh() } }
  }
  const saveSettings = async (change: Partial<ProjectSettings>) => {
    const saved = await api.run((client) => changeSetupSettings(client, change))
    if (saved) { setChangingFolder(false); await refresh() }
    else if (saved === false) setNotice("Configure the workspace folder and shell in Service settings before continuing.")
  }
  const created = async (projectId: ProjectId) => {
    const attempt = finish.current ?? { projectId, requestId: requestId() }
    if (attempt.projectId !== projectId) return
    finish.current = attempt
    setCreatedProject(projectId)
    const outcome = await api.run((client) => Effect.gen(function* () {
      const result = yield* completeSetup(client, attempt).pipe(Effect.result)
      if (result._tag === "Success") return { setup: result.success, refused: false }
      if (yield* setupCompletionRefused(client, attempt.requestId)) return { setup: undefined, refused: true }
      return yield* Effect.fail(result.failure)
    }))
    if (outcome?.setup?.completedAt !== undefined) { finish.current = undefined; onCompleted(outcome.setup.projectId) }
    else {
      if (outcome?.refused) finish.current = undefined
      setNotice("Setup completion is unconfirmed. Your project has not been replaced. Open its lead’s conversation to review a failed start, then return and retry completion.")
    }
  }
  const discovery = read?.discovery
  const usable = discovery?.state === "available" && discovery.readyDefaults !== undefined
  const existing = read?.projects ?? []
  const recovered = existing.find((project) => project.projectId === createdProject) ?? (existing.length === 1 ? existing[0] : undefined)
  const completionId = createdProject ?? recovered?.projectId
  return <main className="review-page setup-page" aria-label="Set up LGcode"><header><p>Step {page === "welcome" ? 1 : page === "found" ? 2 : 3} of 3</p><button onClick={onLogout}>Log out</button></header>
    <h1 tabIndex={-1} ref={heading}>{page === "welcome" ? "LGcode" : page === "found" ? "Found on this computer" : "First project"}</h1>
    {api.message && <p role="alert">{api.message}</p>}{notice && <p role="status">{notice}</p>}
    {read === undefined && <><p role="status">Looking at this computer…</p><button disabled={api.busy} onClick={() => void refresh()}>Try again</button></>}
    {page === "welcome" && <><p>Runs teams of coding agents on your machines, and shows you where to look.</p><dl className="setup-pairs"><div><dt>You set the outcome.</dt><dd>The lead plans the sprints and brings in teams.</dd></div><div><dt>You answer what only you can.</dt><dd>LGcode shows you where you are needed.</dd></div><div><dt>You approve what users would notice.</dt><dd>Teams commit and merge inside their own branches.</dd></div></dl><button disabled={api.busy || read === undefined} onClick={() => void go("found")}>Get started</button></>}
    {page === "found" && discovery && <>
      {api.busy && <p role="status">Checking current discovery evidence…</p>}
      <p>LGcode only looked. Nothing here has changed.</p><h2>Harnesses</h2>
      <button disabled={api.busy} onClick={() => void refresh()}>Check again</button>
      <ul>{discovery.harnesses.map((row) => {
        const guidance = row.harness === "claude" || row.harness === "codex" || row.harness === "gemini" || row.harness === "cursor" ? setupHarnessGuidance[row.harness] : undefined
        return <li key={row.harness}><strong>{visibleText(row.harness)}</strong><span>{row.installed ? "Executable installed" : "Not installed"}</span>
          {guidance && <><p>{guidance.guidance}</p><a href={guidance.documentation} target="_blank" rel="noopener noreferrer">Installation and sign-in guidance for {visibleText(row.harness)}</a></>}
          <ul>{row.accounts.map((account) => <li key={account.accountId}>{visibleText(account.accountId)} · {account.state === "local-credential" ? "Local credential present" : account.state === "signed-out" ? "Signed out" : account.state === "missing-executable" ? "Executable missing" : "Credential evidence unavailable"} · Remote authentication not checked</li>)}</ul></li>
      })}</ul>
      <h2>Repositories{read?.settings?.workspaceFolder ? ` in ${visibleText(read.settings.workspaceFolder)}` : ""}</h2>
      <button disabled={api.busy} onClick={() => setChangingFolder(true)}>Change folder</button>
      {changingFolder && <form onSubmit={(event) => { event.preventDefault(); void saveSettings({ workspaceFolder: folder, ...(read?.settings === undefined ? { shell } : {}) }) }}><label>Folder<input required value={folder} onChange={(event) => setFolder(event.target.value)} /></label>{read?.settings === undefined && <label>Shell<input required value={shell} onChange={(event) => setShell(event.target.value)} /></label>}<button disabled={api.busy}>Look here</button><button type="button" onClick={() => setChangingFolder(false)}>Cancel</button></form>}
      {discovery.state === "unavailable" ? <p role="alert">Discovery unavailable. Retry or change the workspace folder.</p> : discovery.repositories.length === 0 ? <p>No repositories found in this folder.</p> : <ul>{discovery.repositories.map((row) => <li key={row.path}><strong>{visibleText(row.name)}</strong><code>{visibleText(row.path)}</code></li>)}</ul>}
      {discovery.truncated && <p>Discovery is incomplete. More entries may exist.</p>}
      <label>Your name<input value={name} onChange={(event) => { nameEdited.current = true; setName(event.target.value) }} onBlur={() => { if (nameEdited.current && name.trim()) void saveSettings({ displayName: name }) }} /></label>
      {!usable && <p role="status">A project needs available discovery and configured lead defaults with local readiness evidence. Check again after configuring them.</p>}
      <footer><button disabled={api.busy} onClick={() => void go("welcome")}>Back</button><button disabled={api.busy || !usable} onClick={() => void go("project")}>Continue</button></footer>
    </>}
    <div hidden={page !== "project"}>{startedForm && (existing.length === 0
      ? renderProject((project) => { void created(project.projectId) }, api.busy || read?.projects === undefined)
      : <section aria-label="Existing first project"><p>A project was already created. Continue with its existing lead before completing Setup.</p>
        {existing.length > 1 && <><p>Several projects exist. Choose the project to continue; none has been selected automatically.</p>
          {existing.map((project) => <button key={project.projectId} disabled={api.busy || finish.current !== undefined} onClick={() => setCreatedProject(project.projectId)}>Continue {visibleText(project.name)}</button>)}</>}
        {recovered && <><h2>{visibleText(recovered.name)}</h2><button disabled={api.busy} onClick={() => onOpenLead?.(recovered)}>Open lead conversation</button></>}
      </section>)}</div>
    {page === "project" && <footer><button disabled={api.busy} onClick={() => void go("found")}>Back</button>{completionId !== undefined && <button disabled={api.busy} onClick={() => void created(completionId)}>Retry completion</button>}{read?.projects === undefined && <button disabled={api.busy} onClick={() => void refresh()}>Check existing projects</button>}</footer>}
  </main>
}
