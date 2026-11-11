// Home: what needs the owner across every project, then every project at a glance.
import { html, useState, Icon, cx, href, go, ago, clock, useNow, HOUR, plural, update } from '../lib.js';
import {
  openRequests, projectOf, repoOf, agentOf, teamOf, teamName, machineOf, KIND_LABEL, projectStatus, leadOf, agentStatus, byAttention,
  agentsOfProject, sprintsOf, STAGES,
} from '../data.js';
import * as act from '../actions.js';
import { RequestBlock, Avatar, Menu, Empty, StateWord } from '../ui.js';

const TABS = [['attention', 'Needs attention'], ['projects', 'All projects'], ['questions', 'Questions'], ['approvals', 'Approvals']];

function RequestRow({ s, r, now, open, onToggle }) {
  const a = agentOf(s, r.agent); const p = projectOf(s, r.project); const t = a.team && teamOf(s, a.team);
  const isOpen = r.status === 'open'; const waited = now - r.createdAt;
  return html`<li class=${cx('rq', open && 'open', r.kind === 'failed' && isOpen && 'failed', !isOpen && 'closed')}>
    <button type="button" class="rq-row" aria-expanded=${open} onClick=${onToggle}>
      <${Icon} name="chevron-right" size=${14} class="chev" />
      <span class=${cx('kind', isOpen ? r.kind : 'closed')}>${KIND_LABEL[r.kind]}</span>
      <span class="rq-title"><b>${r.title}</b>${r.command && html`<span class="mono muted">${r.command}</span>`}${r.blocks && isOpen && html`<span class="tag">blocks ${r.blocks}</span>`}</span>
      <span class="rq-project truncate">${p.name}</span>
      <span class="rq-agent"><${Avatar} agent=${a} s=${s} size="sm" status=${false} /><span class="truncate">${a.name}${t ? html`<span class="faint"> · ${t.area || t.stage}</span>` : ''}</span></span>
      <span class="rq-machine muted truncate">${machineOf(s, p.machine).name}</span>
      <span class=${cx('rq-age num', isOpen && waited >= HOUR && 'long')}>${isOpen ? ago(r.createdAt, now) : html`${r.answer} · ${clock(r.answeredAt)}`}</span>
    </button>
    ${open && html`<div class="rq-detail"><${RequestBlock} s=${s} request=${r} onHome=${true} /></div>`}
  </li>`;
}

