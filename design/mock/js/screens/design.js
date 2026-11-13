// The repository's Design page: the whole design file on a near full-screen canvas under
// one thin bar. The two menus follow the Design lead's proposed standard, saved as
// design/mock/feedback/2026-11-10-design-categories.md. The owner has not approved it.
import { html, useState, useEffect, useLayoutEffect, useRef, Icon, cx, update, go, href, ago, useNow, plural, clamp, FRAMED, live, refuse } from '../lib.js';
import { ICONS } from '../icons.js';
import { byId, agentOf, projectOf, routeForAgent } from '../data.js';
import * as act from '../actions.js';
import * as mocks from '../live/mocks.js';
import { Menu, Avatar } from '../ui.js';

// ---- the canvas ------------------------------------------------------------------------
// A world drawn at its real size and scaled by the zoom. Fit scales the whole world into
// the window. The Mocks tab uses the same canvas for its large preview.
const ZOOMS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2];
export function useCanvas({ initial = 'fit', min = 0.05 } = {}) {
  const view = useRef(null); const world = useRef(null);
  const [z, setZ] = useState(null); const size = useRef({ w: 0, h: 0, cw: 0, ch: 0 });
  const fitZ = () => { const { w, h, cw, ch } = size.current; if (!w || !cw) return 1; return clamp(Math.min((cw - 64) / w, (ch - 64) / h), min, 2); };
  useLayoutEffect(() => {
    const measure = () => {
      if (!view.current || !world.current) return;
      size.current = { w: world.current.offsetWidth, h: world.current.offsetHeight, cw: view.current.clientWidth, ch: view.current.clientHeight };
      setZ((cur) => cur ?? (initial === 'fit' ? fitZ() : typeof initial === 'number' ? Math.min(1, Math.max(fitZ(), initial)) : Math.min(1, fitZ())));
    };
    measure(); const ro = new ResizeObserver(measure); if (view.current) ro.observe(view.current); if (world.current) ro.observe(world.current); return () => ro.disconnect();
  }, []);
  const zoom = z ?? 1;
  const step = (d) => { const i = ZOOMS.findIndex((x) => x >= zoom - 1e-6); setZ(ZOOMS[clamp((i < 0 ? ZOOMS.length - 1 : i) + d, 0, ZOOMS.length - 1)]); };
  const fit = () => { setZ(fitZ()); requestAnimationFrame(() => view.current?.scrollTo({ left: 0, top: 0 })); };
  // Zoom to one rectangle of the world, given in world pixels.
  const focus = (x, y, w, h) => { const { cw, ch } = size.current; const nz = clamp(Math.min((cw - 64) / w, (ch - 96) / h), min, 2); setZ(nz);
    requestAnimationFrame(() => view.current?.scrollTo({ left: Math.max(0, x * nz + 32 - (cw - w * nz) / 2), top: Math.max(0, y * nz + 32 - (ch - h * nz) / 2), behavior: 'smooth' })); };
  return { view, world, zoom, ready: z != null, step, fit, focus, setZ };
}
export function Canvas({ c, children, label, empty }) {
  return html`<div class=${cx('dz-canvas', empty && 'nofile')} ref=${c.view} data-main>
    ${label && html`<div class="dz-label">${label}</div>`}
    <div class="dz-sizer" style=${{ width: `calc(${(c.world.current?.offsetWidth || 0) * c.zoom}px + 64px)`, height: `calc(${(c.world.current?.offsetHeight || 0) * c.zoom}px + 64px)` }}>
      <div class="dz-world" ref=${c.world} style=${{ transform: `scale(${c.zoom})`, '--z': c.zoom, visibility: c.ready ? null : 'hidden' }}>${children}</div>
    </div>
  </div>`;
}
export function ZoomControls({ c }) {
  return html`<div class="dz-zoom" role="group" aria-label="Zoom">
    <button type="button" class="icon-btn sm" aria-label="Zoom out" onClick=${() => c.step(-1)}><${Icon} name="minus" size=${14} /></button>
    <span class="num" aria-live="polite">${Math.round(c.zoom * 100)}%</span>
    <button type="button" class="icon-btn sm" aria-label="Zoom in" onClick=${() => c.step(1)}><${Icon} name="plus" size=${14} /></button>
    <button type="button" class="btn sm ghost" onClick=${c.fit}>Fit</button>
  </div>`;
}

