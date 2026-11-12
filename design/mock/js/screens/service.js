// The service pages: Machines, Subscriptions, Phone notifications and Service settings,
// plus one project's Settings tab and the Add repository dialog.
import { html, useState, useEffect, Icon, cx, update, store, go, href, ago, clock, dayLabel, useNow, uid, plural, MIN, HOUR, DAY } from '../lib.js';
import {
  HARNESSES, PERMISSION_MODES, KIND_LABEL, byId, projectOf, repoOf, agentOf, teamsOf, teamName, agentsOfTeam, agentsOfProject,
  machineOf, subOf, subLabel, agentStatus, routeForAgent, routeForRequest, openRequests, hasEffort, harnessOfModel, WORK_KINDS, proposeAssignment,
} from '../data.js';
import * as act from '../actions.js';
import { Avatar, Menu, Dialog, registerDialog, Empty, StateWord } from '../ui.js';

// ---- seed ----------------------------------------------------------------------
export function seedService(st) {
  const T = st.T;
  const more = {
    studio: { cpu: 46, mem: 62, cores: 16, ram: 64, version: '0.9.0', harnesses: { claude: '2.4.1', codex: '0.61.0' } },
    buildbox: { cpu: 21, mem: 38, cores: 24, ram: 128, version: '0.9.0', harnesses: { claude: '2.4.1', codex: '0.61.0' } },
    laptop: { cpu: 0, mem: 0, cores: 8, ram: 16, version: '0.8.4', harnesses: { claude: '2.3.8', codex: null } },
  };
  for (const m of st.machines) Object.assign(m, more[m.id]);
  byId(st.machines, 'studio').slots.limit = 16;

  const subMore = {
    'sub-max': { account: 'owner@example.com', window: { pct: 34, resetsAt: T + 2 * HOUR + 10 * MIN }, model: 'Opus 5.5' },
    'sub-team': { account: 'owner@acme.example', window: { pct: 78, resetsAt: T + 48 * MIN }, model: 'Sonnet 5.5' },
    'sub-codex': { account: 'owner@example.com', window: { pct: 12, resetsAt: T + 3 * HOUR + 30 * MIN }, model: 'GPT-6.1 Sol' },
    'sub-codex-work': { account: null, window: null, model: 'GPT-6.1 Sol' },
  };
  for (const x of st.subscriptions) Object.assign(x, subMore[x.id]);
  st.subscriptions.splice(2, 0, {
    id: 'sub-pro', harness: 'claude', name: 'Pro', machine: 'studio', enabled: true, signedIn: true, useForNew: false, account: 'owner@example.com',
    usage: { pct: 67, resetsAt: T + 4 * DAY }, weekly: 67, window: { pct: 100, resetsAt: T + 1 * HOUR + 40 * MIN }, model: 'Sonnet 5.5',
  });

  // What the bell has shown, newest first, and whether each one reached the phone.
  const notes = st.requests.map((r) => ({ id: 'n-' + r.id, ts: r.createdAt, kind: r.kind, title: r.title, request: r.id, project: r.project, agent: r.agent, read: r.status !== 'open', delivery: 'off' }));
  notes.push({ id: 'n-sp1', ts: T - 26 * HOUR, kind: 'sprint', title: 'SP-01 Navigation foundation is merged', project: 'console', agent: 'console-lead', to: '/p/console/sprint/sp1', read: true, delivery: 'off' });
  st.notifications = notes.sort((a, b) => b.ts - a.ts);

  Object.assign(st.settings, {
    notifyOn: { question: true, approval: true, merge: true, failed: true, sprint: false },
    quiet: { on: false, from: '22:00', to: '07:00', failed: true },
    defaultHarness: 'claude', defaultModel: 'Sonnet 5.5', defaultEffort: 'Medium', defaultPermission: 'Edit files without asking',
    needToKnow: false, stallAssigned: 5, stallWorker: 10, stallLead: 20, autoNudge: true, replaceAfter: 3, capacityRetries: 12,
    workflowPath: '~/.lgtm', maxRounds: 6, testsDefault: true, reviewDefault: true,
    version: '0.9.0', commit: '55e1bbd', dataFolder: '~/.local/state/lgtm',
  });
}

// ---- small parts ---------------------------------------------------------------
const until = (ts, now) => ago(2 * now - ts, now);
const machineAgents = (s, mid) => s.agents.filter((a) => (projectOf(s, a.project) || {}).machine === mid && !(projectOf(s, a.project) || {}).archived);
const running = (a) => ['working', 'waiting', 'starting'].includes(a.state);
const subAgents = (s, sid) => s.agents.filter((a) => a.subscription === sid && !(projectOf(s, a.project) || {}).archived);

let savedTimer = null;
function markSaved() {
  store.state.ui.saved = Date.now();
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => update((s) => { s.ui.saved = null; }), 1800);
}
const setS = (patch) => { update((s) => { Object.assign(s.settings, patch); }); markSaved(); };
function Saved({ s }) {
  return html`<span class=${cx('svc-saved', s.ui.saved && 'on')} role="status" aria-live="polite">${s.ui.saved && html`<${Icon} name="check" size=${13} />Saved`}</span>`;
}
function Switch({ on, onChange, label, disabled }) {
  return html`<button type="button" class="switch" role="switch" aria-checked=${!!on} aria-label=${label} disabled=${disabled} onClick=${() => onChange(!on)}></button>`;
}
function Seg({ value, options, onChange, label }) {
  return html`<div class="seg" role="group" aria-label=${label}>${options.map((o) => html`<button key=${o.id} type="button" aria-pressed=${value === o.id} onClick=${() => onChange(o.id)}>
    ${o.icon && html`<${Icon} name=${o.icon} size=${13} />`}${o.label}</button>`)}</div>`;
}
function Meter({ pct, wide }) {
  const tone = pct >= 100 ? 'full' : pct >= 80 ? 'warn' : null;
  return html`<span class=${cx('svc-meter', wide && 'wide')}><span class="progress" role="img" aria-label=${pct + ' percent used'}><i class=${tone} style=${{ width: Math.min(100, pct) + '%' }}></i></span>
    <span class=${cx('num', tone === 'full' && 'error-text', tone === 'warn' && 'warn-text')}>${pct}%</span></span>`;
}
// One setting: its name and a short explanation on the left, the control on the right.
function Row({ label, hint, children, id, top }) {
  return html`<div class=${cx('svc-row', top && 'top')}>
    <div class="svc-label"><label for=${id}>${label}</label>${hint && html`<small>${hint}</small>`}</div>
    <div class="svc-control">${children}</div>
  </div>`;
}
function Num({ id, value, unit, min = 0, max = 999, onChange }) {
  return html`<span class="row" style="gap:6px"><input id=${id} class="input num-field" type="number" inputmode="numeric" min=${min} max=${max} value=${value}
    onInput=${(e) => { const v = +e.target.value; if (e.target.value !== '' && v >= min && v <= max) onChange(v); }} />${unit && html`<span class="muted">${unit}</span>`}</span>`;
}
function Section({ title, sub, children, action }) {
  return html`<section class="svc-section"><div class="section-head"><h2>${title}</h2>${sub && html`<span class="faint" style="font-size:var(--text-sm)">${sub}</span>`}<span class="grow"></span>${action}</div>${children}</section>`;
}
const copy = (text) => { navigator.clipboard?.writeText(text); act.toast('Copied'); };
function Command({ text }) {
  return html`<div class="svc-cmd"><code class="mono">${text}</code><button type="button" class="icon-btn sm" aria-label="Copy the command" data-tip="Copy" data-tip-side="left" onClick=${() => copy(text)}><${Icon} name="copy" size=${13} /></button></div>`;
}