function RequestList({ s, kind, tab }) {
  const now = useNow(); const [openId, setOpenId] = useState(null);
  const [q, setQ] = useState(''); const [sort, setSort] = useState('oldest'); const [f, setF] = useState({});
  const [showAnswered, setShowAnswered] = useState(false);
  const match = (r) => {
    const a = agentOf(s, r.agent); const p = projectOf(s, r.project);
    if (kind && r.kind !== kind) return false;
    if (f.repo && p.repo !== f.repo) return false;
    if (f.project && r.project !== f.project) return false;
    if (f.machine && p.machine !== f.machine) return false;
    if (q && !(`${r.title} ${r.command || ''} ${p.name} ${a.name} ${KIND_LABEL[r.kind]}`.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  };
  let open = openRequests(s).filter(match);
  if (sort === 'newest') open = [...open].sort((a, b) => (a.kind === 'failed' ? 0 : 1) - (b.kind === 'failed' ? 0 : 1) || b.createdAt - a.createdAt);
  const answered = s.requests.filter((r) => r.status === 'answered' && match(r)).sort((a, b) => b.answeredAt - a.answeredAt);
  const chips = [f.repo && ['repo', 'Repository', f.repo], f.project && ['project', 'Project', projectOf(s, f.project).name], f.machine && ['machine', 'Machine', machineOf(s, f.machine).name]].filter(Boolean);
  const filterItems = [
    { heading: 'Repository' }, ...s.repos.map((r) => ({ label: r.name, checked: f.repo === r.id, onSelect: () => setF({ ...f, repo: f.repo === r.id ? null : r.id }) })),
    { heading: 'Project' }, ...s.projects.filter((p) => !p.archived).map((p) => ({ label: p.name, checked: f.project === p.id, onSelect: () => setF({ ...f, project: f.project === p.id ? null : p.id }) })),
    { heading: 'Machine' }, ...s.machines.map((m) => ({ label: m.name, checked: f.machine === m.id, onSelect: () => setF({ ...f, machine: f.machine === m.id ? null : m.id }) })),
  ];
  const all = openRequests(s); const longest = all.length ? [...all].sort((a, b) => a.createdAt - b.createdAt)[0] : null;
  const working = s.agents.filter((a) => a.state === 'working').length;
  return html`
    <div class="toolbar">
      <div class="search"><${Icon} name="search" size=${14} /><input class="input" placeholder="Search requests, projects or agents" aria-label="Search requests" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
      <${Menu} class="btn" label="Filter" width=${240} trigger=${html`<${Icon} name="filter" size=${14} /><span>Filter</span>${chips.length > 0 && html`<span class="count">${chips.length}</span>`}`} items=${filterItems} />
      ${chips.map(([k, name, v]) => html`<span class="chip" key=${k}>${name}: <b>${v}</b><button type="button" aria-label=${'Remove filter ' + name} onClick=${() => setF({ ...f, [k]: null })}><${Icon} name="x" size=${11} /></button></span>`)}
      ${(chips.length > 0 || q) && html`<button type="button" class="btn ghost sm" onClick=${() => { setF({}); setQ(''); }}>Clear filters</button>`}
      <span class="grow"></span>
      <div class="seg" role="group" aria-label="Sort">
        <button type="button" aria-pressed=${sort === 'oldest'} onClick=${() => setSort('oldest')}>Longest wait</button>
        <button type="button" aria-pressed=${sort === 'newest'} onClick=${() => setSort('newest')}>Newest</button>
      </div>
    </div>
    <div class="view-body">
      ${tab === 'attention' && html`<p class="home-lead">${all.length
        ? html`<b>${plural(all.length, 'request')}</b> ${all.length === 1 ? 'needs' : 'need'} you. The longest has waited <b class=${now - longest.createdAt >= HOUR ? 'warn-text' : ''}>${ago(longest.createdAt, now)}</b>. ${plural(working, 'agent')} ${working === 1 ? 'is' : 'are'} working meanwhile.`
        : html`<b>Nothing needs you.</b> ${plural(working, 'agent')} ${working === 1 ? 'is' : 'are'} working.`}</p>`}
      ${open.length > 0 && html`<ul class="rq-list" data-main>${open.map((r) => html`<${RequestRow} key=${r.id} s=${s} r=${r} now=${now} open=${openId === r.id} onToggle=${() => setOpenId(openId === r.id ? null : r.id)} />`)}</ul>`}
      ${open.length === 0 && html`<${Empty} title=${q || chips.length ? 'No request matches' : kind ? `No open ${kind === 'question' ? 'questions' : 'approvals'}` : 'Your queue is empty'} icon="inbox">
        ${q || chips.length ? 'Clear the filters to see every request.' : 'When an agent asks a question, needs a permission, fails to start, or has a merge ready, it shows here and on the bell.'}<//>`}
      ${tab !== 'attention' && answered.length > 0 && html`<div class="answered">
        <button type="button" class="disclosure-btn" aria-expanded=${showAnswered} onClick=${() => setShowAnswered(!showAnswered)}><${Icon} name="chevron-right" size=${14} /><span>Answered</span><span class="count">${answered.length}</span></button>
        ${showAnswered && html`<ul class="rq-list">${answered.map((r) => html`<${RequestRow} key=${r.id} s=${s} r=${r} now=${now} open=${openId === r.id} onToggle=${() => setOpenId(openId === r.id ? null : r.id)} />`)}</ul>`}
      </div>`}
      ${tab === 'attention' && html`<${Running} s=${s} />`}
    </div>`;
}

// Under the queue: every running project in one line each, so Home is never an empty page.
function Running({ s }) {
  const ps = s.projects.filter((p) => !p.archived);
  return html`<section class="running" aria-label="Projects">
    <div class="section-head" style="padding:0 var(--space-4)"><h2>Projects</h2><span class="grow"></span><a class="link" href=${href('/home/projects')}>All projects</a></div>
    <${ProjectTable} s=${s} projects=${ps} />
  </section>`;
}
export function StageDots({ stage }) {
  const i = STAGES.indexOf(stage);
  return html`<span class="stage-dots" title=${'Stage: ' + stage}>${STAGES.map((x, n) => html`<i key=${x} class=${cx(n < i && 'done', n === i && 'now')}></i>`)}<span>${stage}</span></span>`;
}
export function ProjectTable({ s, projects, showRepo = true }) {
  return html`<table class="table">
    <thead><tr><th>Project</th>${showRepo && html`<th>Repository</th>`}<th>Stage</th><th>Status</th><th>Project lead</th><th>Agents</th><th>Machine</th><th>Branch</th><th></th></tr></thead>
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
    })}</tbody></table>`;
}
function AllProjects({ s }) {
  const [q, setQ] = useState(''); const [status, setStatus] = useState('all');
  let ps = [...s.projects].sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0));
  ps = ps.filter((p) => (!q || `${p.name} ${repoOf(s, p).name} ${p.branch}`.toLowerCase().includes(q.toLowerCase()))
    && (status === 'all' || (status === 'needs' && projectStatus(s, p).tone === 'warn') || (status === 'archived' && p.archived)));
  return html`
    <div class="toolbar">
      <div class="search"><${Icon} name="search" size=${14} /><input class="input" placeholder="Search projects" aria-label="Search projects" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
      <div class="seg" role="group" aria-label="Status">
        ${[['all', 'All'], ['needs', 'Needs you'], ['archived', 'Archived']].map(([k, l]) => html`<button type="button" key=${k} aria-pressed=${status === k} onClick=${() => setStatus(k)}>${l}</button>`)}
      </div>
    </div>
    <div class="view-body" data-main>${ps.length ? html`<${ProjectTable} s=${s} projects=${ps} />` : html`<${Empty} title="No project matches" icon="search">Clear the search to see every project.<//>`}</div>`;
}

export function Home({ s, route }) {
  const tab = TABS.some(([k]) => k === route.parts[1]) ? route.parts[1] : 'attention';
  const counts = { attention: openRequests(s).length, projects: s.projects.filter((p) => !p.archived).length, questions: openRequests(s, { kind: 'question' }).length, approvals: openRequests(s, { kind: 'approval' }).length };
  return html`<div class="view">
    <div class="tabrow" role="tablist" aria-label="Home views">
      ${TABS.map(([k, l]) => html`<a key=${k} class="tab" role="tab" aria-selected=${tab === k} href=${href('/home/' + k)}><span>${l}</span>
        <span class=${cx('count', k !== 'projects' && counts[k] > 0 && 'warn')}>${counts[k]}</span></a>`)}
      <div class="tab-end"><button type="button" class="btn sm primary" onClick=${() => act.openDialog({ type: 'new-project' })}><${Icon} name="plus" size=${14} />New project</button></div>
    </div>
    ${tab === 'projects' ? html`<${AllProjects} s=${s} />` : html`<${RequestList} key=${tab} s=${s} tab=${tab} kind=${tab === 'questions' ? 'question' : tab === 'approvals' ? 'approval' : null} />`}
  </div>`;
}