// ---- the file's content ------------------------------------------------------------------
// Screens are drawn from the mock's own addresses, as the standard allows for frames that
// come from code. A frame with no address opens from the screen above it, so it is drawn as
// a dashed frame with its name.
const F = (screen, state, addr) => ({ screen, state, addr });
const FLOWS = [
  ['Sign in and setup', [F('Login', null, '/login'), F('Login', 'Rejected', '/login?session=rejected'), F('Login', 'Session expired', '/login?session=expired'), F('Login', 'Service unavailable', '/login?session=unavailable'), F('Login', 'Insecure connection', '/login?insecure=1'),
    F('First run', 'Subscription', '/setup'), F('First run', 'Repository', null), F('First run', 'First project', null)]],
  ['Home', [F('Home', null, '/home'), F('Home', 'Questions', '/home/questions'), F('All projects', null, '/projects'), F('Bell menu', null, null), F('Switcher', null, null)]],
  ['Project', [F('Board', null, '/p/console/board'), F('Board', 'Table', '/p/console/board/table'), F('Board', 'Roadmap', '/p/console/board/roadmap'), F('Board', 'Empty', '/p/phone/board'),
    F('Sprint', null, '/p/console/sprint/sp1'), F('Task', null, '/p/console/task/t15'), F('Team', null, '/p/console/team/console-shell'), F('New project', null, null), F('Project settings', null, '/p/console/settings')]],
  ['Workflow', [F('Phases', null, '/p/console/workflow'), F('Phases', 'No agents', '/p/phone/workflow'), F('Review rounds', null, '/p/console/workflow/review'), F('Test runs', null, '/p/console/workflow/runs'), F('Test runs', 'Empty', '/p/phone/workflow/runs'),
    F('End result', null, '/p/console/workflow/result'), F('Workflow settings', null, '/p/console/workflow/settings')]],
  ['Mocks', [F('Screens', null, '/p/phone/mocks'), F('Screen', null, '/p/phone/mocks/screen/requests'), F('Changes', null, '/p/phone/mocks/changes'), F('Data', null, '/p/phone/mocks/data'), F('Components', null, '/p/phone/mocks/components')]],
  ['Conversations', [F('Chat', null, '/p/console/chat'), F('Chat', 'Another agent', '/p/console/chat/shell-lead'), F('Messages', null, '/p/console/messages'), F('Messages', 'Waiting for a reply', '/p/console/messages/waiting'), F('Agents', null, '/p/console/agents')]],
  ['Code', [F('Terminal', null, '/p/console/terminal'), F('Git', 'Changes', '/p/console/git'), F('Git', 'History', null), F('Git', 'Conflicts', null), F('Merge review', null, null)]],
  ['Repository', [F('Repository', null, '/r/lgtm'), F('Repository design', null, '/r/lgtm/design/palette/colour')]],
  ['Service', [F('Machines', null, '/machines'), F('Pair machine', null, null), F('Add repository', null, null), F('Subscriptions', null, '/subscriptions'), F('Add subscription', null, null), F('Phone notifications', null, '/notifications'), F('Service settings', null, '/settings')]],
];
// Components by group. "file" marks the components that are in design/lgtm.fig today,
// with their variants as rows by columns.
const C = (name, demo, file) => ({ name, demo, file });
const GROUPS = [
  ['Actions', [C('Button', 'button', { rows: ['Primary', 'Secondary'], cols: ['Default', 'Hover', 'Disabled'], prop: ['Kind', 'State'] }), C('Icon button', 'iconbtn'), C('Inline link', 'link', { rows: [''], cols: ['Default', 'Hover'], prop: ['', 'State'] })]],
  ['Inputs', [C('Text input', 'input'), C('Text area', 'textarea'), C('Select', 'select'), C('Switch', 'switch'), C('Checkbox', 'checkbox'), C('Segmented control', 'seg', { rows: [''], cols: ['First'], prop: ['', 'Selected'] }), C('Search field', 'search')]],
  ['Navigation', [C('Sidebar row', 'navrow'), C('Tree row', 'treerow'), C('Tabs', 'tabs'), C('Breadcrumbs', 'crumbs'), C('Top bar', 'topbar')]],
  ['Overlays', [C('Menu', 'menu'), C('Dialog', 'dialog'), C('Toast', 'toast'), C('Tooltip', 'tooltip')]],
  ['Status', [C('Status dot', 'dot', { rows: [''], cols: ['Working', 'Waiting', 'Idle', 'Failed', 'Stopped'], prop: ['', 'Status'] }), C('Task state', 'taskstate', { rows: [''], cols: ['Up next', 'In progress', 'In review', 'Done', 'Blocked'], prop: ['', 'State'] }),
    C('Connection status', 'conn', { rows: [''], cols: ['Live', 'Waiting', 'Offline'], prop: ['', 'Status'] }), C('Attention number', 'count', { rows: [''], cols: [''], prop: ['', ''] }),
    C('Badge', 'badge'), C('Tag', 'tag'), C('Meter', 'meter'), C('Progress', 'progress'), C('Callout', 'callout'), C('Empty state', 'empty')]],
  ['Data', [C('Table', 'table'), C('List row', 'listrow'), C('Description list', 'dl'), C('Keyboard key', 'kbd')]],
  ['Agents', [C('Avatar', 'avatar'), C('Agent row', 'agentrow', { rows: [''], cols: ['Waiting', 'Running', 'Idle'], prop: ['', 'Status'] }), C('Agent line', 'agentline'), C('Message', 'message'), C('Composer', 'composer'), C('Request block', 'request'), C('Tool line', 'toolline')]],
  ['Code', [C('Diff', 'diff'), C('Terminal line', 'term')]],
];
// The colours that design/lgtm.fig holds today, and the two whose values still agree.
const FILE_COLORS = new Set(['bg', 'surface', 'raised', 'sidebar', 'text', 'muted', 'primary', 'primary-contrast', 'accent', 'success', 'warn', 'error', 'focus', 'line', 'selected']);
const AGREE = new Set(['surface', 'primary-contrast']);
const COLOUR_GROUPS = [['Surfaces', /^(sidebar|bg|surface|raised|sunken|line|line-strong|scrim)$/], ['Text', /^(text|muted|faint)$/], ['Action', /^(primary|focus|selected|accent)/], ['States', /^(success|warn|error|info)/], ['Diff', /^(add|del)-/], ['Terminal', /^term-/]];
const PALETTE = ['Colour', 'Type', 'Space and density', 'Shape', 'Motion', 'Icons'];
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Field and Dusk values, read from the token file the page itself uses.
let tokenCache = null;
function useTokens() {
  const [t, setT] = useState(tokenCache);
  useEffect(() => {
    if (tokenCache) return;
    fetch('css/tokens.css').then((r) => r.text()).then((txt) => {
      const block = (sel) => { const i = txt.indexOf(sel); if (i < 0) return {}; const body = txt.slice(txt.indexOf('{', i) + 1, txt.indexOf('}', i)); const o = {};
        for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) o[m[1]] = m[2].trim(); return o; };
      tokenCache = { field: block(':root {'), dusk: block(':root[data-theme="dark"]'), regular: block(':root[data-density="regular"]') }; setT(tokenCache);
    }).catch(() => setT({ field: {}, dusk: {}, regular: {} }));
  }, []);
  return t;
}

