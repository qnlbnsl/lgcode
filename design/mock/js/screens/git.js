// The project's Git tab: worktrees, changes, diffs, commits, history, conflicts and integration.
// Everything here works on local state. Nothing runs a real git command.
import {
  html, useState, useEffect, useMemo, Icon, cx, update, ago, useNow, persist, remember, useMedia, plural, MIN, HOUR, DAY,
} from '../lib.js';
import { byId, agentOf, leadOf, teamOf, teamName, machineOf } from '../data.js';
import * as act from '../actions.js';
import { Avatar, OwnerAvatar, Menu, Empty } from '../ui.js';

// ---- sample diffs ---------------------------------------------------------------
// Written in unified form. A header reads "@@ -old +new @@ label"; the counts are worked out.
const DIFFS = {
  sidebar: `@@ -1 +1 @@
 import { useState } from 'react';
-import { NavRail } from './NavRail';
+import { Rail } from './Rail';
+import { useAttention } from './useAttention';
 import { ProjectTree } from './ProjectTree';
 import type { Project } from '@lgcode/api';

@@ -18 +19 @@ export function Sidebar({ projects, current }: SidebarProps) {
   const [folded, setFolded] = useState(readFolded);
-  const waiting = projects.filter((p) => p.requests.length > 0).length;
+  const attention = useAttention(projects);

   const toggle = () => {
     setFolded((f) => {
       writeFolded(!f);
       return !f;
     });
   };

-  if (folded) return <NavRail projects={projects} onOpen={toggle} />;
+  if (folded) {
+    return <Rail projects={projects} attention={attention} onOpen={toggle} />;
+  }

   return (
     <aside className="sidebar" aria-label="Projects">
@@ -44 +48 @@ export function Sidebar({ projects, current }: SidebarProps) {
       <header className="sidebar-head">
         <Brand />
-        {waiting > 0 && <span className="count">{waiting}</span>}
+        {attention.total > 0 && (
+          <span className="count" aria-label={attention.label}>
+            {attention.total}
+          </span>
+        )}
         <button type="button" className="icon-btn" aria-label="Fold the sidebar" onClick={toggle}>
           <PanelLeft size={16} />
         </button>
       </header>
-      <ProjectTree projects={projects} current={current} />
+      <ProjectTree projects={projects} current={current} counts={attention.byProject} />
     </aside>
   );
 }`,
  sidebarCss: `@@ -12 +12 @@ .sidebar {
   display: flex;
   flex-direction: column;
   width: var(--sidebar-width, 264px);
+  min-width: 0;
   background: var(--color-sidebar);
   border-right: 1px solid var(--color-line);
 }
@@ -31 +32 @@ .sidebar-head {
-.sidebar.folded { width: 56px; }
-.sidebar.folded .label { display: none; }
+.rail {
+  display: grid;
+  grid-auto-rows: var(--row);
+  justify-items: center;
+  width: 48px;
+  padding-block: var(--space-2);
+}
+.rail .pip {
+  position: absolute;
+  inset: 4px 4px auto auto;
+  width: 7px;
+  height: 7px;
+  border-radius: 50%;
+  background: var(--color-warn);
+}`,
  useAttention: `@@ -0 +1 @@
+import { useMemo } from 'react';
+import type { Project } from '@lgcode/api';
+
+export interface Attention {
+  total: number;
+  label: string;
+  byProject: Record<string, number>;
+}
+
+// Counts every open request once, under the project that owns it.
+export function useAttention(projects: readonly Project[]): Attention {
+  return useMemo(() => {
+    const byProject: Record<string, number> = {};
+    let total = 0;
+    for (const project of projects) {
+      const open = project.requests.filter((r) => r.status === 'open').length;
+      byProject[project.id] = open;
+      total += open;
+    }
+    const label = total === 1 ? '1 request needs you' : total + ' requests need you';
+    return { total, label, byProject };
+  }, [projects]);
+}`,
  rail: `@@ -1 +1 @@
 import type { Project } from '@lgcode/api';
+import type { Attention } from './useAttention';

-interface NavRailProps {
+interface RailProps {
   projects: readonly Project[];
+  attention: Attention;
   onOpen: () => void;
 }

-export function NavRail({ projects, onOpen }: NavRailProps) {
+export function Rail({ projects, attention, onOpen }: RailProps) {
   return (
-    <nav className="sidebar folded">
+    <nav className="rail" aria-label="Projects">
       <button type="button" className="icon-btn" aria-label="Open the sidebar" onClick={onOpen}>`,
  legacy: `@@ -1 +0 @@
-// Kept for the old two-column layout. Nothing imports it since the navigation foundation.
-export const LEGACY_NAV = [
-  { id: 'threads', label: 'Threads' },
-  { id: 'board', label: 'Board' },
-  { id: 'roster', label: 'Roster' },
-] as const;
-
-export type LegacyNavId = (typeof LEGACY_NAV)[number]['id'];`,
  sidebarTest: `@@ -22 +22 @@ describe('Sidebar', () => {
     expect(screen.getByRole('navigation', { name: 'Projects' })).toBeVisible();
   });

+  it('counts a request once when two agents share a project', () => {
+    render(<Sidebar projects={[withRequests('console', 3)]} current="console" />);
+    expect(screen.getByLabelText('3 requests need you')).toHaveTextContent('3');
+  });
+
   it('folds into a rail and remembers it', async () => {
     const user = userEvent.setup();
     render(<Sidebar projects={projects} current="console" />);
-    await user.click(screen.getByRole('button', { name: 'Fold' }));
+    await user.click(screen.getByRole('button', { name: 'Fold the sidebar' }));
     expect(localStorage.getItem('sidebar.folded')).toBe('true');
   });`,
  bell: `@@ -9 +9 @@ export function Bell({ requests }: BellProps) {
   const open = requests.filter((r) => r.status === 'open');
-  const count = open.length + requests.filter((r) => r.kind === 'failed').length;
+  // A failed start is already an open request. Counting it again doubled the bell.
+  const count = open.length;
   return (
     <button type="button" className="bell" aria-label={label(count)}>`,
  thread: `@@ -40 +40 @@ export function Thread({ agent, messages }: ThreadProps) {
   const end = useRef<HTMLDivElement>(null);
+  const pinned = usePinnedToEnd(end);

   useEffect(() => {
-    end.current?.scrollIntoView();
-  }, [messages.length]);
+    if (pinned) end.current?.scrollIntoView({ block: 'end' });
+  }, [messages.length, pinned]);`,
  reconnect: `@@ -14 +14 @@ it('reconnects after the socket drops', async () => {
   const client = connect(server.url);
   server.dropAll();
-  await sleep(250);
-  expect(client.status).toBe('live');
+  await waitFor(() => expect(client.status).toBe('live'), { timeout: 2000 });
   client.close();
 });`,
};

// ---- parsing ---------------------------------------------------------------------
function parseDiff(text) {
  const hunks = []; let h = null; let o = 0; let n = 0;
  for (const raw of text.split('\n')) {
    const m = /^@@ -(\d+) \+(\d+) @@ ?(.*)$/.exec(raw);
    if (m) { o = +m[1]; n = +m[2]; h = { oldStart: o, newStart: n, label: m[3], lines: [] }; hunks.push(h); continue; }
    if (!h) continue;
    const t = raw[0] === '+' ? 'add' : raw[0] === '-' ? 'del' : 'ctx'; const text2 = raw.slice(1);
    if (t === 'add') h.lines.push({ t, n: n++, text: text2 });
    else if (t === 'del') h.lines.push({ t, o: o++, text: text2 });
    else h.lines.push({ t, o: o++, n: n++, text: text2 });
  }
  for (const k of hunks) {
    k.oldCount = k.lines.filter((l) => l.t !== 'add').length; k.newCount = k.lines.filter((l) => l.t !== 'del').length;
  }
  return hunks;
}
const count = (hunks, t) => hunks.reduce((a, k) => a + k.lines.filter((l) => l.t === t).length, 0);

