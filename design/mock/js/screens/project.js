// The project board, sprint and task pages, the team page, and the repository page.
import { html, useState, Icon, cx, href, go, ago, clock, dayLabel, useNow, plural, update, uid } from '../lib.js';
import {
  STAGES, PHASES, COLUMNS, TASK_STATES, sprintsOf, tasksOfSprint, tasksOfTeam, teamOf, teamName, teamsOf, agentOf, agentsOfTeam, agentsOfProject,
  requestsOfSprint, requestsOfTask, openRequests, sprintProgress, agentStatus, byId, repoOf, machineOf, leadOf, routeForAgent, agentLabel, HARNESSES, subLabel,
} from '../data.js';
import * as act from '../actions.js';
import { Avatar, RequestBlock, Empty, StateWord, AgentLine } from '../ui.js';
import { ProjectTable } from './home.js';

// ---- stage strip ----------------------------------------------------------------
export function StageStrip({ s, project }) {
  const i = STAGES.indexOf(project.stage); const phase = PHASES.find((p) => p.id === project.phase);
  const stages = project.hasMocks || project.stage === 'Design' ? STAGES : STAGES.slice(1);
  return html`<div class="stage-strip">
    <ol class="stages" aria-label="Project stage">
      ${stages.map((st) => { const n = STAGES.indexOf(st); return html`<li key=${st} class=${cx(n < i && 'done', n === i && 'now')} aria-current=${n === i ? 'step' : null}>
        <span class="mark">${n < i ? html`<${Icon} name="check" size=${11} />` : n === i ? html`<i></i>` : null}</span><span>${st}</span></li>`; })}
    </ol>
    <a class="phase-link" href=${href(`/p/${project.id}/workflow`)}>Phase ${phase.n} of 8 · <b>${phase.name}</b><${Icon} name="arrow-right" size=${12} /></a>
  </div>`;
}