// ---- component demos, drawn with the page's own styles -------------------------------------
function Variant({ kind, v }) {
  switch (kind) {
    case 'button': return v.r === 'Primary' ? html`<button type="button" tabindex="-1" class="btn primary" disabled=${v.c === 'Disabled'} style=${v.c === 'Hover' ? 'background:var(--color-primary-hover)' : ''}>Allow</button>`
      : html`<button type="button" tabindex="-1" class="btn" disabled=${v.c === 'Disabled'} style=${v.c === 'Hover' ? 'background:var(--color-raised);border-color:var(--color-line-strong)' : ''}>Deny</button>`;
    case 'link': return html`<span class="link" style=${v.c === 'Hover' ? 'text-decoration:underline' : ''}>Open thread</span>`;
    case 'seg': return html`<span class="seg"><button type="button" tabindex="-1" aria-pressed="true">All</button><button type="button" tabindex="-1" aria-pressed="false">Open</button><button type="button" tabindex="-1" aria-pressed="false">Fixed</button></span>`;
    case 'dot': return html`<span class="row" style="gap:6px"><i class=${cx('dot', { Working: 'working', Waiting: 'waiting', Idle: 'idle', Failed: 'failed', Stopped: 'stopped' }[v.c])}></i>${v.c}</span>`;
    case 'taskstate': return html`<span class=${cx('badge', { 'In progress': 'info', 'In review': 'info', Done: 'success', Blocked: 'warn' }[v.c])}>${v.c}</span>`;
    case 'conn': return html`<span class="row" style="gap:6px"><i class=${cx('dot', v.c === 'Live' ? 'working' : v.c === 'Waiting' ? 'waiting' : 'stopped')}></i>${v.c}</span>`;
    case 'count': return html`<span class="count warn">3</span>`;
    case 'agentrow': return html`<span class="dz-agentrow"><span class="avatar sm"><${Icon} name="hammer" size=${12} /><i class=${cx('dot', v.c === 'Waiting' ? 'waiting' : v.c === 'Running' ? 'working' : 'idle')}></i></span><span class="grow">Builder 1</span><span class=${cx(v.c === 'Waiting' ? 'warn-text' : 'muted')}>${v.c === 'Waiting' ? 'Needs approval' : v.c === 'Running' ? 'Editing Sidebar.tsx' : 'Idle'}</span></span>`;
    default: return null;
  }
}
function Demo({ kind }) {
  switch (kind) {
    case 'iconbtn': return html`<span class="row" style="gap:4px"><span class="icon-btn"><${Icon} name="search" size=${15} /></span><span class="icon-btn"><${Icon} name="bell" size=${15} /></span><span class="icon-btn"><${Icon} name="ellipsis" size=${15} /></span></span>`;
    case 'input': return html`<input class="input" tabindex="-1" placeholder="Search" style="width:220px" />`;
    case 'textarea': return html`<textarea class="textarea" tabindex="-1" rows="2" placeholder="Message the project lead…" style="width:260px"></textarea>`;
    case 'select': return html`<select class="select" tabindex="-1" style="width:200px"><option>Opus 5.5</option></select>`;
    case 'switch': return html`<span class="row"><span class="switch" aria-checked="true"></span><span class="switch" aria-checked="false"></span></span>`;
    case 'checkbox': return html`<label class="row" style="gap:6px"><input type="checkbox" checked tabindex="-1" />Show answered</label>`;
    case 'search': return html`<span class="search" style="width:220px"><${Icon} name="search" size=${14} class="faint" /><input class="input" tabindex="-1" placeholder="Search" style="padding-left:30px" /></span>`;
    case 'navrow': return html`<span class="nav-item" style="width:220px"><${Icon} name="house" size=${15} /><span>Home</span><span class="count warn">6</span></span>`;
    case 'treerow': return html`<span class="dz-tree"><${Icon} name="chevron-down" size=${12} class="faint" /><${Icon} name="users" size=${13} class="faint" /><span class="grow">Build team · Shell</span><span class="warn-text">1</span></span>`;
    case 'tabs': return html`<span class="dz-tabs"><span class="on">Board</span><span>Workflow</span><span>Chat</span><span>Git</span></span>`;
    case 'crumbs': return html`<span class="row" style="gap:6px"><span class="mono muted">lgtm</span><${Icon} name="chevron-right" size=${12} class="faint" /><b style="font-weight:var(--weight-medium)">Agent console</b></span>`;
    case 'topbar': return html`<span class="dz-topbar"><span class="mono muted">lgtm</span><b>Agent console</b><span class="grow"></span><${Icon} name="bell" size=${15} /><i class="dot working"></i><span>Live</span></span>`;
    case 'menu': return html`<span class="dz-menu"><span>Rename</span><span>Archive</span><span class="sep"></span><span class="error-text">Delete</span></span>`;
    case 'dialog': return html`<span class="dz-dialog"><b>Archive Agent console?</b><span class="muted">Its agents stop. Nothing is deleted.</span><span class="row" style="justify-content:flex-end;gap:6px"><span class="btn sm">Cancel</span><span class="btn sm primary">Archive</span></span></span>`;
    case 'toast': return html`<span class="dz-toast"><${Icon} name="circle-check" size=${14} class="success-text" />Project archived<span class="link">Undo</span></span>`;
    case 'tooltip': return html`<span class="dz-tip">New project</span>`;
    case 'badge': return html`<span class="row" style="gap:4px"><span class="badge warn">Waiting</span><span class="badge success">Passed</span><span class="badge info">Build</span><span class="badge error">Failed</span><span class="badge outline">Default</span></span>`;
    case 'tag': return html`<span class="row" style="gap:4px"><span class="tag">SP-03</span><span class="tag">a41c0d2</span></span>`;
    case 'meter': return html`<span class="dz-meter"><i style="width:41%"></i></span>`;
    case 'progress': return html`<span class="progress" style="width:180px;height:6px;display:flex;gap:2px"><i style="flex:1"></i><i style="flex:1"></i><i class="active" style="flex:1"></i><i style="flex:1;background:transparent"></i></span>`;
    case 'callout': return html`<span class="callout" style="width:300px"><${Icon} name="info" size=${14} /><span>Saved to .lgtm/config.</span></span>`;
    case 'empty': return html`<span class="dz-empty">No findings</span>`;
    case 'table': return html`<table class="table" style="width:300px"><thead><tr><th>Finding</th><th>Severity</th></tr></thead><tbody><tr><td class="mono muted">F-09</td><td>Major</td></tr><tr><td class="mono muted">F-10</td><td>Minor</td></tr></tbody></table>`;
    case 'listrow': return html`<span class="list-row" style="width:300px"><i class="dot waiting"></i><b style="font-weight:var(--weight-medium)">Build lead</b><span class="muted grow truncate">Waiting for your answer</span></span>`;
    case 'dl': return html`<dl class="dl" style="width:280px"><dt>Remote</dt><dd class="mono">github.com/qnlbnsl/lgtm-studio</dd><dt>Base branch</dt><dd class="mono">master</dd></dl>`;
    case 'kbd': return html`<span class="row" style="gap:4px"><kbd>Ctrl</kbd><kbd>K</kbd><kbd>Esc</kbd></span>`;
    case 'avatar': return html`<span class="row" style="gap:6px"><span class="avatar lead"><${Icon} name="crown" size=${13} /></span><span class="avatar"><${Icon} name="flag" size=${13} /></span><span class="avatar"><${Icon} name="hammer" size=${13} /></span><span class="avatar"><${Icon} name="eye" size=${13} /></span></span>`;
    case 'agentline': return html`<span class="row" style="gap:6px"><span class="avatar sm"><${Icon} name="flag" size=${12} /></span><b style="font-weight:var(--weight-medium)">Build lead</b><span class="muted">· Shell</span></span>`;
    case 'message': return html`<span class="dz-msgs"><span class="mine">Use the main view.</span><span class="peer">Done. The thread opens in the main view.</span></span>`;
    case 'composer': return html`<span class="dz-composer"><span class="muted">Message the project lead…</span><span class="row" style="gap:8px;font-size:var(--text-sm)"><span class="muted">Opus 5.5</span><span class="muted">High</span><span class="grow"></span><span class="icon-btn sm"><${Icon} name="arrow-up" size=${13} /></span></span></span>`;
    case 'request': return html`<span class="dz-req"><span class="warn-text" style="font-weight:var(--weight-medium)">Question</span><b>Where should an agent's thread open?</b><span class="row" style="gap:6px"><span class="btn sm"><${Icon} name="check" size=${12} />Accept recommendation</span><span class="btn sm ghost">Open thread</span></span></span>`;
    case 'toolline': return html`<span class="dz-tool"><${Icon} name="wrench" size=${13} class="faint" />Read 14 files · searched 3 times<${Icon} name="chevron-right" size=${13} class="faint" /></span>`;
    case 'diff': return html`<span class="dz-diff"><span class="del">- .sidebar.folded { width: 56px; }</span><span class="add">+ .rail { width: 48px; }</span></span>`;
    case 'term': return html`<span class="dz-term"><span class="g">~/projects/lgtm-studio</span> <span>pnpm test</span></span>`;
    default: return null;
  }
}
function ComponentBlock({ c }) {
  const f = c.file;
  return html`<section class=${cx('dz-comp', !f && 'code')}>
    <header><b>${c.name}</b>${f ? html`<span class="dz-flag in">In the file</span>` : html`<span class="dz-flag">Only in code</span>`}</header>
    ${f ? html`<div class="dz-variants" style=${{ gridTemplateColumns: `${f.rows.some(Boolean) ? 'auto ' : ''}repeat(${f.cols.length}, auto)` }}>
      ${f.rows.some(Boolean) && html`<span></span>`}${f.cols.map((col) => html`<span key=${col} class="axis">${f.prop[1] && col ? `${f.prop[1]}=${col}` : ''}</span>`)}
      ${f.rows.map((r) => html`${r && html`<span class="axis">${f.prop[0]}=${r}</span>`}${f.cols.map((col) => html`<span key=${r + col} class="cell"><${Variant} kind=${c.demo} v=${{ r, c: col }} /></span>`)}`)}
    </div>` : html`<div class="dz-demo"><${Demo} kind=${c.demo} /></div>`}
  </section>`;
}