// Believable filler for files that have no hand-written diff.
const POOL = {
  ts: ['const next = queue.shift();', 'if (!next) return;', 'await store.append(event);', 'return { ok: true, value };', 'export function resolve(id: string) {', '}', 'const key = id + ":" + revision;', 'for (const item of items) visit(item);', 'throw new NotFound(id);', 'log.debug("resolved", { id });'],
  css: ['display: flex;', 'gap: var(--space-2);', 'min-width: 0;', 'color: var(--color-muted);', 'border-radius: var(--radius-sm);', 'padding: 0 var(--inset);', '}', '.row:hover { background: var(--color-raised); }'],
  md: ['Each request names the agent that raised it.', 'The lead answers for its teams.', '', 'Run the full suite before a hand-over.', 'A fix sprint merges on its own after a passing run.', '## What changes for the owner', 'Nothing is merged into the base branch without approval.'],
  json: ['"name": "@lgcode/web",', '"private": true,', '"type": "module",', '"test": "vitest run",', '"typecheck": "tsc --noEmit"', '},'],
  yaml: ["  '@types/node@26.1.0':", '    resolution: {integrity: sha512-9fT2k1mQp7Lw3xVbY0aZr8eH}', '    dependencies:', '      undici-types: 7.2.0', "  'vitest@4.0.3':", '    engines: {node: ">=24"}', '    dev: true'],
};
function synth(path, add, del, seed = 1, status = 'M') {
  const ext = path.split('.').pop(); const pool = POOL[{ tsx: 'ts', ts: 'ts', css: 'css', md: 'md', json: 'json', yaml: 'yaml' }[ext]] || POOL.ts;
  const pick = (i) => pool[(i * 5 + (i >> 2) + seed * 3 + path.length) % pool.length];
  const out = []; let left = [add, del]; let at = 8 + (seed * 13) % 40; let i = 0;
  if (status === 'A') return ['@@ -0 +1 @@', ...Array.from({ length: add }, (_, k) => '+' + pick(k))].join('\n');
  if (status === 'D') return ['@@ -1 +0 @@', ...Array.from({ length: Math.max(del, 4) }, (_, k) => '-' + pick(k))].join('\n');
  while (left[0] > 0 || left[1] > 0) {
    const a = Math.min(left[0], 2 + (i + seed) % 5); const d = Math.min(left[1], 1 + (i * 3 + seed) % 4);
    out.push(`@@ -${at} +${at} @@`);
    for (let k = 0; k < 3; k++) out.push(' ' + pick(i++));
    for (let k = 0; k < d; k++) out.push('-' + pick(i++));
    for (let k = 0; k < a; k++) out.push('+' + pick(i++));
    for (let k = 0; k < 2; k++) out.push(' ' + pick(i++));
    left = [left[0] - a, left[1] - d]; at += 30 + d + a;
    if (out.length > 4000) break;
  }
  return out.join('\n');
}

let seq = 0;
function file(path, status, opt = {}) {
  const f = { id: 'f' + (++seq), path, status, staged: false, kind: 'text', ...opt };
  if (f.kind === 'text') {
    f.hunks = parseDiff(opt.diff ? DIFFS[opt.diff] : synth(path, opt.add ?? 6, opt.del ?? (status === 'A' ? 0 : 3), seq, status));
    f.add = count(f.hunks, 'add'); f.del = count(f.hunks, 'del');
  } else if (f.kind === 'large') { f.hunks = null; } else { f.add = 0; f.del = 0; }
  delete f.diff;
  return f;
}
let hseq = 0;
function hash() { hseq += 1; let x = (hseq * 2654435761) >>> 0; x ^= x >>> 13; return ((x * 40503) >>> 0).toString(16).padStart(8, '0').slice(0, 7); }
function commit(subject, author, agoMs, files, refs = []) {
  return { hash: hash(), subject, author, ts: Date.now() - agoMs, files: files.map(([p, st, o]) => file(p, st, o || {})), refs };
}

