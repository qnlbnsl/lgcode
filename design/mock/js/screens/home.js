import { watchHome, loadRequest } from '../live/chat.js';
// Home is one triage table: everything that needs the owner, across every project.
// Project navigation lives in the sidebar and on the All projects page, not here.
import { html, useState, useEffect, Icon, cx, href, go, ago, clock, useNow, HOUR } from '../lib.js';
import {
  openRequests, projectOf, repoOf, agentOf, teamOf, machineOf, KIND_LABEL, projectStatus, leadOf, agentStatus,
  agentsOfProject, byId, routeForRequest, STAGES,
} from '../data.js';
import * as act from '../actions.js';
import { RequestBlock, Avatar, Menu, Empty, StateWord } from '../ui.js';

const KINDS = ['question', 'approval', 'merge', 'failed'];
// The old Questions and Approvals tabs are now the Type filter on this page.
const KIND_FROM_ROUTE = { questions: 'question', approvals: 'approval' };

// The stage of a request is the stage of the sprint its task belongs to, else the project's.
function stageOf(s, r) {
  const t = r.task && byId(s.tasks, r.task); const sp = t && byId(s.sprints, t.sprint);
  return sp ? sp.phase : projectOf(s, r.project).stage;
}
const COLS = [
  { id: 'title', label: 'Title', key: (s, r) => r.title.toLowerCase() },
  { id: 'type', label: 'Type', key: (s, r) => KINDS.indexOf(r.kind) },
  { id: 'repo', label: 'Repository', key: (s, r) => repoOf(s, projectOf(s, r.project)).name },
  { id: 'project', label: 'Project', key: (s, r) => projectOf(s, r.project).name },
  { id: 'stage', label: 'Stage', key: (s, r) => STAGES.indexOf(stageOf(s, r)) },
  { id: 'agent', label: 'Agent', key: (s, r) => agentOf(s, r.agent).name },
  { id: 'waiting', label: 'Waiting', key: (s, r) => -r.createdAt, num: true },
];

function PhoneOffer({ s }) {
  if (s.phoneOffer !== 'open' || s.settings.ntfyServer) return null;
  return html`<div class="phone-offer" role="note">
    <${Icon} name="smartphone" size=${14} /><span>Phone notifications are off</span>
    <a class="btn sm" href=${href('/notifications')}>Set up</a>
    <button type="button" class="btn sm ghost" onClick=${act.declinePhoneOffer}>Not now</button>
  </div>`;
}

function FilterMenu({ label, value, items, onPick }) {
  const cur = items.find((x) => x.id === value);
  return html`<${Menu} class=${cx('btn filter-btn', value && 'set')} label=${label} width=${240}
    trigger=${html`<span class="muted">${label}</span><b>${cur ? cur.label : 'All'}</b><${Icon} name="chevron-down" size=${12} />`}
    items=${[{ label: 'All', sub: String(items.reduce((n, x) => n + x.n, 0)), checked: !value, onSelect: () => onPick(null) },
      { sep: true }, ...items.map((x) => ({ label: x.label, sub: String(x.n), checked: value === x.id, onSelect: () => onPick(x.id) }))]} />`;
}

function RequestRow({ s, r, now, ex, onToggle: toggle }) {
  const a = agentOf(s, r.agent); const p = projectOf(s, r.project); const t = a.team && teamOf(s, a.team);
  const isOpen = r.status === 'open'; const waited = now - r.createdAt;
  return html`
    <tr class=${cx('click rq', isOpen ? (r.kind === 'failed' ? 's-error' : 's-warn') : 'closed', ex && 'expanded')} aria-expanded=${ex} onClick=${toggle}>
      <td class="state-cell rq-title"><button type="button" class="rq-toggle" aria-expanded=${ex} aria-label=${(ex ? 'Hide ' : 'Show ') + r.title} onClick=${(e) => { e.stopPropagation(); toggle(); }}><${Icon} name="chevron-right" size=${14} /></button><span class="truncate">${r.title}</span></td>
      <td><span class=${cx('kind', isOpen ? r.kind : 'closed')}>${KIND_LABEL[r.kind]}</span></td>
      <td class="mono muted">${repoOf(s, p).name}</td>
      <td class="truncate rq-project">${p.name}</td>
      <td class="muted">${stageOf(s, r)}</td>
      <td><span class="row" style="gap:6px"><${Avatar} agent=${a} s=${s} size="sm" status=${false} /><span class="truncate">${a.name}${t?.area ? html`<span class="faint"> · ${t.area}</span>` : ''}</span></span></td>
      <td class=${cx('num rq-wait', isOpen && waited >= HOUR && 'long')}>${isOpen ? ago(r.createdAt, now) : html`<span class="muted">${r.answer} · ${clock(r.answeredAt)}</span>`}</td>
    </tr>
    ${ex && html`<tr class="rq-detail"><td colspan=${COLS.length}>
      <${RequestBlock} s=${s} request=${r} variant="detail" primary=${true} openThread=${routeForRequest(s, r)} />
    </td></tr>`}`;
}

