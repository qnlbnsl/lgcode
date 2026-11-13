import * as chat from './live/chat.js';
// The application shell: sidebar, top bar, the project tab row, the lead panel, and routing.
import {
  html, render, useState, useEffect, useRef, Icon, cx, store, update, useStore, useRoute, go, href, ago, useNow, useKey, useMedia,
  HOUR, plural, isMac, live, guardStore, engineWrite, refusal, refuse,
} from './lib.js';
import {
  seed, emptyState, projectOf, repoOf, agentOf, teamOf, teamName, teamsOf, agentsOfTeam, leadOf, openRequests, agentStatus, projectStatus,
  KIND_LABEL, routeForRequest, routeForAgent, byId, agentLabel, machineOf, HARNESSES,
} from './data.js';
import * as act from './actions.js';
import * as engine from './engine.js';
import { Avatar, OwnerAvatar, Menu, DialogHost, Toasts, Resizer, Thread, Composer, Tabs, Kbd, StateWord, canMessage, ReadOnlyBar, Empty } from './ui.js';
import './dialogs.js';
import { Home, AllProjects } from './screens/home.js';
import { Board, SprintPage, TaskPage, TeamPage, RepoPage } from './screens/project.js';
import { ChatTab } from './screens/chat.js';
import { GitTab, seedGit } from './screens/git.js';
import { FilesTab } from './screens/files.js';
import { TerminalTab, seedTerminal } from './screens/terminal.js';
import { MocksTab, seedMocks } from './screens/mocks.js';
import { RepoDesign } from './screens/design.js';
import { MessagesTab, AgentsTab, seedBoard } from './screens/messages.js';
import { WorkflowTab, seedWorkflow } from './screens/workflow.js';
import { Machines, Subscriptions, Notifications, ServiceSettings, ProjectSettings, seedService } from './screens/service.js';
import { Login, FirstRun, seedAuth } from './screens/auth.js';
import { emptyWorkflow } from './screens/workflow.js';
import { emptyMocks } from './screens/mocks.js';

// ---- named places ---------------------------------------------------------------
// A page that mounts the website can fill these places with its own components, without
// editing the website. Each component receives the store's state as `s` and the route.
// An empty place renders its fallback, which is the website's own content, or nothing.
//   sidebar.head        below the brand at the top of the sidebar
//   sidebar.account     above the owner's row at the foot of the sidebar
//   topbar.connection   the connection badge at the right of the top bar
let slots = {};
function Slot({ name, s, route, fallback = null }) {
  const Fill = slots[name];
  return Fill ? html`<${Fill} s=${s} route=${route} />` : fallback;
}

