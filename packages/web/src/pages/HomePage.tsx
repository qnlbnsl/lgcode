import { useEffect, useId, useRef, useState } from "react"
import type { Project } from "@lgcode/contracts"
import type { ShellRoute } from "../routes.ts"
import { shellHref } from "../routes.ts"
import { useShellData } from "../data/ShellDataProvider.tsx"
import { FailedStartList, RequestList, byRequestAge } from "../requests/RequestList.tsx"
import { visibleText } from "../thread/text.tsx"
import { Empty, ReadState, agentName } from "./common.tsx"
import { ownerRequests } from "./projectData.ts"
import "./pages.css"
import { Icon } from "../shell/Icon.tsx"

const tabs = [["attention", "Needs attention", "Attention"], ["projects", "All projects", "Projects"], ["questions", "Questions", "Questions"], ["approvals", "Approvals", "Approvals"]] as const
type HomeTab = typeof tabs[number][0]
const currentTab = (): HomeTab => {
  const value = new URLSearchParams(location.hash.split("?")[1]).get("view")
  return tabs.some(([key]) => key === value) ? value as HomeTab : "attention"
}

export function ProjectTable({ projects }: { readonly projects: readonly Project[] }) {
  const { requests = [], navigation, snapshot } = useShellData()
  return <div className="task-table-wrap"><table className="project-table" aria-label="Projects"><thead><tr><th>Project</th><th>Lead</th><th>Status</th><th>Machine</th><th>Branch</th></tr></thead>
    <tbody>{projects.map((project) => {
      const count = ownerRequests(requests).filter((row) => row.projectId === project.projectId).length
      const members = new Set(navigation?.agents.filter((row) => row.projectId === project.projectId).map((row) => row.agentId))
      const failed = snapshot?.agents.some((agent) => members.has(agent.agentId) && agent.startFailure !== undefined)
      const workspace = navigation?.workspaces.find((row) => row.worktreeId === project.worktreeId)
      return <tr key={project.projectId}><td><a href={shellHref({ page: "project", projectId: project.projectId, tab: "board" })}>{visibleText(project.name)}</a>
        <small className="repo-caption">{visibleText(navigation?.repositories.find((row) => row.repoId === project.repoId)?.name ?? project.repoId)}</small></td>
        <td><a href={shellHref({ page: "thread", agentId: project.leadAgentId })}>{agentName(snapshot?.agents, project.leadAgentId)}</a></td>
        <td className={`stack-status ${count || failed ? "project-attention-status" : ""}`}>{project.archiving ? "Archiving" : project.archivedAt !== undefined ? "Archived" : failed ? "Failed start" : count ? `${count} need${count === 1 ? "s" : ""} attention` : "Ready"}</td>
        <td>{visibleText(project.machineId)}</td><td><code title={visibleText(workspace?.branch ?? "")}>{visibleText(workspace?.branch ?? "Unavailable")}</code></td></tr>
    })}</tbody></table></div>
}

