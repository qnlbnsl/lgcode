// Everything that changes the mock's state, and the small simulation that makes agents
// answer and move. Nothing here talks to a service.
import { store, update, notify, uid, remember, go, MIN } from './lib.js';
import {
  agentOf, projectOf, teamOf, threadOf, openRequests, agentLabel, byId, tasksOfSprint, teamName, HARNESSES,
} from './data.js';

const S = () => store.state;

// ---- notices and dialogs -----------------------------------------------------
export function toast(text, tone = 'ok') {
  const id = uid('toast');
  update((s) => { s.toasts.push({ id, text, tone }); });
  setTimeout(() => update((s) => { s.toasts = s.toasts.filter((t) => t.id !== id); }), 3600);
}
export function openDialog(dialog) { update((s) => { s.dialog = dialog; }); }
export function closeDialog() { update((s) => { s.dialog = null; }); }
// Asks before a destructive change. `onConfirm` runs only after the owner agrees.
export function confirm({ title, body, lost = [], action, danger = true, onConfirm }) {
  openDialog({ type: 'confirm', title, body, lost, action, danger, onConfirm });
}

// ---- preferences ---------------------------------------------------------------
export function setPref(key, value) { update((s) => { s.prefs[key] = value; }); remember(key, value); applyPrefs(); }
export function applyPrefs() {
  const { theme, density } = S().prefs;
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.density = density;
}
export function toggleExpanded(key, force) { update((s) => { s.expanded[key] = force ?? !s.expanded[key]; }); }

// ---- the side panel ------------------------------------------------------------
// The panel beside a project view shows the project lead. "Open thread" on a question
// swaps in the asking agent's thread, scrolled to the question, until it is answered.
export function openSidePanel(agentId, requestId = null) {
  update((s) => {
    s.ui.panelAgent = agentId; s.ui.panelReq = requestId;
    if (matchMedia('(max-width: 1180px)').matches) s.ui.panelDrawer = true; else s.prefs.panelOpen = true;
  });
}
export function closeSidePanel() { update((s) => { s.ui.panelAgent = null; s.ui.panelReq = null; }); }

