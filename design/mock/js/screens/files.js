// The project's Files tab: the inspected worktree as a folder tree, and the open file
// beside it. The files live on whichever machine holds the worktree. LGTM Studio asks that
// machine for one folder or one file at a time and passes the answer on, so the page and
// a phone read files the same way. The owner can edit a text file, save it, and commit that
// one file. Anything bigger is work for the project lead.
import { html, useState, useEffect, useMemo, Icon, cx, go, href, useMedia, plural, update, uid, isMac } from '../lib.js';
import { machineOf, agentOf, byId } from '../data.js';
import * as act from '../actions.js';
import { Menu, Dialog, registerDialog, fileSize } from '../ui.js';
import { listFiles, fileText, svgUrl, TEXT_LIMIT } from '../files-data.js';
import { CodeEditor } from '../editor.js';

// The worktree the tab reads: the inspected one, else the project's, else the base branch.
function worktreeFor(s, project) {
  const all = (s.worktrees || []).filter((w) => w.repo === project.repo);
  const want = s.inspecting[project.id] || project.branch;
  const w = all.find((x) => x.branch === want && (!x.project || x.project === project.id)) || all.find((x) => x.project === project.id && x.kind === 'project');
  return { w: w || all.find((x) => x.kind === 'base'), missing: !w ? want : null };
}
const extOf = (p) => (p.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
const STATUS = { A: ['add', 'Added'], M: ['mod', 'Changed'], R: ['mod', 'Renamed'] };
// A leading left-to-right mark keeps "~/" at the start of a path cut from the left.
const ltr = (t) => '\u200e' + (t || '');
const ICON = { md: 'file-text', css: 'palette', svg: 'image', png: 'image', zip: 'archive', fig: 'palette', ts: 'file-code', tsx: 'file-code' };

// Builds the folder tree from flat paths. Folders come first, then files, by name.
function buildTree(files) {
  const root = { name: '', path: '', dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split('/'); let node = root;
    parts.slice(0, -1).forEach((p, i) => { if (!node.dirs.has(p)) node.dirs.set(p, { name: p, path: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: [] }); node = node.dirs.get(p); });
    node.files.push(f);
  }
  return root;
}
function changedIn(node, changes) {
  for (const f of node.files) if (changes.has(f.path)) return true;
  for (const d of node.dirs.values()) if (changedIn(d, changes)) return true;
  return false;
}

// ---- the owner's edits -------------------------------------------------------------
// A file's committed text is `base`. A save puts the new text in `fileSaves` and records the
// change in the worktree's changed files, where the Git tab shows its diff. Unsaved text
// lives only in this page, in `drafts`, and survives opening another file.
const drafts = new Map();
const draftKey = (wid, path) => wid + '\u0000' + path;
const baseText = (s, wid, path) => s.fileBase?.[wid]?.[path] ?? fileText(path);
const savedText = (s, wid, path) => s.fileSaves?.[wid]?.[path] ?? baseText(s, wid, path);

// A line diff in the Git tab's shape: hunks with three lines of context on each side.
function lineDiff(a, b) {
  const A = a.replace(/\n$/, '').split('\n'), B = b.replace(/\n$/, '').split('\n');
  const ops = [];
  if (A.length * B.length > 4_000_000) { for (const x of A) ops.push(['del', x]); for (const y of B) ops.push(['add', y]); }
  else {
    const n = A.length, m = B.length; const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) { ops.push(['ctx', A[i]]); i++; j++; }
      else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) ops.push(['add', B[j++]]);
      else ops.push(['del', A[i++]]);
    }
  }
  const hunks = []; let o = 1, nn = 1, h = null;
  ops.forEach(([t, text], k) => {
    const near = ops.slice(Math.max(0, k - 3), k + 4).some(([x]) => x !== 'ctx');
    if (t !== 'ctx' || near) {
      if (!h) { h = { oldStart: o, newStart: nn, label: '', lines: [] }; hunks.push(h); }
      h.lines.push(t === 'add' ? { t, n: nn, text } : t === 'del' ? { t, o, text } : { t, o, n: nn, text });
    } else h = null;
    if (t !== 'add') o++; if (t !== 'del') nn++;
  });
  for (const k of hunks) { k.oldCount = k.lines.filter((l) => l.t !== 'add').length; k.newCount = k.lines.filter((l) => l.t !== 'del').length; }
  const add = ops.filter(([t]) => t === 'add').length, del = ops.filter(([t]) => t === 'del').length;
  return { hunks, add, del };
}

