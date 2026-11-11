// Dialogs that belong to no single screen: the quick switcher, New project,
// the merge review, and provider sign-in.
import { html, useState, useEffect, useRef, Icon, cx, go, update, useKey } from './lib.js';
import {
  projectOf, repoOf, agentOf, teamOf, teamName, machineOf, subOf, byId, HARNESSES, openRequests, agentStatus, projectStatus, routeForAgent,
} from './data.js';
import * as act from './actions.js';
import { Dialog, registerDialog, Avatar } from './ui.js';

// ---- quick switcher ---------------------------------------------------------------
function Switcher({ s }) {
  const [q, setQ] = useState(''); const [i, setI] = useState(0); const list = useRef(null);
  const all = [];
  for (const p of s.projects.filter((x) => !x.archived)) {
    const st = projectStatus(s, p);
    all.push({ kind: 'Project', label: p.name, sub: repoOf(s, p).name, note: st.tone === 'warn' ? st.word : p.stage, tone: st.tone, to: `/p/${p.id}/board`, icon: 'kanban' });
  }
  for (const t of s.teams) { const p = projectOf(s, t.project); if (p.archived) continue; const n = openRequests(s, { team: t.id }).length; all.push({ kind: 'Team', label: teamName(t), sub: p.name, note: n ? `Needs you · ${n}` : '', tone: n ? 'warn' : null, to: `/p/${p.id}/team/${t.id}`, icon: 'users' }); }
  for (const a of s.agents) { const p = projectOf(s, a.project); if (p.archived) continue; const st = agentStatus(s, a); const t = a.team && teamOf(s, a.team); all.push({ kind: 'Agent', label: a.name, sub: `${p.name}${t ? ' · ' + teamName(t) : ''}`, note: st.word, tone: st.tone, to: routeForAgent(s, a), agent: a }); }
  for (const r of s.repos) all.push({ kind: 'Repository', label: r.name, sub: r.remote || 'No remote', to: '/r/' + r.id, icon: 'folder-git-2', mono: true });
  for (const [to, label, icon] of [['/home', 'Home', 'house'], ['/machines', 'Machines', 'server'], ['/subscriptions', 'Subscriptions', 'key-round'], ['/notifications', 'Phone notifications', 'smartphone'], ['/settings', 'Service settings', 'settings']]) all.push({ kind: 'Page', label, sub: '', to, icon });
  const ql = q.trim().toLowerCase();
  const score = (x) => { const l = x.label.toLowerCase(); return l.startsWith(ql) ? 0 : l.includes(ql) ? 1 : (x.sub || '').toLowerCase().includes(ql) ? 2 : 9; };
  const found = ql ? all.map((x) => [score(x), x]).filter(([n]) => n < 9).sort((a, b) => a[0] - b[0] || (b[1].tone === 'warn') - (a[1].tone === 'warn')).map(([, x]) => x) : all.filter((x) => x.tone === 'warn' || x.kind === 'Project');
  const shown = found.slice(0, 12);
  useEffect(() => setI(0), [q]);
  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [i]);
  const pick = (x) => { act.closeDialog(); go(x.to); };
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI((n) => Math.min(shown.length - 1, n + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI((n) => Math.max(0, n - 1)); }
    else if (e.key === 'Enter' && shown[i]) { e.preventDefault(); pick(shown[i]); }
    else if (e.key === 'Escape') act.closeDialog();
  };
  return html`<div class="scrim" style="place-items:start center;padding-top:12vh" onPointerDown=${(e) => { if (e.target === e.currentTarget) act.closeDialog(); }}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Find project or agent" style="width:min(620px,100%)">
      <div class="search" style="padding:10px 12px;border-bottom:1px solid var(--color-line)">
        <${Icon} name="search" size=${16} class="faint" />
        <input autofocus class="input lg" style="border:0;box-shadow:none;padding-left:34px;font-size:var(--text-lg)" placeholder="Find a project, team, agent or page" aria-label="Find project or agent" value=${q} onInput=${(e) => setQ(e.target.value)} onKeyDown=${key} ref=${(el) => el && setTimeout(() => el.focus(), 0)} />
        <kbd>Esc</kbd>
      </div>
      <div ref=${list} style="overflow:auto;padding:4px;max-height:min(52vh,460px)" role="listbox">
        ${!ql && html`<div class="menu-label">Projects, and what needs you</div>`}
        ${shown.length === 0 && html`<div class="empty" data-empty><strong>Nothing matches "${q}"</strong><span>Try a project name, a team such as "Build", or a role such as "Reviewer".</span></div>`}
        ${shown.map((x, n) => html`<button type="button" key=${x.kind + x.to} role="option" aria-selected=${n === i} data-active=${n === i} class="menu-item" style="min-height:34px" onMouseEnter=${() => setI(n)} onClick=${() => pick(x)}>
          ${x.agent ? html`<${Avatar} agent=${x.agent} s=${s} size="sm" />` : html`<${Icon} name=${x.icon} size=${15} class="faint" />`}
          <span class=${cx(x.mono && 'mono')} style="font-weight:var(--weight-medium)">${x.label}</span>
          <span class="muted truncate grow">${x.sub}</span>
          ${x.note && html`<span class=${cx(x.tone === 'warn' && 'warn-text', x.tone === 'error' && 'error-text', !x.tone && 'faint')} style="font-size:var(--text-sm)">${x.note}</span>`}
          <span class="faint" style="font-size:var(--text-xs);width:64px;text-align:right">${x.kind}</span>
        </button>`)}
      </div>
      <div class="dialog-foot" style="justify-content:flex-start;color:var(--color-muted);font-size:var(--text-sm);padding-block:8px">
        <span class="row"><kbd>↑</kbd><kbd>↓</kbd> move</span><span class="row"><kbd>Enter</kbd> open</span>
      </div>
    </div>
  </div>`;
}
registerDialog('switcher', Switcher);

