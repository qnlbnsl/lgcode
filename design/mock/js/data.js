// The mock's sample data and the functions that read it.
// The data is plain objects. It is a design aid, not a contract for the engine.
// Agents have no personal names: an agent is known by its role and its team.
import { MIN, HOUR, DAY, persist, FRAMED } from './lib.js';

const T = Date.now();
const at = (msAgo) => T - msAgo;

// ---- vocabulary ------------------------------------------------------------
export const STAGES = ['Design', 'Plan', 'Build', 'Review', 'Hand over'];
export const PHASES = [
  { id: 'define', n: 1, name: 'Define', stage: null, what: 'Say what to change. Mockups are made if screens change, and the end-result page is written.' },
  { id: 'design', n: 2, name: 'Design and teams', stage: 'Design', what: 'The code is read, the work is split by domain, and sprints and teams are set.' },
  { id: 'plan', n: 3, name: 'Plan', stage: 'Plan', what: 'Each team writes its plan. Reviewers score it in rounds until it holds.' },
  { id: 'build', n: 4, name: 'Build', stage: 'Build', what: 'Tests come first and must fail. Builders write the code. A merge needs a passing report.' },
  { id: 'verify', n: 5, name: 'Verify', stage: 'Build', what: 'Install, smoke test, full suite and user flows. A failure sends a fix team to Build.' },
  { id: 'review', n: 6, name: 'Review', stage: 'Review', what: 'The change is reviewed against the end-result page, attacked, and scored.' },
  { id: 'handover', n: 7, name: 'Hand over', stage: 'Hand over', what: 'The work is merged. You try the product and approve what users would notice.' },
  { id: 'running', n: 8, name: 'Keep running', stage: null, what: 'A nightly full run. Failures are explained, and you get a one-line summary.' },
];
export const COLUMNS = ['Backlog', 'Planned', 'In progress', 'Review', 'Done'];
export const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'];
export const ROLES = {
  'project-lead': { label: 'Project lead', icon: 'crown' },
  'team-lead': { label: 'Team lead', icon: 'flag' },
  builder: { label: 'Builder', icon: 'hammer' },
  reviewer: { label: 'Reviewer', icon: 'eye' },
  tester: { label: 'Test runner', icon: 'test-tube-diagonal' },
  'test-writer': { label: 'Test writer', icon: 'list-checks' },
  designer: { label: 'Designer', icon: 'pencil-ruler' },
  planner: { label: 'Planner', icon: 'route' },
};
export const TASK_STATES = { queue: 'Queued', active: 'Active', review: 'In review', blocked: 'Blocked', done: 'Done' };
export const KIND_LABEL = { question: 'Question', approval: 'Approval', merge: 'Merge', failed: 'Failed start' };
export const HARNESSES = {
  claude: { name: 'Claude Code', models: ['Fable 5.2', 'Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5'], efforts: ['Low', 'Medium', 'High', 'Max'], noEffort: ['Haiku 5.5'], runMode: 'ACP' },
  codex: { name: 'Codex', models: ['GPT-6.1 Sol', 'GPT-6 Luna'], efforts: ['Low', 'Medium', 'High'], noEffort: [], runMode: 'ACP' },
};
export const PERMISSION_MODES = ['Read only', 'Ask before every change', 'Edit files without asking', 'Full access'];

// ---- seed ------------------------------------------------------------------
function agent(id, project, team, role, name, o = {}) {
  return {
    id, project, team, role, name,
    harness: 'claude', subscription: 'sub-max', model: 'Sonnet 5.5', effort: 'Medium', permission: 'Edit files without asking',
    state: 'working', activity: '', task: null, context: 30, turns: 40, tokens: 1.2, workState: 'working', stalled: false,
    startedAt: at(3 * HOUR), ...o,
  };
}

