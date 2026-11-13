import { live } from '../lib.js';
import * as chatLive from '../live/chat.js';
// The Messages tab and the Agents tab.
// Messages is the board the agents post on: team channels, the leads channel and direct
// messages. The owner reads all of it and can post. Agents is the roster, sorted by situation.
import {
  html, useState, useEffect, useLayoutEffect, useRef, Icon, cx, ago, clock, dayLabel, useNow, update, store, go, href,
  MIN, HOUR, uid, plural, persist, remember,
} from '../lib.js';
import {
  agentOf, teamOf, teamName, agentsOfProject, agentStatus, openRequests, byId, routeForAgent, routeForRequest,
  taskByLabel, HARNESSES, PERMISSION_MODES, machineOf, agentLabel, KIND_LABEL, subLabel,
} from '../data.js';
import * as act from '../actions.js';
import { Avatar, OwnerAvatar, Rich, Menu, Empty, StateWord } from '../ui.js';

// ---- vocabulary -------------------------------------------------------------------
const POST_KINDS = {
  question: { label: 'Question', icon: 'circle-help' },
  blocked: { label: 'Blocked', icon: 'circle-alert' },
  handoff: { label: 'Handoff', icon: 'forward' },
  done: { label: 'Done', icon: 'circle-check' },
  decision: { label: 'Decision', icon: 'milestone' },
  note: { label: 'Note', icon: 'message-square' },
};
const KIND_ORDER = ['question', 'blocked', 'handoff', 'done', 'decision', 'note'];
const WORK_STATES = { ready: 'Ready', reviewing: 'Reviewing', off: 'Off', assigned: 'Assigned', working: 'Working', waiting: 'Waiting', done: 'Done' };
const STALL_AFTER = 10 * MIN;
const CANNED = {
  question: 'Short answer: yes. I put the detail on the task and I am carrying on.',
  blocked: 'Understood. I am clearing that now, and I will post here when it is unblocked.',
  handoff: 'Taken. I start on it after the item I have open.',
  decision: 'Noted. I am planning to that decision from here.',
  done: 'Thanks. I pick up from there.',
  note: 'Noted.',
};

// ---- seed ---------------------------------------------------------------------------
export function seedBoard(state) {
  const at = (msAgo) => state.T - msAgo;
  const post = (id, channel, from, kind, action, text, msAgo, o = {}) => ({ id, channel, from, kind, action, text, ts: at(msAgo), to: [], replyTo: null, closed: false, ...o });
  state.channels.push(
    { id: 'dm-shell-builders', project: 'console', kind: 'dm', name: null, members: ['shell-b1', 'shell-b2'] },
    { id: 'dm-threads-pair', project: 'console', kind: 'dm', name: null, members: ['threads-b1', 'threads-tw'] },
    { id: 'dm-lead-review', project: 'console', kind: 'dm', name: null, members: ['console-lead', 'review-lead'] },
  );
  state.posts.push(
    post('p60', 'ch-console-leads', 'console-lead', 'decision', 'fyi', 'Two build teams work side by side after SP-01: Shell and Threads. Review stays at one reviewer.', 26 * HOUR),
    post('p61', 'ch-console-leads', 'shell-lead', 'done', 'fyi', 'SP-01 is merged into the project branch. The full run passed with 7,796 tests.', 25 * HOUR),
    post('p62', 'ch-console-leads', 'review-lead', 'question', 'needs-reply', 'Does SP-04 review the phone layout against the mocks or against the end-result page?', 24 * HOUR + 20 * MIN, { to: ['console-lead'] }),
    post('p63', 'ch-console-leads', 'console-lead', 'decision', 'fyi', 'Against the end-result page, statements 11 to 14. The mocks are a picture of it, not the contract.', 24 * HOUR + 14 * MIN, { replyTo: 'p62' }),
    post('p64', 'ch-console-shell', 'shell-lead', 'note', 'fyi', 'SP-03 is split into four subitems, 12 points in total. The plan is on the sprint page.', 3 * HOUR),
    post('p65', 'ch-console-shell', 'shell-test', 'done', 'fyi', 'Tests for AC-14 are written. 6 fail on their assertion, as they should.', 49 * MIN, { replyTo: 'p5' }),
    post('p66', 'ch-console-shell', 'shell-b1', 'note', 'fyi', 'The fold animation reads the existing motion token, so nothing new is added to the stylesheet.', 29 * MIN),
    post('p67', 'dm-shell-builders', 'shell-b2', 'question', 'needs-reply', 'Does the rail show the attention count as a number or as a dot? AC-15 needs to know which element to count.', 27 * MIN, { to: ['shell-b1'] }),
    post('p68', 'dm-shell-builders', 'shell-b1', 'note', 'fyi', 'A dot on the rail and a number in the full sidebar. Both read `openRequests`.', 25 * MIN, { replyTo: 'p67' }),
    post('p69', 'dm-threads-pair', 'threads-tw', 'handoff', 'needs-reply', 'The scroll tests expect a `data-latest` attribute on the Latest button. Can AC-18 add it?', 38 * MIN, { to: ['threads-b1'] }),
    post('p70', 'ch-console-threads', 'threads-lead', 'note', 'fyi', 'Builder 1 is merged into the team branch up to commit 79cd51d.', 22 * MIN),
    post('p71', 'ch-console-review', 'review-lead', 'note', 'fyi', 'Round 2 has 4 findings so far: 0 blockers, 1 major and 3 minors, for 6 points.', 16 * MIN),
  );
  // What a blocked post holds up, and the request that would clear it.
  const patch = { p4: { blocks: 'SP-04', request: 'q-trace' }, p14: { blocks: 'AC-16', request: 'q-trace' }, p12: { blocks: 'AC-18' }, p30: { blocks: 'IE-5', request: 'q-failed' }, p7: { request: 'q-tests' } };
  for (const p of state.posts) if (patch[p.id]) Object.assign(p, patch[p.id]);
  // When the owner last read each channel.
  state.boardRead = {
    'ch-console-leads': at(20 * MIN), 'ch-console-shell': at(10 * MIN), 'ch-console-threads': at(30 * MIN), 'ch-console-review': at(20 * MIN),
    'dm-shell-threads': at(5 * MIN), 'dm-shell-builders': at(26 * MIN), 'dm-threads-pair': at(60 * MIN),
    'ch-rules-plan': at(25 * MIN), 'ch-exports-build': at(20 * MIN), 'ch-phone-design': at(HOUR), 'ch-apiref-review': at(HOUR),
  };
  // When each agent last printed anything, for the stall watch.
  let n = 0;
  for (const a of state.agents) {
    n += 1;
    const req = state.requests.find((r) => r.agent === a.id && r.status === 'open');
    a.lastOutputAt = a.stalled ? at(14 * MIN) : a.state === 'working' ? at((n % 5) * 22_000 + 9_000)
      : req ? req.createdAt : a.state === 'waiting' ? at(17 * MIN) : a.state === 'failed' ? at(41 * MIN) : at((1 + (n % 4)) * HOUR + n * MIN);
  }
}