// ---- machines --------------------------------------------------------------------
function MachineDetail({ s, m, now }) {
  const ags = machineAgents(s, m.id); const live = ags.filter(running);
  const repos = s.repos.filter((r) => r.folders[m.id]);
  const trees = s.projects.filter((p) => p.machine === m.id && !p.archived);
  const subs = s.subscriptions.filter((x) => x.machine === m.id);
  return html`<div class="svc-detail">
    ${m.status === 'offline' && html`<div class="callout warn" style="grid-column:1/-1"><${Icon} name="wifi-off" size=${15} />
      <span class="grow">${m.name} stopped answering at ${clock(m.lastSeen)}. Its agents are paused, and they start again when it reconnects. On ${m.name}, run <code>lgtm connect</code>.</span></div>`}
    ${m.status === 'pairing' && html`<div class="callout info" style="grid-column:1/-1"><${Icon} name="loader-circle" size=${15} class="svc-spin" /><span class="grow">${m.name} is connected. LGTM Studio is scanning it for harnesses and repositories.</span></div>`}
    <div>
      <h3>This machine</h3>
      <dl class="dl">
        <dt>Workspace</dt><dd class="mono">${m.workspace}</dd>
        <dt>System</dt><dd>${m.os} · ${m.cores} cores · ${m.ram} GB</dd>
        <dt>LGTM Studio</dt><dd>${m.version}${m.version !== s.settings.version ? html` <span class="warn-text">· older than the service (${s.settings.version})</span>` : ''}</dd>
        ${m.connectedFor && m.status === 'online' && html`<dt>Connected</dt><dd>${ago(now - m.connectedFor, now)}</dd>`}
        <dt>Agent limit</dt><dd><${Num} id=${'lim-' + m.id} value=${m.slots.limit} min=${1} max=${64} unit="at once" onChange=${(v) => update(() => { m.slots.limit = v; })} /></dd>
      </dl>
    </div>
    <div>
      <h3>Harnesses</h3>
      <ul class="svc-lines">${Object.keys(HARNESSES).map((h) => { const v = m.harnesses?.[h]; const n = subs.filter((x) => x.harness === h && x.signedIn).length;
        return html`<li key=${h}><${Icon} name=${v ? 'circle-check' : 'circle-alert'} size=${14} class=${v ? 'success-text' : 'warn-text'} /><b>${HARNESSES[h].name}</b>
          ${v ? html`<span class="muted">${v} · ${n ? n + ' signed in' : 'not signed in'}</span>` : html`<span class="muted">Not installed</span>`}</li>
          ${!v && html`<li><${Command} text=${h === 'codex' ? 'npm install -g @openai/codex' : 'npm install -g @anthropic-ai/claude-code'} /></li>`}`; })}</ul>
      <h3 style="margin-top:var(--space-4)">Repositories</h3>
      <ul class="svc-lines">${repos.map((r) => html`<li key=${r.id}><${Icon} name="folder-git-2" size=${14} class="faint" /><a class="link mono" href=${href('/r/' + r.id)}>${r.name}</a><span class="mono muted truncate">${r.folders[m.id]}</span></li>`)}
        ${repos.length === 0 && html`<li class="muted">No repository is on this machine yet.</li>`}</ul>
      <button type="button" class="btn sm" style="margin-top:6px" disabled=${m.status !== 'online'} onClick=${() => act.openDialog({ type: 'add-repository', machine: m.id })}><${Icon} name="plus" size=${13} />Add repository</button>
    </div>
    <div>
      <h3>Worktrees and agents</h3>
      ${trees.length === 0 && html`<p class="muted">No project runs here.</p>`}
      <ul class="svc-lines">${trees.map((p) => { const pa = agentsOfProject(s, p.id); const n = pa.filter(running).length;
        return html`<li key=${p.id}><${Icon} name="git-branch" size=${14} class="faint" /><a class="link truncate" href=${href(`/p/${p.id}/board`)} title=${p.branch}>${p.name}</a>
          <span class="grow"></span><span class="muted" style="white-space:nowrap">${1 + teamsOf(s, p.id).length} worktrees · ${n} of ${pa.length} running</span></li>`; })}</ul>
      ${live.length > 0 && html`<ul class="svc-agents">${live.map((a) => { const st = agentStatus(s, a);
        return html`<li key=${a.id}><a class="row" href=${href(routeForAgent(s, a))}><${Avatar} agent=${a} s=${s} size="sm" /><b>${a.name}</b><span class="muted truncate">${projectOf(s, a.project).name}</span></a>
          <span class="truncate" style="font-size:var(--text-sm)"><${StateWord} status=${st} /></span></li>`; })}</ul>`}
    </div>
  </div>`;
}
export function Machines({ s }) {
  const now = useNow(10_000);
  const online = s.machines.filter((m) => m.status === 'online').length;
  const remove = (m) => { const ags = machineAgents(s, m.id).filter(running); const subs = s.subscriptions.filter((x) => x.machine === m.id);
    act.confirm({ title: `Remove ${m.name}?`, body: `${m.name} is disconnected and forgotten. Its folders stay on its disk. Pair it again to bring it back.`, action: 'Remove machine',
      lost: [ags.length ? `${plural(ags.length, 'running agent')} will stop` : null, subs.length ? `${plural(subs.length, 'subscription')} on it will be removed` : null, s.projects.some((p) => p.machine === m.id && !p.archived) ? 'Projects that run here need another machine' : null].filter(Boolean),
      onConfirm: () => { update((st) => { st.machines = st.machines.filter((x) => x.id !== m.id); st.subscriptions = st.subscriptions.filter((x) => x.machine !== m.id);
        for (const a of st.agents) if ((projectOf(st, a.project) || {}).machine === m.id && running(a)) { a.prevState = a.state; a.state = 'stopped'; a.activity = `Stopped · ${m.name} was removed`; } }); act.toast(`Removed ${m.name}`); } }); };
  return html`<div class="view-body"><div class="page">
    <div class="page-head"><h1 class="page-title">Machines</h1><span class="sub">${online} of ${s.machines.length} online</span><span class="grow"></span>
      <button type="button" class="btn primary" onClick=${() => act.openDialog({ type: 'pair-machine' })}><${Icon} name="plus" size=${14} />Add machine</button></div>
    <div class="table-wrap" data-main><table class="table svc-machines">
      <thead><tr><th>Machine</th><th class="c-mid">Role</th><th>Status</th><th class="c-wide">Address</th><th class="c-wide">Harnesses</th><th>Agents</th><th class="c-mid">CPU</th><th class="c-mid">Memory</th><th class="c-mid">Last seen</th><th></th></tr></thead>
      <tbody>${s.machines.map((m) => { const k = 'machine:' + m.id; const open = !!s.expanded[k]; const off = m.status === 'offline'; const n = machineAgents(s, m.id).filter(running).length;
        const full = n >= m.slots.limit;
        return html`<tr key=${m.id} class=${cx('click', off && 's-warn', off && 'off')} aria-expanded=${open} onClick=${() => act.toggleExpanded(k)}>
            <td class="state-cell"><span class="row" style="gap:8px"><button type="button" class=${cx('svc-twist', open && 'open')} aria-expanded=${open} aria-label=${(open ? 'Hide' : 'Show') + ' details for ' + m.name} onClick=${(e) => { e.stopPropagation(); act.toggleExpanded(k); }}><${Icon} name="chevron-right" size=${13} /></button>
              <${Icon} name="server" size=${14} class="faint" /><b>${m.name}</b>${m.here && html`<span class="badge outline not-phone">This computer</span>`}</span></td>
            <td class="muted c-mid">${m.role === 'master' ? 'Master' : 'Worker'}</td>
            <td><span class="row" style="gap:6px"><i class=${cx('dot', off ? 'waiting' : m.status === 'pairing' ? 'starting' : 'working')}></i><span class=${cx(off && 'warn-text')} style=${off ? 'font-weight:var(--weight-medium)' : ''}>${off ? 'Offline' : m.status === 'pairing' ? 'Pairing' : 'Online'}</span></span></td>
            <td class="mono muted c-wide">${m.address}</td>
            <td class="c-wide">${Object.keys(HARNESSES).map((h) => m.harnesses?.[h] ? html`<span key=${h} class="tag" style="margin-right:4px">${HARNESSES[h].name}</span>` : null)}${m.harnesses && !m.harnesses.codex && html`<span class="warn-text" style="font-size:var(--text-sm)">Codex missing</span>`}${!m.harnesses && html`<span class="muted">Scanning…</span>`}</td>
            <td class="num" style="text-align:left"><span class=${cx(full && 'warn-text')}>${n}</span><span class="muted"> of ${m.slots.limit}</span></td>
            <td class="c-mid">${off || m.status === 'pairing' ? html`<span class="faint">—</span>` : html`<${Meter} pct=${m.cpu} />`}</td>
            <td class="c-mid">${off || m.status === 'pairing' ? html`<span class="faint">—</span>` : html`<${Meter} pct=${m.mem} />`}</td>
            <td class=${cx('c-mid', off ? 'warn-text' : 'muted')}>${off ? ago(m.lastSeen, now) + ' ago' : 'Now'}</td>
            <td class="svc-acts" onClick=${(e) => e.stopPropagation()}><${Menu} class="icon-btn sm" label=${'Actions for ' + m.name} align="end" width=${230} trigger=${html`<${Icon} name="ellipsis" size=${15} />`}
              items=${[
                { label: 'Rename', icon: 'pencil', onSelect: () => act.openDialog({ type: 'rename', title: `Rename ${m.name}`, value: m.name, taken: s.machines.map((x) => x.name), onRename: (v) => { update(() => { m.name = v; }); act.toast('Machine renamed'); } }) },
                { label: 'Scan harnesses again', icon: 'scan-search', disabled: off, why: off ? `${m.name} is offline.` : null, onSelect: () => act.toast(`Scanned ${m.name}. Nothing changed.`) },
                { label: 'Add repository', icon: 'folder-git-2', disabled: off, why: off ? `${m.name} is offline.` : null, onSelect: () => act.openDialog({ type: 'add-repository', machine: m.id }) },
                off && { label: 'Try to reconnect', icon: 'refresh-cw', onSelect: () => { act.toast(`Calling ${m.name}…`); setTimeout(() => { update(() => { m.status = 'online'; m.lastSeen = Date.now(); m.cpu = 9; m.mem = 31; }); act.toast(`${m.name} is back online`); }, 1500); } },
                { sep: true },
                { label: 'Remove machine', icon: 'trash-2', danger: true, disabled: m.role === 'master', why: m.role === 'master' ? 'The master runs the service and cannot be removed.' : null, onSelect: () => remove(m) },
              ].filter(Boolean)} /></td>
          </tr>
          ${open && html`<tr key=${m.id + '-d'} class="svc-detail-row"><td colspan="10"><${MachineDetail} s=${s} m=${m} now=${now} /></td></tr>`}`; })}</tbody>
    </table></div>
    <p class="svc-foot-note">The master runs the service and this page. A worker runs agents in its own workspace and reports back to the master.</p>
  </div></div>`;
}

function PairMachine({ s }) {
  const [code] = useState(() => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return [0, 1, 2, 3, 4].map(() => [0, 1, 2, 3].map(() => a[Math.floor(Math.random() * a.length)]).join('')).join('-'); });
  const [started] = useState(Date.now()); const now = useNow(1000);
  const [step, setStep] = useState(0); const [name, setName] = useState('Mini');
  const left = Math.max(0, 10 * MIN - (now - started)); const mm = Math.floor(left / MIN), ss = Math.floor((left % MIN) / 1000);
  const master = s.machines.find((m) => m.role === 'master');
  useEffect(() => { if (step !== 0) return; const t = setTimeout(() => setStep(1), 3200); return () => clearTimeout(t); }, [step]);
  const taken = s.machines.some((m) => m.name.toLowerCase() === name.trim().toLowerCase());
  const confirm = () => {
    if (!name.trim() || taken) return;
    const id = uid('machine');
    update((st) => { st.machines.push({ id, name: name.trim(), role: 'worker', status: 'pairing', slots: { used: 0, limit: 4 }, lastSeen: Date.now(), address: '192.168.1.52', workspace: '~/code', os: 'macOS', cpu: 0, mem: 0, cores: 10, ram: 32, version: st.settings.version, harnesses: null, connectedFor: 0 }); st.expanded['machine:' + id] = true; });
    act.closeDialog(); act.toast(`${name.trim()} is paired`);
    setTimeout(() => update((st) => { const m = byId(st.machines, id); if (!m) return; m.status = 'online'; m.harnesses = { claude: '2.4.1', codex: null }; m.cpu = 7; m.mem = 28; }), 2600);
  };
  return html`<${Dialog} title="Add a machine" onClose=${act.closeDialog} onSubmit=${confirm}
    foot=${html`<span class="why">${step === 0 ? `The code works once and expires in ${mm}:${String(ss).padStart(2, '0')}.` : taken ? 'A machine already has that name.' : 'Confirm only a machine you started yourself.'}</span>
      <button type="button" class="btn" onClick=${act.closeDialog}>Cancel</button><button type="submit" class="btn primary" disabled=${step === 0 || !name.trim() || taken}>Confirm ${step === 1 && name.trim() ? name.trim() : 'machine'}</button>`}>
    <ol class="svc-steps">
      <li class="done"><span class="n">1</span><div><b>Install LGTM Studio on the other machine.</b><${Command} text="npm install -g lgtm" /></div></li>
      <li class=${step > 0 ? 'done' : 'now'}><span class="n">2</span><div><b>Run this command there.</b>
        <${Command} text=${`lgtm connect ${master.name.toLowerCase()}.lan:${s.settings.port} --code ${code}`} /></div></li>
      <li class=${step > 0 ? 'now' : ''}><span class="n">3</span><div><b>Confirm the machine here.</b>
        ${step === 0 ? html`<p class="row muted"><${Icon} name="loader-circle" size=${14} class="svc-spin" />Waiting for a machine to use the code…</p>`
          : html`<div class="svc-found"><${Icon} name="server" size=${16} /><div class="grow"><b>mini.lan</b><span class="muted"> wants to connect</span><div class="mono muted" style="font-size:var(--text-sm)">192.168.1.52 · macOS · 10 cores · 32 GB</div></div><span class="badge success">Code matched</span></div>
            <div class="field" style="margin-top:8px"><label for="pair-name">Name</label><input id="pair-name" class="input" value=${name} onInput=${(e) => setName(e.target.value)} autofocus /></div>`}</div></li>
    </ol>
  <//>`;
}
registerDialog('pair-machine', PairMachine);