export function seed() {
  const machines = [
    { id: 'studio', name: 'Studio', role: 'master', status: 'online', here: true, slots: { used: 11, limit: 16 }, lastSeen: T, address: '127.0.0.1:8787', workspace: '~/projects', os: 'Linux' },
    { id: 'buildbox', name: 'Buildbox', role: 'worker', status: 'online', slots: { used: 3, limit: 8 }, lastSeen: at(20_000), address: '192.168.141.18', workspace: '~/Work', connectedFor: 2 * DAY + 4 * HOUR, os: 'Linux' },
    { id: 'laptop', name: 'Laptop', role: 'worker', status: 'offline', slots: { used: 0, limit: 4 }, lastSeen: at(2 * HOUR + 12 * MIN), address: '192.168.141.40', workspace: '~/code', os: 'Linux' },
  ];
  const subscriptions = [
    { id: 'sub-max', harness: 'claude', name: 'Max', machine: 'studio', enabled: true, signedIn: true, useForNew: true, usage: { pct: 41, resetsAt: T + 3 * DAY }, weekly: 41 },
    { id: 'sub-team', harness: 'claude', name: 'Team', machine: 'buildbox', enabled: true, signedIn: true, useForNew: true, usage: { pct: 92, resetsAt: T + 5 * HOUR }, weekly: 92 },
    { id: 'sub-codex', harness: 'codex', name: 'Pro', machine: 'studio', enabled: true, signedIn: true, useForNew: true, usage: { pct: 18, resetsAt: T + 6 * DAY }, weekly: 18 },
    { id: 'sub-codex-work', harness: 'codex', name: 'Work', machine: 'buildbox', enabled: true, signedIn: false, useForNew: false, usage: null },
  ];
  const repos = [
    { id: 'lgcode', name: 'lgcode', main: 'master', remote: 'github.com/qnlbnsl/lgcode', folders: { studio: '~/projects/lgcode', buildbox: '~/Work/lgcode' }, design: true,
      description: 'LGcode runs teams of coding agents for one owner. A project lead plans the work, team leads split it, and builders, reviewers and test runners carry it out. The owner answers questions and approvals from a web page, and soon from a phone.', describedAt: at(2 * HOUR), describedBy: 'console-lead' },
    { id: 'atlas-docs', name: 'atlas-docs', main: 'main', remote: 'github.com/acme/atlas-docs', folders: { studio: '~/projects/atlas-docs' },
      description: 'The public documentation site for the Atlas API. The reference is generated from openapi.yaml at build time.', describedAt: at(DAY), describedBy: 'apiref-lead' },
    { id: 'billing-api', name: 'billing-api', main: 'main', remote: 'github.com/acme/billing-api', folders: { buildbox: '~/Work/billing-api', studio: '~/projects/billing-api' },
      description: 'The billing service. It issues invoices, voids them, and exports them for accounting.', describedAt: at(2 * DAY), describedBy: 'exports-lead' },
  ];
  const projects = [
    { id: 'console', repo: 'lgcode', name: 'Agent console', prefix: 'AC', goal: 'A workspace where I steer a project through its lead and see what every team is doing.', stage: 'Build', phase: 'build', branch: 'feat/agent-console', folder: '~/projects/lgcode/.worktrees/agent-console', machine: 'studio', lead: 'console-lead', shell: 'zsh', createdAt: at(4 * DAY), hasMocks: true, tests: 'on', agentReview: 'on' },
    { id: 'rules', repo: 'lgcode', name: 'Standing permission rules', prefix: 'PR', goal: 'Let me say "always allow running the tests" once, and stop asking after that.', stage: 'Plan', phase: 'plan', branch: 'feat/standing-rules', folder: '~/projects/lgcode/.worktrees/standing-rules', machine: 'studio', lead: 'rules-lead', shell: 'zsh', createdAt: at(1 * DAY + 3 * HOUR), hasMocks: false, tests: 'on', agentReview: 'on' },
    { id: 'phone', repo: 'lgcode', name: 'Phone companion', prefix: 'PC', goal: 'Answer questions and approvals from my phone without opening the laptop.', stage: 'Design', phase: 'define', branch: 'feat/phone-companion', folder: '~/projects/lgcode/.worktrees/phone-companion', machine: 'studio', lead: 'phone-lead', shell: 'zsh', createdAt: at(5 * HOUR), hasMocks: true, tests: 'on', agentReview: 'on' },
    { id: 'apiref', repo: 'atlas-docs', name: 'API reference', prefix: 'AR', goal: 'Generate the reference from the OpenAPI file and drop the hand-written pages.', stage: 'Hand over', phase: 'handover', branch: 'docs/api-reference', folder: '~/projects/atlas-docs/.worktrees/api-reference', machine: 'studio', lead: 'apiref-lead', shell: 'zsh', createdAt: at(6 * DAY), hasMocks: false, tests: 'on', agentReview: 'on' },
    { id: 'exports', repo: 'billing-api', name: 'Invoice exports', prefix: 'IE', goal: 'Export a month of invoices as CSV and as PDF, including voided ones.', stage: 'Build', phase: 'build', branch: 'feat/invoice-exports', folder: '~/Work/billing-api/.worktrees/invoice-exports', machine: 'buildbox', lead: 'exports-lead', shell: 'bash', createdAt: at(2 * DAY), hasMocks: false, tests: 'on', agentReview: 'off' },
    { id: 'docsrefresh', repo: 'atlas-docs', name: 'Docs refresh', prefix: 'DR', goal: 'Rewrite the getting-started guide.', stage: 'Hand over', phase: 'running', branch: 'docs/refresh', folder: '~/projects/atlas-docs/.worktrees/docs-refresh', machine: 'studio', lead: 'docsrefresh-lead', shell: 'zsh', createdAt: at(21 * DAY), archived: true, hasMocks: false, tests: 'on', agentReview: 'on' },
  ];
  const teams = [
    { id: 'console-shell', project: 'console', stage: 'Build', area: 'Shell', branch: 'feat/agent-console/shell', needToKnow: false },
    { id: 'console-threads', project: 'console', stage: 'Build', area: 'Threads', branch: 'feat/agent-console/threads', needToKnow: true },
    { id: 'console-review', project: 'console', stage: 'Review', area: null, branch: 'feat/agent-console/review', needToKnow: false },
    { id: 'rules-plan', project: 'rules', stage: 'Plan', area: null, branch: 'feat/standing-rules/plan', needToKnow: false },
    { id: 'phone-design', project: 'phone', stage: 'Design', area: null, branch: 'feat/phone-companion/design', needToKnow: false },
    { id: 'apiref-review', project: 'apiref', stage: 'Review', area: null, branch: 'docs/api-reference/review', needToKnow: false },
    { id: 'exports-build', project: 'exports', stage: 'Build', area: null, branch: 'feat/invoice-exports/build', needToKnow: false },
  ];
  const agents = [
    agent('console-lead', 'console', null, 'project-lead', 'Project lead', { model: 'Opus 5.5', effort: 'High', state: 'waiting', activity: 'Waiting on 3 requests', context: 34, turns: 212, tokens: 9.4, workState: 'waiting', startedAt: at(4 * DAY) }),
    agent('shell-lead', 'console', 'console-shell', 'team-lead', 'Build lead', { model: 'Opus 5.5', effort: 'Medium', state: 'waiting', activity: 'Waiting for your answer', task: 'AC-17', context: 61, turns: 148, tokens: 6.1, workState: 'waiting' }),
    agent('shell-b1', 'console', 'console-shell', 'builder', 'Builder 1', { state: 'working', activity: 'Editing packages/web/src/shell/Sidebar.tsx', task: 'AC-14', context: 48, turns: 63, tokens: 2.2 }),
    agent('shell-b2', 'console', 'console-shell', 'builder', 'Builder 2', { state: 'waiting', activity: 'Waiting for approval · Run the web tests', task: 'AC-15', context: 52, turns: 71, tokens: 2.6, workState: 'waiting' }),
    agent('shell-test', 'console', 'console-shell', 'tester', 'Test runner', { model: 'Haiku 5.5', effort: 'Low', state: 'idle', activity: '', context: 12, turns: 18, tokens: 0.3, workState: 'assigned' }),
    agent('threads-lead', 'console', 'console-threads', 'team-lead', 'Build lead', { harness: 'codex', subscription: 'sub-codex', model: 'GPT-6.1 Sol', effort: 'High', state: 'working', activity: 'Merging Builder 1 into the team branch', context: 44, turns: 96, tokens: 4.0 }),
    agent('threads-b1', 'console', 'console-threads', 'builder', 'Builder 1', { harness: 'codex', subscription: 'sub-codex', model: 'GPT-6.1 Sol', effort: 'Medium', state: 'working', activity: 'Running pnpm typecheck', task: 'AC-18', context: 71, turns: 88, tokens: 3.3, stalled: true }),
    agent('threads-tw', 'console', 'console-threads', 'test-writer', 'Test writer', { harness: 'codex', subscription: 'sub-codex', model: 'GPT-6 Luna', effort: 'Medium', state: 'working', activity: 'Writing thread-scroll.test.ts', task: 'AC-19', context: 27, turns: 34, tokens: 0.9 }),
    agent('review-lead', 'console', 'console-review', 'team-lead', 'Review lead', { model: 'Opus 5.5', effort: 'High', state: 'working', activity: 'Scoring round 2 findings', context: 39, turns: 57, tokens: 2.8 }),
    agent('review-r1', 'console', 'console-review', 'reviewer', 'Reviewer', { harness: 'codex', subscription: 'sub-codex', model: 'GPT-6.1 Sol', effort: 'High', state: 'waiting', activity: 'Waiting for approval · Read the review trace', task: 'AC-16', context: 58, turns: 41, tokens: 1.9, workState: 'waiting' }),

    agent('rules-lead', 'rules', null, 'project-lead', 'Project lead', { model: 'Opus 5.5', effort: 'High', state: 'waiting', activity: 'Waiting on 1 request', context: 22, turns: 64, tokens: 2.4, workState: 'waiting', startedAt: at(DAY) }),
    agent('plan-lead', 'rules', 'rules-plan', 'team-lead', 'Planning lead', { model: 'Opus 5.5', effort: 'High', state: 'waiting', activity: 'Waiting for your answer', context: 47, turns: 52, tokens: 2.2, workState: 'waiting' }),
    agent('plan-p1', 'rules', 'rules-plan', 'planner', 'Planner 1', { state: 'working', activity: 'Rewriting statement 7 with citations', task: 'PR-3', context: 36, turns: 29, tokens: 1.1 }),
    agent('plan-p2', 'rules', 'rules-plan', 'planner', 'Planner 2', { state: 'idle', activity: '', context: 31, turns: 26, tokens: 0.9, workState: 'done' }),
    agent('plan-r1', 'rules', 'rules-plan', 'reviewer', 'Reviewer', { harness: 'codex', subscription: 'sub-codex', model: 'GPT-6.1 Sol', effort: 'High', state: 'idle', activity: '', context: 40, turns: 33, tokens: 1.5, workState: 'done' }),

    agent('phone-lead', 'phone', null, 'project-lead', 'Project lead', { model: 'Opus 5.5', effort: 'High', state: 'idle', activity: '', context: 9, turns: 14, tokens: 0.4, workState: 'off', startedAt: at(5 * HOUR) }),
    agent('design-lead', 'phone', 'phone-design', 'team-lead', 'Design lead', { state: 'idle', activity: '', context: 18, turns: 22, tokens: 0.7, workState: 'done' }),
    agent('design-d1', 'phone', 'phone-design', 'designer', 'Designer', { state: 'idle', activity: '', context: 33, turns: 37, tokens: 1.3, workState: 'done' }),

    agent('apiref-lead', 'apiref', null, 'project-lead', 'Project lead', { model: 'Opus 5.5', effort: 'High', state: 'waiting', activity: 'Waiting for your merge', context: 55, turns: 301, tokens: 12.7, workState: 'waiting', startedAt: at(6 * DAY) }),
    agent('apiref-rl', 'apiref', 'apiref-review', 'team-lead', 'Review lead', { state: 'idle', activity: '', context: 42, turns: 80, tokens: 3.1, workState: 'done' }),
    agent('apiref-r1', 'apiref', 'apiref-review', 'reviewer', 'Reviewer', { harness: 'codex', subscription: 'sub-codex', model: 'GPT-6.1 Sol', state: 'idle', activity: '', context: 51, turns: 66, tokens: 2.5, workState: 'done' }),

    agent('exports-lead', 'exports', null, 'project-lead', 'Project lead', { subscription: 'sub-team', model: 'Opus 5.5', effort: 'High', state: 'working', activity: 'Reading the round 1 check reports', context: 28, turns: 77, tokens: 3.0, startedAt: at(2 * DAY) }),
    agent('exports-bl', 'exports', 'exports-build', 'team-lead', 'Build lead', { subscription: 'sub-team', state: 'working', activity: 'Assigning IE-6 to Builder 1', context: 37, turns: 59, tokens: 2.1 }),
    agent('exports-b1', 'exports', 'exports-build', 'builder', 'Builder 1', { subscription: 'sub-team', state: 'working', activity: 'Editing src/exports/csv.ts', task: 'IE-4', context: 64, turns: 92, tokens: 3.6 }),
    agent('exports-b2', 'exports', 'exports-build', 'builder', 'Builder 2', { harness: 'codex', subscription: 'sub-codex-work', model: 'GPT-6.1 Sol', state: 'failed', activity: 'Not signed in to Codex on Buildbox', task: 'IE-5', context: 0, turns: 0, tokens: 0, workState: 'off', failure: { reason: 'Not signed in to Codex on Buildbox', fix: 'signin', machine: 'buildbox', subscription: 'sub-codex-work' } }),
    agent('exports-test', 'exports', 'exports-build', 'tester', 'Test runner', { subscription: 'sub-team', model: 'Haiku 5.5', effort: 'Low', state: 'stopped', activity: 'Stopped by you', context: 8, turns: 11, tokens: 0.2, workState: 'off' }),
    agent('docsrefresh-lead', 'docsrefresh', null, 'project-lead', 'Project lead', { state: 'stopped', activity: 'Archived', context: 0, workState: 'off' }),
  ];

  const sprints = [
    { id: 'sp1', epic: 'ac-nav', priority: 'High', start: -4, end: -2, project: 'console', label: 'SP-01', name: 'Navigation foundation', goal: 'Move between repositories, projects, teams and agents without losing your place.', phase: 'Hand over', column: 'Done', team: 'console-shell', dependsOn: [], evidence: { tests: '412 passed', review: 'Clean after round 2', merged: 'Merged into feat/agent-console' } },
    { id: 'sp2', epic: 'ac-threads', priority: 'High', start: -1.5, end: 1, project: 'console', label: 'SP-02', name: 'Thread view', goal: 'Keep long replies readable, keep the draft, and open at the latest message.', phase: 'Build', column: 'In progress', team: 'console-threads', dependsOn: ['sp1'] },
    { id: 'sp3', epic: 'ac-nav', priority: 'Urgent', start: -1, end: 1.5, project: 'console', label: 'SP-03', name: 'Sidebar and attention', goal: 'Show what needs you from anywhere, and fold the sidebar to a rail.', phase: 'Build', column: 'In progress', team: 'console-shell', dependsOn: ['sp1'] },
    { id: 'sp4', epic: 'ac-threads', priority: 'Medium', start: -0.5, end: 1, project: 'console', label: 'SP-04', name: 'Narrow-screen pass', goal: 'Verify keyboard navigation and the phone layout at 390 pixels.', phase: 'Review', column: 'Review', team: 'console-review', dependsOn: ['sp1'] },
    { id: 'sp5', epic: 'ac-board', priority: 'Medium', start: 1.5, end: 3.5, project: 'console', label: 'SP-05', name: 'Project board', goal: 'Turn the project plan into sprints with owners, evidence and blockers.', phase: 'Plan', column: 'Planned', team: null, dependsOn: ['sp2', 'sp3'] },
    { id: 'sp6', epic: 'ac-board', priority: 'Medium', start: 3.5, end: 5.5, project: 'console', label: 'SP-06', name: 'Git and merge review', goal: 'Stage, commit and integrate team worktrees. Open a review to the base branch.', phase: 'Plan', column: 'Planned', team: null, dependsOn: ['sp5'] },
    { id: 'fx1', epic: 'ac-nav', priority: 'Urgent', start: -0.1, end: 0.3, project: 'console', label: 'FX-01', name: 'Fix the flaky reconnect test', goal: 'The starting commit failed its full run. Fix it before SP-03 builds on it.', phase: 'Build', column: 'In progress', team: 'console-shell', dependsOn: [], fix: true, auto: true },
    { id: 'rp1', epic: 'pr-rules', priority: 'High', start: -1, end: 1, project: 'rules', label: 'SP-01', name: 'Rule storage and matching', goal: 'Store a rule the owner approved once, and match later requests against it.', phase: 'Plan', column: 'In progress', team: 'rules-plan', dependsOn: [] },
    { id: 'rp2', epic: 'pr-rules', priority: 'Medium', start: 1, end: 2.5, project: 'rules', label: 'SP-02', name: 'Rules page', goal: 'List, pause and remove standing rules.', phase: 'Plan', column: 'Planned', team: null, dependsOn: ['rp1'] },
    { id: 'ar1', epic: 'ar-ref', priority: 'High', start: -6, end: -3, project: 'apiref', label: 'SP-01', name: 'Generate the reference', goal: 'Build every endpoint page from openapi.yaml.', phase: 'Hand over', column: 'Done', team: 'apiref-review', dependsOn: [], evidence: { tests: '96 passed', review: 'Clean after round 3', merged: 'Merged into docs/api-reference' } },
    { id: 'ar2', epic: 'ar-ref', priority: 'High', start: -3, end: -0.2, project: 'apiref', label: 'SP-02', name: 'Remove hand-written pages', goal: 'Delete the old pages and redirect their addresses.', phase: 'Hand over', column: 'Review', team: 'apiref-review', dependsOn: ['ar1'], evidence: { tests: '104 passed', review: 'Clean after round 2' } },
    { id: 'sp7', epic: 'ac-board', priority: 'Low', start: 5.5, end: 7.5, project: 'console', label: 'SP-07', name: 'Phone layout pass', goal: 'Every project tab works at 390 pixels.', phase: 'Plan', column: 'Backlog', team: null, dependsOn: ['sp4'],
      plan: { file: '.lgcode/plans/SP-07.html', src: 'plans/website-replacement.html', state: 'In review · round 2', by: 'Planner 1' } },
    { id: 'sp8', epic: 'ac-threads', priority: 'Low', start: 6, end: 7, project: 'console', label: 'SP-08', name: 'Search inside a thread', goal: 'Find a word in a long thread.', phase: 'Plan', column: 'Backlog', team: null, dependsOn: [] },
    { id: 'rp3', epic: 'pr-rules', priority: 'Low', start: 2.5, end: 3.5, project: 'rules', label: 'SP-03', name: 'Rule usage counts', goal: 'Show how often each rule allowed a request.', phase: 'Plan', column: 'Backlog', team: null, dependsOn: ['rp2'] },
    { id: 'ie1', epic: 'ie-exports', priority: 'High', start: -2, end: 1, project: 'exports', label: 'SP-01', name: 'CSV export', goal: 'A month of invoices as one CSV file.', phase: 'Build', column: 'In progress', team: 'exports-build', dependsOn: [] },
    { id: 'ie2', epic: 'ie-exports', priority: 'Medium', start: 1, end: 3, project: 'exports', label: 'SP-02', name: 'PDF export', goal: 'The same month as one PDF, one invoice per page.', phase: 'Plan', column: 'Planned', team: 'exports-build', dependsOn: ['ie1'] },
  ];

  // A project is one goal with one or more epics under it. Each sprint belongs to one epic.
  const epics = [
    { id: 'ac-nav', project: 'console', name: 'Navigation and attention' },
    { id: 'ac-threads', project: 'console', name: 'Threads' },
    { id: 'ac-board', project: 'console', name: 'Board and Git' },
    { id: 'pr-rules', project: 'rules', name: 'Standing rules' },
    { id: 'ar-ref', project: 'apiref', name: 'Generated reference' },
    { id: 'ie-exports', project: 'exports', name: 'Monthly exports' },
  ];

  const tk = (id, project, label, title, sprint, team, owner, state, o = {}) => ({ id, project, label, title, sprint, team, owner, state, points: 3, files: [], history: [], ...o });
  const tasks = [
    tk('t11', 'console', 'AC-11', 'Repository tree with independent disclosure', 'sp1', 'console-shell', 'shell-b1', 'done', { points: 5 }),
    tk('t12', 'console', 'AC-12', 'Quick switcher on Control K', 'sp1', 'console-shell', 'shell-b2', 'done'),
    tk('t13', 'console', 'AC-13', 'Keep drafts and scroll position per thread', 'sp1', 'console-shell', 'shell-b1', 'done'),
    tk('t14', 'console', 'AC-14', 'Fold the sidebar into a 48 pixel rail', 'sp3', 'console-shell', 'shell-b1', 'active', { points: 3, files: ['packages/web/src/shell/Sidebar.tsx', 'packages/web/src/shell/Rail.tsx', 'packages/web/src/styles.css'], history: [{ ts: at(52 * MIN), who: 'shell-lead', text: 'Assigned to Builder 1.' }, { ts: at(49 * MIN), who: 'shell-test', text: 'Tests written. 6 fail on their assertion, as they should.' }, { ts: at(31 * MIN), who: 'shell-b1', text: 'Rail renders. Keyboard shortcut still missing.' }] }),
    tk('t15', 'console', 'AC-15', 'Attention counts in the sidebar add up to the bell', 'sp3', 'console-shell', 'shell-b2', 'blocked', { points: 5, blockedBy: 'approval', files: ['packages/web/src/watchSituation.ts', 'packages/web/src/shell/Bell.tsx'], history: [{ ts: at(40 * MIN), who: 'shell-lead', text: 'Assigned to Builder 2.' }, { ts: at(12 * MIN), who: 'shell-b2', text: 'Code written and committed as 4be2d65.' }, { ts: at(6 * MIN), who: 'shell-b2', text: 'Asked to run the web tests.' }] }),
    tk('t17', 'console', 'AC-17', 'Open an agent thread from the board', 'sp3', 'console-shell', 'shell-lead', 'blocked', { points: 2, blockedBy: 'question', history: [{ ts: at(18 * MIN), who: 'shell-lead', text: 'Needs a decision from the owner before it can be assigned.' }] }),
    tk('t20', 'console', 'AC-20', 'Only projects needing you filter', 'sp3', 'console-shell', null, 'queue', { points: 2 }),
    tk('t18', 'console', 'AC-18', 'Thread opens at the latest message', 'sp2', 'console-threads', 'threads-b1', 'active', { points: 3, files: ['packages/web/src/thread/Thread.tsx', 'packages/web/src/thread/useReadingPosition.ts'], history: [{ ts: at(70 * MIN), who: 'threads-lead', text: 'Assigned to Builder 1.' }, { ts: at(24 * MIN), who: 'threads-b1', text: 'Typecheck has run for 14 minutes without output.' }] }),
    tk('t19', 'console', 'AC-19', 'Tests for scroll position and the Latest button', 'sp2', 'console-threads', 'threads-tw', 'active', { points: 2, files: ['packages/web/test/thread-scroll.test.ts'] }),
    tk('t21', 'console', 'AC-21', 'Group tool calls under one disclosure', 'sp2', 'console-threads', 'threads-b1', 'review', { points: 3, files: ['packages/web/src/thread/ToolGroup.tsx'] }),
    tk('t22', 'console', 'AC-22', 'Large items load on request', 'sp2', 'console-threads', null, 'queue', { points: 3 }),
    tk('t16', 'console', 'AC-16', 'Review keyboard order at 390 pixels', 'sp4', 'console-review', 'review-r1', 'blocked', { points: 2, blockedBy: 'approval', history: [{ ts: at(9 * MIN), who: 'review-r1', text: 'Needs to read the review trace.' }] }),
    tk('t23', 'console', 'AC-23', 'Score round 2 findings', 'sp4', 'console-review', 'review-lead', 'active', { points: 1 }),
    tk('t24', 'console', 'AC-24', 'Reconnect test waits for the socket to close', 'fx1', 'console-shell', 'shell-test', 'review', { points: 1, files: ['packages/client/test/reconnect.test.ts'] }),
    // SP-07 is still in Plan. Its tasks come from the plan, so each one names the part of the plan it carries out.
    tk('t25', 'console', 'AC-25', 'Top bar holds menu, place and bell at 390 pixels', 'sp7', null, null, 'queue', { points: 2, section: 'what-changed-since-the-earlier-note-and-checklist', sectionName: 'What changed: Phone layout' }),
    tk('t26', 'console', 'AC-26', 'The board becomes one ordered list on a phone', 'sp7', null, null, 'queue', { points: 5, section: 'what-changed-since-the-earlier-note-and-checklist', sectionName: 'What changed: Phone layout' }),
    tk('t27', 'console', 'AC-27', 'Tables lead their second line with status', 'sp7', null, null, 'queue', { points: 3, section: 'what-changed-since-the-earlier-note-and-checklist', sectionName: 'What changed: Phone layout' }),
    tk('t28', 'console', 'AC-28', 'Git keeps a phone gutter and one pane at a time', 'sp7', null, null, 'queue', { points: 3, section: 'build-units-and-dependencies', sectionName: 'Build units: W09' }),
    tk('t29', 'console', 'AC-29', 'Phone cases for the service pages and Mocks', 'sp7', null, null, 'queue', { points: 2, section: 'build-units-and-dependencies', sectionName: 'Build units: W10' }),
    tk('t30', 'console', 'AC-30', 'Browser checks at 390, 768, 1440 and 2560 pixels', 'sp7', null, null, 'queue', { points: 3, section: 'the-owner-approved-simpler-implementation-2026-11-09', sectionName: 'Simpler implementation: item 5' }),
    tk('t31', 'console', 'AC-31', 'Record the phone evidence for the step gate', 'sp7', null, null, 'queue', { points: 1, section: 'stage-gates-and-evidence', sectionName: 'Stage gates and evidence' }),
    tk('r1', 'rules', 'PR-1', 'Plan: rule record and its fields', 'rp1', 'rules-plan', 'plan-p2', 'done'),
    tk('r2', 'rules', 'PR-2', 'Plan: matching a request against rules', 'rp1', 'rules-plan', 'plan-p1', 'review'),
    tk('r3', 'rules', 'PR-3', 'Rewrite statement 7 after round 3', 'rp1', 'rules-plan', 'plan-p1', 'active'),
    tk('a1', 'apiref', 'AR-8', 'Redirect old page addresses', 'ar2', 'apiref-review', 'apiref-r1', 'done'),
    tk('a2', 'apiref', 'AR-9', 'Final review of the generated pages', 'ar2', 'apiref-review', 'apiref-rl', 'done'),
    tk('e4', 'exports', 'IE-4', 'CSV writer with voided invoices', 'ie1', 'exports-build', 'exports-b1', 'active', { points: 5, files: ['src/exports/csv.ts', 'src/exports/query.ts'] }),
    tk('e5', 'exports', 'IE-5', 'Month boundaries in the account time zone', 'ie1', 'exports-build', 'exports-b2', 'blocked', { points: 3, blockedBy: 'failed' }),
    tk('e6', 'exports', 'IE-6', 'Streaming download endpoint', 'ie1', 'exports-build', null, 'queue', { points: 3 }),
  ];

  const requests = [
    { id: 'q-failed', kind: 'failed', agent: 'exports-b2', project: 'exports', task: 'e5', title: 'Not signed in to Codex on Buildbox', body: 'Builder 2 could not start. The Codex subscription named Work has no sign-in on Buildbox.', createdAt: at(41 * MIN), status: 'open', blocks: 'IE-5' },
    { id: 'q-merge', kind: 'merge', agent: 'apiref-lead', project: 'apiref', title: 'Merge docs/api-reference into main', body: 'Both sprints are done. Users will notice this change, because the old page addresses now redirect.', createdAt: at(1 * HOUR + 25 * MIN), status: 'open', source: 'docs/api-reference', target: 'main', evidence: { tests: { ok: true, text: 'Full run passed · 104 tests · commit 9c1e7aa' }, review: { ok: true, text: 'Review clean after round 2', agent: 'apiref-rl' }, commits: 14, files: 37 } },
    { id: 'q-stuck', kind: 'question', agent: 'plan-lead', project: 'rules', task: 'r3', title: 'Statement 7 is stuck after round 3. Keep, change or drop it?', body: 'Statement 7 says "A rule matches by exact command text." It drew a major finding in each of three rounds, for 14 of the round\'s 31 points. Reviewers say exact text will miss `pnpm test` with a different filter.', recommendation: 'Change it to match by command and leading arguments.', options: [{ id: 'change', label: 'Change it', primary: true }, { id: 'keep', label: 'Keep it', note: 'It stays as written. Reviewers stop scoring it, and the gap stays open.' }, { id: 'drop', label: 'Drop it', note: 'It leaves the end-result page and the plan.' }], createdAt: at(34 * MIN), status: 'open', blocks: 'PR-3', why: 'Round 4 does not start until this is settled.',
      brief: 'Keep, change or drop statement 7?', summary: 'Reviewers raised a major finding on it in each of three rounds.', recShort: 'Change it to match by command and leading arguments.',
      what: ['Statement 7 of the end-result page says "A rule matches by exact command text." It drew a major finding in each of the three review rounds, and 14 of round 3\'s 31 points [1].', 'The Planning lead can change the statement, keep it as written, or drop it from the page.'],
      whyText: ['Reviewers say exact text will miss `pnpm test` run with a different filter, so a standing rule would keep asking you the same question.', 'Round 4 does not start until this is settled. Sprint PR-3 waits on it.'],
      recWhy: 'Matching the command and its leading arguments covers the filter case and still refuses a different command.', refs: ['.lgcode/end-result.md'] },
    { id: 'q-open', kind: 'question', agent: 'shell-lead', project: 'console', task: 't17', title: 'Where should an agent\'s thread open?', body: 'Should an agent\'s thread open in the main view, keeping the team easy to return to?', recommendation: 'Use the main view. A separate panel would squeeze the reading column, especially on a phone.', options: [{ id: 'main', label: 'Use the main view', primary: true }, { id: 'panel', label: 'Open it in the side panel', note: 'The board stays in view, and the thread gets about 400 pixels of width.' }], createdAt: at(18 * MIN), status: 'open', blocks: 'AC-17', files: ['packages/web/src/thread/Thread.tsx'],
      brief: 'Where should an agent\'s thread open?', summary: 'A builder\'s thread can take the main view or open in the side panel.', recShort: 'Use the main view.',
      what: ['When you click an agent in the sidebar, its thread opens. The Build lead needs to know where: in the main view, in place of the board, or in the side panel beside it [1].'],
      whyText: ['The choice sets the width of the reading column. The side panel is about 400 pixels wide, which squeezes long messages. On a phone the panel covers the whole screen anyway.', 'Sprint AC-17 waits on this answer.'],
      recWhy: 'The thread gets the full reading width, and the sidebar keeps the team one click away.', refs: ['packages/web/src/thread/Thread.tsx'] },
    { id: 'q-tests', kind: 'approval', agent: 'shell-b2', project: 'console', task: 't15', title: 'Run the web tests', command: 'pnpm --filter @lgcode/web test', folder: '~/projects/lgcode/.worktrees/agent-console-shell', tool: 'Bash', createdAt: at(6 * MIN), status: 'open', blocks: 'AC-15', options: [{ id: 'allow', label: 'Allow', primary: true }, { id: 'always', label: 'Always allow', note: 'Runs this exact command again without asking, in this project only.' }, { id: 'deny', label: 'Deny' }],
      summary: 'Builder 2 wants to check its thread layout change before it commits.', what: ['Builder 2 changed the thread layout for sprint AC-15 [1]. It runs the web tests to check the change before it commits.'], whyText: ['The command only reads the code and runs the tests in the shell team\'s worktree. It does not push or change files outside that folder.'], refs: ['packages/web/src/thread/Thread.tsx'] },
    { id: 'q-trace', kind: 'approval', agent: 'review-r1', project: 'console', task: 't16', title: 'Read the review trace', command: null, folder: '~/projects/lgcode/.worktrees/agent-console-review', tool: 'Read', blind: true, createdAt: at(2 * MIN), status: 'open', blocks: 'AC-16', options: [{ id: 'allow', label: 'Allow without seeing input' }, { id: 'deny', label: 'Deny' }],
      summary: 'The Reviewer wants to read the trace of the last review round.', what: ['The Reviewer reads the trace of review round 2 to score sprint AC-16.'], whyText: ['The harness hides this tool\'s input, so you cannot see which file it opens. It is a read, and the folder is the review team\'s worktree.'] },
    { id: 'q-old1', kind: 'approval', agent: 'shell-b1', project: 'console', title: 'Install the test browser', command: 'pnpm exec playwright install chromium', folder: '~/projects/lgcode/.worktrees/agent-console-shell', tool: 'Bash', createdAt: at(3 * HOUR), status: 'answered', answer: 'Allowed', answeredAt: at(3 * HOUR - 2 * MIN) },
    { id: 'q-old2', kind: 'question', agent: 'console-lead', project: 'console', title: 'Should the board show sprints or tasks?', body: 'A board of sprints is shorter. A board of tasks shows more.', createdAt: at(2 * DAY), status: 'answered', answer: 'Sprints', answeredAt: at(2 * DAY - 9 * MIN) },
    { id: 'q-old3', kind: 'approval', agent: 'exports-b1', project: 'exports', title: 'Drop the scratch database', command: 'dropdb billing_scratch', folder: '~/Work/billing-api', tool: 'Bash', createdAt: at(5 * HOUR), status: 'answered', answer: 'Denied', answeredAt: at(5 * HOUR - 1 * MIN) },
  ];

  const threads = {
    'console-lead': [
      { id: 'm1', type: 'user', ts: at(4 * DAY), text: 'Build a workspace where I can steer a project through its lead and see what the teams are doing.' },
      { id: 'm2', type: 'agent', ts: at(4 * DAY - 6 * MIN), text: 'I read the repository. The web page has a thread view and a requests list, and no project model yet.\n\nI split the work into six sprints. Navigation comes first, because every other sprint links into it. Two build teams can work side by side after that: one on the shell, one on threads.' },
      { id: 'm3', type: 'tools', ts: at(4 * DAY - 6 * MIN), summary: 'Read 14 files · searched 3 times', lines: [{ verb: 'Read', arg: 'packages/web/src/app.tsx', res: '212 lines' }, { verb: 'Read', arg: 'packages/web/src/routes.ts', res: '88 lines' }, { verb: 'Search', arg: '"thread" in packages/web/src', res: '41 matches' }, { verb: 'Read', arg: 'docs/specs/2026-11-06-website-and-engine-design.md', res: '447 lines' }] },
      { id: 'm4', type: 'user', ts: at(26 * HOUR), text: 'Good. Start the shell and threads teams. Keep the review team small.' },
      { id: 'm5', type: 'agent', ts: at(26 * HOUR - 3 * MIN), text: 'Started **Build team · Shell** and **Build team · Threads**, with one reviewer in the Review team.\n\n[[sprint:sp1|SP-01 Navigation foundation]] is merged. Its full run passed with 412 tests.' },
      { id: 'm6', type: 'agent', ts: at(50 * MIN), text: 'The starting commit for [[sprint:sp3|SP-03]] failed its full run: the reconnect test is flaky. I added [[sprint:fx1|FX-01]] ahead of it. Users would not notice this fix, so it merges on its own after a passing full run.' },
      { id: 'm7', type: 'tools', ts: at(50 * MIN), summary: 'Ran the full suite · 1 failed of 7,804', lines: [{ verb: 'Run', arg: 'pnpm check', res: '6 min 12 s' }, { verb: 'Read', arg: 'test-results/reconnect.test.ts.log', res: '64 lines' }] },
      { id: 'm8', type: 'agent', ts: at(17 * MIN), text: 'Three things need you before the shell team can finish:\n\n- The Build lead for Shell has a question about where threads open.\n- Builder 2 wants to run the web tests.\n- The Reviewer wants to read the review trace.', requests: ['q-open', 'q-tests', 'q-trace'] },
    ],
    'shell-lead': [
      { id: 'm1', type: 'user', ts: at(3 * HOUR), from: 'console-lead', text: 'Your team owns SP-03. Fold the sidebar, make the attention counts honest, and open agent threads from the board.' },
      { id: 'm2', type: 'agent', ts: at(3 * HOUR - 4 * MIN), text: 'Plan read. I split SP-03 into four subitems, 12 points in total. Builder 1 takes the rail, and Builder 2 takes the attention counts.' },
      { id: 'm3', type: 'tools', ts: at(40 * MIN), summary: 'Assigned 2 subitems · wrote 2 builder configs', lines: [{ verb: 'Assign', arg: 'AC-14 → Builder 1', res: '3 points' }, { verb: 'Assign', arg: 'AC-15 → Builder 2', res: '5 points' }] },
      { id: 'm4', type: 'agent', ts: at(18 * MIN), text: 'Builder 1 has the rail rendering. One navigation choice is yours before I assign [[task:t17|AC-17]].' },
      { id: 'm5', type: 'request', ts: at(18 * MIN), requestId: 'q-open' },
    ],
    'shell-b1': [
      { id: 'm1', type: 'user', ts: at(52 * MIN), from: 'shell-lead', text: 'AC-14: fold the sidebar into a 48 pixel rail. The tests are written and fail on their assertions.' },
      { id: 'm2', type: 'agent', ts: at(50 * MIN), text: 'Reading the sidebar and the six failing tests.' },
      { id: 'm3', type: 'tools', ts: at(44 * MIN), summary: 'Read 3 files · edited 2 · +64 −11', lines: [{ verb: 'Read', arg: 'packages/web/src/shell/Sidebar.tsx', res: '188 lines' }, { verb: 'Edit', arg: 'packages/web/src/shell/Rail.tsx', res: '+52 −0' }, { verb: 'Edit', arg: 'packages/web/src/styles.css', res: '+12 −11' }] },
      { id: 'm4', type: 'agent', ts: at(31 * MIN), text: 'The rail renders, and 4 of the 6 tests pass. The keyboard shortcut is next.' },
    ],
    'shell-b2': [
      { id: 'm1', type: 'user', ts: at(40 * MIN), from: 'shell-lead', text: 'AC-15: the sidebar, the bell and Home must count the same open requests. A request held by a lead does not count for the owner.' },
      { id: 'm2', type: 'agent', ts: at(38 * MIN), text: 'Reading how the page counts requests today.' },
      { id: 'm3', type: 'tools', ts: at(30 * MIN), summary: 'Edited 2 files · +48 −19', lines: [{ verb: 'Read', arg: 'packages/web/src/watchSituation.ts', res: '131 lines' }, { verb: 'Edit', arg: 'packages/web/src/watchSituation.ts', res: '+31 −12' }, { verb: 'Edit', arg: 'packages/web/src/shell/Bell.tsx', res: '+17 −7' }, { verb: 'Commit', arg: '4be2d65 Count open requests once', res: '' }] },
      { id: 'm4', type: 'agent', ts: at(7 * MIN), text: 'The three places now read one count. I need to run the web tests to prove it.' },
      { id: 'm5', type: 'request', ts: at(6 * MIN), requestId: 'q-tests' },
    ],
    'review-r1': [
      { id: 'm1', type: 'user', ts: at(30 * MIN), from: 'review-lead', text: 'AC-16: check keyboard order at 390 pixels against the end-result page, statements 11 to 14.' },
      { id: 'm2', type: 'agent', ts: at(12 * MIN), text: 'Statements 11 and 12 hold. For 13 and 14 I need the trace from the last review round.' },
      { id: 'm3', type: 'large', ts: at(10 * MIN), title: 'Review trace', size: '192 kilobytes', lines: 2140 },
      { id: 'm4', type: 'request', ts: at(2 * MIN), requestId: 'q-trace' },
    ],
    'plan-lead': [
      { id: 'm1', type: 'agent', ts: at(2 * HOUR), text: 'Round 3 is scored. 31 points: 2 blockers, 3 majors and 4 minors. Statement 7 took 12 of them.' },
      { id: 'm2', type: 'request', ts: at(34 * MIN), requestId: 'q-stuck' },
    ],
    'rules-lead': [
      { id: 'm1', type: 'user', ts: at(27 * HOUR), text: 'I want to say "always allow running the tests" once and not be asked again.' },
      { id: 'm2', type: 'agent', ts: at(27 * HOUR - 5 * MIN), text: 'Understood. No screens change, so this project starts in Plan.\n\nI wrote the end-result page with 12 numbered statements. The Planning team is on round 3 of its plan review.' },
      { id: 'm3', type: 'agent', ts: at(33 * MIN), text: 'One statement is stuck. The Planning lead needs you to keep, change or drop it.', requests: ['q-stuck'] },
    ],
    'phone-lead': [
      { id: 'm1', type: 'user', ts: at(5 * HOUR), text: 'I want to answer questions and approvals from my phone. Show me what the screens could look like.' },
      { id: 'm2', type: 'agent', ts: at(5 * HOUR - 2 * MIN), text: 'Screens change, so I started a **Design team**. The mocks are built from this repository\'s own components.\n\nThree screens are ready in the Mocks tab: the request list, one request, and the notification settings. Ask me for changes while a screen is open.' },
    ],
    'apiref-lead': [
      { id: 'm1', type: 'agent', ts: at(1 * HOUR + 30 * MIN), text: 'Both sprints are done and reviewed. The full run passed on commit `9c1e7aa`.\n\nUsers will notice this change, so the merge into `main` is yours.' },
      { id: 'm2', type: 'request', ts: at(1 * HOUR + 25 * MIN), requestId: 'q-merge' },
    ],
    'exports-b2': [
      { id: 'm1', type: 'request', ts: at(41 * MIN), requestId: 'q-failed' },
    ],
    'exports-lead': [
      { id: 'm1', type: 'user', ts: at(2 * DAY), text: 'Export a month of invoices as CSV and PDF. Voided invoices are included.' },
      { id: 'm2', type: 'agent', ts: at(2 * DAY - 4 * MIN), text: 'Two sprints: CSV first, then PDF on the same query. Tests are on. Agent review is off, as you set for this repository.' },
      { id: 'm3', type: 'agent', ts: at(40 * MIN), text: 'Builder 2 could not start on Buildbox. Its Codex subscription is signed out there. Builder 1 carries on with [[task:e4|IE-4]].', requests: ['q-failed'] },
    ],
  };

  // The message board: channels per team, a leads channel per project, and direct messages.
  const channels = [
    { id: 'ch-console-leads', project: 'console', kind: 'leads', name: 'leads', members: ['console-lead', 'shell-lead', 'threads-lead', 'review-lead'] },
    { id: 'ch-console-shell', project: 'console', kind: 'team', team: 'console-shell', name: 'build-shell', members: ['shell-lead', 'shell-b1', 'shell-b2', 'shell-test'] },
    { id: 'ch-console-threads', project: 'console', kind: 'team', team: 'console-threads', name: 'build-threads', members: ['threads-lead', 'threads-b1', 'threads-tw'] },
    { id: 'ch-console-review', project: 'console', kind: 'team', team: 'console-review', name: 'review', members: ['review-lead', 'review-r1'] },
    { id: 'dm-shell-threads', project: 'console', kind: 'dm', name: null, members: ['shell-lead', 'threads-lead'] },
    { id: 'ch-rules-plan', project: 'rules', kind: 'team', team: 'rules-plan', name: 'planning', members: ['plan-lead', 'plan-p1', 'plan-p2', 'plan-r1'] },
    { id: 'ch-phone-design', project: 'phone', kind: 'team', team: 'phone-design', name: 'design', members: ['design-lead', 'design-d1'] },
    { id: 'ch-apiref-review', project: 'apiref', kind: 'team', team: 'apiref-review', name: 'review', members: ['apiref-rl', 'apiref-r1'] },
    { id: 'ch-exports-build', project: 'exports', kind: 'team', team: 'exports-build', name: 'build', members: ['exports-bl', 'exports-b1', 'exports-b2', 'exports-test'] },
  ];
  const post = (id, channel, from, kind, action, text, msAgo, o = {}) => ({ id, channel, from, kind, action, text, ts: at(msAgo), to: [], replyTo: null, closed: false, ...o });
  const posts = [
    post('p1', 'ch-console-leads', 'console-lead', 'decision', 'fyi', 'FX-01 runs ahead of SP-03. It merges on its own after a passing full run.', 50 * MIN),
    post('p2', 'ch-console-leads', 'threads-lead', 'handoff', 'needs-reply', 'Threads needs the route helper from Shell before AC-22 can start. Who owns `routes.ts`?', 44 * MIN, { to: ['shell-lead'] }),
    post('p3', 'ch-console-leads', 'shell-lead', 'note', 'fyi', 'Shell owns `routes.ts`. Builder 1 exports `threadHref` in commit 5e12347.', 41 * MIN, { replyTo: 'p2' }),
    post('p4', 'ch-console-leads', 'review-lead', 'blocked', 'needs-reply', 'Review of SP-04 is blocked until the Reviewer may read the trace. The owner has the approval.', 9 * MIN, { to: ['console-lead'] }),
    post('p5', 'ch-console-shell', 'shell-lead', 'handoff', 'needs-reply', 'Builder 1: AC-14, the rail. Builder 2: AC-15, the attention counts. Tests are written and fail on their assertions.', 40 * MIN, { to: ['shell-b1', 'shell-b2'] }),
    post('p6', 'ch-console-shell', 'shell-b1', 'note', 'fyi', 'Rail renders at 48 pixels. Shortcut next.', 31 * MIN),
    post('p7', 'ch-console-shell', 'shell-b2', 'done', 'fyi', 'AC-15 committed as 4be2d65. Waiting for the owner to allow the web tests.', 12 * MIN, { replyTo: 'p5' }),
    post('p8', 'ch-console-shell', 'shell-test', 'done', 'fyi', 'AC-24 check passed: reconnect test, 40 runs, 0 failures.', 8 * MIN),
    post('p9', 'ch-console-shell', 'shell-lead', 'question', 'needs-reply', 'Is the rail width a token or a literal?', 5 * MIN, { to: ['shell-b1'] }),
    post('p10', 'ch-console-threads', 'threads-lead', 'handoff', 'needs-reply', 'Builder 1: AC-18. Test writer: AC-19 first, the tests must fail before code is written.', 70 * MIN, { to: ['threads-b1', 'threads-tw'] }),
    post('p11', 'ch-console-threads', 'threads-tw', 'done', 'fyi', 'AC-19: 9 tests written, all fail on their assertion.', 46 * MIN, { replyTo: 'p10' }),
    post('p12', 'ch-console-threads', 'threads-b1', 'blocked', 'needs-reply', 'Typecheck has not printed for 14 minutes. I may be stuck.', 10 * MIN, { to: ['threads-lead'] }),
    post('p13', 'ch-console-review', 'review-lead', 'handoff', 'needs-reply', 'Reviewer: AC-16, statements 11 to 14 at 390 pixels.', 30 * MIN, { to: ['review-r1'] }),
    post('p14', 'ch-console-review', 'review-r1', 'blocked', 'needs-reply', 'Statements 13 and 14 need the last trace. Waiting for the owner.', 9 * MIN, { to: ['review-lead'], replyTo: 'p13' }),
    post('p15', 'dm-shell-threads', 'threads-lead', 'question', 'needs-reply', 'Can your Builder 1 export `threadHref` today?', 43 * MIN, { to: ['shell-lead'] }),
    post('p16', 'dm-shell-threads', 'shell-lead', 'note', 'fyi', 'Yes. It is in 5e12347.', 41 * MIN, { replyTo: 'p15' }),
    post('p20', 'ch-rules-plan', 'plan-lead', 'note', 'fyi', 'Round 3 scored: 31 points. Statement 7 is stuck and went to the owner.', 34 * MIN),
    post('p21', 'ch-rules-plan', 'plan-p1', 'note', 'fyi', 'Drafting two versions of statement 7 so either answer can land fast.', 20 * MIN),
    post('p30', 'ch-exports-build', 'exports-bl', 'blocked', 'needs-reply', 'Builder 2 failed to start: Codex is signed out on Buildbox. IE-5 waits.', 41 * MIN, { to: ['exports-lead'] }),
    post('p31', 'ch-exports-build', 'exports-b1', 'note', 'fyi', 'CSV writer handles voided invoices. Query next.', 15 * MIN),
    post('p40', 'ch-phone-design', 'design-d1', 'done', 'fyi', 'Three screens recorded: Requests, Request, Notification settings.', 4 * HOUR),
    post('p50', 'ch-apiref-review', 'apiref-rl', 'done', 'fyi', 'Round 2 clean. No blockers, no majors.', 2 * HOUR),
  ];

  return {
    session: { status: (FRAMED && new URLSearchParams(location.hash.split('?')[1] || '').get('session')) || persist('session', 'in'), firstRun: false },
    conn: { status: 'live', lastHeard: T },
    prefs: {
      theme: persist('theme', 'system'), density: persist('density', 'compact'),
      sidebarFolded: persist('sidebarFolded', false), sidebarWidth: persist('sidebarWidth', 264),
      panelWidth: persist('panelWidth', 420), panelOpen: persist('panelOpen', true), onlyNeedingYou: false,
    },
    owner: { name: 'Kunal Bansal', initials: 'KB' },
    machines, subscriptions, repos, projects, teams, agents, epics, sprints, tasks, requests, threads, channels, posts,
    drafts: {}, pending: {}, expanded: { 'repo:lgcode': true, 'project:console': true, 'team:console-shell': true },
    inspecting: { console: 'feat/agent-console/shell' }, toasts: [], dialog: null, phoneOffer: persist('phoneOffer', 'open'),
    settings: {
      ntfyServer: '', ntfyTopic: '', ntfyToken: '',
      webEnabled: true, port: 8787, checkIn: 15, proxyMode: false, publicAddress: '',
      sheepdog: true, standingRules: false, capacityBackoff: 5, crashRetries: 1, teamIdle: 60,
      removeCredits: false, gitModel: 'Haiku 5.5',
    },
    T,
  };
}