// ---- the sheets that the canvas shows ---------------------------------------------------------
const FW = 1440, FH = 900, GX = 120, GY = 180;
function flowLayout(frames) {
  const screens = []; for (const f of frames) { let row = screens.find((x) => x.name === f.screen); if (!row) screens.push(row = { name: f.screen, frames: [] }); row.frames.push(f); }
  const cols = Math.max(1, ...screens.map((x) => x.frames.length));
  return { screens, w: cols * FW + (cols - 1) * GX, h: screens.length * FH + (screens.length - 1) * GY };
}
function FlowSheet({ frames, c, page }) {
  const { screens, w, h } = flowLayout(frames.length ? frames : [F(page, null, null)]);
  return html`<div class="dz-flow" style=${{ width: w + 'px', height: h + 'px' }}>
    ${screens.map((row, ri) => row.frames.map((f, ci) => { const x = ci * (FW + GX), y = ri * (FH + GY); const name = f.state ? `${f.screen} / ${f.state}` : f.screen;
      return html`<button type="button" key=${name} class=${cx('dz-frame', !f.addr && 'dashed')} style=${{ left: x + 'px', top: y + 'px', width: FW + 'px', height: FH + 'px' }} aria-label=${name} onClick=${() => c.focus(x, y - 60, FW, FH + 60)}>
        <span class="dz-fname"><b>${frames.length ? name : page}</b>${f.addr && html`<span class="mono">${f.addr}</span>`}</span>
        ${f.addr && !FRAMED ? html`<iframe src=${'./#' + f.addr} title=${name} loading="lazy" tabindex="-1" aria-hidden="true"></iframe>`
          : html`<span class="dz-ph">${frames.length ? (f.addr ? name : `Opens from ${row.frames[0] === f && ri > 0 ? screens[ri - 1].name : f.screen}`) : `Create the page ${page}`}</span>`}
      </button>`; }))}
  </div>`;
}
function ComponentSheet({ items, overview, group }) {
  const list = overview ? GROUPS.flatMap(([g, cs]) => cs.map((x) => ({ ...x, file: null, group: g }))) : items;
  if (!list.length) return html`<div class="dz-sheet"><h2>${group}</h2><div class="dz-comp dashed"><span class="dz-ph">Create the page Components / ${group}</span></div></div>`;
  return html`<div class="dz-sheet">
    ${overview ? GROUPS.map(([g, cs]) => html`<div key=${g} class="dz-ovgroup"><h3>${g}</h3><div class="dz-comps">${cs.map((x) => html`<div key=${x.name} class="dz-ov"><span class="dz-ovname">${x.name}</span>${x.file ? html`<${Variant} kind=${x.demo} v=${{ r: x.file.rows[0], c: x.file.cols[0] }} />` : html`<${Demo} kind=${x.demo} />`}</div>`)}</div></div>`)
    : html`<div class="dz-comps">${list.map((x) => html`<${ComponentBlock} key=${x.name} c=${x} />`)}</div>`}
  </div>`;
}
function Only() { return html`<span class="dz-flag">Only in code</span>`; }
function PaletteSheet({ item, t, hasFile }) {
  if (!t) return html`<div class="dz-sheet"><p class="muted">Reading the tokens…</p></div>`;
  const f = hasFile ? t.field : {}; const d = hasFile ? t.dusk : {}; const reg = hasFile ? t.regular : {};
  const keys = (re) => Object.keys(f).filter((k) => re.test(k));
  if (item === 'Colour') {
    const colours = keys(/^color-/).map((k) => k.slice(6));
    return html`<div class="dz-sheet wide"><table class="table dz-tokens"><thead><tr><th></th><th>Token</th><th>Field</th><th>Dusk</th><th>CSS variable</th><th>Design file</th></tr></thead>
      ${COLOUR_GROUPS.map(([g, re]) => { const rows = colours.filter((n) => re.test(n)); return rows.length > 0 && html`<tbody key=${g}><tr class="grp"><td colspan="6">${g}</td></tr>
        ${rows.map((n) => html`<tr key=${n}><td><span class="dz-sw"><i style=${{ background: f['color-' + n] }}></i><i style=${{ background: d['color-' + n] || f['color-' + n] }}></i></span></td><td class="mono">color/${g}/${n}</td>
          <td class="mono muted">${f['color-' + n]}</td><td class="mono muted">${d['color-' + n] || 'Same as Field'}</td><td class="mono muted">--color-${n}</td>
          <td>${!FILE_COLORS.has(n) ? html`<${Only} />` : AGREE.has(n) ? html`<span class="dz-flag in">Matches</span>` : html`<span class="dz-flag warn">Retuned in code</span>`}</td></tr>`)}</tbody>`; })}
      ${!colours.length && html`<tbody><tr><td colspan="6" class="muted" data-empty>No colour variables</td></tr></tbody>`}</table></div>`;
  }
  if (item === 'Type') {
    const sizes = ['xs', 'sm', 'md', 'lg', 'xl', 'input'].filter((k) => f['text-' + k]);
    return html`<div class="dz-sheet wide"><table class="table dz-tokens"><thead><tr><th>Token</th><th>Value</th><th>Sample</th><th>Design file</th></tr></thead><tbody>
      ${sizes.map((k) => html`<tr key=${k}><td class="mono">text/${k}</td><td class="mono muted">${f['text-' + k]}</td><td style=${{ fontSize: `var(--text-${k})`, fontWeight: k === 'xl' || k === 'lg' ? 'var(--weight-strong)' : null }}>Where should an agent's thread open?</td><td><${Only} /></td></tr>`)}
      ${['body', 'medium', 'strong'].filter((k) => f['weight-' + k]).map((k) => html`<tr key=${k}><td class="mono">weight/${k}</td><td class="mono muted">${f['weight-' + k]}</td><td style=${{ fontWeight: `var(--weight-${k})` }}>Project lead</td><td><${Only} /></td></tr>`)}
      ${['body', 'tight'].filter((k) => f['leading-' + k]).map((k) => html`<tr key=${k}><td class="mono">leading/${k}</td><td class="mono muted">${f['leading-' + k]}</td><td class="muted">Line height for ${k === 'body' ? 'reading' : 'headings'}</td><td><${Only} /></td></tr>`)}
      ${f.measure && html`<tr><td class="mono">measure</td><td class="mono muted">${f.measure}</td><td class="muted">The longest reading line</td><td><${Only} /></td></tr>`}
      ${['display', 'body', 'mono'].filter((k) => f['font-' + k]).map((k) => html`<tr key=${k}><td class="mono">font/${k}</td><td class="mono muted truncate" style="max-width:260px">${f['font-' + k].split(',')[0]}</td><td style=${{ fontFamily: `var(--font-${k})` }}>feat/agent-console · 4be2d65</td><td><${Only} /></td></tr>`)}
      ${!sizes.length && html`<tr><td colspan="4" class="muted" data-empty>No type variables</td></tr>`}</tbody></table></div>`;
  }
  if (item === 'Space and density') {
    const sp = keys(/^space-/); const dens = ['row', 'control', 'control-lg', 'inset', 'gap-group', 'topbar', 'tabrow'].filter((k) => f[k]);
    return html`<div class="dz-sheet wide"><div class="dz-ruler">${sp.map((k) => html`<div key=${k}><span class="mono">${k}</span><i style=${{ width: f[k] }}></i><span class="mono muted">${f[k]}</span></div>`)}
        ${!sp.length && html`<p class="muted" data-empty>No space variables</p>`}</div>
      <table class="table dz-tokens"><thead><tr><th>Token</th><th>Compact</th><th>Regular</th><th>Design file</th></tr></thead><tbody>
        ${dens.map((k) => html`<tr key=${k}><td class="mono">${k}</td><td class="mono">${f[k]}</td><td class="mono">${reg[k] || f[k]}</td><td><${Only} /></td></tr>`)}
        ${!dens.length && html`<tr><td colspan="4" class="muted" data-empty>No density variables</td></tr>`}</tbody></table></div>`;
  }
  if (item === 'Shape') {
    const r = keys(/^radius-/); const sh = keys(/^shadow-/);
    return html`<div class="dz-sheet"><div class="dz-tiles">${r.map((k) => html`<div key=${k} class="dz-tile"><i style=${{ borderRadius: f[k] }}></i><span class="mono">${k}</span><span class="mono muted">${f[k]}</span></div>`)}
      ${sh.map((k) => html`<div key=${k} class="dz-tile"><i style=${{ boxShadow: `var(--${k})`, border: 0 }}></i><span class="mono">${k}</span><span class="muted">Shadow</span></div>`)}
      ${!r.length && !sh.length && html`<div class="dz-tile dashed"><i></i><span class="muted">No shape variables</span></div>`}</div>
      ${r.length > 0 && html`<p class="dz-note"><${Only} /></p>`}</div>`;
  }
  if (item === 'Motion') {
    const m = ['motion-fast', 'motion-slow', 'ease'].filter((k) => f[k]);
    return html`<div class="dz-sheet wide"><table class="table dz-tokens"><thead><tr><th>Token</th><th>Value</th><th>Try it</th><th>Design file</th></tr></thead><tbody>
      ${m.map((k) => html`<tr key=${k}><td class="mono">${k}</td><td class="mono muted">${f[k]}</td><td><span class="dz-move" style=${{ '--dur': k === 'ease' ? 'var(--motion-slow)' : `var(--${k})` }}><i></i></span></td><td><${Only} /></td></tr>`)}
      ${!m.length && html`<tr><td colspan="4" class="muted" data-empty>No motion variables</td></tr>`}</tbody></table></div>`;
  }
  const names = hasFile ? Object.keys(ICONS) : [];
  return html`<div class="dz-sheet wide"><div class="dz-icons">${names.map((n) => html`<div key=${n}><${Icon} name=${n} size=${20} /><span class="mono">${n}</span></div>`)}
    ${!names.length && html`<div class="dashed"><span class="muted">Create the page Palette / Icons</span></div>`}</div></div>`;
}

// ---- the page ----------------------------------------------------------------------------
function itemsOf(cat, hasFile, t, design) {
  if (live.on) return [{ name: cat === 'Screens' ? 'No flows yet' : 'Overview', n: cat === 'Components' ? design?.components.length || 0 : cat === 'Palette' ? design?.tokens.length || 0 : 0 }];
  if (cat === 'Screens') return hasFile ? FLOWS.map(([name, fr]) => ({ name, n: fr.length })) : [{ name: 'No flows yet', n: 0 }];
  if (cat === 'Components') return [{ name: 'Overview', n: hasFile ? GROUPS.reduce((a, [, cs]) => a + cs.length, 0) : 0 }, ...GROUPS.map(([g, cs]) => ({ name: g, n: hasFile ? cs.length : 0 }))];
  const f = (hasFile && t) ? t.field : {}; const count = (re) => Object.keys(f).filter((k) => re.test(k)).length;
  const n = { Colour: count(/^color-/), Type: count(/^(text|weight|leading|font)-|^measure$/), 'Space and density': count(/^(space-|row$|control|inset$|gap-group$|topbar$|tabrow$)/), Shape: count(/^(radius|shadow)-/), Motion: count(/^(motion-|ease$)/), Icons: hasFile ? Object.keys(ICONS).length : 0 };
  return PALETTE.map((name) => ({ name, n: n[name] }));
}
const CATS = ['Screens', 'Components', 'Palette'];
const UNIT = { Screens: 'frame', Components: 'component', Palette: 'token' };
function PickMenu({ label, value, items, onPick, unit }) {
  return html`<${Menu} class="btn sm filter-btn dz-pick" label=${label} width=${260}
    trigger=${html`<b>${value}</b><${Icon} name="chevron-down" size=${12} />`}
    items=${items.map((x) => ({ label: x.name, sub: x.n == null ? '' : unit ? plural(x.n, unit) : String(x.n), checked: x.name === value, onSelect: () => onPick(x.name) }))} />`;
}
export function RepoDesign({ s, repoId, route }) {
  useEffect(() => { if (live.on) void mocks.loadDesign(repoId); }, [repoId, s.boardRevision]);
  const r = byId(s.repos, repoId); const now = useNow(); const t = useTokens();
  s.design = s.design || {}; const d = r && s.design[r.id]; const hasFile = !!d;
  const catSlug = route?.parts[3]; const itemSlug = route?.parts[4];
  const cat = CATS.find((x) => slug(x) === catSlug) || 'Screens';
  const items = itemsOf(cat, hasFile, t, d);
  const item = (items.find((x) => slug(x.name) === itemSlug) || items[0]).name;
  const to = (c, i) => go(`/r/${r.id}/design/${slug(c)}/${slug(i)}`);
  const ps = r ? s.projects.filter((p) => p.repo === r.id && !p.archived) : [];
  if (!r) return html`<div class="view-body"><div class="page"><p class="muted">This repository is not known.</p></div></div>`;
  const create = () => { if (live.on) { refuse(); return; } update(() => { s.design[r.id] = { file: `design/${r.name}.fig`, size: '12 kilobytes', pages: 1, frames: 0, changedAt: Date.now(), changedBy: null, commit: null }; r.design = true; }); act.toast(`Created design/${r.name}.fig`); };
  const by = d && agentOf(s, d.changedBy);
  const page = cat === 'Palette' ? (item === 'Icons' ? 'Palette / Icons' : `Variables · ${item}`) : cat === 'Screens' && item === 'No flows yet' ? 'Screens / Onboarding' : `${cat} / ${item}`;
  const flow = cat === 'Screens' ? (FLOWS.find(([n]) => n === item)?.[1] || []) : null;
  return html`<div class="view dz" aria-busy=${live.on && mocks.busy('read-design:' + repoId)}>
    <div class="tabrow dz-bar" role="tablist">
      <a class="tab" role="tab" aria-selected="false" href=${href('/r/' + r.id)}>Projects<span class="count">${ps.length}</span></a>
      <a class="tab" role="tab" aria-selected="true" href=${href(`/r/${r.id}/design`)}>Design</a>
      <span class="dz-sep"></span>
      <${PickMenu} label="Category" value=${cat} items=${CATS.map((c) => ({ name: c, n: null }))} onPick=${(c) => to(c, itemsOf(c, hasFile, t, d)[0].name)} />
      <${Icon} name="chevron-right" size=${13} class="faint" />
      <${PickMenu} label=${cat} value=${item} items=${items} unit=${UNIT[cat]} onPick=${(i) => to(cat, i)} />
      <span class="grow"></span>
      ${d && html`<span class="dz-file muted not-phone" title=${d.file}><span class="mono">${d.file}</span> · ${ago(d.changedAt, now) === 'now' ? 'just now' : ago(d.changedAt, now) + ' ago'}${by ? ` · ${by.name}` : live.on && d.changedBy ? ` · ${d.changedBy === 'owner' ? 'Owner' : d.changedBy}` : ''}</span>`}
      <${DesignCanvasControls} key=${cat + item} />
      ${d ? html`<button type="button" class="btn sm primary" disabled=${live.on && (!d.available || mocks.busy('read-design:' + r.id))} onClick=${() => live.on ? mocks.openDisplay({ _tag: 'editor', repoId: r.id, projectId: d.projectId, revisionId: d.revisionId }, 'Repository design editor') : act.toast(`Opening ${page} in OpenPencil`)}><${Icon} name="pencil-ruler" size=${13} /><span class="not-phone">Open in OpenPencil</span></button>`
        : html`<button type="button" class="btn sm primary" disabled=${live.on && mocks.busy('read-design:' + r.id)} onClick=${create}><${Icon} name="plus" size=${13} />Create design file</button>`}
    </div>
    <${DesignCanvas} key=${cat + item + (t ? 't' : '')} cat=${cat} item=${item} page=${page} flow=${flow} t=${t} hasFile=${hasFile} design=${d} repoId=${repoId} />
  </div>`;
}
// The zoom controls sit in the bar, and the canvas sits under it. They share one canvas
// state through this small channel, so the bar stays one row.
const channel = { c: null, listeners: new Set() };
function DesignCanvasControls() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); channel.listeners.add(f); return () => channel.listeners.delete(f); }, []);
  return channel.c ? html`<${ZoomControls} c=${channel.c} />` : null;
}
function DesignCanvas({ cat, item, page, flow, t, hasFile, design, repoId }) {
  const c = useCanvas({ initial: cat === 'Screens' ? 0.2 : 1 });
  channel.c = c;
  useEffect(() => { for (const f of channel.listeners) f(); });
  useEffect(() => () => { if (channel.c === c) channel.c = null; }, []);
  const label = html`<b>${page}</b>${cat === 'Screens' && hasFile && !live.on && html`<${Only} />`}`;
  return html`<${Canvas} c=${c} label=${label} empty=${!hasFile}>
    ${live.on ? html`<${RecordedDesign} cat=${cat} design=${design} repoId=${repoId} />` : cat === 'Screens' ? html`<${FlowSheet} frames=${hasFile ? flow : []} c=${c} page=${page} />`
      : cat === 'Components' ? html`<${ComponentSheet} items=${hasFile ? (GROUPS.find(([g]) => g === item)?.[1] || []) : []} overview=${hasFile && item === 'Overview'} group=${item} />`
      : html`<${PaletteSheet} item=${item} t=${t} hasFile=${hasFile} />`}
  <//>`;
}

// Registered design records have no flow grid, token modes or component groups.
// Keep the canvas and tables, with only the evidence the service returned.
function RecordedDesign({ cat, design, repoId }) {
  if (cat === 'Screens') return html`<p class="muted" data-empty>No flows</p>`;
  if (cat === 'Components') return html`<div class="table-wrap"><table class="table"><thead><tr><th>Component</th><th>Reference</th><th>Variants</th><th>Current evidence</th><th>Preview</th></tr></thead><tbody>
    ${(design?.components || []).map((c) => html`<tr key=${c.id}><td>${c.name}</td><td class="mono">${c.reference}</td><td>${c.variants}</td><td>${c.available ? 'Matches recorded fingerprint' : 'Unavailable or changed'}</td>
      <td>${c.preview && html`<button type="button" class="btn sm" disabled=${!design.available || !c.available} onClick=${() => mocks.openDisplay({ _tag: 'component', repoId, revisionId: design.revisionId, componentId: c.id }, c.name + ' preview')}>View component</button>`}</td></tr>`)}
    ${!design?.components.length && html`<tr><td colspan="5" class="muted" data-empty>No components</td></tr>`}
  </tbody></table></div>`;
  return html`<div class="table-wrap"><table class="table"><thead><tr><th>Token</th><th>Value</th></tr></thead><tbody>
    ${(design?.tokens || []).map((t) => html`<tr key=${t.name}><td class="mono">${t.name}</td><td class="mono">${t.value}</td></tr>`)}
    ${!design?.tokens.length && html`<tr><td colspan="2" class="muted" data-empty>No tokens</td></tr>`}
  </tbody></table></div>`;
}