// ---- seed -------------------------------------------------------------------------
export function seedGit(state) {
  const wts = []; const P = (id) => byId(state.projects, id);
  const repoOf = (p) => byId(state.repos, p.repo);
  const wt = (o) => { const w = { files: [], commits: [], ahead: 0, behind: 0, merge: null, owner: null, team: null, project: null, ...o }; wts.push(w); return w; };

  // Base branches, one for each repository.
  for (const r of state.repos) {
    const machine = Object.keys(r.folders)[0];
    wt({
      id: 'base-' + r.id, repo: r.id, kind: 'base', branch: r.main, parent: null, machine, folder: r.folders[machine],
      commits: [
        commit('Merge pull request #34 from area/website', 'owner', 2 * DAY, [['packages/web/src/App.tsx', 'M', { add: 14, del: 6 }], ['docs/issues.md', 'M', { add: 9, del: 0 }]], [r.main, 'origin/' + r.main]),
        commit('Record the open preview issuance failure', 'owner', 2 * DAY + 3 * HOUR, [['docs/issues.md', 'M', { add: 12, del: 1 }]]),
        commit('Budget the serial journey test', 'owner', 3 * DAY, [['packages/web/test/journey.test.ts', 'M', { add: 8, del: 4 }]]),
        commit('Recover committed first projects after reload', 'owner', 4 * DAY, [['packages/engine/src/projects.ts', 'M', { add: 31, del: 9 }], ['packages/engine/test/projects.test.ts', 'M', { add: 44, del: 0 }]], ['v0.4.0']),
      ],
    });
  }

  // Agent console: the rich one.
  const c = P('console');
  if (c) {
    const root = repoOf(c).folders[c.machine] || '~/projects/lgcode';
    const nav = [
      commit('Merge feat/agent-console/shell: navigation foundation', 'console-lead', 1 * DAY + 2 * HOUR, [['packages/web/src/shell/NavRail.tsx', 'A', { add: 48 }], ['packages/web/src/shell/Sidebar.tsx', 'M', { add: 22, del: 30 }], ['packages/web/src/routes.ts', 'M', { add: 17, del: 5 }]], ['SP-01']),
      commit('Start the project from master', 'console-lead', 4 * DAY, [['docs/specs/agent-console.md', 'A', { add: 36 }]]),
    ];
    wt({
      id: 'console', repo: c.repo, project: c.id, kind: 'project', branch: c.branch, parent: repoOf(c).main, machine: c.machine, folder: c.folder, owner: c.lead,
      ahead: 9, behind: 0,
      commits: [commit('Fix the flaky reconnect test start', 'console-lead', 25 * MIN, [['packages/web/test/reconnect.test.ts', 'M', { diff: 'reconnect' }]], [c.branch]), ...nav],
    });
    wt({
      id: 'console-shell', repo: c.repo, project: c.id, kind: 'team', team: 'console-shell', branch: 'feat/agent-console/shell', parent: c.branch, machine: 'studio', folder: root + '/.worktrees/agent-console-shell', owner: 'shell-lead',
      ahead: 5, behind: 1,
      files: [
        file('packages/web/src/shell/sidebar.css', 'M', { diff: 'sidebarCss', staged: true }),
        file('packages/web/src/shell/useAttention.ts', 'A', { diff: 'useAttention', staged: true }),
        file('packages/web/src/shell/Sidebar.tsx', 'M', { diff: 'sidebar' }),
        file('packages/web/src/shell/Rail.tsx', 'R', { diff: 'rail', oldPath: 'packages/web/src/shell/NavRail.tsx' }),
        file('packages/web/src/shell/Sidebar.test.tsx', 'M', { diff: 'sidebarTest' }),
        file('packages/web/src/shell/legacy-nav.ts', 'D', { diff: 'legacy' }),
        file('packages/web/public/rail-icons.png', 'A', { kind: 'binary', size: '18.4 KB' }),
        file('pnpm-lock.yaml', 'M', { kind: 'large', add: 1204, del: 988 }),
      ],
      commits: [
        commit('Count each open request once in the bell', 'shell-b2', 38 * MIN, [['packages/web/src/shell/Bell.tsx', 'M', { diff: 'bell' }], ['packages/web/src/shell/Bell.test.tsx', 'M', { add: 14, del: 2 }]], ['feat/agent-console/shell']),
        commit('Render the folded rail at 48 pixels', 'shell-b1', 1 * HOUR + 20 * MIN, [['packages/web/src/shell/NavRail.tsx', 'M', { add: 26, del: 11 }], ['packages/web/src/shell/sidebar.css', 'M', { add: 19, del: 4 }]]),
        commit('Split SP-03 into four subitems', 'shell-lead', 2 * HOUR + 40 * MIN, [['.lgcode/sprints/SP-03.md', 'M', { add: 28, del: 3 }]]),
        commit('Remember the folded sidebar between visits', 'shell-b1', 3 * HOUR, [['packages/web/src/shell/Sidebar.tsx', 'M', { add: 15, del: 2 }], ['packages/web/src/shell/storage.ts', 'A', { add: 21 }]]),
        commit('Add the attention count fixture', 'shell-test', 3 * HOUR + 30 * MIN, [['packages/web/test/fixtures/attention.ts', 'A', { add: 40 }]]),
        ...nav,
      ],
    });
    wt({
      id: 'console-shell-b2', repo: c.repo, project: c.id, kind: 'agent', team: 'console-shell', branch: 'feat/agent-console/shell-builder-2', parent: 'feat/agent-console/shell', machine: 'studio', folder: root + '/.worktrees/agent-console-shell-b2', owner: 'shell-b2',
      ahead: 1, behind: 0,
      files: [file('packages/web/src/shell/ProjectTree.tsx', 'M', { add: 11, del: 4 }), file('packages/web/src/shell/ProjectTree.test.tsx', 'M', { add: 23, del: 0 })],
      commits: [commit('Pass attention counts into the project tree', 'shell-b2', 12 * MIN, [['packages/web/src/shell/ProjectTree.tsx', 'M', { add: 18, del: 6 }]], ['feat/agent-console/shell-builder-2']), ...nav],
    });
    wt({
      id: 'console-threads', repo: c.repo, project: c.id, kind: 'team', team: 'console-threads', branch: 'feat/agent-console/threads', parent: c.branch, machine: 'studio', folder: root + '/.worktrees/agent-console-threads', owner: 'threads-lead',
      ahead: 4, behind: 1,
      files: [file('packages/web/src/thread/usePinnedToEnd.ts', 'A', { add: 27, staged: true }), file('packages/web/test/thread-scroll.test.ts', 'A', { add: 34, staged: true })],
      merge: {
        from: 'feat/agent-console/threads-builder-1', by: 'threads-lead', startedAt: Date.now() - 9 * MIN,
        files: [
          {
            id: 'cf1', path: 'packages/web/src/thread/Thread.tsx', resolved: false,
            parts: [
              { start: 38, ctx: ['export function Thread({ agent, messages }: ThreadProps) {', '  const end = useRef<HTMLDivElement>(null);'] },
              {
                id: 'k1', choice: null,
                ours: ['  const pinned = usePinnedToEnd(end);', '', '  useEffect(() => {', "    if (pinned) end.current?.scrollIntoView({ block: 'end' });", '  }, [messages.length, pinned]);'],
                base: ['  useEffect(() => {', '    end.current?.scrollIntoView();', '  }, [messages.length]);'],
                theirs: ['  useLayoutEffect(() => {', "    end.current?.scrollIntoView({ behavior: 'instant' });", '  }, [messages.length, agent.id]);'],
              },
              { start: 46, ctx: ['', '  return (', '    <section className="thread" aria-label={agent.name}>'] },
              {
                id: 'k2', choice: null,
                ours: ['      {messages.map((m) => <Message key={m.id} message={m} collapseOver={24} />)}'],
                base: ['      {messages.map((m) => <Message key={m.id} message={m} />)}'],
                theirs: ['      {messages.map((m) => (', '        <Message key={m.id} message={m} draft={drafts[m.id]} />', '      ))}'],
              },
              { start: 49, ctx: ['      <div ref={end} />', '    </section>', '  );', '}'] },
            ],
          },
          {
            id: 'cf2', path: 'packages/web/src/thread/thread.css', resolved: false,
            parts: [
              { start: 20, ctx: ['.msg .body {', '  line-height: var(--leading-body);'] },
              { id: 'k3', choice: null, ours: ['  max-width: var(--measure);', '  overflow-wrap: anywhere;'], base: ['  max-width: 72ch;'], theirs: ['  max-width: 72ch;', '  white-space: pre-wrap;'] },
              { start: 23, ctx: ['}'] },
            ],
          },
        ],
      },
      commits: [
        commit('Keep the thread pinned to the end while reading', 'threads-b1', 50 * MIN, [['packages/web/src/thread/Thread.tsx', 'M', { diff: 'thread' }]], ['feat/agent-console/threads']),
        commit('Collapse long replies over 24 lines', 'threads-b1', 2 * HOUR, [['packages/web/src/thread/Message.tsx', 'M', { add: 33, del: 7 }], ['packages/web/src/thread/thread.css', 'M', { add: 12, del: 1 }]]),
        commit('Write the thread scroll test first', 'threads-tw', 2 * HOUR + 30 * MIN, [['packages/web/test/thread-scroll.test.ts', 'A', { add: 52 }]]),
        ...nav,
      ],
    });
    wt({
      id: 'console-review', repo: c.repo, project: c.id, kind: 'team', team: 'console-review', branch: 'feat/agent-console/review', parent: c.branch, machine: 'studio', folder: root + '/.worktrees/agent-console-review', owner: 'review-lead',
      ahead: 0, behind: 1, commits: nav,
    });
  }

  // Every other project: its own branch and one worktree for each team. A project that has
  // not reached Plan has no worktree yet.
  for (const p of state.projects) {
    if (p.id === 'console' || p.stage === 'Design') continue;
    const teams = state.teams.filter((t) => t.project === p.id); const lead = p.lead;
    const merged = p.phase === 'running';
    wt({
      id: p.id, repo: p.repo, project: p.id, kind: 'project', branch: p.branch, parent: repoOf(p).main, machine: p.machine, folder: p.folder, owner: lead,
      ahead: merged ? 0 : p.id === 'apiref' ? 14 : 3, behind: 0, merged: merged ? Date.now() - 6 * DAY : null,
      commits: [
        commit(p.id === 'apiref' ? 'Redirect the old page addresses' : 'Merge the first sprint', lead, 3 * HOUR, [[p.id === 'apiref' ? 'redirects.json' : 'src/index.ts', p.id === 'apiref' ? 'A' : 'M', { add: 37, del: 0 }], ['README.md', 'M', { add: 6, del: 2 }]], [p.branch]),
        commit('Write the plan and its statements', lead, 1 * DAY, [['.lgcode/plan.md', 'A', { add: 58 }]]),
      ],
    });
    for (const t of teams) {
      const ag = state.agents.find((a) => a.team === t.id && a.role === 'team-lead'); const busy = p.stage === 'Build';
      wt({
        id: t.id, repo: p.repo, project: p.id, kind: 'team', team: t.id, branch: t.branch, parent: p.branch, machine: p.machine, folder: p.folder + '-' + t.id.split('-').pop(), owner: ag?.id || lead,
        ahead: busy ? 2 : 0, behind: 0,
        files: busy ? [file('src/exports/csv.ts', 'M', { add: 24, del: 8 }), file('src/exports/query.ts', 'M', { add: 9, del: 3, staged: true }), file('src/exports/csv.test.ts', 'A', { add: 41 })] : [],
        commits: [commit(busy ? 'Write voided invoices as their own rows' : 'Finish the last review round', ag?.id || lead, 2 * HOUR, [[busy ? 'src/exports/csv.ts' : 'docs/review/round-2.md', busy ? 'M' : 'A', { add: 19, del: busy ? 5 : 0 }]], [t.branch])],
      });
    }
  }
  state.worktrees = wts;
  state.gitUi = {};
}