// ---- sidebar ------------------------------------------------------------------
function TreeRow({ kind, depth, open, onToggle, to, current, icon, label, state, tone, children, title, action }) {
  // A single click on the row opens it. The arrow, or a double click on the row, folds it.
  return html`<div class=${cx('tree-row', kind)} aria-current=${current ? 'page' : null} style=${{ paddingLeft: 4 + depth * 14 + 'px' }}
    onDblClick=${onToggle ? (e) => { if (!e.target.closest('.twist, .hover-act')) { e.preventDefault(); onToggle(); } } : null}>
    ${onToggle
      ? html`<button type="button" class="twist" aria-expanded=${!!open} aria-label=${(open ? 'Collapse ' : 'Expand ') + (title || label)} onClick=${onToggle}><${Icon} name="chevron-right" size=${13} /></button>`
      : html`<span class="twist none"></span>`}
    <a href=${href(to)} title=${title || null}>${icon}<span class="label">${label}</span></a>
    ${state && html`<span class=${cx('state', tone, action && 'hover-hide')}>${state}</span>`}
    ${action}
  </div>`;
}
function ProjectTree({ s, route }) {
  const path = route.path;
  const only = s.prefs.onlyNeedingYou;
  const repos = s.repos.map((r) => ({ r, projects: s.projects.filter((p) => p.repo === r.id && !p.archived && (!only || openRequests(s, { project: p.id }).length)) })).filter((x) => !only || x.projects.length);
  if (!repos.length) return html`<div class="empty" data-empty style="padding:12px 8px"><strong>Nothing needs you</strong><span>Every project is running or idle.</span></div>`;
  return repos.map(({ r, projects }) => {
    const rk = 'repo:' + r.id; const ropen = s.expanded[rk] ?? false;
    const rn = openRequests(s).filter((q) => projectOf(s, q.project).repo === r.id).length;
    return html`<div key=${r.id}>
      <${TreeRow} kind="repo" depth=${0} open=${ropen} onToggle=${() => act.toggleExpanded(rk)} to=${'/r/' + r.id} current=${path === '/r/' + r.id || path.startsWith(`/r/${r.id}/design`)}
        icon=${html`<${Icon} name="folder-git-2" size=${14} class="faint" />`} label=${r.name} state=${!ropen && rn ? rn : null} tone="warn"
        action=${html`<button type="button" class="icon-btn sm hover-act" aria-label=${'New project in ' + r.name} data-tip="New project here" data-tip-side="left" onClick=${() => act.openDialog({ type: 'new-project', repo: r.id })}><${Icon} name="plus" size=${13} /></button>`} />
      ${ropen && html`<div class="tree-children" style="--guide:13px">
        ${projects.length === 0 && html`<div class="tree-row" style="padding-left:38px"><span class="faint">No projects yet</span></div>`}
        ${projects.map((p) => {
          const pk = 'project:' + p.id; const popen = s.expanded[pk] ?? false;
          const ps = projectStatus(s, p); const lead = leadOf(s, p); const ls = agentStatus(s, lead);
          const inProject = route.parts[0] === 'p' && route.parts[1] === p.id;
          const onLead = inProject && route.parts[2] === 'chat' && (!route.parts[3] || route.parts[3] === lead.id);
          return html`<div key=${p.id}>
            <${TreeRow} kind=${cx('project', p.naming && 'naming')} depth=${1} open=${popen} onToggle=${() => act.toggleExpanded(pk)} to=${`/p/${p.id}/board`}
              current=${inProject && !['chat', 'team'].includes(route.parts[2])} label=${p.name}
              icon=${null} state=${ps.n ? ps.n : html`<span class="faint">${p.stage}</span>`} tone=${ps.n ? 'warn' : null} />
            ${popen && html`<div class="tree-children" style="--guide:27px">
              <${TreeRow} kind="agent" depth=${2} to=${`/p/${p.id}/chat/${lead.id}`} current=${onLead}
                icon=${html`<${Avatar} agent=${lead} s=${s} size="sm" />`} label="Project lead" state=${ls.tone ? ls.word.replace('Waiting on ', '') : null} tone=${ls.tone} />
              ${teamsOf(s, p.id).map((t) => {
                const tk = 'team:' + t.id; const topen = s.expanded[tk] ?? false; const tn = openRequests(s, { team: t.id }).length;
                return html`<div key=${t.id}>
                  <${TreeRow} kind="team" depth=${2} open=${topen} onToggle=${() => act.toggleExpanded(tk)} to=${`/p/${p.id}/team/${t.id}`}
                    current=${inProject && route.parts[2] === 'team' && route.parts[3] === t.id}
                    icon=${html`<${Icon} name="users" size=${13} class="faint" />`} label=${teamName(t)} state=${!topen && tn ? tn : null} tone="warn" />
                  ${topen && html`<div class="tree-children" style="--guide:41px">${agentsOfTeam(s, t.id).map((a) => {
                    const st = agentStatus(s, a);
                    return html`<${TreeRow} key=${a.id} kind="agent" depth=${3} to=${routeForAgent(s, a)} current=${inProject && route.parts[2] === 'chat' && route.parts[3] === a.id}
                      icon=${html`<${Avatar} agent=${a} s=${s} size="sm" />`} label=${a.name} title=${a.activity || st.word}
                      state=${st.tone ? st.word.replace('Stopped · ', '') : null} tone=${st.tone} />`;
                  })}</div>`}
                </div>`;
              })}
            </div>`}
          </div>`;
        })}
      </div>`}
    </div>`;
  });
}
function MockControls({ s }) {
  return html`<${Menu} class="icon-btn" label="Mock controls" align="end" side="top" width=${260}
    trigger=${html`<${Icon} name="sliders-horizontal" size=${15} />`}
    items=${[
      { heading: 'Show a state' },
      { label: 'Connection: live', checked: s.conn.status === 'live', onSelect: () => act.setConnection('live') },
      { label: 'Connection: reconnecting', checked: s.conn.status === 'reconnecting', onSelect: () => act.setConnection('reconnecting') },
      { label: 'Connection: offline', checked: s.conn.status === 'offline', onSelect: () => act.setConnection('offline') },
      { sep: true },
      { label: 'Login page', icon: 'log-in', onSelect: () => { act.setSession('out'); go('/login'); } },
      { label: 'Login rejected', onSelect: () => { act.setSession('rejected'); go('/login'); } },
      { label: 'Session expired', onSelect: () => { act.setSession('expired'); go('/login'); } },
      { label: 'Service unavailable', onSelect: () => { act.setSession('unavailable'); go('/login'); } },
      { label: 'Login over an insecure connection', onSelect: () => { act.setSession('out'); go('/login?insecure=1'); } },
      { label: 'First run', icon: 'sparkles', onSelect: () => go('/setup') },
      { sep: true },
      { label: 'Reset the sample', icon: 'rotate-ccw', hint: 'Puts every request, message and setting back.', onSelect: act.resetMock },
    ]} />`;
}
function Sidebar({ s, route, onNavigate }) {
  const n = openRequests(s).length; const failedNotes = (s.notifications || []).filter((x) => x.delivery === 'failed').length;
  const is = (p) => route.path === p || route.path.startsWith(p + '/');
  const nav = (to, icon, label, extra) => html`<a class="nav-item" href=${href(to)} aria-current=${is(to) ? 'page' : null}><${Icon} name=${icon} size=${15} /><span class="truncate">${label}</span>${extra}</a>`;
  const folded = s.prefs.sidebarFolded;
  const rail = (to, icon, label, pip) => html`<a class="icon-btn" href=${href(to)} aria-label=${label} data-tip=${label} data-tip-side="right" aria-pressed=${is(to)}><${Icon} name=${icon} size=${16} />${pip && html`<i class="pip"></i>`}</a>`;
  return html`<aside class="sidebar" aria-label="Navigation" onClick=${(e) => { if (e.target.closest('a')) onNavigate?.(); }}>
    <div class="side-head">
      <a class="brand" href=${href('/home')}><span class="brand-mark">LG</span><span>LGTM Studio</span></a>
      <button type="button" class="icon-btn not-phone" aria-label=${folded ? 'Open the sidebar' : 'Fold the sidebar'} data-tip=${(folded ? 'Open' : 'Fold') + ' sidebar · ' + (isMac ? '⌘' : 'Ctrl ') + 'B'} data-tip-side=${folded ? 'right' : 'bottom'}
        onClick=${() => act.setPref('sidebarFolded', !folded)}><${Icon} name="panel-left" size=${16} /></button>
    </div>
    <${Slot} name="sidebar.head" s=${s} route=${route} />
    <div class="side-rail">
      ${rail('/home', 'house', n ? `Home · ${n} need you` : 'Home', n > 0)}
      ${rail('/projects', 'table-2', 'All projects')}
      <button type="button" class="icon-btn" aria-label="Find project or agent" data-tip="Find project or agent" data-tip-side="right" onClick=${() => act.openDialog({ type: 'switcher' })}><${Icon} name="search" size=${16} /></button>
      <button type="button" class="icon-btn" aria-label="New project" data-tip="New project" data-tip-side="right" onClick=${() => act.openDialog({ type: 'new-project' })}><${Icon} name="plus" size=${16} /></button>
      <span class="spacer"></span>
      ${rail('/machines', 'server', 'Machines')}${rail('/subscriptions', 'key-round', 'Subscriptions')}${rail('/notifications', 'smartphone', 'Phone notifications', failedNotes > 0)}${rail('/settings', 'settings', 'Service settings')}
    </div>
    <div class="side-top">
      ${nav('/home', 'house', 'Home', n > 0 && html`<span class="count warn">${n}</span>`)}
      <button type="button" class="nav-item" onClick=${() => act.openDialog({ type: 'switcher' })}><${Icon} name="search" size=${15} /><span class="truncate">Find project or agent</span><${Kbd} k="K" /></button>
    </div>
    <div class="side-scroll">
      <div class="side-label" style="margin-top:0"><span>Repositories</span>
        <a class="icon-btn sm" href=${href('/projects')} aria-label="All projects" data-tip="All projects" data-tip-side="left" aria-pressed=${is('/projects')}><${Icon} name="table-2" size=${14} /></a>
        <button type="button" class="icon-btn sm" aria-pressed=${s.prefs.onlyNeedingYou} aria-label="Only projects needing you" data-tip="Only projects needing you" data-tip-side="left" onClick=${() => update((st) => { st.prefs.onlyNeedingYou = !st.prefs.onlyNeedingYou; })}><${Icon} name="filter" size=${13} /></button>
        <button type="button" class="icon-btn sm" aria-label="New project" data-tip="New project" data-tip-side="left" onClick=${() => act.openDialog({ type: 'new-project' })}><${Icon} name="plus" size=${14} /></button>
      </div>
      <nav aria-label="Repositories"><${ProjectTree} s=${s} route=${route} /></nav>
    </div>
    <div class="side-foot">
      ${nav('/machines', 'server', 'Machines', html`<span class="state faint" style="margin-left:auto;font-size:var(--text-xs)">${s.machines.filter((m) => m.status === 'online').length} of ${s.machines.length} online</span>`)}
      ${nav('/subscriptions', 'key-round', 'Subscriptions')}
      ${nav('/notifications', 'smartphone', 'Phone notifications', failedNotes > 0 && html`<span class="count error">${failedNotes}</span>`)}
      ${nav('/settings', 'settings', 'Service settings')}
      <${Slot} name="sidebar.account" s=${s} route=${route} />
      <div class="row" style="height:var(--row);padding:0 2px 0 8px;margin-top:4px;gap:8px">
        <${OwnerAvatar} s=${s} /><span class="truncate grow" style="font-weight:var(--weight-medium)">${s.owner.name}</span>
        ${!live.on && html`<${MockControls} s=${s} />`}
        <button type="button" class="icon-btn" aria-label="Log out" data-tip="Log out" data-tip-side="left" onClick=${act.signOut}><${Icon} name="log-out" size=${15} /></button>
      </div>
    </div>
    ${!folded && html`<${Resizer} side="right" label="Resize the sidebar" value=${s.prefs.sidebarWidth} min=${220} max=${420} reset=${264} onChange=${(v) => act.setPref('sidebarWidth', v)} />`}
  </aside>`;
}

