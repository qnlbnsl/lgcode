// Shared parts: avatars, menus, dialogs, the request block, the thread and the composer.
// These are built by hand, because the mock has no build step and so no component library.
import {
  html, useState, useEffect, useLayoutEffect, useRef, Icon, cx, ago, clock, dayLabel, useNow, useStore, update, go, href,
  useKey, HOUR, clamp, plural, isMac,
} from './lib.js';
import {
  agentOf, projectOf, teamOf, teamName, agentStatus, roleIcon, roleLabel, KIND_LABEL, HARNESSES, subOf, subLabel, machineOf,
  threadOf, openRequests, byId, routeForRequest, routeForAgent, agentLabel,
} from './data.js';
import * as act from './actions.js';

// ---- identity ---------------------------------------------------------------
export function Avatar({ agent, s, size, status = true }) {
  if (!agent) return html`<span class=${cx('avatar', size)}><${Icon} name="bot" size=${12} /></span>`;
  const st = status && s ? agentStatus(s, agent) : null;
  const lead = agent.role === 'project-lead';
  return html`<span class=${cx('avatar', size, lead && 'lead')} title=${roleLabel(agent)}>
    <${Icon} name=${roleIcon(agent)} size=${size === 'lg' ? 15 : size === 'sm' ? 12 : 13} />
    ${st && html`<i class=${cx('dot', st.dot.replace(' pulse', ''))}></i>`}
  </span>`;
}
export function OwnerAvatar({ s, size }) { return html`<span class=${cx('avatar owner', size)}>${s.owner.initials}</span>`; }
// "Builder 2 · Build team · Shell": the role first, then where it works.
export function AgentLine({ s, agent, link = true }) {
  const t = agent.team && teamOf(s, agent.team);
  const name = html`<b style="font-weight:var(--weight-medium)">${agent.name}</b>`;
  return html`<span class="row" style="gap:6px">
    <${Avatar} agent=${agent} s=${s} size="sm" />
    ${link ? html`<a class="truncate" href=${href(routeForAgent(s, agent))}>${name}</a>` : name}
    ${t && html`<span class="muted truncate">${teamName(t)}</span>`}
  </span>`;
}