export function Home({ s, route }) {
  useEffect(watchHome, []);
  const now = useNow();
  const [openId, setOpenId] = useState(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ col: 'waiting', dir: 'desc' });
  const [f, setF] = useState({ repo: null, project: null });
  const [answered, setAnswered] = useState(false);
  const kind = KIND_FROM_ROUTE[route.parts[1]] || route.query.get('type') || null;
  const setKind = (k) => go(k ? `/home?type=${k}` : '/home');

  const all = openRequests(s);
  const inScope = (r, skip) => {
    const p = projectOf(s, r.project);
    if (skip !== 'kind' && kind && r.kind !== kind) return false;
    if (skip !== 'repo' && f.repo && p.repo !== f.repo) return false;
    if (skip !== 'project' && f.project && r.project !== f.project) return false;
    if (q) { const a = agentOf(s, r.agent); if (!`${r.title} ${r.command || ''} ${p.name} ${a.name} ${KIND_LABEL[r.kind]}`.toLowerCase().includes(q.toLowerCase())) return false; }
    return true;
  };
  // Each filter counts what the other filters leave, so its numbers add up to the table.
  const kindItems = KINDS.map((k) => ({ id: k, label: KIND_LABEL[k], n: all.filter((r) => r.kind === k && inScope(r, 'kind')).length }));
  const repoItems = s.repos.map((r) => ({ id: r.id, label: r.name, n: all.filter((x) => projectOf(s, x.project).repo === r.id && inScope(x, 'repo')).length }));
  const projItems = s.projects.filter((p) => !p.archived && (!f.repo || p.repo === f.repo)).map((p) => ({ id: p.id, label: p.name, n: all.filter((x) => x.project === p.id && inScope(x, 'project')).length }));

  const col = COLS.find((c) => c.id === sort.col);
  const cmp = (a, b) => { const x = col.key(s, a), y = col.key(s, b); return (x < y ? -1 : x > y ? 1 : 0) * (sort.dir === 'asc' ? 1 : -1); };
  const rows = all.filter((r) => inScope(r)).sort(cmp);
  const done = answered ? s.requests.filter((r) => r.status === 'answered' && inScope(r)).sort((a, b) => b.answeredAt - a.answeredAt) : [];
  const anyFilter = kind || f.repo || f.project || q;
  const clickSort = (c) => setSort(sort.col === c.id ? { col: c.id, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { col: c.id, dir: c.num ? 'desc' : 'asc' });

  return html`<div class="view home">
    <div class="home-head">
      <h1>Needs attention</h1><span class=${cx('count', all.length && 'warn')}>${all.length}</span>
      <span class="grow"></span>
      <${PhoneOffer} s=${s} />
    </div>
    <div class="toolbar home-filters">
      <div class="search"><${Icon} name="search" size=${14} /><input class="input" placeholder="Search" aria-label="Search requests" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
      <div class="seg" role="group" aria-label="Type">
        <button type="button" aria-pressed=${!kind} onClick=${() => setKind(null)}>All<span class="seg-n">${kindItems.reduce((n, x) => n + x.n, 0)}</span></button>
        ${kindItems.map((x) => html`<button type="button" key=${x.id} aria-pressed=${kind === x.id} onClick=${() => setKind(kind === x.id ? null : x.id)}>${x.label}<span class="seg-n">${x.n}</span></button>`)}
      </div>
      <${FilterMenu} label="Repository" value=${f.repo} items=${repoItems} onPick=${(v) => setF({ repo: v, project: v && f.project && projectOf(s, f.project).repo !== v ? null : f.project })} />
      <${FilterMenu} label="Project" value=${f.project} items=${projItems} onPick=${(v) => setF({ ...f, project: v })} />
      <label class="check show-answered"><input type="checkbox" checked=${answered} onChange=${(e) => setAnswered(e.target.checked)} />Show answered</label>
      ${anyFilter && html`<button type="button" class="btn ghost sm" onClick=${() => { setF({ repo: null, project: null }); setQ(''); setKind(null); }}>Clear</button>`}
    </div>
    <div class="view-body">
      <table class="table rq-table" data-main>
        <colgroup><col class="c-title" /><col class="c-type" /><col class="c-repo" /><col class="c-project" /><col class="c-stage" /><col class="c-agent" /><col class="c-wait" /></colgroup>
        <thead><tr>${COLS.map((c) => html`<th key=${c.id} class=${cx(c.num && 'num', 'h-' + c.id)} aria-sort=${sort.col === c.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : null}>
          <button type="button" class="th-sort" onClick=${() => clickSort(c)}>${c.label}${sort.col === c.id && html`<${Icon} name=${sort.dir === 'asc' ? 'arrow-up' : 'arrow-down'} size=${11} />`}</button></th>`)}</tr></thead>
        <tbody>
          ${rows.map((r) => html`<${RequestRow} key=${r.id} s=${s} r=${r} now=${now} ex=${openId === r.id} onToggle=${() => { if (openId !== r.id) void loadRequest(r.id); setOpenId(openId === r.id ? null : r.id); }} />`)}
          ${rows.length === 0 && html`<tr class="rq-none"><td colspan=${COLS.length} data-empty>${anyFilter ? html`No open request matches. <button type="button" class="link" onClick=${() => { setF({ repo: null, project: null }); setQ(''); setKind(null); }}>Clear the filters</button>` : 'Nothing needs you.'}</td></tr>`}
          ${done.length > 0 && html`<tr class="rq-group"><td colspan=${COLS.length}>Answered<span class="count">${done.length}</span></td></tr>`}
          ${done.map((r) => html`<${RequestRow} key=${r.id} s=${s} r=${r} now=${now} ex=${openId === r.id} onToggle=${() => { if (openId !== r.id) void loadRequest(r.id); setOpenId(openId === r.id ? null : r.id); }} />`)}
        </tbody>
      </table>
    </div>
  </div>`;
}