// ---- add repository ------------------------------------------------------------
function AddRepository({ s, d }) {
  const known = d.repo ? byId(s.repos, d.repo) : null;
  const [machine, setMachine] = useState(d.machine || 'studio'); const m = machineOf(s, machine);
  const [path, setPath] = useState(() => `${machineOf(s, d.machine || 'studio').workspace}/${known ? known.name : ''}`);
  const [found, setFound] = useState(null);
  useEffect(() => { if (!known) return; setPath(`${m.workspace}/${known.name}`); }, [machine]);
  const name = path.replace(/\/+$/, '').split('/').pop() || '';
  const valid = /^(~|\/)/.test(path.trim()) && name && name !== '~' && path.trim() !== m.workspace;
  useEffect(() => {
    setFound(null); if (!valid) return;
    const t = setTimeout(() => setFound(known ? { main: known.main, remote: known.remote } : { main: 'main', remote: `github.com/acme/${name}` }), 700);
    return () => clearTimeout(t);
  }, [path, machine]);
  const id = act.slug(name); const dup = !known && s.repos.some((r) => r.id === id);
  const here = known ? known.folders[machine] : dup && byId(s.repos, id).folders[machine];
  const why = m.status !== 'online' ? `${m.name} is offline.` : !valid ? 'Give the folder of a git repository.' : here ? `${name} is already on ${m.name}.` : !found ? 'Looking at the folder…' : null;
  const add = () => {
    if (why) return;
    update((st) => { const r = known || (dup && byId(st.repos, id));
      if (r) r.folders[machine] = path.trim();
      else st.repos.push({ id, name, main: found.main, remote: found.remote, folders: { [machine]: path.trim() } });
      st.expanded['repo:' + (r ? r.id : id)] = true; });
    act.toast(`Added ${name} on ${m.name}`);
    if (d.back) act.openDialog({ ...d.back, machine, repo: known ? known.id : id }); else act.closeDialog();
  };
  const close = () => (d.back ? act.openDialog(d.back) : act.closeDialog());
  return html`<${Dialog} title=${known ? `Add ${known.name} to a machine` : 'Add repository'} onClose=${close} onSubmit=${add}
    foot=${html`${why && html`<span class="why">${why}</span>`}<button type="button" class="btn" onClick=${close}>${d.back ? 'Back' : 'Cancel'}</button><button type="submit" class="btn primary" disabled=${!!why}>Add repository</button>`}>
    <div class="field"><label for="ar-machine">Machine</label>
      <select id="ar-machine" class="select" value=${machine} onChange=${(e) => setMachine(e.target.value)}>
        ${s.machines.map((x) => html`<option value=${x.id} disabled=${x.status !== 'online'}>${x.name}${x.status !== 'online' ? ' (offline)' : x.here ? ' (this computer)' : ''}</option>`)}</select></div>
    <div class="field"><label for="ar-path">Folder on ${m.name}</label>
      <input id="ar-path" class="input mono" value=${path} onInput=${(e) => setPath(e.target.value)} placeholder=${m.workspace + '/my-repository'} autofocus spellcheck="false" />
      <span class="hint">The folder must already be a git repository. LGTM Studio adds its worktrees under <code>.worktrees</code> inside it.</span></div>
    <dl class="dl svc-detected">
      <dt>Base branch</dt><dd class="mono">${found ? found.main : html`<span class="faint">${valid ? 'Detecting…' : '—'}</span>`}</dd>
      <dt>Remote</dt><dd class="mono" style="overflow-wrap:anywhere">${found ? (found.remote || 'No remote') : html`<span class="faint">${valid ? 'Detecting…' : '—'}</span>`}</dd>
      <dt>Status</dt><dd>${found ? html`<span class="row success-text"><${Icon} name="circle-check" size=${14} />A git repository with a clean working tree</span>` : html`<span class="faint">—</span>`}</dd>
    </dl>
  <//>`;
}
registerDialog('add-repository', AddRepository);