// ---- text ---------------------------------------------------------------------
// A small Markdown subset: paragraphs, "- " lists, **bold**, `code`, and [[kind:id|text]] links.
function inline(text, pid) {
  const out = []; let rest = text; let k = 0;
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[\[(\w+):([\w-]+)\|([^\]]+)\]\])/;
  while (rest) {
    const m = re.exec(rest);
    if (!m) { out.push(rest); break; }
    if (m.index) out.push(rest.slice(0, m.index));
    if (m[1]) out.push(html`<b key=${k++} style="font-weight:var(--weight-strong)">${m[2]}</b>`);
    else if (m[3]) out.push(html`<code key=${k++}>${m[4]}</code>`);
    else {
      const to = m[6] === 'task' ? `/p/${pid}/task/${m[7]}` : m[6] === 'sprint' ? `/p/${pid}/sprint/${m[7]}` : m[6] === 'tab' ? `/p/${pid}/${m[7]}` : `/p/${pid}/board`;
      out.push(html`<a key=${k++} class="ref" href=${href(to)}>${m[8]}</a>`);
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}
export function Rich({ text, pid }) {
  const blocks = String(text).split(/\n\n+/);
  return blocks.map((b, i) => {
    const lines = b.split('\n');
    if (lines.every((l) => l.startsWith('- '))) return html`<ul class="bul" key=${i}>${lines.map((l, j) => html`<li key=${j}>${inline(l.slice(2), pid)}</li>`)}</ul>`;
    return html`<p key=${i}>${inline(b, pid)}</p>`;
  });
}

// ---- menus --------------------------------------------------------------------
// items: { label, icon, onSelect, checked, danger, disabled, why, sub, hint } | { sep: true } | { heading }
export function Menu({ trigger, items, align = 'start', side = 'bottom', class: cls, label, width, header }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [active, setActive] = useState(-1);
  const btn = useRef(null); const menu = useRef(null);
  const list = typeof items === 'function' ? (open ? items() : []) : items;
  const place = () => {
    const r = btn.current.getBoundingClientRect(); const m = menu.current.getBoundingClientRect();
    let left = align === 'end' ? r.right - m.width : r.left;
    left = clamp(left, 8, innerWidth - m.width - 8);
    let top = side === 'top' ? r.top - m.height - 4 : r.bottom + 4;
    if (top + m.height > innerHeight - 8) top = Math.max(8, r.top - m.height - 4);
    if (top < 8) top = 8;
    setPos({ left, top });
  };
  useLayoutEffect(() => { if (open) place(); else { setPos(null); setActive(-1); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (!menu.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false); };
    const key = (e) => {
      const idx = list.map((it, i) => (it.sep || it.heading || it.disabled ? -1 : i)).filter((i) => i >= 0);
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.current?.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => idx[(idx.indexOf(a) + 1) % idx.length]); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => idx[(idx.indexOf(a) - 1 + idx.length) % idx.length]); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); const it = list[active]; setOpen(false); it.onSelect?.(); }
    };
    addEventListener('pointerdown', away, true); addEventListener('keydown', key, true); addEventListener('resize', place);
    return () => { removeEventListener('pointerdown', away, true); removeEventListener('keydown', key, true); removeEventListener('resize', place); };
  }, [open, active, list.length]);
  return html`
    <button ref=${btn} type="button" class=${cls} aria-haspopup="menu" aria-expanded=${open} aria-label=${label} onClick=${(e) => { e.stopPropagation(); setOpen(!open); }}>${trigger}</button>
    ${open && html`<div ref=${menu} class="menu" role="menu" style=${{ left: (pos?.left ?? -9999) + 'px', top: (pos?.top ?? -9999) + 'px', width: width ? width + 'px' : null }} onClick=${(e) => e.stopPropagation()}>
      ${header}
      ${list.map((it, i) => it.sep ? html`<div class="menu-sep" key=${i}></div>`
        : it.heading ? html`<div class="menu-label" key=${i}>${it.heading}</div>`
        : html`<button key=${i} type="button" role=${it.checked != null ? 'menuitemradio' : 'menuitem'} aria-checked=${it.checked ?? null} disabled=${it.disabled}
            class=${cx('menu-item', it.danger && 'danger', (it.hint || it.why) && 'two')} data-active=${active === i}
            onMouseEnter=${() => setActive(i)} onClick=${() => { setOpen(false); it.onSelect?.(); }}>
            ${it.hint || it.why ? html`<span class="row">${it.icon && html`<${Icon} name=${it.icon} size=${14} />`}<span>${it.label}</span></span><small>${it.why || it.hint}</small>`
              : html`${it.icon && html`<${Icon} name=${it.icon} size=${14} />`}<span class="grow truncate">${it.label}</span>
                ${it.sub && html`<span class="sub">${it.sub}</span>`}${it.checked && html`<${Icon} name="check" size=${14} />`}`}
          </button>`)}
    </div>`}`;
}