// ---- new project ------------------------------------------------------------------
// A project starts from a goal, which is the first message to its project lead. The lead
// names the project in its first turn, so the owner never has to invent a name.
export function SubscriptionTable({ s, machine, value, onPick, name = 'lead-sub' }) {
  const rows = s.subscriptions.filter((x) => x.enabled);
  return html`<div class="table-wrap"><table class="table sub-table">
    <thead><tr><th></th><th>Harness</th><th>Subscription</th><th>Machine</th><th>Models</th></tr></thead>
    <tbody>${rows.map((x) => { const ok = x.signedIn && (!machine || x.machine === machine); const h = HARNESSES[x.harness];
      return html`<tr key=${x.id} class=${cx(ok && 'click', !ok && 'off')} aria-selected=${value === x.id} onClick=${() => ok && onPick(x.id)}>
        <td style="width:28px"><input type="radio" name=${name} aria-label=${`${h.name} · ${x.name}`} checked=${value === x.id} disabled=${!ok} onChange=${() => onPick(x.id)} /></td>
        <td>${h.name}</td>
        <td>${x.name}${!x.signedIn ? html` <span class="faint">· signed out</span>` : x.usage ? html` <span class="faint num">· ${x.usage.pct}% used</span>` : ''}</td>
        <td class="muted">${machineOf(s, x.machine).name}</td>
        <td class="muted wrap">${h.models.join(', ')}</td></tr>`; })}</tbody></table></div>`;
}
function NewProject({ s, d }) {
  const [machine, setMachine] = useState(d.machine || 'studio');
  const [repo, setRepo] = useState(d.repo || s.repos[0].id);
  const [newRepo, setNewRepo] = useState('');
  const [goal, setGoal] = useState(d.goal || '');
  const ready = s.subscriptions.filter((x) => x.signedIn && x.enabled && x.machine === machine);
  const [sub, setSub] = useState(ready[0]?.id);
  useEffect(() => { if (!ready.some((x) => x.id === sub)) setSub(ready[0]?.id); }, [machine]);
  const m = machineOf(s, machine); const r = byId(s.repos, repo);
  const isNew = repo === '__new';
  const hasRepo = isNew || !!r?.folders[machine];
  const why = m.status !== 'online' ? `${m.name} is offline.` : !hasRepo ? null : !goal.trim() ? 'Write the goal.' : isNew && !newRepo.trim() ? 'Name the new repository.' : !sub ? `No subscription is signed in on ${m.name}.` : null;
  const create = () => { if (why || !hasRepo) return; act.closeDialog(); act.createProject({ repo, goal: goal.trim(), machine, subscription: sub, newRepo: isNew ? newRepo.trim() : null }); };
  return html`<${Dialog} title="New project" size="wide" onClose=${act.closeDialog} onSubmit=${create}
    foot=${html`${why && html`<span class="why">${why}</span>`}<button type="button" class="btn" onClick=${act.closeDialog}>Cancel</button><button type="submit" class="btn primary" disabled=${!!why || !hasRepo}>Create project</button>`}>
    <div class="field"><label for="np-goal">Goal</label>
      <textarea id="np-goal" class="textarea" rows="3" value=${goal} onInput=${(e) => setGoal(e.target.value)} placeholder="Make a mock for the LGcode phone app" autofocus
        onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); create(); } }}></textarea></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
      <div class="field"><label for="np-machine">Run on</label>
        <select id="np-machine" class="select" value=${machine} onChange=${(e) => setMachine(e.target.value)}>
          ${s.machines.map((x) => html`<option value=${x.id} disabled=${x.status !== 'online'}>${x.name}${x.status !== 'online' ? ' (offline)' : x.here ? ' (this computer)' : ''}</option>`)}</select></div>
      <div class="field"><label for="np-repo">Repository</label>
        <select id="np-repo" class="select" value=${repo} onChange=${(e) => setRepo(e.target.value)}>
          ${s.repos.map((x) => html`<option value=${x.id}>${x.name}${x.folders[machine] ? '' : ` (not on ${m.name})`}</option>`)}
          <option value="__new">New repository…</option></select></div>
    </div>
    ${isNew && html`<div class="field"><label for="np-newrepo">New repository name</label><input id="np-newrepo" class="input" value=${newRepo} onInput=${(e) => setNewRepo(e.target.value)} placeholder="notes-site" /></div>`}
    ${!hasRepo && html`<div class="callout warn"><${Icon} name="triangle-alert" size=${15} /><span class="grow">${r.name} is not on ${m.name}.</span>
      <button type="button" class="btn sm" onClick=${() => { act.openDialog({ type: 'add-repository', machine, repo, back: { type: 'new-project', machine, repo, goal } }); }}>Add to ${m.name}</button></div>`}
    <div class="field"><span class="label">Project lead</span>
      <${SubscriptionTable} s=${s} machine=${machine} value=${sub} onPick=${setSub} /></div>
  <//>`;
}
registerDialog('new-project', NewProject);