// ---- board ----------------------------------------------------------------------
function SprintCard({ s, sp }) {
  const pr = sprintProgress(s, sp); const reqs = requestsOfSprint(s, sp.id);
  const t = sp.team && teamOf(s, sp.team);
  const ags = t ? agentsOfTeam(s, t.id) : [];
  const live = ags.find((a) => a.state === 'working' && a.task && tasksOfSprint(s, sp.id).some((x) => x.label === a.task)) || ags.find((a) => a.state === 'working');
  const failed = reqs.some((r) => r.kind === 'failed');
  return html`<a class=${cx('sprint-card', reqs.length && (failed ? 'error' : 'warn'), sp.column === 'Done' && 'done')} href=${href(`/p/${sp.project}/sprint/${sp.id}`)}>
    ${reqs.length > 0 && html`<div class=${cx('need', failed && 'error')}><${Icon} name=${failed ? 'circle-alert' : 'bell'} size=${13} />${reqs.length === 1 ? { question: 'Needs your answer', approval: 'Needs your approval', merge: 'Needs your merge', failed: 'An agent failed to start' }[reqs[0].kind] : `${reqs.length} requests need you`}</div>`}
    <div class="row" style="gap:6px"><span class="tag">${sp.label}</span><span class="faint" style="font-size:var(--text-xs)">${sp.phase}</span>
      ${sp.fix && html`<span class="badge info" title="A fix sprint that users would not notice merges on its own after a passing full run.">Fix sprint</span>`}</div>
    <h3>${sp.name}</h3>
    <p class="goal">${sp.goal}</p>
    ${pr.total > 0 && html`<div class="row" style="gap:8px">
      <div class="progress grow">${Array.from({ length: pr.total }, (_, n) => html`<i key=${n} class=${cx(n >= pr.done && n < pr.done + pr.active && 'active')} style=${{ flex: 1, background: n >= pr.done + pr.active ? 'transparent' : null }}></i>`)}</div>
      <span class="faint num" style="font-size:var(--text-xs)">${pr.done} of ${pr.total}</span></div>`}
    ${pr.total === 0 && html`<span class="faint" style="font-size:var(--text-xs)">No tasks yet. The plan comes first.</span>`}
    <div class="row foot">
      ${t ? html`<span class="avatar-stack">${ags.slice(0, 4).map((a) => html`<${Avatar} key=${a.id} agent=${a} s=${s} size="sm" status=${false} />`)}</span><span class="muted truncate">${teamName(t)}</span>`
        : html`<span class="faint">No team yet</span>`}
    </div>
    ${sp.column === 'Done' && sp.evidence && html`<div class="evidence-line"><${Icon} name="circle-check" size=${13} /><span class="truncate">${sp.evidence.tests} · ${sp.evidence.merged || sp.evidence.review}</span></div>`}
    ${live && sp.column !== 'Done' && html`<div class="live-line"><i class="dot working pulse"></i><span class="truncate"><b>${live.name}</b> ${live.activity}</span></div>`}
  </a>`;
}
export function Board({ s, project }) {
  const sprints = sprintsOf(s, project.id); const ags = agentsOfProject(s, project.id);
  const open = openRequests(s, { project: project.id });
  const [col, setCol] = useState(null);
  if (project.archived) return html`<div class="page"><${Empty} title="This project is archived" icon="archive">Its agents are stopped. <button type="button" class="btn sm" onClick=${() => act.archiveProject(project.id, false)}>Restore</button><//></div>`;
  return html`<div class="board-page">
    <div class="board-head">
      <${StageStrip} s=${s} project=${project} />
      <p class="goal-line"><span class="faint">Goal</span> ${project.goal || html`<span class="muted">No goal yet. Tell the project lead what you want to change.</span>`}</p>
    </div>
    ${html`
    <div class="col-jump only-phone-flex" role="tablist" aria-label="Board columns">${COLUMNS.map((c) => html`<button type="button" key=${c} class="tab" aria-selected=${(col || 'In progress') === c} onClick=${() => { setCol(c); document.getElementById('col-' + c.replace(' ', '-'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>${c}<span class="count">${sprints.filter((x) => x.column === c).length}</span></button>`)}</div>
    <div class="board" data-main>
      ${COLUMNS.map((c) => { const list = sprints.filter((x) => x.column === c).sort((a, b) => (b.fix ? 1 : 0) - (a.fix ? 1 : 0) || requestsOfSprint(s, b.id).length - requestsOfSprint(s, a.id).length);
        return html`<section class="board-col" key=${c} id=${'col-' + c.replace(' ', '-')} aria-label=${c}>
          <header><h2>${c}</h2><span class="count">${list.length}</span></header>
          <div class="cards">${list.map((sp) => html`<${SprintCard} key=${sp.id} s=${s} sp=${sp} />`)}
            ${list.length === 0 && html`<p class="faint col-empty">${c === 'Done' ? 'Nothing merged yet.' : c === 'Review' ? 'Nothing in review.' : 'Empty.'}</p>`}</div>
        </section>`; })}
    </div>`}
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
export function SprintPage({ s, project, sprintId }) {
  const sp = byId(s.sprints, sprintId); const [adding, setAdding] = useState(false); const [title, setTitle] = useState('');
  if (!sp) return html`<div class="page"><${Empty} title="This sprint does not exist">It may have been removed. <a class="link" href=${href(`/p/${project.id}/board`)}>Back to the board</a><//></div>`;
  const tasks = tasksOfSprint(s, sp.id); const reqs = requestsOfSprint(s, sp.id); const t = sp.team && teamOf(s, sp.team); const pr = sprintProgress(s, sp);
  const done = sp.column === 'Done';
  const add = (e) => { e.preventDefault(); if (!title.trim()) return;
    update((st) => { const n = Math.max(...st.tasks.filter((x) => x.project === project.id).map((x) => +x.label.split('-')[1] || 0)) + 1;
      st.tasks.push({ id: uid('t'), project: project.id, label: `${project.prefix}-${n}`, title: title.trim(), sprint: sp.id, team: sp.team, owner: null, state: 'queue', points: 2, files: [], history: [{ ts: Date.now(), who: 'owner', text: 'You added this task. The project lead was told.' }] }); });
    act.toast('Task added. The project lead was told.'); setTitle(''); setAdding(false); };
  return html`<div class="page narrow">
    <a class="back" href=${href(`/p/${project.id}/board`)}><${Icon} name="arrow-left" size=${14} />Board</a>
    <div class="page-head" style="margin-top:6px"><h1 class="page-title">${sp.name}</h1></div>
    <p class="status-line"><span class="tag">${sp.label}</span><span>${sp.phase}</span><span>${sp.column}</span>${sp.fix && html`<span class="badge info">Fix sprint · merges on its own</span>`}
      ${reqs.length > 0 && html`<span class="warn-text" style="font-weight:var(--weight-medium)">${plural(reqs.length, 'request')} ${reqs.length === 1 ? 'needs' : 'need'} you</span>`}</p>
    ${reqs.length > 0 && html`<div class="stack">${reqs.map((r) => html`<${RequestBlock} key=${r.id} s=${s} request=${r} openThread=${() => act.openSidePanel(r.agent, r.id)} />`)}</div>`}
    <p class="lede">${sp.goal}</p>
    <dl class="dl facts">
      <dt>Team</dt><dd>${t ? html`<a class="link" href=${href(`/p/${project.id}/team/${t.id}`)}>${teamName(t)}</a>` : html`<span class="muted">Not staffed yet</span>`}</dd>
      <dt>Depends on</dt><dd>${sp.dependsOn.length ? sp.dependsOn.map((id, n) => { const d = byId(s.sprints, id); return html`${n > 0 && ', '}<a class="link" href=${href(`/p/${project.id}/sprint/${id}`)}>${d.label} ${d.name}</a>${d.column === 'Done' ? html` <span class="muted">(done)</span>` : ''}`; }) : html`<span class="muted">Nothing</span>`}</dd>
      <dt>Progress</dt><dd>${pr.total ? `${pr.done} of ${pr.total} tasks done` : 'No tasks yet'}</dd>
      ${sp.evidence && html`<dt>Evidence</dt><dd class="col" style="gap:2px">${Object.values(sp.evidence).map((e) => html`<span class="row"><${Icon} name="circle-check" size=${14} class="success-text" />${e}</span>`)}</dd>`}
    </dl>
    <div class="section-head" style="margin-top:var(--gap-group)"><h2>Tasks</h2><span class="grow"></span>
      ${done ? html`<span class="faint" style="font-size:var(--text-sm)">A finished sprint takes no new tasks.</span>` : html`<button type="button" class="btn sm" onClick=${() => setAdding(!adding)}><${Icon} name="plus" size=${13} />Add task</button>`}</div>
    ${adding && html`<form class="row" style="margin-bottom:8px" onSubmit=${add}><input class="input" autofocus placeholder="What should be done?" value=${title} onInput=${(e) => setTitle(e.target.value)} aria-label="Task title" />
      <button type="submit" class="btn primary" disabled=${!title.trim()}>Add</button><button type="button" class="btn ghost" onClick=${() => setAdding(false)}>Cancel</button></form>`}
    <div class="table-wrap" data-main><${TaskTable} s=${s} tasks=${tasks} /></div>
  </div>`;
}