// ---- threads -------------------------------------------------------------------
const CANNED = {
  'project-lead': [
    'Understood. I will pass that to the team leads and tell you when the plan changes.',
    'Noted. That changes one sprint. I will rewrite its goal and ask the team lead to re-plan it.',
    'I checked with the leads. Nothing is blocked by this, so work carries on.',
  ],
  'team-lead': [
    'Got it. I will re-assign the affected subitem and post the change to the team channel.',
    'That fits the plan as written. No re-plan needed.',
  ],
  default: [
    'Understood. I will apply that and commit when the tests pass.',
    'Done. The change is in my worktree and the tests still pass.',
  ],
};
function replyFor(a, text) {
  const t = text.toLowerCase();
  if (/status|progress|where are we|update/.test(t)) {
    const s = S();
    const open = openRequests(s, { project: a.project }).length;
    const working = s.agents.filter((x) => x.project === a.project && x.state === 'working').length;
    return `${working} agent${working === 1 ? ' is' : 's are'} working. ${open ? `${open} request${open === 1 ? '' : 's'} wait for you.` : 'Nothing waits for you.'}`;
  }
  if (/screen|design|mock|page|look/.test(t) && a.role === 'project-lead') {
    return 'Screens change, so the Design team will draw them first. Open the Mocks tab to watch them arrive, and ask me for changes while a screen is open.';
  }
  if (/hotfix/.test(t) && a.role === 'project-lead') return 'I can start a hotfix team for that. It gets one builder and one test runner, and it merges after a passing full run.';
  const list = CANNED[a.role] || CANNED.default;
  return list[Math.floor(Math.random() * list.length)];
}
export function setDraft(key, text) { S().drafts[key] = text; }
export function sendMessage(agentId, text, context = []) {
  text = text.trim();
  if (!text) return;
  const a = agentOf(S(), agentId);
  update((s) => {
    threadOf(s, agentId).push({ id: uid('m'), type: 'user', ts: Date.now(), text, context });
    s.drafts['thread:' + agentId] = '';
    s.pending[agentId] = true;
    if (a.state === 'idle') { a.state = 'working'; a.activity = 'Working on your message'; }
  });
  const timer = setTimeout(() => {
    update((s) => {
      if (!s.pending[agentId]) return;
      delete s.pending[agentId];
      threadOf(s, agentId).push({ id: uid('m'), type: 'agent', ts: Date.now(), text: replyFor(a, text) });
      if (a.activity === 'Working on your message') { a.state = 'idle'; a.activity = ''; }
      a.turns += 1; a.context = Math.min(96, a.context + 1);
    });
  }, 1600 + Math.random() * 900);
  S().pending[agentId] = timer;
}
// Stops the reply that is being written. The agent keeps running.
export function stopReply(agentId) {
  update((s) => {
    clearTimeout(s.pending[agentId]); delete s.pending[agentId];
    const a = agentOf(s, agentId);
    if (a.activity === 'Working on your message') { a.state = 'idle'; a.activity = ''; }
    threadOf(s, agentId).push({ id: uid('m'), type: 'note', ts: Date.now(), text: 'You stopped this reply.' });
  });
}
export function stopAgent(agentId) {
  const s = S(); const a = agentOf(s, agentId);
  const approvals = openRequests(s, { agent: agentId }).filter((r) => r.kind === 'approval');
  const doStop = () => update((st) => {
    const ag = agentOf(st, agentId);
    ag.prevState = ag.state; ag.prevActivity = ag.activity; ag.state = 'stopped'; ag.activity = 'Stopped by you';
    for (const r of approvals) { r.status = 'answered'; r.answer = 'Cancelled'; r.answeredAt = Date.now(); }
    clearTimeout(st.pending[agentId]); delete st.pending[agentId];
    threadOf(st, agentId).push({ id: uid('m'), type: 'note', ts: Date.now(), text: `You stopped ${ag.name}.${approvals.length ? ' Its approvals were cancelled. Its questions stay open.' : ''}` });
  });
  if (a.state === 'working' || approvals.length) {
    confirm({
      title: `Stop ${a.name}?`,
      body: 'The agent stops where it is. Resume continues from its last turn.',
      lost: [a.state === 'working' && a.activity ? `Running work: ${a.activity}` : null, approvals.length ? `${approvals.length} waiting approval${approvals.length === 1 ? '' : 's'} will be cancelled` : null].filter(Boolean),
      action: 'Stop agent', onConfirm: doStop,
    });
  } else doStop();
}
export function resumeAgent(agentId) {
  update((s) => {
    const a = agentOf(s, agentId);
    a.state = a.prevState && a.prevState !== 'stopped' ? a.prevState : 'idle';
    a.activity = a.state === 'working' ? (a.prevActivity || 'Picking up where it stopped') : '';
    a.failure = null;
    threadOf(s, agentId).push({ id: uid('m'), type: 'note', ts: Date.now(), text: `You resumed ${a.name}.` });
  });
}
export function setAgentConfig(agentId, patch) { update((s) => { Object.assign(agentOf(s, agentId), patch); }); }

