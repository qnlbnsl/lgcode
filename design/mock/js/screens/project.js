// The project board, sprint and task pages, the team page, and the repository page.
import { html, useState, useRef, Icon, cx, href, go, ago, clock, dayLabel, useNow, plural, update, uid, useKey, store, DAY, persist, remember, live, useEffect } from '../lib.js';
import {
  STAGES, PHASES, COLUMNS, PRIORITIES, TASK_STATES, sprintsOf, epicsOf, tasksOfSprint, tasksOfTeam, teamOf, teamName, teamsOf, agentOf, agentsOfTeam, agentsOfProject,
  requestsOfSprint, requestsOfTask, openRequests, sprintProgress, agentStatus, byId, repoOf, machineOf, leadOf, routeForAgent, agentLabel, HARNESSES, subLabel,
} from '../data.js';
import * as act from '../actions.js';
import * as board from '../live/board.js';
import { Avatar, RequestBlock, Empty, StateWord, AgentLine, Menu } from '../ui.js';
import { ProjectTable } from './home.js';

// ---- status line ----------------------------------------------------------------
// The project's stage and phase as one quiet line that links to Workflow.
export function StatusLine({ s, project }) {
  if (live.on) return html`<a class="status-link" href=${href(`/p/${project.id}/workflow`)}><span>${project.stage}</span><${Icon} name="arrow-right" size=${12} class="faint" /></a>`;
  const phase = PHASES.find((p) => p.id === project.phase);
  return html`<a class="status-link" href=${href(`/p/${project.id}/workflow`)} title="Open Workflow">
    <span>${phase.name}</span><span class="muted">· Phase ${phase.n} of 8</span><${Icon} name="arrow-right" size=${12} class="faint" /></a>`;
}