// ---- helpers ----------------------------------------------------------------------
const STATUS = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed' };
const baseName = (p) => p.split('/').pop();
const dirName = (p) => p.split('/').slice(0, -1).join('/');
function findWt(s, id) { return byId(s.worktrees, id); }
function who(s, id) { return id === 'owner' ? 'You' : agentOf(s, id)?.name || 'Agent'; }
function Author({ s, id }) {
  const a = id !== 'owner' && agentOf(s, id);
  return html`<span class="git-author">${a ? html`<${Avatar} agent=${a} s=${s} size="sm" status=${false} />` : html`<${OwnerAvatar} s=${s} size="sm" />`}<span class="truncate">${who(s, id)}</span></span>`;
}
function ownerText(s, w) {
  if (w.kind === 'base') return 'Base branch';
  const a = agentOf(s, w.owner); if (!a) return 'No owner';
  const t = w.team && teamOf(s, w.team);
  return w.kind === 'project' ? a.name : `${a.name} · ${teamName(t)}`;
}
function AheadBehind({ w }) {
  if (w.kind === 'base') return null;
  return html`<span class="git-ab" title=${`${plural(w.ahead, 'commit')} ahead of ${w.parent}, ${w.behind} behind`}>
    <span class=${cx(!w.ahead && 'faint')}><${Icon} name="arrow-up" size=${11} />${w.ahead}</span>
    <span class=${cx(w.behind ? 'warn-text' : 'faint')}><${Icon} name="arrow-down" size=${11} />${w.behind}</span></span>`;
}
function StatusLetter({ status }) { return html`<span class=${cx('git-st', status)} title=${STATUS[status]}>${status}</span>`; }
function Counts({ f }) {
  if (f.kind === 'binary') return html`<span class="git-counts faint">binary</span>`;
  return html`<span class="git-counts"><span class="success-text">+${f.add.toLocaleString('en-GB')}</span><span class="error-text">−${f.del.toLocaleString('en-GB')}</span></span>`;
}

// ---- actions ----------------------------------------------------------------------
function stage(wid, ids, staged) { update((s) => { for (const f of findWt(s, wid).files) if (ids.includes(f.id)) f.staged = staged; }); }
function discard(s, w, files) {
  act.confirm({
    title: files.length === 1 ? `Discard changes to ${baseName(files[0].path)}?` : `Discard ${files.length} changed files?`,
    body: `The files in ${w.branch} go back to the last commit. This cannot be undone.`,
    lost: files.slice(0, 6).map((f) => f.path), action: 'Discard',
    onConfirm: () => { update((st) => { const x = findWt(st, w.id); x.files = x.files.filter((f) => !files.some((g) => g.id === f.id)); }); act.toast(files.length === 1 ? 'Changes discarded' : `${files.length} files discarded`); },
  });
}
function doCommit(wid, message) {
  let n = 0;
  update((s) => {
    const w = findWt(s, wid); const staged = w.files.filter((f) => f.staged); n = staged.length;
    for (const k of w.commits) k.refs = k.refs.filter((r) => r !== w.branch);
    w.commits.unshift({ hash: hash(), subject: message.split('\n')[0], body: message.split('\n').slice(1).join('\n').trim(), author: 'owner', ts: Date.now(), files: staged.map((f) => ({ ...f, staged: false })), refs: [w.branch] });
    w.files = w.files.filter((f) => !f.staged); w.ahead += 1;
  });
  act.toast(`Committed ${plural(n, 'file')} to the worktree`);
}
function updateFromBase(wid) {
  update((s) => {
    const w = findWt(s, wid); const n = w.behind;
    for (const k of w.commits) k.refs = k.refs.filter((r) => r !== w.branch);
    w.commits.unshift({ hash: hash(), subject: `Merge ${w.parent} into ${w.branch}`, author: 'owner', ts: Date.now(), files: [file('packages/web/test/reconnect.test.ts', 'M', { diff: 'reconnect' })], refs: [w.branch], merge: true });
    w.behind = 0; w.ahead += n;
  });
  act.toast('Updated from the base. No conflicts.');
}
function integrate(wid) {
  let msg = '';
  update((s) => {
    const w = findWt(s, wid); const parent = s.worktrees.find((x) => x.repo === w.repo && x.branch === w.parent);
    if (parent) {
      const mine = w.commits.slice(0, w.ahead).map((k) => ({ ...k, refs: [] }));
      for (const k of parent.commits) k.refs = k.refs.filter((r) => r !== parent.branch);
      parent.commits.unshift({ hash: hash(), subject: `Merge ${w.branch}`, author: 'owner', ts: Date.now(), files: mine.flatMap((k) => k.files).slice(0, 8), refs: [parent.branch], merge: true }, ...mine);
      parent.ahead += w.ahead + 1;
      for (const x of s.worktrees) if (x.id !== w.id && x.repo === w.repo && x.parent === parent.branch) x.behind += 1;
    }
    msg = `Integrated ${plural(w.ahead, 'commit')} into ${w.parent}`; w.ahead = 0; w.integratedAt = Date.now();
  });
  act.toast(msg);
}
function openReview(s, w, project) {
  let r = s.requests.find((x) => x.kind === 'merge' && x.project === project.id && x.source === w.branch && x.status === 'open');
  if (!r) {
    const dirty = s.worktrees.filter((x) => x.project === project.id && x.kind !== 'project' && (x.ahead || x.files.length || x.merge)).length;
    r = {
      id: 'q-merge-' + project.id, kind: 'merge', agent: project.lead, project: project.id, title: `Merge ${w.branch} into ${w.parent}`,
      body: dirty ? `You opened this review early. ${plural(dirty, 'team worktree')} still ${dirty === 1 ? 'holds' : 'hold'} work that is not on ${w.branch}.` : 'Every team has integrated its work. Users will notice this change.',
      createdAt: Date.now(), status: 'open', source: w.branch, target: w.parent,
      evidence: { tests: { ok: false, text: `No full run on the latest commit ${w.commits[0]?.hash || ''}` }, review: { ok: false, text: 'The review team has not finished its last round' }, commits: w.ahead, files: Math.max(7, w.ahead * 4) },
    };
    update((st) => { st.requests = st.requests.filter((x) => x.id !== r.id); st.requests.push(r); });
  }
  act.openDialog({ type: 'merge-review', requestId: r.id });
}
function choose(wid, fid, kid, choice) {
  update((s) => { const f = findWt(s, wid).merge.files.find((x) => x.id === fid); f.parts.find((p) => p.id === kid).choice = choice; if (!choice) f.resolved = false; });
}
function markResolved(wid, fid, value = true) { update((s) => { findWt(s, wid).merge.files.find((x) => x.id === fid).resolved = value; }); }
function continueMerge(wid) {
  update((s) => {
    const w = findWt(s, wid); const m = w.merge;
    for (const k of w.commits) k.refs = k.refs.filter((r) => r !== w.branch);
    w.commits.unshift({ hash: hash(), subject: `Merge ${m.from} into ${w.branch}`, author: 'owner', ts: Date.now(), refs: [w.branch], merge: true, files: m.files.map((f) => file(f.path, 'M', { add: 5, del: 3 })) });
    w.merge = null; w.ahead += 1;
    const a = agentOf(s, m.by); if (a && a.state !== 'stopped') { a.state = 'working'; a.activity = 'Running the team checks after the merge'; }
  });
  act.toast('Merge finished');
}
function abortMerge(s, w) {
  act.confirm({
    title: 'Abort this merge?', body: `${w.branch} goes back to how it was before ${w.merge.from} was merged in. Your conflict choices are lost.`, action: 'Abort merge',
    onConfirm: () => { update((st) => { findWt(st, w.id).merge = null; }); act.toast('Merge aborted'); },
  });
}

