// The Mocks tab of a project. It follows the Workflow tab's pattern: one secondary tab row,
// the same page padding, and the same structure when there is nothing in it yet.
// A mock screen here is drawn from the same tokens and parts as the page itself.
import { html, useState, useRef, useLayoutEffect, Icon, cx, href, go, ago, clock, useNow, plural, update, uid, MIN, HOUR, DAY } from '../lib.js';
import { byId, agentOf, projectOf, repoOf, leadOf, threadOf, routeForAgent } from '../data.js';
import * as act from '../actions.js';
import { Avatar, OwnerAvatar, Dialog, registerDialog, Empty } from '../ui.js';
import { useCanvas, Canvas, ZoomControls } from './design.js';

const VIEWPORTS = { phone: [390, 780], desktop: [1180, 780] };
const STATUS = { draft: ['', 'Draft'], changed: ['warn', 'Changed'], approved: ['success', 'Approved'] };

// ---- the drawn screens ---------------------------------------------------------------
const ROWS = [
  ['Question', 'Where should an agent\'s thread open?', 'Build lead · Agent console', '18 min'],
  ['Approval', 'Run the web tests', 'Builder 2 · Agent console', '6 min'],
  ['Approval', 'Read the review trace', 'Reviewer · Agent console', '2 min'],
  ['Merge', 'Merge docs/api-reference into main', 'Project lead · API reference', '1 hr 25 min'],
  ['Question', 'Statement 7 is stuck. Keep, change or drop it?', 'Planning lead · Standing permission rules', '34 min'],
];
function PhoneTabs({ at }) {
  return html`<nav class="mu-tabs">${[['bell', 'Requests'], ['kanban', 'Projects'], ['settings', 'Settings']].map(([i, l]) => html`<span key=${l} class=${cx(at === l && 'on')}><${Icon} name=${i} size=${18} />${l}</span>`)}</nav>`;
}
function RequestBody({ before }) {
  return html`<div class="mu-req">
    <span class="mu-kind">Approval</span><h4>Run the web tests</h4>
    <dl><dt>Command</dt><dd>pnpm --filter @lgtm/web test</dd><dt>Folder</dt><dd>~/projects/lgtm-studio/.worktrees/agent-console-shell</dd></dl>
    <p class="mu-agent"><span class="avatar sm"><${Icon} name="hammer" size=${12} /></span><b>Builder 2</b><span>Build team · Shell</span><span class="grow"></span><span>Waiting 6 min</span></p>
    <div class="mu-actions"><span class="btn primary lg">Allow</span>${!before && html`<span class="btn lg">Always allow</span>`}<span class="btn lg ghost">Deny</span></div>
  </div>`;
}
function ListUI({ before }) {
  return html`<div class="mu mu-split">
    <div class="mu-main">
      <header class="mu-bar"><b>Requests</b><span class="count warn">5</span><span class="grow"></span><${Icon} name="search" size=${18} /></header>
      ${!before && html`<div class="mu-chips"><span class="on">All 5</span><span>Questions 2</span><span>Approvals 2</span><span>Merges 1</span></div>`}
      <ul class="mu-list">${ROWS.map((r, i) => html`<li key=${i} class=${cx(i === 1 && 'sel')}><span class="mu-kind">${r[0]}</span>${!before && html`<time>${r[3]}</time>`}<b>${r[1]}</b><span>${r[2]}</span></li>`)}</ul>
      <${PhoneTabs} at="Requests" />
    </div>
    <div class="mu-side"><${RequestBody} before=${before} /></div>
  </div>`;
}
function RequestUI({ before }) {
  return html`<div class="mu"><div class="mu-main">
    <header class="mu-bar"><${Icon} name="chevron-left" size=${20} /><b>Request</b><span class="grow"></span><span class="mu-of">2 of 5</span></header>
    <${RequestBody} before=${before} />
    <${PhoneTabs} at="Requests" />
  </div></div>`;
}
function SettingsUI() {
  const rows = [['An agent asks you a question', 'Sent at once.', true], ['An approval has waited 10 minutes', 'One alert for each approval.', true], ['A stalled agent reached you', 'Only after its lead could not help.', true], ['A full run failed', 'Nightly runs are in the morning summary.', false]];
  return html`<div class="mu"><div class="mu-main">
    <header class="mu-bar"><b>Notifications</b></header>
    <div class="mu-form">
      <h5>Alerts on this phone</h5>
      ${rows.map(([t, h, on]) => html`<div class="mu-set" key=${t}><div><b>${t}</b><span>${h}</span></div><span class="switch" aria-checked=${on}></span></div>`)}
      <h5>Quiet hours</h5>
      <div class="mu-set"><div><b>22:00 to 07:00</b><span>Failed starts still come through.</span></div><${Icon} name="chevron-right" size=${16} /></div>
      <h5>Server</h5>
      <div class="mu-set"><div><b>ntfy.example.net</b><span>Topic lgtm-owner · last alert 6 min ago</span></div><span class="badge success">Connected</span></div>
    </div>
    <${PhoneTabs} at="Settings" />
  </div></div>`;
}
function BoardUI() {
  const cols = [['Planned', [['SP-05', 'Project board'], ['SP-06', 'Git and merge review']]], ['In progress', [['FX-01', 'Fix the flaky reconnect test'], ['SP-03', 'Sidebar and attention'], ['SP-02', 'Thread view']]], ['Review', [['SP-04', 'Narrow-screen pass']]], ['Done', [['SP-01', 'Navigation foundation']]]];
  return html`<div class="mu"><div class="mu-main">
    <header class="mu-bar"><b>Agent console</b><span class="badge info">Build</span><span class="grow"></span><${Icon} name="message-square" size=${18} /></header>
    <div class="mu-board">${cols.map(([c, cards]) => html`<section key=${c}><h5>${c} <span>${cards.length}</span></h5>${cards.map(([l, n], i) => html`<div class="mu-card" key=${l}><span class="tag">${l}</span><b>${n}</b><div class="progress"><i style=${{ width: (c === 'Done' ? 100 : c === 'Planned' ? 0 : 30 + i * 22) + '%' }}></i></div></div>`)}</section>`)}</div>
    <${PhoneTabs} at="Projects" />
  </div></div>`;
}
function ChatUI() {
  return html`<div class="mu"><div class="mu-main">
    <header class="mu-bar"><${Icon} name="chevron-left" size=${20} /><span class="avatar sm lead"><${Icon} name="crown" size=${12} /></span><b>Project lead</b><span class="grow"></span><span class="mu-of">Waiting on 3</span></header>
    <div class="mu-thread">
      <p class="me">Good. Start the shell and threads teams. Keep the review team small.</p>
      <p>Started <b>Build team · Shell</b> and <b>Build team · Threads</b>, with one reviewer in the Review team.</p>
      <p>Three things need you before the shell team can finish.</p>
      <div class="mu-mini"><span class="mu-kind">Question</span><b>Where should an agent's thread open?</b></div>
      <div class="mu-mini"><span class="mu-kind">Approval</span><b>Run the web tests</b></div>
    </div>
    <div class="mu-compose"><span>Message the project lead…</span><i><${Icon} name="arrow-up" size=${15} /></i></div>
  </div></div>`;
}
const DRAW = { list: ListUI, request: RequestUI, settings: SettingsUI, board: BoardUI, chat: ChatUI };