// ---- board ----------------------------------------------------------------------
// One project, three views of the same items, after GitHub Projects: Board groups by
// status, Table sorts and filters, Roadmap lays epics and sprints along a time line.
const PRIO_ICON = { Urgent: 'zap', High: 'arrow-up', Medium: 'minus', Low: 'arrow-down' };
function Priority({ p, label = false }) {
  if (live.on) return null;
  return html`<span class=${cx('prio', 'p-' + p.toLowerCase())} title=${'Priority: ' + p}><${Icon} name=${PRIO_ICON[p]} size=${12} />${label && html`<span>${p}</span>`}</span>`;
}
function SprintCard({ s, sp, hover }) {
  const pr = sprintProgress(s, sp); const reqs = requestsOfSprint(s, sp.id);
  const t = sp.team && teamOf(s, sp.team); const ep = sp.epic && byId(s.epics, sp.epic);
  const failed = reqs.some((r) => r.kind === 'failed');
  return html`<a class=${cx('sprint-card', reqs.length && (failed ? 'error' : 'warn'), sp.column === 'Done' && 'done')} href=${href(`/p/${sp.project}/sprint/${sp.id}`)}
    onMouseEnter=${hover && ((e) => hover.show(sp, e.currentTarget))} onMouseLeave=${hover && hover.hide} onFocus=${hover && ((e) => hover.show(sp, e.currentTarget, true))} onBlur=${hover && hover.hide}>
    <div class="card-top"><span class="tag">${sp.label}</span>${ep && html`<span class="epic-chip truncate">${ep.name}</span>`}<span class="grow"></span><${Priority} p=${sp.priority || 'Medium'} /></div>
    <h3>${sp.name}</h3>
    ${reqs.length > 0 && html`<div class=${cx('need', failed && 'error')}><${Icon} name=${failed ? 'circle-alert' : 'bell'} size=${13} />${reqs.length === 1 ? { question: 'Needs your answer', approval: 'Needs your approval', merge: 'Needs your merge', failed: 'Failed start' }[reqs[0].kind] : `${reqs.length} requests need you`}</div>`}
    <div class="card-foot">
      <span class="stage-word">${sp.phase}</span>
      ${t ? html`<span class="muted truncate">${t.area || teamName(t)}</span>` : html`<span class="faint">No team</span>`}
      <span class="grow"></span>
      ${pr.total > 0 && html`<span class="faint num">${pr.done}/${pr.total}</span>`}
    </div>
  </a>`;
}
function useBoardFilter(s, project) {
  const [q, setQ] = useState(''); const [epic, setEpic] = useState(null);
  const all = sprintsOf(s, project.id);
  const items = all.filter((x) => (!epic || x.epic === epic) && (!q || `${x.label} ${x.name} ${x.goal}`.toLowerCase().includes(q.toLowerCase())));
  return { q, setQ, epic, setEpic, items, all };
}
// Hovering a card shows the sprint's TL;DR under it. The note is fixed to the window, so the
// scrolling lanes do not clip it, and it goes away when the lanes scroll.
const canHover = typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches;
function useCardTip() {
  const [tip, setTip] = useState(null); const timer = useRef(0);
  const hide = () => { clearTimeout(timer.current); setTip(null); };
  const show = (sp, el, now) => { if (!canHover || !sp.goal) return; clearTimeout(timer.current);
    timer.current = setTimeout(() => { const r = el.getBoundingClientRect(); const below = r.bottom + 140 < innerHeight;
      const box = (el.closest('.board-lanes') || document.body).getBoundingClientRect();
      const left = Math.max(r.left, box.left + 8), right = Math.min(r.right, box.right - 8); if (right - left < 120) return;
      setTip({ sp, left, width: right - left, ...(below ? { top: r.bottom + 6 } : { bottom: innerHeight - r.top + 6 }) }); }, now ? 0 : 350); };
  const el = tip && html`<div class="card-tldr" role="tooltip" style=${{ left: tip.left + 'px', width: tip.width + 'px', top: tip.top != null ? tip.top + 'px' : 'auto', bottom: tip.bottom != null ? tip.bottom + 'px' : 'auto' }}>
    <b>TL;DR:</b> ${tip.sp.goal}</div>`;
  return { show, hide, el };
}
function BoardView({ s, items }) {
  const [col, setCol] = useState('In progress'); const tip = useCardTip();
  return html`
    <div class="col-jump only-phone-flex" role="tablist" aria-label="Board lanes">${COLUMNS.map((c) => html`<button type="button" key=${c} class="tab" aria-selected=${col === c} onClick=${() => { setCol(c); document.getElementById('lane-' + c.replace(' ', '-'))?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' }); }}>${c}<span class="count">${items.filter((x) => x.column === c).length}</span></button>`)}</div>
    <div class="board-lanes" data-main onScrollCapture=${tip.hide}>
      ${COLUMNS.map((c) => { const list = items.filter((x) => x.column === c).sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || requestsOfSprint(s, b.id).length - requestsOfSprint(s, a.id).length);
        return html`<section class="board-lane" key=${c} id=${'lane-' + c.replace(' ', '-')} aria-label=${c}>
          <header><h2>${c}</h2><span class="count">${list.length}</span></header>
          <div class="cards">${list.map((sp) => html`<${SprintCard} key=${sp.id} s=${s} sp=${sp} hover=${tip} />`)}</div>
        </section>`; })}
    </div>${tip.el}`;
}
const TCOLS = [
  { id: 'title', label: 'Title', key: (s, x) => x.label },
  { id: 'epic', label: 'Epic', key: (s, x) => byId(s.epics, x.epic)?.name || '' },
  { id: 'priority', label: 'Priority', key: (s, x) => PRIORITIES.indexOf(x.priority) },
  { id: 'team', label: 'Team', key: (s, x) => (x.team ? teamName(teamOf(s, x.team)) : '~') },
  { id: 'stage', label: 'Stage', key: (s, x) => STAGES.indexOf(x.phase) },
  { id: 'status', label: 'Status', key: (s, x) => COLUMNS.indexOf(x.column) },
  { id: 'progress', label: 'Tasks', key: (s, x) => sprintProgress(s, x).done, num: true },
];
function TableView({ s, items }) {
  const [sort, setSort] = useState({ col: 'status', dir: 'asc' });
  const c = TCOLS.find((x) => x.id === sort.col);
  const rows = [...items].sort((a, b) => { const x = c.key(s, a), y = c.key(s, b); return (x < y ? -1 : x > y ? 1 : 0) * (sort.dir === 'asc' ? 1 : -1); });
  return html`<div class="view-scroll" data-main><table class="table board-table">
    <thead><tr>${TCOLS.map((col) => html`<th key=${col.id} class=${col.num && 'num'} aria-sort=${sort.col === col.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : null}>
      <button type="button" class="th-sort" onClick=${() => setSort(sort.col === col.id ? { col: col.id, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { col: col.id, dir: 'asc' })}>${col.label}${sort.col === col.id && html`<${Icon} name=${sort.dir === 'asc' ? 'arrow-up' : 'arrow-down'} size=${11} />`}</button></th>`)}</tr></thead>
    <tbody>${rows.map((x) => { const reqs = requestsOfSprint(s, x.id); const pr = sprintProgress(s, x); const t = x.team && teamOf(s, x.team);
      return html`<tr key=${x.id} class=${cx('click', reqs.length && (reqs.some((r) => r.kind === 'failed') ? 's-error' : 's-warn'))} onClick=${() => go(`/p/${x.project}/sprint/${x.id}`)}>
        <td class="state-cell"><span class="tag">${x.label}</span> <a href=${href(`/p/${x.project}/sprint/${x.id}`)} onClick=${(e) => e.stopPropagation()} style="font-weight:var(--weight-medium)">${x.name}</a>${reqs.length > 0 && html` <${Icon} name="bell" size=${12} class="warn-text" style="display:inline-block;vertical-align:-1px" />`}</td>
        <td class="muted">${byId(s.epics, x.epic)?.name || '—'}</td>
        <td><${Priority} p=${x.priority || 'Medium'} label=${true} /></td>
        <td class="muted">${t ? teamName(t) : '—'}</td>
        <td>${x.phase}</td>
        <td><span class=${cx('status-word', 'st-' + x.column.replace(' ', '-').toLowerCase())}>${x.column}</span></td>
        <td class="num muted">${pr.total ? `${pr.done} of ${pr.total}` : '—'}</td></tr>`; })}
      ${rows.length === 0 && html`<tr><td colspan=${TCOLS.length} class="muted" data-empty>No sprints</td></tr>`}</tbody></table></div>`;
}
// The roadmap: one row for each epic, with its sprints under it, along a time line in days.
function RoadmapView({ s, project, items }) {
  const DAYPX = 96; const now = Date.now();
  const epics = epicsOf(s, project.id);
  const span = items.length ? [Math.min(-1, ...items.map((x) => x.start ?? 0)) - 1, Math.max(7, ...items.map((x) => x.end ?? 1)) + 1] : [-2, 8];
  const from = Math.floor(span[0]), to = Math.ceil(span[1]); const days = Array.from({ length: to - from }, (_, i) => from + i);
  const x = (d) => (d - from) * DAYPX;
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
  const label = (d) => { const t = new Date(day0.getTime() + d * DAY); return d === 0 ? 'Today' : t.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }); };
  const groups = [...epics.map((e) => ({ e, list: items.filter((sp) => sp.epic === e.id) })), { e: null, list: items.filter((sp) => !sp.epic) }].filter((g) => g.e || g.list.length);
  const todayX = x((now - day0.getTime()) / DAY);
  // Two dedicated columns: the names stay put on the left, and only the time line scrolls sideways under its own header.
  const rows = [{ k: 'goal' }];
  for (const { e, list } of groups) {
    const st = list.length ? Math.min(...list.map((sp) => sp.start ?? 0)) : null; const en = list.length ? Math.max(...list.map((sp) => sp.end ?? 1)) : null;
    rows.push({ k: 'epic', id: e ? e.id : 'none', e, n: list.length, st, en });
    for (const sp of [...list].sort((a, b) => (a.start ?? 0) - (b.start ?? 0))) rows.push({ k: 'sprint', id: sp.id, sp });
  }
  const sprintHref = (sp) => href(`/p/${sp.project}/sprint/${sp.id}`);
  const name = (r) => r.k === 'goal' ? html`<div class="rm-cell rm-goal" key="goal"><${Icon} name="target" size=${13} class="faint" /><span class="truncate">${project.goal}</span></div>`
    : r.k === 'epic' ? html`<div class="rm-cell epic" key=${r.id}><${Icon} name="layers" size=${13} class="faint" /><b class="truncate">${r.e ? r.e.name : 'No epic'}</b><span class="count">${r.n}</span></div>`
    : html`<div class="rm-cell" key=${r.id}><span class="tag">${r.sp.label}</span><a class="truncate" href=${sprintHref(r.sp)}>${r.sp.name}</a></div>`;
  const track = (r) => html`<div class=${cx('rm-cell rm-track', r.k === 'epic' && 'epic')} key=${r.k + (r.id || '')}>
    ${r.k === 'epic' && !live.on && r.st != null && html`<span class="rm-bar epic" style=${{ left: x(r.st) + 'px', width: (r.en - r.st) * DAYPX + 'px' }}></span>`}
    ${r.k === 'sprint' && (!live.on || (r.sp.start != null && r.sp.end != null)) && html`<a class=${cx('rm-bar', 'st-' + r.sp.column.replace(' ', '-').toLowerCase())} href=${sprintHref(r.sp)} style=${{ left: x(r.sp.start ?? 0) + 'px', width: Math.max(0.3, (r.sp.end ?? 1) - (r.sp.start ?? 0)) * DAYPX + 'px' }} title=${`${r.sp.label} ${r.sp.name} · ${r.sp.column}`}><span class="truncate">${r.sp.name}</span></a>`}</div>`;
  return html`<div class="roadmap" data-main>
    <div class="rm-grid" style=${{ '--rm-w': (to - from) * DAYPX + 'px', '--day': DAYPX + 'px' }}>
      <div class="rm-names">
        <div class="rm-cell rm-head">Epic and sprint</div>
        ${rows.map(name)}
        ${groups.length === 0 && html`<div class="rm-cell muted" data-empty>No epics</div>`}
      </div>
      <div class="rm-time">
        <div class="rm-cell rm-head rm-axis">${days.map((d) => html`<span key=${d} class=${cx(d === 0 && 'today')} style=${{ left: x(d) + 'px' }}>${label(d)}</span>`)}</div>
        ${rows.map(track)}
        ${groups.length === 0 && html`<div class="rm-cell rm-track"></div>`}
        <i class="rm-now" style=${{ left: todayX + 'px' }}></i>
      </div>
    </div>
  </div>`;
}
export function Board({ s, project, route }) {
  const view = ['table', 'roadmap'].includes(route.parts[3]) ? route.parts[3] : 'board';
  const f = useBoardFilter(s, project); const focus = !!s.ui.focus;
  const epics = epicsOf(s, project.id);
  useKey((e) => { if (e.key === 'Escape' && store.state.ui.focus && !store.state.dialog) update((st) => { st.ui.focus = false; }); }, []);
  if (project.archived) return html`<div class="page"><${Empty} title="This project is archived" icon="archive">Its agents are stopped. <button type="button" class="btn sm" disabled=${live.on && board.busy('project:' + project.id)} aria-busy=${live.on && board.busy('project:' + project.id)} onClick=${() => act.archiveProject(project.id, false)}>Restore</button><//></div>`;
  const views = [['board', 'Board', 'kanban'], ['table', 'Table', 'table-2'], ['roadmap', 'Roadmap', 'calendar']];
  return html`<div class="board-page">
    <div class="board-bar">
      <nav class="view-tabs" aria-label="Board views">${views.map(([id, label, icon]) => html`<a key=${id} class="view-tab" aria-current=${view === id ? 'page' : null} href=${href(`/p/${project.id}/board${id === 'board' ? '' : '/' + id}`)}><${Icon} name=${icon} size=${14} />${label}</a>`)}</nav>
      <div class="search"><${Icon} name="search" size=${14} /><input class="input" placeholder="Filter" aria-label="Filter sprints" value=${f.q} onInput=${(e) => f.setQ(e.target.value)} /></div>
      <${Menu} class=${cx('btn filter-btn', f.epic && 'set')} label="Epic" width=${240}
        trigger=${html`<span class="muted">Epic</span><b>${f.epic ? byId(s.epics, f.epic).name : 'All'}</b><${Icon} name="chevron-down" size=${12} />`}
        items=${[{ label: 'All', sub: String(f.all.length), checked: !f.epic, onSelect: () => f.setEpic(null) }, { sep: true }, ...epics.map((e) => ({ label: e.name, sub: String(f.all.filter((x) => x.epic === e.id).length), checked: f.epic === e.id, onSelect: () => f.setEpic(e.id) }))]} />
      <span class="grow"></span>
      <${StatusLine} s=${s} project=${project} />
      <button type="button" class="btn icon" aria-pressed=${focus} aria-label=${focus ? 'Leave focus' : 'Focus on the board'} data-tip=${focus ? 'Leave focus · Esc' : 'Focus'} data-tip-side="left"
        onClick=${() => update((st) => { st.ui.focus = !st.ui.focus; })}><${Icon} name=${focus ? 'minimize-2' : 'maximize-2'} size=${14} /></button>
    </div>
    ${view === 'board' && html`<${BoardView} s=${s} items=${f.items} />`}
    ${view === 'table' && html`<${TableView} s=${s} items=${f.items} />`}
    ${view === 'roadmap' && html`<${RoadmapView} s=${s} project=${project} items=${f.items} />`}
  </div>`;
}

// ---- tables ---------------------------------------------------------------------
function TaskState({ t }) {
  const tone = { done: 'success', blocked: 'warn', active: 'info', review: 'info', queue: '' }[t.state];
  const word = t.state === 'blocked' ? { approval: 'Blocked by an approval', question: 'Blocked by a question', failed: 'Blocked by a failed start' }[t.blockedBy] || 'Blocked' : TASK_STATES[t.state];
  return html`<span class=${cx('badge', tone)}>${word}</span>`;
}
export function TaskTable({ s, tasks, showSprint = false }) {
  if (!tasks.length) return html`<${Empty} title="No tasks yet">Tasks appear when the team lead splits the plan into subitems.<//>`;
  return html`<table class="table"><thead><tr><th>Task</th><th>Title</th><th>State</th><th>Owner</th>${showSprint && html`<th>Sprint</th>`}<th class="num">Points</th></tr></thead>
    <tbody>${tasks.map((t) => { const o = t.owner && agentOf(s, t.owner); const sp = byId(s.sprints, t.sprint);
      return html`<tr key=${t.id} class=${cx('click', t.state === 'blocked' && 's-warn')} onClick=${() => go(`/p/${t.project}/task/${t.id}`)}>
        <td class="state-cell"><a class="mono" href=${href(`/p/${t.project}/task/${t.id}`)} onClick=${(e) => e.stopPropagation()}>${t.label}</a></td>
        <td class="truncate" style="max-width:420px">${t.title}</td>
        <td><${TaskState} t=${t} /></td>
        <td>${o ? html`<span class="row" style="gap:6px"><${Avatar} agent=${o} s=${s} size="sm" /><span>${o.name}</span></span>` : html`<span class="faint">Unassigned</span>`}</td>
        ${showSprint && html`<td class="muted">${sp?.label}</td>`}
        <td class="num muted">${t.points}</td></tr>`; })}</tbody></table>`;
}

// ---- sprint page ----------------------------------------------------------------
// A sprint shows its plan and its tasks. The tasks are the short version of the plan, and
// each task names the part of the plan it carries out. Two toggles, Plan and Tasks, show or
// hide each side; one side always stays. The plan is an HTML page, drawn in a frame.
const PANES = [['plan', 'Plan', 'file-text'], ['tasks', 'Tasks', 'list-checks']];
function PlanPane({ sp, frame }) {
  const theme = () => { const d = frame.current?.contentDocument; if (d) d.documentElement.setAttribute('data-theme', document.documentElement.getAttribute('data-theme') || 'light'); };
  return html`<section class="tk-plan" aria-label="Plan">
    <div class="tk-panehead"><${Icon} name="file-text" size=${14} class="faint" />${sp.plan ? html`<span class="mono truncate">${sp.plan.file}</span><span class="badge" title=${'Written by ' + sp.plan.by}>${sp.plan.state}</span>`
      : html`<span class="muted">Plan</span>`}</div>
    ${sp.plan ? html`<iframe ref=${frame} class="tk-frame" src=${sp.plan.src} title=${'Plan for ' + sp.label} onLoad=${theme}></iframe>`
      : html`<div class="tk-noplan" data-empty><strong>No plan yet</strong><span>The planner writes it in the Plan phase.</span></div>`}
  </section>`;
}
function TaskRows({ s, tasks, onSection, wide }) {
  if (!tasks.length) return html`<tr><td colspan=${wide ? 6 : 3} class="muted" data-empty>No tasks yet</td></tr>`;
  return tasks.map((t) => { const o = t.owner && agentOf(s, t.owner);
    const sec = t.section && html`<button type="button" class="link tk-sec" onClick=${(e) => { e.stopPropagation(); onSection(t); }}><${Icon} name="file-text" size=${12} />${t.sectionName}</button>`;
    return wide
      ? html`<tr key=${t.id} class=${cx('click', t.state === 'blocked' && 's-warn')} onClick=${() => go(`/p/${t.project}/task/${t.id}`)}>
          <td class="state-cell mono"><a href=${href(`/p/${t.project}/task/${t.id}`)} onClick=${(e) => e.stopPropagation()}>${t.label}</a></td>
          <td class="wrap">${t.title}</td><td><${TaskState} t=${t} /></td>
          <td>${o ? html`<span class="row" style="gap:6px"><${Avatar} agent=${o} s=${s} size="sm" />${o.name}</span>` : html`<span class="faint">Unassigned</span>`}</td>
          <td>${sec || html`<span class="faint">None</span>`}</td><td class="num muted">${t.points}</td></tr>`
      : html`<tr key=${t.id} class=${cx('click', t.state === 'blocked' && 's-warn')} onClick=${() => go(`/p/${t.project}/task/${t.id}`)}>
          <td class="state-cell mono tk-label"><a href=${href(`/p/${t.project}/task/${t.id}`)} onClick=${(e) => e.stopPropagation()}>${t.label}</a></td>
          <td class="wrap"><div class="tk-title">${t.title}</div><div class="tk-sub"><${TaskState} t=${t} />${sec}${o && html`<span class="muted">${o.name}</span>`}</div></td>
          <td class="num muted">${t.points}</td></tr>`; });
}
export function SprintPage({ s, project, sprintId }) {
  const sp = byId(s.sprints, sprintId); const [adding, setAdding] = useState(false); const [title, setTitle] = useState('');
  const [view, setViewState] = useState(() => persist('sprintView', 'both'));
  const setView = (v) => { setViewState(v); remember('sprintView', v); };
  const shown = { plan: view !== 'tasks', tasks: view !== 'plan' };
  const toggle = (k) => { const n = { ...shown, [k]: !shown[k] }; if (n.plan || n.tasks) setView(n.plan && n.tasks ? 'both' : n.plan ? 'plan' : 'tasks'); };
  const frame = useRef(null);
  if (!sp) return html`<div class="page"><${Empty} title="This sprint does not exist">It may have been removed. <a class="link" href=${href(`/p/${project.id}/board`)}>Back to the board</a><//></div>`;
  const tasks = tasksOfSprint(s, sp.id); const reqs = requestsOfSprint(s, sp.id); const t = sp.team && teamOf(s, sp.team); const pr = sprintProgress(s, sp);
  const done = sp.column === 'Done'; const epic = epicsOf(s, project.id).find((e) => e.id === sp.epic);
  const add = async (e) => { e.preventDefault(); if (!title.trim()) return;
    if (live.on) { const reply = await board.addTask(project, sp, title); if (reply) { setTitle(''); setAdding(false); } return; }
    update((st) => { const n = Math.max(...st.tasks.filter((x) => x.project === project.id).map((x) => +x.label.split('-')[1] || 0)) + 1;
      st.tasks.push({ id: uid('t'), project: project.id, label: `${project.prefix}-${n}`, title: title.trim(), sprint: sp.id, team: sp.team, owner: null, state: 'queue', points: 2, files: [], history: [{ ts: Date.now(), who: 'owner', text: 'You added this task. The project lead was told.' }] }); });
    act.toast('Task added. The project lead was told.'); setTitle(''); setAdding(false); };
  // A task's plan link scrolls the plan to that part and marks it for a moment.
  const toSection = (task) => {
    if (view === 'tasks') setView('both');
    requestAnimationFrame(() => setTimeout(() => { const d = frame.current?.contentDocument; const h = d?.getElementById(task.section); if (!h) return;
      h.scrollIntoView({ behavior: 'smooth', block: 'start' }); h.classList.remove('hit'); void h.offsetWidth; h.classList.add('hit'); }, view === 'tasks' ? 200 : 0));
  };
  const deps = sp.dependsOn.map((id) => byId(s.sprints, id)).filter(Boolean);
  const meta = [
    ['Status', sp.column], ['Phase', sp.phase], ['Priority', sp.priority || 'None'], ['Epic', epic ? epic.name : 'None'],
    ['Team', t ? html`<a class="link" href=${href(`/p/${project.id}/team/${t.id}`)}>${teamName(t)}</a>` : html`<span class="muted">Not staffed</span>`],
    ['Depends on', deps.length ? deps.map((d, n) => html`${n > 0 && ', '}<a class="link" href=${href(`/p/${project.id}/sprint/${d.id}`)}>${d.label}</a>${d.column === 'Done' ? ' (done)' : ''}`) : html`<span class="muted">None</span>`],
    ['Tasks', pr.total ? `${pr.done} of ${pr.total} done` : 'None yet'],
  ];
  const taskHead = html`<div class="tk-panehead"><${Icon} name="list-checks" size=${14} class="faint" /><b>Tasks</b><span class="count">${tasks.length}</span><span class="grow"></span>
    ${!done && html`<button type="button" class="btn sm" onClick=${() => setAdding(!adding)}><${Icon} name="plus" size=${13} />Add task</button>`}</div>
    ${adding && html`<form class="row tk-add" onSubmit=${add}><input class="input" autofocus placeholder="What should be done?" value=${title} onInput=${(e) => setTitle(e.target.value)} aria-label="Task title" />
      <button type="submit" class="btn" disabled=${!title.trim() || (live.on && board.busy('task:' + sp.id))} aria-busy=${live.on && board.busy('task:' + sp.id)}>${live.on && board.busy('task:' + sp.id) ? 'Adding…' : 'Add'}</button><button type="button" class="btn ghost" onClick=${() => setAdding(false)}>Cancel</button></form>`}`;
  return html`<div class=${cx('tk', 'v-' + view)}>
    <header class="tk-head">
      <div class="tk-titlerow">
        <a class="icon-btn" href=${href(`/p/${project.id}/board`)} aria-label="Back to the board" data-tip="Board"><${Icon} name="arrow-left" size=${16} /></a>
        <span class="tag">${sp.label}</span><h1 class="tk-name">${sp.name}</h1>${sp.fix && html`<span class="badge info">Fix sprint</span>`}
        <span class="grow"></span>
        <div class="seg tk-views" role="group" aria-label="What to show">${PANES.map(([id, label, icon]) => html`<button key=${id} type="button" aria-pressed=${shown[id]} onClick=${() => toggle(id)}><${Icon} name=${icon} size=${14} /><span>${label}</span></button>`)}</div>
      </div>
      <p class="tk-goal"><b class="tk-tldr">TL;DR:</b> ${sp.goal}</p>
      ${sp.evidence && html`<p class="tk-evidence">${Object.values(sp.evidence).map((e) => html`<span class="row"><${Icon} name="circle-check" size=${14} class="success-text" />${e}</span>`)}</p>`}
      <dl class="tk-meta">${meta.map(([k, v]) => html`<div key=${k}><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
      ${reqs.length > 0 && html`<div class="stack tk-reqs">${reqs.map((r) => html`<${RequestBlock} key=${r.id} s=${s} request=${r} openThread=${() => act.openSidePanel(r.agent, r.id)} />`)}</div>`}
    </header>
    <div class="tk-body">
      ${view !== 'tasks' && html`<${PlanPane} sp=${sp} frame=${frame} />`}
      ${view === 'both' && html`<section class="tk-tasks" aria-label="Tasks">${taskHead}<div class="tk-scroll" data-main><table class="table tk-table"><tbody><${TaskRows} s=${s} tasks=${tasks} onSection=${toSection} /></tbody></table></div></section>`}
      ${view === 'tasks' && html`<section class="tk-tasks wide" aria-label="Tasks">${taskHead}<div class="tk-scroll" data-main><div class="table-wrap"><table class="table"><thead><tr><th>Task</th><th>Title</th><th>State</th><th>Owner</th><th>Part of the plan</th><th class="num">Points</th></tr></thead>
        <tbody><${TaskRows} s=${s} tasks=${tasks} onSection=${toSection} wide=${true} /></tbody></table></div></div></section>`}
    </div>
  </div>`;
}

// ---- task page ------------------------------------------------------------------
export function TaskPage({ s, project, taskId }) {
  const t = byId(s.tasks, taskId); const now = useNow();
  useEffect(() => { if (live.on && t?.worktreeId) void board.loadTask(project, t); }, [taskId, t?.worktreeId, s.boardRevision]);
  const detail = live.on ? s.taskDetails?.[taskId] : t;
  const files = detail?.files || [], history = detail?.history || [];
  if (!t) return html`<div class="page"><${Empty} title="This task does not exist">It may have been removed. <a class="link" href=${href(`/p/${project.id}/board`)}>Back to the board</a><//></div>`;
  const sp = byId(s.sprints, t.sprint); const o = t.owner && agentOf(s, t.owner); const team = t.team && teamOf(s, t.team); const reqs = requestsOfTask(s, t.id);
  return html`<div class="page narrow">
    <a class="back" href=${href(`/p/${project.id}/sprint/${sp.id}`)}><${Icon} name="arrow-left" size=${14} />${sp.label} ${sp.name}</a>
    <div class="page-head" style="margin-top:6px"><h1 class="page-title grow">${t.title}</h1>
      ${o && html`<a class=${cx('btn', !reqs.length && 'primary')} href=${href(routeForAgent(s, o))}><${Icon} name="message-square" size=${14} />Talk to ${o.name}</a>`}</div>
    <p class="status-line"><span class="tag">${t.label}</span><${TaskState} t=${t} /><span>${t.points == null ? '' : t.points + ' points'}</span></p>
    ${reqs.length > 0 && html`<div class="stack">${reqs.map((r) => html`<${RequestBlock} key=${r.id} s=${s} request=${r} openThread=${() => act.openSidePanel(r.agent, r.id)} />`)}</div>`}
    <dl class="dl facts">
      <dt>Owner</dt><dd>${o ? html`<${AgentLine} s=${s} agent=${o} />` : html`<span class="muted">Unassigned. The team lead assigns it in dependency order.</span>`}</dd>
      <dt>Team</dt><dd>${team ? html`<a class="link" href=${href(`/p/${project.id}/team/${team.id}`)}>${teamName(team)}</a>` : html`<span class="muted">None</span>`}</dd>
      <dt>Worktree</dt><dd class="mono truncate-start" title=${live.on ? detail?.branch || '' : team ? team.branch : project.branch}>${live.on ? detail?.branch || '' : team ? team.branch : project.branch}</dd>
      ${o && o.activity && html`<dt>Doing now</dt><dd>${o.activity}</dd>`}
    </dl>
    ${live.on && detail?.folder && html`<p class="mono muted">${detail.folder}</p>`}
    ${live.on && board.busy('read-task:' + taskId) && html`<p class="muted" role="status">Loading task details…</p>`}
    <div class="section-head" style="margin-top:var(--gap-group)"><h2>Changed files</h2><span class="grow"></span>${files.length > 0 && html`<a class="link" href=${href(`/p/${project.id}/git`)}>Open in Git</a>`}</div>
    ${files.length ? html`<ul class="file-list">${files.map((f) => html`<li key=${f}><${Icon} name="file-code" size=${14} class="faint" /><span class="mono truncate-start">${f}</span></li>`)}</ul>` : html`<p class="muted">No files changed yet.</p>`}
    <div class="section-head" style="margin-top:var(--gap-group)"><h2>Work and handoff</h2></div>
    ${history.length ? html`<ol class="timeline">${history.map((h, i) => { const w = h.who === 'owner' ? null : agentOf(s, h.who);
      return html`<li key=${i}><time>${dayLabel(h.ts, now) === 'Today' ? clock(h.ts) : dayLabel(h.ts, now) + ' ' + clock(h.ts)}</time><span><b>${w ? w.name : live.on ? '' : 'You'}</b> ${h.text}</span></li>`; })}</ol>`
      : html`<p class="muted">Nothing has happened on this task yet.</p>`}
  </div>`;
}

// ---- team page ------------------------------------------------------------------
export function TeamPage({ s, project, teamId }) {
  const t = teamOf(s, teamId);
  const memberIds = agentsOfTeam(s, teamId).map((a) => a.id).join(',');
  useEffect(() => { if (live.on && memberIds) void board.loadAgents(memberIds.split(',')); }, [teamId, memberIds, s.boardRevision]);
  if (!t) return html`<div class="page"><${Empty} title="This team does not exist">It may have finished. <a class="link" href=${href(`/p/${project.id}/board`)}>Back to the board</a><//></div>`;
  const ags = agentsOfTeam(s, t.id); const tasks = tasksOfTeam(s, t.id); const ch = s.channels.find((c) => c.team === t.id);
  return html`<div class="page">
    <div class="page-head"><h1 class="page-title">${teamName(t)}</h1><span class="sub mono">${t.branch}</span><span class="grow"></span>
      ${ch && html`<a class="btn" href=${href(`/p/${project.id}/messages/${ch.id}`)}><${Icon} name="hash" size=${14} />Team channel</a>`}
      <a class="btn" href=${href(`/p/${project.id}/git`)}><${Icon} name="git-branch" size=${14} />Git</a></div>
    <div class="section-head"><h2>Agents</h2><span class="count">${ags.length}</span></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Role</th><th>Status</th><th>Doing now</th><th>Task</th><th>Harness and model</th><th class="num">Context</th></tr></thead>
      <tbody>${ags.map((a) => { const st = agentStatus(s, a); const task = a.task && s.tasks.find((x) => x.label === a.task && x.project === a.project);
        return html`<tr key=${a.id} class=${cx('click', st.tone === 'warn' && 's-warn', st.tone === 'error' && 's-error')} onClick=${() => go(routeForAgent(s, a))}>
          <td class="state-cell"><span class="row" style="gap:8px"><${Avatar} agent=${a} s=${s} size="sm" /><a href=${href(routeForAgent(s, a))} style="font-weight:var(--weight-medium)" onClick=${(e) => e.stopPropagation()}>${a.name}</a></span></td>
          <td><${StateWord} status=${st} /></td><td class="muted truncate" style="max-width:340px">${a.activity || '—'}</td>
          <td>${task ? html`<a class="mono" href=${href(`/p/${project.id}/task/${task.id}`)} onClick=${(e) => e.stopPropagation()}>${task.label}</a>` : html`<span class="faint">—</span>`}</td>
          <td class="muted">${HARNESSES[a.harness]?.name || a.harness} · ${live.on ? s.boardAgents?.[a.id]?.models.find((m) => m.id === a.model)?.label || a.model : a.model} · ${live.on ? s.boardAgents?.[a.id]?.efforts.find((e) => e.id === a.effort)?.label || a.effort : a.effort}</td><td class=${cx('num', a.context >= 70 ? 'warn-text' : 'muted')}>${live.on ? (s.boardAgents?.[a.id]?.context == null ? '' : s.boardAgents[a.id].context + '%') : a.context + '%'}</td></tr>`; })}</tbody></table></div>
    <div class="section-head" style="margin-top:var(--gap-group)"><h2>Tasks</h2><span class="count">${tasks.length}</span></div>
    <div class="table-wrap" data-main><${TaskTable} s=${s} tasks=${tasks} showSprint=${true} /></div>
  </div>`;
}

// ---- repository page ------------------------------------------------------------
export function RepoPage({ s, repoId }) {
  const r = byId(s.repos, repoId);
  if (!r) return html`<div class="view-body"><div class="page"><${Empty} title="This repository is not known">Add it to a machine on the Machines page.<//></div></div>`;
  const ps = s.projects.filter((p) => p.repo === r.id).sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0));
  return html`<div class="view">
    <div class="tabrow" role="tablist"><a class="tab" role="tab" aria-selected="true" href=${href('/r/' + r.id)}>Projects<span class="count">${ps.filter((p) => !p.archived).length}</span></a>
      <a class="tab" role="tab" aria-selected="false" href=${href(`/r/${r.id}/design`)}>Design</a>
      <div class="tab-end"><button type="button" class="btn sm primary" onClick=${() => act.openDialog({ type: 'new-project', repo: r.id })}><${Icon} name="plus" size=${14} />New project</button></div></div>
    <div class="view-body">
      <div class="repo-facts">
        <dl class="dl">
          <dt>Remote</dt><dd class="mono">${live.on ? r.remote : r.remote || html`<span class="muted" style="font-family:var(--font-body)">None</span>`}</dd>
          <dt>Base branch</dt><dd class="mono">${r.main}</dd>
          <dt>Folders</dt><dd class="row" style="flex-wrap:wrap;gap:4px 14px">${Object.entries(r.folders).map(([m, f]) => html`<span key=${m}>${machineOf(s, m).name} <span class="mono muted">${f}</span></span>`)}</dd>
        </dl>
        <section class="repo-desc" aria-label="Product description">
          <h2>Product</h2>
          ${r.description ? html`<p>${r.description}</p>${r.describedAt && html`<small class="faint">Updated ${ago(r.describedAt)} ago by the project lead of ${(s.projects.find((p) => p.lead === r.describedBy) || {}).name}</small>`}`
            : live.on ? null : html`<p class="muted">Written by the first project lead.</p>`}
        </section>
      </div>
      <div data-main><${ProjectTable} s=${s} projects=${ps} showRepo=${false} /></div>
    </div>
  </div>`;
}