// ---- reads -----------------------------------------------------------------
export const byId = (list, id) => list.find((x) => x.id === id);
export const repoOf = (s, p) => byId(s.repos, p.repo);
export const projectOf = (s, id) => byId(s.projects, id);
export const agentOf = (s, id) => byId(s.agents, id);
export const teamOf = (s, id) => byId(s.teams, id);
export const teamName = (t) => (t ? `${t.stage === 'Plan' ? 'Planning' : t.stage} team${t.area ? ' · ' + t.area : ''}` : '');
export const teamsOf = (s, pid) => s.teams.filter((t) => t.project === pid);
export const agentsOfTeam = (s, tid) => s.agents.filter((a) => a.team === tid);
export const agentsOfProject = (s, pid) => s.agents.filter((a) => a.project === pid);
export const leadOf = (s, p) => agentOf(s, p.lead);
// Whether a model takes an effort setting.
export const hasEffort = (harness, model) => !(HARNESSES[harness]?.noEffort || []).includes(model);
export const harnessOfModel = (m) => Object.keys(HARNESSES).find((h) => HARNESSES[h].models.includes(m));
// The kinds of work a project assigns to a harness, a model and an effort.
export const WORK_KINDS = ['Plan', 'Build', 'Review', 'Test'];
// The table the project lead proposes, from the harnesses the owner has signed in to.
export function proposeAssignment(s) {
  const on = new Set(s.subscriptions.filter((x) => x.signedIn && x.enabled).map((x) => x.harness));
  const c = on.has('claude'), x = on.has('codex');
  const pick = (h, m, e) => ({ harness: h, model: m, effort: hasEffort(h, m) ? e : null });
  const fallback = c ? 'claude' : x ? 'codex' : 'claude';
  const best = (prefer) => (prefer === 'codex' && x) ? 'codex' : (prefer === 'claude' && c) ? 'claude' : fallback;
  const M = { claude: { top: 'Fable 5.2', mid: 'Opus 5.5', low: 'Sonnet 5.5' }, codex: { top: 'GPT-6.1 Sol', mid: 'GPT-6.1 Sol', low: 'GPT-6 Luna' } };
  return {
    Plan: pick(best('claude'), M[best('claude')].top, 'High'),
    Build: pick(best('codex'), M[best('codex')].mid, 'Medium'),
    Review: pick(best('claude'), M[best('claude')].mid, 'High'),
    Test: pick(best('codex'), M[best('codex')].low, 'Medium'),
  };
}
export const sprintsOf = (s, pid) => s.sprints.filter((x) => x.project === pid);
export const epicsOf = (s, pid) => s.epics.filter((x) => x.project === pid);
export const tasksOfSprint = (s, sid) => s.tasks.filter((t) => t.sprint === sid);
export const tasksOfTeam = (s, tid) => s.tasks.filter((t) => t.team === tid);
export const machineOf = (s, id) => byId(s.machines, id);
export const subOf = (s, id) => byId(s.subscriptions, id);
export const subLabel = (s, id) => { const x = subOf(s, id); return x ? `${HARNESSES[x.harness].name} · ${x.name}` : 'No subscription'; };