// ---- top bar ------------------------------------------------------------------
function Bell({ s }) {
  const now = useNow(); const open = openRequests(s);
  return html`<${Menu} class="icon-btn bell" label=${open.length ? `${open.length} requests need you` : 'Nothing needs you'} align="end" width=${360}
    trigger=${html`<${Icon} name="bell" size=${16} />${open.length > 0 && html`<span class="count warn">${open.length}</span>`}`}
    header=${html`<div class="menu-label">${open.length ? 'Needs you, longest wait first' : 'Nothing needs you'}</div>`}
    items=${[
      ...open.slice(0, 6).map((r) => ({ label: html`<span class=${cx('kind', r.kind)} style="margin-right:6px">${KIND_LABEL[r.kind]}</span>${r.title}`, sub: html`<span class=${now - r.createdAt >= HOUR ? 'warn-text' : ''}>${ago(r.createdAt, now)}</span>`, onSelect: () => go(routeForRequest(s, r)) })),
      { sep: true },
      { label: open.length > 6 ? `View all ${open.length}` : 'Open Home', icon: 'house', onSelect: () => go('/home') },
    ]} />`;
}
function Live({ s }) {
  const now = useNow(5000); const c = s.conn;
  const word = { live: 'Live', reconnecting: 'Reconnecting', offline: 'Offline' }[c.status];
  return html`<${Menu} class=${cx('live', c.status)} align="end" width=${280} label=${'Connection: ' + word}
    trigger=${html`<i class=${cx('dot', c.status === 'live' ? 'working' : c.status === 'reconnecting' ? 'waiting' : 'failed')}></i><span class="not-phone">${word}</span>`}
    header=${html`<div style="padding:8px 8px 6px;line-height:1.5"><b>${word}</b><div class="muted" style="font-size:var(--text-sm)">${c.status === 'live' ? `Connected to the service on ${(s.machines.find((m) => m.here) || s.machines[0])?.name || 'this computer'}.` : c.lastHeard ? `Last heard from the service ${ago(c.lastHeard, now)} ago. You can read, and changes wait until it is back.` : 'The service has not answered yet.'}</div></div>`}
    items=${c.status === 'live' ? [{ label: 'Service settings', icon: 'settings', onSelect: () => go('/settings') }] : [{ label: 'Reconnect now', icon: 'refresh-cw', onSelect: () => { act.setConnection('live'); if (!live.on) act.toast('Connected'); } }]} />`;
}
function Inspecting({ s, project }) {
  const wts = (s.worktrees || []).filter((w) => w.repo === project.repo && (!w.project || w.project === project.id));
  const cur = s.inspecting[project.id] || project.branch;
  return html`<${Menu} class="inspect not-phone" align="end" width=${340} label="Inspecting: the worktree whose code you look at"
    trigger=${html`<${Icon} name="git-branch" size=${13} /><span>Inspecting</span><b class="truncate-start">${cur}</b><${Icon} name="chevrons-up-down" size=${12} />`}
    header=${html`<div class="menu-label">Changes the code you look at. It does not move any agent.</div>`}
    items=${wts.map((w) => ({ label: html`<span class="mono">${w.branch}</span>`, sub: w.branch === project.branch ? 'Assigned' : machineOf(s, w.machine)?.name, checked: w.branch === cur, onSelect: () => update((st) => { st.inspecting[project.id] = w.branch; }) }))} />`;
}
function TopBar({ s, route, project, onMenu }) {
  const crumbs = [];
  if (project) {
    const r = repoOf(s, project);
    crumbs.push({ to: '/r/' + r.id, label: r.name, cls: 'repo' }, { to: `/p/${project.id}/board`, label: project.name });
    if (route.parts[2] === 'team') { const t = teamOf(s, route.parts[3]); if (t) crumbs.push({ to: route.path, label: teamName(t) }); }
    if (route.parts[2] === 'chat' && route.parts[3]) { const a = agentOf(s, route.parts[3]); if (a) { if (a.team) crumbs.push({ to: `/p/${project.id}/team/${a.team}`, label: teamName(teamOf(s, a.team)) }); crumbs.push({ to: route.path, label: html`<${Avatar} agent=${a} s=${s} size="sm" status=${false} />${a.name}`, cls: 'agent' }); } }
    if (route.parts[2] === 'sprint') { const sp = byId(s.sprints, route.parts[3]); if (sp) crumbs.push({ to: route.path, label: sp.label }); }
    if (route.parts[2] === 'task') { const t = byId(s.tasks, route.parts[3]); if (t) crumbs.push({ to: route.path, label: t.label }); }
  } else if (route.parts[0] === 'r') { const r = byId(s.repos, route.parts[1]); crumbs.push({ to: '/r/' + route.parts[1], label: r?.name || 'Repository', cls: 'repo' }); }
  else crumbs.push({ to: route.path, label: { home: 'Home', projects: 'All projects', machines: 'Machines', subscriptions: 'Subscriptions', notifications: 'Phone notifications', settings: 'Service settings' }[route.parts[0]] || 'Home' });
  return html`<header class="topbar">
    <button type="button" class="icon-btn only-phone" aria-label="Open navigation" onClick=${onMenu}><${Icon} name="menu" size=${18} /></button>
    <nav class="crumbs" aria-label="Where you are">
      ${crumbs.map((c, i) => html`${i > 0 && html`<${Icon} name="chevron-right" size=${12} class="sep" />`}
        ${i === crumbs.length - 1 ? html`<span class=${cx('here', c.cls)} aria-current="page">${c.label}</span>` : html`<a class=${c.cls} href=${href(c.to)}>${c.label}</a>`}`)}
    </nav>
    ${project && html`<${Inspecting} s=${s} project=${project} />`}
    <${Bell} s=${s} /><${Slot} name="topbar.connection" s=${s} route=${route} fallback=${html`<${Live} s=${s} />`} />
  </header>`;
}

