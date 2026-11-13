import * as chatLive from './live/chat.js';
import { live as liveMode, refuse } from './lib.js';
// Shared parts: avatars, menus, dialogs, the request block, the thread and the composer.
// These are built by hand, because the mock has no build step and so no component library.
import {
  html, useState, useEffect, useLayoutEffect, useRef, Icon, cx, ago, clock, dayLabel, useNow, useStore, update, go, href,
  useKey, HOUR, clamp, plural, isMac, uid,
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
  const [pending, setPending] = useState(false);
  const close = () => { if (!pending) act.closeDialog(); };
  const confirm = async () => {
    if (pending) return;
    if (!d.waitForReply) { act.closeDialog(); d.onConfirm?.(); return; }
    setPending(true);
    try { if (await d.onConfirm?.()) act.closeDialog(); } finally { setPending(false); }
  };
  return html`<${Dialog} title=${d.title} size="narrow" onClose=${close}
    foot=${html`<button type="button" class="btn" disabled=${pending} onClick=${close}>Cancel</button>
      <button type="button" class=${cx('btn', d.danger ? 'danger' : 'primary')} aria-busy=${pending} disabled=${pending} onClick=${confirm}>${pending ? d.pendingLabel || 'Working…' : d.action}</button>`}>
    ${d.body && html`<p style="line-height:1.55">${d.body}</p>`}
    ${d.lost?.length > 0 && html`<ul class="col" style="gap:4px">${d.lost.map((l) => html`<li class="row"><${Icon} name="triangle-alert" size=${14} class="warn-text" /><span>${l}</span></li>`)}</ul>`}
  <//>`;
}
function RenameDialog({ d }) {
  const [v, setV] = useState(d.value); const taken = d.taken?.includes(v.trim()) && v.trim() !== d.value;
  const bad = !v.trim() ? 'A name is needed.' : taken ? 'That name is already in use.' : null;
  const [pending, setPending] = useState(false);
  const close = () => { if (!pending) act.closeDialog(); };
  const rename = async () => {
    if (bad || pending) return;
    if (!d.waitForReply) { act.closeDialog(); d.onRename(v.trim()); return; }
    setPending(true);
    try { if (await d.onRename(v.trim())) act.closeDialog(); } finally { setPending(false); }
  };
  return html`<${Dialog} title=${d.title || 'Rename'} size="narrow" onClose=${close} onSubmit=${rename}
    foot=${html`<button type="button" class="btn" disabled=${pending} onClick=${close}>Cancel</button><button type="submit" class="btn primary" disabled=${!!bad || pending} aria-busy=${pending}>${pending ? 'Renaming…' : 'Rename'}</button>`}>
    <div class="field"><label for="rename-field">Name</label><input id="rename-field" class="input" disabled=${pending} value=${v} onInput=${(e) => setV(e.target.value)} autofocus />
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
// One block for questions, approvals, merges and failed starts. It has two shapes:
// "card" in a thread, with its own heading, and "detail" inside an expanded Home row,
// where the row already shows the title, the agent and the wait.
// `openThread` is an address or a function. It is left out when the block already sits
// in the asking agent's own thread.
// A question or an approval in a thread starts as a brief: what is asked and how long it
// has waited, one line of description, and the answer it needs. Details adds a short report
// under the brief without replacing it: who asked, the full question, what it is about, why
// it matters, the other answers, and the references.
function Cited({ text }) {
  return text.split(/(\[\d+\]|`[^`]+`)/).map((t, i) => /^\[\d+\]$/.test(t) ? html`<sup class="qc-cite" key=${i}>${t}</sup>`
    : /^`/.test(t) ? html`<code key=${i}>${t.slice(1, -1)}</code>` : t.replace(/ $/, ' '));
}
function Paras({ list }) { return (Array.isArray(list) ? list : [list]).filter(Boolean).map((t, i) => html`<p key=${i}><${Cited} text=${t} /></p>`); }
function BriefCard({ s, r, openThread, who }) {
  const now = useNow(); const a = agentOf(s, r.agent); const isQ = r.kind === 'question';
  const [open, setOpen] = useState(() => s.ui.panelReq === r.id);
  const [declined, setDeclined] = useState(false);
  const [text, setText] = useState(''); const own = useRef(null);
  const live = r.status === 'open' && !r.heldBy; const waited = now - r.createdAt;
  const opts = r.options || [];
  const rec = isQ ? opts.find((o) => o.primary) || null : null;
  const brief = r.brief || r.title; const summary = r.summary || (isQ ? r.body : null);
  const recShort = isQ ? r.recShort || r.recommendation : null; const id = 'qc-' + r.id;
  // The answers on the brief, and the rest in the report.
  const others = isQ ? opts.filter((o) => o !== rec) : [];
  // An approval answers with Allow and Deny. Each has a menu that makes the answer standing.
  const answer = (o) => act.answerRequest(r.id, o);
  // The default icon is a check for Allow and a cross for Deny. The sparkles icon replaces it
  // only on an action the agent recommends.
  const split = (label, icon, always, why, o) => html`<span class="split">
    <button type="button" class="btn" onClick=${() => answer(o)}><${Icon} name=${icon} size=${14} />${label}</button>
    <${Menu} class="btn split-more" label=${'More ways to ' + label.toLowerCase()} trigger=${html`<${Icon} name="chevron-down" size=${14} />`}
      items=${[{ label: always, why, onSelect: () => answer(o === 'deny' ? 'never' : 'always') }]} width=${280} /></span>`;
  const deny = () => { setDeclined(true); setOpen(true); requestAnimationFrame(() => own.current?.focus()); };
  // The live website answers with the options the harness sent. The one-time answer is the
  // button. A standing answer sits in its menu, with the harness's own wording as the note.
  const liveSplit = (label, icon, always, onceKind, alwaysKind) => {
    const once = opts.find((o) => o.kind === onceKind); if (!once) return null;
    const standing = opts.filter((o) => o.kind === alwaysKind); const busy = chatLive.requestBusy(r);
    return html`<span class="split">
      <button type="button" class="btn" disabled=${busy} title=${once.label} onClick=${() => answer(once.id)}><${Icon} name=${icon} size=${14} />${label}</button>
      ${standing.length > 0 && html`<${Menu} class="btn split-more" label=${'More ways to ' + label.toLowerCase()} trigger=${html`<${Icon} name="chevron-down" size=${14} />`}
        items=${standing.map((o) => ({ label: always, why: o.label, disabled: busy, onSelect: () => answer(o.id) }))} width=${320} />`}</span>`;
  };
  if (liveMode.on && r.status === 'open' && r.heldBy) return html`<section class="req qc" id=${'req-' + r.id}><b>${r.title}</b><p>${r.body}</p><p class="muted">Waiting on ${agentOf(s, r.heldBy).name}</p></section>`;
  if (!live) return html`<section class="req qc done" id=${'req-' + r.id} tabindex="-1" aria-label=${'Answered: ' + brief}>
    <div class="qc-top"><${Icon} name="check" size=${14} class="qc-ok" /><b class="qc-q">${brief}</b><span class="qc-age">${clock(r.answeredAt)}</span></div>
    <p class="qc-answer">${r.answer}</p></section>`;
  const thread = openThread && (typeof openThread === 'string'
    ? html`<a class="btn ghost qc-thread" href=${href(openThread)}><${Icon} name="message-square" size=${14} />Open thread</a>`
    : html`<button type="button" class="btn ghost qc-thread" onClick=${openThread}><${Icon} name="message-square" size=${14} />Open thread</button>`);
  return html`<section aria-busy=${liveMode.on && chatLive.requestBusy(r)} class=${cx('req qc', r.kind, open && 'open')} id=${'req-' + r.id} tabindex="-1" aria-label=${(isQ ? 'Question: ' : 'Approval: ') + brief}>
    <div class="qc-top"><b class="qc-q">${brief}</b><span class=${cx('qc-age', waited >= HOUR && 'long')}>${ago(r.createdAt, now)}</span></div>
    ${summary && html`<p class="qc-sum">${summary}</p>`}
    ${recShort && html`<p class=${cx('qc-rec', declined && 'declined')}><${Icon} name="sparkles" size=${14} class="qc-star" /><span>${recShort}</span>${declined && html`<span class="qc-tag">Declined</span>`}</p>`}
    ${open && html`<div class="qc-report" id=${id}>
      <p class="qc-meta">${who && html`<${Avatar} agent=${a} s=${s} size="sm" status=${false} /><span>Asked by ${agentLabel(s, a, { withTeam: true })}</span>`}${r.blocks && html`<span>Blocks ${r.blocks}</span>`}${!isQ && r.tool && html`<span>Tool ${r.tool}</span>`}</p>
      ${isQ && html`<section class="qc-part q"><h5>The question</h5><${Paras} list=${r.body || r.title} /></section>`}
      ${!isQ && html`<section class="qc-part"><h5>Command</h5>${r.command ? html`<pre class="qc-pre">${r.command}</pre>` : html`<p class="flat">Hidden by the harness. You cannot see this tool's input.</p>`}
        <h5 class="qc-sub">Folder</h5><pre class="qc-pre">${r.folder}</pre></section>`}
      ${r.what && html`<section class="qc-part"><h5>What it is about</h5><${Paras} list=${r.what} /></section>`}
      ${(r.whyText || r.why) && html`<section class="qc-part why"><h5>Why it matters</h5><${Paras} list=${r.whyText || r.why} /></section>`}
      ${r.recWhy && html`<section class="qc-part reco"><h5><${Icon} name="sparkles" size=${13} />Why this answer</h5><${Paras} list=${r.recWhy} /></section>`}
      ${(others.length > 0 || isQ) && html`<section class="qc-part"><h5>Other answers</h5>
        <ul class="qc-opts">
          ${others.map((o) => html`<li key=${o.id}><div><b>${o.label}</b>${o.note && html`<p>${o.note}</p>`}</div>
            <button disabled=${liveMode.on && chatLive.requestBusy(r)} type="button" class="btn sm" onClick=${() => act.answerRequest(r.id, o.id)}>Choose</button></li>`)}
          ${isQ && html`<li class="own"><form onSubmit=${(e) => { e.preventDefault(); if (text.trim()) act.answerRequest(r.id, null, text.trim()); }}>
            <input ref=${own} class="input" placeholder="Your own answer" aria-label="Your own answer" value=${text} onInput=${(e) => setText(e.target.value)} />
            <button type="submit" class="btn sm" disabled=${!text.trim() || (liveMode.on && chatLive.requestBusy(r))}>Send</button></form></li>`}
        </ul></section>`}
      ${r.refs?.length > 0 && html`<section class="qc-part refs"><h5>References</h5><ol>${r.refs.map((f, i) => html`<li key=${f}><span class="qc-cite">[${i + 1}]</span><span class="mono">${f}</span></li>`)}</ol></section>`}
    </div>`}
    <div class="req-actions qc-actions">
      ${!isQ && liveMode.on && liveSplit('Allow', 'check', 'Always allow', 'allow_once', 'allow_always')}
      ${!isQ && liveMode.on && liveSplit('Deny', 'x', 'Always deny', 'reject_once', 'reject_always')}
      ${!isQ && liveMode.on && opts.filter((o) => !['allow_once', 'allow_always', 'reject_once', 'reject_always'].includes(o.kind)
        || (o.kind === 'allow_always' && !opts.some((x) => x.kind === 'allow_once')) || (o.kind === 'reject_always' && !opts.some((x) => x.kind === 'reject_once')))
        .map((o) => html`<button key=${o.id} disabled=${chatLive.requestBusy(r)} type="button" class="btn" onClick=${() => answer(o.id)}>${o.label}</button>`)}
      ${rec && !declined && html`<button disabled=${liveMode.on && chatLive.requestBusy(r)} type="button" class="btn" onClick=${() => act.answerRequest(r.id, rec.id)}><${Icon} name="sparkles" size=${14} class="qc-star" />Accept</button>`}
      ${rec && !declined && html`<button type="button" class="btn" onClick=${deny}><${Icon} name="x" size=${14} />Deny</button>`}
      ${!isQ && !liveMode.on && split('Allow', 'check', 'Always allow', 'Runs commands like this one without asking, in this project only.', 'allow')}
      ${!isQ && !liveMode.on && split('Deny', 'x', 'Always deny', 'Refuses commands like this one without asking, in this project only.', 'deny')}
      <button type="button" class="btn" aria-expanded=${open} aria-controls=${id} onClick=${() => setOpen(!open)}>${open ? 'Hide details' : 'Details'}<${Icon} name=${open ? 'chevron-up' : 'chevron-down'} size=${14} /></button>
      ${thread}
    </div>
  </section>`;
}

// ---- merge brief --------------------------------------------------------------------
// A merge reads as a brief, the reason it needs the owner, one row of evidence, and the
// buttons. The same row of evidence sits in the merge review dialog.
export function MergeFacts({ s, r }) {
  const ev = r.evidence; const rv = ev.review.agent && agentOf(s, ev.review.agent);
  const cell = (k, tone, value, sub) => html`<div key=${k} class=${cx(tone === 'warn' && 'warn')}><dt>${k}</dt>
    <dd>${tone && html`<${Icon} name=${tone === 'ok' ? 'circle-check' : 'triangle-alert'} size=${13} />`}<span>${value}</span></dd>${sub && html`<dd class="sub">${sub}</dd>`}</div>`;
  const cf = ev.conflicts;
  return html`<dl class="mg-facts">
    ${cell('Tests', ev.tests.ok ? 'ok' : 'warn', ev.tests.value || (ev.tests.ok ? 'Passed' : 'Not run'), ev.tests.sub)}
    ${cell('Review', ev.review.ok ? 'ok' : 'warn', ev.review.value || (ev.review.ok ? 'Clean' : 'Not finished'), rv ? rv.name : ev.review.sub)}
    ${cell('Changes', null, `${plural(ev.commits, 'commit')} · ${plural(ev.files, 'file')}`, ev.add != null && html`<span class="success-text">+${ev.add}</span> <span class="error-text">−${ev.del}</span>`)}
    ${cell('Into ' + r.target, cf == null ? null : cf ? 'warn' : 'ok', cf == null ? 'Not checked' : cf ? plural(cf, 'conflict') : 'No conflicts', html`<span class="mono">${r.source}</span>`)}
  </dl>`;
}
function MergeBrief({ s, r, openThread }) {
  const [back, setBack] = useState(false); const [why, setWhy] = useState(''); const box = useRef(null);
  const live = r.status === 'open' && !r.heldBy;
  const thread = openThread && (typeof openThread === 'string'
    ? html`<a class="btn ghost qc-thread" href=${href(openThread)}><${Icon} name="message-square" size=${14} />Open thread</a>`
    : html`<button type="button" class="btn ghost qc-thread" onClick=${openThread}><${Icon} name="message-square" size=${14} />Open thread</button>`);
  const send = (e) => { e.preventDefault(); if (why.trim()) act.answerRequest(r.id, 'decline', why.trim()); };
  return html`<section aria-busy=${liveMode.on && chatLive.requestBusy(r)} class=${cx('req mg', !live && 'closed')} id=${'req-' + r.id} tabindex="-1" aria-label=${'Merge: ' + r.title}>
    <p class="mg-brief">${r.brief || r.body}</p>
    ${r.notice && html`<p class="mg-notice"><b>Users will notice:</b> ${r.notice}</p>`}
    <${MergeFacts} s=${s} r=${r} />
    ${live && !back && html`<div class="req-actions qc-actions">
      <button type="button" class="btn primary" onClick=${() => act.openDialog({ type: 'merge-review', requestId: r.id })}><${Icon} name="git-merge" size=${14} />Review and merge</button>
      <button type="button" class="btn" onClick=${() => { setBack(true); requestAnimationFrame(() => box.current?.focus()); }}><${Icon} name="undo-2" size=${14} />Send back</button>
      ${thread}</div>`}
    ${live && back && html`<form class="mg-back" onSubmit=${send}>
      <label for=${'why-' + r.id}>What should change?</label>
      <div class="row"><input id=${'why-' + r.id} ref=${box} class="input" value=${why} onInput=${(e) => setWhy(e.target.value)} placeholder="The redirects should keep the old anchors" />
        <button type="submit" class="btn" disabled=${!why.trim()}><${Icon} name="undo-2" size=${14} />Send back</button>
        <button type="button" class="btn ghost" onClick=${() => { setBack(false); setWhy(''); }}>Cancel</button></div></form>`}
    ${!live && html`<div class="answer"><${Icon} name="check" size=${14} /><span>${r.answer} at ${clock(r.answeredAt)}${r.reason ? ': ' + r.reason : ''}</span></div>`}
  </section>`;
}

export function RequestBlock({ s, request: r, variant = 'card', openThread = null, primary = false, who = true }) {
  if (variant === 'card' && (r.kind === 'question' || r.kind === 'approval')) return html`<${BriefCard} s=${s} r=${r} openThread=${openThread} who=${who} />`;
  if (variant === 'detail' && r.kind === 'merge') return html`<${MergeBrief} s=${s} r=${r} openThread=${openThread} />`;
  const now = useNow();
  const a = agentOf(s, r.agent); const p = projectOf(s, r.project);
  const [text, setText] = useState('');
  const open = r.status === 'open' && !r.heldBy;
  const waited = now - r.createdAt;
  const fill = (yes) => cx('btn', yes && primary && 'primary');
  const thread = openThread && (typeof openThread === 'string'
    ? html`<a class="btn ghost" href=${href(openThread)}><${Icon} name="message-square" size=${14} />Open thread</a>`
    : html`<button type="button" class="btn ghost" onClick=${openThread}><${Icon} name="message-square" size=${14} />Open thread</button>`);
  const opts = r.options || [];
  const rec = r.kind === 'question' && (r.recommendation || liveMode.on) ? opts.find((o) => o.primary) : null;
  const sub = a.failure && subOf(s, a.failure.subscription);
  const fixed = r.kind === 'failed' && sub && sub.signedIn;
  return html`<section aria-busy=${liveMode.on && chatLive.requestBusy(r)} class=${cx('req', variant, r.kind === 'failed' && 'failed', !open && 'closed')} id=${'req-' + r.id} tabindex="-1" aria-label=${KIND_LABEL[r.kind] + ': ' + r.title}>
    ${variant === 'card' && html`<div class="req-head">
      <span class=${cx('kind', open ? r.kind : 'closed')}>${KIND_LABEL[r.kind]}</span>
      ${who && html`<span class="req-who"><${Avatar} agent=${a} s=${s} size="sm" status=${false} />${agentLabel(s, a, { withTeam: true })}</span>`}
      <span class=${cx('age', open && waited >= HOUR && 'long')}>${open ? ago(r.createdAt, now) : r.answer + ' · ' + clock(r.answeredAt)}</span>
    </div>
    <h4>${r.title}</h4>`}
    ${r.body && html`<div class="req-body">${variant === 'detail' && html`<span class="req-label">Description</span>`}<p>${r.body}</p></div>`}
    ${r.recommendation && html`<p class="rec"><${Icon} name="sparkles" size=${14} /><span><b>Recommended:</b> ${r.recommendation}</span></p>`}
    ${r.kind === 'approval' && html`<dl class="kv">
      <dt>Command</dt><dd>${r.command || html`<span class="muted" style="font-family:var(--font-body)">Hidden by the harness</span>`}</dd>
      <dt>Folder</dt><dd>${r.folder}</dd></dl>`}
    ${r.kind === 'merge' && html`<div class="evidence">
      <div class=${cx('ev', !r.evidence.tests.ok && 'missing')}><${Icon} name=${r.evidence.tests.ok ? 'circle-check' : 'triangle-alert'} size=${14} /><span>${r.evidence.tests.text}</span></div>
      <div class=${cx('ev', !r.evidence.review.ok && 'missing')}><${Icon} name=${r.evidence.review.ok ? 'circle-check' : 'triangle-alert'} size=${14} /><span>${r.evidence.review.text}</span></div>
      <div class="ev"><${Icon} name="git-commit-horizontal" size=${14} class="muted" /><span class="mono">${r.source}</span><${Icon} name="arrow-right" size=${12} class="muted" /><span class="mono">${r.target}</span><span class="muted">${r.evidence.commits} commits · ${r.evidence.files} files</span></div>
    </div>`}
    ${open && r.kind === 'question' && html`<div class="req-actions">
      ${rec && html`<button disabled=${liveMode.on && chatLive.requestBusy(r)} type="button" class=${fill(true)} onClick=${() => act.answerRequest(r.id, rec.id)}><${Icon} name="check" size=${14} />Accept recommendation</button>`}
      ${opts.filter((o) => o !== rec).map((o) => html`<button disabled=${liveMode.on && chatLive.requestBusy(r)} key=${o.id} type="button" class="btn" onClick=${() => act.answerRequest(r.id, o.id)}>${o.label}</button>`)}
      <form aria-busy=${liveMode.on && chatLive.requestBusy(r)} class="row grow" style="flex:1 1 200px" onSubmit=${(e) => { e.preventDefault(); if (text.trim()) act.answerRequest(r.id, null, text.trim()); }}>
        <input class="input" placeholder="Another answer" aria-label="Another answer" value=${text} onInput=${(e) => setText(e.target.value)} />
        ${text.trim() && html`<button disabled=${liveMode.on && chatLive.requestBusy(r)} class="btn" type="submit">Send</button>`}
      </form>
      ${thread}
    </div>`}
    ${open && r.kind === 'approval' && html`<div class="req-actions">
      ${opts.map((o) => html`<button disabled=${liveMode.on && chatLive.requestBusy(r)} key=${o.id} type="button" class=${cx(fill(o.primary && !r.blind), o.id === 'deny' && 'ghost')} onClick=${() => act.answerRequest(r.id, o.id)}>${o.label}</button>`)}
      ${thread}</div>`}
    ${open && r.kind === 'merge' && html`<div class="req-actions">
      <button type="button" class=${fill(true)} onClick=${() => act.openDialog({ type: 'merge-review', requestId: r.id })}>Review and merge</button>
      <button disabled=${liveMode.on && chatLive.requestBusy(r)} type="button" class="btn" onClick=${() => act.answerRequest(r.id, 'decline')}>Send back</button>
      ${thread}</div>`}
    ${open && r.kind === 'failed' && html`<div class="req-actions">
      ${liveMode.on || fixed
        ? html`<button disabled=${liveMode.on && chatLive.requestBusy(r)} type="button" class=${fill(true)} onClick=${() => act.answerRequest(r.id, 'resume')}><${Icon} name="play" size=${13} />Resume</button>`
        : html`<button type="button" class=${fill(true)} onClick=${() => act.openDialog({ type: 'signin', subscription: a.failure?.subscription || a.subscription, then: r.id })}>Sign in on ${machineOf(s, a.failure?.machine || p.machine).name}</button>`}
      ${thread}</div>`}
    ${!open && variant === 'detail' && html`<div class="answer"><${Icon} name="check" size=${14} /><span>${r.answer} at ${clock(r.answeredAt)}</span></div>`}
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
  if (liveMode.on) return html`<div class="tools"><span>${item.title} (${item.size})</span><button type="button" class="btn sm" disabled=${chatLive.busy('large:' + item.sequence)} onClick=${() => chatLive.loadLarge(item)}>Load</button></div>`;
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

// The owner's messages sit on the right. Agents sit on the left.
// A request inside a thread is a card. Its "Open thread" goes through `onOpenThread`,
// which the project view points at the side panel.
export function Thread({ s, agentId, center, focusReq, onOpenThread }) {
  const a = agentOf(s, agentId); const items = threadOf(s, agentId); const now = useNow();
  useEffect(() => chatLive.watchThread(agentId), [agentId]);
  const box = useRef(null); const atEnd = useRef(true); const [away, setAway] = useState(false);
  const count = items.length + (s.pending[agentId] ? 1 : 0);
  // A thread opens at its latest message, and follows new ones while you are at the end.
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    el.style.scrollBehavior = 'auto';
    if (focusReq) { const t = el.querySelector('#req-' + focusReq); if (t) { t.scrollIntoView({ block: 'center' }); t.focus?.({ preventScroll: true }); el.style.scrollBehavior = ''; return; } }
    el.scrollTop = el.scrollHeight; el.style.scrollBehavior = '';
  }, [agentId, focusReq]);
  useLayoutEffect(() => { const el = box.current; if (el && atEnd.current && !focusReq) el.scrollTop = el.scrollHeight; }, [count, items]);
  const onScroll = (e) => { const el = e.currentTarget; atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; setAway(!atEnd.current); };
  const below = away ? openRequests(s, { agent: agentId }).length : 0;
  const opener = (r) => (r.agent === agentId ? null : onOpenThread ? () => onOpenThread(r.agent, r.id) : routeForRequest(s, r));
  let lastDay = null;
  return html`<div style="position:relative;display:flex;flex-direction:column;flex:1;min-height:0">
    <div ref=${box} class=${cx('thread', center && 'center')} onScroll=${onScroll} tabindex="0" aria-busy=${liveMode.on && chatLive.busy('thread:' + agentId)} aria-label=${'Thread with ' + a.name}>
      ${items.length === 0 && html`<div class="empty" data-empty><strong>${liveMode.on && chatLive.busy('thread:' + agentId) ? 'Loading thread…' : 'No messages yet'}</strong></div>`}
      ${items.map((it) => {
        const d = it.ts == null ? null : dayLabel(it.ts, now); const head = d !== lastDay ? html`<div class="day" key=${'d' + it.id}>${d}</div>` : null; lastDay = d;
        let body;
        if (it.type === 'user' && !it.from) {
          body = html`<div class="msg mine" key=${it.id}>
            <div class="meta"><time>${clock(it.ts)}</time></div>
            <div class="body">${it.text && html`<${Rich} text=${it.text} pid=${a.project} />`}
              <${Attachments} files=${it.files} sent=${true} />
              ${it.context?.length > 0 && html`<div class="row" style="flex-wrap:wrap;gap:4px">${it.context.map((c) => html`<span class="tag">${c}</span>`)}</div>`}</div>
          </div>`;
        } else if (it.type === 'user') {
          const from = agentOf(s, it.from);
          body = html`<div class="msg peer" key=${it.id}>
            <${Avatar} agent=${from} s=${s} status=${false} />
            <div class="meta"><span class="who">${agentLabel(s, from, { withTeam: true })}</span><time>${clock(it.ts)}</time></div>
            <div class="body"><${Rich} text=${it.text} pid=${a.project} /></div>
          </div>`;
        } else if (it.type === 'agent') {
          body = html`<div class="msg" key=${it.id}>
            <${Avatar} agent=${a} s=${s} status=${false} />
            <div class="meta"><span class="who">${a.name}</span><time>${clock(it.ts)}</time></div>
            <div class="body"><${Rich} text=${it.text} pid=${a.project} /></div>
            ${it.requests?.length > 0 && html`<div class="req-stack">${it.requests.map((id) => {
              const r = byId(s.requests, id); if (!r) return null;
              return html`<${RequestBlock} key=${id} s=${s} request=${r} openThread=${opener(r)} />`;
            })}</div>`}
          </div>`;
        } else if (it.type === 'tools') body = html`<div class="msg" key=${it.id}><span></span><${ToolGroup} item=${it} /></div>`;
        else if (it.type === 'large') body = html`<div class="msg" key=${it.id}><span></span><${LargeItem} item=${it} /></div>`;
        else if (it.type === 'request') { const r = byId(s.requests, it.requestId); body = r ? html`<div class="msg" key=${it.id}><span></span><div class="req-stack"><${RequestBlock} s=${s} request=${r} openThread=${opener(r)} who=${r.agent !== agentId} /></div></div>` : null; }
        else body = html`<div class="day" key=${it.id} style="text-transform:none;letter-spacing:0">${it.text} · ${clock(it.ts)}</div>`;
        return [head, body];
      })}
      ${s.pending[agentId] && html`<div class="msg"><${Avatar} agent=${a} s=${s} status=${false} /><div class="meta"><span class="who">${a.name}</span></div><div class="body"><span class="typing" aria-label="Writing a reply"><i></i><i></i><i></i></span></div></div>`}
    </div>
    ${away && html`<button type="button" class="btn sm" style="position:absolute;right:16px;bottom:8px;box-shadow:var(--shadow-1)" onClick=${() => { box.current.scrollTop = box.current.scrollHeight; }}>
      <${Icon} name="arrow-down" size=${13} />Latest${below ? ` · ${plural(below, 'request')} below` : ''}</button>`}
  </div>`;
}

