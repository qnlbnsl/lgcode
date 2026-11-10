import { useEffect, useRef } from "react"
import { useShellData } from "../data/ShellDataProvider.tsx"
import { shellHref } from "../routes.ts"
import { visibleText } from "../thread/text.tsx"
import "./admin.css"

export function Machines(_props: { readonly onSessionExpired: () => void }) {
  const data = useShellData()
  const selectedProject = new URLSearchParams(location.hash.split("?")[1]).get("project")
  const root = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!data.complete || selectedProject === null) return
    for (const control of root.current?.querySelectorAll<HTMLTableRowElement>("tr[data-placement]") ?? []) {
      if (control.dataset.placement === selectedProject) { control.focus(); break }
    }
  }, [data.complete, selectedProject])

  const snapshot = data.snapshot
  const slots = snapshot === undefined || snapshot.agents.some((row) => row.capacityHeld === undefined) ? undefined
    : snapshot.agents.filter((row) => row.capacityHeld === true).length
  const projects = data.navigation?.projects
  return <section ref={root} className="admin-page" aria-label="Machines">
    <div className="admin-page-top"><h2>Machines</h2><button onClick={data.retry}>Refresh machines</button></div>
    {!data.complete && <p role="status">Refreshing machine and project data. Last loaded facts may be out of date.</p>}
    <div className="admin-table-wrap"><table className="admin-table" aria-label="Machines"><thead><tr><th>Machine</th><th>Status</th><th>Role</th><th>Agent slots</th><th>Projects</th></tr></thead>
      <tbody><tr><td className="admin-record-name">This computer</td><td className="admin-record-status">{data.connection === "Live" ? "Connected" : data.connection}</td><td>Local service</td>
        <td>{slots === undefined ? "Unavailable" : `${slots} held · limit not reported`}</td><td>{projects === undefined || !data.complete ? "Unavailable" : `${projects.filter((row) => row.machineId === "local" && row.archivedAt === undefined).length} active projects`}</td></tr></tbody>
    </table></div>
    <p className="admin-note">Pairing, remote machines, and remote dispatch are not available yet.</p>
    <section className="admin-settings-section" aria-label="Project placement"><h3>Project placement</h3>
      <p className="admin-note">Projects keep their assigned checkout. Changing to another checkout or machine requires machine pairing, which is not available yet.</p>
      {projects === undefined ? <p>Project placement has not loaded.</p> : projects.length === 0 ? <p>No projects.</p> : <div className="admin-table-wrap"><table className="admin-table" aria-label="Project placement">
        <thead><tr><th>Project</th><th>Repository</th><th>Branch</th><th>Checkout</th></tr></thead><tbody>{projects.map((project) => {
          const workspace = data.navigation?.workspaces.find((row) => row.worktreeId === project.worktreeId)
          const repository = data.navigation?.repositories.find((row) => row.repoId === project.repoId)
          return <tr key={project.projectId} data-placement={project.projectId} tabIndex={-1}><td className="admin-record-name"><a href={shellHref({ page: "project", projectId: project.projectId, tab: "settings" })}>{visibleText(project.name)}</a>{project.archivedAt !== undefined && <small>Archived</small>}</td>
            <td>{visibleText(repository?.name ?? "Repository unavailable")}</td><td><code>{visibleText(workspace?.branch ?? "Branch unavailable")}</code></td>
            <td className="admin-record-status">{visibleText(workspace?.path ?? "Current checkout unavailable")}</td>
          </tr>
        })}</tbody></table></div>}
    </section>
  </section>
}