export function HomePage({ route, onNewProject }: { readonly route: ShellRoute; readonly onNewProject?: () => void }) {
  const data = useShellData()
  const [tab, setTab] = useState<HomeTab>(currentTab)
  const [search, setSearch] = useState("")
  const [filters, setFilters] = useState({ repo: "", project: "", agent: "", machine: "" })
  const [filterOpen, setFilterOpen] = useState(false)
  const [newest, setNewest] = useState(false)
  const filterButton = useRef<HTMLButtonElement>(null)
  const firstFilter = useRef<HTMLSelectElement>(null)
  const instance = useId()
  useEffect(() => {
    const sync = () => setTab(currentTab())
    window.addEventListener("hashchange", sync)
    window.addEventListener("popstate", sync)
    return () => { window.removeEventListener("hashchange", sync); window.removeEventListener("popstate", sync) }
  }, [])
  useEffect(() => { if (filterOpen) firstFilter.current?.focus() }, [filterOpen])
  if (route.page !== "home") return null
  const navigation = data.navigation
  const rows = data.requests ?? []
  const projects = navigation?.projects ?? []
  const active = ownerRequests(rows)
  const failures = data.snapshot?.agents.filter((row) => row.startFailure !== undefined) ?? []
  const filtered = search !== "" || Object.values(filters).some(Boolean)
  const clear = () => { setSearch(""); setFilters({ repo: "", project: "", agent: "", machine: "" }) }
  const matches = (project: Project | undefined, agentId?: string, text = "") => {
    if (filters.repo && project?.repoId !== filters.repo || filters.project && project?.projectId !== filters.project
      || filters.machine && project?.machineId !== filters.machine || filters.agent && (agentId === undefined
        ? !navigation?.agents.some((agent) => agent.agentId === filters.agent && agent.projectId === project?.projectId) : agentId !== filters.agent)) return false
    return `${project?.name ?? ""} ${project?.machineId ?? ""} ${text}`.toLowerCase().includes(search.toLowerCase())
  }
  const selected = rows.filter((row) => (tab === "questions" ? row.kind === "question" : tab === "approvals" ? row.kind === "permission" : true)
    && matches(projects.find((project) => project.projectId === row.projectId), row.agentId,
      `${row.display?.title ?? ""} ${row.display?.preview ?? ""} ${agentName(data.snapshot?.agents, row.agentId)}`))
  const open = selected.filter((row) => row.status === "open" && row.holder._tag === "owner").sort((a, b) => (newest ? -1 : 1) * byRequestAge(a, b))
  const closed = selected.filter((row) => row.status !== "open").sort((a, b) => (b.answeredAt ?? 0) - (a.answeredAt ?? 0))
  const failed = failures.filter((agent) => {
    const membership = navigation?.agents.find((row) => row.agentId === agent.agentId)
    return matches(projects.find((row) => row.projectId === membership?.projectId), agent.agentId, agent.name)
  })
  const chooseTab = (value: HomeTab) => { setTab(value); history.pushState({}, "", `/#/?view=${value}`) }
  return <section className="pages home-view" aria-label="Home">
    <div className="home-tab-row"><nav className="home-tabs" role="tablist" aria-label="Home views" onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
      event.preventDefault()
      const index = tabs.findIndex(([key]) => key === tab)
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length
      chooseTab(tabs[next]![0])
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus()
    }}>{tabs.map(([key, label, short]) => <button key={key} role="tab" id={`${instance}-${key}`} aria-controls={`${instance}-results`}
      tabIndex={tab === key ? 0 : -1} aria-selected={tab === key} onClick={() => chooseTab(key)}>
      <span className="tab-long">{label}</span><span className="tab-short">{short}</span>
      <small>{data.complete ? key === "projects" ? projects.length : key === "attention" ? active.length + failures.length : active.filter((row) => row.kind === (key === "questions" ? "question" : "permission")).length : "…"}</small>
    </button>)}</nav>{onNewProject && <button onClick={onNewProject}>New project</button>}</div>
    <div className="home-toolbar"><label className="home-search-label"><span className="sr-only">Search Home</span><input aria-label="Search Home" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" /></label>
      <button ref={filterButton} aria-expanded={filterOpen} aria-controls={`${instance}-filters`} onClick={() => setFilterOpen(!filterOpen)}>Filter{Object.values(filters).filter(Boolean).length ? ` (${Object.values(filters).filter(Boolean).length})` : ""}</button>
      {tab !== "projects" && <label className="home-sort">Sort<select value={newest ? "newest" : "oldest"} onChange={(event) => setNewest(event.target.value === "newest")}><option value="oldest">Oldest first</option><option value="newest">Newest first</option></select></label>}
      {filterOpen && <div id={`${instance}-filters`} className="home-filter-menu" onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); setFilterOpen(false); filterButton.current?.focus() }
      }}>{(["repo", "project", "agent", "machine"] as const).map((field, index) => {
        const options = field === "repo" ? navigation?.repositories.map((row) => [row.repoId, row.name])
          : field === "project" ? projects.filter((row) => !filters.repo || row.repoId === filters.repo).map((row) => [row.projectId, row.name])
          : field === "agent" ? data.snapshot?.agents.filter((agent) => !filters.project || navigation?.agents.some((row) => row.agentId === agent.agentId && row.projectId === filters.project)).map((row) => [row.agentId, row.name])
          : [...new Set(projects.map((row) => row.machineId))].map((id) => [id, id])
        return <label key={field}>{({ repo: "Repository", project: "Project", agent: "Agent", machine: "Machine" })[field]}<select ref={index === 0 ? firstFilter : undefined}
          value={filters[field]} onChange={(event) => setFilters({ ...filters, [field]: event.target.value,
            ...(field === "repo" ? { project: "", agent: "" } : field === "project" ? { agent: "" } : {}) })}>
          <option value="">All</option>{options?.map(([id, name]) => <option key={id} value={id}>{visibleText(name!)}</option>)}</select></label>
      })}</div>}
    </div>
    {filtered && <div className="home-chips">{Object.entries(filters).filter(([, value]) => value).map(([field, value]) => <button key={field} aria-label={`Remove ${field} filter`} onClick={() => setFilters({ ...filters, [field]: "" })}>{field}: {visibleText(value)} <Icon name="x" /></button>)}<button onClick={clear}>Clear filters</button></div>}
    <section id={`${instance}-results`} className="home-results" role="tabpanel" aria-labelledby={`${instance}-${tab}`} tabIndex={-1}>
      {!data.complete && navigation !== undefined && <p role="status">Showing the last received data. <button onClick={data.retry}>Refresh</button></p>}
      {navigation === undefined || data.requests === undefined ? <ReadState failed={data.connection === "Offline"} /> : tab === "projects"
        ? (() => { const values = projects.filter((project) => matches(project, undefined, `${agentName(data.snapshot?.agents, project.leadAgentId)} ${navigation.repositories.find((repo) => repo.repoId === project.repoId)?.name ?? ""}`))
          return values.length ? <ProjectTable projects={values} /> : <Empty action={filtered ? <button onClick={clear}>Clear filters</button> : undefined}>{filtered ? "No matching projects." : "No projects yet."}</Empty> })()
        : <>{tab === "attention" && <FailedStartList agents={failed} />}
          <RequestList requests={open} empty={tab === "attention" && failed.length ? null : <Empty action={filtered ? <button onClick={clear}>Clear filters</button> : undefined}>{filtered ? "No matching requests." : "No open requests."}</Empty>} />
          {tab !== "attention" && closed.length > 0 && <details className="home-answered"><summary>Answered ({closed.length})</summary><RequestList requests={closed} /></details>}
        </>}
    </section>
  </section>
}