// ---- merge review -----------------------------------------------------------------
function MergeReview({ s, d }) {
  const r = byId(s.requests, d.requestId); if (!r) return null;
  const ev = r.evidence; const ok = ev.tests.ok && ev.review.ok;
  const docs = [['docs/reference/index.md', 212, 0], ['docs/reference/invoices.md', 148, 0], ['docs/reference/customers.md', 131, 0], ['scripts/build-reference.ts', 96, 12], ['docs/api/invoices.md', 0, 304], ['docs/api/customers.md', 0, 271], ['redirects.json', 37, 0]];
  const wt = (s.worktrees || []).find((w) => w.project === r.project && w.branch === r.source);
  const seen = new Map();
  for (const c of wt?.commits || []) for (const f of c.files || []) { const k = f.path || f[0]; const o = seen.get(k) || [k, 0, 0]; o[1] += f.add ?? f[2]?.add ?? 0; o[2] += f.del ?? f[2]?.del ?? 0; seen.set(k, o); }
  const files = r.project === 'apiref' || !seen.size ? (r.project === 'apiref' ? docs : []) : [...seen.values()].slice(0, 8);
  const merge = () => { act.closeDialog(); act.answerRequest(r.id, 'merge'); };
  return html`<${Dialog} title=${r.title} size="wide" onClose=${act.closeDialog}
    foot=${html`<span class="why">Only you can merge into ${r.target}.</span><button type="button" class="btn" onClick=${act.closeDialog}>Cancel</button>
      <button type="button" class=${cx('btn', ok && 'primary')} onClick=${merge}>${ok ? 'Approve and merge' : 'Approve without evidence'}</button>`}>
    <p style="line-height:1.55;max-width:var(--measure)">${r.body}</p>
    <div class="req closed" style="border-left-color:var(--color-success)"><div class="evidence">
      <div class=${cx('ev', !ev.tests.ok && 'missing')}><${Icon} name=${ev.tests.ok ? 'circle-check' : 'triangle-alert'} size=${14} /><span>${ev.tests.text}</span></div>
      <div class=${cx('ev', !ev.review.ok && 'missing')}><${Icon} name=${ev.review.ok ? 'circle-check' : 'triangle-alert'} size=${14} /><span>${ev.review.text}</span></div>
      <div class="ev"><${Icon} name="git-commit-horizontal" size=${14} class="muted" /><span class="mono">${r.source}</span><${Icon} name="arrow-right" size=${12} class="muted" /><span class="mono">${r.target}</span><span class="muted">${ev.commits} commits</span></div>
    </div></div>
    <div><div class="section-head"><h3>${ev.files} files changed</h3><span class="grow"></span><a class="link" href="#/p/${r.project}/git" onClick=${act.closeDialog}>Open every diff in Git</a></div>
      <table class="table"><tbody>${files.map(([f, add, del]) => html`<tr><td class="mono truncate">${f}</td><td class="num success-text">+${add}</td><td class="num error-text">−${del}</td></tr>`)}
        ${ev.files > files.length && html`<tr><td class="muted">${files.length ? 'and ' : ''}${ev.files - files.length}${files.length ? ' more' : ' files'}</td><td></td><td></td></tr>`}</tbody></table></div>
  <//>`;
}
registerDialog('merge-review', MergeReview);