// A screen at its real size, scaled to fit the space it is given.
function Frame({ kind, viewport = 'phone', before, fit = 'width', max = 1 }) {
  const box = useRef(null); const [k, setK] = useState(0); const [w, h] = VIEWPORTS[viewport]; const UI = DRAW[kind] || ListUI;
  useLayoutEffect(() => {
    const el = box.current; const measure = () => { const r = el.getBoundingClientRect(); if (r.width) setK(Math.max(.05, Math.min(max, r.width / w, fit === 'both' ? r.height / h : 9))); };
    measure(); const ro = new ResizeObserver(measure); ro.observe(el); return () => ro.disconnect();
  }, [w, h, fit, max]);
  return html`<div ref=${box} class=${cx('mk-box', fit)}>
    <div class="mk-fit" style=${{ width: w * k + 'px', height: h * k + 'px', visibility: k ? null : 'hidden' }}>
      <div class=${cx('mk-frame', viewport)} style=${{ width: w + 'px', height: h + 'px', transform: `scale(${k})` }} aria-hidden="true" inert>${html`<${UI} before=${before} />`}</div>
    </div>
  </div>`;
}

// ---- sample records ------------------------------------------------------------------
function blank() { return { approvedAt: null, screens: [], changes: [], data: [], components: [] }; }
// The live website gives every project an empty record until the engine holds one.
export const emptyMocks = () => blank();
function ensure(s, p) {
  s.mocks = s.mocks || {};
  if (!s.mocks[p.id]) { const m = blank(); if (p.hasMocks) m.screens.push({ id: 'first', name: 'First screen', kind: 'list', status: 'draft', rev: 1, updatedAt: Date.now(), note: 'The Designer is drawing this screen now.', comments: [] }); s.mocks[p.id] = m; }
  return s.mocks[p.id];
}
const COMPONENTS = [
  { name: 'Request block', real: true, uses: 9, on: ['Requests', 'Request'], demo: 'req' },
  { name: 'Button', real: true, uses: 14, on: ['Request', 'Notification settings'], demo: 'button' },
  { name: 'Switch', real: true, uses: 4, on: ['Notification settings'], demo: 'switch' },
  { name: 'Role avatar', real: true, uses: 7, on: ['Requests', 'Request'], demo: 'avatar' },
  { name: 'Badge', real: true, uses: 6, on: ['Requests', 'Notification settings'], demo: 'badge' },
  { name: 'Filter chips', real: false, uses: 1, on: ['Requests'], demo: 'chips', note: 'New in revision 3. Not in the repository yet.' },
  { name: 'Bottom tab bar', real: false, uses: 3, on: ['Requests', 'Request', 'Notification settings'], demo: 'tabs', note: 'The page has no phone tab bar today.' },
];
export function seedMocks(state) {
  const T = state.T; const at = (ms) => T - ms; const D = 'design-d1';
  state.mocks = {};
  state.mocks.phone = {
    approvedAt: null,
    screens: [
      { id: 'requests', name: 'Requests', kind: 'list', status: 'changed', rev: 3, updatedAt: at(52 * MIN), note: 'Filter chips above the list, and the wait on every row.', comments: [
        { from: 'owner', ts: at(2 * HOUR), text: 'I cannot tell which request has waited longest.' },
        { from: D, ts: at(52 * MIN), text: 'Revision 3 puts the wait on every row and sorts the oldest first. I also added filter chips, so a long list stays short.' }] },
      { id: 'request', name: 'Request', kind: 'request', status: 'changed', rev: 2, updatedAt: at(3 * HOUR), note: 'A third choice, Always allow.', comments: [
        { from: D, ts: at(3 * HOUR), text: 'Revision 2 adds Always allow. It makes a standing rule, so it depends on the Standing permission rules project.' }] },
      { id: 'notify', name: 'Notification settings', kind: 'settings', status: 'draft', rev: 1, updatedAt: at(4 * HOUR), note: 'The four alerts, quiet hours, and the server.', comments: [] },
    ],
    changes: [
      { id: 'c1', screen: 'requests', from: 2, to: 3, ts: at(52 * MIN), by: D, seen: false, compare: true, text: 'Added filter chips for questions, approvals and merges. Every row now shows how long it has waited.' },
      { id: 'c2', screen: 'request', from: 1, to: 2, ts: at(3 * HOUR), by: D, seen: false, compare: true, text: 'Added Always allow between Allow and Deny.' },
      { id: 'c3', screen: 'notify', from: 0, to: 1, ts: at(4 * HOUR), by: D, seen: true, text: 'First drawing of the screen.' },
    ],
    data: [
      { field: 'request.title', on: 'Requests, Request', sample: 'Run the web tests', schema: 'matches' },
      { field: 'request.kind', on: 'Requests, Request', sample: 'approval', schema: 'matches' },
      { field: 'request.createdAt', on: 'Requests, Request', sample: '6 min ago', schema: 'matches' },
      { field: 'request.command', on: 'Request', sample: 'pnpm --filter @lgtm/web test', schema: 'matches' },
      { field: 'request.folder', on: 'Request', sample: '~/projects/lgtm-studio/.worktrees/…', schema: 'matches' },
      { field: 'agent.role', on: 'Requests, Request', sample: 'Builder 2', schema: 'differs', note: 'The schema has no number. The mock adds one to tell builders apart.' },
      { field: 'request.rule', on: 'Request', sample: 'always', schema: 'new', note: 'Needs the Standing permission rules project.' },
      { field: 'alerts.stalledAgent', on: 'Notification settings', sample: 'on', schema: 'new', note: 'Phone alerts are not stored yet.' },
      { field: 'alerts.quietHours', on: 'Notification settings', sample: '22:00 to 07:00', schema: 'new', note: 'Phone alerts are not stored yet.' },
      { field: 'ntfy.lastAlert', on: 'Notification settings', sample: '6 min ago', schema: 'unavailable', note: 'No review was supplied for this field.' },
    ],
    components: COMPONENTS,
  };
  state.mocks.console = {
    approvedAt: at(3 * DAY + 2 * HOUR),
    screens: [
      { id: 'home', name: 'Home', kind: 'list', status: 'approved', rev: 4, updatedAt: at(3 * DAY + 3 * HOUR), note: 'Requests across every project, oldest first, with the wait on every row.', comments: [{ from: 'owner', ts: at(3 * DAY + 5 * HOUR), text: 'Put the wait on every row. I want to see the oldest request first.' }, { from: 'console-lead', ts: at(3 * DAY + 3 * HOUR), text: 'Done in revision 4. Every row shows its wait, and the oldest is first.' }] },
      { id: 'board', name: 'Project board', kind: 'board', status: 'approved', rev: 3, updatedAt: at(3 * DAY + 4 * HOUR), note: 'Sprints in four columns, with the lead beside them.', comments: [] },
      { id: 'thread', name: 'Agent thread', kind: 'chat', status: 'approved', rev: 2, updatedAt: at(3 * DAY + 6 * HOUR), note: 'One thread for each agent, with requests in line.', comments: [] },
      { id: 'request', name: 'Request', kind: 'request', status: 'approved', rev: 2, updatedAt: at(3 * DAY + 6 * HOUR), note: 'One block for questions, approvals, merges and failed starts.', comments: [] },
    ],
    changes: [
      { id: 'c1', screen: 'home', from: 3, to: 4, ts: at(3 * DAY + 3 * HOUR), by: 'console-lead', seen: true, compare: true, text: 'Request rows show their wait, and filters sit above the list.' },
      { id: 'c2', screen: 'board', from: 2, to: 3, ts: at(3 * DAY + 4 * HOUR), by: 'console-lead', seen: true, text: 'The lead chat moved into a panel on the right. The Board row left the tree.' },
    ],
    data: [
      { field: 'request.title', on: 'Home, Request', sample: 'Run the web tests', schema: 'matches' },
      { field: 'request.createdAt', on: 'Home, Request', sample: '6 min ago', schema: 'matches' },
      { field: 'sprint.column', on: 'Project board', sample: 'In progress', schema: 'matches' },
      { field: 'sprint.progress', on: 'Project board', sample: '2 of 4', schema: 'differs', note: 'The engine counts tasks. The mock shows a share.' },
      { field: 'agent.contextUse', on: 'Agent thread', sample: '34%', schema: 'unavailable', note: 'Some harnesses do not report it.' },
    ],
    components: COMPONENTS.slice(0, 5).map((c) => ({ ...c, on: ['Home', 'Request'] })),
  };
  state.design = {
    lgtm: { file: 'design/lgtm.fig', size: '4.8 megabytes', pages: 6, frames: 41, changedAt: at(52 * MIN), changedBy: D, commit: '4f9ae0a' },
  };
}