// ---- reads --------------------------------------------------------------------------
const repliesOf = (s, p) => s.posts.filter((x) => x.replyTo === p.id).sort((a, b) => a.ts - b.ts);
function replyState(s, p, now) {
  if (p.action !== 'needs-reply') return null;
  if (p.closed) return { answered: true };
  const rs = repliesOf(s, p);
  if (rs.some((r) => (p.from === 'owner' ? r.from !== 'owner' : r.from === 'owner' || !p.to.length || p.to.includes(r.from)))) return { answered: true };
  return { answered: false, stalled: now - p.ts >= STALL_AFTER };
}
const who = (s, id) => (id === 'owner' ? null : agentOf(s, id));
const whoName = (s, id, wide) => (id === 'owner' ? 'You' : agentLabel(s, agentOf(s, id), { withTeam: wide }));
function channelLabel(s, ch) {
  if (ch.kind === 'dm') return ch.members.map((m) => whoName(s, m, true)).join(' and ');
  return ch.name;
}
// The short form for the channel list: same-team pairs drop the team, leads are named by area.
function channelShort(s, ch) {
  if (ch.kind !== 'dm') return ch.name;
  const ms = ch.members.map((m) => agentOf(s, m)); const t = teamOf(s, ms[0].team);
  const same = t && ms.every((m) => m.team === t.id);
  if (same) return ms.map((m) => m.name).join(', ') + (t.area ? ' · ' + t.area : '');
  return ms.map((m) => { const mt = m.team && teamOf(s, m.team); return m.role === 'team-lead' && mt && mt.area ? `${mt.area} lead` : m.name; }).join(', ');
}
function channelAbout(s, ch) {
  if (ch.kind === 'leads') return 'The project lead and every team lead';
  if (ch.kind === 'team') return teamName(teamOf(s, ch.team));
  const t = teamOf(s, (agentOf(s, ch.members[0]) || {}).team); const same = ch.members.every((m) => (agentOf(s, m) || {}).team === (t && t.id));
  if (same && t && t.needToKnow) return 'Need to know: readable by these two, by you and by the evaluators';
  return same && t ? `Direct message inside ${teamName(t)}` : 'Direct message between two leads';
}
const isPrivate = (s, ch) => { const t = ch.kind === 'dm' && teamOf(s, (agentOf(s, ch.members[0]) || {}).team); return !!(t && t.needToKnow && ch.members.every((m) => agentOf(s, m).team === t.id)); };
const unreadOf = (s, ch) => s.posts.filter((p) => p.channel === ch.id && p.from !== 'owner' && p.ts > (s.boardRead[ch.id] || 0)).length;
const waitingIn = (s, ch, now) => s.posts.filter((p) => p.channel === ch.id && replyState(s, p, now)?.answered === false);
// Task and sprint labels in a post become links.
function linkify(s, pid, text) {
  return text.replace(/\b([A-Z]{2}-\d+)\b/g, (m) => {
    const t = taskByLabel(s, pid, m); if (t) return `[[task:${t.id}|${m}]]`;
    const sp = s.sprints.find((x) => x.project === pid && x.label === m);
    return sp ? `[[sprint:${sp.id}|${m}]]` : m;
  });
}

// ---- writes -------------------------------------------------------------------------
function sendPost({ channel, kind, action, to, text, replyTo }) {
  const id = uid('p'); const s0 = store.state; const ch = byId(s0.channels, channel);
  const root = replyTo && byId(s0.posts, replyTo);
  update((s) => {
    s.posts.push({ id, channel, from: 'owner', kind, action, text: text.trim(), ts: Date.now(), to, replyTo: replyTo || null, closed: false });
    s.boardRead[channel] = Date.now();
  });
  // The owner's posts always wake the people they are addressed to.
  const responder = to[0] || (root && root.from !== 'owner' ? root.from : ch.members[0]);
  const a = agentOf(s0, responder);
  if (!a || a.state === 'stopped' || a.state === 'failed') { act.toast(`${a ? a.name : 'That agent'} is not running, so the post waits for it.`); return; }
  setTimeout(() => update((s) => {
    s.posts.push({ id: uid('p'), channel, from: responder, kind: kind === 'question' || kind === 'blocked' ? 'note' : kind === 'handoff' ? 'done' : 'note', action: 'fyi', text: CANNED[kind], ts: Date.now(), to: [], replyTo: replyTo || id, closed: false });
  }), 1700);
}
const setClosed = (id, closed) => update((s) => { byId(s.posts, id).closed = closed; });
function nudge(agentId) {
  if (live.on) return chatLive.nudge(agentId);
  const s0 = store.state; const a = agentOf(s0, agentId);
  const ch = s0.channels.find((c) => c.team === a.team) || s0.channels.find((c) => c.project === a.project && c.kind === 'leads') || s0.channels.find((c) => c.project === a.project);
  const wasStalled = a.stalled; const id = uid('p');
  update((s) => {
    if (ch) s.posts.push({ id, channel: ch.id, from: 'owner', kind: 'question', action: 'needs-reply', text: 'Status check: what are you on, and is anything in your way?', ts: Date.now(), to: [agentId], replyTo: null, closed: false });
  });
  act.toast(`Nudged ${agentLabel(s0, a, { withTeam: true })}${ch ? ` in ${ch.kind === 'dm' ? 'a direct message' : '#' + ch.name}` : ''}`);
  if (a.state === 'stopped' || a.state === 'failed') return;
  setTimeout(() => update((s) => {
    const ag = agentOf(s, agentId); ag.lastOutputAt = Date.now();
    if (wasStalled) { ag.stalled = false; ag.activity = 'Running pnpm typecheck again'; }
    if (ch) s.posts.push({ id: uid('p'), channel: ch.id, from: agentId, kind: 'note', action: 'fyi', ts: Date.now(), to: [], replyTo: id, closed: false,
      text: wasStalled ? 'The typecheck hung on a stale language server. I restarted it, and output is flowing again.' : ag.activity ? `${ag.activity}. Nothing is in my way.` : 'Nothing is assigned to me right now.' });
  }), 1500);
}