// ---- dialogs ------------------------------------------------------------------
export function Dialog({ title, onClose, children, foot, size, onSubmit }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current.querySelector('[autofocus], input:not([type=hidden]), textarea, select, .dialog-foot .btn.primary, button');
    el?.focus();
    return () => prev?.focus?.();
  }, []);
  const key = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    if (e.key === 'Tab') {
      const f = [...ref.current.querySelectorAll('button:not([disabled]), input, textarea, select, a[href], [tabindex="0"]')];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  const Tag = onSubmit ? 'form' : 'div';
  return html`<div class="scrim" onPointerDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <${Tag} ref=${ref} class=${cx('dialog', size)} role="dialog" aria-modal="true" aria-label=${title} onKeyDown=${key} onSubmit=${onSubmit && ((e) => { e.preventDefault(); onSubmit(e); })}>
      <div class="dialog-head"><h2>${title}</h2><button type="button" class="icon-btn" aria-label="Close" onClick=${onClose}><${Icon} name="x" /></button></div>
      <div class="dialog-body">${children}</div>
      ${foot && html`<div class="dialog-foot">${foot}</div>`}
    <//>
  </div>`;
}
const dialogTypes = {};
export function registerDialog(type, component) { dialogTypes[type] = component; }
function ConfirmDialog({ d }) {
  return html`<${Dialog} title=${d.title} size="narrow" onClose=${act.closeDialog}
    foot=${html`<button type="button" class="btn" onClick=${act.closeDialog}>Cancel</button>
      <button type="button" class=${cx('btn', d.danger ? 'danger' : 'primary')} onClick=${() => { act.closeDialog(); d.onConfirm?.(); }}>${d.action}</button>`}>
    ${d.body && html`<p style="line-height:1.55">${d.body}</p>`}
    ${d.lost?.length > 0 && html`<ul class="col" style="gap:4px">${d.lost.map((l) => html`<li class="row"><${Icon} name="triangle-alert" size=${14} class="warn-text" /><span>${l}</span></li>`)}</ul>`}
  <//>`;
}
function RenameDialog({ d }) {
  const [v, setV] = useState(d.value); const taken = d.taken?.includes(v.trim()) && v.trim() !== d.value;
  const bad = !v.trim() ? 'A name is needed.' : taken ? 'That name is already in use.' : null;
  return html`<${Dialog} title=${d.title || 'Rename'} size="narrow" onClose=${act.closeDialog} onSubmit=${() => { if (!bad) { act.closeDialog(); d.onRename(v.trim()); } }}
    foot=${html`<button type="button" class="btn" onClick=${act.closeDialog}>Cancel</button><button type="submit" class="btn primary" disabled=${!!bad}>Rename</button>`}>
    <div class="field"><label for="rename-field">Name</label><input id="rename-field" class="input" value=${v} onInput=${(e) => setV(e.target.value)} autofocus />
      ${bad && v !== d.value && html`<span class="error">${bad}</span>`}</div>
    ${d.note && html`<p class="muted" style="font-size:var(--text-sm)">${d.note}</p>`}
  <//>`;
}
registerDialog('confirm', ConfirmDialog);
registerDialog('rename', RenameDialog);
export function DialogHost({ s }) {
  if (!s.dialog) return null;
  const C = dialogTypes[s.dialog.type];
  return C ? html`<${C} d=${s.dialog} s=${s} />` : null;
}
export function Toasts({ s }) {
  return html`<div class="toasts" role="status" aria-live="polite">${s.toasts.map((t) => html`<div key=${t.id} class=${cx('toast', t.tone === 'error' && 'error')}><${Icon} name=${t.tone === 'error' ? 'circle-alert' : 'circle-check'} size=${15} /><span>${t.text}</span></div>`)}</div>`;
}