// ---- actions -------------------------------------------------------------------------
const designerOf = (s, p) => s.agents.find((a) => a.project === p.id && a.role === 'designer') || leadOf(s, p);
function comment(s, p, sc, text) {
  const d = designerOf(s, p);
  update(() => { sc.comments.push({ from: 'owner', ts: Date.now(), text }); sc.replying = true; });
  setTimeout(() => update(() => {
    sc.replying = false; if (ensure(s, p).approvedAt) { sc.comments.push({ from: d.id, ts: Date.now(), text: 'The mocks are approved, so I passed this to the project lead as a change request.' }); return; }
    const from = sc.rev; sc.rev += 1; sc.status = 'changed'; sc.updatedAt = Date.now(); sc.note = 'Changed after your comment.';
    sc.comments.push({ from: d.id, ts: Date.now(), text: `Done in revision ${sc.rev}. Open Changes to compare it with revision ${from}.` });
    ensure(s, p).changes.unshift({ id: uid('c'), screen: sc.id, from, to: sc.rev, ts: Date.now(), by: d.id, seen: false, text: `Changed after your comment: "${text}"` });
  }), 1800);
}
function approveAll(s, p) {
  const m = ensure(s, p);
  act.confirm({ title: 'Approve the mocks?', danger: false, action: 'Approve mocks',
    body: `${plural(m.screens.length, 'screen')} become the reference for ${p.name}. The project moves to Plan, and the project lead starts a Planning team.`,
    onConfirm: () => { update((st) => {
      m.approvedAt = Date.now(); for (const sc of m.screens) sc.status = 'approved'; for (const c of m.changes) c.seen = true;
      const pr = projectOf(st, p.id); pr.stage = 'Plan'; pr.phase = 'design';
      for (const a of st.agents) if (a.project === p.id && a.team && byId(st.teams, a.team)?.stage === 'Design') { a.state = 'idle'; a.activity = ''; a.workState = 'done'; }
      const tid = p.id + '-plan';
      if (!byId(st.teams, tid)) {
        st.teams.push({ id: tid, project: p.id, stage: 'Plan', area: null, branch: pr.branch + '/plan', needToKnow: false });
        const mk = (id, role, name, activity) => ({ id, project: p.id, team: tid, role, name, harness: 'claude', subscription: 'sub-max', model: role === 'team-lead' ? 'Opus 5.5' : 'Sonnet 5.5', effort: 'High', permission: 'Edit files without asking', state: 'working', activity, task: null, context: 4, turns: 1, tokens: 0.1, workState: 'working', stalled: false, startedAt: Date.now() });
        st.agents.push(mk(tid + '-lead', 'team-lead', 'Planning lead', 'Reading the approved mocks'), mk(tid + '-p1', 'planner', 'Planner 1', 'Listing the fields each screen uses'));
        st.channels.push({ id: 'ch-' + tid, project: p.id, kind: 'team', team: tid, name: 'planning', members: [tid + '-lead', tid + '-p1'] });
        st.expanded['team:' + tid] = true;
      }
      const lead = leadOf(st, pr); lead.state = 'working'; lead.activity = 'Splitting the work into sprints';
      threadOf(st, lead.id).push({ id: uid('m'), type: 'note', ts: Date.now(), text: 'You approved the mocks.' }, { id: uid('m'), type: 'agent', ts: Date.now() + 1, text: `The ${plural(m.screens.length, 'screen')} are now the reference. I started a **Planning team** and I am splitting the work into sprints. They appear on the board as they are sized.` });
    }); act.toast('Mocks approved. The project moved to Plan.'); go(`/p/${p.id}/mocks`); } });
}
registerDialog('mock-changes', ({ d, s }) => {
  const p = projectOf(s, d.project); const m = ensure(s, p); const des = designerOf(s, p);
  const [text, setText] = useState(''); const [sid, setSid] = useState(d.screen || '');
  const send = () => { if (!text.trim()) return; const sc = byId(m.screens, sid); act.closeDialog();
    if (sc) comment(s, p, sc, text.trim());
    act.sendMessage(des.id, sc ? `Change the ${sc.name} screen: ${text.trim()}` : `Change the mocks: ${text.trim()}`);
    act.toast(`Sent to the ${des.name}`); };
  return html`<${Dialog} title="Request changes" onClose=${act.closeDialog} onSubmit=${send}
    foot=${html`<span class="why">Goes to the ${des.name} as a message.</span><button type="button" class="btn" onClick=${act.closeDialog}>Cancel</button><button type="submit" class="btn primary" disabled=${!text.trim()}>Send</button>`}>
    <div class="field"><label for="mc-screen">Screen</label><select id="mc-screen" class="select" value=${sid} onChange=${(e) => setSid(e.target.value)}><option value="">All screens</option>${m.screens.map((x) => html`<option key=${x.id} value=${x.id}>${x.name}</option>`)}</select></div>
    <div class="field"><label for="mc-text">What should change</label><textarea id="mc-text" class="textarea" rows="4" autofocus placeholder="Say what is wrong, or what you expected to see." value=${text} onInput=${(e) => setText(e.target.value)}></textarea></div>
  <//>`;
});