// ---- the project workspace ------------------------------------------------------
// The panel beside a project view. It shows the project lead, or, after "Open thread" on a
// question, the asking agent's thread with a way back to the lead.
function SidePanel({ s, agent, project }) {
  const st = agentStatus(s, agent); const isLead = agent.role === 'project-lead';
  const t = agent.team && teamOf(s, agent.team);
  const close = () => (matchMedia('(max-width: 1180px)').matches ? update((x) => { x.ui.panelDrawer = false; }) : act.setPref('panelOpen', false));
  return html`<aside class="panel" aria-label=${agent.name + ' thread'} style=${{ '--panel-w': s.prefs.panelWidth + 'px' }}>
    <${Resizer} side="left" label="Resize the thread panel" value=${s.prefs.panelWidth} min=${340} max=${640} reset=${420} onChange=${(v) => act.setPref('panelWidth', v)} />
    <div class=${cx('panel-head', !isLead && 'other')}>
      ${!isLead && html`<button type="button" class="icon-btn" aria-label="Back to the project lead" data-tip="Back to the project lead" data-tip-side="right" onClick=${act.closeSidePanel}><${Icon} name="arrow-left" size=${16} /></button>`}
      <${Avatar} agent=${agent} s=${s} />
      <span class="who truncate">${agent.name}</span>
      ${t && html`<span class="muted truncate" style="font-size:var(--text-sm)">${teamName(t)}</span>`}
      <span class="what truncate grow"><${StateWord} status=${st} /></span>
      <a class="icon-btn" href=${href(routeForAgent(s, agent) + (s.ui.panelReq && !isLead ? '?req=' + s.ui.panelReq : ''))} aria-label="Open this thread in the main view" data-tip="Open in the main view" data-tip-side="left"><${Icon} name="maximize-2" size=${14} /></a>
      <button type="button" class="icon-btn only-phone" aria-label="Close" onClick=${close}><${Icon} name="x" size=${16} /></button>
    </div>
    <${Thread} key=${agent.id} s=${s} agentId=${agent.id} focusReq=${isLead ? null : s.ui.panelReq} onOpenThread=${act.openSidePanel} />
    ${canMessage(s, agent) ? html`<${Composer} s=${s} agentId=${agent.id} />` : html`<${ReadOnlyBar} s=${s} agent=${agent} onLead=${act.closeSidePanel} />`}
  </aside>`;
}
function ProjectView({ s, route, project }) {
  const tab = route.parts[2] || 'board'; const lead = leadOf(s, project);
  const chatAgent = tab === 'chat' ? agentOf(s, route.parts[3] || lead.id) : null;
  const other = s.ui.panelAgent && agentOf(s, s.ui.panelAgent);
  const side = other && other.project === project.id && other.id !== chatAgent?.id ? other : null;
  const narrow = useMedia('(max-width: 1180px)');
  const open = openRequests(s, { project: project.id }).length;
  const tabs = [
    { id: 'board', label: 'Board' },
    { id: 'workflow', label: 'Workflow' },
    project.hasMocks && { id: 'mocks', label: 'Mocks' },
    chatAgent && chatAgent.role !== 'project-lead'
      ? { id: 'chat', label: agentLabel(s, chatAgent, { withTeam: true }), icon: 'eye' }
      : { id: 'chat', label: 'Chat', count: open, tone: 'warn' },
    { id: 'messages', label: 'Messages' },
    { id: 'agents', label: 'Agents' },
    { id: 'terminal', label: 'Terminal' },
    { id: 'files', label: 'Files' },
    { id: 'git', label: 'Git' },
    { id: 'settings', label: 'Settings' },
  ].filter(Boolean);
  const current = ['sprint', 'task'].includes(tab) ? 'board' : tab === 'team' ? null : tab;
  // The panel docks the lead beside every view except Chat, which is the thread itself.
  const docked = side || (tab === 'chat' ? null : lead);
  const wantPanel = docked && s.prefs.panelOpen && !(narrow && s.ui?.panelAuto !== true);
  const showPanel = docked && (narrow ? s.ui?.panelDrawer : s.prefs.panelOpen || !!side);
  const togglePanel = () => (narrow ? update((st) => { st.ui = { ...(st.ui || {}), panelDrawer: !st.ui?.panelDrawer }; }) : act.setPref('panelOpen', !s.prefs.panelOpen));
  let body;
  if (tab === 'board') body = html`<${Board} s=${s} project=${project} route=${route} />`;
  else if (tab === 'sprint') body = html`<${SprintPage} s=${s} project=${project} sprintId=${route.parts[3]} />`;
  else if (tab === 'task') body = html`<${TaskPage} s=${s} project=${project} taskId=${route.parts[3]} />`;
  else if (tab === 'team') body = html`<${TeamPage} s=${s} project=${project} teamId=${route.parts[3]} route=${route} />`;
  else if (tab === 'workflow') body = html`<${WorkflowTab} s=${s} project=${project} route=${route} />`;
  else if (tab === 'mocks') body = html`<${MocksTab} s=${s} project=${project} route=${route} />`;
  else if (tab === 'chat') body = html`<${ChatTab} s=${s} project=${project} agentId=${chatAgent?.id || route.parts[3]} route=${route} />`;
  else if (tab === 'messages') body = html`<${MessagesTab} s=${s} project=${project} route=${route} />`;
  else if (tab === 'agents') body = html`<${AgentsTab} s=${s} project=${project} route=${route} />`;
  else if (live.on && ['terminal', 'files'].includes(tab)) body = html`<${NotConnected} what=${tab === 'files' ? 'Files' : 'The terminal'} />`;
  else if (tab === 'terminal') body = html`<${TerminalTab} s=${s} project=${project} route=${route} />`;
  else if (tab === 'files') body = html`<${FilesTab} s=${s} project=${project} route=${route} />`;
  else if (tab === 'git') body = html`<${GitTab} s=${s} project=${project} route=${route} />`;
  else if (tab === 'settings') body = html`<${ProjectSettings} s=${s} project=${project} route=${route} />`;
  else body = html`<${Board} s=${s} project=${project} route=${route} />`;
  const flush = ['chat', 'terminal', 'git', 'files', 'messages', 'mocks', 'board', 'sprint'].includes(tab);
  const focus = !!s.ui.focus && tab === 'board';
  return html`<div class="workspace">
    <div class="view">
      ${!focus && html`<div class="tabrow" role="tablist" aria-label="Project views">
        <${Tabs} tabs=${tabs} current=${current} base=${`/p/${project.id}/`} />
        ${docked && !side && html`<div class="tab-end">
          <button type="button" class="btn sm" aria-pressed=${!!showPanel} onClick=${togglePanel} data-tip=${showPanel ? 'Hide the project lead' : 'Show the project lead'} data-tip-side="left">
            <${Avatar} agent=${lead} s=${s} size="sm" /><span>Project lead</span><${Icon} name="panel-right" size=${14} /></button>
        </div>`}
      </div>`}
      <div class="view-body" style=${flush ? 'overflow:hidden;display:flex;flex-direction:column' : ''}>${body}</div>
    </div>
    ${showPanel && !focus && html`${narrow && html`<div class="drawer-scrim" style="z-index:71" onClick=${togglePanel}></div>`}<${SidePanel} s=${s} agent=${docked} project=${project} />`}
  </div>`;
}