// ---- diff -------------------------------------------------------------------------
function splitRows(h) {
  const rows = []; let i = 0; const L = h.lines;
  while (i < L.length) {
    if (L[i].t === 'ctx') { rows.push([L[i], L[i]]); i++; continue; }
    const dels = []; const adds = [];
    while (i < L.length && L[i].t === 'del') dels.push(L[i++]);
    while (i < L.length && L[i].t === 'add') adds.push(L[i++]);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) rows.push([dels[k] || null, adds[k] || null]);
  }
  return rows;
}
function Diff({ f, mode }) {
  const [showLarge, setShowLarge] = useState(false);
  const large = useMemo(() => (f.kind === 'large' && showLarge ? parseDiff(synth(f.path, 160, 120, 5)) : null), [f.id, showLarge]);
  useEffect(() => setShowLarge(false), [f.id]);
  if (f.kind === 'binary') {
    return html`<div class="diff-note"><${Icon} name="image" size=${18} /><strong>Binary file</strong>
      <span>${f.status === 'A' ? 'A new' : 'A changed'} file of ${f.size}. There is no text to compare.</span></div>`;
  }
  if (f.kind === 'large' && !showLarge) {
    return html`<div class="diff-note"><${Icon} name="file-diff" size=${18} /><strong>Large diff hidden</strong>
      <span>${(f.add + f.del).toLocaleString('en-GB')} changed lines. Lock files and generated files are folded so the page stays quick.</span>
      <button type="button" class="btn" onClick=${() => setShowLarge(true)}>Show anyway</button></div>`;
  }
  const hunks = large || f.hunks;
  if (!hunks.length) return html`<div class="diff-note"><strong>No text changes</strong><span>Only the file's name or mode changed.</span></div>`;
  const head = (h) => `@@ −${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@`;
  if (mode === 'split') {
    return html`<div class="diff-scroll"><table class="diff split"><colgroup><col class="ln" /><col /><col class="ln" /><col /></colgroup>
      ${hunks.map((h) => html`<tbody>
        <tr class="hunk"><td colspan="4"><span>${head(h)}</span>${h.label && html`<b>${h.label}</b>`}</td></tr>
        ${splitRows(h).map(([a, b]) => html`<tr>
          <td class=${cx('ln', a && a.t === 'del' && 'del', !a && 'none')}>${a?.o}</td><td class=${cx('code', a && a.t === 'del' && 'del', !a && 'none')}>${a ? a.text || ' ' : ''}</td>
          <td class=${cx('ln', b && b.t === 'add' && 'add', !b && 'none')}>${b?.n}</td><td class=${cx('code', b && b.t === 'add' && 'add', !b && 'none')}>${b ? b.text || ' ' : ''}</td></tr>`)}
      </tbody>`)}
      ${large && html`<tbody><tr class="hunk"><td colspan="4"><span>The first ${hunks.length} of many hunks are shown.</span></td></tr></tbody>`}
    </table></div>`;
  }
  return html`<div class="diff-scroll"><table class="diff unified">
    ${hunks.map((h) => html`<tbody>
      <tr class="hunk"><td colspan="4"><span>${head(h)}</span>${h.label && html`<b>${h.label}</b>`}</td></tr>
      ${h.lines.map((l) => html`<tr class=${l.t}><td class="ln">${l.o}</td><td class="ln">${l.n}</td><td class="sign">${l.t === 'add' ? '+' : l.t === 'del' ? '−' : ''}</td><td class="code">${l.text || ' '}</td></tr>`)}
    </tbody>`)}
    ${large && html`<tbody><tr class="hunk"><td colspan="4"><span>The first ${hunks.length} of many hunks are shown.</span></td></tr></tbody>`}
  </table></div>`;
}
function FileHead({ f, children, onBack }) {
  return html`<header class="diff-head">
    ${onBack && html`<button type="button" class="icon-btn" aria-label="Back to the file list" onClick=${onBack}><${Icon} name="arrow-left" size=${16} /></button>`}
    <${StatusLetter} status=${f.status} />
    <div class="diff-path"><b class="truncate">${baseName(f.path)}</b><span class="mono truncate-start">${f.status === 'R' ? `${f.oldPath} → ${f.path}` : dirName(f.path)}</span></div>
    <${Counts} f=${f} />${children}
  </header>`;
}