// ---- requests ------------------------------------------------------------------
export function answerRequest(requestId, optionId, text) {
  const s = S(); const r = byId(s.requests, requestId); if (!r || r.status !== 'open') return;
  const a = agentOf(s, r.agent); const opt = (r.options || []).find((o) => o.id === optionId);
  let answer;
  if (r.kind === 'approval') answer = optionId === 'deny' ? 'Denied' : optionId === 'never' ? 'Denied, always' : optionId === 'always' ? 'Allowed, always' : 'Allowed';
  else if (r.kind === 'merge') answer = optionId === 'decline' ? 'Sent back' : 'Merged';
  else if (r.kind === 'failed') answer = 'Resumed';
  else answer = text ? text : (opt ? opt.label : 'Answered');
  update((st) => {
    r.status = 'answered'; r.answer = answer; r.answeredAt = Date.now();
    const task = r.task && byId(st.tasks, r.task);
    if (task && task.state === 'blocked') {
      task.state = 'active'; task.blockedBy = null;
      task.history.push({ ts: Date.now(), who: 'owner', text: r.kind === 'question' ? `You answered: ${answer}.` : `You ${answer.toLowerCase()} "${r.title}".` });
    }
    if (a.state !== 'stopped') {
      a.state = 'working'; a.failure = null;
      a.activity = r.kind === 'approval' ? (optionId === 'deny' ? 'Finding another way' : `Running ${r.command || r.title}`) : r.kind === 'merge' ? 'Writing the finished page' : 'Applying your answer';
    }
    if (optionId === 'always' || optionId === 'never') st.settings.standingRules = true;
    if (r.kind === 'merge' && optionId !== 'decline') { const p = projectOf(st, r.project); p.merged = true; for (const sp of st.sprints) if (sp.project === p.id) sp.column = 'Done'; }
    const lead = agentOf(st, projectOf(st, r.project).lead);
    const left = openRequests(st, { project: r.project }).length;
    if (lead && lead.id !== a.id) {
      threadOf(st, lead.id).push({ id: uid('m'), type: 'agent', ts: Date.now() + 1, text: `You ${r.kind === 'question' ? 'answered' : r.kind === 'failed' ? 'fixed' : answer.toLowerCase()} "${r.brief || r.title}". ${left ? `${left} request${left === 1 ? '' : 's'} still wait${left === 1 ? 's' : ''} for you.` : 'Nothing else waits for you on this project.'}` });
      if (!left && lead.state === 'waiting') { lead.state = 'working'; lead.activity = 'Checking in with the team leads'; }
    }
  });
  // The side panel goes back to the project lead once the question it opened for is answered.
  if (s.ui?.panelReq === requestId) setTimeout(() => { if (S().ui.panelReq === requestId) closeSidePanel(); }, 1200);
  toast({ approval: `${answer}: ${r.title}`, question: 'Answer sent', merge: answer === 'Merged' ? `Merged ${r.source} into ${r.target}` : 'Sent back to the project lead', failed: 'Agent resumed' }[r.kind]);
  // The agent reacts a moment later.
  setTimeout(() => update((st) => {
    const ag = agentOf(st, r.agent); if (ag.state === 'stopped') return;
    const lines = {
      approval: optionId === 'deny' ? 'Denied. I will look for a way that does not need that command.' : `Allowed. ${r.command ? 'The command ran and exited with 0.' : 'I have read it.'} Carrying on.`,
      question: `Thanks. Going with: ${answer}.`,
      merge: answer === 'Merged' ? `Merged into \`${r.target}\`. I am writing the finished page.` : 'Understood. I will ask what to change.',
      failed: 'Signed in and started. Reading the task now.',
    };
    threadOf(st, ag.id).push({ id: uid('m'), type: 'agent', ts: Date.now(), text: lines[r.kind] });
  }), 1400);
}
export function declinePhoneOffer() { update((s) => { s.phoneOffer = 'declined'; }); remember('phoneOffer', 'declined'); }