function saveFile(wid, path) {
  const text = drafts.get(draftKey(wid, path)); if (text == null) return;
  let note = '';
  update((s) => {
    const w = byId(s.worktrees, wid); const base = baseText(s, wid, path);
    s.fileSaves = s.fileSaves || {}; s.fileSaves[wid] = s.fileSaves[wid] || {};
    const at = w.files.findIndex((f) => (f.path || f[0]) === path);
    if (text === base) {
      delete s.fileSaves[wid][path];
      if (at >= 0 && w.files[at].byOwner) w.files.splice(at, 1);
    } else {
      s.fileSaves[wid][path] = text;
      const d = lineDiff(base, text);
      const entry = { id: at >= 0 ? w.files[at].id : uid('f'), path, status: at >= 0 ? w.files[at].status : 'M', staged: false, kind: 'text', byOwner: true, ...d };
      if (at >= 0) w.files[at] = entry; else w.files.push(entry);
    }
    const a = w.owner && agentOf(s, w.owner);
    if (a && a.state === 'working') note = `. ${a.name} is told which file you changed`;
  });
  drafts.delete(draftKey(wid, path));
  act.toast(`Saved ${path.split('/').pop()}${note}`);
}

function commitFile(wid, path, message) {
  update((s) => {
    const w = byId(s.worktrees, wid); const at = w.files.findIndex((f) => (f.path || f[0]) === path); if (at < 0) return;
    const [entry] = w.files.splice(at, 1);
    for (const k of w.commits) k.refs = k.refs.filter((r) => r !== w.branch);
    const [subject, ...rest] = message.split('\n');
    w.commits.unshift({ hash: Math.random().toString(16).slice(2, 9), subject, body: rest.join('\n').trim(), author: 'owner', ts: Date.now(), files: [{ ...entry, staged: false }], refs: [w.branch] });
    w.ahead += 1;
    if (s.fileSaves?.[wid]?.[path] != null) { s.fileBase = s.fileBase || {}; s.fileBase[wid] = s.fileBase[wid] || {}; s.fileBase[wid][path] = s.fileSaves[wid][path]; delete s.fileSaves[wid][path]; }
  });
  act.toast(`Committed ${path.split('/').pop()}`);
}

// The commit dialog for one file. Its message can be written by the cheap model, as in Git.
function CommitFile({ s, d }) {
  const w = byId(s.worktrees, d.wid); const name = d.path.split('/').pop();
  const [msg, setMsg] = useState(''); const [writing, setWriting] = useState(false);
  const ok = msg.trim().length > 0 && !writing;
  const generate = () => { if (act.refused()) return; setWriting(true); setTimeout(() => { setWriting(false); setMsg(act.commitMessage([d.path])); }, 900); };
  const submit = () => { if (!ok) return; act.closeDialog(); commitFile(d.wid, d.path, msg.trim()); };
  return html`<${Dialog} title=${'Commit ' + name} size="narrow" onClose=${act.closeDialog} onSubmit=${submit}
    foot=${html`<button type="button" class="btn" onClick=${act.closeDialog}>Cancel</button><button type="submit" class="btn primary" disabled=${!ok}><${Icon} name="check" size=${14} />Commit</button>`}>
    <div class="field"><div class="row"><label for="fx-commit-msg" class="grow">Commit message</label>
        <button type="button" class="btn sm ghost" disabled=${writing} data-tip=${`Writes the message with ${s.settings.gitModel || 'Haiku 5.5'}`} onClick=${generate}><${Icon} name=${writing ? 'loader-circle' : 'sparkles'} size=${13} class=${writing ? 'spin' : ''} />Generate</button></div>
      <textarea id="fx-commit-msg" class="textarea" rows="3" autofocus value=${msg} disabled=${writing} placeholder=${writing ? 'Writing the message…' : ''}
        onInput=${(e) => setMsg(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}></textarea></div>
    <p class="muted fx-commit-note">Only <span class="mono">${d.path}</span> is committed, to <span class="mono">${w?.branch}</span>, as you. For anything bigger, ask the project lead.</p>
  <//>`;
}
registerDialog('commit-file', CommitFile);