// ---- changes ----------------------------------------------------------------------
function FileRow({ f, selected, onSelect, actions }) {
  return html`<li class=${cx('git-file', selected && 'sel')}>
    <button type="button" class="git-file-main" aria-current=${selected ? 'true' : null} onClick=${onSelect} title=${f.path}>
      <${Icon} name=${f.kind === 'binary' ? 'image' : /\.(tsx?|css|json)$/.test(f.path) ? 'file-code' : 'file-text'} size=${14} class="faint" />
      <span class=${cx('name', f.status === 'D' && 'gone')}>${baseName(f.path)}</span><span class="dir truncate-start">${dirName(f.path)}</span>
    </button>
    <span class="git-file-acts">${actions}</span><${StatusLetter} status=${f.status} />
  </li>`;
}
function Changes({ s, w, mode, phone }) {
  const ui = s.gitUi[w.id] || {}; const setUi = (patch) => update((st) => { st.gitUi[w.id] = { ...(st.gitUi[w.id] || {}), ...patch }; });
  const staged = w.files.filter((f) => f.staged); const unstaged = w.files.filter((f) => !f.staged);
  const sel = byId(w.files, ui.file) || (phone ? null : unstaged[0] || staged[0]);
  const msg = ui.message || ''; const readOnly = w.kind === 'base';
  const can = staged.length > 0 && msg.trim().length > 0 && !w.merge;
  const commitNow = () => { if (!can) return; doCommit(w.id, msg.trim()); setUi({ message: '', file: null }); };
  const why = w.merge ? 'Finish or abort the merge first' : !staged.length ? 'Stage a file first' : !msg.trim() ? 'Write a message first' : '';
  if (!w.files.length) {
    return html`<div class="git-clean"><${Empty} title="Nothing to commit" icon="circle-check">
      ${readOnly ? `${w.branch} is the base branch. Agents never edit it directly, so it has no changes of its own.` : `The worktree for ${w.branch} matches its last commit${w.commits[0] ? `, ${w.commits[0].hash}` : ''}.`}
      <a class="link" href="#" onClick=${(e) => { e.preventDefault(); setUi({ tab: 'history' }); }}>Open the history</a><//></div>`;
  }
  const group = (title, files, isStaged) => files.length > 0 && html`<section class="git-group">
    <div class="section-head"><h3>${title}</h3><span class="count">${files.length}</span><span class="grow"></span>
      ${!isStaged && html`<button type="button" class="icon-btn sm" aria-label="Discard all changes" data-tip="Discard all" onClick=${() => discard(s, w, files)}><${Icon} name="undo-2" size=${14} /></button>`}
      <button type="button" class="icon-btn sm" aria-label=${isStaged ? 'Unstage all' : 'Stage all'} data-tip=${isStaged ? 'Unstage all' : 'Stage all'} onClick=${() => stage(w.id, files.map((f) => f.id), !isStaged)}><${Icon} name=${isStaged ? 'minus' : 'plus'} size=${14} /></button></div>
    <ul>${files.map((f) => html`<${FileRow} key=${f.id} f=${f} selected=${sel?.id === f.id} onSelect=${() => setUi({ file: f.id })}
      actions=${html`${!isStaged && html`<button type="button" class="icon-btn sm" aria-label=${`Discard changes to ${baseName(f.path)}`} data-tip="Discard" onClick=${() => discard(s, w, [f])}><${Icon} name="undo-2" size=${13} /></button>`}
        <button type="button" class="icon-btn sm" aria-label=${`${isStaged ? 'Unstage' : 'Stage'} ${baseName(f.path)}`} data-tip=${isStaged ? 'Unstage' : 'Stage'} onClick=${() => stage(w.id, [f.id], !isStaged)}><${Icon} name=${isStaged ? 'minus' : 'plus'} size=${13} /></button>`} />`)}</ul>
  </section>`;
  return html`<div class=${cx('git-split', phone && sel && 'detail')}>
    <div class="git-list">
      <form class="git-commit" onSubmit=${(e) => { e.preventDefault(); commitNow(); }}>
        <textarea class="textarea" rows="2" placeholder=${`Message for the commit on ${baseName(w.branch)}`} aria-label="Commit message" value=${msg}
          onInput=${(e) => setUi({ message: e.target.value })} onKeyDown=${(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitNow(); } }}></textarea>
        <div class="row"><span class="muted grow truncate">${why || `${plural(staged.length, 'staged file')} · commits as you`}</span>
          <button type="submit" class="btn primary sm" disabled=${!can}><${Icon} name="check" size=${13} />Commit</button></div>
      </form>
      <div class="git-groups">${group('Staged', staged, true)}${group('Changes', unstaged, false)}
        ${!staged.length && html`<p class="git-hint">Stage the files that belong in the next commit.</p>`}</div>
    </div>
    <div class="git-detail">
      ${sel ? html`<${FileHead} f=${sel} onBack=${phone ? () => setUi({ file: null }) : null}>
          <button type="button" class="btn sm" onClick=${() => stage(w.id, [sel.id], !sel.staged)}>${sel.staged ? 'Unstage' : 'Stage'}</button><//>
        <${Diff} f=${sel} mode=${mode} />` : html`<div class="diff-note"><strong>Choose a file</strong><span>Its diff opens here.</span></div>`}
    </div>
  </div>`;
}

// ---- history ----------------------------------------------------------------------
function Ref({ name, w }) { return html`<span class=${cx('git-ref', name === w.branch && 'head', /^v\d|^SP-/.test(name) && 'tag')}><${Icon} name=${/^v\d|^SP-/.test(name) ? 'pin' : 'git-branch'} size=${10} />${name}</span>`; }
function History({ s, w, mode, phone }) {
  const now = useNow(); const ui = s.gitUi[w.id] || {}; const setUi = (patch) => update((st) => { st.gitUi[w.id] = { ...(st.gitUi[w.id] || {}), ...patch }; });
  const sel = w.commits.find((k) => k.hash === ui.commit) || (phone ? null : w.commits[0]);
  const [closed, setClosed] = useState({});
  if (!w.commits.length) return html`<div class="git-clean"><${Empty} title="No commits yet" icon="history">Commits appear here once an agent or you commit to ${w.branch}.<//></div>`;
  return html`<div class=${cx('git-split history', phone && sel && 'detail')}>
    <div class="git-list"><ol class="git-log">${w.commits.map((k, i) => html`<li key=${k.hash}>
      <button type="button" class=${cx('git-commit-row', sel?.hash === k.hash && 'sel', i >= w.ahead && w.kind !== 'base' && 'shared')} aria-current=${sel?.hash === k.hash ? 'true' : null} onClick=${() => setUi({ commit: k.hash })}>
        <span class=${cx('node', k.merge && 'merge')}></span>
        <span class="subject"><span class="truncate">${k.subject}</span></span>
        <span class="meta"><${Author} s=${s} id=${k.author} /><span class="mono faint">${k.hash}</span><span class="faint when">${ago(k.ts, now)}</span></span>
        ${k.refs.length > 0 && html`<span class="refs">${k.refs.map((r) => html`<${Ref} name=${r} w=${w} />`)}</span>`}
      </button></li>`)}</ol>
      ${w.kind !== 'base' && html`<p class="git-hint">${w.ahead ? `The first ${plural(w.ahead, 'commit')} ${w.ahead === 1 ? 'is' : 'are'} not on ${w.parent} yet.` : `Every commit here is on ${w.parent}.`}</p>`}
    </div>
    <div class="git-detail">
      ${sel ? html`<header class="commit-head">
          ${phone && html`<button type="button" class="icon-btn" aria-label="Back to the history" onClick=${() => setUi({ commit: null })}><${Icon} name="arrow-left" size=${16} /></button>`}
          <div class="col grow" style="min-width:0;gap:4px"><h2>${sel.subject}</h2>
            <div class="row commit-meta"><${Author} s=${s} id=${sel.author} /><span class="muted">committed ${ago(sel.ts, now) === 'now' ? 'just now' : ago(sel.ts, now) + ' ago'}</span>
              <button type="button" class="tag copy" title="Copy the commit hash" onClick=${() => { navigator.clipboard?.writeText(sel.hash).catch(() => {}); act.toast('Commit hash copied'); }}>${sel.hash}<${Icon} name="copy" size=${10} /></button>
              <span class="muted">${plural(sel.files.length, 'file')}</span></div>
            ${sel.body && html`<p class="muted" style="white-space:pre-wrap">${sel.body}</p>`}</div>
        </header>
        <div class="commit-files">${sel.files.map((f) => html`<section class="commit-file" key=${sel.hash + f.id}>
          <button type="button" class="commit-file-head" aria-expanded=${!closed[f.id]} onClick=${() => setClosed((x) => ({ ...x, [f.id]: !x[f.id] }))}>
            <${Icon} name="chevron-right" size=${13} class="twist" /><${StatusLetter} status=${f.status} /><span class="mono truncate-start">${f.path}</span><span class="grow"></span><${Counts} f=${f} /></button>
          ${!closed[f.id] && html`<${Diff} f=${f} mode=${mode} />`}
        </section>`)}</div>` : html`<div class="diff-note"><strong>Choose a commit</strong><span>Its files and diff open here.</span></div>`}
    </div>
  </div>`;
}