// ---- resizing -----------------------------------------------------------------
export function Resizer({ side, value, min, max, onChange, reset, label }) {
  const [drag, setDrag] = useState(false);
  const start = (e) => {
    e.preventDefault(); setDrag(true);
    const x0 = e.clientX, v0 = value;
    const move = (ev) => onChange(clamp(v0 + (side === 'right' ? ev.clientX - x0 : x0 - ev.clientX), min, max));
    const up = () => { setDrag(false); removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  const key = (e) => {
    const step = side === 'right' ? 16 : -16;
    if (e.key === 'ArrowRight') onChange(clamp(value + step, min, max));
    else if (e.key === 'ArrowLeft') onChange(clamp(value - step, min, max));
    else if (e.key === 'Home') onChange(reset);
  };
  return html`<div class=${cx('resizer', side, drag && 'dragging')} role="separator" aria-orientation="vertical" aria-label=${label} aria-valuenow=${value} tabindex="0"
    onPointerDown=${start} onKeyDown=${key} onDblClick=${() => onChange(reset)} title="Drag to resize. Double-click to reset."></div>`;
}

// ---- the request block ----------------------------------------------------------
// One block for questions, approvals, merges and failed starts, on Home and in threads.
export function RequestBlock({ s, request: r, context = true, onHome = false }) {
  const now = useNow();
  const a = agentOf(s, r.agent); const p = projectOf(s, r.project);
  const [text, setText] = useState('');
  const open = r.status === 'open';
  const waited = now - r.createdAt;
  const oldest = openRequests(s)[0];
  const offer = open && s.phoneOffer === 'open' && !s.settings.ntfyServer && oldest && oldest.id === r.id;
  const primaryFirst = (opts) => opts.map((o, i) => html`<button key=${o.id} type="button"
      class=${cx('btn', o.primary && !r.blind && 'primary', o.id === 'deny' && 'ghost')}
      onClick=${() => act.answerRequest(r.id, o.id)}>${o.label}</button>`);
  return html`<section class=${cx('req', r.kind === 'failed' && 'failed', !open && 'closed')} id=${'req-' + r.id} aria-label=${KIND_LABEL[r.kind] + ': ' + r.title}>
    ${!onHome && html`<div class="req-head">
      <span class=${cx('kind', open ? r.kind : 'closed')}>${KIND_LABEL[r.kind]}</span>
      ${r.blocks && html`<span class="tag">blocks ${r.blocks}</span>`}
      <span class=${cx('age', open && waited >= HOUR && 'long')}>${open ? 'Waiting ' + ago(r.createdAt, now) : r.answer + ' · ' + clock(r.answeredAt)}</span>
    </div>
    <h4>${r.title}</h4>`}
    ${r.body && html`<div class="req-body"><p>${r.body}</p></div>`}
    ${r.recommendation && html`<p class="rec"><${Icon} name="sparkles" size=${14} /><span><b>${a.name} recommends:</b> ${r.recommendation}</span></p>`}
    ${r.why && open && html`<p class="rec"><${Icon} name="info" size=${14} /><span>${r.why}</span></p>`}
    ${r.kind === 'approval' && html`<dl class="kv">
      <dt>Command</dt><dd>${r.command || html`<span class="muted" style="font-family:var(--font-body)">Hidden by the harness. You cannot see what will be read.</span>`}</dd>
      <dt>Folder</dt><dd>${r.folder}</dd></dl>`}
    ${r.kind === 'merge' && html`<div class="evidence">
      <div class=${cx('ev', !r.evidence.tests.ok && 'missing')}><${Icon} name=${r.evidence.tests.ok ? 'circle-check' : 'triangle-alert'} size=${14} /><span>${r.evidence.tests.text}</span></div>
      <div class=${cx('ev', !r.evidence.review.ok && 'missing')}><${Icon} name=${r.evidence.review.ok ? 'circle-check' : 'triangle-alert'} size=${14} /><span>${r.evidence.review.text}</span>
        ${r.evidence.review.agent && html`<a class="link" href=${href(routeForAgent(s, agentOf(s, r.evidence.review.agent)))}>Open the review</a>`}</div>
      <div class="ev"><${Icon} name="git-commit-horizontal" size=${14} class="muted" /><span class="mono">${r.source}</span><${Icon} name="arrow-right" size=${12} class="muted" /><span class="mono">${r.target}</span><span class="muted">${r.evidence.commits} commits · ${r.evidence.files} files</span></div>
    </div>`}
    ${open && r.kind === 'question' && html`<div class="req-actions">
      ${primaryFirst(r.options || [])}
      <form class="row grow" style="flex:1 1 220px" onSubmit=${(e) => { e.preventDefault(); if (text.trim()) act.answerRequest(r.id, null, text.trim()); }}>
        <input class="input" placeholder="Or type another answer" aria-label="Another answer" value=${text} onInput=${(e) => setText(e.target.value)} />
        ${text.trim() && html`<button class="btn" type="submit">Send</button>`}
      </form>
    </div>`}
    ${open && r.kind === 'approval' && html`<div class="req-actions">${primaryFirst(r.options)}</div>`}
    ${open && r.kind === 'merge' && html`<div class="req-actions">
      <button type="button" class="btn primary" onClick=${() => act.openDialog({ type: 'merge-review', requestId: r.id })}>Review and merge</button>
      <a class="btn" href=${href(`/p/${r.project}/git`)}>Open in Git</a>
      <button type="button" class="btn ghost" onClick=${() => act.answerRequest(r.id, 'decline')}>Send back</button>
    </div>`}
    ${open && r.kind === 'failed' && html`<div class="req-actions">
      <button type="button" class="btn primary" onClick=${() => act.openDialog({ type: 'signin', subscription: a.failure?.subscription || a.subscription, then: r.id })}>Sign in on ${machineOf(s, a.failure?.machine || p.machine).name}</button>
      <button type="button" class="btn" onClick=${() => act.answerRequest(r.id, 'resume')}>Resume</button>
      <a class="btn ghost" href=${href('/subscriptions')}>Subscriptions</a>
    </div>`}
    ${!open && onHome && html`<div class="answer"><${Icon} name="check" size=${14} /><span>${r.answer} at ${clock(r.answeredAt)}</span></div>`}
    ${context && html`<div class="req-foot">
      <${AgentLine} s=${s} agent=${a} />
      ${onHome && html`<a class="link" href=${href(routeForRequest(s, r))}>Open in thread</a>`}
      ${r.files?.map((f) => html`<span class="tag">${f}</span>`)}
      <span class="grow"></span>
      <span>${machineOf(s, p.machine).name}</span>
    </div>`}
    ${offer && html`<div class="callout info" style="align-items:center">
      <${Icon} name="smartphone" size=${15} /><span class="grow">Get a phone notification the next time an agent waits for you.</span>
      <a class="btn sm" href=${href('/notifications')}>Set up</a>
      <button type="button" class="btn sm ghost" onClick=${act.declinePhoneOffer}>Not now</button>
    </div>`}
  </section>`;
}

// ---- threads ------------------------------------------------------------------
function ToolGroup({ item }) {
  return html`<details class="tools">
    <summary><${Icon} name="wrench" size=${13} /><span>${item.summary}</span><${Icon} name="chevron-right" size=${14} class="chev" /></summary>
    ${item.lines.map((l, i) => html`<div class="tool-line" key=${i}><span class="verb">${l.verb}</span><span class="arg">${l.arg}</span><span class="res">${l.res}</span></div>`)}
  </details>`;
}
function LargeItem({ item }) {
  const [state, setState] = useState('closed');
  const sample = ['round 2 · statement 11 · keyboard order at 390px', '  finding F-21 minor: focus leaves the drawer on Tab', '  finding F-22 major: Escape does not return focus to the menu button', 'round 2 · statement 12 · visible focus ring', '  no findings', 'round 2 · statement 13 · bottom key row', '  finding F-23 minor: Ctrl stays latched after Escape', 'round 2 · statement 14 · drawer order', '  finding F-24 minor: service pages come before agents', 'score: 6 points (1 major, 3 minor)', 'stuck statements: none', 'next: round 3 only if a major stays open'];
  return html`<div class="tools" style="grid-column:2">
    <div class="tool-line" style="border-top:0;min-height:var(--row)"><${Icon} name="file-text" size=${14} class="muted" /><span class="grow"><b style="font-weight:var(--weight-medium)">${item.title}</b> <span class="muted">(${item.size})</span></span>
      ${state === 'closed' && html`<button type="button" class="btn sm" onClick=${() => { setState('loading'); setTimeout(() => setState('open'), 600); }}>Load</button>`}
      ${state === 'loading' && html`<span class="muted">Loading…</span>`}
      ${state === 'open' && html`<button type="button" class="btn sm ghost" onClick=${() => { navigator.clipboard?.writeText(sample.join('\n')); act.toast('Copied'); }}><${Icon} name="copy" size=${13} />Copy</button>
        <button type="button" class="btn sm ghost" onClick=${() => act.openDialog({ type: 'large-item', title: item.title, lines: sample, total: item.lines })}>Open in full</button>`}
    </div>
    ${state === 'open' && html`<pre class="code" style="border-radius:0;max-height:240px">${sample.join('\n')}\n… ${item.lines - 12} more lines</pre>`}
  </div>`;
}
registerDialog('large-item', ({ d }) => html`<${Dialog} title=${d.title} size="wide" onClose=${act.closeDialog} foot=${html`<button type="button" class="btn" onClick=${act.closeDialog}>Close</button>`}>
  <pre class="code" style="max-height:60vh">${d.lines.join('\n')}\n… ${d.total - d.lines.length} more lines</pre><//>`);

export function Thread({ s, agentId, center, focusReq }) {
  const a = agentOf(s, agentId); const items = threadOf(s, agentId); const now = useNow();
  const box = useRef(null); const atEnd = useRef(true); const [away, setAway] = useState(false);
  const count = items.length + (s.pending[agentId] ? 1 : 0);
  // A thread opens at its latest message, and follows new ones while you are at the end.
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    el.style.scrollBehavior = 'auto';
    if (focusReq) { const t = el.querySelector('#req-' + focusReq); if (t) { t.scrollIntoView({ block: 'center' }); t.focus?.(); return; } }
    el.scrollTop = el.scrollHeight; el.style.scrollBehavior = '';
  }, [agentId, focusReq]);
  useLayoutEffect(() => { const el = box.current; if (el && atEnd.current) el.scrollTop = el.scrollHeight; }, [count]);
  const onScroll = (e) => { const el = e.currentTarget; atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; setAway(!atEnd.current); };
  const below = away ? openRequests(s, { agent: agentId }).length : 0;
  let lastDay = null;
  return html`<div style="position:relative;display:flex;flex-direction:column;flex:1;min-height:0">
    <div ref=${box} class=${cx('thread', center && 'center')} onScroll=${onScroll} tabindex="0" aria-label=${'Thread with ' + a.name}>
      ${items.length === 0 && html`<div class="empty" data-empty><strong>No messages yet</strong><span>${a.name} has not said anything. Send a message to start.</span></div>`}
      ${items.map((it) => {
        const d = dayLabel(it.ts, now); const head = d !== lastDay ? html`<div class="day" key=${'d' + it.id}>${d}</div>` : null; lastDay = d;
        let body;
        if (it.type === 'user') {
          const from = it.from ? agentOf(s, it.from) : null;
          body = html`<div class="msg user" key=${it.id}>
            ${from ? html`<${Avatar} agent=${from} s=${s} status=${false} />` : html`<${OwnerAvatar} s=${s} />`}
            <div class="meta"><span class="who">${from ? agentLabel(s, from) : 'You'}</span><time>${clock(it.ts)}</time></div>
            <div class="body"><${Rich} text=${it.text} pid=${a.project} />
              ${it.context?.length > 0 && html`<div class="row" style="flex-wrap:wrap;gap:4px">${it.context.map((c) => html`<span class="tag">${c}</span>`)}</div>`}</div>
          </div>`;
        } else if (it.type === 'agent') {
          body = html`<div class="msg" key=${it.id}>
            <${Avatar} agent=${a} s=${s} status=${false} />
            <div class="meta"><span class="who">${a.name}</span><span class="via">${HARNESSES[a.harness].name}</span><time>${clock(it.ts)}</time></div>
            <div class="body"><${Rich} text=${it.text} pid=${a.project} /></div>
            ${it.requests?.length > 0 && html`<div style="grid-column:2;display:grid;gap:2px;max-width:var(--measure)">${it.requests.map((id) => {
              const r = byId(s.requests, id); if (!r) return null; const ra = agentOf(s, r.agent); const open = r.status === 'open';
              return html`<a key=${id} class="list-row" style="padding:0 8px;margin-left:-8px" href=${href(routeForRequest(s, r))}>
                <span class=${cx('kind', open ? r.kind : 'closed')}>${KIND_LABEL[r.kind]}</span>
                <span class="truncate grow">${r.title}</span>
                <span class="muted" style="font-size:var(--text-sm);white-space:nowrap">${open ? agentLabel(s, ra, { withTeam: true }) : r.answer}</span>
                <${Icon} name="arrow-right" size=${13} class="muted" /></a>`;
            })}</div>`}
          </div>`;
        } else if (it.type === 'tools') body = html`<div class="msg" key=${it.id}><span></span><${ToolGroup} item=${it} /></div>`;
        else if (it.type === 'large') body = html`<div class="msg" key=${it.id}><span></span><${LargeItem} item=${it} /></div>`;
        else if (it.type === 'request') { const r = byId(s.requests, it.requestId); body = r ? html`<div key=${it.id} tabindex="-1"><${RequestBlock} s=${s} request=${r} context=${false} /></div>` : null; }
        else body = html`<div class="day" key=${it.id} style="text-transform:none;letter-spacing:0">${it.text} · ${clock(it.ts)}</div>`;
        return [head, body];
      })}
      ${s.pending[agentId] && html`<div class="msg"><${Avatar} agent=${a} s=${s} status=${false} /><div class="meta"><span class="who">${a.name}</span></div><div class="body"><span class="typing" aria-label="Writing a reply"><i></i><i></i><i></i></span></div></div>`}
    </div>
    ${away && html`<button type="button" class="btn sm" style="position:absolute;right:16px;bottom:8px;box-shadow:var(--shadow-1)" onClick=${() => { box.current.scrollTop = box.current.scrollHeight; }}>
      <${Icon} name="arrow-down" size=${13} />Latest${below ? ` · ${plural(below, 'request')} below` : ''}</button>`}
  </div>`;
}