function Tree({ node, depth, open, toggle, sel, pick, changes, dirty }) {
  const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.path.localeCompare(b.path));
  return html`${dirs.map((d) => { const isOpen = open.has(d.path); return html`<li key=${d.path} role="treeitem" aria-expanded=${isOpen}>
      <button type="button" class="fx-row dir" style=${`--d:${depth}`} onClick=${() => toggle(d.path)}>
        <${Icon} name="chevron-right" size=${13} class="fx-chev" /><${Icon} name="folder" size=${14} class="faint" />
        <span class="truncate">${d.name}</span>${changedIn(d, changes) && html`<i class="fx-dot" title="Has changes"></i>`}</button>
      ${isOpen && html`<ul role="group"><${Tree} node=${d} depth=${depth + 1} open=${open} toggle=${toggle} sel=${sel} pick=${pick} changes=${changes} dirty=${dirty} /></ul>`}</li>`; })}
    ${files.map((f) => { const name = f.path.split('/').pop(); const c = changes.get(f.path); return html`<li key=${f.path} role="treeitem" aria-selected=${sel === f.path}>
      <button type="button" class=${cx('fx-row', sel === f.path && 'on')} style=${`--d:${depth}`} onClick=${() => pick(f.path)}>
        <span class="fx-chev"></span><${Icon} name=${ICON[extOf(name)] || 'file'} size=${14} class="faint" />
        <span class="truncate">${name}</span>${dirty.has(f.path) && html`<i class="fx-unsaved" title="Not saved"></i>`}${c && STATUS[c] && html`<span class=${cx('fx-st', STATUS[c][0])} title=${STATUS[c][1]}>${c}</span>`}</button></li>`; })}`;
}