// ---- All projects ------------------------------------------------------------------
export function StageDots({ stage }) {
  const i = STAGES.indexOf(stage);
  return html`<span class="stage-dots" title=${'Stage: ' + stage}>${STAGES.map((x, n) => html`<i key=${x} class=${cx(n < i && 'done', n === i && 'now')}></i>`)}<span>${stage}</span></span>`;
}
export function ProjectTable({ s, projects, showRepo = true }) {
  return html`<table class="table">
    <thead><tr><th>Project</th>${showRepo && html`<th>Repository</th>`}<th>Stage</th><th>Status</th><th>Project lead</th><th class="num">Agents</th><th>Machine</th><th>Branch</th><th></th></tr></thead>
    <tbody>${projects.map((p) => {
      const st = projectStatus(s, p); const lead = leadOf(s, p); const ags = agentsOfProject(s, p.id); const working = ags.filter((a) => a.state === 'working').length;
      return html`<tr key=${p.id} class=${cx('click', st.tone === 'warn' && 's-warn', st.tone === 'ok' && 's-ok')} onClick=${() => go(`/p/${p.id}/board`)}>
        <td class="state-cell"><a href=${href(`/p/${p.id}/board`)} style="font-weight:var(--weight-medium)" onClick=${(e) => e.stopPropagation()}>${p.name}</a></td>
        ${showRepo && html`<td class="mono muted">${repoOf(s, p).name}</td>`}
        <td>${p.archived ? html`<span class="muted">—</span>` : html`<${StageDots} stage=${p.stage} />`}</td>
        <td><${StateWord} status=${st} /></td>
        <td class="muted truncate" style="max-width:260px">${p.archived ? '—' : (lead.activity || agentStatus(s, lead).word)}</td>
        <td class="num muted">${p.archived ? '—' : `${working} of ${ags.length}`}</td>
        <td class="muted">${machineOf(s, p.machine).name}</td>
        <td class="mono muted">${p.branch}</td>
        <td style="text-align:right">${p.archived && html`<button type="button" class="btn sm" onClick=${(e) => { e.stopPropagation(); act.archiveProject(p.id, false); }}>Restore</button>`}</td>
      </tr>`;
    })}
    ${projects.length === 0 && html`<tr><td colspan="9" class="muted" data-empty>No project matches.</td></tr>`}</tbody></table>`;
}
export function AllProjects({ s }) {
  const [q, setQ] = useState(''); const [status, setStatus] = useState('all');
  let ps = [...s.projects].sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0));
  const counts = { all: ps.length, needs: ps.filter((p) => projectStatus(s, p).tone === 'warn').length, archived: ps.filter((p) => p.archived).length };
  ps = ps.filter((p) => (!q || `${p.name} ${repoOf(s, p).name} ${p.branch} ${p.goal}`.toLowerCase().includes(q.toLowerCase()))
    && (status === 'all' || (status === 'needs' && projectStatus(s, p).tone === 'warn') || (status === 'archived' && p.archived)));
  return html`<div class="view">
    <div class="home-head"><h1>All projects</h1><span class="count">${counts.all}</span><span class="grow"></span>
      <button type="button" class="btn sm" onClick=${() => act.openDialog({ type: 'new-project' })}><${Icon} name="plus" size=${14} />New project</button></div>
    <div class="toolbar">
      <div class="search"><${Icon} name="search" size=${14} /><input class="input" placeholder="Search" aria-label="Search projects" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
      <div class="seg" role="group" aria-label="Status">
        ${[['all', 'All'], ['needs', 'Needs you'], ['archived', 'Archived']].map(([k, l]) => html`<button type="button" key=${k} aria-pressed=${status === k} onClick=${() => setStatus(k)}>${l}<span class="seg-n">${counts[k]}</span></button>`)}
      </div>
    </div>
    <div class="view-body" data-main><${ProjectTable} s=${s} projects=${ps} /></div>
  </div>`;
}
export { Empty };