// ---- projects ------------------------------------------------------------------
export function slug(name) { return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'; }
// The name a project lead gives a project from its goal, in its first turn.
export function nameFromGoal(goal) {
  const stop = /^(make|build|add|create|write|fix|let|give|turn|draw|design|ship|start|please|i|we|want|need|to|a|an|the|me|us|for|of|in|on|at|and|or|with|so|that|it|its|our|my|from|into)$/i;
  const w = goal.replace(/[.!?].*$/s, '').replace(/[,:;()"]/g, ' ').trim().split(/\s+/).filter((x) => x && !stop.test(x));
  const name = w.slice(0, 4).join(' ');
  return name ? name[0].toUpperCase() + name.slice(1) : 'New project';
}
export function createProject({ repo, goal, machine, subscription, newRepo }) {
  const s = S();
  let repoId = repo;
  if (newRepo) {
    repoId = slug(newRepo);
    update((st) => { st.repos.push({ id: repoId, name: repoId, main: 'main', remote: null, folders: { [machine]: `${byId(st.machines, machine).workspace}/${repoId}` } }); });
  }
  const id = uid('p');
  const r = byId(S().repos, repoId);
  const leadId = id + '-lead';
  const sub = byId(s.subscriptions, subscription) || s.subscriptions[0];
  update((st) => {
    st.projects.push({ id, repo: repoId, name: 'Naming…', naming: true, prefix: 'PJ', goal, stage: 'Plan', phase: 'define', branch: '', folder: '', machine, lead: leadId, shell: 'zsh', createdAt: Date.now(), hasMocks: false, tests: 'on', agentReview: 'on', fresh: true });
    st.agents.push({ id: leadId, project: id, team: null, role: 'project-lead', name: 'Project lead', harness: sub.harness, subscription: sub.id, model: HARNESSES[sub.harness].models[1] || HARNESSES[sub.harness].models[0], effort: 'High', permission: 'Edit files without asking', state: 'working', activity: 'Reading the goal', task: null, context: 2, turns: 1, tokens: 0, workState: 'working', startedAt: Date.now() });
    st.threads[leadId] = [{ id: uid('m'), type: 'user', ts: Date.now(), text: goal }];
    st.pending[leadId] = true;
    st.expanded['repo:' + repoId] = true; st.expanded['project:' + id] = true;
  });
  go(`/p/${id}/chat`);
  // The lead's first turn: it names the project, then asks what it needs to plan.
  setTimeout(() => update((st) => {
    const p = projectOf(st, id); const lead = agentOf(st, leadId); if (!p) return;
    const name = nameFromGoal(goal); const sl = slug(name);
    Object.assign(p, { name, naming: false, prefix: name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'PJ', branch: 'feat/' + sl, folder: `${r.folders[machine]}/.worktrees/${sl}` });
    delete st.pending[leadId];
    lead.state = 'waiting'; lead.activity = 'Waiting for your answer';
    threadOf(st, leadId).push(
      { id: uid('m'), type: 'tools', ts: Date.now(), summary: 'Named the project · made its worktree', lines: [{ verb: 'Name', arg: name, res: '' }, { verb: 'Branch', arg: 'feat/' + sl, res: `from ${r.main}` }] },
      { id: uid('m'), type: 'agent', ts: Date.now(), text: `I named this project **${name}**.\n\nTwo questions before I plan. Who uses this? Does it change any screens? If it does, a Design team draws them first.` });
  }), 2600);
  return id;
}
export function archiveProject(pid, archived = true) {
  update((s) => {
    const p = projectOf(s, pid); p.archived = archived;
    if (archived) for (const a of s.agents) if (a.project === pid && a.state !== 'stopped') { a.prevState = a.state; a.state = 'stopped'; a.activity = 'Archived'; }
  });
  toast(archived ? 'Project archived' : 'Project restored');
}
// A lead that hears about screens starts a Design team and the Mocks tab appears.
export function startDesignTeam(pid) {
  update((s) => {
    const p = projectOf(s, pid); if (p.hasMocks) return;
    p.hasMocks = true; p.stage = 'Design';
    const tid = pid + '-design';
    s.teams.push({ id: tid, project: pid, stage: 'Design', area: null, branch: p.branch + '/design', needToKnow: false });
    const mk = (id, role, name) => ({ id, project: pid, team: tid, role, name, harness: 'claude', subscription: 'sub-max', model: 'Sonnet 5.5', effort: 'Medium', permission: 'Edit files without asking', state: 'working', activity: 'Drawing the first screen', task: null, context: 6, turns: 2, tokens: 0.1, workState: 'working', startedAt: Date.now() });
    s.agents.push(mk(pid + '-dl', 'team-lead', 'Design lead'), mk(pid + '-d1', 'designer', 'Designer'));
    s.channels.push({ id: 'ch-' + tid, project: pid, kind: 'team', team: tid, name: 'design', members: [pid + '-dl', pid + '-d1'] });
  });
}

// ---- the simulation ------------------------------------------------------------
const ACTIVITY = {
  builder: ['Reading the plan statement', 'Editing {file}', 'Running the unit tests', 'Editing {file}', 'Committing', 'Running pnpm typecheck'],
  'test-writer': ['Writing a failing test', 'Checking the test fails on its assertion', 'Writing stubs'],
  tester: ['Running check', 'Filling in the check report'],
  reviewer: ['Reading the diff', 'Tying a finding to statement {n}', 'Breaking the code on a temporary branch'],
  planner: ['Citing the code for statement {n}', 'Rewriting statement {n}', 'Checking citations'],
  designer: ['Drawing a screen', 'Recording a revision', 'Listing the fields a screen uses'],
  'team-lead': ['Reading a check report', 'Assigning the next subitem', 'Merging a builder into the team branch', 'Posting to the team channel'],
  'project-lead': ['Reading the leads channel', 'Comparing plans across teams', 'Checking in with the team leads'],
};
let ticking = null;
export function startSimulation() {
  if (ticking) return;
  ticking = setInterval(() => {
    const s = S(); if (!s || s.conn.status !== 'live' || document.hidden) return;
    const working = s.agents.filter((a) => a.state === 'working' && !a.stalled && !s.pending[a.id]);
    if (!working.length) return;
    const a = working[Math.floor(Math.random() * working.length)];
    const list = ACTIVITY[a.role] || ACTIVITY.builder;
    const task = a.task && s.tasks.find((t) => t.label === a.task && t.project === a.project);
    const file = task && task.files.length ? task.files[Math.floor(Math.random() * task.files.length)] : 'src/index.ts';
    a.activity = list[Math.floor(Math.random() * list.length)].replace('{file}', file).replace('{n}', 3 + Math.floor(Math.random() * 9));
    a.turns += 1; a.tokens = Math.round((a.tokens + 0.02) * 100) / 100;
    if (Math.random() < 0.5) a.context = Math.min(95, a.context + 1);
    s.conn.lastHeard = Date.now();
    notify();
  }, 4200);
}

// ---- preview states (the mock's own controls) ------------------------------------
export function setConnection(status) { update((s) => { s.conn.status = status; if (status === 'live') s.conn.lastHeard = Date.now(); }); }
export function setSession(status) { update((s) => { s.session.status = status; }); remember('session', status === 'in' ? 'in' : 'out'); }
export function resetMock() { try { for (const k of Object.keys(localStorage)) if (k.startsWith('lgcode-mock:')) localStorage.removeItem(k); } catch { /* storage is optional */ } location.hash = '#/home'; location.reload(); }
export { MIN, teamName, tasksOfSprint, agentLabel, teamOf };

// ---- Git messages ------------------------------------------------------------------
// The real product sends the staged diff, or the list of commits, to the cheap model the
// owner picked under Service settings. Its prompt asks for a short conventional commit and
// forbids attribution lines. The mock imitates the result from the file paths alone.
export const PR_TITLE_LIMIT = 72;
const typeOf = (paths) => (paths.every((p) => /(^|\/)(test|tests)\/|\.test\.|\.spec\./.test(p)) ? 'test'
  : paths.every((p) => /\.(md|mdx|txt)$/.test(p) || /^docs\//.test(p)) ? 'docs'
  : paths.every((p) => /\.(css|scss)$/.test(p)) ? 'style'
  : paths.some((p) => /fix|flaky/i.test(p)) ? 'fix' : 'feat');
const scopeOf = (paths) => {
  const dirs = paths.map((p) => p.split('/').slice(0, -1).filter((d) => !/^(src|packages|test|tests|lib|public)$/.test(d)).pop()).filter(Boolean);
  const n = {}; for (const d of dirs) n[d] = (n[d] || 0) + 1;
  const [top, c] = Object.entries(n).sort((a, b) => b[1] - a[1])[0] || [];
  return c > paths.length / 2 ? top : null;
};
const stemName = (p) => p.split('/').pop().replace(/\.(test|spec)\./, '.').replace(/\.[a-z]+$/, '');
export function commitMessage(paths) {
  if (!paths.length) return '';
  const type = typeOf(paths); const scope = scopeOf(paths);
  const seen = new Set(); const names = paths.map(stemName).filter((n) => !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
  const verb = { test: 'cover', docs: 'update', style: 'restyle', fix: 'fix', feat: 'update' }[type];
  const what = names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  return `${type}${scope ? `(${scope})` : ''}: ${verb} ${what}`.slice(0, PR_TITLE_LIMIT);
}
export function pullRequestText(subjects, evidence) {
  const lead = subjects.find((x) => !/^merge /i.test(x)) || subjects[0] || 'Changes';
  const scope = /^\w+(\([^)]*\))?:/.test(lead) ? '' : 'feat: ';
  let title = (scope + lead[0].toLowerCase() + lead.slice(1)).replace(/\.$/, '');
  if (title.length > PR_TITLE_LIMIT) title = title.slice(0, PR_TITLE_LIMIT - 1).replace(/\s+\S*$/, '') + '…';
  const body = ['## Summary', '', ...subjects.slice(0, 8).map((x) => `- ${x}`), ...(subjects.length > 8 ? [`- and ${subjects.length - 8} more commits`] : []),
    '', '## Evidence', '', `- ${evidence.tests.text}`, `- ${evidence.review.text}`].join('\n');
  return { title, body };
}