export function FilesTab({ s, project, route }) {
  const phone = useMedia('(max-width: 860px)');
  const { w, missing } = worktreeFor(s, project);
  const m = w && machineOf(s, w.machine);
  // The store changes in place, so the memos key on what the files and commits hold.
  const sig = (w?.files || []).map((f) => (f.path || f[0]) + ':' + (f.status || f[1] || 'M')).join('|') + '#' + (w?.commits || []).length;
  const changes = useMemo(() => new Map((w?.files || []).map((f) => [f.path || f[0], f.status || f[1] || 'M'])), [w, sig]);
  const gone = useMemo(() => new Set([...changes].filter(([, st]) => st === 'D').map(([p]) => p)), [changes]);
  const files = useMemo(() => (w ? listFiles(w.repo, [...changes.keys(), ...(w.commits || []).flatMap((k) => (k.files || []).map((f) => f.path || f[0]))]).filter((f) => !gone.has(f.path)) : []), [w, changes, gone]);
  const tree = useMemo(() => buildTree(files), [files]);
  const sel = route.query.get('f') || (phone ? null : 'README.md');
  const file = files.find((f) => f.path === sel);
  const [open, setOpen] = useState(() => new Set(['packages', 'packages/web', 'packages/web/src', 'packages/web/src/shell']));
  const [q, setQ] = useState(''); const [wrapPref, setWrap] = useState(null); const wrap = wrapPref ?? phone;
  const [loading, setLoading] = useState(false);
  const offline = !m || m.status !== 'online' || s.conn.status !== 'live';
  const remote = m && !m.here;
  // Opening a file folds open its folders. A file on another machine takes a moment.
  useEffect(() => { if (!sel) return; setOpen((o) => { const n = new Set(o); sel.split('/').slice(0, -1).forEach((_, i, a) => n.add(a.slice(0, i + 1).join('/'))); return n; });
    if (remote && !offline) { setLoading(true); const t = setTimeout(() => setLoading(false), 450); return () => clearTimeout(t); } }, [sel, w?.id]);
  const pick = (p) => go(`/p/${project.id}/files?f=${encodeURIComponent(p)}`);
  const toggle = (p) => setOpen((o) => { const n = new Set(o); n.has(p) ? n.delete(p) : n.add(p); return n; });
  const found = q ? files.filter((f) => f.path.toLowerCase().includes(q.toLowerCase())).slice(0, 40) : null;
  const [, bump] = useState(0);
  const wid = w?.id; const kd = (p) => draftKey(wid, p);
  const dirty = new Set([...drafts.keys()].filter((k) => k.startsWith(wid + '\u0000')).map((k) => k.slice(String(wid).length + 1)));
  const textFile = file && !file.binary && file.size <= TEXT_LIMIT && !(file.image && extOf(file.path) === 'svg');
  const saved = textFile ? savedText(s, wid, file.path) : '';
  const shown = textFile ? drafts.get(kd(file.path)) ?? saved : '';
  const lines = textFile ? shown.replace(/\n$/, '').split('\n').length : 0;
  const readOnly = !w || w.kind === 'base' || offline;
  const isDirty = textFile && dirty.has(file.path);
  const edit = (text) => { const was = drafts.has(kd(sel)); if (text === saved) drafts.delete(kd(sel)); else drafts.set(kd(sel), text); if (was !== drafts.has(kd(sel))) bump((n) => n + 1); };
  const save = () => { if (!readOnly && drafts.has(kd(sel))) { saveFile(wid, sel); bump((n) => n + 1); } };
  const worker = w?.owner && agentOf(s, w.owner);
  const busy = worker && worker.state === 'working' && isDirty;

  const side = html`<aside class="fx-side" aria-label="Files">
    <div class="fx-where">
      <div class="row" style="gap:6px;min-width:0"><${Icon} name="git-branch" size=${13} class="faint" /><span class="mono truncate-start" title=${w?.branch}>${ltr(w?.branch || 'No worktree')}</span></div>
      <div class="fx-mach"><i class=${cx('dot', offline ? 'failed' : 'working')}></i><span>${m ? m.name : 'No machine'}</span><span class="mono truncate-start faint" title=${w?.folder}>${ltr(w?.folder)}</span></div>
    </div>
    <div class="fx-find search"><${Icon} name="search" size=${13} /><input class="input" placeholder="Go to file" aria-label="Go to file" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
    ${missing && html`<p class="fx-note"><span class="mono">${missing}</span> has no worktree yet. This is <span class="mono">${w?.branch}</span>.</p>`}
    <div class="fx-tree" data-main>
      ${found ? html`<ul class="fx-found">${found.map((f) => html`<li key=${f.path}><button type="button" class=${cx('fx-row', sel === f.path && 'on')} onClick=${() => { pick(f.path); setQ(''); }}>
          <${Icon} name=${ICON[extOf(f.path)] || 'file'} size=${14} class="faint" /><span class="truncate-start mono" title=${f.path}>${ltr(f.path)}</span></button></li>`)}
          ${found.length === 0 && html`<li class="fx-none" data-empty>No file matches</li>`}</ul>`
        : html`<ul role="tree" aria-label=${'Files in ' + (w?.branch || '')}><${Tree} node=${tree} depth=${0} open=${open} toggle=${toggle} sel=${sel} pick=${pick} changes=${changes} dirty=${dirty} /></ul>`}
    </div>
  </aside>`;

  const crumbs = sel ? sel.split('/') : [];
  const c = sel && changes.get(sel);
  const head = html`<div class="fx-head">
    ${phone && html`<a class="icon-btn" href=${href(`/p/${project.id}/files`)} aria-label="Back to the files"><${Icon} name="arrow-left" size=${16} /></a>`}
    <div class="fx-crumbs mono" title=${sel}>${crumbs.length > 1 && html`<span class="fx-dir muted">${ltr(crumbs.slice(0, -1).join(' / '))}</span><span class="faint">/</span>`}<b>${crumbs[crumbs.length - 1]}</b></div>
    ${c && STATUS[c] && html`<span class=${cx('fx-st', STATUS[c][0])}>${STATUS[c][1]}</span>`}
    <span class="fx-gap"></span>
    ${file && html`<span class="fx-size muted">${lines ? plural(lines, 'line') + ' · ' : ''}${fileSize(file.size)}</span>`}
    ${textFile && readOnly && !offline && html`<span class="fx-ro muted" title="Agents never edit the base branch directly"><${Icon} name="lock" size=${12} />Read-only</span>`}
    ${c && html`<a class="btn sm" href=${href(`/p/${project.id}/git`)} aria-label="Open in Git" title="Open in Git"><${Icon} name="git-branch" size=${13} /><span class="fx-lbl">Open in Git</span></a>`}
    ${textFile && !readOnly && html`<button type="button" class=${cx('btn sm', isDirty && 'primary')} disabled=${!isDirty} onClick=${save} data-tip=${isMac ? "⌘S" : "Ctrl+S"}>Save</button>`}
    ${textFile && !readOnly && c && !isDirty && html`<button type="button" class="btn sm primary" aria-label="Commit" onClick=${() => act.openDialog({ type: 'commit-file', wid, path: sel })}><${Icon} name="git-commit-horizontal" size=${13} /><span class="fx-lbl">Commit</span></button>`}
    <${Menu} class="icon-btn" align="end" label="More" trigger=${html`<${Icon} name="ellipsis" size=${16} />`} width=${220}
      items=${[...(lines > 0 ? [{ label: 'Wrap long lines', checked: wrap, onSelect: () => setWrap(!wrap) }, { sep: true }] : []), { label: 'Copy path', icon: 'copy', onSelect: () => { navigator.clipboard?.writeText(sel).catch(() => {}); act.toast('Path copied'); } },
        { label: 'Download', disabled: offline, onSelect: () => { if (act.refused()) return; act.toast(`Downloading ${crumbs[crumbs.length - 1]} from ${m.name}`); } }]} />
  </div>`;

  let body;
  if (offline) body = html`<div class="fx-state" data-empty><${Icon} name="monitor" size=${20} class="faint" /><strong>${m ? m.name : 'The machine'} is offline</strong><span>Its files show again when it reconnects.</span></div>`;
  else if (!sel) body = html`<div class="fx-state" data-empty><${Icon} name="file" size=${20} class="faint" /><strong>No file open</strong></div>`;
  else if (!file) body = html`<div class="fx-state" data-empty><${Icon} name="file" size=${20} class="faint" /><strong>This file is not in ${w.branch}</strong><span class="mono">${sel}</span></div>`;
  else if (loading) body = html`<div class="fx-state"><${Icon} name="loader-circle" size=${18} class="spin faint" /><span>Reading from ${m.name}…</span></div>`;
  else if (file.image && extOf(file.path) === 'svg') body = html`<div class="fx-pic"><img src=${svgUrl(file.path)} alt=${file.path} /></div>`;
  else if (file.binary || file.size > TEXT_LIMIT) body = html`<div class="fx-state"><${Icon} name=${file.binary ? 'archive' : 'file-text'} size=${20} class="faint" />
      <strong>${file.binary ? 'Binary file' : 'Too large to show'} · ${fileSize(file.size)}</strong>
      <span>${file.binary ? 'It can be downloaded, not read here.' : `Files over ${fileSize(TEXT_LIMIT)} are downloaded, not shown.`}</span>
      <button type="button" class="btn" onClick=${() => { if (act.refused()) return; act.toast(`Downloading ${crumbs[crumbs.length - 1]} from ${m.name}`); }}>Download</button></div>`;
  else body = html`${busy && html`<p class="fx-busy"><${Icon} name="info" size=${13} />${worker.name} is working in this worktree. When you save, it is told which file you changed.</p>`}
    <${CodeEditor} key=${wid + ':' + file.path} doc=${shown} path=${file.path} wrap=${wrap} readOnly=${readOnly} onChange=${edit} onSave=${save} />`;

  const main = html`<section class="fx-main" aria-label="Open file">${sel && head}${body}</section>`;
  if (phone) return html`<div class="fx phone">${sel ? main : side}</div>`;
  return html`<div class="fx">${side}${main}</div>`;
}