// ---- task page ------------------------------------------------------------------
export function TaskPage({ s, project, taskId }) {
  const t = byId(s.tasks, taskId); const now = useNow();
  if (!t) return html`<div class="page"><${Empty} title="This task does not exist">It may have been removed. <a class="link" href=${href(`/p/${project.id}/board`)}>Back to the board</a><//></div>`;
  const sp = byId(s.sprints, t.sprint); const o = t.owner && agentOf(s, t.owner); const team = t.team && teamOf(s, t.team); const reqs = requestsOfTask(s, t.id);
  return html`<div class="page narrow">
    <a class="back" href=${href(`/p/${project.id}/sprint/${sp.id}`)}><${Icon} name="arrow-left" size=${14} />${sp.label} ${sp.name}</a>
    <div class="page-head" style="margin-top:6px"><h1 class="page-title grow">${t.title}</h1>
      ${o && html`<a class=${cx('btn', !reqs.length && 'primary')} href=${href(routeForAgent(s, o))}><${Icon} name="message-square" size=${14} />Talk to ${o.name}</a>`}</div>
    <p class="status-line"><span class="tag">${t.label}</span><${TaskState} t=${t} /><span>${t.points} points</span></p>
    ${reqs.length > 0 && html`<div class="stack">${reqs.map((r) => html`<${RequestBlock} key=${r.id} s=${s} request=${r} openThread=${() => act.openSidePanel(r.agent, r.id)} />`)}</div>`}
    <dl class="dl facts">
      <dt>Owner</dt><dd>${o ? html`<${AgentLine} s=${s} agent=${o} />` : html`<span class="muted">Unassigned. The team lead assigns it in dependency order.</span>`}</dd>
      <dt>Team</dt><dd>${team ? html`<a class="link" href=${href(`/p/${project.id}/team/${team.id}`)}>${teamName(team)}</a>` : html`<span class="muted">None</span>`}</dd>
      <dt>Worktree</dt><dd class="mono truncate-start" title=${team ? team.branch : project.branch}>${team ? team.branch : project.branch}</dd>
      ${o && o.activity && html`<dt>Doing now</dt><dd>${o.activity}</dd>`}
    </dl>
    <div class="section-head" style="margin-top:var(--gap-group)"><h2>Changed files</h2><span class="grow"></span>${t.files.length > 0 && html`<a class="link" href=${href(`/p/${project.id}/git`)}>Open in Git</a>`}</div>
    ${t.files.length ? html`<ul class="file-list">${t.files.map((f) => html`<li key=${f}><${Icon} name="file-code" size=${14} class="faint" /><span class="mono truncate-start">${f}</span></li>`)}</ul>` : html`<p class="muted">No files changed yet.</p>`}
    <div class="section-head" style="margin-top:var(--gap-group)"><h2>Work and handoff</h2></div>
    ${t.history.length ? html`<ol class="timeline">${t.history.map((h, i) => { const w = h.who === 'owner' ? null : agentOf(s, h.who);
      return html`<li key=${i}><time>${dayLabel(h.ts, now) === 'Today' ? clock(h.ts) : dayLabel(h.ts, now) + ' ' + clock(h.ts)}</time><span><b>${w ? w.name : 'You'}</b> ${h.text}</span></li>`; })}</ol>`
      : html`<p class="muted">Nothing has happened on this task yet.</p>`}
  </div>`;
}