// What an agent is called in a sentence, with its team when that helps.
export function agentLabel(s, a, { withTeam = false } = {}) {
  if (!a) return 'Unknown agent';
  if (!withTeam || !a.team) return a.name;
  const t = teamOf(s, a.team);
  return a.role === 'team-lead' && t.area ? `${a.name} · ${t.area}` : `${a.name}${t.area ? ' · ' + t.area : ''}`;
}
export const roleIcon = (a) => (a.role === 'team-lead' ? 'flag' : (ROLES[a.role] || ROLES.builder).icon);
export const roleLabel = (a) => (ROLES[a.role] || ROLES.builder).label;

// Order used by Home and the bell: failed starts first, then the longest wait.
export const byAttention = (a, b) => (a.kind === 'failed' ? 0 : 1) - (b.kind === 'failed' ? 0 : 1) || a.createdAt - b.createdAt;
export function openRequests(s, filter = {}) {
  return s.requests.filter((r) => r.status === 'open' && !r.heldBy
    && !(projectOf(s, r.project) || {}).archived
    && (!filter.project || r.project === filter.project)
    && (!filter.agent || r.agent === filter.agent)
    && (!filter.team || (agentOf(s, r.agent) || {}).team === filter.team)
    && (!filter.kind || r.kind === filter.kind)).sort(byAttention);
}
export const requestsOfTask = (s, tid) => s.requests.filter((r) => r.task === tid && r.status === 'open');
export const requestsOfSprint = (s, sid) => { const ids = new Set(tasksOfSprint(s, sid).map((t) => t.id)); return s.requests.filter((r) => r.status === 'open' && ids.has(r.task)); };