// ---- subscriptions ---------------------------------------------------------------
function subState(x) {
  if (!x.signedIn) return { word: 'Signed out', tone: 'warn', dot: 'waiting' };
  if (!x.enabled) return { word: 'Turned off', tone: null, dot: 'idle' };
  if (x.window && x.window.pct >= 100) return { word: 'Limit reached', tone: 'error', dot: 'failed' };
  if (x.usage && x.usage.pct >= 100) return { word: 'Weekly limit reached', tone: 'error', dot: 'failed' };
  if ((x.window && x.window.pct >= 80) || (x.usage && x.usage.pct >= 80)) return { word: 'Near its limit', tone: 'warn', dot: 'waiting' };
  return { word: 'Signed in', tone: null, dot: 'working' };
}
function SubRow({ s, x, now }) {
  const st = subState(x); const m = machineOf(s, x.machine); const h = HARNESSES[x.harness]; const ags = subAgents(s, x.id); const live = ags.filter(running).length;
  const k = 'sub:' + x.id; const open = !!s.expanded[k];
  const makeDefault = () => { update((stt) => { for (const y of stt.subscriptions) if (y.harness === x.harness && y.machine === x.machine) y.useForNew = y.id === x.id; }); act.toast(`New ${h.name} agents on ${m.name} use ${x.name}`); };
  const signOut = () => act.confirm({ title: `Sign out of ${h.name} · ${x.name}?`, body: `The sign-in on ${m.name} is removed. Sign in again at any time.`, action: 'Sign out',
    lost: ags.length ? [`${plural(ags.length, 'agent')} ${ags.length === 1 ? 'uses' : 'use'} it and will pause at the next turn`] : [],
    onConfirm: () => { update(() => { x.signedIn = false; x.usage = null; x.window = null; x.useForNew = false; }); act.toast(`Signed out of ${h.name} · ${x.name}`); } });
  const remove = () => act.confirm({ title: `Remove ${h.name} · ${x.name}?`, body: 'The subscription and its sign-in are removed from LGTM Studio.', action: 'Remove subscription',
    lost: ags.length ? [`${plural(ags.length, 'agent')} will need another subscription`] : [],
    onConfirm: () => { update((stt) => { stt.subscriptions = stt.subscriptions.filter((y) => y.id !== x.id); }); act.toast('Subscription removed'); } });
  const signIn = () => act.openDialog({ type: 'signin', subscription: x.id });
  return html`<div class=${cx('svc-sub', st.tone === 'warn' && 'warn', st.tone === 'error' && 'error', !x.enabled && 'dim')}>
    <div class="svc-sub-row">
      <div class="c-name"><button type="button" class=${cx('svc-twist', open && 'open')} aria-expanded=${open} aria-label=${(open ? 'Hide' : 'Show') + ' agents on ' + x.name} onClick=${() => act.toggleExpanded(k)}><${Icon} name="chevron-right" size=${13} /></button>
        <div class="col"><span class="row" style="gap:6px"><b>${x.name}</b>${x.useForNew && x.signedIn && html`<span class="badge outline" data-tip=${`New ${h.name} agents on ${m.name} use it`}>Default</span>`}</span>
          <span class="muted truncate" style="font-size:var(--text-sm)">${x.account || 'No account'} · ${m.name}</span></div></div>
      <div class="c-state"><span class="row" style="gap:6px"><i class=${cx('dot', st.dot)}></i><span class=${cx(st.tone === 'warn' && 'warn-text', st.tone === 'error' && 'error-text')} style=${st.tone ? 'font-weight:var(--weight-medium)' : ''}>${st.word}</span></span></div>
      <div class="c-use" data-label="5 hours">${x.window ? html`<${Meter} pct=${x.window.pct} wide /><small class=${cx(x.window.pct >= 100 ? 'error-text' : 'muted')}>Resets in ${until(x.window.resetsAt, now)}</small>` : html`<span class="faint">—</span>`}</div>
      <div class="c-use" data-label="This week">${x.usage ? html`<${Meter} pct=${x.usage.pct} wide /><small class="muted">Resets ${x.usage.resetsAt - now < DAY ? 'in ' + until(x.usage.resetsAt, now) : new Date(x.usage.resetsAt).toLocaleDateString('en-GB', { weekday: 'long' })}</small>` : html`<span class="faint">—</span>`}</div>
      <div class="c-agents" data-label="Agents">${ags.length ? html`<button type="button" class="link" onClick=${() => act.toggleExpanded(k, true)}>${ags.length}</button><span class="muted"> · ${live} running</span>` : html`<span class="faint">None</span>`}</div>
      <div class="c-model" data-label="Model for new agents"><select class="select" aria-label=${'Model for new agents on ' + x.name} value=${x.model} disabled=${!x.signedIn} onChange=${(e) => { const v = e.target.value; update(() => { x.model = v; }); markSaved(); }}>
        ${h.models.map((mo) => html`<option value=${mo}>${mo}</option>`)}</select></div>
      <div class="c-act">
        ${!x.signedIn ? html`<button type="button" class="btn sm primary" onClick=${signIn}>Sign in</button>` : null}
        <${Menu} class="icon-btn sm" label=${'Actions for ' + x.name} align="end" width=${250} trigger=${html`<${Icon} name="ellipsis" size=${15} />`}
          items=${[
            x.signedIn && { label: `Use for new agents on ${m.name}`, icon: 'star', checked: x.useForNew, disabled: !x.enabled, onSelect: makeDefault },
            { label: x.enabled ? 'Turn off' : 'Turn on', icon: x.enabled ? 'pause' : 'play', hint: x.enabled ? 'No agent starts on it. Running agents finish their turn.' : null, onSelect: () => { update(() => { x.enabled = !x.enabled; if (!x.enabled) x.useForNew = false; }); act.toast(x.enabled ? 'Subscription turned on' : 'Subscription turned off'); } },
            { label: 'Rename', icon: 'pencil', onSelect: () => act.openDialog({ type: 'rename', title: 'Rename subscription', value: x.name, taken: s.subscriptions.filter((y) => y.harness === x.harness).map((y) => y.name), onRename: (v) => { update(() => { x.name = v; }); act.toast('Subscription renamed'); } }) },
            { sep: true },
            x.signedIn ? { label: 'Sign out', icon: 'log-out', onSelect: signOut } : { label: 'Sign in', icon: 'log-in', onSelect: signIn },
            { label: 'Remove', icon: 'trash-2', danger: true, onSelect: remove },
          ].filter(Boolean)} />
      </div>
    </div>
    ${st.word === 'Limit reached' && html`<div class="svc-sub-note error-text"><${Icon} name="circle-alert" size=${14} /><span>The five-hour limit is used up. Agents on this subscription wait, and try again every ${s.settings.capacityBackoff} minutes until ${clock(x.window.resetsAt)}.</span></div>`}
    ${!x.signedIn && html`<div class="svc-sub-note warn-text"><${Icon} name="triangle-alert" size=${14} /><span>No sign-in on ${m.name}. ${ags.length ? `${plural(ags.length, 'agent')} cannot start until you sign in.` : 'No agent can start on it.'}</span></div>`}
    ${open && html`<div class="svc-sub-agents">${ags.length === 0 ? html`<span class="muted">No agent uses this subscription.</span>` : ags.map((a) => { const as = agentStatus(s, a);
      return html`<a key=${a.id} class="list-row" href=${href(routeForAgent(s, a))}><${Avatar} agent=${a} s=${s} size="sm" /><b style="font-weight:var(--weight-medium)">${a.name}</b><span class="muted truncate grow">${projectOf(s, a.project).name}</span>
        <span class="muted not-phone">${a.model} · ${a.effort}</span><span style="min-width:110px;text-align:right;font-size:var(--text-sm)"><${StateWord} status=${as} /></span></a>`; })}</div>`}
  </div>`;
}
export function Subscriptions({ s }) {
  const now = useNow(30_000);
  const out = s.subscriptions.filter((x) => !x.signedIn).length; const capped = s.subscriptions.filter((x) => subState(x).tone === 'error').length;
  return html`<div class="view-body"><div class="page">
    <div class="page-head"><h1 class="page-title">Subscriptions</h1>
      <span class="sub">${s.subscriptions.length - out} of ${s.subscriptions.length} signed in${capped ? html` · <span class="error-text">${capped} at its limit</span>` : ''}</span><${Saved} s=${s} /><span class="grow"></span>
      <button type="button" class="btn primary" onClick=${() => act.openDialog({ type: 'add-subscription' })}><${Icon} name="plus" size=${14} />Add subscription</button></div>
    <div data-main>
    ${Object.entries(HARNESSES).map(([hid, h]) => { const list = s.subscriptions.filter((x) => x.harness === hid);
      return html`<section key=${hid} class="svc-harness">
        <div class="section-head"><h2>${h.name}</h2><span class="count">${list.length}</span><span class="faint truncate not-phone" style="font-size:var(--text-sm)">${h.runMode} mode · ${h.models.join(', ')}</span></div>
        <div class="svc-subs">
          <div class="svc-sub-row svc-sub-head" aria-hidden="true"><div class="c-name">Subscription</div><div>Status</div><div>5 hours</div><div>This week</div><div>Agents</div><div>Model for new agents</div><div></div></div>
          ${list.map((x) => html`<${SubRow} key=${x.id} s=${s} x=${x} now=${now} />`)}
          ${list.length === 0 && html`<${Empty} title=${`No ${h.name} subscription`}>Add one to run ${h.name} agents.<//>`}
        </div>
      </section>`; })}
    </div>
    <p class="svc-foot-note">A subscription is one sign-in for one harness on one machine. The sign-in happens in the harness's own program, and LGTM Studio never sees the password.</p>
  </div></div>`;
}
function AddSubscription({ s }) {
  const [harness, setHarness] = useState('claude'); const [name, setName] = useState(''); const [machine, setMachine] = useState('studio');
  const m = machineOf(s, machine); const h = HARNESSES[harness];
  const dup = s.subscriptions.some((x) => x.harness === harness && x.machine === machine && x.name.toLowerCase() === name.trim().toLowerCase());
  const missing = m.harnesses && !m.harnesses[harness];
  const why = !name.trim() ? 'Give it a name you will recognise, such as the plan.' : dup ? `${m.name} already has a ${h.name} subscription with that name.` : missing ? `${h.name} is not installed on ${m.name}.` : m.status !== 'online' ? `${m.name} is offline.` : null;
  const add = () => { if (why) return; const id = uid('sub');
    update((st) => { st.subscriptions.push({ id, harness, name: name.trim(), machine, enabled: true, signedIn: false, useForNew: false, usage: null, window: null, account: null, model: h.models[1] || h.models[0] }); });
    act.openDialog({ type: 'signin', subscription: id }); };
  return html`<${Dialog} title="Add subscription" size="narrow" onClose=${act.closeDialog} onSubmit=${add}
    foot=${html`<button type="button" class="btn" onClick=${act.closeDialog}>Cancel</button><button type="submit" class="btn primary" disabled=${!!why}>Add and sign in</button>`}>
    <div class="field"><label>Harness</label><${Seg} label="Harness" value=${harness} onChange=${setHarness} options=${Object.entries(HARNESSES).map(([id, x]) => ({ id, label: x.name }))} /></div>
    <div class="field"><label for="as-name">Name</label><input id="as-name" class="input" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="Max" autofocus />${why && name.trim() ? html`<span class="error">${why}</span>` : html`<span class="hint">Shown as "${h.name} · ${name.trim() || 'Max'}".</span>`}</div>
    <div class="field"><label for="as-machine">Machine</label><select id="as-machine" class="select" value=${machine} onChange=${(e) => setMachine(e.target.value)}>
      ${s.machines.map((x) => html`<option value=${x.id} disabled=${x.status !== 'online'}>${x.name}${x.status !== 'online' ? ' (offline)' : ''}</option>`)}</select></div>
  <//>`;
}
registerDialog('add-subscription', AddSubscription);