// ---- conflicts --------------------------------------------------------------------
const CHOICES = [['ours', 'Use ours'], ['theirs', 'Use theirs'], ['both', 'Use both']];
function Pane({ title, sub, lines, tone, picked }) {
  return html`<div class=${cx('cf-pane', tone, picked && 'picked')}><header><b>${title}</b><span class="mono truncate-start">${sub}</span></header>
    <pre>${lines.length ? lines.join('\n') : ' '}</pre></div>`;
}
function Conflicts({ s, w, phone }) {
  const m = w.merge; const ui = s.gitUi[w.id] || {}; const setUi = (patch) => update((st) => { st.gitUi[w.id] = { ...(st.gitUi[w.id] || {}), ...patch }; });
  if (!m) return html`<div class="git-clean"><${Empty} title="No conflicts" icon="circle-check">Nothing in ${w.branch} needs resolving. A conflict shows here when a merge cannot combine two changes on its own.<//></div>`;
  const sel = m.files.find((f) => f.id === ui.cfile) || (phone ? null : m.files.find((f) => !f.resolved) || m.files[0]);
  const blocks = (f) => f.parts.filter((p) => p.id); const left = (f) => blocks(f).filter((p) => !p.choice).length;
  const allDone = m.files.every((f) => f.resolved);
  return html`<div class=${cx('git-split conflicts', phone && sel && 'detail')}>
    <div class="git-list">
      <div class="cf-summary"><div class="row" style="gap:6px"><${Icon} name="git-merge" size=${14} class="warn-text" /><b>Merge in progress</b></div>
        <p>Merging <span class="mono">${m.from}</span> into <span class="mono">${w.branch}</span>. ${who(s, m.by)} started it ${ago(m.startedAt)} ago and stopped at ${plural(m.files.length, 'file')}.</p>
        <div class="row" style="gap:6px"><button type="button" class="btn primary sm" disabled=${!allDone} title=${allDone ? '' : 'Resolve every file first'} onClick=${() => continueMerge(w.id)}>Continue merge</button>
          <button type="button" class="btn sm ghost" onClick=${() => abortMerge(s, w)}>Abort</button></div></div>
      <section class="git-group"><div class="section-head"><h3>Conflicted files</h3><span class="count">${m.files.filter((f) => !f.resolved).length}</span></div>
        <ul>${m.files.map((f) => html`<li class=${cx('git-file', sel?.id === f.id && 'sel')}><button type="button" class="git-file-main" aria-current=${sel?.id === f.id ? 'true' : null} onClick=${() => setUi({ cfile: f.id })} title=${f.path}>
          <${Icon} name=${f.resolved ? 'circle-check' : 'triangle-alert'} size=${14} class=${f.resolved ? 'success-text' : 'warn-text'} /><span class="name">${baseName(f.path)}</span><span class="dir truncate-start">${dirName(f.path)}</span></button>
          <span class=${cx('cf-left', f.resolved ? 'faint' : 'warn-text')}>${f.resolved ? 'Resolved' : left(f) ? `${left(f)} left` : 'Ready'}</span></li>`)}</ul></section>
    </div>
    <div class="git-detail">
      ${sel ? html`<header class="diff-head">
          ${phone && html`<button type="button" class="icon-btn" aria-label="Back to the conflicted files" onClick=${() => setUi({ cfile: null })}><${Icon} name="arrow-left" size=${16} /></button>`}
          <span class="git-st C" title="Conflicted">C</span>
          <div class="diff-path"><b class="truncate">${baseName(sel.path)}</b><span class="mono truncate-start">${dirName(sel.path)}</span></div>
          <span class="muted not-phone">${sel.resolved ? 'Resolved' : left(sel) ? `${plural(left(sel), 'conflict')} left` : 'Every conflict has a choice'}</span>
          ${sel.resolved ? html`<button type="button" class="btn sm" onClick=${() => markResolved(w.id, sel.id, false)}>Reopen</button>`
            : html`<button type="button" class="btn sm primary" disabled=${left(sel) > 0} onClick=${() => { markResolved(w.id, sel.id); act.toast(`${baseName(sel.path)} marked resolved`); }}>Mark resolved</button>`}
        </header>
        <div class="cf-body">${(() => { let n = 0; return sel.parts.map((p) => {
          if (!p.id) return html`<div class="cf-ctx">${p.ctx.map((line, i) => html`<div><span class="ln">${p.start + i}</span>${line || ' '}</div>`)}</div>`;
          n += 1; const result = p.choice === 'ours' ? p.ours : p.choice === 'theirs' ? p.theirs : p.choice === 'both' ? [...p.ours, ...p.theirs] : null;
          return html`<section class=${cx('cf-block', p.choice && 'chosen')} key=${p.id}>
            <header><b>Conflict ${n} of ${blocks(sel).length}</b>
              ${p.choice ? html`<span class="success-text row" style="gap:4px"><${Icon} name="check" size=${12} />${{ ours: 'Using ours', theirs: 'Using theirs', both: 'Using both, ours first' }[p.choice]}</span>` : html`<span class="warn-text">Choose which lines to keep</span>`}
              <span class="grow"></span>
              <div class="seg">${CHOICES.map(([id, label]) => html`<button type="button" aria-pressed=${p.choice === id} disabled=${sel.resolved} onClick=${() => choose(w.id, sel.id, p.id, p.choice === id ? null : id)}>${label}</button>`)}</div></header>
            ${result ? html`<div class="cf-panes one"><${Pane} title="Result" sub=${sel.path} lines=${result} tone="result" /></div>`
              : html`<div class="cf-panes"><${Pane} title="Ours" sub=${w.branch} lines=${p.ours} tone="ours" />
                <${Pane} title="Base" sub="common ancestor" lines=${p.base} tone="base" />
                <${Pane} title="Theirs" sub=${m.from} lines=${p.theirs} tone="theirs" /></div>`}
          </section>`;
        }); })()}</div>` : html`<div class="diff-note"><strong>Choose a file</strong><span>Its conflicts open here.</span></div>`}
    </div>
  </div>`;
}