// ---- views ---------------------------------------------------------------------------
function Status({ sc }) { const [tone, word] = STATUS[sc.status]; return html`<span class=${cx('badge', tone)}>${sc.status === 'approved' && html`<${Icon} name="check" size=${11} />`}${word}</span>`; }
const since = (ts, now) => (ago(ts, now) === 'now' ? 'just now' : ago(ts, now) + ' ago');

function Screens({ s, p, m }) {
  const now = useNow();
  return html`<div class="table-wrap"><table class="table mk-screens"><thead><tr><th class="mk-th-thumb"></th><th>Screen</th><th>Status</th><th>Note</th><th class="num">Revision</th><th class="num">Comments</th><th class="num">Updated</th></tr></thead><tbody>
    ${m.screens.length === 0 && html`<tr><td></td><td colspan="6" class="muted" data-empty>No screens</td></tr>`}
    ${m.screens.map((sc) => html`<tr key=${sc.id} class=${cx('click', sc.status === 'changed' && 's-warn')} onClick=${() => go(`/p/${p.id}/mocks/screen/${sc.id}`)}>
      <td class="mk-td-thumb"><span class="mk-mini"><${Frame} kind=${sc.kind} max=${.12} /></span></td>
      <td><a href=${href(`/p/${p.id}/mocks/screen/${sc.id}`)} style="font-weight:var(--weight-medium)">${sc.name}</a></td>
      <td><${Status} sc=${sc} /></td>
      <td class="muted wrap mk-note">${sc.note}</td>
      <td class="num">${sc.rev}</td>
      <td class="num muted">${sc.comments.length || ''}</td>
      <td class="num muted">${since(sc.updatedAt, now)}</td></tr>`)}
  </tbody></table></div>`;
}