// ---- Messages: small parts ------------------------------------------------------------
function KindTag({ kind }) {
  const k = POST_KINDS[kind] || POST_KINDS.note;
  return html`<span class=${cx('pk', kind)}><${Icon} name=${k.icon} size=${12} />${k.label}</span>`;
}
function Face({ s, id, size }) { return id === 'owner' ? html`<${OwnerAvatar} s=${s} size=${size} />` : html`<${Avatar} agent=${who(s, id)} s=${s} size=${size} />`; }
function ReplyWord({ s, p, now }) {
  const st = replyState(s, p, now);
  if (!st) return html`<span class="delivery fyi" data-tip="For reading. It wakes nobody." data-tip-side="top">FYI</span>`;
  if (st.answered) return html`<span class="delivery answered"><${Icon} name="check" size=${12} />Answered</span>`;
  return html`<span class=${cx('delivery waiting', st.stalled && 'stalled')}><${Icon} name=${st.stalled ? 'triangle-alert' : 'reply'} size=${12} />${st.stalled ? 'No reply for ' : 'Needs reply · '}${ago(p.ts, now)}</span>`;
}

function Post({ s, p, ch, pid, now, grouped, selected, onThread, inThread, showChannel }) {
  const wide = ch.kind !== 'team'; const a = who(s, p.from); const t = a && a.team && teamOf(s, a.team);
  const replies = inThread ? [] : repliesOf(s, p); const last = replies[replies.length - 1];
  const st = replyState(s, p, now); const req = p.request && byId(s.requests, p.request);
  const reqOpen = req && req.status === 'open';
  const plain = p.kind === 'note' && !p.to.length; // a plain note needs no tag line
  return html`<article class=${cx('post', grouped && 'grouped', selected && 'selected', st && !st.answered && 'open', st?.stalled && 'stalled')} id=${'post-' + p.id}>
    <div class="post-face">${grouped ? html`<time class="post-time">${clock(p.ts)}</time>` : html`<${Face} s=${s} id=${p.from} />`}</div>
    <div class="post-main">
      ${!grouped && html`<header class="post-meta">
        ${a ? html`<a class="who" href=${href(routeForAgent(s, a))}>${a.name}</a>` : html`<span class="who">You</span>`}
        ${a && wide && html`<span class="team">${t ? teamName(t) : 'Project'}</span>`}
        <time title=${new Date(p.ts).toLocaleString()}>${clock(p.ts)}</time>
        ${showChannel && html`<a class="in-ch" href=${href(`/p/${pid}/messages/${ch.id}`)}>${ch.kind === 'dm' ? 'Direct message' : '#' + ch.name}</a>`}
        <${ReplyWord} s=${s} p=${p} now=${now} />
      </header>`}
      ${plain ? null : html`<div class="post-tags">
        ${!plain && html`<${KindTag} kind=${p.kind} />`}
        ${p.to.length > 0 && html`<span class="to truncate"><${Icon} name="arrow-right" size=${11} />${p.to.map((id) => whoName(s, id, wide)).join(', ')}</span>`}
        ${grouped && html`<${ReplyWord} s=${s} p=${p} now=${now} />`}
      </div>`}
      <div class="post-text"><${Rich} text=${linkify(s, pid, p.text)} pid=${pid} /></div>
      ${(p.blocks || req) && p.kind !== 'done' && html`<div class=${cx('post-block', reqOpen && 'needs-you')}>
        <${Icon} name=${reqOpen ? 'bell-ring' : 'lock'} size=${13} />
        ${p.blocks && html`<span>Blocks <${Rich} text=${linkify(s, pid, p.blocks)} pid=${pid} /></span>`}
        ${req && html`<a class="link" href=${href(routeForRequest(s, req))}>${reqOpen ? `${KIND_LABEL[req.kind]} waits for you: ${req.title}` : `${KIND_LABEL[req.kind]} ${String(req.answer || 'answered').toLowerCase()}: ${req.title}`}</a>`}
        ${!req && st && !st.answered && html`<span class="muted">Nobody has picked this up.</span>`}
      </div>`}
      ${p.kind === 'done' && reqOpen && html`<div class="post-block needs-you"><${Icon} name="bell-ring" size=${13} /><a class="link" href=${href(routeForRequest(s, req))}>${KIND_LABEL[req.kind]} waits for you: ${req.title}</a></div>`}
      ${replies.length > 0 && html`<button type="button" class="post-replies" onClick=${() => onThread(p)}>
        <span class="avatar-stack">${[...new Set(replies.map((r) => r.from))].slice(0, 3).map((id) => html`<${Face} key=${id} s=${s} id=${id} size="sm" />`)}</span>
        <b>${plural(replies.length, 'reply', 'replies')}</b>
        <span class="snip truncate">${whoName(s, last.from, wide)}: ${last.text}</span>
        <span class="when">${ago(last.ts, now)}</span><${Icon} name="chevron-right" size=${13} />
      </button>`}
    </div>
    ${!inThread && html`<div class="post-acts">
      <button type="button" class="icon-btn sm" aria-label="Reply in thread" data-tip="Reply in thread" data-tip-side="top" onClick=${() => onThread(p)}><${Icon} name="reply" size=${14} /></button>
      ${st && html`<button type="button" class="icon-btn sm" aria-label=${st.answered ? 'Reopen' : 'Mark as answered'} data-tip=${st.answered ? 'Reopen' : 'Mark as answered'} data-tip-side="top" onClick=${() => setClosed(p.id, !p.closed)} disabled=${st.answered && !p.closed}><${Icon} name=${p.closed ? 'rotate-ccw' : 'check'} size=${14} /></button>`}
      ${a && html`<a class="icon-btn sm" aria-label=${'Open chat with ' + a.name} data-tip="Open chat" data-tip-side="left" href=${href(routeForAgent(s, a))}><${Icon} name="message-square" size=${14} /></a>`}
    </div>`}
  </article>`;
}