// Only the project lead takes messages. Another agent's thread is read-only, and gains a
// reply box only while that agent has an open question for the owner.
export function canMessage(s, a) {
  return liveMode.on || a.role === 'project-lead' || openRequests(s, { agent: a.id }).some((r) => r.kind === 'question');
}
export function ReadOnlyBar({ s, agent, center, onLead }) {
  const st = agentStatus(s, agent); const p = projectOf(s, agent.project);
  return html`<div class=${cx('composer-wrap', center && 'center')}><div class="readonly-bar">
    <${Icon} name="eye" size=${15} class="muted" /><span class="grow truncate"><b>Read only</b><span class="muted"> · ${agent.activity || st.word}</span></span>
    ${onLead ? html`<button type="button" class="btn sm" onClick=${onLead}><${Icon} name="crown" size=${13} />Project lead</button>`
      : html`<a class="btn sm" href=${href(`/p/${p.id}/chat`)}><${Icon} name="crown" size=${13} />Project lead</a>`}
  </div></div>`;
}

// ---- composer -----------------------------------------------------------------
function ContextPicker({ s, agent, onAdd, onClose }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  useEffect(() => {
    if (!liveMode.on) return;
    let active = true;
    chatLive.searchContext(agent, q).then((items) => { if (active) setFound(items); }).catch((e) => { if (active) { setFound([]); act.toast(e.message, 'error'); } });
    return () => { active = false; };
  }, [agent.id, q]);
  const tasks = s.tasks.filter((t) => t.project === agent.project).map((t) => ({ k: t.label, label: `${t.label} ${t.title}`, icon: 'list-checks' }));
  const files = [...new Set(s.tasks.filter((t) => t.project === agent.project).flatMap((t) => t.files))].map((f) => ({ k: f, label: f, icon: 'file-code' }));
  const match = (x) => x.label.toLowerCase().includes(q.toLowerCase());
  const T = liveMode.on ? found.filter((x) => x.reference._tag === 'task') : tasks.filter(match).slice(0, 6), F = liveMode.on ? found.filter((x) => x.reference._tag === 'file') : files.filter(match).slice(0, 6);
  useKey((e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }, []);
  const row = (x) => html`<button type="button" key=${x.k} class="menu-item" onClick=${() => onAdd(liveMode.on ? x : x.k)}><${Icon} name=${x.icon} size=${14} /><span class="truncate">${x.label}</span></button>`;
  return html`<div class="menu" style="position:absolute;left:8px;bottom:calc(100% + 4px);width:min(380px,calc(100% - 16px))">
    <div class="search" style="padding:2px"><${Icon} name="search" size=${14} /><input class="input" autofocus placeholder="Search tasks and files" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
    ${T.length > 0 && html`<div class="menu-label">Tasks</div>${T.map(row)}`}
    ${F.length > 0 && html`<div class="menu-label">Files</div>${F.map(row)}`}
    ${!T.length && !F.length && html`<div class="menu-label">Nothing matches "${q}".</div>`}
  </div>`;
}
// Files and images go with a message. They come from the paperclip button, a drop on the
// message box, or a paste. A large photo is resized on this device before it is sent: the
// long edge becomes at most 2,048 pixels and the photo is saved as a JPEG. Redrawing it also
// drops the camera details, such as where the photo was taken. "Send original" keeps the
// file as it was. A photo the browser cannot read, such as a raw camera file, goes as a file.
const FILE_LIMIT = 100 * 1024 * 1024;
const EDGE = 2048; const SHRINK_OVER = 2 * 1024 * 1024;
const HEIC = /image\/hei[cf]|\.hei[cf]$/i;
export const fileSize = (n) => n < 1024 ? n + ' B' : n < 1024 * 1024 ? Math.round(n / 1024) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB';
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, EDGE / Math.max(bmp.width, bmp.height));
  if (k === 1 && file.size <= SHRINK_OVER) { bmp.close(); return null; }
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(bmp, 0, 0, w, h); bmp.close();
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  return blob && blob.size < file.size ? blob : null;
}
// What a staged attachment sends: the resized copy, unless the owner chose the original.
const sentForm = (f) => (f.small && !f.useOriginal ? { ...f, size: f.small.size, url: f.small.url, name: f.small.name, from: f.size } : f);
export function Attachments({ files, onRemove, onOriginal, sent }) {
  if (!files?.length) return null;
  const x = (f) => onRemove && html`<button type="button" class="att-x" aria-label=${'Remove ' + f.name} onClick=${() => onRemove(f.id)}><${Icon} name="x" size=${11} /></button>`;
  if (sent) {
    const pics = files.filter((f) => f.image); const docs = files.filter((f) => !f.image);
    return html`<div class="att sent">
      ${pics.length > 0 && html`<div class="att-pics">${pics.map((f) => html`<figure class="att-shot" key=${f.id}>
        <a class="att-pic" href=${f.url} target="_blank" rel="noopener" title=${f.name}><img src=${f.url} alt=${f.name} /></a>
        <figcaption>${fileSize(f.size)}${f.from ? ', resized from ' + fileSize(f.from) : ''}</figcaption></figure>`)}</div>`}
      ${docs.map((f) => html`<span class="att-file" key=${f.id}><${Icon} name="file" size=${14} class="faint" /><span class="truncate">${f.name}</span><span class="faint">${fileSize(f.size)}${f.note ? ' · ' + f.note : ''}</span></span>`)}
    </div>`;
  }
  return html`<div class="att">${files.map((f) => {
    if (!f.image) return html`<span class="att-img" key=${f.id}><span class="att-thumb file"><${Icon} name="file" size=${16} /></span>
      <span class="att-txt"><span class="truncate">${f.name}</span><span class="muted">${fileSize(f.size)}${f.note ? ' · ' + f.note : ''}</span></span>${x(f)}</span>`;
    const v = sentForm(f);
    const line = f.working ? 'Resizing…' : f.small ? (f.useOriginal ? `Original, ${fileSize(f.size)}` : `Resized from ${fileSize(f.size)} to ${fileSize(f.small.size)}`) : fileSize(f.size);
    return html`<span class="att-img" key=${f.id}>
      <span class="att-thumb">${v.url && html`<img src=${v.url} alt="" />`}</span>
      <span class="att-txt"><span class="truncate">${v.name}</span><span class="muted">${line}</span></span>
      ${f.small && html`<button type="button" class="link att-orig" onClick=${() => onOriginal(f.id)}>${f.useOriginal ? 'Send resized' : 'Send original'}</button>`}
      ${x(f)}</span>`; })}</div>`;
}
export function Composer({ s, agentId, center }) {
  const a = agentOf(s, agentId); const key = 'thread:' + agentId;
  const [, bump] = useState(0); const [picking, setPicking] = useState(false); const [ctx, setCtx] = useState([]);
  const [files, setFiles] = useState([]); const [over, setOver] = useState(false); const fileIn = useRef(null);
  const ta = useRef(null);
  const draft = s.drafts[key] || '';
  const st = agentStatus(s, a); const pending = !!s.pending[agentId];
  const fit = () => { const el = ta.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(220, el.scrollHeight) + 'px'; };
  useLayoutEffect(fit, [draft, agentId]);
  useEffect(() => { setCtx([]); setPicking(false); setFiles([]); }, [agentId]);
  const patch = (id, ch) => setFiles((cur) => cur.map((x) => (x.id === id ? { ...x, ...ch } : x)));
  const addFiles = (list) => {
    if (liveMode.on) { refuse(); return; }
    const ok = [...list].filter((f) => { if (f.size <= FILE_LIMIT) return true; act.toast(`${f.name} is larger than 100 MB`, 'error'); return false; });
    const items = ok.map((f) => { const pic = f.type.startsWith('image/') && !/gif|svg/.test(f.type);
      return { id: uid('f'), file: f, name: f.name || 'Pasted image.png', size: f.size, image: pic, working: pic, url: null }; });
    setFiles((cur) => [...cur, ...items]);
    for (const it of items.filter((x) => x.image)) {
      shrink(it.file).then((blob) => patch(it.id, { working: false, url: URL.createObjectURL(it.file),
        small: blob && { size: blob.size, url: URL.createObjectURL(blob), name: it.name.replace(/\.[^.]+$/, '') + '.jpg' } }))
        .catch(() => patch(it.id, { working: false, image: false, note: HEIC.test(it.file.type + ' ' + it.name) ? 'Converted by the service' : 'Sent as a file' }));
    }
    ta.current?.focus();
  };
  const dropOn = { onDragOver: (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); setOver(true); } },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); },
    onDrop: (e) => { e.preventDefault(); setOver(false); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); } };
  const onPaste = (e) => { const fl = e.clipboardData?.files; if (fl?.length) { if (!e.clipboardData.getData('text/plain')) e.preventDefault(); addFiles(fl); } };
  const live = s.conn.status === 'live';
  const ready = (draft.trim() || files.length) && !chatLive.busy('agent:' + agentId) && live && !files.some((f) => f.working);
  const send = async () => { if (!ready) return; if ((!draft.trim() && !files.length) || files.some((f) => f.working)) return; const sent = await act.sendMessage(agentId, draft, ctx, files.map(sentForm).map(({ file, small, working, useOriginal, ...f }) => f)); if (liveMode.on && !sent) return; setCtx([]); setFiles([]); bump((n) => n + 1); };
  const onInput = (e) => {
    const v = e.target.value; act.setDraft(key, v); bump((n) => n + 1);
    const pos = e.target.selectionStart; if (v[pos - 1] === '@' && (pos === 1 || /\s/.test(v[pos - 2]))) setPicking(true);
  };
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } };
  const addCtx = (k) => { setCtx((c) => (c.some((x) => (x.k || x) === (k.k || k)) ? c : [...c, k])); setPicking(false); act.setDraft(key, draft.replace(/@$/, '')); bump((n) => n + 1); ta.current?.focus(); };
  const h = HARNESSES[a.harness];
  const subs = s.subscriptions.filter((x) => x.harness === a.harness);
  const busyLine = liveMode.on && a.configuration?.status === 'pending' ? 'Model and effort apply from the next turn' : liveMode.on && ['refused', 'unsupported', 'unavailable'].includes(a.configuration?.status) ? a.configuration.status + ': ' + (a.configuration.reason || '') : pending ? 'Working on your message' : (a.state === 'working' || a.state === 'waiting') && a.activity ? a.activity : null;
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
      <button type="button" disabled=${liveMode.on && chatLive.busy('agent:' + a.id)} class="btn primary" onClick=${() => act.resumeAgent(a.id)}><${Icon} name="play" size=${13} />Resume</button>
    </div></div>`;
  }
  return html`<div class=${cx('composer-wrap', center && 'center')}>
    ${(busyLine || canStop) && html`<div class="statusline">
      ${busyLine && html`<i class=${cx('dot', st.dot)}></i><span class="truncate">${busyLine}</span>`}
      ${canStop && html`<button type="button" disabled=${liveMode.on && chatLive.busy('agent:' + a.id)} class="btn sm" onClick=${() => act.stopAgent(a.id)}><${Icon} name="square" size=${11} />Stop agent</button>`}
    </div>`}
    <div class=${cx('composer', over && 'drop')} style="position:relative" ...${dropOn}>
      ${over && html`<div class="drop-note" aria-hidden="true"><${Icon} name="upload" size=${16} />Drop to attach</div>`}
      ${picking && html`<${ContextPicker} s=${s} agent=${a} onAdd=${addCtx} onClose=${() => setPicking(false)} />`}
      ${ctx.length > 0 && html`<div class="ctx">${ctx.map((c) => html`<span class="chip" key=${c.k || c}><span class="mono">${c.label || c}</span><button type="button" aria-label=${'Remove ' + (c.label || c)} onClick=${() => setCtx(ctx.filter((x) => x !== c))}><${Icon} name="x" size=${11} /></button></span>`)}</div>`}
      <${Attachments} files=${files} onRemove=${(id) => setFiles(files.filter((f) => f.id !== id))} onOriginal=${(id) => patch(id, { useOriginal: !files.find((f) => f.id === id).useOriginal })} />
      <input ref=${fileIn} type="file" multiple hidden onChange=${(e) => { addFiles(e.target.files); e.target.value = ''; }} />
      <label class="sr" for=${'composer-' + agentId}>Message ${a.name}. Enter sends, Shift and Enter adds a line.</label>
      <textarea ref=${ta} id=${'composer-' + agentId} rows="1" placeholder=${`Message the ${a.name.toLowerCase()}…`} value=${draft} onInput=${onInput} onKeyDown=${onKey} onPaste=${onPaste} disabled=${!live}></textarea>
      <div class="tools-row">
        <button type="button" class="pick" aria-expanded=${picking} onClick=${() => setPicking(!picking)} data-tip="Add a task or a file" data-tip-side="top"><${Icon} name="at-sign" size=${14} /><span class="not-narrow">Context</span></button>
        <button type="button" class="pick" aria-label="Attach files or images" data-tip="Attach files or images" data-tip-side="top" disabled=${!live} onClick=${() => fileIn.current?.click()}><${Icon} name="paperclip" size=${14} /></button>
        <${Menu} class="pick" side="top" label="Subscription" trigger=${html`<span class="truncate">${subLabel(s, a.subscription)}</span><${Icon} name="chevron-down" size=${12} />`}
          items=${[{ heading: 'Subscription' }, ...subs.map((x) => ({ label: `${h.name} · ${x.name}`, sub: machineOf(s, x.machine).name, checked: x.id === a.subscription, disabled: !x.signedIn, why: x.signedIn ? null : 'Signed out', onSelect: () => act.setAgentConfig(a.id, { subscription: x.id }) }))]} />
        <${Menu} class="pick" side="top" label="Model" trigger=${html`<span>${a.model}</span><${Icon} name="chevron-down" size=${12} />`}
          items=${[{ heading: 'Model, from the next turn' }, ...(liveMode.on ? a.models || [] : h.models).map((m) => ({ label: m.label || m.id || m, checked: (m.id || m) === a.model, disabled: chatLive.busy('agent:' + a.id), onSelect: () => act.setAgentConfig(a.id, { model: m.id || m }) }))]} />
        <${Menu} class="pick" side="top" label="Effort" trigger=${html`<span>${a.effort}</span><${Icon} name="chevron-down" size=${12} />`}
          items=${[{ heading: 'Effort, from the next turn' }, ...(liveMode.on ? a.efforts || [] : h.efforts).map((m) => ({ label: m.label || m.id || m, checked: (m.id || m) === a.effort, disabled: chatLive.busy('agent:' + a.id), onSelect: () => act.setAgentConfig(a.id, { effort: m.id || m }) }))]} />
        <span class=${cx('ctxuse', a.context >= 80 && 'warn-text')} data-tip="Share of the context window in use" data-tip-side="top">${a.context == null ? '—' : a.context + '%'}</span>
        ${pending
          ? html`<button type="button" class="send stop" disabled=${chatLive.busy('agent:' + agentId)} aria-label="Stop this reply" data-tip="Stop this reply" data-tip-side="left" onClick=${() => act.stopReply(agentId)}><${Icon} name="square" size=${12} /></button>`
          : html`<button type="button" class="send" aria-label="Send" disabled=${!ready} onClick=${send}><${Icon} name="arrow-up" size=${15} /></button>`}
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