function ScreenView({ s, p, m, id }) {
  const now = useNow(); const sc = byId(m.screens, id); const [vp, setVp] = useState('phone'); const [text, setText] = useState(''); const des = designerOf(s, p);
  if (!sc) return html`<div class="page"><${Empty} title="This screen does not exist">It may have been removed. <a class="link" href=${href(`/p/${p.id}/mocks`)}>Screens</a><//></div>`;
  const i = m.screens.indexOf(sc); const prev = m.screens[i - 1], next = m.screens[i + 1];
  const send = (e) => { e.preventDefault(); if (!text.trim()) return; comment(s, p, sc, text.trim()); setText(''); };
  return html`<div class="mk-detail">
    <div class="mk-stagecol">
      <div class="mk-stagebar">
        <a class="icon-btn" aria-label="Screens" href=${href(`/p/${p.id}/mocks`)}><${Icon} name="arrow-left" size=${15} /></a>
        <b class="mk-name">${sc.name}</b><${Status} sc=${sc} /><span class="muted">Revision ${sc.rev}</span>
        <span class="grow"></span>
        <div class="seg">${[['phone', 'smartphone', 'Phone'], ['desktop', 'monitor', 'Desktop']].map(([v, ic, l]) => html`<button type="button" key=${v} aria-pressed=${vp === v} aria-label=${l} data-tip=${l} onClick=${() => setVp(v)}><${Icon} name=${ic} size=${13} /></button>`)}</div>
        <${StageZoom} />
        <a class="icon-btn" aria-label="Previous screen" aria-disabled=${!prev} href=${prev ? href(`/p/${p.id}/mocks/screen/${prev.id}`) : null}><${Icon} name="chevron-left" size=${16} /></a>
        <a class="icon-btn" aria-label="Next screen" aria-disabled=${!next} href=${next ? href(`/p/${p.id}/mocks/screen/${next.id}`) : null}><${Icon} name="chevron-right" size=${16} /></a>
      </div>
      <${Stage} key=${vp + sc.id + sc.rev} kind=${sc.kind} vp=${vp} />
    </div>
    <aside class="mk-aside">
      <section><p class="note">${sc.note}</p>
        <div class="row" style="flex-wrap:wrap">
          ${sc.status !== 'approved' && html`<button type="button" class="btn primary" onClick=${() => { update(() => { sc.status = 'approved'; for (const c of m.changes) if (c.screen === sc.id) c.seen = true; }); act.toast(`${sc.name} approved`); }}><${Icon} name="check" size=${14} />Approve</button>`}
          <button type="button" class="btn ghost" onClick=${() => act.toast(`Opening ${sc.name} in OpenPencil`)}><${Icon} name="pencil-ruler" size=${14} />Edit design</button></div></section>
      <section class="mk-comments"><h3>Comments</h3>
        ${sc.comments.length === 0 && !sc.replying && html`<p class="muted" data-empty>No comments</p>`}
        <ol>${sc.comments.map((c, n) => { const a = c.from === 'owner' ? null : agentOf(s, c.from);
          return html`<li key=${n}>${a ? html`<${Avatar} agent=${a} s=${s} size="sm" status=${false} />` : html`<${OwnerAvatar} s=${s} size="sm" />`}<div><p class="who"><b>${a ? a.name : 'You'}</b><time>${since(c.ts, now)}</time></p><p>${c.text}</p></div></li>`; })}
          ${sc.replying && html`<li><${Avatar} agent=${des} s=${s} size="sm" status=${false} /><div><span class="typing"><i></i><i></i><i></i></span></div></li>`}</ol>
        <form class="mk-say" onSubmit=${send}><input class="input" placeholder=${`Ask the ${des.name.toLowerCase()} for a change`} aria-label="Comment" value=${text} onInput=${(e) => setText(e.target.value)} />
          <button type="submit" class="btn" disabled=${!text.trim()}>Send</button></form></section>
    </aside>
  </div>`;
}
// The large preview uses the Design page's canvas: the screen at its real size, with zoom and Fit.
const stage = { c: null, listeners: new Set() };
function StageZoom() {
  const [, force] = useState(0);
  useLayoutEffect(() => { const f = () => force((n) => n + 1); stage.listeners.add(f); return () => stage.listeners.delete(f); }, []);
  return stage.c ? html`<${ZoomControls} c=${stage.c} />` : null;
}
function Stage({ kind, vp }) {
  const c = useCanvas({ initial: 'fit' }); stage.c = c;
  useLayoutEffect(() => { for (const f of stage.listeners) f(); });
  const [w, h] = VIEWPORTS[vp]; const UI = DRAW[kind] || ListUI;
  return html`<${Canvas} c=${c}><div class=${cx('mk-frame flat', vp)} style=${{ width: w + 'px', height: h + 'px' }} aria-hidden="true" inert><${UI} /></div><//>`;
}