// The owner's composer on the board: a kind, who it is for, and whether it needs a reply.
function PostComposer({ s, ch, replyTo, placeholder }) {
  const key = 'board:' + (replyTo || ch.id);
  const [text, setText] = useState(s.drafts[key] || ''); const [kind, setKind] = useState(replyTo ? 'note' : 'question');
  const [action, setAction] = useState(replyTo ? 'fyi' : 'needs-reply'); const [to, setTo] = useState([]);
  const ta = useRef(null);
  useEffect(() => { setText(s.drafts[key] || ''); setTo([]); }, [key]);
  useLayoutEffect(() => { const el = ta.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(160, el.scrollHeight) + 'px'; }, [text]);
  const set = (v) => { setText(v); act.setDraft(key, v); };
  const send = () => { if (!text.trim()) return; sendPost({ channel: ch.id, kind, action, to, text, replyTo }); set(''); };
  const members = ch.members.map((m) => agentOf(s, m)).filter(Boolean);
  const toLabel = to.length ? to.map((id) => whoName(s, id, ch.kind !== 'team')).join(', ') : ch.kind === 'dm' ? 'Both' : 'Everyone here';
  const off = s.conn.status !== 'live';
  return html`<div class="composer board-composer">
    <label class="sr" for=${'pc-' + key}>Post to ${channelLabel(s, ch)}. Enter sends, Shift and Enter adds a line.</label>
    <textarea ref=${ta} id=${'pc-' + key} rows="1" placeholder=${placeholder || (ch.kind === 'dm' ? 'Post into this direct message…' : `Post to #${ch.name}…`)} value=${text} disabled=${off}
      onInput=${(e) => set(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } }}></textarea>
    <div class="tools-row">
      <${Menu} class="pick" side="top" label="Kind of post" trigger=${html`<${Icon} name=${POST_KINDS[kind].icon} size=${13} /><span>${POST_KINDS[kind].label}</span><${Icon} name="chevron-down" size=${12} />`}
        items=${[{ heading: 'Kind of post' }, ...KIND_ORDER.map((k) => ({ label: POST_KINDS[k].label, icon: POST_KINDS[k].icon, checked: k === kind, onSelect: () => { setKind(k); if (!replyTo) setAction(k === 'question' || k === 'blocked' || k === 'handoff' ? 'needs-reply' : 'fyi'); } }))]} />
      <${Menu} class="pick" side="top" label="Recipients" trigger=${html`<${Icon} name="at-sign" size=${13} /><span>${toLabel}</span><${Icon} name="chevron-down" size=${12} />`}
        items=${[{ heading: 'Addressed to' }, { label: ch.kind === 'dm' ? 'Both' : 'Everyone here', checked: !to.length, onSelect: () => setTo([]) }, { sep: true },
          ...members.map((m) => ({ label: agentLabel(s, m, { withTeam: ch.kind !== 'team' }), sub: agentStatus(s, m).word, checked: to.includes(m.id), onSelect: () => setTo(to.includes(m.id) ? to.filter((x) => x !== m.id) : [...to, m.id]) }))]} />
      <button type="button" class="pick" aria-pressed=${action === 'needs-reply'} onClick=${() => setAction(action === 'fyi' ? 'needs-reply' : 'fyi')} data-tip=${action === 'fyi' ? 'For reading only' : 'Stays open until someone answers'} data-tip-side="top">
        <${Icon} name=${action === 'fyi' ? 'eye' : 'reply'} size=${13} /><span>${action === 'fyi' ? 'FYI' : 'Needs reply'}</span></button>
      <button type="button" class="send" aria-label="Post" disabled=${!text.trim() || off} onClick=${send}><${Icon} name="arrow-up" size=${15} /></button>
    </div>
  </div>`;
}

// ---- Messages: the three columns ------------------------------------------------------
function ChannelList({ s, project, channels, current, now }) {
  const base = `/p/${project.id}/messages/`;
  const waitingAll = channels.reduce((n, c) => n + waitingIn(s, c, now).length, 0);
  const row = (c) => {
    const unread = c.id === current ? 0 : unreadOf(s, c); const wait = waitingIn(s, c, now); const stalled = wait.some((p) => now - p.ts >= STALL_AFTER);
    return html`<a key=${c.id} class=${cx('ch-row', unread > 0 && 'unread')} aria-current=${c.id === current ? 'page' : null} href=${href(base + c.id)} title=${c.kind === 'dm' ? `${channelLabel(s, c)}. ${channelAbout(s, c)}` : channelAbout(s, c)}>
      ${c.kind === 'dm' ? html`<span class="dm-pair" aria-hidden="true">${c.members.slice(0, 2).map((m, i) => html`${i > 0 && html`<i class="dm-dash"></i>`}<${Avatar} key=${m} agent=${agentOf(s, m)} size="sm" status=${false} />`)}</span>` : html`<${Icon} name=${c.kind === 'leads' ? 'megaphone' : 'hash'} size=${14} class="ch-icon" />`}
      <span class="label truncate">${channelShort(s, c)}</span>
      ${isPrivate(s, c) && html`<${Icon} name="lock" size=${11} class="faint" />`}
      ${wait.length > 0 && html`<span class=${cx('ch-wait', stalled && 'stalled')} title=${plural(wait.length, 'post') + ' waiting for a reply'}><${Icon} name="reply" size=${12} />${wait.length}</span>`}
      ${unread > 0 && html`<span class="count info">${unread}</span>`}
    </a>`;
  };
  const chans = channels.filter((c) => c.kind !== 'dm'); const dms = channels.filter((c) => c.kind === 'dm');
  return html`<nav class="mb-list" aria-label="Channels">
    <a class="ch-row all" aria-current=${current === 'waiting' ? 'page' : null} href=${href(base + 'waiting')}><${Icon} name="inbox" size=${14} class="ch-icon" /><span class="label truncate">Waiting for a reply</span>${waitingAll > 0 && html`<span class="count warn">${waitingAll}</span>`}</a>
    <h3>Channels</h3>${chans.map(row)}
    ${dms.length > 0 && html`<h3>Direct messages</h3>${dms.map(row)}`}
  </nav>`;
}

function ThreadPane({ s, root, ch, pid, now, onClose }) {
  const replies = repliesOf(s, root); const st = replyState(s, root, now); const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [replies.length, root.id]);
  return html`<aside class="mb-thread" aria-label="Thread">
    <header class="mb-head">
      <button type="button" class="icon-btn sm back-btn" aria-label="Back to the channel" onClick=${onClose}><${Icon} name="arrow-left" size=${15} /></button>
      <h2>Thread</h2><span class="muted truncate">${ch.kind === 'dm' ? 'Direct message' : '#' + ch.name}</span><span class="grow"></span>
      ${st && html`<button type="button" class="btn sm" onClick=${() => setClosed(root.id, !root.closed)} disabled=${st.answered && !root.closed}>
        <${Icon} name=${root.closed ? 'rotate-ccw' : 'check'} size=${13} />${root.closed ? 'Reopen' : st.answered ? 'Answered' : 'Mark answered'}</button>`}
      <button type="button" class="icon-btn sm close-btn" aria-label="Close thread" onClick=${onClose}><${Icon} name="x" size=${15} /></button>
    </header>
    <div class="mb-scroll">
      <${Post} s=${s} p=${root} ch=${ch} pid=${pid} now=${now} inThread=${true} />
      <div class="thread-sep"><span>${replies.length ? plural(replies.length, 'reply', 'replies') : 'No replies yet'}</span></div>
      ${replies.map((r) => html`<${Post} key=${r.id} s=${s} p=${r} ch=${ch} pid=${pid} now=${now} inThread=${true} />`)}
      ${st && !st.answered && html`<p class=${cx('thread-wait', st.stalled && 'stalled')}><${Icon} name=${st.stalled ? 'triangle-alert' : 'clock'} size=${13} />
        ${root.to.length ? `Waiting ${ago(root.ts, now)} for ${root.to.map((id) => whoName(s, id, ch.kind !== 'team')).join(' and ')}.` : `Waiting ${ago(root.ts, now)} for a reply.`}
        ${st.stalled && ' The stall watch has woken them once.'}</p>`}
      <div ref=${end}></div>
    </div>
    <div class="mb-compose"><${PostComposer} s=${s} ch=${ch} replyTo=${root.id} placeholder="Reply in this thread…" /></div>
  </aside>`;
}

export function MessagesTab({ s, project, route }) {
  const now = useNow(20_000); const pid = project.id;
  const channels = s.channels.filter((c) => c.project === pid);
  const [q, setQ] = useState(''); const [kind, setKind] = useState(null); const [from, setFrom] = useState(null); const [onlyOpen, setOnlyOpen] = useState(false);
  const curId = route.parts[3] || (channels[0] && channels[0].id);
  const virtual = curId === 'waiting'; const ch = virtual ? null : byId(channels, curId);
  const threadId = route.query.get('t'); const root = threadId && byId(s.posts, threadId);
  const rootCh = root && byId(s.channels, root.channel);
  const scroller = useRef(null);
  const count = ch ? s.posts.filter((p) => p.channel === ch.id).length : 0;
  useEffect(() => { if (ch) update((st) => { st.boardRead[ch.id] = Date.now(); }); }, [curId, count]);
  useEffect(() => { setQ(''); setKind(null); setFrom(null); setOnlyOpen(false); }, [curId]);
  useLayoutEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [curId, count]);

  if (!channels.length) {
    return html`<div class="page"><${Empty} title="No channels yet" icon="messages-square">A channel opens for each team when the project lead starts it. This project has no teams yet, so nothing has been posted.
      <a class="link" href=${href(`/p/${pid}/chat`)}> Talk to the project lead</a><//></div>`;
  }
  const base = `/p/${pid}/messages/${curId}`;
  const openThread = (p) => go(`${base}?t=${p.replyTo || p.id}`);
  const closeThread = () => go(base);

  let posts = virtual
    ? s.posts.filter((p) => channels.some((c) => c.id === p.channel) && replyState(s, p, now)?.answered === false)
    : ch ? s.posts.filter((p) => p.channel === ch.id && !p.replyTo) : [];
  const total = posts.length;
  const authors = [...new Set(posts.map((p) => p.from))];
  if (kind) posts = posts.filter((p) => p.kind === kind);
  if (from) posts = posts.filter((p) => p.from === from);
  if (onlyOpen) posts = posts.filter((p) => replyState(s, p, now)?.answered === false);
  if (q.trim()) { const n = q.trim().toLowerCase(); posts = posts.filter((p) => [p, ...repliesOf(s, p)].some((x) => `${x.text} ${whoName(s, x.from, true)} ${x.blocks || ''}`.toLowerCase().includes(n))); }
  posts = posts.slice().sort((a, b) => a.ts - b.ts);
  const filtered = !!(kind || from || onlyOpen || q.trim());
  const clear = () => { setQ(''); setKind(null); setFrom(null); setOnlyOpen(false); };
  const members = ch ? ch.members.map((m) => agentOf(s, m)).filter(Boolean) : [];
  const team = ch && ch.team && teamOf(s, ch.team);
  const waiting = ch ? waitingIn(s, ch, now).length : total;

  const rows = []; let prev = null;
  for (const p of posts) {
    const day = dayLabel(p.ts, now);
    if (!prev || dayLabel(prev.ts, now) !== day) { rows.push(html`<div class="day" key=${'d' + p.id}>${day}</div>`); prev = null; }
    const grouped = !virtual && prev && prev.from === p.from && p.ts - prev.ts < 12 * MIN && !repliesOf(s, prev).length;
    const pch = virtual ? byId(s.channels, p.channel) : ch;
    rows.push(html`<${Post} key=${p.id} s=${s} p=${p} ch=${pch} pid=${pid} now=${now} grouped=${grouped} selected=${root && root.id === p.id} onThread=${openThread} showChannel=${virtual} />`);
    prev = p;
  }

  return html`<div class="mb-wrap"><div class=${cx('mb', root && 'has-thread')}>
    <${ChannelList} s=${s} project=${project} channels=${channels} current=${curId} now=${now} />
    <section class="mb-stream" aria-label=${virtual ? 'Waiting for a reply' : ch ? channelLabel(s, ch) : 'Channel'}>
      <header class="mb-head">
        <${Menu} class="pick ch-pick" label="Choose a channel" trigger=${html`<${Icon} name="chevrons-up-down" size=${13} />`}
          items=${[{ label: 'Waiting for a reply', icon: 'inbox', checked: virtual, onSelect: () => go(`/p/${pid}/messages/waiting`) }, { heading: 'Channels' },
            ...channels.filter((c) => c.kind !== 'dm').map((c) => ({ label: '#' + c.name, checked: c.id === curId, sub: unreadOf(s, c) || null, onSelect: () => go(`/p/${pid}/messages/${c.id}`) })),
            { heading: 'Direct messages' }, ...channels.filter((c) => c.kind === 'dm').map((c) => ({ label: channelLabel(s, c), checked: c.id === curId, sub: unreadOf(s, c) || null, onSelect: () => go(`/p/${pid}/messages/${c.id}`) }))]} />
        ${virtual ? html`<h2><${Icon} name="inbox" size=${15} />Waiting for a reply</h2><span class="about truncate">Every open post across this project's channels</span>`
          : ch ? html`<h2>${ch.kind === 'dm' ? html`<${Icon} name="messages-square" size=${15} />` : html`<${Icon} name=${ch.kind === 'leads' ? 'megaphone' : 'hash'} size=${15} />`}<span class="truncate">${channelLabel(s, ch)}</span></h2>
            <span class="about truncate">${ch.kind === 'team' ? html`<a href=${href(`/p/${pid}/team/${team.id}`)}>${teamName(team)}</a>` : channelAbout(s, ch)}</span>
            ${team && team.needToKnow && html`<span class="badge outline" data-tip="Workers post only to their lead or a paired worker"><${Icon} name="lock" size=${11} />Need to know</span>`}`
          : html`<h2>Channel not found</h2>`}
        <span class="grow"></span>
        ${ch && html`<${Menu} class="members" align="end" label="Members" trigger=${html`<span class="avatar-stack">${members.slice(0, 4).map((m) => html`<${Avatar} key=${m.id} agent=${m} s=${s} size="sm" status=${false} />`)}</span><span>${members.length}</span>`}
          items=${[{ heading: 'In this channel' }, ...members.map((m) => ({ label: agentLabel(s, m, { withTeam: ch.kind !== 'team' }), sub: agentStatus(s, m).word, onSelect: () => go(routeForAgent(s, m)) })), { sep: true }, { label: 'You read everything and can post', disabled: true }]} />`}
      </header>
      ${(ch || virtual) && html`<div class="mb-filters">
        <div class="search"><${Icon} name="search" size=${14} /><input class="input" type="search" placeholder="Search"  aria-label="Search posts" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
        <${Menu} class=${cx('btn sm', kind && 'on')} label="Filter by kind" trigger=${html`<${Icon} name="filter" size=${13} /><span>${kind ? POST_KINDS[kind].label : 'Kind'}</span>`}
          items=${[{ label: 'All kinds', checked: !kind, onSelect: () => setKind(null) }, { sep: true }, ...KIND_ORDER.map((k) => ({ label: POST_KINDS[k].label, icon: POST_KINDS[k].icon, checked: kind === k, onSelect: () => setKind(k) }))]} />
        <${Menu} class=${cx('btn sm', from && 'on')} label="Filter by agent" trigger=${html`<${Icon} name="user" size=${13} /><span class="truncate">${from ? whoName(s, from, true) : 'From'}</span>`}
          items=${[{ label: 'Anyone', checked: !from, onSelect: () => setFrom(null) }, { sep: true }, ...authors.map((id) => ({ label: whoName(s, id, true), checked: from === id, onSelect: () => setFrom(id) }))]} />
        ${!virtual && html`<button type="button" class="btn sm" aria-pressed=${onlyOpen} onClick=${() => setOnlyOpen(!onlyOpen)}><${Icon} name="reply" size=${13} /><span>Needs reply</span>${waiting > 0 && html`<span class="count warn">${waiting}</span>`}</button>`}
      </div>`}
      <div class="mb-scroll" ref=${scroller} data-main>
        ${!ch && !virtual ? html`<${Empty} title="This channel does not exist" icon="hash">It may have closed with its team. Pick a channel from the list.<//>`
          : posts.length ? rows
          : filtered ? html`<${Empty} title="No posts match" icon="search">${plural(total, 'post')} in this view, none with these filters. <button type="button" class="link" onClick=${clear}>Clear the filters</button><//>`
          : virtual ? html`<${Empty} title="Nothing is waiting for a reply" icon="circle-check">Every post that asked for a reply has one.<//>`
          : html`<${Empty} title="Nothing posted here yet" icon="message-square">${ch.kind === 'dm' ? `${channelLabel(s, ch)} have not written to each other.` : 'Posts from this team appear here as its agents work.'} You can post first.<//>`}
      </div>
      ${ch && html`<div class="mb-compose"><${PostComposer} s=${s} ch=${ch} /></div>`}
    </section>
    ${root && rootCh && html`<${ThreadPane} s=${s} root=${root} ch=${rootCh} pid=${pid} now=${now} onClose=${closeThread} />`}
  </div></div>`;
}

// ====================================================================================
// Agents: the roster by situation
// ====================================================================================
const LANES = [
  { id: 'needs', name: 'Needs you', tone: 'warn', none: 'Nobody is waiting on you.' },
  { id: 'blocked', name: 'Blocked', tone: 'error', none: 'Nobody is blocked.' },
  { id: 'working', name: 'Working', tone: 'ok', none: 'Nobody is working.' },
  { id: 'done', name: 'Done', tone: null, none: 'No agent has finished its work yet.' },
  { id: 'idle', name: 'Idle', tone: null, none: 'Nobody is idle.' },
];
function situation(s, a, now) {
  const reqs = openRequests(s, { agent: a.id });
  const quiet = now - (a.lastOutputAt || now);
  if (a.state === 'failed') return { lane: 'needs', why: a.failure?.reason || 'Failed to start', tone: 'error' };
  if (reqs.length) return { lane: 'needs', why: `${KIND_LABEL[reqs[0].kind]}: ${reqs[0].title}`, tone: 'warn', req: reqs[0] };
  if (a.state === 'stopped') return { lane: 'idle', why: a.activity || 'Stopped' };
  if (a.stalled) return { lane: 'blocked', why: `No output for ${live.on && !a.lastOutputAt ? '—' : ago(a.lastOutputAt, now)}`, tone: 'warn', stalled: true };
  if (a.state === 'waiting') {
    const scope = a.role === 'project-lead' ? openRequests(s, { project: a.project }) : a.team ? openRequests(s, { team: a.team }) : [];
    return { lane: 'blocked', why: scope.length ? `Waiting on ${plural(scope.length, 'request')} its ${a.role === 'project-lead' ? 'teams' : 'team'} sent you` : a.activity || 'Waiting on another agent', tone: 'warn' };
  }
  if (a.state === 'working') return { lane: 'working', why: a.activity, quiet };
  if (a.workState === 'done') return { lane: 'done', why: 'Finished its work items' };
  return { lane: 'idle', why: a.workState === 'assigned' ? 'Assigned, not started' : 'Nothing assigned' };
}
const workState = (a) => (live.on ? a.workState || 'off' : a.state === 'stopped' || a.state === 'failed' ? 'off' : a.state === 'working' ? 'working' : a.workState || 'off');
const fmtTokens = (m) => (m >= 1 ? m.toFixed(1) + 'M' : Math.round(m * 1000) + 'k');

function agentMenu(s, a) {
  const h = HARNESSES[a.harness]; const off = a.state === 'stopped' || a.state === 'failed';
  return [
    { label: 'Open chat', icon: 'message-square', onSelect: () => go(routeForAgent(s, a)) },
    { label: 'Nudge', disabled: chatLive.busy('agent:' + a.id), icon: 'bell-ring', hint: 'Posts a status check that wakes it', onSelect: () => nudge(a.id) },
    off ? { label: 'Resume', disabled: chatLive.busy('agent:' + a.id), icon: 'play', onSelect: () => { act.resumeAgent(a.id); if (!live.on) act.toast(`Resumed ${a.name}`); } } : { label: 'Stop', disabled: chatLive.busy('agent:' + a.id), icon: 'square', danger: true, onSelect: () => act.stopAgent(a.id) },
    { sep: true }, { heading: 'Permission' },
    ...PERMISSION_MODES.map((m) => ({ label: m, checked: m === a.permission, onSelect: () => { act.setAgentConfig(a.id, { permission: m }); if (!live.on) act.toast(`${a.name}: ${m.toLowerCase()}`); } })),
    { sep: true }, { heading: `Model, from the next turn` },
    ...(live.on ? a.models || [] : h.models).map((m) => ({ label: m.label || m.id || m, checked: (m.id || m) === a.model, disabled: chatLive.busy('agent:' + a.id), onSelect: () => { act.setAgentConfig(a.id, { model: m.id || m }); if (!live.on) act.toast(`${a.name} uses ${m} from its next turn`); } })),
  ];
}
function RowActions({ s, a }) {
  const off = a.state === 'stopped' || a.state === 'failed';
  return html`<span class="ag-acts" onClick=${(e) => e.stopPropagation()}>
    <a class="icon-btn sm" href=${href(routeForAgent(s, a))} aria-label=${'Open chat with ' + a.name} data-tip="Open chat" data-tip-side="top"><${Icon} name="message-square" size=${14} /></a>
    ${off ? html`<button type="button" disabled=${chatLive.busy('agent:' + a.id)} class="icon-btn sm" aria-label=${'Resume ' + a.name} data-tip="Resume" data-tip-side="top" onClick=${() => { act.resumeAgent(a.id); if (!live.on) act.toast(`Resumed ${a.name}`); }}><${Icon} name="play" size=${14} /></button>`
      : html`<button type="button" disabled=${chatLive.busy('agent:' + a.id)} class="icon-btn sm" aria-label=${'Stop ' + a.name} data-tip="Stop" data-tip-side="top" onClick=${() => act.stopAgent(a.id)}><${Icon} name="square" size=${12} /></button>`}
    <${Menu} class="icon-btn sm" align="end" label=${'More for ' + a.name} items=${() => agentMenu(s, a)} trigger=${html`<${Icon} name="ellipsis" size=${15} />`} />
  </span>`;
}
function Context({ a }) {
  return html`<span class=${cx('meter ctx', a.context >= 70 && 'high')} title="Share of the context window in use"><span class="progress"><i class=${a.context >= 70 ? 'warn' : ''} style=${`width:${a.context}%`}></i></span><span class="num">${live.on && a.context == null ? '—' : a.context + '%'}</span></span>`;
}
function TaskLink({ s, a }) {
  const task = a.task && taskByLabel(s, a.project, a.task);
  return task ? html`<a class="tag" href=${href(`/p/${a.project}/task/${task.id}`)} title=${task.title} onClick=${(e) => e.stopPropagation()}>${task.label}</a>` : null;
}

function LaneRow({ s, a, sit, now }) {
  const t = a.team && teamOf(s, a.team); const ws = workState(a); const task = a.task && taskByLabel(s, a.project, a.task);
  return html`<li class=${cx('ag-row', sit.tone)} onClick=${() => go(sit.req ? routeForRequest(s, sit.req) : routeForAgent(s, a))}>
    <${Avatar} agent=${a} s=${s} />
    <div class="ag-who"><a class="name" href=${href(routeForAgent(s, a))} onClick=${(e) => e.stopPropagation()}>${a.name}</a><span class="team truncate">${t ? teamName(t) : 'Project'}</span></div>
    <span class=${cx('ws', ws)}>${WORK_STATES[ws]}</span>
    <div class="ag-now">
      <span class="line1"><${TaskLink} s=${s} a=${a} />${task && html`<span class="truncate task-title">${task.title}</span>`}${!task && html`<span class="faint">No task</span>`}</span>
      <span class=${cx('line2 truncate', sit.tone === 'warn' && 'warn-text', sit.tone === 'error' && 'error-text')}>${sit.stalled && html`<${Icon} name="triangle-alert" size=${12} />`}${sit.why}${sit.stalled && a.activity ? ` · ${a.activity}` : ''}</span>
    </div>
    <span class="ag-last num" title="Last output">${live.on && !a.lastOutputAt ? '—' : ago(a.lastOutputAt, now)}${live.on && !a.lastOutputAt || ago(a.lastOutputAt, now) === 'now' ? '' : ' ago'}</span>
    <${Context} a=${a} />
    <span class="ag-use num"><b>${live.on ? '—' : a.turns}</b> turns<br /><b>${live.on ? '—' : fmtTokens(a.tokens)}</b> tokens</span>
    <span class="ag-run"><span class="truncate">${HARNESSES[a.harness].name} · ${a.model}</span><span class="truncate faint">${machineOf(s, byId(s.projects, a.project).machine).name} · ${a.effort}</span></span>
    <${RowActions} s=${s} a=${a} />
  </li>`;
}

const SORTS = {
  role: (s) => (a) => a.name, team: (s) => (a) => (a.team ? teamName(teamOf(s, a.team)) : ''), state: () => (a) => Object.keys(WORK_STATES).indexOf(workState(a)),
  context: () => (a) => a.context, turns: () => (a) => a.turns, tokens: () => (a) => a.tokens, last: () => (a) => -a.lastOutputAt,
};
function AgentTable({ s, agents, now, sits }) {
  const [sort, setSort] = useState({ key: 'state', dir: 1 });
  const get = SORTS[sort.key](s);
  const rows = agents.slice().sort((a, b) => { const x = get(a), y = get(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  const Th = ({ k, children, num }) => html`<th class=${cx(num && 'num')} aria-sort=${sort.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : null}>
    <button type="button" class=${cx('th-sort', sort.key === k && 'on')} onClick=${() => setSort({ key: k, dir: sort.key === k ? -sort.dir : 1 })}>${children}<${Icon} name=${sort.key === k ? (sort.dir > 0 ? 'arrow-up' : 'arrow-down') : 'arrow-up-down'} size=${11} /></button></th>`;
  return html`<div class="table-wrap ag-table" data-main><table class="table">
    <thead><tr><${Th} k="role">Role<//><${Th} k="team">Team<//><${Th} k="state">Work state<//><th>Task</th><th>Doing now</th><${Th} k="last" num=${true}>Last output<//><${Th} k="context" num=${true}>Context<//><${Th} k="turns" num=${true}>Turns<//><${Th} k="tokens" num=${true}>Tokens<//><th>Harness and model</th><th>Machine</th><th>Permission</th><th></th></tr></thead>
    <tbody>${rows.map((a) => { const sit = sits.get(a.id); const t = a.team && teamOf(s, a.team); const ws = workState(a);
      return html`<tr key=${a.id} class=${cx('click', sit.tone === 'warn' && 's-warn', sit.tone === 'error' && 's-error')} onClick=${() => go(routeForAgent(s, a))}>
        <td class="state-cell"><span class="row" style="gap:8px"><${Avatar} agent=${a} s=${s} size="sm" /><b style="font-weight:var(--weight-medium)">${a.name}</b></span></td>
        <td class="muted">${t ? teamName(t) : 'Project'}</td>
        <td><span class=${cx('ws', ws)}>${WORK_STATES[ws]}</span></td>
        <td>${html`<${TaskLink} s=${s} a=${a} />` }${!a.task && html`<span class="faint">—</span>`}</td>
        <td class=${cx('truncate', sit.tone === 'warn' ? 'warn-text' : sit.tone === 'error' ? 'error-text' : 'muted')} style="max-width:300px">${sit.why || '—'}</td>
        <td class="num muted">${live.on && !a.lastOutputAt ? '—' : ago(a.lastOutputAt, now)}</td>
        <td class="num"><${Context} a=${a} /></td>
        <td class="num">${live.on ? '—' : a.turns}</td><td class="num">${live.on ? '—' : fmtTokens(a.tokens)}</td>
        <td class="muted">${HARNESSES[a.harness].name} · ${a.model} · ${a.effort}</td>
        <td class="muted">${machineOf(s, byId(s.projects, a.project).machine).name}</td>
        <td class="muted">${a.permission}</td>
        <td><${RowActions} s=${s} a=${a} /></td></tr>`; })}</tbody></table></div>`;
}

export function AgentsTab({ s, project }) {
  useEffect(() => chatLive.watchRoster(project.id), [project.id]);
  const now = useNow(15_000);
  const [view, setView] = useState(() => persist('agentsView', 'lanes')); const [team, setTeam] = useState(null);
  const pick = (v) => { setView(v); remember('agentsView', v); };
  const all = agentsOfProject(s, project.id); const teams = s.teams.filter((t) => t.project === project.id);
  const agents = team ? all.filter((a) => (team === 'none' ? !a.team : a.team === team)) : all;
  const sits = new Map(all.map((a) => [a.id, situation(s, a, now)]));
  const inLane = (id) => agents.filter((a) => sits.get(a.id).lane === id);
  const working = all.filter((a) => a.state === 'working').length; const needs = all.filter((a) => sits.get(a.id).lane === 'needs').length;
  const stuck = all.filter((a) => sits.get(a.id).stalled).length;
  const tokens = all.reduce((n, a) => n + a.tokens, 0); const turns = all.reduce((n, a) => n + a.turns, 0);
  const subs = [...new Set(all.map((a) => a.subscription))];
  return html`<div class="page agents-page">
    <dl class="ag-totals" aria-label="Totals">
      <div><dt>Working</dt><dd><b>${working}</b><span>of ${all.length} agents</span></dd></div>
      <div class=${needs ? 'warn' : ''}><dt>Waiting on you</dt><dd><b>${needs}</b><span>${needs === 1 ? 'agent' : 'agents'}</span></dd></div>
      <div class=${stuck ? 'warn' : ''}><dt>May be stuck</dt><dd><b>${stuck}</b><span>${live.on ? '' : stuck ? 'no output for 10 min' : 'all printing'}</span></dd></div>
      <div><dt>Tokens so far</dt><dd><b>${live.on ? '—' : fmtTokens(tokens)}</b><span>${live.on ? '' : turns.toLocaleString('en-GB') + ' turns'}</span></dd></div>
      <div class="subs"><dt>Subscriptions in use</dt><dd>${subs.map((id) => { const x = byId(s.subscriptions, id); return html`<a key=${id} class=${cx('sub-use', x.usage && x.usage.pct >= 85 && 'high')} href=${href('/subscriptions')} title="Weekly usage">${subLabel(s, id)} <b class="num">${x.usage ? x.usage.pct + '%' : live.on ? (x.signedIn ? '' : 'signed out') : 'signed out'}</b></a>`; })}</dd></div>
    </dl>
    <div class="ag-bar">
      <div class="seg" role="group" aria-label="Layout">
        <button type="button" aria-pressed=${view === 'lanes'} onClick=${() => pick('lanes')}><${Icon} name="rows-2" size=${13} />Lanes</button>
        <button type="button" aria-pressed=${view === 'table'} onClick=${() => pick('table')}><${Icon} name="table-2" size=${13} />Table</button>
      </div>
      <${Menu} class=${cx('btn sm', team && 'on')} label="Filter by team" trigger=${html`<${Icon} name="users" size=${13} /><span>${team === 'none' ? 'Project lead' : team ? teamName(teamOf(s, team)) : 'All teams'}</span><${Icon} name="chevron-down" size=${12} />`}
        items=${[{ label: 'All teams', checked: !team, onSelect: () => setTeam(null) }, { sep: true }, { label: 'Project lead', checked: team === 'none', onSelect: () => setTeam('none') }, ...teams.map((t) => ({ label: teamName(t), checked: team === t.id, onSelect: () => setTeam(t.id) }))]} />
      <span class="grow"></span>
      <span class="muted ag-note">The stall watch flags a worker after 10 minutes without output, and a lead after 20.</span>
    </div>
    ${!agents.length ? html`<${Empty} title="No agents here" icon="users">${team ? 'This team has no agents right now.' : 'The project lead starts agents when it forms a team.'}<//>`
      : view === 'table' ? html`<${AgentTable} s=${s} agents=${agents} now=${now} sits=${sits} />`
      : html`<div class="lanes" data-main>${LANES.map((l) => { const list = inLane(l.id);
        return html`<section key=${l.id} class=${cx('lane', l.tone, !list.length && 'none')} aria-label=${l.name}>
          <header><i class="lane-mark"></i><h2>${l.name}</h2><span class="count">${list.length}</span>${!list.length && html`<span class="faint lane-none">${l.none}</span>`}</header>
          ${list.length > 0 && html`<ul>${list.map((a) => html`<${LaneRow} key=${a.id} s=${s} a=${a} sit=${sits.get(a.id)} now=${now} />`)}</ul>`}
        </section>`; })}</div>`}
  </div>`;
}
