import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react"
import type { AgentId, Project } from "@lgcode/contracts"
import { Alerts } from "../admin/alerts.tsx"
import { NotificationPrompt } from "../admin/notification-prompt.tsx"
import { Settings } from "../admin/settings.tsx"
import { useMutationDisabled, useShellData } from "../data/ShellDataProvider.tsx"
import { NewProjectSession } from "../project/creation.ts"
import { NewProjectDialog } from "../project/newProject.tsx"
import { RepositoryRegistration } from "../project/registration.ts"
import { AddRepository } from "../project/addRepository.tsx"
import { parseShellRoute, scopeKey, shellHref, type ShellRoute, type WorkspaceTab } from "../routes.ts"
import { Machines } from "../admin/machines.tsx"
import { Subscriptions } from "../admin/subscriptions.tsx"
import { ProjectSettingsPage } from "../admin/project-settings.tsx"
import { HomePage } from "../pages/HomePage.tsx"
import { ProjectPage } from "../pages/ProjectPage.tsx"
import { RepositoryPage, RepositoryTabs } from "../pages/RepositoryPage.tsx"
import { SprintPage } from "../pages/SprintPage.tsx"
import { TaskPage } from "../pages/TaskPage.tsx"
import { FailedStartList, RequestList, byRequestAge } from "../requests/RequestList.tsx"
import { TeamConversation } from "../thread/team.tsx"
import { ConversationContext } from "./ConversationContext.tsx"
import { Thread } from "../thread/index.tsx"
import { visibleText } from "../thread/text.tsx"
import { Icon, type IconName } from "./Icon.tsx"
import { shortcutInField, useContainedFocus } from "./focus.ts"
import { attentionItems, selectedScope } from "./model.ts"
import { NavigationTree } from "./NavigationTree.tsx"
import { panelWidth, readPreference, savedPanelWidth, writePreference } from "./preferences.ts"
import { QuickSwitcher } from "./QuickSwitcher.tsx"

const serviceNames = { alerts: "Phone notifications", machines: "Machines", subscriptions: "Subscriptions", settings: "Service settings" } as const
const serviceIcons: Record<keyof typeof serviceNames, IconName> = { alerts: "phone", machines: "machines", subscriptions: "subscriptions", settings: "settings" }
const tabNames: Record<WorkspaceTab, string> = { board: "Board", chat: "Chat", terminal: "Terminal", git: "Git", settings: "Project settings", tasks: "Tasks" }

function OverflowRow({ children, inert = false }: { readonly children: ReactNode; readonly inert?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const update = useCallback(() => {
    const element = ref.current
    if (!element) return
    element.classList.toggle("fade-start", element.scrollLeft > 2)
    element.classList.toggle("fade-end", element.scrollWidth - element.clientWidth - element.scrollLeft > 2)
  }, [])
  useEffect(() => {
    update()
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update)
    if (ref.current) observer?.observe(ref.current)
    return () => observer?.disconnect()
  }, [children, update])
  return <div className="workspace-tabs" ref={ref} onScroll={update} {...(inert ? { inert: true } : {})}>{children}</div>
}