function Changes({ s, p, m }) {
  const now = useNow(); const [open, setOpen] = useState(null);
  return html`<div class="table-wrap"><table class="table mk-changes"><thead><tr><th>Screen</th><th>Revision</th><th>What changed</th><th>By</th><th class="num">When</th></tr></thead><tbody>
    ${m.changes.length === 0 && html`<tr><td colspan="5" class="muted" data-empty>No changes</td></tr>`}
    ${m.changes.map((c) => { const sc = byId(m.screens, c.screen); const by = agentOf(s, c.by); if (!sc) return null; const ex = open === c.id;
      return html`<tr key=${c.id} class=${cx(c.compare && 'click', !c.seen && 's-warn')} onClick=${() => c.compare && setOpen(ex ? null : c.id)}>
          <td class="state-cell"><a class="link" href=${href(`/p/${p.id}/mocks/screen/${sc.id}`)} onClick=${(e) => e.stopPropagation()}>${sc.name}</a>${!c.seen && html` <span class="badge warn">New</span>`}</td>
          <td class="mono muted">${c.from ? `${c.from} → ${c.to}` : '1'}</td>
          <td class="wrap">${c.text}${c.compare && html` <span class="link mk-cmp">${ex ? 'Hide' : 'Compare'}</span>`}</td>
          <td class="muted">${by ? by.name : 'Designer'}</td>
          <td class="num muted">${since(c.ts, now)}</td></tr>
        ${ex && html`<tr class="mk-cmprow"><td colspan="5"><div class="mk-pair"><figure><figcaption>Revision ${c.from}</figcaption><div class="mk-thumb"><${Frame} kind=${sc.kind} before=${true} max=${.42} /></div></figure>
          <figure><figcaption>Revision ${c.to}</figcaption><div class="mk-thumb"><${Frame} kind=${sc.kind} max=${.42} /></div></figure></div></td></tr>`}`; })}
  </tbody></table></div>`;
}

