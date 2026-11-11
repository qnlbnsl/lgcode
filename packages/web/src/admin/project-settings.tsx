import { useEffect, useRef, useState, type FormEvent } from "react"
import { Project, type RequestId } from "@lgcode/contracts"
import * as Schema from "effect/Schema"
import type { Client } from "@lgcode/client/browser"
import { useMutationDisabled, useShellData } from "../data/ShellDataProvider.tsx"
import { shellHref, type ShellRoute } from "../routes.ts"
import { visibleText } from "../thread/text.tsx"
import { commandOutcome, requestId, useAdminApi } from "./api.ts"
import { AdminConfirm } from "./confirm.tsx"
import "./admin.css"

type Route = Extract<ShellRoute, { page: "project" }>
type Change =
  | { readonly kind: "rename"; readonly name: string }
  | { readonly kind: "goal"; readonly goal: string }
  | { readonly kind: "shell"; readonly shell: string }
  | { readonly kind: "archive" | "restore" }
type Pending = Change & { readonly requestId: RequestId }

export function ProjectSettingsPage({ route }: { readonly route: ShellRoute }) {
  if (route.page !== "project") return null
  return <ProjectSettings key={route.projectId} route={route} />
}
function ProjectSettings({ route }: { readonly route: Route }) {
  const data = useShellData()
  const offline = useMutationDisabled()
  const { run, busy, message, setMessage } = useAdminApi(data.onSessionExpired)
  const [canonical, setCanonical] = useState<Project>()
  const [stale, setStale] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const pending = useRef<Pending | undefined>(undefined)
  const project = canonical ?? data.navigation?.projects.find((row) => row.projectId === route.projectId)
  const repository = data.navigation?.repositories.find((row) => row.repoId === project?.repoId)
  // The workspace picker can inspect a different checkout. These facts always
  // describe the project's assignment, including when a team route is open.
  const workspace = data.navigation?.workspaces.find((row) => row.worktreeId === project?.worktreeId)
  const locked = busy || offline || !data.complete || stale || uncertain || project?.archiving === true

  async function load() {
    const reply = await run((client) => client["project.read"]({ requestId: requestId(), projectId: route.projectId, collection: "projects", limit: 1 }))
    if (reply !== undefined && "items" in reply) {
      const row = reply.items.find((item) => Schema.is(Project)(item) && item.projectId === route.projectId)
      if (row !== undefined && Schema.is(Project)(row)) {
        setCanonical(row)
        setStale(false)
        return true
      }
    }
    setStale(true)
    return false
  }
  useEffect(() => {
    // A shared watcher update is authoritative after its complete read. Drop a
    // private post-write read so later mutations cannot be hidden by it.
    if (data.complete) setCanonical(undefined)
  }, [data.navigation, data.complete])

  const command = (client: Client, action: Pending) => {
    const common = { requestId: action.requestId, projectId: route.projectId }
    switch (action.kind) {
      case "rename": return client["project.rename"]({ ...common, name: action.name })
      case "goal": return client["project.goal.set"]({ ...common, goal: action.goal })
      case "shell": return client["project.preferences.set"]({ ...common, shell: action.shell })
      case "archive": return client["project.archive"](common)
      case "restore": return client["project.restore"](common)
    }
  }
  async function write(change?: Change) {
    if (busy || offline || !data.complete || project === undefined) return
    if (pending.current === undefined) {
      if (change === undefined || stale || project.archiving && change.kind !== "archive") return
      pending.current = { ...change, requestId: requestId() }
    }
    setConfirmArchive(false)
    setUncertain(true)
    const action = pending.current
    const reply = await run((client) => commandOutcome(command(client, action)))
    if (reply === undefined) {
      await load()
      setMessage("Could not confirm the project change. Retry the same action to recover its result.")
      return
    }
    if (reply._tag === "refused") {
      // An unfinished archive keeps its identity and can retry failed stops.
      if (action.kind !== "archive") { pending.current = undefined; setUncertain(false) }
      await load()
      data.retry()
      setMessage(action.kind === "archive" ? "Archiving is unfinished. Review the project and retry the same archive."
        : "The project change was refused. Refresh and review the current project before trying again.")
      return
    }
    pending.current = undefined
    setUncertain(false)
    await load()
    data.retry()
    setMessage(action.kind === "restore" ? "Project restored. Its agents remain stopped."
      : action.kind === "archive" ? "Project archived. All projects still lists it."
      : "Project settings saved.")
  }
  function save(event: FormEvent<HTMLFormElement>, kind: "rename" | "goal") {
    event.preventDefault()
    if (locked || project === undefined) return
    const value = (event.currentTarget.elements.namedItem(kind) as HTMLInputElement | HTMLTextAreaElement).value
    if (kind === "rename") {
      if (value.trim() === project.name) return
      void write({ kind, name: value })
    } else if (value !== project.goal) void write({ kind, goal: value })
  }
  return <section className="admin-page" aria-label="Project settings">
    <div className="admin-page-top"><h2>Project settings</h2><div className="admin-actions">
      <button disabled={busy} onClick={() => { void load(); data.retry() }}>Refresh project settings</button>
      {project && (project.archivedAt !== undefined ? <button className="admin-primary" disabled={locked} onClick={() => { void write({ kind: "restore" }) }}>Restore</button>
        : <button disabled={locked} onClick={() => setConfirmArchive(true)}>Archive</button>)}
    </div></div>
    {message && <p role="status">{message}</p>}
    {offline && <p className="admin-note">Reconnect before changing project settings.</p>}
    {!data.complete && <p className="admin-note">Refreshing project data. Changes are unavailable until the read completes.</p>}
    {stale && <p className="admin-warning">The project could not be refreshed. The last loaded facts may be out of date.</p>}
    {uncertain && <div className="admin-actions"><p>The previous action still needs confirmation.</p><button disabled={busy || offline || !data.complete} onClick={() => { void write() }}>Retry same action</button></div>}
    {project === undefined ? <p role="status">{data.complete ? "Project not found." : "Loading project settings…"}</p> : <>
      {project.archiving && <p className="admin-warning">Archiving is unfinished. Some agents may already be stopped. Restore is unavailable until archiving finishes.</p>}
      {project.archiving && !uncertain && <button disabled={busy || offline || !data.complete} onClick={() => { void write({ kind: "archive" }) }}>Retry archive</button>}
      {project.archivedAt !== undefined && <p>Archived {new Date(project.archivedAt).toLocaleString()}. All projects still lists it.</p>}
      <section className="admin-settings-section"><h3>Project</h3>
        <form aria-label="Rename project" key={`name-${project.name}`} onSubmit={(event) => save(event, "rename")}>
          <fieldset disabled={locked}><label>Project name<input name="rename" defaultValue={project.name} required maxLength={128} /></label><div><button type="submit">Rename</button></div></fieldset>
        </form>
        <form aria-label="Project goal" key={`goal-${project.goal}`} onSubmit={(event) => save(event, "goal")}>
          <fieldset disabled={locked}><label>Goal<textarea name="goal" defaultValue={project.goal} maxLength={8192} /></label><div><button type="submit">Save goal</button></div></fieldset>
        </form>
      </section>
      <section className="admin-settings-section"><h3>Where this project runs</h3>
        <dl className="admin-facts"><dt>Repository</dt><dd>{visibleText(repository?.name ?? "Repository unavailable")}</dd>
          <dt>Branch</dt><dd><code>{visibleText(workspace?.branch ?? "Branch unavailable")}</code></dd>
          <dt>Checkout</dt><dd>{workspace?.checkout === "main" ? "Main checkout" : workspace?.checkout === "worktree" ? "Project worktree" : "Checkout type unavailable"}</dd>
          <dt>Folder</dt><dd><code>{visibleText(workspace?.path ?? "Folder unavailable")}</code></dd>
          <dt>Machine</dt><dd>{project.machineId === "local" ? "This computer" : visibleText(project.machineId)} · <a href={`${shellHref({ page: "service", service: "machines" })}?project=${encodeURIComponent(project.projectId)}`}>Change placement</a></dd>
        </dl>
      </section>
      <section className="admin-settings-section"><h3>Terminal</h3>
        <label>Preferred shell<select aria-label="Preferred shell" disabled={locked} value={project.shell ?? "default"} onChange={(event) => { void write({ kind: "shell", shell: event.currentTarget.value }) }}>
          {project.shell !== undefined && !["default", "bash", "zsh"].includes(project.shell) && <option value={project.shell}>{visibleText(project.shell)}</option>}
          <option value="default">Machine default</option><option value="bash">Bash</option><option value="zsh">Zsh</option>
        </select></label><p className="admin-note">Used for new terminal sessions in this project’s worktree.</p>
      </section>
    </>}
    {confirmArchive && <AdminConfirm title="Archive this project?" confirm="Archive" busy={busy} disabled={offline || !data.complete} onCancel={() => setConfirmArchive(false)} onConfirm={() => { void write({ kind: "archive" }) }}>
      <p>LGcode stops the project’s agents before archiving it. The sidebar and Home leave it out. All projects still lists it.</p>
      <p>Restoring the project does not resume its agents.</p>
    </AdminConfirm>}
  </section>
}