export function Shell({ onSessionExpired, onLogout, logoutBusy, message }: {
  readonly onSessionExpired: () => void; readonly onLogout: () => void; readonly logoutBusy: boolean; readonly message: string
}) {
  const data = useShellData()
  const mutationDisabled = useMutationDisabled()
  const endOwner = useRef(onSessionExpired)
  const expireSession = useCallback(() => endOwner.current(), [])
  const [creation] = useState(() => new NewProjectSession(expireSession))
  const [registration] = useState(() => new RepositoryRegistration(expireSession))
  const projectTrigger = useRef<HTMLButtonElement>(null)
  endOwner.current = () => { creation.dispose(); registration.dispose(); data.onSessionExpired() }
  useEffect(() => () => { creation.dispose(); registration.dispose() }, [creation, registration])
  const [href, setHref] = useState(() => location.href)
  const route = parseShellRoute(href)
  const scope = selectedScope(route, data.navigation, data.snapshot)
  const routeIdentity = shellHref(route)
  const [collapsed, setCollapsed] = useState(() => readPreference("lgcode-sidebar") === "rail")
  const [width, setWidth] = useState(savedPanelWidth)
  const [phone, setPhone] = useState(() => window.matchMedia?.("(max-width:700px)").matches ?? false)
  const [dockWide, setDockWide] = useState(() => window.matchMedia?.("(min-width:1801px)").matches ?? false)
  const [dockCompact, setDockCompact] = useState(() => window.matchMedia?.("(max-width:1100px)").matches ?? false)
  const [dockOpen, setDockOpen] = useState(() => !(window.matchMedia?.("(max-width:1100px)").matches ?? false))
  const [gitDockOpen, setGitDockOpen] = useState(false)
  const [dockWidth, setDockWidth] = useState(() => Math.max(320, Math.min(600, Number(readPreference("lgcode-layout-lead")) || 360)))
  const dock = useRef<HTMLElement>(null)
  const dockTrigger = useRef<HTMLButtonElement>(null)
  const dockResize = useRef<{ pointer: number; x: number; width: number } | undefined>(undefined)
  const lastAgent = useRef(new Map<string, AgentId>())
  const [drawer, setDrawer] = useState(false)
  const [quick, setQuick] = useState(false)
  const [bell, setBell] = useState(false)
  const [workspaces, setWorkspaces] = useState(false)
  const [workspaceSearch, setWorkspaceSearch] = useState("")
  const [attentionOnly, setAttentionOnly] = useState(false)
  const app = useRef<HTMLDivElement>(null)
  const sidebar = useRef<HTMLElement>(null)
  const content = useRef<HTMLElement>(null)
  const bellRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const focusView = useRef(true)
  const resizeStart = useRef<{ pointer: number; x: number; width: number } | undefined>(undefined)
  const closeDrawer = useCallback(() => setDrawer(false), [])
  const closeQuick = useCallback(() => setQuick(false), [])
  const closeBell = useCallback(() => setBell(false), [])
  const closeWorkspaces = useCallback(() => setWorkspaces(false), [])
  useContainedFocus(drawer && phone, sidebar, closeDrawer)
  useContainedFocus(bell, bellRef, closeBell)
  useContainedFocus(workspaces, workspaceRef, closeWorkspaces)
  useEffect(() => {
    const update = () => { focusView.current = true; setHref(location.href) }
    window.addEventListener("hashchange", update); window.addEventListener("popstate", update)
    return () => { window.removeEventListener("hashchange", update); window.removeEventListener("popstate", update) }
  }, [])
  useEffect(() => {
    const media = window.matchMedia?.("(max-width:700px)")
    const update = () => { setPhone(media?.matches ?? false); setDrawer(false) }
    media?.addEventListener("change", update)
    return () => media?.removeEventListener("change", update)
  }, [])
  useEffect(() => {
    // Numeric property updates are permitted by the existing strict policy.
    // Never write an inline style attribute or accept arbitrary CSS strings.
    app.current?.style.setProperty("--sidebar-width", `${panelWidth(width)}px`)
  }, [width])
  const resize = (value: number) => { const next = panelWidth(value); setWidth(next); writePreference("lgcode-layout-sidebar", String(next)) }
  const toggleRail = useCallback(() => setCollapsed((previous) => { writePreference("lgcode-sidebar", previous ? "full" : "rail"); return !previous }), [])
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || shortcutInField(event.target) || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
      if (event.key.toLowerCase() === "k") { event.preventDefault(); setDockOpen(false); setGitDockOpen(false); setDrawer(false); setBell(false); setWorkspaces(false); setQuick((value) => !value) }
      else if (event.key.toLowerCase() === "b" && !phone && !quick && !bell && !workspaces) { event.preventDefault(); toggleRail() }
    }
    document.addEventListener("keydown", keys)
    return () => document.removeEventListener("keydown", keys)
  }, [phone, toggleRail, quick, bell, workspaces])
  const navigate = useCallback((next: ShellRoute, targetHref?: string, moveFocus = true) => {
    const nextHref = targetHref ?? shellHref(next)
    if (`${location.pathname}${location.search}${location.hash}` !== nextHref) {
      history.pushState(null, "", nextHref)
      // The shell and mounted pages observe one URL transition, including
      // Home's query-backed view when its component remains mounted.
      window.dispatchEvent(new PopStateEvent("popstate"))
    }
    focusView.current = moveFocus
    setHref(location.href)
    setDrawer(false); setBell(false); setWorkspaces(false)
  }, [])
  const openProject = useCallback(() => {
    setQuick(false); setBell(false); setWorkspaces(false)
    creation.open(`${location.pathname}${location.search}${location.hash}`, () => projectTrigger.current)
  }, [creation])
  const addRepository = useCallback(() => {
    const state = creation.getSnapshot(), selected = state.draft.repository
    const repository = selected?._tag === "existing" ? state.repositories.find((row) => row.repoId === selected.repoId) : undefined
    registration.open(repository === undefined ? undefined : { repository })
    navigate({ page: "service", service: "machines" })
  }, [creation, registration, navigate])
  const returnToProject = useCallback(() => {
    registration.close()
    const state = creation.getSnapshot()
    if (!state.detour) return
    const origin = parseShellRoute(state.origin)
    navigate(origin.page === "invalid" ? { page: "home" } : origin, origin.page === "invalid" ? undefined : state.origin, false)
    creation.returnFromMachines()
  }, [creation, registration, navigate])
  const repositoryRegistered = useCallback(() => { data.retry(); returnToProject() }, [data.retry, returnToProject])
  const projectCreated = useCallback((project: Project) => {
    creation.close(); data.retry()
    navigate({ page: "thread", agentId: project.leadAgentId })
  }, [creation, data.retry, navigate])
  const intercept = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || !(event.target instanceof Element)) return
    const link = event.target.closest<HTMLAnchorElement>("a[href]")
    if (!link || link.target || link.hasAttribute("download") || link.origin !== location.origin) return
    const target = parseShellRoute(link.href)
    if (target.page === "invalid") return
    event.preventDefault(); navigate(target, `${link.pathname}${link.search}${link.hash}`, link.getAttribute("role") !== "tab")
  }
  useEffect(() => {
    if (route.page === "project") writePreference(`lgcode-tab:${scopeKey(route.projectId, route.teamId)}`, route.tab)
    setDrawer(false); setBell(false); setWorkspaces(false)
    // After a drawer selection, move into the newly selected view. Escape
    // without navigation is handled by the focus scope and returns to Menu.
    if (focusView.current && !(route.page === "thread" && route.subject !== undefined)) content.current?.focus({ preventScroll: true })
  }, [routeIdentity])
  const attention = attentionItems(data.snapshot, data.requests)
  const openRequests = data.requests?.filter((request) => request.status === "open" && request.holder._tag === "owner").sort(byRequestAge)
  const bellFailures = data.snapshot?.agents.filter((agent) => agent.startFailure !== undefined)
    .sort((a, b) => a.startedAt - b.startedAt || a.agentId.localeCompare(b.agentId)).slice(0, 6) ?? []
  const bellRequests = openRequests?.slice(0, 6 - bellFailures.length)
  const failedNotifications = data.alerts?.filter((alert) => alert.delivery?.status === "failed").length
  const place = scope.team?.name ?? scope.project?.name ?? scope.repository?.name ?? scope.agent?.name
    ?? (route.page === "service" ? serviceNames[route.service] : route.page === "home" ? "Home" : route.page === "invalid" ? "Page not found" : data.complete ? "Unavailable" : "Loading…")
  const projectId = scope.project?.projectId
  const projectRoute = (tab: WorkspaceTab): ShellRoute => projectId === undefined ? route : {
    page: "project", projectId, tab, ...(scope.team === undefined ? {} : { teamId: scope.team.teamId }),
    ...(route.page !== "project" || route.workspaceId === undefined ? {} : { workspaceId: route.workspaceId })
  }
  const inspecting = scope.inspectedWorkspace
  const inspectingControl = inspecting && <button className="context-toggle" aria-label={`Inspecting ${visibleText(inspecting.branch)}`} aria-haspopup="dialog" aria-expanded={workspaces} onClick={() => { setWorkspaces(true); setWorkspaceSearch("") }} title={`Assigned: ${visibleText(scope.assignedWorkspace?.branch ?? "Unavailable")} · ${visibleText(inspecting.path)}`}>
    <span className="context-label">Inspecting</span><Icon name="branch" /><code className="branch-name">{visibleText(inspecting.branch)}</code><Icon name="chevron-down" />
  </button>
  const connection = <div className="connection-details"><span className={`dot${data.connection === "Live" ? "" : " wait"}`} />
    <span role="status">{data.connection}</span>{data.lastUpdated !== undefined && <small>Updated {new Date(data.lastUpdated).toLocaleTimeString()}</small>}
    <button className="icon-button" aria-label="Reconnect now" onClick={data.retry}><Icon name="refresh" /></button></div>
  const threadId: AgentId | undefined = route.page === "thread" ? route.agentId : route.page === "project" && route.tab === "chat" && scope.team === undefined ? scope.project?.leadAgentId : undefined
  const isGit = route.page === "project" && route.tab === "git"
  const isChat = threadId !== undefined || route.page === "project" && route.tab === "chat"
  const dockEligible = projectId !== undefined && !isChat && (dockWide || route.page === "project" && (route.tab === "board" || isGit))
  const showDock = dockEligible && (isGit && !dockWide ? gitDockOpen : dockOpen)
  const dockModal = showDock && dockCompact
  const closeDock = useCallback(() => { setDockOpen(false); setGitDockOpen(false); dockTrigger.current?.focus({ preventScroll: true }) }, [])
  const toggleDock = () => { if (showDock) closeDock(); else if (isGit && !dockWide) setGitDockOpen(true); else setDockOpen(true) }
  useContainedFocus(dockModal, dock, closeDock)
  useEffect(() => {
    const wide = window.matchMedia?.("(min-width:1801px)"), compact = window.matchMedia?.("(max-width:1100px)")
    const update = () => {
      setDockWide(wide?.matches ?? false); setDockCompact(compact?.matches ?? false)
      if (wide?.matches) setDockOpen(true)
      if (compact?.matches) { setDockOpen(false); setGitDockOpen(false) }
    }
    wide?.addEventListener("change", update); compact?.addEventListener("change", update)
    return () => { wide?.removeEventListener("change", update); compact?.removeEventListener("change", update) }
  }, [])
  useEffect(() => {
    if (route.page === "thread" && projectId !== undefined) lastAgent.current.set(projectId, route.agentId)
    if (!dockWide) { setDockOpen(!dockCompact); setGitDockOpen(false) }
  }, [routeIdentity])
  useEffect(() => { app.current?.style.setProperty("--lead-width", `${dockWidth}px`) }, [dockWidth])
  const resizeDock = (value: number) => {
    const width = Math.round(Math.max(320, Math.min(600, Math.max(320, innerWidth - 650), value)))
    setDockWidth(width); writePreference("lgcode-layout-lead", String(width))
  }
  const previousAgent = projectId === undefined ? undefined : lastAgent.current.get(projectId)
  const remembered = data.snapshot?.agents.find((row) => row.agentId === previousAgent && (row.agentId === scope.project?.leadAgentId || row.folder === scope.assignedWorkspace?.path))
  const dockAgentId = remembered?.agentId ?? scope.project?.leadAgentId
  const dockName = scope.team?.name ?? data.snapshot?.agents.find((row) => row.agentId === dockAgentId)?.name ?? "Project lead"
  const teamConversation = scope.team && scope.project && (scope.team.channelId === undefined ? <section className="conversation"><h2>{visibleText(scope.team.name)}</h2><p>This team's chat channel is unavailable.</p></section> : <TeamConversation projectId={scope.project.projectId} teamId={scope.team.teamId}
    channelId={scope.team.channelId} name={scope.team.name} disabled={mutationDisabled} onSessionExpired={expireSession}
    scope={{ projectId: scope.project.projectId, teamId: scope.team.teamId, worktreeId: scope.team.worktreeId }}
    {...(data.snapshot ? { sequence: data.snapshot.sequence } : {})} />)
  const unavailable = !data.complete ? undefined
    : (route.page === "project" || route.page === "sprint" || route.page === "task") && scope.project === undefined ? "This project is unavailable."
    : route.page === "project" && route.teamId !== undefined && scope.team === undefined ? "This team is unavailable in this project."
    : route.page === "project" && route.workspaceId !== undefined && scope.inspectedWorkspace === undefined ? "This worktree is unavailable in this repository."
    : route.page === "repository" && scope.repository === undefined ? "This repository is unavailable." : undefined
  const shellPending = (label: string) => <section className="pending-page"><h1>{label}</h1><p>This page is awaiting integration.</p></section>
  return <div ref={app} className={`app${collapsed ? " sidebar-collapsed" : ""}`} onClick={intercept}>
    {drawer && phone && <div className="drawer-backdrop" onClick={closeDrawer} aria-hidden="true" />}
    <aside ref={sidebar} id="sidebar" className={`sidebar${drawer ? " open" : ""}`} aria-label="Repositories, projects and teams"
      {...(phone && !drawer || quick || bell || workspaces || dockModal ? { inert: true } : {})} {...(drawer && phone ? { role: "dialog", "aria-modal": true } : {})}>
      <div className="brand-row"><span className="brand">LGcode</span><button className="icon-button" id="collapse-sidebar" aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} aria-expanded={!collapsed} aria-controls="sidebar" onClick={toggleRail}><Icon name="panel" /></button>
        <button className="icon-button close-navigation" aria-label="Close navigation" onClick={closeDrawer}><Icon name="x" /></button></div>
      {phone && attention.length > 0 && <section className="drawer-attention" aria-label="Needs attention"><h2>Needs attention <small>{attention.length}</small></h2>{[...new Set(attention.map((item) => item.agentId))].map((id) => {
        const item = attention.find((row) => row.agentId === id)!
        const agent = data.snapshot?.agents.find((row) => row.agentId === id)
        const owner = data.navigation?.agents.find((row) => row.agentId === id)?.projectId
        return <a className="drawer-agent" href={shellHref({ page: "thread", agentId: id })} key={id}><span className="dot wait" /><span>{visibleText(agent?.name ?? id)}</span><small>{item.kind} · {visibleText(data.navigation?.projects.find((row) => row.projectId === owner)?.name ?? "Agent")}</small></a>
      })}</section>}
      <nav className="home-nav" aria-label="Pages"><a href="/#/" aria-label="Home" aria-current={route.page === "home" ? "page" : undefined} title="Home"><Icon name="home" /><span className="rail-label">Home</span></a>
        <button aria-label="Find project or agent" title="Find project or agent" onClick={() => { setDrawer(false); setQuick(true) }}><Icon name="search" /><span className="rail-label">Find project or agent…</span><kbd>{/Mac|iPhone|iPad/u.test(navigator.platform) ? <><Icon name="command" /><span className="sr-only">Command</span> K</> : "Ctrl K"}</kbd></button></nav>
      <div className="sidebar-project-controls"><h2>Projects</h2><button id="attention-filter" aria-pressed={attentionOnly} onClick={() => setAttentionOnly((value) => !value)}><span className="filter-check">{attentionOnly && <Icon name="check" />}</span>Only projects needing you</button></div>
      <NavigationTree route={route} attentionOnly={attentionOnly} />
      <div className="sidebar-foot"><nav className="system-nav" aria-label="Service pages">{(Object.keys(serviceNames) as Array<keyof typeof serviceNames>).map((service) => <a key={service} href={shellHref({ page: "service", service })} aria-label={serviceNames[service]} title={serviceNames[service]} aria-current={route.page === "service" && route.service === service ? "page" : undefined}>
        <Icon name={serviceIcons[service]} />{service === "alerts" && failedNotifications !== undefined && failedNotifications > 0 && <small className="icon-badge" aria-label={`${failedNotifications} failed notifications`}>{failedNotifications}</small>}
      </a>)}</nav><button className="logout" aria-label="Log out" disabled={logoutBusy} onClick={onLogout}>Log out</button></div>
      <div className="resize-handle sidebar-resize" role="separator" tabIndex={0} aria-label="Resize navigation" aria-orientation="vertical" aria-valuemin={224} aria-valuemax={360} aria-valuenow={width}
        onDoubleClick={() => resize(248)} onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
          event.preventDefault(); resize(event.key === "Home" ? 248 : event.key === "End" ? 360 : width + (event.key === "ArrowRight" ? 16 : -16))
        }} onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault(); resizeStart.current = { pointer: event.pointerId, x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId)
        }} onPointerMove={(event) => { if (resizeStart.current?.pointer === event.pointerId) resize(resizeStart.current.width + event.clientX - resizeStart.current.x) }}
        onPointerUp={() => { resizeStart.current = undefined }} onPointerCancel={() => { resizeStart.current = undefined }} onLostPointerCapture={() => { resizeStart.current = undefined }} />
    </aside>
    <main className="main" {...(drawer && phone || quick || bell || workspaces ? { inert: true } : {})}>
      <header className="topbar" {...(dockModal ? { inert: true } : {})}><button className="icon-button mobile-menu" id="menu" aria-label="Open navigation" aria-expanded={drawer} aria-controls="sidebar" onClick={() => setDrawer(true)}><Icon name="menu" /></button>
        <nav className="breadcrumb" aria-label="Breadcrumb"><span className="phone-crumb">{visibleText(place)}</span>
          {scope.repository && <><a className="repo-crumb" href={shellHref({ page: "repository", repoId: scope.repository.repoId })}>{visibleText(scope.repository.name)}</a>{scope.project && <span className="crumb-sep">/</span>}</>}
          {scope.project && <a href={shellHref({ page: "project", projectId: scope.project.projectId, tab: "board" })}>{visibleText(scope.project.name)}</a>}
          {scope.team && <><span className="crumb-sep">/</span><a href={shellHref({ page: "project", projectId: scope.team.projectId, teamId: scope.team.teamId, tab: "chat" })}>{visibleText(scope.team.name)}</a></>}
          {!scope.repository && <strong>{visibleText(place)}</strong>}</nav>
        {!phone && <>{inspectingControl}{connection}</>}
        <button className="icon-button attention-toggle" aria-label={`${data.complete ? attention.length : "Unknown number of"} items need attention`} aria-haspopup="dialog" aria-expanded={bell} onClick={() => setBell(true)}><Icon name="bell" />
          {phone && <span className={`bell-dot dot${data.connection === "Live" ? "" : " wait"}`} />}{attention.length > 0 && <small className="attention-number">{attention.length}</small>}</button>
      </header>
      {projectId !== undefined && <div className="workspace-tab-row" {...(dockModal ? { inert: true } : {})}><OverflowRow><nav role="tablist" aria-label="Workspace tabs" onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
        const tabs = [...event.currentTarget.querySelectorAll<HTMLAnchorElement>('[role="tab"]')]
        const current = tabs.indexOf(document.activeElement as HTMLAnchorElement)
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
        event.preventDefault(); tabs[next]?.click(); tabs[next]?.focus()
      }}>{(["board", "chat", "terminal", "git", "settings", ...(scope.team ? ["tasks" as const] : [])] as const).map((tab) => {
        const selected = route.page === "thread" ? tab === "chat" : route.page === "project" ? route.tab === tab : tab === "board"
        const target = tab === "chat" && dockEligible && scope.team === undefined && dockAgentId !== undefined ? { page: "thread" as const, agentId: dockAgentId } : projectRoute(tab)
        return <a key={tab} role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1} href={shellHref(target)}>{tabNames[tab]}</a>
      })}</nav></OverflowRow>
      {dockEligible && <button className="conversation-toggle" ref={dockTrigger} aria-label={`Conversation with ${visibleText(dockName)}`}
        aria-controls="conversation-dock" aria-expanded={showDock} onClick={toggleDock}>{visibleText(dockName)}</button>}
      </div>}
      {phone && inspectingControl && <div className="phone-context" {...(dockModal ? { inert: true } : {})}>{inspectingControl}</div>}
      <div {...(dockModal ? { inert: true } : {})}><NotificationPrompt onSessionExpired={expireSession} /></div>
      <div className="workspace-surface">
      <section ref={content} {...(dockModal ? { inert: true } : {})} className="view-body" id="view-body" tabIndex={-1} aria-label="Current view">
        {message && <p role="alert">{message}</p>}
        {route.page === "invalid" ? <p role="alert">This page address is invalid. <a href="/#/">Go Home</a></p>
          : unavailable !== undefined ? <p role="alert">{unavailable} <a href="/#/">Go Home</a></p>
          : threadId !== undefined ? <Thread key={threadId} agentId={threadId} {...(route.page === "thread" && route.subject !== undefined ? { subject: route.subject } : {})} onSessionExpired={expireSession} />
          : route.page === "project" && route.tab === "chat" && scope.team ? teamConversation
          : route.page === "home" ? <HomePage route={route} onNewProject={openProject} newProjectButtonRef={projectTrigger} />
          : route.page === "service" && route.service === "alerts" ? <Alerts onSessionExpired={expireSession} />
          : route.page === "service" && route.service === "settings" ? <Settings onSessionExpired={expireSession} />
          : route.page === "service" && route.service === "machines" ? <>
            <section className="review-page" aria-label="Repository registration">
              <button type="button" disabled={mutationDisabled || logoutBusy} onClick={() => registration.open()}>Add repository</button>
            </section>
            <AddRepository registration={registration} disabled={mutationDisabled || logoutBusy} onRegistered={repositoryRegistered} onCancel={returnToProject} />
            <Machines onSessionExpired={expireSession} />
          </>
          : route.page === "service" && route.service === "subscriptions" ? <Subscriptions onSessionExpired={expireSession} />
          : route.page === "repository" && route.tab === "design" ? <section className="pages"><RepositoryTabs route={route} />{shellPending("Design")}</section>
          : route.page === "repository" ? <RepositoryPage route={route} />
          : route.page === "sprint" ? <SprintPage route={route} />
          : route.page === "task" ? <TaskPage route={route} />
          : route.page === "project" && route.tab === "settings" ? <ProjectSettingsPage route={route} />
          : route.page === "project" && (route.tab === "board" || route.tab === "tasks") ? <ProjectPage route={route} />
          : shellPending(route.page === "project" ? tabNames[route.tab] : "Conversation")}
      </section>
      {dockWide && threadId !== undefined && scope.project && scope.assignedWorkspace && <ConversationContext project={scope.project}
        agentId={threadId} worktreeId={scope.assignedWorkspace.worktreeId} />}
      {dockEligible && <aside id="conversation-dock" ref={dock} hidden={!showDock} className={`conversation-dock${dockModal ? " is-modal" : ""}`}
        aria-label={scope.team ? "Team conversation dock" : "Lead conversation"} {...(dockModal ? { role: "dialog", "aria-modal": true } : {})}>
        <div className="resize-handle conversation-resize" role="separator" tabIndex={0} aria-label="Resize the thread panel" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={600} aria-valuenow={dockWidth}
          onDoubleClick={() => resizeDock(360)} onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
            event.preventDefault(); resizeDock(event.key === "Home" ? 360 : event.key === "End" ? 540 : dockWidth + (event.key === "ArrowLeft" ? 16 : -16))
          }} onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); dockResize.current = { pointer: event.pointerId, x: event.clientX, width: dockWidth }; event.currentTarget.setPointerCapture(event.pointerId) }}
          onPointerMove={(event) => { if (dockResize.current?.pointer === event.pointerId) resizeDock(dockResize.current.width + dockResize.current.x - event.clientX) }}
          onPointerUp={() => { dockResize.current = undefined }} onPointerCancel={() => { dockResize.current = undefined }} onLostPointerCapture={() => { dockResize.current = undefined }} />
        {dockCompact && <header className="conversation-dock-heading"><span>{scope.team ? "Team chat" : dockAgentId === scope.project?.leadAgentId ? "Project lead" : "Agent conversation"}</span>
          <button className="icon-button" onClick={closeDock} aria-label="Close the thread"><Icon name="x" /></button></header>}
        {showDock && (scope.team ? teamConversation : dockAgentId ? <Thread agentId={dockAgentId} onSessionExpired={expireSession} /> : <p>The project lead is unavailable.</p>)}
      </aside>}
      </div>
    </main>
    <NewProjectDialog creation={creation} disabled={mutationDisabled || logoutBusy} onAddRepository={addRepository}
      onSettings={() => { creation.close(); navigate({ page: "service", service: "settings" }) }} onCreated={projectCreated} />
    {quick && <QuickSwitcher close={closeQuick} navigate={navigate} />}
    {bell && <div className="modal-cover" onClick={closeBell}><div ref={bellRef} className="attention-menu" role="dialog" aria-modal="true" aria-label="Needs attention" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
      {connection}<h2>Needs attention</h2>{!data.complete && <p role="status">Showing the last received requests. <button onClick={data.retry}>Retry</button></p>}
      <FailedStartList agents={bellFailures} />
      {bellRequests !== undefined && <RequestList requests={bellRequests} compact empty={data.complete && attention.length === 0 ? <p>Nothing needs your attention.</p> : null} />}
      <a href="/#/">View all</a><button onClick={closeBell}>Close</button>
    </div></div>}
    {workspaces && <div className="modal-cover" onClick={closeWorkspaces}><div ref={workspaceRef} className="workspace-menu" role="dialog" aria-modal="true" aria-label="Inspect a worktree" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
      <input data-autofocus aria-label="Find worktree" placeholder="Find worktree…" value={workspaceSearch} onChange={(event) => setWorkspaceSearch(event.target.value)} />
      {data.navigation?.workspaces.filter((workspace) => workspace.repoId === scope.repository?.repoId && `${workspace.branch} ${workspace.machineId}`.toLocaleLowerCase().includes(workspaceSearch.toLocaleLowerCase())).map((workspace) => <button className={`workspace-option${workspace.teamId ? " team-worktree" : ""}`} key={workspace.worktreeId} onClick={() => navigate({ ...projectRoute(route.page === "project" ? route.tab : "board"), workspaceId: workspace.worktreeId } as ShellRoute)}>
        <span>{workspace.checkout === "main" ? "Main checkout" : visibleText(data.navigation?.teams.find((team) => team.teamId === workspace.teamId && team.projectId === workspace.projectId)?.name ?? scope.project?.name ?? "Worktree")}</span><code title={visibleText(workspace.branch)}>{visibleText(workspace.branch)}</code><small>{visibleText(workspace.machineId)}{scope.assignedWorkspace?.worktreeId === workspace.worktreeId ? " · Assigned" : ""}</small>
      </button>)}
    </div></div>}
  </div>
}