// ---- team page ------------------------------------------------------------------
export function TeamPage({ s, project, teamId }) {
  const t = teamOf(s, teamId);
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
          <td class="muted">${HARNESSES[a.harness].name} · ${a.model} · ${a.effort}</td><td class=${cx('num', a.context >= 70 ? 'warn-text' : 'muted')}>${a.context}%</td></tr>`; })}</tbody></table></div>
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
          <dt>Remote</dt><dd class="mono">${r.remote || html`<span class="muted" style="font-family:var(--font-body)">None</span>`}</dd>
          <dt>Base branch</dt><dd class="mono">${r.main}</dd>
          <dt>Folders</dt><dd class="row" style="flex-wrap:wrap;gap:4px 14px">${Object.entries(r.folders).map(([m, f]) => html`<span key=${m}>${machineOf(s, m).name} <span class="mono muted">${f}</span></span>`)}</dd>
        </dl>
        <section class="repo-desc" aria-label="Product description">
          <h2>Product</h2>
          ${r.description ? html`<p>${r.description}</p>${r.describedAt && html`<small class="faint">Updated ${ago(r.describedAt)} ago by the project lead of ${(s.projects.find((p) => p.lead === r.describedBy) || {}).name}</small>`}`
            : html`<p class="muted">Written by the first project lead.</p>`}
        </section>
      </div>
      <div data-main><${ProjectTable} s=${s} projects=${ps} showRepo=${false} /></div>
    </div>
  </div>`;
}