const SCHEMA = { matches: ['success', 'Matches'], differs: ['warn', 'Differs'], new: ['info', 'New'], unavailable: ['', 'Unavailable'] };
function Data({ m }) {
  const [f, setF] = useState('all'); const rows = m.data.filter((d) => f === 'all' || d.schema === f);
  return html`<div class="wf-bar"><div class="seg">${['all', 'new', 'differs', 'matches', 'unavailable'].map((k) => html`<button type="button" key=${k} aria-pressed=${f === k} onClick=${() => setF(k)}>${k === 'all' ? 'All' : SCHEMA[k][1]}<span class="faint num">${k === 'all' ? m.data.length : m.data.filter((d) => d.schema === k).length}</span></button>`)}</div></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Field</th><th>Schema</th><th>Sample value</th><th>Shown on</th><th>Note</th></tr></thead><tbody>
      ${rows.length === 0 && html`<tr><td colspan="5" class="muted" data-empty>No fields</td></tr>`}
      ${rows.map((d) => html`<tr key=${d.field} class=${cx(d.schema === 'differs' && 's-warn')}><td class="state-cell mono">${d.field}</td><td><span class=${cx('badge', SCHEMA[d.schema][0])}>${SCHEMA[d.schema][1]}</span></td>
        <td class="mono muted truncate" style="max-width:220px">${d.sample}</td><td class="muted">${d.on}</td><td class="wrap muted mk-note">${d.note || ''}</td></tr>`)}
    </tbody></table></div>`;
}
function Demo({ kind }) {
  if (kind === 'button') return html`<span class="row"><span class="btn sm primary">Allow</span><span class="btn sm">Deny</span></span>`;
  if (kind === 'switch') return html`<span class="row"><span class="switch" aria-checked="true"></span><span class="switch" aria-checked="false"></span></span>`;
  if (kind === 'avatar') return html`<span class="row" style="gap:4px"><span class="avatar sm lead"><${Icon} name="crown" size=${12} /></span><span class="avatar sm"><${Icon} name="flag" size=${12} /></span><span class="avatar sm"><${Icon} name="hammer" size=${12} /></span></span>`;
  if (kind === 'badge') return html`<span class="row" style="gap:4px"><span class="badge warn">Waiting</span><span class="badge success">Connected</span></span>`;
  if (kind === 'chips') return html`<span class="mu-chips demo"><span class="on">All 5</span><span>Questions 2</span></span>`;
  if (kind === 'tabs') return html`<span class="row muted" style="gap:10px"><${Icon} name="bell" size=${15} /><${Icon} name="kanban" size=${15} /><${Icon} name="settings" size=${15} /></span>`;
  return html`<span class="mk-reqdemo"><b>Approval</b><i></i><i></i></span>`;
}
function Components({ m }) {
  return html`<div class="table-wrap"><table class="table"><thead><tr><th>Component</th><th>Source</th><th>Preview</th><th class="num">Uses</th><th>Screens</th></tr></thead><tbody>
      ${m.components.length === 0 && html`<tr><td colspan="5" class="muted" data-empty>No components</td></tr>`}
      ${m.components.map((c) => html`<tr key=${c.name} class=${cx(!c.real && 's-warn')}><td class="state-cell wrap"><b style="font-weight:var(--weight-medium)">${c.name}</b>${c.note && html`<small class="mk-small">${c.note}</small>`}</td>
        <td><span class=${cx('badge', c.real ? 'success' : 'warn')}>${c.real ? 'Real' : 'Draft'}</span></td><td><${Demo} kind=${c.demo} /></td><td class="num">${c.uses}</td><td class="muted">${c.on.join(', ')}</td></tr>`)}
    </tbody></table></div>`;
}