// A screen whose records the engine cannot give yet, in live mode. It never shows the sample.
function NotConnected({ what }) {
  return html`<div class="page"><${Empty} title=${`${what} is not connected yet`}>The service does not send this to the website yet.</${Empty}></div>`;
}

// ---- the app --------------------------------------------------------------------
function App() {
  const s = useStore(); const route = useRoute();
  const [drawer, setDrawer] = useState(false);
  useKey((e) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); act.openDialog({ type: 'switcher' }); }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); act.setPref('sidebarFolded', !store.state.prefs.sidebarFolded); }
  }, []);
  useEffect(() => {
    if (!route.parts.length) go('/home');
    // The old Home tabs keep working: Projects moved to its own page, and Questions and
    // Approvals became the Type filter on Needs attention.
    if (route.path === '/home/projects') go('/projects');
  }, [route.path]);
  useEffect(() => { document.title = 'LGTM Studio'; }, []);
  // The live website opens Home once the engine says this browser is signed in.
  useEffect(() => { if (live.on && s.session.status === 'in' && (route.parts[0] === 'login' || s.session.firstRun && route.parts[0] !== 'setup')) go(s.session.firstRun ? '/setup' : '/home'); }, [s.session.status, s.session.firstRun, route.path]);
  const top = route.parts[0] || 'home';
  // The live website asks the engine whether this browser is signed in before it shows anything.
  if (s.session.status === 'checking') return html`<main class="auth" aria-busy="true"></main>`;
  if (top === 'login' || (s.session.status !== 'in' && (top !== 'setup' || live.on))) return html`<${Login} s=${s} /><${Toasts} s=${s} />`;
  if (top === 'setup') return html`<${FirstRun} s=${s} route=${route} /><${DialogHost} s=${s} /><${Toasts} s=${s} />`;
  const project = top === 'p' ? projectOf(s, route.parts[1]) : null;
  let content;
  if (top === 'p' && project) content = html`<${ProjectView} s=${s} route=${route} project=${project} />`;
  else if (top === 'p') content = html`<div class="view-body"><div class="page"><div class="empty" data-empty><strong>This project does not exist</strong><span>It may have been removed. <a class="link" href=${href('/home')}>Go to Home</a></span></div></div></div>`;
  else if (top === 'r') content = route.parts[2] === 'design' ? html`<${RepoDesign} s=${s} repoId=${route.parts[1]} route=${route} />` : html`<${RepoPage} s=${s} repoId=${route.parts[1]} />`;
  else if (top === 'projects') content = html`<${AllProjects} s=${s} />`;
  else if (top === 'machines') content = html`<${Machines} s=${s} route=${route} />`;
  else if (top === 'subscriptions') content = html`<${Subscriptions} s=${s} route=${route} />`;
  else if (top === 'notifications') content = html`<${Notifications} s=${s} route=${route} />`;
  else if (top === 'settings') content = html`<${ServiceSettings} s=${s} route=${route} />`;
  else content = html`<${Home} s=${s} route=${route} />`;
  // Focus hides the sidebar, the top bar, the tab row and the lead panel, so the board fills the window.
  const focus = s.ui.focus && top === 'p' && (route.parts[2] || 'board') === 'board';
  return html`<div class=${cx('app', s.prefs.sidebarFolded && 'folded', drawer && 'drawer-open', focus && 'focus')} style=${{ '--sidebar-w': s.prefs.sidebarWidth + 'px' }}>
    <${Sidebar} s=${s} route=${route} onNavigate=${() => setDrawer(false)} />
    ${drawer && html`<div class="drawer-scrim" onClick=${() => setDrawer(false)}></div>`}
    <div class="main">
      <${TopBar} s=${s} route=${route} project=${project} onMenu=${() => setDrawer(true)} />
      ${content}
    </div>
    <${DialogHost} s=${s} /><${Toasts} s=${s} />
  </div>`;
}