// ---- phone notifications ---------------------------------------------------------
const EVENTS = [
  ['question', 'An agent asks you a question', 'The alert carries the question and who asked.'],
  ['approval', 'An approval waits for you', 'Sent when an approval has waited for two minutes.'],
  ['merge', 'A merge is ready', 'A project is done and reviewed, and the merge is yours.'],
  ['failed', 'An agent failed to start', 'A sign-in is missing or a machine is offline.'],
  ['sprint', 'A sprint is done', 'Off by default. It tells you about progress, not about a wait.'],
];
const NOTE_KIND = { ...KIND_LABEL, sprint: 'Sprint done', test: 'Test' };
const DELIVERY = { sent: ['Sent to phone', 'muted'], off: ['Not sent', 'faint'], failed: ['Failed', 'error-text'], quiet: ['Held · quiet hours', 'muted'], muted: ['Not sent · turned off', 'faint'] };
function sendTest() {
  const s = store.state; const server = s.settings.ntfyServer;
  const ok = /\./.test(server) && !/localhost/.test(server);
  update((st) => { st.notifications.unshift({ id: uid('n'), ts: Date.now(), kind: 'test', title: 'Test notification from LGTM Studio', read: true, delivery: ok ? 'sent' : 'failed', error: ok ? null : `Could not reach ${server}` }); });
  act.toast(ok ? `Test sent to ${s.settings.ntfyTopic}` : `Could not reach ${server}`, ok ? 'ok' : 'error');
}
function NtfyForm({ s }) {
  const set = s.settings; const on = !!set.ntfyServer;
  const [f, setF] = useState({ server: set.ntfyServer, topic: set.ntfyTopic, token: set.ntfyToken }); const [show, setShow] = useState(false);
  const dirty = f.server !== set.ntfyServer || f.topic !== set.ntfyTopic || f.token !== set.ntfyToken;
  const bad = f.server.trim() && !/^https?:\/\/\S+$/.test(f.server.trim()) ? 'Start the address with https://' : null;
  const badTopic = f.topic && !/^[\w-]+$/.test(f.topic) ? 'A topic has letters, digits, hyphens and underscores only.' : null;
  const can = f.server.trim() && f.topic.trim() && !bad && !badTopic && dirty;
  const save = () => { if (!can) return; setS({ ntfyServer: f.server.trim(), ntfyTopic: f.topic.trim(), ntfyToken: f.token }); act.toast('Phone notifications are on'); };
  const off = () => act.confirm({ title: 'Turn off phone notifications?', body: 'The server, topic and token are forgotten. Requests still show on Home and in the bell.', action: 'Turn off', onConfirm: () => { setS({ ntfyServer: '', ntfyTopic: '', ntfyToken: '' }); setF({ server: '', topic: '', token: '' }); } });
  const fld = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return html`<form class="svc-form" onSubmit=${(e) => { e.preventDefault(); save(); }}>
    <div class="field"><label for="nt-server">ntfy server</label><input id="nt-server" class="input mono" value=${f.server} onInput=${fld('server')} placeholder="https://ntfy.example.com" spellcheck="false" autocapitalize="off" />${bad && html`<span class="error">${bad}</span>`}</div>
    <div class="field"><label for="nt-topic">Topic</label><input id="nt-topic" class="input mono" value=${f.topic} onInput=${fld('topic')} placeholder="lgtm-alerts" spellcheck="false" autocapitalize="off" />
      ${badTopic ? html`<span class="error">${badTopic}</span>` : html`<span class="hint">Subscribe to the same topic in the ntfy app on your phone. Anyone who knows the topic can read the alerts, so pick a long one.</span>`}</div>
    <div class="field"><label for="nt-token">Access token <span class="faint" style="font-weight:var(--weight-body)">· optional</span></label>
      <span class="row"><input id="nt-token" class="input mono grow" type=${show ? 'text' : 'password'} value=${f.token} onInput=${fld('token')} placeholder="tk_…" autocomplete="off" spellcheck="false" />
        <button type="button" class="btn icon" aria-label=${show ? 'Hide the token' : 'Show the token'} aria-pressed=${show} onClick=${() => setShow(!show)}><${Icon} name=${show ? 'eye-off' : 'eye'} size=${14} /></button></span></div>
    <div class="row" style="flex-wrap:wrap">
      <button type="submit" class="btn primary" disabled=${!can}>${on ? 'Save changes' : 'Turn on'}</button>
      <button type="button" class="btn" disabled=${!on || dirty} data-tip=${!on ? 'Turn notifications on first' : dirty ? 'Save your changes first' : null} onClick=${sendTest}><${Icon} name="send" size=${13} />Send a test</button>
      <span class="grow"></span>
      ${on && html`<button type="button" class="btn ghost" onClick=${off}>Turn off</button>`}
    </div>
  </form>`;
}
export function Notifications({ s }) {
  const now = useNow(); const set = s.settings; const on = !!set.ntfyServer;
  const list = s.notifications; const unread = list.filter((n) => !n.read).length; const failed = list.filter((n) => n.delivery === 'failed').length;
  const [showAll, setShowAll] = useState(false); const shown = showAll ? list : list.slice(0, 12);
  const open = (n) => { update(() => { n.read = true; }); const r = n.request && byId(s.requests, n.request); if (r) go(routeForRequest(s, r)); else if (n.to) go(n.to); };
  const retry = (n) => { act.toast('Sending again…'); setTimeout(() => { const ok = /\./.test(set.ntfyServer) && !/localhost/.test(set.ntfyServer); update(() => { n.delivery = ok ? 'sent' : 'failed'; }); act.toast(ok ? 'Sent to phone' : n.error, ok ? 'ok' : 'error'); }, 700); };
  const setOn = (k, v) => setS({ notifyOn: { ...set.notifyOn, [k]: v } });
  const setQuiet = (patch) => setS({ quiet: { ...set.quiet, ...patch } });
  let lastDay = null;
  return html`<div class="view-body"><div class="page">
    <div class="page-head"><h1 class="page-title">Phone notifications</h1>
      <span class="sub row" style="gap:6px"><i class=${cx('dot', on ? (failed ? 'failed' : 'working') : 'idle')}></i>${on ? html`Sending to <span class="mono">${set.ntfyTopic}</span>` : 'Not set up'}</span><${Saved} s=${s} /></div>
    <div class="svc-split">
      <div class="svc-side">
        <${Section} title="Where alerts go" sub="ntfy">
          ${!on && s.phoneOffer === 'open' && html`<div class="callout info" style="align-items:center;margin-bottom:var(--space-3)"><${Icon} name="smartphone" size=${15} />
            <span class="grow">Alerts reach your phone when an agent waits for you. Until then, requests show here, on Home and in the bell.</span>
            <button type="button" class="icon-btn sm" aria-label="Dismiss" onClick=${act.declinePhoneOffer}><${Icon} name="x" size=${13} /></button></div>`}
          <${NtfyForm} s=${s} />
        <//>
        <${Section} title="Notify me when">
          <div class=${cx('svc-rows', !on && 'svc-off')}>${EVENTS.map(([k, label, hint]) => html`<${Row} key=${k} label=${label} hint=${hint}><${Switch} on=${set.notifyOn[k]} label=${label} onChange=${(v) => setOn(k, v)} /><//>`)}</div>
        <//>
        <${Section} title="Quiet hours">
          <div class=${cx('svc-rows', !on && 'svc-off')}>
            <${Row} label="Hold alerts at night" hint="Held alerts arrive together when quiet hours end."><${Switch} on=${set.quiet.on} label="Quiet hours" onChange=${(v) => setQuiet({ on: v })} /><//>
            ${set.quiet.on && html`<${Row} label="From" id="q-from"><span class="row"><input id="q-from" class="input" style="width:128px" type="time" value=${set.quiet.from} onInput=${(e) => setQuiet({ from: e.target.value })} />
              <span class="muted">to</span><input class="input" style="width:128px" type="time" aria-label="Quiet hours end" value=${set.quiet.to} onInput=${(e) => setQuiet({ to: e.target.value })} /></span><//>
            <${Row} label="Let failed starts through" hint="A failed start stops a team, so it can wake you."><${Switch} on=${set.quiet.failed} label="Let failed starts through" onChange=${(v) => setQuiet({ failed: v })} /><//>`}
          </div>
        <//>
      </div>
      <div class="svc-main" data-main>
        <${Section} title="Recent notifications" sub=${unread ? `${unread} unread` : 'All read'}
          action=${html`<button type="button" class="btn sm ghost" disabled=${!unread} onClick=${() => update((st) => { for (const n of st.notifications) n.read = true; })}><${Icon} name="check" size=${13} />Mark all read</button>`}>
          ${list.length === 0 && html`<${Empty} title="No notifications yet" icon="bell">A row appears here each time an agent waits for you.<//>`}
          <ul class="svc-notes">${shown.map((n) => { const d = dayLabel(n.ts, now); const head = d !== lastDay ? html`<li class="svc-day" key=${'d' + n.id}>${d}</li>` : null; lastDay = d;
            const a = n.agent && agentOf(s, n.agent); const p = n.project && projectOf(s, n.project); const r = n.request && byId(s.requests, n.request);
            const del = n.delivery === 'off' && on ? (set.notifyOn[n.kind] === false ? 'muted' : 'off') : n.delivery; const [dw, dc] = DELIVERY[del] || DELIVERY.off;
            const clickable = !!(r || n.to);
            return html`${head}<li key=${n.id} class=${cx('svc-note', !n.read && 'unread', n.kind === 'failed' && 'failed')}>
              <i class="pip" aria-label=${n.read ? null : 'Unread'}></i>
              <span class=${cx('kind', n.kind === 'failed' ? 'failed' : r && r.status === 'open' ? n.kind : 'closed')}>${NOTE_KIND[n.kind]}</span>
              ${clickable ? html`<a class="title truncate" href=${href(r ? routeForRequest(s, r) : n.to)} onClick=${(e) => { e.preventDefault(); open(n); }}>${n.title}</a>` : html`<span class="title truncate">${n.title}</span>`}
              <span class="from muted truncate">${a ? a.name : 'LGTM Studio'}${p ? ' · ' + p.name : ''}${r && r.status !== 'open' ? ' · ' + r.answer : ''}</span>
              <span class=${cx('del', dc)} title=${n.error || (del === 'off' ? 'Phone notifications were not set up' : null)}>${del === 'failed' ? html`<${Icon} name="circle-alert" size=${13} />` : del === 'sent' ? html`<${Icon} name="check" size=${13} />` : null}${dw}
                ${del === 'failed' && html`<button type="button" class="link" onClick=${() => retry(n)}>Retry</button>`}</span>
              <time class="muted">${now - n.ts < DAY ? clock(n.ts) : ago(n.ts, now) + ' ago'}</time>
            </li>`; })}</ul>
          ${list.length > 12 && html`<button type="button" class="btn sm ghost" style="margin-top:6px" onClick=${() => setShowAll(!showAll)}>${showAll ? 'Show fewer' : `Show all ${list.length}`}</button>`}
        <//>
      </div>
    </div>
  </div></div>`;
}

// ---- service settings ------------------------------------------------------------
const PERMISSION_HINT = {
  'Read only': 'The agent reads and searches. Every change and command is refused.',
  'Ask before every change': 'Each edit and each command becomes an approval for you.',
  'Edit files without asking': 'Edits inside the worktree are free. Commands still ask.',
  'Full access': 'Edits and commands inside the worktree run without asking.',
};
function PermissionPicker({ value, onChange, name }) {
  return html`<div class="svc-radios" role="radiogroup" aria-label="Permission">${PERMISSION_MODES.map((p) => html`<label key=${p} class=${cx('svc-radio', value === p && 'on')}>
    <input type="radio" name=${name} checked=${value === p} onChange=${() => onChange(p)} /><span><b>${p}</b><small>${PERMISSION_HINT[p]}</small></span></label>`)}</div>`;
}
function Appearance({ s }) {
  const p = s.prefs;
  return html`<div class="svc-rows">
    <${Row} label="Theme" hint="Field is the light palette. Dusk is the dark palette.">
      <${Seg} label="Theme" value=${p.theme} onChange=${(v) => { act.setPref('theme', v); markSaved(); }} options=${[{ id: 'light', label: 'Field', icon: 'sun' }, { id: 'dark', label: 'Dusk', icon: 'moon' }, { id: 'system', label: 'Match system', icon: 'monitor' }]} /><//>
    <${Row} label="Density" hint="Compact fits more rows. Regular gives each row more room.">
      <${Seg} label="Density" value=${p.density} onChange=${(v) => { act.setPref('density', v); markSaved(); }} options=${[{ id: 'compact', label: 'Compact' }, { id: 'regular', label: 'Regular' }]} /><//>
    <${Row} label="Sidebar" hint=${'Fold it to a rail of icons.'}><${Switch} on=${p.sidebarFolded} label="Fold the sidebar" onChange=${(v) => { act.setPref('sidebarFolded', v); markSaved(); }} /><//>
    <${Row} label="Preview" top>
      <div class="svc-preview" aria-hidden="true">
        <div class="list-row" aria-selected="true"><i class="dot waiting"></i><b style="font-weight:var(--weight-medium)">Build lead</b><span class="muted grow truncate">Waiting for your answer</span><span class="warn-text" style="font-size:var(--text-sm)">18 min</span></div>
        <div class="list-row"><i class="dot working"></i><b style="font-weight:var(--weight-medium)">Builder 1</b><span class="muted grow truncate">Editing Sidebar.tsx</span><span class="tag">AC-14</span></div>
        <div class="list-row"><i class="dot idle"></i><b style="font-weight:var(--weight-medium)">Test runner</b><span class="muted grow truncate">Idle</span></div>
        <div class="row" style="padding:8px var(--inset) 4px"><button type="button" class="btn primary" tabindex="-1">Allow</button><button type="button" class="btn" tabindex="-1">Deny</button><input class="input" tabindex="-1" placeholder="Or type another answer" /></div>
      </div><//>
  </div>`;
}
function Defaults({ s }) {
  const set = s.settings; const h = HARNESSES[set.defaultHarness];
  return html`<div class="svc-rows">
    <${Row} label="Harness" hint="The program a new agent runs in.">
      <${Seg} label="Harness" value=${set.defaultHarness} onChange=${(v) => setS({ defaultHarness: v, defaultModel: HARNESSES[v].models[HARNESSES[v].models.length > 2 ? 2 : 0], defaultEffort: 'Medium' })} options=${Object.entries(HARNESSES).map(([id, x]) => ({ id, label: x.name }))} /><//>
    <${Row} label="Model" id="df-model" hint="Leads start one step above this model.">
      <select id="df-model" class="select" style="width:200px" value=${set.defaultModel} onChange=${(e) => setS({ defaultModel: e.target.value })}>${h.models.map((m) => html`<option value=${m}>${m}</option>`)}</select><//>
    <${Row} label="Effort"><${Seg} label="Effort" value=${set.defaultEffort} onChange=${(v) => setS({ defaultEffort: v })} options=${h.efforts.map((e) => ({ id: e, label: e }))} /><//>
    <${Row} label="Permission" hint="What a new agent may do without asking. A project can set its own." top>
      <${PermissionPicker} name="df-perm" value=${set.defaultPermission} onChange=${(v) => setS({ defaultPermission: v })} /><//>
    <${Row} label="Need-to-know messages" hint="New teams keep direct messages private to the agents in them. You always see everything.">
      <${Switch} on=${set.needToKnow} label="Need-to-know messages" onChange=${(v) => setS({ needToKnow: v })} /><//>
    <${Row} label="Remove agent credits when merging" hint="Strips the co-author lines agents add to their commits.">
      <${Switch} on=${set.removeCredits} label="Remove agent credits when merging" onChange=${(v) => setS({ removeCredits: v })} /><//>
  </div>`;
}
function Remote({ s }) {
  const set = s.settings;
  const [f, setF] = useState({ webEnabled: set.webEnabled, port: set.port, checkIn: set.checkIn, proxyMode: set.proxyMode, publicAddress: set.publicAddress });
  const dirty = Object.keys(f).some((k) => f[k] !== set[k]);
  const bad = f.proxyMode && !/^https:\/\/\S+\.\S+/.test(f.publicAddress.trim()) ? (f.publicAddress.trim() ? 'The public address must start with https://. Plain HTTP is refused.' : 'Give the address your proxy serves.') : null;
  const badPort = !(f.port >= 1024 && f.port <= 65535) ? 'Use a port from 1024 to 65535.' : null;
  const save = () => { if (bad || badPort || !dirty) return; const portChanged = f.port !== set.port; setS({ ...f, publicAddress: f.publicAddress.trim() }); act.toast(portChanged ? 'Saved. The new port applies at the next start.' : 'Saved. Web connections were closed and reopened.'); };
  const master = s.machines.find((m) => m.role === 'master');
  const fwd = `ssh -L ${f.port}:127.0.0.1:${f.port} ${master.name.toLowerCase()}`;
  return html`<form onSubmit=${(e) => { e.preventDefault(); save(); }}>
    <div class="svc-rows">
      <${Row} label="Web page" hint="Turn it off to use LGTM Studio from the terminal only."><${Switch} on=${f.webEnabled} label="Web page" onChange=${(v) => setF({ ...f, webEnabled: v })} /><//>
      <${Row} label="Listens on" hint="This computer only. The service never listens on the network.">
        <span class="row" style="gap:6px"><span class="svc-fixed mono">http://127.0.0.1:</span><input class="input num-field mono" type="number" aria-label="Port" value=${f.port} onInput=${(e) => setF({ ...f, port: +e.target.value })} /></span>
        ${badPort && html`<span class="svc-err">${badPort}</span>`}<//>
      <${Row} label="Check-in" id="ra-check" hint="How often the page asks the service whether it is alive."><span class="row" style="gap:6px"><input id="ra-check" class="input num-field" type="number" min="5" max="120" value=${f.checkIn} onInput=${(e) => setF({ ...f, checkIn: +e.target.value })} /><span class="muted">seconds</span></span><//>
      <${Row} label="Behind your HTTPS proxy" hint="Turn on when a proxy such as Caddy serves this page over HTTPS."><${Switch} on=${f.proxyMode} label="Behind your HTTPS proxy" onChange=${(v) => setF({ ...f, proxyMode: v })} /><//>
      ${f.proxyMode && html`<${Row} label="Public address" id="ra-addr" hint="Phone alerts link to a thread through this address.">
        <input id="ra-addr" class="input mono" value=${f.publicAddress} onInput=${(e) => setF({ ...f, publicAddress: e.target.value })} placeholder="https://lgtm.home.example" spellcheck="false" autocapitalize="off" />
        ${bad && f.publicAddress.trim() && html`<span class="svc-err">${bad}</span>`}<//>`}
      ${!f.proxyMode && html`<${Row} label="From another device" hint="Until a proxy is set up, forward the port over Secure Shell (SSH)." top>
        <${Command} text=${fwd} /><span class="svc-hint">Then open <span class="mono">http://127.0.0.1:${f.port}</span> on that device.</span><//>`}
    </div>
    <div class="svc-save"><button type="submit" class="btn primary" disabled=${!dirty || !!bad || !!badPort}>Save</button>
      ${dirty && html`<button type="button" class="btn ghost" onClick=${() => setF({ webEnabled: set.webEnabled, port: set.port, checkIn: set.checkIn, proxyMode: set.proxyMode, publicAddress: set.publicAddress })}>Discard</button>`}
      <span class="muted" style="font-size:var(--text-sm)">${!dirty ? 'No unsaved changes.' : bad || badPort ? 'Fix the marked field to save.' : 'Saving closes open web connections. They reconnect on their own.'}</span></div>
  </form>`;
}
function StallWatch({ s }) {
  const set = s.settings; const off = !set.stallWatch;
  return html`<div class="svc-rows">
    <${Row} label="Stall watch" hint="The part of the service that keeps every agent moving without spending its turns. It never decides what the work is.">
      <${Switch} on=${set.stallWatch} label="Stall watch" onChange=${(v) => setS({ stallWatch: v })} /><//>
    <div class=${cx('svc-group', off && 'svc-off')}>
      <h3>When an agent may be stuck</h3>
      <${Row} label="Assigned, not started" id="sd-a"><${Num} id="sd-a" value=${set.stallAssigned} min=${1} max=${120} unit="minutes" onChange=${(v) => setS({ stallAssigned: v })} /><//>
      <${Row} label="Worker, no output" id="sd-w"><${Num} id="sd-w" value=${set.stallWorker} min=${1} max=${120} unit="minutes" onChange=${(v) => setS({ stallWorker: v })} /><//>
      <${Row} label="Lead, no output" id="sd-l"><${Num} id="sd-l" value=${set.stallLead} min=${1} max=${240} unit="minutes" onChange=${(v) => setS({ stallLead: v })} /><//>
      <${Row} label="Wake it once first" hint="A stuck agent gets one wake. Ten minutes later its lead is told. A stuck lead goes to the project lead, and a stuck project lead comes to you.">
        <${Switch} on=${set.autoNudge} label="Wake it once first" onChange=${(v) => setS({ autoNudge: v })} /><//>
      <${Row} label="Replace the worker" id="sd-r" hint="After this many stalls in a row on the same work."><${Num} id="sd-r" value=${set.replaceAfter} min=${1} max=${9} unit="stalls" onChange=${(v) => setS({ replaceAfter: v })} /><//>
      <h3>When a subscription or an agent fails</h3>
      <${Row} label="Wait after a usage limit" id="sd-c"><${Num} id="sd-c" value=${set.capacityBackoff} min=${1} max=${120} unit="minutes" onChange=${(v) => setS({ capacityBackoff: v })} /><//>
      <${Row} label="Try again" id="sd-cr" hint="Then the agent stops and the failure comes to you."><${Num} id="sd-cr" value=${set.capacityRetries} min=${0} max=${99} unit="times" onChange=${(v) => setS({ capacityRetries: v })} /><//>
      <${Row} label="Restart after a crash" id="sd-x"><${Num} id="sd-x" value=${set.crashRetries} min=${0} max=${9} unit="times" onChange=${(v) => setS({ crashRetries: v })} /><//>
      <${Row} label="Close an idle team" id="sd-i" hint="A team with no work for this long is stopped. Its branch stays."><${Num} id="sd-i" value=${set.teamIdle} min=${5} max=${1440} unit="minutes" onChange=${(v) => setS({ teamIdle: v })} /><//>
      <h3>Approvals</h3>
      <${Row} label="Standing permission rules" hint=${'"Always allow" stores a rule. Later requests that match it are allowed without asking.'}>
        <${Switch} on=${set.standingRules} label="Standing permission rules" onChange=${(v) => setS({ standingRules: v })} /><//>
    </div>
  </div>`;
}
function WorkflowSettings({ s }) {
  const set = s.settings; const [checked, setChecked] = useState(null);
  return html`<div class="svc-rows">
    <${Row} label="Workflow" hint="LGTM Studio ships one workflow. Override it for every repository, or for one.">
      <span class="row"><b style="font-weight:var(--weight-medium)">Build loop</b><span class="badge outline">Default</span></span><//>
    <${Row} label="Your overrides" id="wf-path" hint="Files here replace the default workflow for every repository." top>
      <span class="row"><input id="wf-path" class="input mono grow" value=${set.workflowPath} onInput=${(e) => setS({ workflowPath: e.target.value })} spellcheck="false" />
        <button type="button" class="btn" onClick=${() => { setChecked('loading'); setTimeout(() => setChecked(Date.now()), 600); }}>${checked === 'loading' ? 'Checking…' : 'Check again'}</button></span>
      <ul class="svc-lines" style="margin-top:8px">
        <li><${Icon} name="circle" size=${14} class="faint" /><span class="mono">${set.workflowPath}/workflow.md</span><span class="muted">Not found. The default is used.</span></li>
        <li><${Icon} name="circle-check" size=${14} class="success-text" /><span class="mono">${set.workflowPath}/roles/reviewer.md</span><span class="muted">Replaces the Reviewer's instructions.</span></li>
      </ul>${checked && checked !== 'loading' && html`<span class="svc-hint">Checked at ${clock(checked)}. Nothing changed.</span>`}<//>
    <${Row} label="One repository" hint="A .lgtm folder in a repository wins over your overrides." top>
      <ul class="svc-lines">${s.repos.map((r) => html`<li key=${r.id}><${Icon} name="folder-git-2" size=${14} class="faint" /><a class="link mono" href=${href('/r/' + r.id)}>${r.name}</a>
        <span class="muted">${r.id === 'billing-api' ? '.lgtm/workflow.md turns agent review off' : 'No .lgtm folder'}</span></li>`)}</ul><//>
    <${Row} label="Write tests first" hint="New projects start with tests on. A project lead can turn them off when you say so."><${Switch} on=${set.testsDefault} label="Write tests first" onChange=${(v) => setS({ testsDefault: v })} /><//>
    <${Row} label="Agent review" hint="Reviewers score each change in rounds."><${Switch} on=${set.reviewDefault} label="Agent review" onChange=${(v) => setS({ reviewDefault: v })} /><//>
    <${Row} label="Review rounds" id="wf-r" hint="A minor finding scores 1 point, a major 3, and a blocker 9."><${Num} id="wf-r" value=${set.maxRounds} min=${1} max=${12} unit="at most" onChange=${(v) => setS({ maxRounds: v })} /><//>
  </div>`;
}
function GitMessages({ s }) {
  const set = s.settings; const m = set.gitModel || 'Haiku 5.5'; const h = harnessOfModel(m) || 'claude';
  const signed = new Set(s.subscriptions.filter((x) => x.signedIn).map((x) => x.harness));
  return html`<div class="svc-rows">
    <${Row} label="Model" id="gm-model" hint="Writes commit messages from the staged diff, and pull request titles and descriptions from the commits.">
      <select id="gm-model" class="select" style="width:240px" value=${m} onChange=${(e) => setS({ gitModel: e.target.value })}>
        ${Object.entries(HARNESSES).map(([id, x]) => html`<optgroup label=${x.name + (signed.has(id) ? '' : ' (signed out)')}>${x.models.map((mo) => html`<option value=${mo} disabled=${!signed.has(id)}>${mo}</option>`)}</optgroup>`)}</select><//>
    <${Row} label="Runs on"><span>${HARNESSES[h].name}</span><//>
    <${Row} label="Commit message"><span class="row" style="gap:6px"><span class="badge outline">Conventional commit</span><span class="badge outline">One line</span><span class="badge outline">No attribution</span></span><//>
    <${Row} label="Pull request title" id="gm-limit"><span class="row" style="gap:6px"><span class="num">${act.PR_TITLE_LIMIT}</span><span class="muted">characters at most</span></span><//>
    <${Row} label="Example" top><pre class="code svc-example">${act.commitMessage(['packages/web/src/shell/Sidebar.tsx', 'packages/web/src/shell/NavRail.tsx'])}</pre><//>
  </div>`;
}
function About({ s }) {
  const set = s.settings; const [chk, setChk] = useState(null); const master = s.machines.find((m) => m.role === 'master');
  return html`<div class="svc-rows">
    <${Row} label="Version"><span class="row"><b style="font-weight:var(--weight-medium)">LGTM Studio ${set.version}</b><span class="tag">${set.commit}</span>
      <button type="button" class="btn sm" onClick=${() => { setChk('loading'); setTimeout(() => setChk('done'), 900); }}>${chk === 'loading' ? 'Checking…' : 'Check for an update'}</button>
      ${chk === 'done' && html`<span class="row success-text" style="gap:4px;font-size:var(--text-sm)"><${Icon} name="check" size=${13} />Up to date</span>`}</span><//>
    <${Row} label="Service"><span class="row" style="gap:6px"><i class=${cx('dot', s.conn.status === 'live' ? 'working' : 'waiting')}></i>${s.conn.status === 'live' ? `Running on ${master.name}` : 'Not answering'}<span class="muted">· Node.js 26</span></span><//>
    <${Row} label="Data folder"><span class="mono">${set.dataFolder}</span><//>
    <${Row} label="Machines"><a class="link" href=${href('/machines')}>${s.machines.filter((m) => m.status === 'online').length} of ${s.machines.length} online</a><//>
    <${Row} label="Licence"><span>Apache License 2.0</span><//>
    <${Row} label="Restart the service" hint="Agents keep their place. Web connections close and reconnect.">
      <button type="button" class="btn" onClick=${() => act.confirm({ title: 'Restart the service?', body: 'Agents stop at the end of their turn and resume after the restart. This page reconnects on its own.', action: 'Restart', danger: false,
        onConfirm: () => { act.setConnection('reconnecting'); setTimeout(() => { act.setConnection('live'); act.toast('The service restarted'); }, 2400); } })}><${Icon} name="rotate-ccw" size=${13} />Restart</button><//>
  </div>`;
}
const SECTIONS = [
  ['appearance', 'Appearance', 'palette', Appearance, 'How this page looks on this browser.'],
  ['defaults', 'Defaults', 'sliders-horizontal', Defaults, 'What a new agent starts with.'],
  ['remote', 'Remote access', 'wifi', Remote, 'How this page is reached from other devices.'],
  ['stall-watch', 'Stall watch', 'timer', StallWatch, 'Watching for agents that stop moving.'],
  ['workflow', 'Workflow', 'workflow', WorkflowSettings, 'The build loop and where you override it.'],
  ['git', 'Git messages', 'git-commit-horizontal', GitMessages, 'The model that writes commit and pull request messages.'],
  ['about', 'About', 'info', About, 'The version and the service.'],
];
export function ServiceSettings({ s, route }) {
  const want = route.query.get('section');
  useEffect(() => { if (want === 'notifications') go('/notifications'); }, [want]);
  const cur = SECTIONS.find((x) => x[0] === want) || SECTIONS[0]; const Body = cur[3];
  return html`<div class="view-body"><div class="svc-settings">
    <nav class="svc-nav" aria-label="Settings sections">${SECTIONS.map(([id, label, icon]) => html`<a key=${id} class="nav-item" href=${href('/settings?section=' + id)} aria-current=${cur[0] === id ? 'page' : null}><${Icon} name=${icon} size=${15} /><span>${label}</span></a>`)}
      <span class="svc-nav-sep"></span>
      <a class="nav-item" href=${href('/notifications')}><${Icon} name="smartphone" size=${15} /><span>Phone notifications</span><${Icon} name="arrow-up-right" size=${12} class="faint" /></a></nav>
    <div class="svc-pane" data-main>
      <div class="page-head"><h1 class="page-title">${cur[1]}</h1><span class="sub">${cur[4]}</span><${Saved} s=${s} /></div>
      <${Body} key=${cur[0]} s=${s} />
    </div>
  </div></div>`;
}

// ---- one project's settings --------------------------------------------------------
export function ProjectSettings({ s, project: p }) {
  const r = repoOf(s, p); const m = machineOf(s, p.machine); const lead = agentOf(s, p.lead); const ags = agentsOfProject(s, p.id); const teams = teamsOf(s, p.id);
  const [goal, setGoal] = useState(p.goal);
  useEffect(() => setGoal(p.goal), [p.id]);
  const perms = [...new Set(ags.map((a) => a.permission))]; const perm = perms.length === 1 ? perms[0] : null;
  const set = (patch) => { update(() => { Object.assign(p, patch); }); markSaved(); };
  const branches = [...new Set([r.main, 'develop', 'release/next'])];
  const subs = s.subscriptions.filter((x) => x.machine === p.machine || x.id === lead.subscription);
  const running_ = ags.filter(running).length;
  const rename = () => act.openDialog({ type: 'rename', title: 'Rename project', value: p.name, taken: s.projects.filter((x) => x.repo === p.repo).map((x) => x.name), note: 'The branch and the folder keep their names.', onRename: (v) => { update(() => { p.name = v; }); act.toast('Project renamed'); } });
  const archive = () => act.confirm({ title: `Archive ${p.name}?`, body: 'The project leaves the sidebar and its agents stop. Its branch, worktrees and threads are kept, and you can restore it.', action: 'Archive project', danger: false,
    lost: [running_ ? `${plural(running_, 'running agent')} will stop` : null, openRequests(s, { project: p.id }).length ? `${plural(openRequests(s, { project: p.id }).length, 'open request')} will be hidden` : null].filter(Boolean),
    onConfirm: () => { act.archiveProject(p.id); go('/r/' + r.id); } });
  const del = () => act.confirm({ title: `Delete ${p.name}?`, body: 'This cannot be undone.', action: 'Delete project',
    lost: [`${plural(ags.length, 'agent')} and ${ags.length === 1 ? 'its thread' : 'their threads'}`, `${plural(1 + teams.length, 'worktree')} under ${p.folder}`, p.merged ? null : `The branch ${p.branch} and its unmerged commits`, `${plural(s.sprints.filter((x) => x.project === p.id).length, 'sprint')} and ${plural(s.tasks.filter((x) => x.project === p.id).length, 'task')}`].filter(Boolean),
    onConfirm: () => { const id = p.id; go('/r/' + r.id);
      update((st) => { const ch = new Set(st.channels.filter((c) => c.project === id).map((c) => c.id));
        for (const k of ['projects']) st[k] = st[k].filter((x) => x.id !== id);
        for (const k of ['agents', 'teams', 'sprints', 'tasks', 'requests', 'channels']) st[k] = st[k].filter((x) => x.project !== id);
        st.posts = st.posts.filter((x) => !ch.has(x.channel)); st.notifications = st.notifications.filter((n) => n.project !== id); });
      act.toast(`Deleted ${p.name}`); } });
  const signed = new Set(s.subscriptions.filter((x) => x.signedIn && x.enabled).map((x) => x.harness));
  const asg = p.assignment || { state: 'proposed', rows: proposeAssignment(s), changed: [] };
  const saveAsg = (next) => { update(() => { p.assignment = next; }); markSaved(); };
  const setRow = (k, patch) => { const row = { ...asg.rows[k], ...patch };
    if (patch.harness) { row.model = HARNESSES[patch.harness].models[0]; }
    row.effort = hasEffort(row.harness, row.model) ? row.effort || 'Medium' : null;
    saveAsg({ ...asg, rows: { ...asg.rows, [k]: row }, changed: [...new Set([...(asg.changed || []), k])] }); };
  const [allModel, setAllModel] = useState(() => asg.rows.Plan.model);
  const applyAll = () => { const h = harnessOfModel(allModel); const rows = {}; for (const k of WORK_KINDS) rows[k] = { harness: h, model: allModel, effort: hasEffort(h, allModel) ? asg.rows[k].effort || 'Medium' : null };
    saveAsg({ ...asg, rows, changed: [...WORK_KINDS] }); act.toast(`Every row uses ${allModel}`); };
  const approve = () => { saveAsg({ ...asg, state: 'approved' }); act.toast('Assignment approved. The project lead was told.'); };
  const setPerm = (v) => { update((st) => { for (const a of st.agents) if (a.project === p.id) a.permission = v; }); markSaved(); };
  const setTeam = (t, patch) => { update((st) => { for (const a of agentsOfTeam(st, t.id)) { if (patch.harness && patch.harness !== a.harness) { const hs = HARNESSES[patch.harness]; const sub = st.subscriptions.find((x) => x.harness === patch.harness && x.signedIn && x.machine === p.machine) || st.subscriptions.find((x) => x.harness === patch.harness && x.signedIn); a.harness = patch.harness; a.subscription = sub ? sub.id : a.subscription; a.model = hs.models[0]; a.effort = 'Medium'; } if (patch.model) a.model = patch.model; } if ('needToKnow' in patch) byId(st.teams, t.id).needToKnow = patch.needToKnow; }); markSaved(); };
  return html`<div class="page svc-project">
    <div class="page-head"><h1 class="page-title">Project settings</h1>${p.archived && html`<span class="badge">Archived</span>`}<${Saved} s=${s} /></div>
    ${p.archived && html`<div class="callout" style="align-items:center;margin-bottom:var(--space-3);max-width:860px"><${Icon} name="archive" size=${15} /><span class="grow">This project is archived. Its agents are stopped.</span><button type="button" class="btn sm" onClick=${() => act.archiveProject(p.id, false)}><${Icon} name="archive-restore" size=${13} />Restore</button></div>`}
    <${Section} title="Project">
      <div class="svc-rows">
        <${Row} label="Name"><span class="row"><b style="font-weight:var(--weight-medium)">${p.name}</b><span class="tag" data-tip="Task labels start with this">${p.prefix}</span><button type="button" class="btn sm" onClick=${rename}><${Icon} name="pencil" size=${12} />Rename</button></span><//>
        <${Row} label="Goal" id="ps-goal" hint="The project lead reads this at the start of every turn." top>
          <textarea id="ps-goal" class="textarea" rows="3" value=${goal} onInput=${(e) => setGoal(e.target.value)}></textarea>
          ${goal.trim() !== p.goal && html`<span class="row" style="margin-top:6px"><button type="button" class="btn sm primary" disabled=${!goal.trim()} onClick=${() => { set({ goal: goal.trim() }); act.toast('Goal saved. The project lead was told.'); }}>Save goal</button><button type="button" class="btn sm ghost" onClick=${() => setGoal(p.goal)}>Discard</button></span>`}<//>
      </div>
    <//>
    <${Section} title="Repository and machine">
      <div class="svc-rows">
        <${Row} label="Repository"><span class="row"><a class="link mono" href=${href('/r/' + r.id)}>${r.name}</a><span class="muted mono truncate">${r.remote || 'No remote'}</span></span><//>
        <${Row} label="Base branch" id="ps-base" hint="Finished work merges into this branch, with your approval.">
          <select id="ps-base" class="select mono" style="width:300px" value=${p.base || r.main} onChange=${(e) => set({ base: e.target.value })}>${branches.map((b) => html`<option value=${b}>${b}${b === r.main ? ' (repository default)' : ''}</option>`)}</select><//>
        <${Row} label="Project branch"><span class="mono">${p.branch}</span><//>
        <${Row} label="Folder"><span class="mono" style="overflow-wrap:anywhere">${p.folder}</span><//>
        <${Row} label="Runs on" id="ps-machine" hint="New agents start here. Running agents stay where they are.">
          <select id="ps-machine" class="select" style="width:300px" value=${p.machine} onChange=${(e) => { const v = e.target.value; set({ machine: v, folder: `${r.folders[v]}/.worktrees/${p.branch.split('/').pop()}` }); }}>
            ${s.machines.map((x) => html`<option value=${x.id} disabled=${x.status !== 'online' || !r.folders[x.id]}>${x.name}${x.status !== 'online' ? ' (offline)' : !r.folders[x.id] ? ` (${r.name} is not on it)` : ''}</option>`)}</select>
          ${m.status !== 'online' && html`<span class="svc-err">${m.name} is offline.</span>`}<//>
        <${Row} label="Lead subscription" id="ps-sub" hint="The project lead runs on this subscription." top>
          <div class="svc-lead">
            <select id="ps-sub" class="select" value=${lead.subscription} onChange=${(e) => { const x = subOf(s, e.target.value); update(() => { lead.subscription = x.id; if (lead.harness !== x.harness) { lead.harness = x.harness; lead.model = HARNESSES[x.harness].models[0]; lead.effort = hasEffort(x.harness, lead.model) ? 'High' : null; } }); markSaved(); }}>
              ${subs.map((x) => html`<option value=${x.id} disabled=${!x.signedIn}>${subLabel(s, x.id)}${!x.signedIn ? ' (signed out)' : x.usage ? ` · ${x.usage.pct}% used` : ''}</option>`)}</select>
            <select class="select" aria-label="Lead model" value=${lead.model} onChange=${(e) => { const v = e.target.value; update(() => { lead.model = v; lead.effort = hasEffort(lead.harness, v) ? lead.effort || 'High' : null; }); markSaved(); }}>
              ${HARNESSES[lead.harness].models.map((mo) => html`<option value=${mo}>${mo}</option>`)}</select>
            ${hasEffort(lead.harness, lead.model)
              ? html`<select class="select" aria-label="Lead effort" value=${lead.effort || 'High'} onChange=${(e) => { const v = e.target.value; update(() => { lead.effort = v; }); markSaved(); }}>${HARNESSES[lead.harness].efforts.map((x) => html`<option value=${x}>${x}</option>`)}</select>`
              : html`<span class="muted svc-noeffort">No effort setting</span>`}
          </div><//>
      </div>
    <//>
    <${Section} title="Agents" sub=${`${ags.length} in this project`}>
      <div class="svc-rows">
        <${Row} label="Permission" hint=${perm ? 'Applies to every agent in this project.' : 'The agents differ today. Choosing one sets it for all of them.'} top>
          <${PermissionPicker} name="ps-perm" value=${perm} onChange=${setPerm} /><//>
        <${Row} label="Write tests first" hint="Tests are written before the code, and they must fail first."><${Switch} on=${p.tests === 'on'} label="Write tests first" onChange=${(v) => set({ tests: v ? 'on' : 'off' })} /><//>
        <${Row} label="Agent review" hint="Reviewers score each change in rounds before it reaches you."><${Switch} on=${p.agentReview === 'on'} label="Agent review" onChange=${(v) => set({ agentReview: v ? 'on' : 'off' })} /><//>
        <${Row} label="Remove agent credits when merging" hint="Strips the co-author lines agents add to their commits."><${Switch} on=${p.removeCredits ?? s.settings.removeCredits} label="Remove agent credits when merging" onChange=${(v) => set({ removeCredits: v })} /><//>
      </div>
    <//>
    <${Section} title="Assignment" sub=${asg.state === 'approved' ? 'Approved by you' : `Proposed by the project lead`}
      action=${asg.state !== 'approved' && html`<button type="button" class="btn sm" onClick=${approve}><${Icon} name="check" size=${13} />Approve</button>`}>
      <div class="table-wrap svc-assign"><table class="table"><thead><tr><th>Work</th><th>Harness</th><th>Model</th><th>Effort</th></tr></thead>
        <tbody>${WORK_KINDS.map((k) => { const row = asg.rows[k]; const h = HARNESSES[row.harness];
          return html`<tr key=${k} class=${cx(asg.changed?.includes(k) && 'changed')}>
            <td><b style="font-weight:var(--weight-medium)">${k}</b></td>
            <td><select class="select" aria-label=${k + ' harness'} value=${row.harness} onChange=${(e) => setRow(k, { harness: e.target.value })}>
              ${Object.entries(HARNESSES).map(([id, x]) => html`<option value=${id} disabled=${!signed.has(id)}>${x.name}${signed.has(id) ? '' : ' (signed out)'}</option>`)}</select></td>
            <td><select class="select" aria-label=${k + ' model'} value=${row.model} onChange=${(e) => setRow(k, { model: e.target.value })}>${h.models.map((mo) => html`<option value=${mo}>${mo}</option>`)}</select></td>
            <td>${hasEffort(row.harness, row.model)
              ? html`<select class="select" aria-label=${k + ' effort'} value=${row.effort || 'Medium'} onChange=${(e) => setRow(k, { effort: e.target.value })}>${h.efforts.map((x) => html`<option value=${x}>${x}</option>`)}</select>`
              : html`<span class="muted">None</span>`}</td></tr>`; })}</tbody></table></div>
      <div class="svc-assign-all row">
        <label for="ps-all" class="muted">Every row</label>
        <select id="ps-all" class="select" value=${allModel} onChange=${(e) => setAllModel(e.target.value)}>
          ${Object.entries(HARNESSES).filter(([id]) => signed.has(id)).map(([id, x]) => html`<optgroup label=${x.name}>${x.models.map((mo) => html`<option value=${mo}>${mo}</option>`)}</optgroup>`)}</select>
        <button type="button" class="btn sm" onClick=${applyAll}>Apply</button>
      </div>
    <//>
    <${Section} title="Teams" sub=${teams.length ? null : 'None yet'}>
      <div class="table-wrap svc-teams"><table class="table"><thead><tr><th>Team</th><th class="c-mid">Agents</th><th>Branch</th><th>Need-to-know</th></tr></thead>
        <tbody>${teams.length === 0 && html`<tr><td colspan="4" class="muted" data-empty>No teams</td></tr>`}
        ${teams.map((t) => { const ta = agentsOfTeam(s, t.id);
          return html`<tr key=${t.id}>
            <td><a class="link" href=${href(`/p/${p.id}/team/${t.id}`)}>${teamName(t)}</a></td>
            <td class="c-mid"><span class="row" style="gap:3px">${ta.map((a) => html`<a key=${a.id} href=${href(routeForAgent(s, a))} data-tip=${a.name}><${Avatar} agent=${a} s=${s} size="sm" /></a>`)}</span></td>
            <td class="mono muted truncate">${t.branch}</td>
            <td><${Switch} on=${t.needToKnow} label=${'Need-to-know for ' + teamName(t)} onChange=${(v) => setTeam(t, { needToKnow: v })} /></td></tr>`; })}</tbody></table></div>
    <//>
    <${Section} title="Archive or delete">
      <div class="svc-rows svc-danger">
        ${p.archived
          ? html`<${Row} label="Restore this project" hint="It returns to the sidebar. Its agents stay stopped until you resume them."><button type="button" class="btn" onClick=${() => act.archiveProject(p.id, false)}><${Icon} name="archive-restore" size=${13} />Restore</button><//>`
          : html`<${Row} label="Archive this project" hint="Stops its agents and hides it. Nothing is deleted."><button type="button" class="btn" onClick=${archive}><${Icon} name="archive" size=${13} />Archive</button><//>`}
        <${Row} label="Delete this project" hint="Removes its agents, threads, worktrees and branch."><button type="button" class="btn danger" onClick=${del}><${Icon} name="trash-2" size=${13} />Delete</button><//>
      </div>
    <//>
  </div>`;
}