export function MocksTab({ s, project: p, route }) {
  const m = ensure(s, p); const now = useNow(); const view = route.parts[3] || 'screens';
  const unseen = m.changes.filter((c) => !c.seen).length;
  const tabs = [['screens', 'Screens', m.screens.length], ['changes', 'Changes', unseen, 'warn'], ['data', 'Data', m.data.length], ['components', 'Components', m.components.length]];
  const open = m.screens.filter((x) => x.status !== 'approved').length;
  const nav = html`<nav class="wf-nav" aria-label="Mock views">${tabs.map(([id, label, n, tone]) => html`<a key=${id} class="wf-tab" aria-current=${(view === 'screen' ? 'screens' : view) === id ? 'page' : null} href=${href(`/p/${p.id}/mocks${id === 'screens' ? '' : '/' + id}`)}>${label}${n > 0 && html`<span class=${cx('count', tone)}>${n}</span>`}</a>`)}</nav>`;
  if (view === 'screen') return html`<div class="wf mk-full">${nav}<${ScreenView} key=${route.parts[4]} s=${s} p=${p} m=${m} id=${route.parts[4]} /></div>`;
  const body = view === 'changes' ? html`<${Changes} s=${s} p=${p} m=${m} />` : view === 'data' ? html`<${Data} m=${m} />` : view === 'components' ? html`<${Components} m=${m} />` : html`<${Screens} s=${s} p=${p} m=${m} />`;
  return html`<div class="wf" data-main>${nav}
    <div class="wf-body">
      <div class="wf-status">
        ${m.approvedAt ? html`<span class="badge success"><${Icon} name="check" size=${11} />Approved</span><span>${since(m.approvedAt, now)}</span>`
          : html`<span><b class="num">${m.screens.length - open}</b> of ${plural(m.screens.length, 'screen')} approved</span>`}
        ${unseen > 0 && html`<span class="warn-text">${plural(unseen, 'change')} not seen</span>`}
        <span class="grow"></span>
        ${view === 'changes' && unseen > 0 && html`<button type="button" class="btn sm ghost" onClick=${() => update(() => { for (const c of m.changes) c.seen = true; })}><${Icon} name="check" size=${13} />Mark seen</button>`}
        <button type="button" class="btn sm" disabled=${!m.screens.length} onClick=${() => act.openDialog({ type: 'mock-changes', project: p.id, screen: '' })}><${Icon} name="message-square" size=${13} />Request changes</button>
        ${!m.approvedAt && html`<button type="button" class="btn sm primary" disabled=${!m.screens.length} onClick=${() => approveAll(s, p)}><${Icon} name="check" size=${13} />Approve mocks</button>`}
      </div>
      ${body}
    </div>
  </div>`;
}
