// The Terminal tab: shell sessions in a project's worktrees. The shell is a small
// pretend one, with a file tree, a few commands that print believable output, a command
// that streams, and a modal editor that takes over the whole grid.
import {
  html, useState, useEffect, useLayoutEffect, useRef, Icon, cx, update, notify, href, ago, useNow, persist, remember, uid, clamp, useMedia,
} from '../lib.js';
import { teamsOf, teamName, agentsOfTeam, machineOf, repoOf } from '../data.js';
import * as act from '../actions.js';
import { Menu, Avatar } from '../ui.js';

// ---- lines ---------------------------------------------------------------------
// A line is a list of [text, classes] pieces. `out` also accepts a plain string.
const MAX_LINES = 1500;
function out(sess, ...lines) {
  for (const l of lines) sess.lines.push(typeof l === 'string' ? [[l]] : l);
  if (sess.lines.length > MAX_LINES) sess.lines.splice(0, sess.lines.length - MAX_LINES);
}
const base = (p) => p.split('/').pop();

// ---- the pretend file tree --------------------------------------------------------
function files(root, project, branch) {
  const f = {};
  const put = (path, text) => { f[root + '/' + path] = text; };
  put('README.md', `# ${base(root)}\n\nWorktree for ${project.name}, on branch ${branch}.\n\nRun \`pnpm test\` for the unit tests.\nRun \`pnpm check\` for the full run that a merge needs.\n`);
  put('package.json', `{\n  "name": "lgcode",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "test": "vitest run",\n    "typecheck": "tsc --noEmit",\n    "check": "pnpm typecheck && vitest run --project full"\n  },\n  "engines": { "node": ">=26" }\n}\n`);
  put('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  put('tsconfig.json', '{\n  "compilerOptions": {\n    "strict": true,\n    "module": "nodenext",\n    "target": "es2024",\n    "noEmit": true\n  },\n  "include": ["packages/*/src", "packages/*/test"]\n}\n');
  put('.nvmrc', '26\n');
  put('docs/features.md', '# Feature list\n\n- Fold the sidebar into a 48 pixel rail.\n- Open an agent thread from the board.\n- Count open requests the same way everywhere.\n');
  put('packages/web/package.json', '{\n  "name": "@lgcode/web",\n  "private": true,\n  "scripts": { "test": "vitest run" }\n}\n');
  put('packages/web/src/shell/Sidebar.tsx', `import { Rail } from './Rail';\nimport { openCount } from './attention';\n\nexport function Sidebar({ folded, projects }: SidebarProps) {\n  if (folded) return <Rail count={openCount(projects)} />;\n  return (\n    <aside className="sidebar" aria-label="Navigation">\n      <ProjectTree projects={projects} />\n    </aside>\n  );\n}\n`);
  put('packages/web/src/shell/Rail.tsx', `export function Rail({ count }: { count: number }) {\n  return (\n    <nav className="rail" aria-label="Navigation">\n      <RailLink to="/home" icon="house" pip={count > 0} />\n    </nav>\n  );\n}\n`);
  put('packages/web/src/shell/attention.ts', `import type { Project, Request } from '@lgcode/client';\n\n// A request held by a lead does not count for the owner.\nexport function openCount(projects: Project[]): number {\n  return projects.flatMap((p) => p.requests).filter(needsOwner).length;\n}\n\nconst needsOwner = (r: Request) => r.status === 'open' && r.heldBy === null;\n`);
  put('packages/web/src/shell/attention.test.ts', `import { expect, test } from 'vitest';\nimport { openCount } from './attention';\n\ntest('a request held by a lead is not counted', () => {\n  expect(openCount([projectWith({ heldBy: 'lead' })])).toBe(0);\n});\n`);
  put('packages/client/package.json', '{\n  "name": "@lgcode/client",\n  "private": true\n}\n');
  put('packages/client/src/socket.ts', `export function reconnect(socket: Socket, wait = 250): Promise<void> {\n  return closed(socket).then(() => open(socket, wait));\n}\n`);
  put('packages/client/test/reconnect.test.ts', `import { expect, test } from 'vitest';\nimport { reconnect } from '../src/socket';\n\ntest('reconnect waits for the socket to close', async () => {\n  const socket = fakeSocket();\n  await reconnect(socket);\n  expect(socket.opened).toBe(2);\n});\n`);
  return f;
}
function norm(path) {
  const parts = [];
  for (const p of path.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') { if (parts.length > 1) parts.pop(); } else parts.push(p);
  }
  return parts.join('/') || '~';
}
function resolve(sess, arg) {
  if (!arg) return sess.cwd;
  if (arg === '~' || arg.startsWith('~/')) return norm(arg);
  if (arg.startsWith('/')) return null;
  return norm(sess.cwd + '/' + arg);
}
const isFile = (sess, p) => p != null && Object.hasOwn(sess.fs, p);
const isDir = (sess, p) => p != null && (p === '~' || Object.keys(sess.fs).some((k) => k.startsWith(p + '/')));
function list(sess, dir) {
  const seen = new Map();
  for (const k of Object.keys(sess.fs)) {
    if (!k.startsWith(dir + '/')) continue;
    const rest = k.slice(dir.length + 1); const name = rest.split('/')[0];
    if (!seen.has(name)) seen.set(name, { name, dir: rest.includes('/'), size: rest.includes('/') ? 4096 : sess.fs[k].length });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
const inRepo = (sess) => sess.cwd === sess.root || sess.cwd.startsWith(sess.root + '/');
const shortDir = (sess) => (sess.cwd === '~' ? '~' : base(sess.cwd));
function promptLine(sess) {
  return [[sess.host, 'tc-g tc-b'], [' '], [shortDir(sess), 'tc-bl tc-b'], ...(inRepo(sess) ? [[' ‹' + sess.branch + '›', 'tc-m']] : []), [' % ', sess.exit ? 'tc-r tc-b' : 'tc-m']];
}

// ---- commands that stream ----------------------------------------------------------
function stream(sess, label, steps, exit = 0, after) {
  let i = 0;
  const next = () => {
    if (!sess.running) return;
    if (i >= steps.length) { sess.running = null; sess.exit = exit; after?.(); notify(); return; }
    const [delay, line] = steps[i++];
    sess.running.timer = setTimeout(() => { out(sess, line); notify(); next(); }, delay);
  };
  sess.running = { label, timer: null };
  next();
}
function stopRunning(sess) {
  if (!sess.running) return;
  clearTimeout(sess.running.timer); sess.running = null;
}
const TEST_FILES = [
  ['packages/web/src/shell/attention.test.ts', 14, 38], ['packages/web/src/shell/Sidebar.test.tsx', 22, 141], ['packages/web/src/shell/Rail.test.tsx', 9, 77],
  ['packages/web/src/thread/Thread.test.tsx', 41, 312], ['packages/web/src/thread/draft.test.ts', 12, 19], ['packages/web/src/board/columns.test.ts', 27, 44],
  ['packages/web/src/board/SprintCard.test.tsx', 18, 126], ['packages/web/src/requests/answer.test.ts', 33, 58], ['packages/client/test/reconnect.test.ts', 9, 903],
  ['packages/client/test/socket.test.ts', 46, 221], ['packages/client/test/routes.test.ts', 64, 87], ['packages/engine/test/board/kinds.test.ts', 117, 164],
];
const stamp = () => new Date().toTimeString().slice(0, 8);
function testSteps(sess, { pace = 260, fail = false, total = 412 } = {}) {
  const steps = [
    [120, ''], [40, [[`> lgcode@0.4.0 ${fail ? 'check' : 'test'} ${sess.root}`, 'tc-m']]], [40, [[`> ${fail ? 'pnpm typecheck && vitest run --project full' : 'vitest run'}`, 'tc-m']]], [pace * 2, ''],
    [60, [[' RUN ', 'tc-inv tc-bl'], [' ' + sess.root, 'tc-m']]], [pace, ''],
  ];
  for (const [file, n, ms] of TEST_FILES) {
    const bad = fail && file.includes('reconnect');
    steps.push([pace + Math.round(ms / 3), bad
      ? [[' ❯ ', 'tc-r'], [file], [` (${n} tests | `, 'tc-m'], ['1 failed', 'tc-r'], [')', 'tc-m'], [` ${ms}ms`, 'tc-y']]
      : [[' ✓ ', 'tc-g'], [file], [` (${n} tests)`, 'tc-m'], [` ${ms}ms`, ms > 300 ? 'tc-y' : 'tc-m']]]);
  }
  if (fail) {
    steps.push([pace * 3, [[' ✓ ', 'tc-g'], ['… 1,187 more files', 'tc-m']]], [200, ''],
      [40, [[' FAIL ', 'tc-inv tc-r'], [' packages/client/test/reconnect.test.ts > reconnect waits for the socket to close', 'tc-r']]],
      [40, [['AssertionError: expected 1 to be 2', 'tc-r tc-b']]], [40, [['  - Expected  ', 'tc-g'], ['2', 'tc-g']]], [40, [['  + Received  ', 'tc-r'], ['1', 'tc-r']]],
      [40, [[' ❯ packages/client/test/reconnect.test.ts:7:25', 'tc-bl']]], [200, ''],
      [40, [[' Test Files  ', 'tc-m'], ['1 failed', 'tc-r tc-b'], [' | ', 'tc-m'], ['1,198 passed', 'tc-g tc-b'], [' (1,199)', 'tc-m']]],
      [40, [['      Tests  ', 'tc-m'], ['1 failed', 'tc-r tc-b'], [' | ', 'tc-m'], ['7,803 passed', 'tc-g tc-b'], [' (7,804)', 'tc-m']]],
      [40, [['   Start at  ', 'tc-m'], [stamp()]]], [40, [['   Duration  ', 'tc-m'], ['6 min 12 s']]], [40, ''],
      [40, [[' ELIFECYCLE ', 'tc-inv tc-r'], [' Command failed with exit code 1.', 'tc-r']]]);
  } else {
    steps.push([pace * 2, ''],
      [40, [[' Test Files  ', 'tc-m'], [`${TEST_FILES.length} passed`, 'tc-g tc-b'], [` (${TEST_FILES.length})`, 'tc-m']]],
      [40, [['      Tests  ', 'tc-m'], [`${total} passed`, 'tc-g tc-b'], [` (${total})`, 'tc-m']]],
      [40, [['   Start at  ', 'tc-m'], [stamp()]]], [40, [['   Duration  ', 'tc-m'], ['6.21s']]], [40, '']);
  }
  return steps;
}

// ---- the shell ---------------------------------------------------------------------
const HELP = [
  ['ls [-l] [folder]', 'List a folder'], ['cd <folder>', 'Change folder'], ['pwd', 'Print the current folder'], ['cat <file>', 'Print a file'],
  ['vim <file>', 'Edit a file'], ['git status', 'Show changed files'], ['git log --oneline', 'Show recent commits'], ['git branch', 'Show branches'],
  ['pnpm test', 'Run the unit tests'], ['pnpm check', 'Run the full suite'], ['pnpm typecheck', 'Check the types'], ['history', 'Show earlier commands'],
  ['clear', 'Clear the screen'], ['exit', 'Close this session'],
];
const LOG = [
  ['4be2d65', 'AC-15: count open requests once for the sidebar, the bell and Home'], ['a91c0f3', 'AC-14: fold the sidebar into a 48 pixel rail'],
  ['7d02e1b', 'AC-24: wait for the socket to close before reconnecting'], ['55e1bbd', 'Merge SP-01 Navigation foundation'],
  ['5e12347', 'test(web): budget the serial navigation journey'], ['79cd51d', 'Recover committed first projects after reload'],
  ['2c4f8aa', 'SP-01: breadcrumbs follow the project tree'], ['0b7de92', 'SP-01: routes for projects, teams and agents'],
];
function gitCmd(sess, args) {
  if (!inRepo(sess)) { out(sess, 'fatal: not a git repository (or any of the parent directories): .git'); return 128; }
  const sub = args[0];
  if (sub === 'status') {
    out(sess, `On branch ${sess.branch}`, `Your branch is ahead of 'origin/${sess.branch}' by 2 commits.`, '  (use "git push" to publish your local commits)', '',
      'Changes not staged for commit:', '  (use "git add <file>..." to update what will be committed)',
      [['\tmodified:   packages/web/src/shell/Sidebar.tsx', 'tc-r']], [['\tmodified:   packages/web/src/shell/attention.ts', 'tc-r']], '',
      'Untracked files:', '  (use "git add <file>..." to include in what will be committed)', [['\tpackages/web/src/shell/Rail.tsx', 'tc-r']], '',
      'no changes added to commit (use "git add" and/or "git commit -a")');
    return 0;
  }
  if (sub === 'log') {
    LOG.forEach(([hash, text], i) => out(sess, args.includes('--oneline')
      ? [[hash, 'tc-y'], ...(i === 0 ? [[' (', 'tc-y'], ['HEAD -> ', 'tc-bl tc-b'], [sess.branch, 'tc-g tc-b'], [')', 'tc-y']] : []), [' ' + text]]
      : [[`commit ${hash}  `, 'tc-y'], [text]]));
    return 0;
  }
  if (sub === 'branch') { out(sess, [['* ', 'tc-g'], [sess.branch, 'tc-g']], '  ' + sess.main); return 0; }
  if (sub === 'diff') {
    out(sess, [[' packages/web/src/shell/Sidebar.tsx   | 14 '], ['+++++++++', 'tc-g'], ['-----', 'tc-r']], [[' packages/web/src/shell/attention.ts  |  6 '], ['++++', 'tc-g'], ['--', 'tc-r']], ' 2 files changed, 13 insertions(+), 7 deletions(-)');
    return 0;
  }
  if (!sub) { out(sess, 'usage: git <command> [<args>]', '', 'Try: git status, git log --oneline, git branch, git diff --stat'); return 1; }
  out(sess, `git: '${sub}' is not available in this session. Try git status, git log --oneline, git branch or git diff --stat.`);
  return 1;
}
function exec(sess, raw, { onExit } = {}) {
  out(sess, [...promptLine(sess), [raw]]);
  const line = raw.trim();
  if (!line) return;
  if (sess.history[sess.history.length - 1] !== line) sess.history.push(line);
  sess.hIdx = null;
  const [cmd, ...args] = line.split(/\s+/);
  const flags = args.filter((a) => a.startsWith('-')); const rest = args.filter((a) => !a.startsWith('-'));
  let exit = 0;
  if (cmd === 'clear') { sess.lines = []; }
  else if (cmd === 'pwd') out(sess, sess.cwd);
  else if (cmd === 'whoami') out(sess, 'lgcode');
  else if (cmd === 'date') out(sess, new Date().toString());
  else if (cmd === 'echo') out(sess, args.join(' ').replace(/^["']|["']$/g, ''));
  else if (cmd === 'history') sess.history.forEach((h, i) => out(sess, [[String(i + 1).padStart(5) + '  ', 'tc-m'], [h]]));
  else if (cmd === 'help') { out(sess, 'Commands in this session:', ''); for (const [c, what] of HELP) out(sess, [['  ' + c.padEnd(20), 'tc-bl'], [what, 'tc-m']]); out(sess, '', [['Keys: Up and Down for history, Tab to complete, Ctrl+C to stop, Ctrl+L to clear.', 'tc-m']]); }
  else if (cmd === 'cd') {
    const to = resolve(sess, rest[0] || sess.root);
    if (isDir(sess, to)) sess.cwd = to;
    else { out(sess, isFile(sess, to) ? `cd: not a directory: ${rest[0]}` : `cd: no such file or directory: ${rest[0]}`); exit = 1; }
  }
  else if (cmd === 'ls' || cmd === 'll') {
    const to = resolve(sess, rest[0]); const long = cmd === 'll' || flags.some((f) => f.includes('l')); const all = flags.some((f) => f.includes('a'));
    if (isFile(sess, to)) out(sess, rest[0]);
    else if (!isDir(sess, to)) { out(sess, `ls: ${rest[0]}: No such file or directory`); exit = 1; }
    else {
      const items = list(sess, to).filter((x) => all || !x.name.startsWith('.'));
      if (long) {
        out(sess, [[`total ${items.length * 8}`, 'tc-m']]);
        for (const x of items) out(sess, [[(x.dir ? 'drwxr-xr-x' : '-rw-r--r--') + '  1 lgcode lgcode ', 'tc-m'], [String(x.size).padStart(5) + ' Nov 10 20:37 ', 'tc-m'], [x.name + (x.dir ? '/' : ''), x.dir ? 'tc-bl tc-b' : '']]);
      } else if (items.length) {
        out(sess, items.flatMap((x, i) => [[x.name + (x.dir ? '/' : ''), x.dir ? 'tc-bl tc-b' : ''], ...(i < items.length - 1 ? [['   ']] : [])]));
      }
    }
  }
  else if (cmd === 'cat') {
    if (!rest.length) { out(sess, 'usage: cat <file>'); exit = 1; }
    for (const a of rest) {
      const p = resolve(sess, a);
      if (isFile(sess, p)) out(sess, ...sess.fs[p].replace(/\n$/, '').split('\n'));
      else { out(sess, isDir(sess, p) ? `cat: ${a}: Is a directory` : `cat: ${a}: No such file or directory`); exit = 1; }
    }
  }
  else if (cmd === 'vim' || cmd === 'vi' || cmd === 'nvim') {
    const p = resolve(sess, rest[0] || 'untitled.txt');
    if (isDir(sess, p)) { out(sess, `vim: "${rest[0]}" is a directory`); exit = 1; }
    else {
      const fresh = !isFile(sess, p);
      sess.vim = { path: p, name: rest[0] || 'untitled.txt', lines: fresh ? [''] : sess.fs[p].replace(/\n$/, '').split('\n'), row: 0, col: 0, top: 0, mode: 'normal', cmd: '', pending: '', dirty: false, msg: null };
      sess.vim.msg = fresh ? `"${sess.vim.name}" [New]` : `"${sess.vim.name}" ${sess.vim.lines.length}L, ${sess.fs[p].length}B`;
    }
  }
  else if (cmd === 'git') exit = gitCmd(sess, args);
  else if (cmd === 'pnpm' || cmd === 'npm') {
    const script = args[0] === 'run' ? args[1] : args[0];
    if (!inRepo(sess)) { out(sess, [[' ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND ', 'tc-inv tc-r'], [' No package.json was found in "' + sess.cwd + '".', 'tc-r']]); exit = 1; }
    else if (script === 'test') { stream(sess, 'pnpm test', testSteps(sess), 0); return; }
    else if (script === 'check') { stream(sess, 'pnpm check', testSteps(sess, { pace: 200, fail: true }), 1); return; }
    else if (script === 'typecheck') { stream(sess, 'pnpm typecheck', [[120, ''], [40, [[`> lgcode@0.4.0 typecheck ${sess.root}`, 'tc-m']]], [40, [['> tsc --noEmit', 'tc-m']]], [1700, '']], 0); return; }
    else if (script === 'install' || script === 'i') { stream(sess, 'pnpm install', [[300, 'Lockfile is up to date, resolution step is skipped'], [500, 'Already up to date'], [200, [['Done in 1.1s', 'tc-m']]]], 0); return; }
    else { out(sess, [[' ERR_PNPM_NO_SCRIPT ', 'tc-inv tc-r'], [` Missing script: ${script || ''}`, 'tc-r']], '', 'Scripts in this package: test, typecheck, check'); exit = 1; }
  }
  else if (cmd === 'exit') { onExit?.(); return; }
  else { out(sess, `zsh: command not found: ${cmd}`); exit = 127; }
  sess.exit = exit;
}
function complete(sess) {
  const before = sess.input.slice(0, sess.pos); const word = before.split(' ').pop();
  if (!before.includes(' ')) {
    const hits = ['cat', 'cd', 'clear', 'exit', 'git', 'help', 'history', 'ls', 'pnpm', 'pwd', 'vim'].filter((c) => c.startsWith(word));
    if (hits.length === 1) insert(sess, hits[0].slice(word.length) + ' ');
    return;
  }
  const cut = word.lastIndexOf('/'); const dirPart = cut >= 0 ? word.slice(0, cut + 1) : ''; const stem = word.slice(cut + 1);
  const dir = resolve(sess, dirPart || '.'); if (!isDir(sess, dir)) return;
  const hits = list(sess, dir).filter((x) => x.name.startsWith(stem));
  if (hits.length === 1) insert(sess, hits[0].name.slice(stem.length) + (hits[0].dir ? '/' : ' '));
  else if (hits.length > 1) {
    let common = hits[0].name; for (const h of hits) while (!h.name.startsWith(common)) common = common.slice(0, -1);
    if (common.length > stem.length) insert(sess, common.slice(stem.length));
    else { out(sess, [...promptLine(sess), [sess.input]], hits.flatMap((x) => [[x.name + (x.dir ? '/' : ''), x.dir ? 'tc-bl tc-b' : ''], ['   ']])); }
  }
}
function insert(sess, text) { sess.input = sess.input.slice(0, sess.pos) + text + sess.input.slice(sess.pos); sess.pos += text.length; }

// ---- the editor that takes over the grid ----------------------------------------------
function vimKey(sess, k) {
  const v = sess.vim; const key = k.key; const line = () => v.lines[v.row];
  const fix = () => { v.row = clamp(v.row, 0, v.lines.length - 1); v.col = clamp(v.col, 0, Math.max(0, line().length - (v.mode === 'insert' ? 0 : 1))); };
  if (v.mode === 'command') {
    if (key === 'Escape') { v.mode = 'normal'; v.cmd = ''; }
    else if (key === 'Backspace') { if (v.cmd) v.cmd = v.cmd.slice(0, -1); else v.mode = 'normal'; }
    else if (key === 'Enter') {
      const c = v.cmd.trim(); v.cmd = ''; v.mode = 'normal';
      const write = () => { sess.fs[v.path] = v.lines.join('\n') + '\n'; v.dirty = false; v.msg = `"${v.name}" ${v.lines.length}L, ${sess.fs[v.path].length}B written`; };
      const quit = () => { sess.vim = null; sess.exit = 0; };
      if (c === 'w') write();
      else if (c === 'wq' || c === 'x') { write(); quit(); }
      else if (c === 'q!') quit();
      else if (c === 'q') { if (v.dirty) { v.msg = 'E37: No write since last change (add ! to override)'; v.err = true; return true; } quit(); }
      else if (/^\d+$/.test(c)) { v.row = clamp(Number(c) - 1, 0, v.lines.length - 1); v.col = 0; }
      else if (c) { v.msg = `E492: Not an editor command: ${c}`; v.err = true; return true; }
    }
    else if (key.length === 1 && !k.ctrl) v.cmd += key;
    else return false;
    v.err = false; return true;
  }
  if (v.mode === 'insert') {
    if (key === 'Escape') { v.mode = 'normal'; v.col = Math.max(0, v.col - 1); v.msg = null; }
    else if (key === 'Enter') { const l = line(); v.lines.splice(v.row, 1, l.slice(0, v.col), l.slice(v.col)); v.row++; v.col = 0; v.dirty = true; }
    else if (key === 'Backspace') {
      if (v.col > 0) { const l = line(); v.lines[v.row] = l.slice(0, v.col - 1) + l.slice(v.col); v.col--; v.dirty = true; }
      else if (v.row > 0) { const prev = v.lines[v.row - 1]; v.col = prev.length; v.lines.splice(v.row - 1, 2, prev + line()); v.row--; v.dirty = true; }
    }
    else if (key === 'Tab') { v.lines[v.row] = line().slice(0, v.col) + '  ' + line().slice(v.col); v.col += 2; v.dirty = true; }
    else if (key === 'ArrowLeft') v.col--; else if (key === 'ArrowRight') v.col++;
    else if (key === 'ArrowUp') v.row--; else if (key === 'ArrowDown') v.row++;
    else if (key.length === 1 && !k.ctrl) { v.lines[v.row] = line().slice(0, v.col) + key + line().slice(v.col); v.col++; v.dirty = true; }
    else return false;
    fix(); return true;
  }
  // normal mode
  const pend = v.pending; v.pending = ''; v.err = false;
  if (key === ':') { v.mode = 'command'; v.cmd = ''; v.msg = null; return true; }
  if (key === 'i') { v.mode = 'insert'; v.msg = null; }
  else if (key === 'a') { v.mode = 'insert'; v.col = Math.min(line().length, v.col + 1); v.msg = null; return true; }
  else if (key === 'A') { v.mode = 'insert'; v.col = line().length; v.msg = null; return true; }
  else if (key === 'o') { v.lines.splice(v.row + 1, 0, ''); v.row++; v.col = 0; v.mode = 'insert'; v.dirty = true; v.msg = null; }
  else if (key === 'O') { v.lines.splice(v.row, 0, ''); v.col = 0; v.mode = 'insert'; v.dirty = true; v.msg = null; }
  else if (key === 'h' || key === 'ArrowLeft' || key === 'Backspace') v.col--;
  else if (key === 'l' || key === 'ArrowRight' || key === ' ') v.col++;
  else if (key === 'j' || key === 'ArrowDown' || key === 'Enter') v.row++;
  else if (key === 'k' || key === 'ArrowUp') v.row--;
  else if (key === '0' || key === 'Home') v.col = 0;
  else if (key === '$' || key === 'End') v.col = line().length;
  else if (key === 'G') v.row = v.lines.length - 1;
  else if (key === 'g') { if (pend === 'g') v.row = 0; else v.pending = 'g'; }
  else if (key === 'w') { const m = line().slice(v.col + 1).search(/(?<=\W)\w/); if (m >= 0) v.col += m + 1; else if (v.row < v.lines.length - 1) { v.row++; v.col = 0; } }
  else if (key === 'x') { if (line().length) { v.lines[v.row] = line().slice(0, v.col) + line().slice(v.col + 1); v.dirty = true; } }
  else if (key === 'd') { if (pend === 'd') { v.lines.splice(v.row, 1); if (!v.lines.length) v.lines.push(''); v.dirty = true; } else v.pending = 'd'; }
  else if (key === 'Escape') { /* stays in normal mode */ }
  else return key.length === 1 && !k.ctrl;
  fix(); return true;
}

// One key, from the keyboard or from the phone key row. Returns true when it was used.
function press(sess, k, ctx) {
  if (sess.status !== 'open' || sess.watching) return false;
  const key = k.key;
  if (sess.vim) return vimKey(sess, k);
  if (k.ctrl) {
    const c = key.toLowerCase();
    if (c === 'c') { if (sess.running) { stopRunning(sess); out(sess, [['^C', 'tc-m']]); sess.exit = 130; } else { out(sess, [...promptLine(sess), [sess.input + '^C']]); sess.input = ''; sess.pos = 0; } return true; }
    if (c === 'l') { sess.lines = []; return true; }
    if (sess.running) return false;
    if (c === 'u') { sess.input = sess.input.slice(sess.pos); sess.pos = 0; return true; }
    if (c === 'a') { sess.pos = 0; return true; }
    if (c === 'e') { sess.pos = sess.input.length; return true; }
    if (c === 'w') { const cut = sess.input.slice(0, sess.pos).replace(/\S+\s*$/, ''); sess.input = cut + sess.input.slice(sess.pos); sess.pos = cut.length; return true; }
    if (c === 'd' && !sess.input) { ctx.close(sess); return true; }
    return false;
  }
  if (sess.running) return key.length === 1 || key === 'Enter';
  if (key === 'Enter') { const raw = sess.input; sess.input = ''; sess.pos = 0; exec(sess, raw, { onExit: () => ctx.close(sess) }); }
  else if (key === 'Backspace') { if (sess.pos > 0) { sess.input = sess.input.slice(0, sess.pos - 1) + sess.input.slice(sess.pos); sess.pos--; } }
  else if (key === 'Delete') sess.input = sess.input.slice(0, sess.pos) + sess.input.slice(sess.pos + 1);
  else if (key === 'ArrowLeft') sess.pos = Math.max(0, sess.pos - 1);
  else if (key === 'ArrowRight') sess.pos = Math.min(sess.input.length, sess.pos + 1);
  else if (key === 'Home') sess.pos = 0;
  else if (key === 'End') sess.pos = sess.input.length;
  else if (key === 'ArrowUp') {
    if (!sess.history.length) return true;
    if (sess.hIdx == null) { sess.stash = sess.input; sess.hIdx = sess.history.length; }
    sess.hIdx = Math.max(0, sess.hIdx - 1); sess.input = sess.history[sess.hIdx]; sess.pos = sess.input.length;
  }
  else if (key === 'ArrowDown') {
    if (sess.hIdx == null) return true;
    sess.hIdx++;
    if (sess.hIdx >= sess.history.length) { sess.hIdx = null; sess.input = sess.stash || ''; } else sess.input = sess.history[sess.hIdx];
    sess.pos = sess.input.length;
  }
  else if (key === 'Tab') complete(sess);
  else if (key === 'Escape') { /* nothing to cancel at the prompt */ }
  else if (key.length === 1) insert(sess, key);
  else return false;
  return true;
}

// ---- sessions --------------------------------------------------------------------
const slugOf = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function makeSession(s, project, { machine, root, branch, status = 'open' }) {
  const m = machineOf(s, machine); const repo = repoOf(s, project);
  return {
    id: uid('term'), name: null, machine, host: m.name.toLowerCase(), root, cwd: root, branch, main: repo?.main || 'main', fs: files(root, project, branch),
    lines: [], input: '', pos: 0, history: [], hIdx: null, running: null, exit: 0, status, watching: null, vim: null, openedAt: Date.now(),
  };
}
const sessionLabel = (s, x) => x.name || `${machineOf(s, x.machine)?.name} · ${base(x.root)}`;
function worktrees(s, project) {
  const list = [{ label: project.name, root: project.folder, branch: project.branch, machine: project.machine }];
  for (const t of teamsOf(s, project.id)) list.push({ label: teamName(t), root: `${project.folder}-${slugOf(t.area || t.stage)}`, branch: t.branch, machine: project.machine, team: t });
  return list;
}
function ensure(s, project) {
  const all = s.terminal.byProject;
  if (all[project.id]) return all[project.id];
  const wts = worktrees(s, project);
  const first = makeSession(s, project, wts[0]);
  exec(first, 'git status');
  const sessions = [first];
  // A worktree where a builder is working opens as a session that watches the builder's command.
  const busy = wts.find((w) => w.team && agentsOfTeam(s, w.team.id).some((a) => a.role === 'builder' && a.state === 'working'));
  if (busy) {
    const builder = agentsOfTeam(s, busy.team.id).find((a) => a.role === 'builder' && a.state === 'working');
    const w = makeSession(s, project, busy);
    w.watching = { agent: builder.id, cmd: 'pnpm test', done: false, startedAt: Date.now() };
    out(w, [...promptLine(w), ['pnpm test']]);
    stream(w, 'pnpm test', testSteps(w, { pace: 1500 }), 0, () => { w.watching.done = true; w.watching.finishedAt = Date.now(); });
    sessions.push(w);
  }
  const other = s.machines.find((m) => m.status === 'online' && m.id !== project.machine);
  const second = wts.filter((w) => w.team && w !== busy)[0];
  if (other && second) {
    const d = makeSession(s, project, { ...second, machine: other.id, root: `${other.workspace}/${repoOf(s, project).name}/.worktrees/${base(second.root)}`, status: 'dropped' });
    exec(d, 'git log --oneline'); d.droppedAt = Date.now() - 4 * 60_000;
    sessions.push(d);
  }
  const off = s.machines.find((m) => m.status !== 'online');
  if (off && wts.length > 1) {
    const o = makeSession(s, project, { machine: off.id, root: `${off.workspace}/${repoOf(s, project).name}`, branch: repoOf(s, project).main, status: 'offline' });
    exec(o, 'ls'); sessions.push(o);
  }
  all[project.id] = { sessions, active: first.id };
  return all[project.id];
}
export function seedTerminal(state) {
  state.terminal = { byProject: {}, fontSize: clamp(persist('termFont', 13), 11, 18) };
}

// ---- the tab ---------------------------------------------------------------------
function Line({ segs }) {
  return html`<div class="tl">${segs.length ? segs.map(([t, c]) => (c ? html`<span class=${c}>${t}</span>` : t)) : ' '}</div>`;
}
function withCursor(text, pos, show) {
  if (!show) return text;
  return html`${text.slice(0, pos)}<span class="cur">${text[pos] || ' '}</span>${text.slice(pos + 1)}`;
}
function VimScreen({ v, rows, focused }) {
  const body = Math.max(3, rows - 1);
  if (v.row < v.top) v.top = v.row; else if (v.row >= v.top + body) v.top = v.row - body + 1;
  const shown = v.lines.slice(v.top, v.top + body);
  const status = v.mode === 'command' ? html`:${v.cmd}<span class="cur"> </span>`
    : v.mode === 'insert' ? html`<span class="tc-b">-- INSERT --</span>`
    : v.msg ? html`<span class=${v.err ? 'tc-inv tc-r' : ''}>${v.msg}</span>` : '';
  return html`<div class="term-alt" style=${{ '--rows': body }}>
    ${shown.map((l, i) => html`<div class="tl">${v.top + i === v.row && v.mode !== 'command' ? withCursor(l, v.col, true) : (l || ' ')}</div>`)}
    ${Array.from({ length: Math.max(0, body - shown.length) }, () => html`<div class="tl tc-bl">~</div>`)}
    <div class="tl vim-status"><span class="grow">${status}</span><span class="tc-m">${v.dirty ? '[+] ' : ''}${v.row + 1},${v.col + 1}</span><span class="tc-m">${v.top === 0 ? (v.lines.length <= body ? 'All' : 'Top') : v.top + body >= v.lines.length ? 'Bot' : Math.round((v.top / Math.max(1, v.lines.length - body)) * 100) + '%'}</span></div>
  </div>`;
}
const KEYS = [
  ['Esc', 'Escape'], ['Tab', 'Tab'], ['Ctrl', 'ctrl'], ['←', 'ArrowLeft', 'Left'], ['↓', 'ArrowDown', 'Down'], ['↑', 'ArrowUp', 'Up'], ['→', 'ArrowRight', 'Right'],
  ['|', '|', 'Pipe'], ['/', '/', 'Slash'], ['-', '-', 'Dash'], ['~', '~', 'Tilde'], [':', ':', 'Colon'],
];

export function TerminalTab({ s, project }) {
  const term = ensure(s, project);
  const sess = term.sessions.find((x) => x.id === term.active) || term.sessions[0];
  const now = useNow(15_000);
  const phone = useMedia('(max-width: 860px)');
  const screen = useRef(null); const input = useRef(null); const probe = useRef(null); const stick = useRef(true);
  const [focused, setFocused] = useState(false);
  const [ctrl, setCtrl] = useState(false);
  const [dim, setDim] = useState({ cols: 80, rows: 24 });
  const fs = s.terminal.fontSize;
  const setFont = (n) => { const v = clamp(n, 11, 18); update((st) => { st.terminal.fontSize = v; }); remember('termFont', v); };

  const select = (id) => update(() => { term.active = id; });
  const remove = (x) => update(() => {
    stopRunning(x);
    const i = term.sessions.indexOf(x); term.sessions.splice(i, 1);
    if (term.active === x.id) term.active = (term.sessions[i] || term.sessions[i - 1])?.id || null;
  });
  const close = (x) => {
    const busy = x.status === 'open' && !x.watching && (x.running || x.vim?.dirty);
    if (!busy) return remove(x);
    act.confirm({
      title: `Close ${sessionLabel(s, x)}?`, action: 'Close session',
      body: x.running ? `${x.running.label} is still running in this session.` : `${x.vim.name} has changes that are not written.`,
      lost: [x.running ? `${x.running.label} stops before it finishes` : `Your edits to ${x.vim.name}`], onConfirm: () => remove(x),
    });
  };
  const open = (w) => update(() => { const n = makeSession(s, project, w); term.sessions.push(n); term.active = n.id; });
  const rename = (x) => act.openDialog({
    type: 'rename', title: 'Rename session', value: sessionLabel(s, x), taken: term.sessions.filter((y) => y !== x).map((y) => sessionLabel(s, y)),
    note: 'The name is only a label for this tab. The folder and the machine stay the same.', onRename: (v) => update(() => { x.name = v; }),
  });
  const reconnect = (x) => {
    update(() => { x.status = 'reconnecting'; });
    setTimeout(() => update(() => { x.status = 'open'; out(x, [[`Reconnected to ${machineOf(s, x.machine).name}. The session kept running while you were away.`, 'tc-m']]); }), 1100);
  };
  const takeOver = (x) => {
    const a = s.agents.find((y) => y.id === x.watching.agent);
    const go = () => update(() => { if (x.running) { stopRunning(x); out(x, [['^C', 'tc-m']]); x.exit = 130; } x.watching = null; focus(); });
    if (x.watching.done) return go();
    act.confirm({
      title: 'Take over this session?', action: 'Take over',
      body: `${a?.name || 'The agent'} is running ${x.watching.cmd} here. Taking over interrupts it and gives the keyboard to you.`,
      lost: [`${x.watching.cmd} stops before it finishes`, `${a?.name || 'The agent'} is told that you took the session`], onConfirm: go,
    });
  };
  const copyAll = (x) => {
    const text = x.lines.map((l) => l.map(([t]) => t).join('')).join('\n');
    (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => act.toast('Copied the session output'), () => act.toast('Copying is blocked in this browser', 'error'));
  };

  const focus = () => { if (!String(getSelection())) input.current?.focus({ preventScroll: true }); };
  const send = (k) => { if (!sess) return false; const used = press(sess, k, { close }); if (used) { stick.current = true; notify(); } return used; };
  const onKeyDown = (e) => {
    if (e.metaKey || e.isComposing) return;
    const c = e.key.toLowerCase();
    if (e.ctrlKey && (c === 'k' || c === 'b' || c === 'v' || c === 'r' || e.shiftKey)) return;
    if (e.ctrlKey && c === 'c' && String(getSelection())) return;
    if (e.key === 'Tab' && e.shiftKey) return;
    const k = { key: e.key, ctrl: e.ctrlKey || ctrl };
    if (ctrl && e.key.length === 1) setCtrl(false);
    if (send(k) || (e.key.length === 1 && !e.ctrlKey) || e.key === 'Tab') e.preventDefault();
  };
  // Phone keyboards deliver text as input events, not key events.
  const onInput = (e) => { const text = e.target.value; e.target.value = ''; for (const ch of text) send(ch === '\n' ? { key: 'Enter' } : { key: ch, ctrl }); if (ctrl) setCtrl(false); };
  const onPaste = (e) => { e.preventDefault(); const text = (e.clipboardData?.getData('text') || '').replace(/\r/g, ''); for (const ch of text.split('\n')[0]) send({ key: ch }); };
  const tapKey = (k) => { if (k === 'ctrl') return setCtrl(!ctrl); send({ key: k, ctrl }); if (ctrl) setCtrl(false); focus(); };

  // Measure the grid: how many columns and rows fit at this size.
  useLayoutEffect(() => {
    const el = screen.current; if (!el) return;
    const measure = () => {
      const cw = (probe.current?.getBoundingClientRect().width || fs * 6) / 10; const lh = Math.round(fs * 1.45);
      const cs = getComputedStyle(el);
      const cols = Math.max(20, Math.floor((el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) / cw));
      const rows = Math.max(6, Math.floor((el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / lh));
      setDim((d) => (d.cols === cols && d.rows === rows ? d : { cols, rows }));
    };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [fs, sess?.id, !!sess]);
  useLayoutEffect(() => { const el = screen.current; if (el && stick.current && !sess?.vim) el.scrollTop = el.scrollHeight; });
  useEffect(() => { stick.current = true; if (!phone) focus(); }, [sess?.id]);

  const newItems = worktrees(s, project).flatMap((w) => {
    const repo = repoOf(s, project);
    return s.machines.filter((m) => m.id === w.machine || (!w.team && repo?.folders?.[m.id])).map((m) => ({
      label: html`<span>${w.label}</span><span class="muted"> · ${m.name}</span>`, hint: html`<span class="mono">${m.id === w.machine ? w.root : repo.folders[m.id]}</span>`, icon: w.team ? 'git-branch' : 'folder-git-2',
      sub: m.name, disabled: m.status !== 'online', why: m.status !== 'online' ? `${m.name} is offline` : null,
      onSelect: () => open(m.id === w.machine ? w : { machine: m.id, root: repo.folders[m.id], branch: repo.main }),
    }));
  });
  const newSession = (cls = 'icon-btn', inner) => html`<${Menu} class=${cls} label="New session" width=${360} align="start"
    trigger=${inner || html`<${Icon} name="plus" size=${15} />`}
    header=${html`<div class="menu-label">Open a shell in a worktree</div>`} items=${newItems} />`;

  if (!sess) {
    return html`<div class="term"><div class="term-none">
      <${Icon} name="square-terminal" size=${22} class="faint" />
      <strong>No sessions are open</strong>
      <span class="muted">A session is a shell in one worktree on one machine. Agents keep working whether or not a session is open.</span>
      ${newSession('btn primary', html`<${Icon} name="plus" size=${14} /><span>New session</span>`)}
    </div></div>`;
  }

  const m = machineOf(s, sess.machine);
  const live = sess.status === 'open' && !sess.watching;
  const watcher = sess.watching && s.agents.find((a) => a.id === sess.watching.agent);
  const dotOf = (x) => (x.status === 'offline' ? 'failed' : x.status !== 'open' ? 'waiting' : x.running ? 'working pulse' : 'working');
  const stateWord = sess.status === 'offline' ? 'Machine offline' : sess.status === 'dropped' ? 'Disconnected' : sess.status === 'reconnecting' ? 'Reconnecting'
    : sess.watching ? 'Watching' : sess.vim ? `vim · ${sess.vim.mode === 'insert' ? 'insert' : 'normal'}` : sess.running ? `Running ${sess.running.label}` : 'Ready';

  return html`<div class="term" style=${{ '--term-fs': fs + 'px', '--term-lh': Math.round(fs * 1.45) + 'px' }}>
    <div class="term-tabs">
      <div class="term-tablist" role="tablist" aria-label="Terminal sessions">
        ${term.sessions.map((x) => html`<div key=${x.id} class=${cx('term-tab', x.id === sess.id && 'on')}>
          <button type="button" role="tab" aria-selected=${x.id === sess.id} class="term-tab-main" onClick=${() => select(x.id)} onDblClick=${() => rename(x)} title=${x.root}>
            ${x.watching ? html`<${Icon} name="eye" size=${13} class="faint" />` : html`<i class=${cx('dot', dotOf(x))}></i>`}
            <span class="truncate">${sessionLabel(s, x)}</span>
          </button>
          <button type="button" class="icon-btn sm term-tab-x" aria-label=${'Close ' + sessionLabel(s, x)} onClick=${() => close(x)}><${Icon} name="x" size=${12} /></button>
        </div>`)}
      </div>
      ${newSession()}
      <span class="grow"></span>
      <div class="term-tools">
        <div class="term-font not-phone" role="group" aria-label="Text size">
          <button type="button" class="icon-btn" aria-label="Smaller text" data-tip="Smaller text" disabled=${fs <= 11} onClick=${() => setFont(fs - 1)}><${Icon} name="minus" size=${14} /></button>
          <span class="num">${fs}</span>
          <button type="button" class="icon-btn" aria-label="Larger text" data-tip="Larger text" disabled=${fs >= 18} onClick=${() => setFont(fs + 1)}><${Icon} name="plus" size=${14} /></button>
        </div>
        <${Menu} class="icon-btn" label="Session actions" align="end" width=${230} trigger=${html`<${Icon} name="ellipsis" size=${16} />`} items=${[
          { label: 'Rename session', icon: 'pencil', onSelect: () => rename(sess) },
          { label: 'Copy all output', icon: 'copy', onSelect: () => copyAll(sess) },
          { label: 'Clear scrollback', icon: 'rotate-ccw', disabled: !!sess.vim, onSelect: () => update(() => { sess.lines = []; }) },
          ...(phone ? [{ sep: true }, { label: 'Larger text', icon: 'plus', disabled: fs >= 18, onSelect: () => setFont(fs + 1) }, { label: 'Smaller text', icon: 'minus', disabled: fs <= 11, onSelect: () => setFont(fs - 1) }] : []),
          { sep: true },
          { label: 'Close session', icon: 'x', danger: true, onSelect: () => close(sess) },
        ]} />
      </div>
    </div>

    ${sess.watching && html`<div class="term-bar watch">
      ${watcher && html`<${Avatar} agent=${watcher} s=${s} size="sm" />`}
      <span class="grow">${sess.watching.done
        ? html`<b>${watcher?.name}</b> finished <span class="mono">${sess.watching.cmd}</span> ${ago(sess.watching.finishedAt, now) === 'now' ? 'just now' : ago(sess.watching.finishedAt, now) + ' ago'}. The session is still the agent's.`
        : html`<b>${watcher?.name}</b> is running <span class="mono">${sess.watching.cmd}</span>. You are watching, and your keys are not sent.`}</span>
      <button type="button" class="btn sm" onClick=${() => takeOver(sess)}>Take over</button>
    </div>`}
    ${sess.status === 'dropped' && html`<div class="term-bar warn">
      <${Icon} name="wifi-off" size=${14} />
      <span class="grow"><b>The connection to ${m.name} dropped</b> ${ago(sess.droppedAt, now)} ago. The shell is still running there, and the output below is what arrived before the drop.</span>
      <button type="button" class="btn sm" onClick=${() => reconnect(sess)}><${Icon} name="refresh-cw" size=${13} /><span>Reconnect</span></button>
    </div>`}
    ${sess.status === 'reconnecting' && html`<div class="term-bar"><${Icon} name="loader-circle" size=${14} class="term-spin" /><span class="grow">Reconnecting to ${m.name}…</span></div>`}
    ${sess.status === 'offline' && html`<div class="term-bar error">
      <${Icon} name="server" size=${14} />
      <span class="grow"><b>${m.name} is offline.</b> It was last seen ${ago(m.lastSeen, now)} ago. This session opens again when the machine connects.</span>
      <a class="btn sm" href=${href('/machines')}>Open Machines</a>
    </div>`}

    <div ref=${screen} class=${cx('term-screen', sess.vim && 'alt', focused && live && 'focused', !live && !sess.watching && 'stale')} onClick=${focus}
      onScroll=${(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>
      <span ref=${probe} class="term-probe" aria-hidden="true">MMMMMMMMMM</span>
      <textarea ref=${input} class="term-input" aria-label=${'Terminal input for ' + sessionLabel(s, sess)} autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck=${false}
        readonly=${!live} onKeyDown=${onKeyDown} onInput=${onInput} onPaste=${onPaste} onFocus=${() => setFocused(true)} onBlur=${() => setFocused(false)}></textarea>
      ${sess.vim ? html`<${VimScreen} v=${sess.vim} rows=${dim.rows} focused=${focused} />` : html`<div class="term-lines" role="log" aria-live="off">
        ${sess.lines.map((l, i) => html`<${Line} key=${i} segs=${l} />`)}
        ${sess.status === 'open' && (sess.running
          ? html`<div class="tl">${!sess.watching && html`<span class="cur"> </span>`}${sess.watching && !sess.watching.done ? html`<span class="tc-m term-wait">▍</span>` : ' '}</div>`
          : html`<div class="tl">${promptLine(sess).map(([t, c]) => html`<span class=${c}>${t}</span>`)}${withCursor(sess.input, sess.pos, !sess.watching)}</div>`)}
      </div>`}
    </div>

    <div class="term-keys only-phone-keys" role="group" aria-label="Extra keys">
      ${KEYS.map(([label, key, name]) => html`<button type="button" key=${label} aria-label=${name || label} aria-pressed=${key === 'ctrl' ? ctrl : null} disabled=${!live}
        onPointerDown=${(e) => e.preventDefault()} onClick=${() => tapKey(key)}>${label}</button>`)}
    </div>
    <div class="term-status">
      <span class=${cx('term-state', sess.status !== 'open' && (sess.status === 'offline' ? 'error-text' : 'warn-text'))}><i class=${cx('dot', dotOf(sess))}></i>${stateWord}</span>
      <span class="term-cwd mono grow" title=${sess.cwd}>${sess.cwd}</span>
      <span class="mono not-phone"><${Icon} name="git-branch" size=${12} /> ${sess.branch}</span>
      <span class="not-phone">${project.shell || 'zsh'}</span>
      <span class="mono num">${dim.cols}×${dim.rows}</span>
    </div>
  </div>`;
}