// The dot and the short words for an agent, from its state and its open requests.
export function agentStatus(s, a) {
  const open = openRequests(s, { agent: a.id });
  const need = open[0];
  const needWord = need ? { question: 'Needs answer', approval: 'Needs approval', merge: 'Needs merge', failed: 'Failed start' }[need.kind] : null;
  if (a.state === 'failed') return { dot: 'failed', word: 'Failed start', tone: 'error' };
  if (a.state === 'stopped') return need ? { dot: 'stopped waiting', word: 'Stopped · ' + needWord, tone: 'warn' } : { dot: 'stopped', word: 'Stopped', tone: null };
  if (need) return { dot: 'waiting', word: needWord, tone: 'warn' };
  if (a.role === 'project-lead' || a.role === 'team-lead') {
    const scope = a.role === 'project-lead' ? openRequests(s, { project: a.project }) : openRequests(s, { team: a.team });
    if (scope.length) return { dot: 'waiting', word: `Waiting on ${scope.length} request${scope.length === 1 ? '' : 's'}`, tone: 'warn' };
  }
  if (a.state === 'working') return { dot: 'working pulse', word: a.stalled ? 'May be stuck' : 'Working', tone: a.stalled ? 'warn' : null };
  if (a.state === 'starting') return { dot: 'starting', word: 'Starting', tone: null };
  if (a.state === 'paused') return { dot: 'paused', word: 'Paused', tone: null };
  return { dot: 'idle', word: 'Idle', tone: null };
}
export function projectStatus(s, p) {
  if (p.archived) return { word: 'Archived', tone: null };
  const n = openRequests(s, { project: p.id }).length;
  if (n) return { word: `Needs you · ${n}`, tone: 'warn', n };
  const working = agentsOfProject(s, p.id).some((a) => a.state === 'working');
  if (!working) return { word: 'Idle', tone: null };
  return { word: { Design: 'Designing', Plan: 'Planning', Build: 'Building', Review: 'Reviewing', 'Hand over': 'Handing over' }[p.stage], tone: 'ok' };
}
export function sprintProgress(s, sp) {
  const ts = tasksOfSprint(s, sp.id);
  return { total: ts.length, done: ts.filter((t) => t.state === 'done').length, active: ts.filter((t) => t.state === 'active' || t.state === 'review').length };
}
export const threadOf = (s, aid) => s.threads[aid] || (s.threads[aid] = []);
export const routeForAgent = (s, a) => `/p/${a.project}/chat/${a.id}`;
export const routeForRequest = (s, r) => `/p/${r.project}/chat/${r.agent}?req=${r.id}`;
export const taskByLabel = (s, pid, label) => s.tasks.find((t) => t.project === pid && t.label === label);