// ---- start ----------------------------------------------------------------------
// The mock starts through mount(), so that another page can load it as a package.
// This folder's own page calls it from main.js. A page that loads the package can pass:
//   connection   receives every engine call and pushed update; see engine.js
//   slots        components for the named places above, by name
export { App };
export function mount(el, { connection, slots: fills, mode = 'mock' } = {}) {
  engine.setConnection(connection);
  slots = fills || {};
  live.on = mode === 'live';
  if (live.on) return mountLive(el);
  const state = seed();
  state.ui = {};
  for (const add of [seedGit, seedTerminal, seedMocks, seedBoard, seedWorkflow, seedService, seedAuth]) add?.(state);
  store.state = state;
  act.applyPrefs();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', act.applyPrefs);
  act.startSimulation();
  // The real website reads everything once, then follows the engine's stream of changes.
  engine.call('snapshot', {});
  engine.call('subscribe', { after: 0 });
  render(html`<${App} />`, el);
  return { store, act };
}

// ---- live mode -------------------------------------------------------------------
// The page that loads the website chooses live mode with mount(el, { connection, mode: 'live' }).
// The store starts empty, nothing from seed() is read, and the simulation never starts. The
// connection fills the store from the engine. It calls the function it is given with a patch
// of whole store keys, such as { repos, projects, agents } or { session } or { conn }, already
// in the store's shape. See engine.js for what the connection provides.
function mountLive(el) {
  const state = emptyState();
  state.ui = {};
  seedTerminal(state);
  Object.assign(state, { worktrees: [], gitUi: {}, boardRead: {}, boardUnread: {}, boardRevision: 0, boardDetails: {}, taskDetails: {}, setupData: null, boardAgents: {}, notifications: [], workflow: {}, mocks: {}, design: {} });
  store.state = guardStore(state);
  act.applyPrefs();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', act.applyPrefs);
  // A screen that changes an engine record outside update() is refused the same way.
  addEventListener('error', onRefusedError);
  addEventListener('unhandledrejection', onRefusedError);
  engine.connection().open?.((patch) => {
    if (patch.session && patch.session.status !== 'checking' && patch.session.status !== 'in') {
      chat.reset(); engineWrite({ threads: {}, pending: {} });
    }
    if (patch.chatEvent) { chat.receive(patch.chatEvent); return; }
    chat.enrich(patch);
    // The Workflow and Mocks tabs keep one record per project. Each live project gets an
    // empty one, frozen like the rest, so the tabs show their empty structure.
    if (patch.projects) Object.assign(patch, {
      workflow: Object.fromEntries(patch.projects.map((p) => [p.id, store.state.workflow[p.id] || emptyWorkflow()])),
      mocks: Object.fromEntries(patch.projects.map((p) => [p.id, store.state.mocks[p.id] || emptyMocks()])),
    });
    // A harness the page has no words for is named by the engine's id for it.
    for (const x of [...(patch.agents || []), ...(patch.subscriptions || [])]) {
      if (x.harness && !HARNESSES[x.harness]) HARNESSES[x.harness] = { name: x.harness, models: [], efforts: [], noEffort: [], runMode: 'ACP' };
    }
    engineWrite(patch);
    if (patch.conn?.status === 'live') chat.connected();
    // The sidebar opens each repository the first time the engine names it, as the sample does.
    if (patch.repos) for (const r of patch.repos) if (store.state.expanded['repo:' + r.id] === undefined) store.state.expanded['repo:' + r.id] = true;
  });
  render(html`<${App} />`, el);
  return { store, act };
}
function onRefusedError(e) {
  const error = e.error || e.reason;
  if (live.on && refusal(error)) { e.preventDefault(); refuse(); }
}

// Takes the website out of the element and returns to the default connection.
export function unmount(el) {
  render(null, el);
  if (live.on) { chat.reset(); engine.connection().close?.(); removeEventListener('error', onRefusedError); removeEventListener('unhandledrejection', onRefusedError); live.on = false; }
  engine.setConnection(null);
  slots = {};
}