// ---- composer -----------------------------------------------------------------
function ContextPicker({ s, agent, onAdd, onClose }) {
  const [q, setQ] = useState('');
  const tasks = s.tasks.filter((t) => t.project === agent.project).map((t) => ({ k: t.label, label: `${t.label} ${t.title}`, icon: 'list-checks' }));
  const files = [...new Set(s.tasks.filter((t) => t.project === agent.project).flatMap((t) => t.files))].map((f) => ({ k: f, label: f, icon: 'file-code' }));
  const match = (x) => x.label.toLowerCase().includes(q.toLowerCase());
  const T = tasks.filter(match).slice(0, 6), F = files.filter(match).slice(0, 6);
  useKey((e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }, []);
  const row = (x) => html`<button type="button" key=${x.k} class="menu-item" onClick=${() => onAdd(x.k)}><${Icon} name=${x.icon} size=${14} /><span class="truncate">${x.label}</span></button>`;
  return html`<div class="menu" style="position:absolute;left:8px;bottom:calc(100% + 4px);width:min(380px,calc(100% - 16px))">
    <div class="search" style="padding:2px"><${Icon} name="search" size=${14} /><input class="input" autofocus placeholder="Search tasks and files" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
    ${T.length > 0 && html`<div class="menu-label">Tasks</div>${T.map(row)}`}
    ${F.length > 0 && html`<div class="menu-label">Files</div>${F.map(row)}`}
    ${!T.length && !F.length && html`<div class="menu-label">Nothing matches "${q}".</div>`}
  </div>`;
}
export function Composer({ s, agentId, center }) {
  const a = agentOf(s, agentId); const key = 'thread:' + agentId;
  const [, bump] = useState(0); const [picking, setPicking] = useState(false); const [ctx, setCtx] = useState([]);
  const ta = useRef(null);
  const draft = s.drafts[key] || '';
  const st = agentStatus(s, a); const pending = !!s.pending[agentId];
  const fit = () => { const el = ta.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(220, el.scrollHeight) + 'px'; };
  useLayoutEffect(fit, [draft, agentId]);
  useEffect(() => { setCtx([]); setPicking(false); }, [agentId]);
  const send = () => { if (!draft.trim()) return; act.sendMessage(agentId, draft, ctx); setCtx([]); bump((n) => n + 1); };
  const onInput = (e) => {
    const v = e.target.value; act.setDraft(key, v); bump((n) => n + 1);
    const pos = e.target.selectionStart; if (v[pos - 1] === '@' && (pos === 1 || /\s/.test(v[pos - 2]))) setPicking(true);
  };
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } };
  const addCtx = (k) => { setCtx((c) => (c.includes(k) ? c : [...c, k])); setPicking(false); act.setDraft(key, draft.replace(/@$/, '')); bump((n) => n + 1); ta.current?.focus(); };
  const h = HARNESSES[a.harness];
  const subs = s.subscriptions.filter((x) => x.harness === a.harness);
  const busyLine = pending ? 'Working on your message' : (a.state === 'working' || a.state === 'waiting') && a.activity ? a.activity : null;
  const canStop = a.state === 'working' || a.state === 'waiting';

  if (a.state === 'failed') {
    return html`<div class=${cx('composer-wrap', center && 'center')}><div class="composer-state">
      <${Icon} name="circle-alert" class="error-text" /><div class="txt"><b>${a.name} failed to start.</b><small>${a.failure?.reason}. ${draft ? 'Your draft is kept.' : ''}</small></div>
      <button type="button" class="btn primary" onClick=${() => act.openDialog({ type: 'signin', subscription: a.failure?.subscription || a.subscription, then: openRequests(s, { agent: a.id })[0]?.id })}>Sign in on ${machineOf(s, a.failure?.machine || 'studio').name}</button>
      <button type="button" class="btn" onClick=${() => { const r = openRequests(s, { agent: a.id })[0]; r ? act.answerRequest(r.id, 'resume') : act.resumeAgent(a.id); }}>Resume</button>
    </div></div>`;
  }
  if (a.state === 'stopped') {
    return html`<div class=${cx('composer-wrap', center && 'center')}><div class="composer-state">
      <${Icon} name="circle-stop" class="muted" /><div class="txt"><b>${a.name} is stopped.</b><small>${draft ? 'Your draft is kept. ' : ''}Resume continues from its last turn.</small></div>
      <button type="button" class="btn primary" onClick=${() => act.resumeAgent(a.id)}><${Icon} name="play" size=${13} />Resume</button>
    </div></div>`;
  }
  return html`<div class=${cx('composer-wrap', center && 'center')}>
    ${(busyLine || canStop) && html`<div class="statusline">
      ${busyLine && html`<i class=${cx('dot', st.dot)}></i><span class="truncate">${busyLine}</span>`}
      ${canStop && html`<button type="button" class="btn sm" onClick=${() => act.stopAgent(a.id)}><${Icon} name="square" size=${11} />Stop agent</button>`}
    </div>`}
    <div class="composer" style="position:relative">
      ${picking && html`<${ContextPicker} s=${s} agent=${a} onAdd=${addCtx} onClose=${() => setPicking(false)} />`}
      ${ctx.length > 0 && html`<div class="ctx">${ctx.map((c) => html`<span class="chip" key=${c}><span class="mono">${c}</span><button type="button" aria-label=${'Remove ' + c} onClick=${() => setCtx(ctx.filter((x) => x !== c))}><${Icon} name="x" size=${11} /></button></span>`)}</div>`}
      <label class="sr" for=${'composer-' + agentId}>Message ${a.name}. Enter sends, Shift and Enter adds a line.</label>
      <textarea ref=${ta} id=${'composer-' + agentId} rows="1" placeholder=${`Message the ${a.name.toLowerCase()}…`} value=${draft} onInput=${onInput} onKeyDown=${onKey} disabled=${s.conn.status !== 'live'}></textarea>
      <div class="tools-row">
        <button type="button" class="pick" aria-expanded=${picking} onClick=${() => setPicking(!picking)} data-tip="Add a task or a file" data-tip-side="top"><${Icon} name="at-sign" size=${14} /><span class="not-narrow">Context</span></button>
        <${Menu} class="pick" side="top" label="Subscription" trigger=${html`<span class="truncate">${subLabel(s, a.subscription)}</span><${Icon} name="chevron-down" size=${12} />`}
          items=${[{ heading: 'Subscription' }, ...subs.map((x) => ({ label: `${h.name} · ${x.name}`, sub: machineOf(s, x.machine).name, checked: x.id === a.subscription, disabled: !x.signedIn, why: x.signedIn ? null : 'Signed out', onSelect: () => act.setAgentConfig(a.id, { subscription: x.id }) }))]} />
        <${Menu} class="pick" side="top" label="Model" trigger=${html`<span>${a.model}</span><${Icon} name="chevron-down" size=${12} />`}
          items=${[{ heading: 'Model, from the next turn' }, ...h.models.map((m) => ({ label: m, checked: m === a.model, onSelect: () => act.setAgentConfig(a.id, { model: m }) }))]} />
        <${Menu} class="pick" side="top" label="Effort" trigger=${html`<span>${a.effort}</span><${Icon} name="chevron-down" size=${12} />`}
          items=${[{ heading: 'Effort, from the next turn' }, ...h.efforts.map((m) => ({ label: m, checked: m === a.effort, onSelect: () => act.setAgentConfig(a.id, { effort: m }) }))]} />
        <span class=${cx('ctxuse', a.context >= 80 && 'warn-text')} data-tip="Share of the context window in use" data-tip-side="top">${a.context}%</span>
        ${pending
          ? html`<button type="button" class="send stop" aria-label="Stop this reply" data-tip="Stop this reply" data-tip-side="left" onClick=${() => act.stopReply(agentId)}><${Icon} name="square" size=${12} /></button>`
          : html`<button type="button" class="send" aria-label="Send" disabled=${!draft.trim() || s.conn.status !== 'live'} onClick=${send}><${Icon} name="arrow-up" size=${15} /></button>`}
      </div>
    </div>
  </div>`;
}

// ---- misc ---------------------------------------------------------------------
export function Tabs({ tabs, current, base }) {
  return tabs.map((t) => html`<a key=${t.id} class="tab" role="tab" aria-selected=${current === t.id} href=${href(base + t.id)}>
    ${t.icon && html`<${Icon} name=${t.icon} size=${14} />`}<span>${t.label}</span>${t.count > 0 && html`<span class=${cx('count', t.tone)}>${t.count}</span>`}</a>`);
}
export function Kbd({ k }) { return html`<kbd>${isMac ? html`<${Icon} name="command" size=${10} />` : 'Ctrl'} ${k}</kbd>`; }
export function Empty({ title, children, icon }) {
  return html`<div class="empty" data-empty>${icon && html`<${Icon} name=${icon} size=${18} />`}<strong>${title}</strong><span>${children}</span></div>`;
}
export function StateWord({ status }) { return html`<span class=${cx(status.tone === 'warn' && 'warn-text', status.tone === 'error' && 'error-text', !status.tone && 'muted')} style=${status.tone ? 'font-weight:var(--weight-medium)' : ''}>${status.word}</span>`; }
export { go };
