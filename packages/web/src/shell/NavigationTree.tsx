import { useCallback, useEffect, useRef, useState } from "react"
import type { AgentId, ClientSnapshot } from "@lgtm/contracts"
import { displayedState } from "@lgtm/contracts"
import { useShellData } from "../data/ShellDataProvider.tsx"
import { scopeKey, shellHref, type ShellRoute, type WorkspaceTab } from "../routes.ts"
import { visibleText } from "../thread/text.tsx"
import { Icon } from "./Icon.tsx"
import { attentionItems, projectAgentIds, selectedScope, teamAgents } from "./model.ts"
import { readPreference } from "./preferences.ts"

export function rememberedTab(projectId: string, teamId?: string): WorkspaceTab {
  const value = readPreference(`lgtm-tab:${scopeKey(projectId, teamId)}`)
  return value === "chat" || value === "git" || value === "terminal" || value === "settings" || value === "tasks" && teamId !== undefined
    ? value : teamId === undefined ? "board" : "chat"
}
export function NavigationTree({ route, attentionOnly }: { readonly route: ShellRoute; readonly attentionOnly: boolean }) {
  const { snapshot, navigation, requests, complete, retry } = useShellData()
  const scope = selectedScope(route, navigation, snapshot)
  const [folded, setFolded] = useState(new Set<string>())
  const tree = useRef<HTMLDivElement>(null)
  const updateFade = useCallback(() => {
    const element = tree.current
    if (!element) return
    element.classList.toggle("more-above", element.scrollTop > 2)
    element.classList.toggle("more-below", element.scrollHeight - element.clientHeight - element.scrollTop > 2)
  }, [])
  useEffect(() => {
    updateFade()
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updateFade)
    if (tree.current) observer?.observe(tree.current)
    return () => observer?.disconnect()
  }, [navigation, folded, updateFade])
  const attention = attentionItems(snapshot, requests)
  const needing = new Set(attention.map((item) => item.agentId))
  useEffect(() => {
    setFolded((previous) => {
      const next = new Set(previous)
      if (scope.repository) next.delete(`repo:${scope.repository.repoId}`)
      if (scope.project) next.delete(`project:${scope.project.projectId}`)
      if (scope.team) next.delete(`team:${scopeKey(scope.team.projectId, scope.team.teamId)}`)
      return next
    })
  }, [scope.repository?.repoId, scope.project?.projectId, scope.team?.teamId])
  useEffect(() => {
    tree.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView?.({ block: "nearest" })
  }, [route, folded])
  const disclose = (key: string, label: string) => <button className="disclosure" aria-label={`${folded.has(key) ? "Expand" : "Collapse"} ${visibleText(label)}`}
    aria-expanded={!folded.has(key)} onClick={() => setFolded((previous) => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next })}>
    <Icon name={folded.has(key) ? "chevron" : "chevron-down"} />
  </button>
  const agentLink = (agent: ClientSnapshot["agents"][number]) => <a className={`agent-link${needing.has(agent.agentId) ? " needs-attention" : ""}`}
    href={shellHref({ page: "thread", agentId: agent.agentId })} aria-current={route.page === "thread" && route.agentId === agent.agentId ? "page" : undefined}>
    <span className={`dot${needing.has(agent.agentId) ? " wait" : agent.state._tag === "working" ? "" : " idle"}`} />
    <span className="agent-name">{visibleText(agent.name)}</span><small>{visibleText(displayedState(agent))}</small>
  </a>
  const assigned = new Set(navigation?.agents.map((row) => row.agentId))
  for (const project of navigation?.projects ?? []) assigned.add(project.leadAgentId)
  const standalone = snapshot?.agents.filter((row) => !assigned.has(row.agentId)) ?? []
  return <div ref={tree} className="repo-tree" id="repo-tree" onScroll={updateFade} role="navigation" aria-label="Projects">
    {!complete && <p role="status" className="tree-status">{navigation === undefined ? "Project navigation is unavailable." : "Showing the last complete project navigation."} <button onClick={retry}>Retry</button></p>}
    {navigation?.repositories.map((repository) => {
      const projects = navigation.projects.filter((project) => project.repoId === repository.repoId && project.archivedAt === undefined
        && (!attentionOnly || [...projectAgentIds(project, navigation)].some((id) => needing.has(id))))
      if (attentionOnly && !projects.length) return null
      const repoKey = `repo:${repository.repoId}`
      return <section className="repo-group" key={repository.repoId}>
        <div className={`repo-heading${route.page === "repository" && route.repoId === repository.repoId ? " current" : ""}`}>
          {projects.length > 0 && disclose(repoKey, repository.name)}
          <a className="repo-label" href={shellHref({ page: "repository", repoId: repository.repoId })} aria-current={route.page === "repository" && route.repoId === repository.repoId ? "page" : undefined} title={visibleText(repository.path)}>{visibleText(repository.name)}</a>
        </div>
        {!folded.has(repoKey) && <div className="repo-children">{projects.map((project) => {
          const teams = navigation.teams.filter((team) => team.projectId === project.projectId)
          const lead = snapshot?.agents.find((agent) => agent.agentId === project.leadAgentId)
          const ids = projectAgentIds(project, navigation)
          const count = attention.filter((item) => ids.has(item.agentId)).length
          const projectKey = `project:${project.projectId}`
          const selected = route.page === "project" && route.projectId === project.projectId && route.teamId === undefined || (route.page === "sprint" || route.page === "task") && route.projectId === project.projectId
          const members = snapshot?.agents.filter((agent) => ids.has(agent.agentId)) ?? []
          const teamMemberIds = new Set(teams.flatMap((team) => teamAgents(team, snapshot).map((agent) => agent.agentId)))
          const loose = members.filter((agent) => !teamMemberIds.has(agent.agentId))
          return <div className="project-group" key={project.projectId}>
            <div className={`project-heading${selected ? " current" : ""}${scope.project?.projectId === project.projectId ? " ancestor" : ""}`}>
              {teams.length > 0 ? disclose(projectKey, project.name) : <span className="disclosure-space" />}
              <a className="project-select" href={shellHref({ page: "project", projectId: project.projectId, tab: "board" })} aria-current={selected ? "page" : undefined}>
                <span className="project-label">{visibleText(project.name)}</span>{count > 0 && <span className="attention-number" aria-label={`${count} items need attention`}>{count}</span>}
              </a>
            </div>
            {selected && lead && <p className="project-lead">{visibleText(lead.name)} leads</p>}
            {!folded.has(projectKey) && teams.length > 0 && <div className="project-children">
              {loose.map((agent) => <div key={agent.agentId}>{agentLink(agent)}</div>)}
              {teams.map((team) => {
                const key = `team:${scopeKey(project.projectId, team.teamId)}`
                const agents = teamAgents(team, snapshot).filter((agent) => ids.has(agent.agentId))
                const current = route.page === "project" && route.projectId === project.projectId && route.teamId === team.teamId
                return <div key={key}>
                  <div className={`team-heading${current ? " current" : ""}`}>
                    {agents.length ? disclose(key, team.name) : <span className="disclosure-space" />}
                    <a className="team-select" href={shellHref({ page: "project", projectId: project.projectId, teamId: team.teamId, tab: rememberedTab(project.projectId, team.teamId) })} aria-current={current ? "page" : undefined}>{visibleText(team.name)}<small>{agents.length}</small></a>
                  </div>
                  {!folded.has(key) && agents.length > 0 && <div className="team-agents">{agents.map((agent) => <div key={agent.agentId}>{agentLink(agent)}</div>)}</div>}
                </div>
              })}
            </div>}
          </div>
        })}</div>}
      </section>
    })}
    {complete && navigation?.repositories.length === 0 && <p className="tree-status">No repositories.</p>}
    {attentionOnly && complete && !attention.length && <p className="tree-status">Nothing needs you.</p>}
    {standalone.length > 0 && <section aria-label="Other agents"><h2 className="tree-status">Agents</h2>{standalone.filter((agent) => !attentionOnly || needing.has(agent.agentId)).map((agent) => <div key={agent.agentId as AgentId}>{agentLink(agent)}</div>)}</section>}
  </div>
}