// ---- integrate strip ---------------------------------------------------------------
function Integrate({ s, w, project }) {
  const now = useNow();
  if (w.kind === 'base') return html`<div class="git-integrate"><${Icon} name="lock" size=${14} class="faint" /><span class="muted">The base branch. Work reaches it only through a merge review that you approve.</span></div>`;
  const parent = html`<span class="mono">${w.parent}</span>`;
  const dirty = w.files.length > 0;
  if (w.kind === 'project') {
    const req = s.requests.find((x) => x.kind === 'merge' && x.project === project.id && x.source === w.branch);
    if (project.merged || w.merged) {
      return html`<div class="git-integrate ok"><${Icon} name="git-merge" size=${14} class="success-text" /><span><b>Merged</b> into ${parent}${w.merged ? ` ${ago(w.merged, now)} ago` : req?.answeredAt ? ` ${ago(req.answeredAt, now) === 'now' ? 'just now' : ago(req.answeredAt, now) + ' ago'}` : ''}. The branch can be deleted.</span></div>`;
    }
    const open = req && req.status === 'open';
    return html`<div class=${cx('git-integrate', open && 'warn')}><${Icon} name="git-pull-request" size=${14} class=${open ? 'warn-text' : 'muted'} />
      <span class="grow">${open ? html`<b>Waiting for your merge.</b> ${plural(w.ahead, 'commit')} ahead of ${parent}.` : html`${plural(w.ahead, 'commit')} ahead of ${parent}${w.behind ? ` and ${w.behind} behind` : ''}. Only you can merge it.`}</span>
      ${w.behind > 0 && html`<button type="button" class="btn sm" onClick=${() => updateFromBase(w.id)}>Update from base</button>`}
      <button type="button" class=${cx('btn sm', open && 'primary')} disabled=${!w.ahead} onClick=${() => openReview(s, w, project)}>Open merge review</button></div>`;
  }
  const block = w.merge ? 'Finish the merge first' : dirty ? 'Commit or discard the changes first' : w.behind ? 'Update from the base first' : !w.ahead ? 'Nothing to integrate' : '';
  return html`<div class="git-integrate"><${Icon} name="git-merge" size=${14} class="muted" />
    <span class="grow">${!w.ahead && !w.behind ? html`Level with ${parent}${w.integratedAt ? html` · integrated just now` : ''}`
      : html`${w.ahead ? plural(w.ahead, 'commit') + ' ahead of' : 'Level with'} ${parent}${w.behind ? html` and <b class="warn-text">${w.behind} behind</b>` : ''}`}</span>
    ${w.behind > 0 && html`<button type="button" class="btn sm" disabled=${!!w.merge} onClick=${() => updateFromBase(w.id)}>Update from base</button>`}
    <button type="button" class="btn sm" disabled=${!!block} title=${block} onClick=${() => integrate(w.id)}>Integrate into ${baseName(w.parent) === w.parent ? w.parent : 'the project branch'}</button></div>`;
}

// ---- the tab ----------------------------------------------------------------------
const KIND_WORD = { base: 'Base', project: 'Project', team: 'Team', agent: 'Agent' };
export function GitTab({ s, project }) {
  const phone = useMedia('(max-width: 860px)'); const narrow = useMedia('(max-width: 1100px)');
  const [modePref, setModePref] = useState(() => persist('gitDiffMode', 'unified'));
  const setMode = (m) => { setModePref(m); remember('gitDiffMode', m); };
  const mode = phone ? 'unified' : modePref;
  const all = (s.worktrees || []).filter((w) => w.project === project.id || (w.kind === 'base' && w.repo === project.repo));
  const mine = all.filter((w) => w.kind !== 'base');
  if (!mine.length) {
    return html`<div class="git"><div class="git-clean"><${Empty} title="No worktrees yet" icon="git-branch">
      ${project.name} is still in ${project.stage}. LGcode creates the branch <span class="mono">${project.branch}</span> and a worktree for each team when the plan is approved and building starts.
      <a class="link" href=${`#/p/${project.id}/workflow`}>See where the project is</a><//></div></div>`;
  }
  const order = { project: 0, team: 1, agent: 2, base: 3 };
  const list = [...all].sort((a, b) => order[a.kind] - order[b.kind]);
  const w = list.find((x) => x.branch === s.inspecting[project.id]) || list.find((x) => x.branch === project.branch) || list[0];
  const ui = s.gitUi[w.id] || {}; const tab = ui.tab || (w.merge ? 'conflicts' : 'changes');
  const setTab = (t) => update((st) => { st.gitUi[w.id] = { ...(st.gitUi[w.id] || {}), tab: t }; });
  const pick = (x) => update((st) => { st.inspecting[project.id] = x.branch; });
  const conflictCount = w.merge ? w.merge.files.filter((f) => !f.resolved).length : 0;
  const owner = agentOf(s, w.owner);
  return html`<div class="git">
    <div class="git-bar">
      <${Menu} class="git-pick" width=${400} label="Choose a worktree"
        header=${html`<div class="menu-label">Worktrees of ${project.name}</div>`}
        trigger=${html`<${Icon} name="git-branch" size=${14} /><b class="mono truncate-start">${w.branch}</b><${Icon} name="chevrons-up-down" size=${12} class="faint" />`}
        items=${list.map((x) => ({
          label: html`<span class="mono">${x.branch}</span>`, checked: x.id === w.id, onSelect: () => pick(x),
          sub: html`<span class="git-pick-sub">${x.merge ? html`<span class="warn-text">Conflict</span>` : x.files.length ? html`<span>${x.files.length} changed</span>` : null}<span>${KIND_WORD[x.kind]}</span></span>`,
        }))} />
      <span class="git-owner not-phone">${owner ? html`<${Avatar} agent=${owner} s=${s} size="sm" />` : html`<${Icon} name="lock" size=${13} class="faint" />`}<span class="truncate">${ownerText(s, w)}</span>
        <span class="faint truncate">on ${machineOf(s, w.machine)?.name}</span></span>
      <${AheadBehind} w=${w} />
      <span class="grow"></span>
      <div class="seg" role="tablist" aria-label="Git views">
        <button type="button" aria-pressed=${tab === 'changes'} onClick=${() => setTab('changes')}>Changes${w.files.length > 0 && html`<span class="count">${w.files.length}</span>`}</button>
        <button type="button" aria-pressed=${tab === 'history'} onClick=${() => setTab('history')}>History</button>
        ${(w.merge || tab === 'conflicts') && html`<button type="button" aria-pressed=${tab === 'conflicts'} onClick=${() => setTab('conflicts')}>Conflicts${conflictCount > 0 && html`<span class="count warn">${conflictCount}</span>`}</button>`}
      </div>
      ${tab !== 'conflicts' && html`<div class="seg not-phone" aria-label="Diff layout">
        <button type="button" aria-pressed=${mode === 'unified'} aria-label="Unified diff" data-tip="Unified" onClick=${() => setMode('unified')}><${Icon} name="rows-2" size=${14} /></button>
        <button type="button" aria-pressed=${mode === 'split'} aria-label="Split diff" data-tip=${narrow ? 'Split, best on a wide window' : 'Split'} onClick=${() => setMode('split')}><${Icon} name="columns-2" size=${14} /></button>
      </div>`}
    </div>
    <${Integrate} s=${s} w=${w} project=${project} />
    ${w.merge && tab !== 'conflicts' && html`<div class="git-integrate warn"><${Icon} name="triangle-alert" size=${14} class="warn-text" /><span class="grow"><b>A merge stopped on ${plural(conflictCount || w.merge.files.length, 'conflicted file')}.</b> Commits wait until it is finished or aborted.</span>
      <button type="button" class="btn sm warn" onClick=${() => setTab('conflicts')}>Resolve conflicts</button></div>`}
    ${tab === 'changes' ? html`<${Changes} key=${w.id} s=${s} w=${w} mode=${mode} phone=${phone} />`
      : tab === 'history' ? html`<${History} key=${w.id} s=${s} w=${w} mode=${mode} phone=${phone} />`
      : html`<${Conflicts} key=${w.id} s=${s} w=${w} phone=${phone} />`}
  </div>`;
}