// ---- provider sign-in: the harness's own login, in a terminal on the right machine ---
function SignIn({ s, d }) {
  const sub = subOf(s, d.subscription); const m = machineOf(s, sub.machine); const h = HARNESSES[sub.harness];
  const [step, setStep] = useState(0);
  const cmd = sub.harness === 'codex' ? 'codex login' : 'claude /login';
  useEffect(() => { if (step === 1) { const t = setTimeout(() => setStep(2), 1800); return () => clearTimeout(t); } }, [step]);
  const done = () => {
    update((st) => { const x = subOf(st, sub.id); x.signedIn = true; x.usage = x.usage || { pct: 3, resetsAt: Date.now() + 6 * 864e5 }; });
    act.closeDialog(); act.toast(`Signed in to ${h.name} · ${sub.name} on ${m.name}`);
    if (d.then) act.answerRequest(d.then, 'resume');
  };
  return html`<${Dialog} title=${`Sign in to ${h.name} · ${sub.name}`} onClose=${act.closeDialog}
    foot=${html`<span class="why">The sign-in runs on ${m.name}, in the harness's own program.</span><button type="button" class="btn" onClick=${act.closeDialog}>Cancel</button>
      ${step < 2 ? html`<button type="button" class="btn primary" disabled=${step === 1} onClick=${() => setStep(1)}>${step === 1 ? 'Waiting for the browser…' : 'Open the sign-in link'}</button>` : html`<button type="button" class="btn primary" onClick=${done}>Done</button>`}`}>
    <pre class="code" style="background:var(--color-term-bg);color:var(--color-term-text);min-height:150px;white-space:pre-wrap">${`you@${m.name.toLowerCase()} ~ $ ${cmd}\n`}${`Open this link in a browser to sign in:\n  https://auth.example/device?code=`}<span style="color:var(--color-term-amber)">QTRX-7H2M</span>${step >= 1 ? '\n\nWaiting for the browser…' : ''}${step >= 2 ? html`\n<span style="color:var(--color-term-green)">Signed in as owner@example.com.</span>\n${`you@${m.name.toLowerCase()} ~ $ `}` : ''}</pre>
  <//>`;
}
registerDialog('signin', SignIn);
