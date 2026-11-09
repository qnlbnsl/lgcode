import { useEffect, useRef, useState } from "react"
import type { ProjectId, RequestId, WorkspaceId } from "@lgcode/contracts"
import { useMutationDisabled, useShellData } from "../data/ShellDataProvider.tsx"
import { shellHref } from "../routes.ts"
import { visibleText } from "../thread/text.tsx"
import { commandOutcome, requestId, useAdminApi } from "./api.ts"
import "./admin.css"

export function Machines({ onSessionExpired }: { readonly onSessionExpired: () => void }) {
  const data = useShellData()
  const offline = useMutationDisabled()
  const { run, busy, message, setMessage } = useAdminApi(onSessionExpired)
  const [uncertain, setUncertain] = useState(false)
  const pending = useRef<{ readonly requestId: RequestId; readonly projectId: ProjectId; readonly worktreeId: WorkspaceId } | undefined>(undefined)
  const selectedProject = new URLSearchParams(location.hash.split("?")[1]).get("project")
  const root = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!data.complete || selectedProject === null) return
    for (const control of root.current?.querySelectorAll<HTMLSelectElement>("select[data-placement]") ?? []) {
      if (control.dataset.placement === selectedProject) { control.focus(); break }
    }
  }, [data.complete, selectedProject])

  async function place(projectId?: ProjectId, worktreeId?: WorkspaceId) {
    if (busy || offline || !data.complete) return
    if (pending.current === undefined) {
      if (projectId === undefined || worktreeId === undefined) return
      const project = data.navigation?.projects.find((row) => row.projectId === projectId)
      const workspace = data.navigation?.workspaces.find((row) => row.worktreeId === worktreeId)
      if (project === undefined || workspace?.machineId !== "local" || workspace.repoId !== project.repoId || project.archiving
        || data.navigation?.agents.some((row) => row.projectId === projectId && !data.snapshot?.agents.some((agent) => agent.agentId === row.agentId && ["stopped", "crashed"].includes(agent.state._tag)))) return
      pending.current = { requestId: requestId(), projectId, worktreeId }
    }
    setUncertain(true)
    const reply = await run((client) => commandOutcome(client["project.place"](pending.current!)))
    if (reply === undefined) return
    pending.current = undefined
    setUncertain(false)
    data.retry()
    setMessage(reply._tag === "acknowledged" ? "Project placement saved. Its agents remain stopped."
      : "Placement was refused. Stop the project’s agents and refresh before choosing another checkout.")
  }
  const snapshot = data.snapshot
  const slots = snapshot === undefined || snapshot.agents.some((row) => row.capacityHeld === undefined) ? undefined
    : snapshot.agents.filter((row) => row.capacityHeld === true).length
  const projects = data.navigation?.projects
  return <section ref={root} className="admin-page" aria-label="Machines">
    <div className="admin-page-top"><h2>Machines</h2><button disabled={busy} onClick={data.retry}>Refresh machines</button></div>
    {message && <p role="status">{message}</p>}
    {offline && <p className="admin-note">Reconnect before changing placement.</p>}
    {!data.complete && <p role="status">Refreshing machine and project data. Last loaded facts may be out of date.</p>}
    {uncertain && <div className="admin-actions"><p>The placement result is uncertain. Retry the same change to recover its receipt.</p><button disabled={busy || offline || !data.complete} onClick={() => { void place() }}>Retry same placement</button></div>}
    <div className="admin-table-wrap"><table className="admin-table" aria-label="Machines"><thead><tr><th>Machine</th><th>Status</th><th>Role</th><th>Agent slots</th><th>Projects</th></tr></thead>
      <tbody><tr><td className="admin-record-name">This computer</td><td className="admin-record-status">{data.connection === "Live" ? "Connected" : data.connection}</td><td>Local service</td>
        <td>{slots === undefined ? "Unavailable" : `${slots} held · limit not reported`}</td><td>{projects === undefined || !data.complete ? "Unavailable" : `${projects.filter((row) => row.machineId === "local" && row.archivedAt === undefined).length} active projects`}</td></tr></tbody>
    </table></div>
    <p className="admin-note">Pairing, remote machines, and remote dispatch are not available yet.</p>
    <section className="admin-settings-section" aria-label="Project placement"><h3>Project placement</h3>
      <p className="admin-note">Stop a project’s agents before choosing another registered local checkout. This changes its assignment without moving running work.</p>
      {projects === undefined ? <p>Project placement has not loaded.</p> : projects.length === 0 ? <p>No projects.</p> : <div className="admin-table-wrap"><table className="admin-table" aria-label="Project placement">
        <thead><tr><th>Project</th><th>Repository</th><th>Branch</th><th>Checkout</th></tr></thead><tbody>{projects.map((project) => {
          const workspace = data.navigation?.workspaces.find((row) => row.worktreeId === project.worktreeId)
          const repository = data.navigation?.repositories.find((row) => row.repoId === project.repoId)
          const agents = data.navigation?.agents.filter((row) => row.projectId === project.projectId)
          const stopped = agents !== undefined && agents.every((row) => snapshot?.agents.some((agent) => agent.agentId === row.agentId && ["stopped", "crashed"].includes(agent.state._tag)))
          const choices = data.navigation?.workspaces.filter((row) => row.repoId === project.repoId && row.machineId === "local") ?? []
          const disabled = busy || offline || !data.complete || uncertain || !stopped || project.archiving === true || choices.length === 0
          return <tr key={project.projectId}><td className="admin-record-name"><a href={shellHref({ page: "project", projectId: project.projectId, tab: "settings" })}>{visibleText(project.name)}</a>{project.archivedAt !== undefined && <small>Archived</small>}</td>
            <td>{visibleText(repository?.name ?? "Repository unavailable")}</td><td><code>{visibleText(workspace?.branch ?? "Branch unavailable")}</code></td>
            <td className="admin-record-status"><label>Assigned checkout<select data-placement={project.projectId} aria-label={`Checkout for ${visibleText(project.name)}`} disabled={disabled}
              value={project.worktreeId} onChange={(event) => { void place(project.projectId, event.currentTarget.value as WorkspaceId) }}>
              {!choices.some((row) => row.worktreeId === project.worktreeId) && <option value={project.worktreeId}>Current checkout unavailable</option>}
              {choices.map((row) => <option value={row.worktreeId} key={row.worktreeId}>{visibleText(row.branch)} · {visibleText(row.path)}</option>)}
            </select></label>{!stopped && <small>Stop the project’s agents first.</small>}{project.archiving && <small>Finish archiving before changing placement.</small>}</td>
          </tr>
        })}</tbody></table></div>}
    </section>
  </section>
}
