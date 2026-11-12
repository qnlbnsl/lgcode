// The project's Files tab: the inspected worktree as a folder tree, and the open file
// beside it. The files live on whichever machine holds the worktree. LGcode asks that
// machine for one folder or one file at a time and passes the answer on, so the page and
// a phone read files the same way. Files are read-only here.
import { html, useState, useEffect, useMemo, Icon, cx, go, href, useMedia, plural } from '../lib.js';
import { machineOf } from '../data.js';
import * as act from '../actions.js';
import { Menu, fileSize } from '../ui.js';
import { listFiles, fileText, tokens, svgUrl, TEXT_LIMIT } from '../files-data.js';

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

function Tree({ node, depth, open, toggle, sel, pick, changes }) {
  const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.path.localeCompare(b.path));
  return html`${dirs.map((d) => { const isOpen = open.has(d.path); return html`<li key=${d.path} role="treeitem" aria-expanded=${isOpen}>
      <button type="button" class="fx-row dir" style=${`--d:${depth}`} onClick=${() => toggle(d.path)}>
        <${Icon} name="chevron-right" size=${13} class="fx-chev" /><${Icon} name="folder" size=${14} class="faint" />
        <span class="truncate">${d.name}</span>${changedIn(d, changes) && html`<i class="fx-dot" title="Has changes"></i>`}</button>
      ${isOpen && html`<ul role="group"><${Tree} node=${d} depth=${depth + 1} open=${open} toggle=${toggle} sel=${sel} pick=${pick} changes=${changes} /></ul>`}</li>`; })}
    ${files.map((f) => { const name = f.path.split('/').pop(); const c = changes.get(f.path); return html`<li key=${f.path} role="treeitem" aria-selected=${sel === f.path}>
      <button type="button" class=${cx('fx-row', sel === f.path && 'on')} style=${`--d:${depth}`} onClick=${() => pick(f.path)}>
        <span class="fx-chev"></span><${Icon} name=${ICON[extOf(name)] || 'file'} size=${14} class="faint" />
        <span class="truncate">${name}</span>${c && STATUS[c] && html`<span class=${cx('fx-st', STATUS[c][0])} title=${STATUS[c][1]}>${c}</span>`}</button></li>`; })}`;
}

function Code({ path, wrap }) {
  const lines = fileText(path).replace(/\n$/, '').split('\n'); const ext = extOf(path);
  return html`<div class=${cx('fx-code', wrap && 'wrap')} role="region" aria-label=${'Contents of ' + path} tabindex="0"><table><tbody>
    ${lines.map((l, i) => html`<tr key=${i}><td class="fx-ln">${i + 1}</td><td class="fx-tx">${tokens(l, ext).map(([c, t], k) => (c ? html`<span key=${k} class=${'t-' + c}>${t}</span>` : t))}${l === '' ? '​' : ''}</td></tr>`)}
  </tbody></table></div>`;
}

export function FilesTab({ s, project, route }) {
  const phone = useMedia('(max-width: 860px)');
  const { w, missing } = worktreeFor(s, project);
  const m = w && machineOf(s, w.machine);
  const changes = useMemo(() => new Map((w?.files || []).map((f) => [f.path || f[0], f.status || f[1] || 'M'])), [w]);
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
  const lines = file && !file.binary && file.size <= TEXT_LIMIT ? fileText(file.path).replace(/\n$/, '').split('\n').length : 0;

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
        : html`<ul role="tree" aria-label=${'Files in ' + (w?.branch || '')}><${Tree} node=${tree} depth=${0} open=${open} toggle=${toggle} sel=${sel} pick=${pick} changes=${changes} /></ul>`}
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
    ${c && html`<a class="btn sm" href=${href(`/p/${project.id}/git`)} aria-label="Open in Git" title="Open in Git"><${Icon} name="git-branch" size=${13} /><span class="fx-lbl">Open in Git</span></a>`}
    <${Menu} class="icon-btn" align="end" label="More" trigger=${html`<${Icon} name="ellipsis" size=${16} />`} width=${220}
      items=${[...(lines > 0 ? [{ label: 'Wrap long lines', checked: wrap, onSelect: () => setWrap(!wrap) }, { sep: true }] : []), { label: 'Copy path', icon: 'copy', onSelect: () => { navigator.clipboard?.writeText(sel).catch(() => {}); act.toast('Path copied'); } },
        { label: 'Download', disabled: offline, onSelect: () => act.toast(`Downloading ${crumbs[crumbs.length - 1]} from ${m.name}`) }]} />
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
      <button type="button" class="btn" onClick=${() => act.toast(`Downloading ${crumbs[crumbs.length - 1]} from ${m.name}`)}>Download</button></div>`;
  else body = html`<${Code} path=${file.path} wrap=${wrap} />`;

  const main = html`<section class="fx-main" aria-label="Open file">${sel && head}${body}</section>`;
  if (phone) return html`<div class="fx phone">${sel ? main : side}</div>`;
  return html`<div class="fx">${side}${main}</div>`;
}
