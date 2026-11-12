// The Workflow tab: where a project is in the default build loop, its review rounds,
// its test runs, its end-result page, and the settings of the loop.
import { html, useState, Icon, cx, href, go, ago, clock, dayLabel, useNow, plural, update, uid, MIN, HOUR, DAY } from '../lib.js';
import { PHASES, byId, agentOf, agentsOfTeam, sprintsOf, openRequests, teamsOf, teamName, leadOf, repoOf, routeForAgent, routeForRequest, KIND_LABEL, agentLabel } from '../data.js';
import * as act from '../actions.js';
import { Avatar, Empty } from '../ui.js';

const POINTS = { minor: 1, major: 3, blocker: 9 };
const SEV_LABEL = { minor: 'Minor', major: 'Major', blocker: 'Blocker' };
const fmt = (n) => n.toLocaleString('en-US');
const when = (ts, now) => (dayLabel(ts, now) === 'Today' ? clock(ts) : dayLabel(ts, now) + ', ' + clock(ts));

// ---- sample records --------------------------------------------------------------
const fnd = (statement, sev, text, status = 'fixed') => ({ statement, sev, text, status });
function review(id, subject, kind, team, state, next, rounds) {
  let n = 0;
  return { id, subject, kind, team, state, next, rounds: rounds.map((r, i) => ({ n: i + 1, ts: r.ts, findings: r.findings.map((f) => ({ ...f, id: 'F-' + String(++n).padStart(2, '0') })) })) };
}
const roundPoints = (r) => r.findings.reduce((sum, f) => sum + POINTS[f.sev], 0);
const roundCount = (r, sev) => r.findings.filter((f) => f.sev === sev).length;
const run = (kind, why, commit, branch, msAgo, dur, passed, failed, skipped, o = {}) => ({ id: uid('run'), kind, why, commit, branch, dur, passed, failed, skipped, failures: [], ...o, msAgo });
const st = (text, state = 'open', note) => ({ text, state, note });

function blank(p) {
  return {
    reviews: [], runs: [], fixes: [], stuck: null,
    result: { statements: [], open: [], pr: null },
    settings: { fullRun: 'pnpm check', check: 'pnpm test --related', maxRounds: 6, stuckPoints: 12, autoMergeFix: true, nightly: true },
  };
}
// A project made while the page is open gets an empty record.
function ensure(s, p) { s.workflow = s.workflow || {}; return s.workflow[p.id] || (s.workflow[p.id] = blank(p)); }

export function seedWorkflow(state) {
  const T = state.T; const at = (ms) => T - ms;
  const stamp = (w) => { for (const r of w.runs) { r.ts = at(r.msAgo); } return w; };
  state.workflow = {};
  const add = (pid, fill) => { const w = blank(byId(state.projects, pid)); fill(w); state.workflow[pid] = stamp(w); };

  add('console', (w) => {
    w.reviews = [review('rv-sp4', 'SP-04 Narrow-screen pass', 'Code review', 'console-review', 'scoring',
      'Round 3 runs next. After round 3, another round runs only while a blocker or a major is open.', [
        { ts: at(5 * HOUR), findings: [
          fnd(11, 'blocker', 'Tab order skips the composer at 390 pixels.'),
          fnd(12, 'major', 'The focus ring is clipped by the drawer edge.'),
          fnd(13, 'major', 'The bottom key row covers the last line of the terminal.'),
          fnd(14, 'major', 'The drawer opens behind the lead panel.'),
          fnd(11, 'minor', 'The skip link lands on the sidebar, not on the view.'),
          fnd(12, 'minor', 'The focus ring uses a literal colour.'),
          fnd(13, 'minor', 'The Ctrl key has no pressed state.'),
          fnd(14, 'minor', 'The drawer has no label for screen readers.')] },
        { ts: at(35 * MIN), findings: [
          fnd(11, 'major', 'Escape does not return focus to the menu button.', 'open'),
          fnd(11, 'minor', 'Focus leaves the drawer on Tab.', 'open'),
          fnd(13, 'minor', 'Ctrl stays latched after Escape.', 'open'),
          fnd(14, 'minor', 'Service pages come before agents in the drawer.', 'open')] },
      ])];
    w.runs = [
      run('Check', 'AC-24 · Reconnect test waits for the socket to close', 'a41c0d2', 'feat/agent-console/shell', 8 * MIN, '48 s', 40, 0, 0, { by: 'shell-test', note: 'The reconnect test ran 40 times in a row.' }),
      run('Check', 'AC-19 · Tests for scroll position and the Latest button', '7d20f1c', 'feat/agent-console/threads', 46 * MIN, '21 s', 0, 9, 0, { by: 'threads-tw', expected: true, note: 'Written before the code. All 9 fail on their assertion, as they should.' }),
      run('Full run', 'Starting commit for SP-03', '55e1bbd', 'feat/agent-console', 50 * MIN, '6 min 12 s', 7791, 1, 12, { by: 'shell-test', failures: [
        { name: 'reconnects after the socket closes', file: 'packages/client/test/reconnect.test.ts:88', message: 'Expected status "live" within 2000 ms, received "reconnecting".', note: 'Flaky: it failed 3 of 40 runs. FX-01 fixes it.' }] }),
      run('Full run', 'Merge of SP-01 Navigation foundation', '5e12347', 'feat/agent-console', 26 * HOUR, '6 min 3 s', 7792, 0, 12, { by: 'shell-test' }),
      run('Full run', 'Starting commit of the project', '79cd51d', 'master', 4 * DAY - HOUR, '5 min 48 s', 7380, 0, 12, { by: 'shell-test' }),
    ];
    w.fixes = [
      { sprint: 'fx1', why: 'The starting commit for SP-03 failed its full run.', auto: true, state: 'Check passed. A full run comes next.' },
      { label: 'FX-02', name: 'Reconnect banner says Offline too early', why: 'The banner text changes, and users would notice that.', auto: false, state: 'Waits behind FX-01.' },
    ];
    w.result.statements = [
      st('The sidebar lists repositories, their projects, teams and agents as one tree.', 'holds'),
      st('Each level of the tree opens and closes on its own.', 'holds'),
      st('Control K opens a switcher that finds any project or agent.', 'holds'),
      st('A thread keeps its draft and its scroll position when you leave it.', 'holds'),
      st('A thread opens at its latest message.', 'building'),
      st('Tool calls in a thread fold under one line.', 'building'),
      st('A large item loads only when you ask for it.'),
      st('The sidebar folds to a 48 pixel rail.', 'building'),
      st('The sidebar, the bell and Home count the same open requests.', 'building'),
      st('An agent thread opens from the board.', 'building', 'Waits for your answer on where the thread opens.'),
      st('Keyboard order at 390 pixels follows the visual order.', 'review'),
      st('Every focused control shows a focus ring.', 'review'),
      st('The terminal key row never covers the last line.', 'review'),
      st('The drawer lists the project before the service pages.', 'review'),
    ];
  });

  add('rules', (w) => {
    w.reviews = [review('rv-rules', 'SP-01 Rule storage and matching', 'Plan review', 'rules-plan', 'stuck',
      'Round 4 starts when statement 7 is settled. Rounds 5 and 6 each need your approval.', [
        { ts: at(21 * HOUR), findings: [
          fnd(7, 'blocker', 'Exact command text will not match the same command with other arguments.', 'open'),
          fnd(3, 'blocker', 'The plan stores rules in the settings file, which agents can write.'),
          fnd(2, 'major', 'No citation for where approvals are answered today.'),
          fnd(7, 'major', 'No test names a command with a changed filter.', 'open'),
          fnd(5, 'minor', 'The rule record has no creation time.'),
          fnd(9, 'minor', 'The Rules page is named two ways.'),
          fnd(1, 'minor', 'The statement cites a file that has moved.'),
          fnd(11, 'minor', 'Pause and remove are not told apart.')] },
        { ts: at(9 * HOUR), findings: [
          fnd(7, 'blocker', 'Matching is still by exact text.', 'open'),
          fnd(7, 'major', 'A rule for `pnpm test` would not cover `pnpm --filter web test`.', 'open'),
          fnd(4, 'major', 'A denied request can still create a rule.'),
          fnd(6, 'major', 'Matching runs after the prompt is shown, not before.'),
          fnd(8, 'major', 'Nothing limits how many rules one approval creates.'),
          fnd(3, 'minor', 'The store path is written in two forms.'),
          fnd(10, 'minor', 'Remove has no confirmation in the plan.'),
          fnd(12, 'minor', 'The rule count is not sourced.')] },
        { ts: at(2 * HOUR), findings: [
          fnd(7, 'blocker', 'Exact text misses the command the owner approved when its filter differs.', 'open'),
          fnd(7, 'major', 'The plan has no answer for leading arguments.', 'open'),
          fnd(7, 'minor', 'The example uses a command that no harness sends.', 'open'),
          fnd(7, 'minor', 'The statement does not say how letter case is treated.', 'open'),
          fnd(4, 'blocker', 'A rule made on one machine applies on every machine without saying so.', 'open'),
          fnd(6, 'major', 'Rule lookup has no test that fails first.', 'open'),
          fnd(10, 'major', 'Removing a rule does not cancel a request it already allowed.', 'open'),
          fnd(2, 'minor', 'A citation points at a line that has moved.', 'open'),
          fnd(12, 'minor', 'The end-result page does not name the rule count.', 'open')] },
      ])];
    w.stuck = { requestId: 'q-stuck', review: 'rv-rules', statement: 7, text: 'A rule matches by exact command text.', points: 14, of: 31, round: 3, rounds: 3 };
    w.runs = [run('Full run', 'Starting commit of the project', '4be2d65', 'master', 26 * HOUR, '6 min 9 s', 7792, 0, 12, { by: 'plan-r1' })];
    w.result.statements = [
      st('You can turn an approval into a standing rule with one choice.'),
      st('A standing rule is stored outside any file an agent can write.'),
      st('A rule records the command, the folder and the agent role it covers.'),
      st('A rule applies only on the machine where you made it.'),
      st('A rule records when it was made and by which request.'),
      st('A request that a rule covers is allowed before any prompt is shown.'),
      st('A rule matches by exact command text.', 'stuck', 'Stuck after round 3. Waiting for your decision.'),
      st('One approval makes at most one rule.'),
      st('The Rules page lists every standing rule.'),
      st('You can pause a rule, and you can remove it.'),
      st('A paused rule asks again, and keeps its record.'),
      st('The Rules page shows how often each rule was used.'),
    ];
  });

  add('phone', (w) => {
    w.result.statements = [
      st('The phone shows every request that waits for you, oldest first.'),
      st('You can answer a question or an approval without opening the laptop.'),
      st('You choose which of the four alerts reach the phone.'),
      st('A hidden approval says that its input cannot be seen.'),
    ];
    w.result.draft = true;
  });

  add('apiref', (w) => {
    w.reviews = [review('rv-apiref', 'docs/api-reference', 'Code review', 'apiref-review', 'clean', 'The review is clean. No blocker and no major is open.', [
      { ts: at(26 * HOUR), findings: [
        fnd(2, 'major', 'Three endpoints have no generated example.'),
        fnd(4, 'major', 'Old addresses return 404 instead of redirecting.'),
        fnd(5, 'major', 'The generator runs on every page load in development.'),
        fnd(2, 'minor', 'Two page titles differ from the OpenAPI summary.'),
        fnd(4, 'minor', 'The redirect list is not sorted.'),
        fnd(3, 'minor', 'One code sample is indented with tabs.'),
        fnd(1, 'minor', 'The sidebar order differs from the file.')] },
      { ts: at(2 * HOUR), findings: [] },
    ])];
    w.runs = [
      run('Full run', 'Before the merge into main', '9c1e7aa', 'docs/api-reference', 1 * HOUR + 40 * MIN, '1 min 52 s', 104, 0, 0, { by: 'apiref-r1' }),
      run('Full run', 'Merge of SP-01 Generate the reference', '31f0be4', 'docs/api-reference', 2 * DAY, '1 min 37 s', 96, 0, 0, { by: 'apiref-r1' }),
    ];
    w.result.statements = [
      st('Every endpoint in openapi.yaml has a reference page.', 'holds'),
      st('Each page shows a request example and a response example.', 'holds'),
      st('Code samples come from the OpenAPI file, not from hand-written text.', 'holds'),
      st('Every old page address redirects to its new page.', 'holds'),
      st('The reference is built once, at build time.', 'holds'),
      st('The hand-written reference pages are gone.', 'holds'),
    ];
    w.result.open = ['The search index still lists two removed pages. It refreshes with the nightly run.', 'The changelog entry for this change is not written yet.'];
    w.result.pr = { number: 212, title: 'Generate the API reference from openapi.yaml', requestId: 'q-merge', source: 'docs/api-reference', target: 'main', commits: 14, files: 37 };
  });

  add('exports', (w) => {
    w.runs = [
      run('Check', 'IE-4 · CSV writer with voided invoices', 'c07a5e1', 'feat/invoice-exports/build', 15 * MIN, '34 s', 31, 2, 0, { by: 'exports-b1', failures: [
        { name: 'a voided invoice keeps its original number', file: 'src/exports/csv.test.ts:41', message: 'Expected "INV-0042", received "".' },
        { name: 'the total row leaves out voided amounts', file: 'src/exports/csv.test.ts:67', message: 'Expected 1840.00, received 2310.00.' }] }),
      run('Full run', 'Starting commit of the project', '8e2b9d0', 'main', 2 * DAY - HOUR, '3 min 20 s', 1244, 0, 3, { by: 'exports-b1' }),
    ];
    w.settings.fullRun = 'make check';
    w.settings.check = 'pnpm vitest related';
    w.result.statements = [
      st('A month of invoices exports as one CSV file.', 'building'),
      st('Voided invoices are in the export, and are marked as voided.', 'building'),
      st('Month boundaries follow the account time zone.', 'building', 'Its builder failed to start on Buildbox.'),
      st('The same month exports as one PDF, with one invoice on each page.'),
      st('A large export downloads as a stream.'),
    ];
  });

  add('docsrefresh', (w) => {
    w.runs = [
      run('Nightly', 'No code changed. The run was skipped.', 'b7710c4', 'main', 9 * HOUR, '0 s', 0, 0, 0, { by: null, skippedRun: true }),
      run('Nightly', 'One commit since the last run', 'b7710c4', 'main', DAY + 9 * HOUR, '1 min 12 s', 88, 0, 1, { by: null, note: 'One skipped test was checked: it waits for the new search index.' }),
      run('Full run', 'Before the merge into main', '6f3d1aa', 'docs/refresh', 19 * DAY, '1 min 9 s', 88, 0, 0, { by: null }),
    ];
    w.result.statements = [
      st('The getting-started guide fits on one page.', 'holds'),
      st('Every command in the guide runs as written.', 'holds'),
      st('The guide links to the API reference, not to removed pages.', 'holds'),
    ];
    w.result.pr = { number: 198, title: 'Rewrite the getting-started guide', merged: true, mergedAt: at(19 * DAY), source: 'docs/refresh', target: 'main', commits: 9, files: 6 };
  });
}

// ---- phases ----------------------------------------------------------------------
const INFO = {
  define: { ran: ['Project lead'], yours: 'Say what to change. Read the end-result page and answer "Build this?".', ends: 'Ends when you agree to the end-result page.',
    made: (s, p, w) => [
      { icon: 'file-text', label: 'End-result page', sub: w.result.statements.length ? plural(w.result.statements.length, 'numbered statement') : 'Not written yet', to: `/p/${p.id}/workflow/result` },
      { icon: 'file-code', label: '.lgcode config file', sub: `Tests ${p.tests}, agent review ${p.agentReview}`, to: `/p/${p.id}/workflow/settings` },
      p.hasMocks && { icon: 'frame', label: 'Mocks', sub: 'Screens drawn by the Design team', to: `/p/${p.id}/mocks` }] },
  design: { ran: ['Project lead', 'Test writer'], yours: 'Decide the sprints and the number of teams, only if the lead asks.', ends: 'Ends when every team has been started and sent its plan.',
    made: (s, p, w) => { const sp = sprintsOf(s, p.id), tm = teamsOf(s, p.id); return [
      { icon: 'test-tube-diagonal', label: 'Full-run report for the starting commit', sub: w.runs.length ? 'Kept with the test runs' : 'No run yet', to: `/p/${p.id}/workflow/runs` },
      { icon: 'kanban', label: plural(sp.length, 'sprint'), sub: 'Sized in points and ordered by what depends on what', to: `/p/${p.id}/board` },
      { icon: 'users', label: plural(tm.length, 'team'), sub: tm.map(teamName).join(', ') || 'None yet', to: `/p/${p.id}/agents` },
      { icon: 'route', label: 'User-flow tests', sub: 'Written before any code' }]; } },
  plan: { ran: ['Planning lead', 'Planners', 'Reviewer'], yours: 'Answer a planning question. Settle a stuck statement. Approve rounds 5 and 6.', ends: 'Ends when each plan review is clean and the lead has compared the plans across teams.',
    made: (s, p, w) => [
      { icon: 'clipboard-list', label: 'One plan for each team', sub: 'Every statement cites the code it changes' },
      { icon: 'gauge', label: 'Plan review rounds', sub: 'Findings scored in points', to: `/p/${p.id}/workflow/review` }] },
  build: { ran: ['Build leads', 'Builders', 'Test writer', 'Test runner'], yours: 'Answer questions and approvals as they come.', ends: 'Ends when every sprint has merged into the project branch with a passing report.',
    made: (s, p, w) => [
      { icon: 'list-checks', label: 'Tests that failed first', sub: 'Each test fails on its assertion before code is written' },
      { icon: 'git-commit-horizontal', label: 'Commits on the team branches', sub: 'One writer for each set of files', to: `/p/${p.id}/git` },
      { icon: 'test-tube-diagonal', label: 'Check reports', sub: 'A merge needs a passing report for that exact commit', to: `/p/${p.id}/workflow/runs` }] },
  verify: { ran: ['Test runner'], yours: 'Nothing, unless a user flow needs you.', ends: 'Ends when the smoke test, the full suite and the user flows pass.',
    made: (s, p, w) => [
      { icon: 'play', label: 'Install and smoke test', sub: 'The product starts from a clean checkout' },
      { icon: 'test-tube-diagonal', label: 'Full-suite report', sub: 'On the merged project branch', to: `/p/${p.id}/workflow/runs` },
      { icon: 'image', label: 'User-flow screenshots', sub: 'Web, phone size and the Mac simulator' }] },
  review: { ran: ['Review lead', 'Reviewer'], yours: 'Sort findings if asked. Settle a stuck statement.', ends: 'Ends when no blocker and no major is open.',
    made: (s, p, w) => [
      { icon: 'scan-search', label: 'Review findings', sub: 'Each one tied to a statement of the end-result page', to: `/p/${p.id}/workflow/review` },
      { icon: 'shield-check', label: 'Verdict', sub: 'Shown as evidence on the merge' }] },
  handover: { ran: ['Project lead'], yours: 'Try the product. Approve the merge for anything users would notice.', ends: 'Ends when the work is merged into the base branch.',
    made: (s, p, w) => [
      { icon: 'git-pull-request', label: 'Pull request to the base branch', sub: w.result.pr ? `#${w.result.pr.number}` : 'Opened when the review is clean', to: `/p/${p.id}/workflow/result` },
      { icon: 'file-text', label: 'Finished page', sub: 'What was built, with its evidence', to: `/p/${p.id}/workflow/result` }] },
  running: { ran: ['Test runner'], yours: 'Read the one-line summary.', ends: 'Runs every night while the code changes.',
    made: (s, p, w) => [
      { icon: 'history', label: 'Nightly report', sub: 'Failures are explained before you are told', to: `/p/${p.id}/workflow/runs` },
      { icon: 'book-open', label: 'Lessons', sub: 'Written into the skills the agents read' }] },
};
function phaseTimes(s, p, cur) {
  const end = p.archived ? p.createdAt + 2 * DAY : s.T; const wt = [1, 2, 6, 9, 3, 4, 2, 1]; const total = wt.slice(0, cur + 1).reduce((a, b) => a + b, 0);
  let t = p.createdAt;
  return PHASES.map((_, i) => { if (i > cur) return null; const start = t; t += (end - p.createdAt) * wt[i] / total; return { start, end: i < cur ? t : null }; });
}

function StuckCard({ s, p, w }) {
  const now = useNow(); const k = w.stuck; if (!k) return null;
  const r = byId(s.requests, k.requestId); if (!r) return null;
  const a = agentOf(s, r.agent); const open = r.status === 'open';
  const settle = (id) => { act.answerRequest(r.id, id); update(() => {
    k.decision = id; const stt = w.result.statements[k.statement - 1]; const rv = byId(w.reviews, k.review);
    if (stt) { stt.state = id === 'drop' ? 'dropped' : 'open'; stt.note = id === 'drop' ? 'You dropped it after round 3.' : id === 'change' ? 'The Planning lead is rewriting it.' : 'You kept it as written.'; }
    if (rv) { rv.state = 'running'; rv.next = 'Round 4 is running. Rounds 5 and 6 each need your approval.'; } }); };
  return html`<section class=${cx('req wf-stuck', !open && 'closed')} aria-label="Stuck statement">
    <div class="req-head"><span class=${cx('kind', open ? 'question' : 'closed')}>Stuck statement</span><span class="tag">statement ${k.statement}</span>
      <span class="age">${open ? 'Waiting ' + ago(r.createdAt, now) : r.answer + ' · ' + clock(r.answeredAt)}</span></div>
    <blockquote class="wf-quote">${k.text}</blockquote>
    <ul class="wf-why">
      <li><b class="num">${k.points} of ${k.of}</b> points in round ${k.round} <span class="muted">(${Math.round(k.points / k.of * 100)}%, the limit is ${w.settings.stuckPoints} points and 30%)</span></li>
      <li>A major or a blocker in each of <b class="num">${k.rounds}</b> rounds</li>
    </ul>
    ${r.recommendation && html`<p class="rec"><${Icon} name="sparkles" size=${14} /><span><b>${a.name} recommends:</b> ${r.recommendation}</span></p>`}
    ${open ? html`<div class="wf-choices">
      <button type="button" class="wf-choice primary" onClick=${() => settle('change')}><b>Change it</b><span>The Planning lead rewrites the statement, and round 4 reviews it.</span></button>
      <button type="button" class="wf-choice" onClick=${() => settle('keep')}><b>Keep it</b><span>It stays as written. Reviewers stop scoring it.</span></button>
      <button type="button" class="wf-choice" onClick=${() => settle('drop')}><b>Drop it</b><span>It leaves the end-result page and the plan.</span></button>
    </div>` : html`<div class="answer"><${Icon} name="check" size=${14} /><span>You chose to ${k.decision || 'answer'}${k.decision ? ' it' : ''}. Round 4 is running.</span></div>`}
    <div class="req-foot"><${Avatar} agent=${a} s=${s} size="sm" /><span class="muted">${a.name}</span><span class="grow"></span><button type="button" class="btn sm ghost" onClick=${() => act.openSidePanel(a.id, r.id)}><${Icon} name="message-square" size=${13} />Open thread</button></div>
  </section>`;
}

// The project's agents in three groups. Waiting hides when empty. Working and Idle show
// whenever the project has agents, and one hides only when it is empty and another shows.
function agentGroups(s, p) {
  const all = s.agents.filter((a) => a.project === p.id);
  if (!all.length) return [{ id: 'all', label: 'Agents', agents: [] }];
  const g = [
    { id: 'waiting', label: 'Waiting', agents: all.filter((a) => a.state === 'waiting' || a.state === 'failed') },
    { id: 'working', label: 'Working', agents: all.filter((a) => a.state === 'working') },
    { id: 'idle', label: 'Idle', agents: all.filter((a) => a.state === 'idle' || a.state === 'stopped') },
  ];
  const shown = (x) => x.agents.length > 0;
  return g.filter((x) => x.id === 'waiting' ? shown(x) : shown(x) || !g.some((y) => y !== x && shown(y)));
}
function Agents({ s, p }) {
  const groups = agentGroups(s, p);
  return html`<section class="wf-agents" aria-label="Agents">
    ${groups.map((g) => html`<div key=${g.id} class=${cx('wf-group', g.id)}>
      <div class="wf-group-head"><h3>${g.label}</h3>${g.id !== 'all' && html`<span class="count">${g.agents.length}</span>`}</div>
      ${g.agents.length === 0 ? html`<p class="muted wf-none" data-empty>No agents running</p>`
      : html`<ul class="wf-made">${g.agents.map((a) => html`<li key=${a.id}><a class=${cx('wf-item', g.id === 'waiting' && 'warn')} href=${href(routeForAgent(s, a))}>
          <${Avatar} agent=${a} s=${s} size="sm" /><span class="lbl">${agentLabel(s, a, { withTeam: true })}</span><span class="sub truncate">${a.activity}</span><${Icon} name="chevron-right" size=${14} class="go" /></a></li>`)}</ul>`}
    </div>`)}
  </section>`;
}

function Overview({ s, p, w }) {
  const now = useNow(); const cur = Math.max(0, PHASES.findIndex((x) => x.id === p.phase));
  const [sel, setSel] = useState(null); const i = sel == null ? cur : sel; const ph = PHASES[i]; const info = INFO[ph.id];
  const times = phaseTimes(s, p, cur); const tm = times[i]; const status = i < cur ? 'done' : i === cur ? 'now' : 'next';
  const reqs = openRequests(s, { project: p.id });
  const ran = ph.id === 'define' && p.hasMocks ? [...info.ran, 'Design lead', 'Designer'] : info.ran;
  const made = info.made(s, p, w).filter(Boolean);
  const sps = sprintsOf(s, p.id); const done = sps.filter((x) => x.column === 'Done').length; const doing = sps.filter((x) => x.column === 'In progress' || x.column === 'Review').length;
  const fixes = w.fixes.map((f) => { const sp = f.sprint && byId(s.sprints, f.sprint); return sp ? { ...f, label: sp.label, name: sp.name, to: `/p/${p.id}/sprint/${sp.id}`, column: sp.column } : f; });
  return html`<div class="wf-body">
    <p class="wf-status">
      ${p.archived ? html`<span class="badge">Archived</span>` : null}
      <span>Phase <b class="num">${cur + 1}</b> of 8 · ${PHASES[cur].name}</span>
      <span>${sps.length ? html`<b class="num">${done}</b> of ${plural(sps.length, 'sprint')} done · <b class="num">${doing}</b> under way` : 'No sprints'}</span>
      ${!p.archived && reqs.length > 0 && html`<a class="warn-text" href=${href('/home')}>${plural(reqs.length, 'request')} waiting</a>`}
    </p>
    <${StuckCard} s=${s} p=${p} w=${w} />
    <div class="wf-phases">
      <ol class="wf-rail" aria-label="Phases of the build loop">
        ${PHASES.map((x, n) => { const stt = n < cur ? 'done' : n === cur ? 'now' : 'next'; const t = times[n];
          return html`<li key=${x.id} class=${stt}><button type="button" aria-current=${n === i ? 'true' : null} onClick=${() => setSel(n)}>
            <span class="mark">${stt === 'done' ? html`<${Icon} name="check" size=${11} />` : stt === 'now' ? html`<i></i>` : x.n}</span>
            <span class="name">${x.name}</span>
            <span class="meta">${stt === 'done' ? ago(t.start, t.end) : stt === 'now' ? 'Now' : ''}</span></button></li>`; })}
      </ol>
      <section class="wf-detail" aria-label=${ph.name}>
        <header><h2><span class="faint num">${ph.n}</span> ${ph.name}</h2>
          <span class=${cx('badge', status === 'done' && 'success', status === 'now' && 'info')}>${status === 'done' ? 'Done' : status === 'now' ? 'Now' : 'Not started'}</span>
          <span class="grow"></span>
          <span class="muted wf-time">${status === 'done' ? `${when(tm.start, now)} · took ${ago(tm.start, tm.end)}` : status === 'now' ? `Started ${ago(tm.start, now)} ago` : `After ${PHASES[i - 1].name}`}</span></header>
        <dl class="wf-parts">
          <dt>What happens</dt><dd>${ph.what}</dd>
          <dt>Run by</dt><dd class="row" style="flex-wrap:wrap;gap:4px">${ran.map((r) => html`<span class="badge outline" key=${r}>${r}</span>`)}</dd>
          <dt>Your part</dt><dd>${info.yours}</dd>
          <dt>Ends</dt><dd>${info.ends.replace(/^Ends when /, 'When ').replace(/^Runs /, 'It runs ')}</dd>
          <dt>${status === 'next' ? 'Will produce' : 'Produced'}</dt>
          <dd><ul class="wf-made">${made.map((m) => { const C = m.to && status !== 'next' ? 'a' : 'div';
            return html`<li key=${m.label}><${C} class="wf-item" href=${m.to && status !== 'next' ? href(m.to) : null}><${Icon} name=${m.icon} size=${15} /><span class="lbl">${m.label}</span><span class="sub truncate">${status === 'next' ? '' : m.sub}</span>${m.to && status !== 'next' && html`<${Icon} name="chevron-right" size=${14} class="go" />`}<//></li>`; })}</ul></dd>
        </dl>
      </section>
    </div>

    <${Agents} s=${s} p=${p} />

    <div class="section-head wf-sec"><h2>Fix sprints</h2><span class="count">${fixes.length}</span></div>
    <div class="table-wrap"><table class="table wf-fixes"><thead><tr><th>Sprint</th><th>Why it was added</th><th>Merge</th><th>State</th></tr></thead><tbody>
      ${fixes.length === 0 ? html`<tr><td colspan="4" class="muted" data-empty>No fix sprints</td></tr>`
      : fixes.map((f) => html`<tr key=${f.label} class=${cx(f.to && 'click', !f.auto && 's-warn')} onClick=${() => f.to && go(f.to)}>
        <td class="state-cell wrap"><span class="tag">${f.label}</span> ${f.to ? html`<a class="wf-strong" href=${href(f.to)}>${f.name}</a>` : html`<span class="wf-strong">${f.name}</span>`}</td>
        <td class="wrap muted">${f.why}</td>
        <td class="wrap">${f.auto && w.settings.autoMergeFix ? html`<span class="badge info">On its own</span>` : html`<span class="badge warn">Needs your approval</span>`}</td>
        <td class="wrap muted">${f.column === 'Done' ? 'Merged.' : f.state}</td></tr>`)}
    </tbody></table></div>
  </div>`;
}

// ---- review rounds -----------------------------------------------------------------
function Review({ s, p, w }) {
  const now = useNow(); const [rid, setRid] = useState(null); const [sel, setSel] = useState(null); const [filter, setFilter] = useState('all');
  // With no review yet, the page keeps its rounds and its findings table, empty.
  if (!w.reviews.length) return html`<div class="wf-body">
    <p class="wf-status"><span>No review</span><span class="grow"></span><span class="badge">${p.agentReview === 'off' ? 'Agent review off' : 'Not started'}</span></p>
    <div class="wf-rounds">${Array.from({ length: w.settings.maxRounds }, (_, k) => html`<div key=${k} class="wf-round empty"><div class="bar"></div><b>Round ${k + 1}</b><span>${k + 1 >= 5 ? 'Needs your approval' : '—'}</span></div>`)}</div>
    <div class="table-wrap"><table class="table wf-findings"><thead><tr><th>Finding</th><th>Statement</th><th>Severity</th><th>What the reviewer found</th><th class="num">Points</th><th>State</th></tr></thead>
      <tbody><tr><td colspan="6" class="muted" data-empty>No findings</td></tr></tbody></table></div>
  </div>`;
  const rv = byId(w.reviews, rid) || w.reviews[0]; const max = w.settings.maxRounds;
  const n = Math.min(sel || rv.rounds.length, rv.rounds.length); const round = rv.rounds[n - 1];
  const top = Math.max(1, ...rv.rounds.map(roundPoints)); const team = byId(s.teams, rv.team);
  const list = round.findings.filter((f) => filter === 'all' || f.status === filter).sort((a, b) => POINTS[b.sev] - POINTS[a.sev] || a.statement - b.statement);
  const openN = round.findings.filter((f) => f.status === 'open').length;
  const state = { stuck: ['warn', 'Stuck'], scoring: ['info', 'Being scored'], running: ['info', 'Round running'], clean: ['success', 'Clean'] }[rv.state] || ['', rv.state];
  return html`<div class="wf-body">
    ${w.reviews.length > 1 && html`<div class="seg" style="justify-self:start">${w.reviews.map((x) => html`<button type="button" key=${x.id} aria-pressed=${x.id === rv.id} onClick=${() => { setRid(x.id); setSel(null); }}>${x.subject}</button>`)}</div>`}
    <header class="wf-rvhead"><div class="grow"><h2>${rv.subject}</h2>
      <p class="muted">${rv.kind}${team ? html` by the <a class="link" href=${href(`/p/${p.id}/team/${team.id}`)}>${teamName(team)}</a>` : ''} · round ${rv.rounds.length} of ${max}</p></div>
      <span class=${cx('badge', state[0])}>${state[1]}</span></header>
    <${StuckCard} s=${s} p=${p} w=${w.stuck && w.stuck.review === rv.id ? w : { ...w, stuck: null }} />
    <div class="wf-rounds" role="tablist" aria-label="Review rounds">
      ${Array.from({ length: Math.max(max, rv.rounds.length) }, (_, k) => { const r = rv.rounds[k]; const pts = r ? roundPoints(r) : 0;
        if (!r) return html`<div key=${k} class="wf-round empty"><div class="bar"></div><b>Round ${k + 1}</b><span>${k + 1 >= 5 ? 'Needs your approval' : k === rv.rounds.length ? (rv.state === 'clean' ? 'Not needed' : rv.state === 'running' ? 'Running now' : 'Next') : 'Only if needed'}</span></div>`;
        return html`<button type="button" key=${k} role="tab" class="wf-round" aria-selected=${n === k + 1} onClick=${() => setSel(k + 1)}>
          <div class="bar" title=${pts + ' points'}>${pts === 0 ? html`<${Icon} name="check" size=${14} class="success-text" />` : html`<div class="wf-stack" style=${{ height: Math.max(8, pts / top * 100) + '%' }}>
            ${['blocker', 'major', 'minor'].map((sev) => { const c = roundCount(r, sev); return c ? html`<i key=${sev} class=${sev} style=${{ flex: c * POINTS[sev] }}></i>` : null; })}</div>`}</div>
          <b>Round ${k + 1}</b><span class="num">${pts === 0 ? 'Clean' : plural(pts, 'point')}</span></button>`; })}
    </div>
    <p class="wf-legend"><span><i class="sw blocker"></i>Blocker, 9 points</span><span><i class="sw major"></i>Major, 3 points</span><span><i class="sw minor"></i>Minor, 1 point</span>
</p>

    <div class="section-head wf-sec"><h2>Round ${n} findings</h2><span class="count">${round.findings.length}</span>
      <span class="muted wf-time">${when(round.ts, now)}</span><span class="grow"></span>
      ${round.findings.length > 0 && html`<div class="seg">${[['all', 'All'], ['open', `Open ${openN}`], ['fixed', `Fixed ${round.findings.length - openN}`]].map(([id, label]) => html`<button type="button" key=${id} aria-pressed=${filter === id} onClick=${() => setFilter(id)}>${label}</button>`)}</div>`}</div>
    <div class="table-wrap"><table class="table wf-findings"><thead><tr><th>Finding</th><th>Statement</th><th>Severity</th><th>What the reviewer found</th><th class="num">Points</th><th>State</th></tr></thead><tbody>
      ${list.length === 0 && html`<tr><td colspan="6" class="muted" data-empty>${round.findings.length === 0 ? 'No findings. The review is clean.' : `No ${filter} findings`}</td></tr>`}
      ${list.map((f) => html`<tr key=${f.id} class=${cx(f.status === 'open' && f.sev !== 'minor' && 's-warn')}>
        <td class="state-cell mono muted">${f.id}</td>
        <td><a class="link num" href=${href(`/p/${p.id}/workflow/result`)} title=${w.result.statements[f.statement - 1]?.text}>${f.statement}</a>${w.stuck && w.stuck.statement === f.statement && w.stuck.review === rv.id && !w.stuck.decision ? html` <span class="badge warn">Stuck</span>` : ''}</td>
        <td><span class=${cx('wf-sev', f.sev)}><i></i>${SEV_LABEL[f.sev]}</span></td>
        <td class="wrap">${f.text}</td>
        <td class="num">${POINTS[f.sev]}</td>
        <td>${f.status === 'fixed' ? html`<span class="row success-text" style="gap:4px"><${Icon} name="check" size=${13} />Fixed</span>` : html`<span class="muted">Open</span>`}</td></tr>`)}
    </tbody></table></div>
  </div>`;
}

// ---- test runs -------------------------------------------------------------------
// Laid out like GitHub Actions: the runs on the left, and the selected run's jobs, their
// steps, and the log of the selected step on the right. The owner watches; nothing here
// operates a builder or a test runner.
const toneOf = (r) => (r.running ? 'run' : r.skippedRun ? 'skip' : r.failed ? (r.expected ? 'exp' : 'fail') : 'pass');
const TONE_ICON = { run: 'loader-circle', skip: 'minus', exp: 'circle-dot', fail: 'circle-x', pass: 'circle-check' };
const TONE_WORD = { run: 'Running', skip: 'Skipped', exp: 'Failed as expected', fail: 'Failed', pass: 'Passed' };
const secs = (d) => { const m = /(?:(\d+) min)?\s*(?:(\d+) s)?/.exec(d || ''); return (+(m[1] || 0)) * 60 + (+(m[2] || 0)); };
const dur = (n) => (n >= 60 ? `${Math.floor(n / 60)} min ${n % 60} s` : `${n} s`);
// The jobs and steps of a run, made from its record so every run has the same shape.
function jobsOf(s, p, r) {
  const t = toneOf(r); const total = secs(r.dur); const cmd = r.kind === 'Check' ? ensure(s, p).settings.check : ensure(s, p).settings.fullRun;
  const st = (name, tone, n, log) => ({ name, tone, dur: dur(Math.max(1, Math.round(n))), log });
  const setup = (n) => [
    st('Check out', 'pass', 2, [`Checking out ${r.commit} on ${r.branch}`, `HEAD is now at ${r.commit}`]),
    st('Install', 'pass', n, ['Lockfile is up to date', 'Packages are installed from the cache', 'Done']),
  ];
  if (r.skippedRun) return [{ name: 'Changes', tone: 'skip', steps: [st('Compare with the last run', 'skip', 1, [`No commit since ${r.commit}`, 'The run was skipped'])] }];
  const failLog = r.failures.flatMap((f) => [`FAIL ${f.file}`, `  ✕ ${f.name}`, `    ${f.message}`, '']);
  const testTone = t === 'run' ? 'run' : t;
  const testLog = [`> ${cmd}`, '', ...failLog,
    t === 'run' ? 'Running…' : `Tests: ${r.failed ? r.failed + ' failed, ' : ''}${r.passed} passed${r.skipped ? ', ' + r.skipped + ' skipped' : ''}, ${r.passed + r.failed + r.skipped} total`,
    ...(r.note ? ['', r.note] : [])];
  if (r.kind === 'Check') return [{ name: 'Check', tone: testTone, steps: [...setup(total * 0.2), st('Run the related tests', testTone, total * 0.75, testLog), st('Write the report', t === 'run' ? 'queued' : 'pass', 1, ['Report saved for commit ' + r.commit])] }];
  const unit = Math.round(total * 0.55), flows = Math.round(total * 0.3);
  return [
    { name: 'Set up', tone: 'pass', steps: setup(total * 0.1) },
    { name: 'Tests', tone: testTone, steps: [st('Run the full suite', testTone, unit, testLog), st('Write the report', t === 'run' ? 'queued' : 'pass', 1, ['Report saved for commit ' + r.commit])] },
    { name: 'User flows', tone: t === 'run' ? 'queued' : 'pass', steps: [st('Start the product', t === 'run' ? 'queued' : 'pass', flows * 0.3, ['The product started from a clean checkout']), st('Run the user flows', t === 'run' ? 'queued' : 'pass', flows * 0.7, ['Web, phone size and the Mac simulator', 'All flows passed'])] },
  ];
}
const StepIcon = ({ tone, size = 14 }) => tone === 'queued' ? html`<span class="wf-res queued"><${Icon} name="circle" size=${size} /></span>`
  : html`<span class=${cx('wf-res', tone)}><${Icon} name=${TONE_ICON[tone]} size=${size} class=${tone === 'run' ? 'wf-spin' : ''} /></span>`;
function RunDetail({ s, p, r, now }) {
  const jobs = r ? jobsOf(s, p, r) : [];
  const firstBad = jobs.findIndex((j) => j.tone === 'fail' || j.tone === 'run');
  const [ji, setJi] = useState(Math.max(0, firstBad));
  const job = jobs[ji] || jobs[0];
  const pick = (j) => { if (!j) return -1; const k = j.steps.findIndex((x) => x.tone === 'fail' || x.tone === 'run'); return k >= 0 ? k : j.steps.findIndex((x) => /^(Run|Compare)/.test(x.name)); };
  const [open, setOpen] = useState(() => pick(job));
  const by = r && r.by && agentOf(s, r.by);
  return html`<section class="wf-rundetail" aria-label="Run">
    <header class="wf-runhead">${r ? html`
      <${StepIcon} tone=${toneOf(r)} size=${16} /><b>${r.kind}</b><span class="truncate">${r.why}</span><span class="grow"></span>
      <span class="tag commit" title=${r.branch}>${r.commit}</span>` : html`<span class="muted">No run selected</span>`}</header>
    ${r && html`<div class="wf-runmeta">
      <span class=${cx('wf-res', toneOf(r))}>${TONE_WORD[toneOf(r)]}</span>
      ${!r.running && !r.skippedRun && html`<span class="num">${fmt(r.passed)} passed</span>${r.failed > 0 && html`<span class=${cx('num', r.expected ? 'muted' : 'error-text')}>${fmt(r.failed)} failed</span>`}${r.skipped > 0 && html`<span class="num muted">${fmt(r.skipped)} skipped</span>`}`}
      <span class="muted"><span class="mono">${r.branch}</span></span>
      <span class="muted num">${r.running ? 'Started' : r.dur + ' ·'} ${ago(r.ts, now) === 'now' ? 'just now' : ago(r.ts, now) + ' ago'}</span>
      <span class="muted">${by ? by.name : 'LGTM Studio'}</span></div>`}
    <div class="wf-jobs">
      <nav class="wf-joblist" aria-label="Jobs"><h3>Jobs</h3>
        ${jobs.length === 0 && html`<p class="muted wf-none" data-empty>No jobs</p>`}
        ${jobs.map((j, k) => html`<button type="button" key=${j.name} aria-current=${k === ji ? 'true' : null} onClick=${() => { setJi(k); setOpen(pick(j)); }}>
          <${StepIcon} tone=${j.tone} /><span class="truncate">${j.name}</span></button>`)}
      </nav>
      <div class="wf-steps">
        <h3>${job ? job.name : 'Steps'}</h3>
        ${!job && html`<p class="muted wf-none" data-empty>No steps</p>`}
        ${job && job.steps.map((x, k) => html`<div key=${x.name} class=${cx('wf-step-row', open === k && 'open')}>
          <button type="button" aria-expanded=${open === k} onClick=${() => setOpen(open === k ? -1 : k)}>
            <${Icon} name="chevron-right" size=${13} class="twist" /><${StepIcon} tone=${x.tone} /><span class="grow truncate">${x.name}</span><span class="muted num">${x.tone === 'queued' ? '' : x.dur}</span></button>
          ${open === k && html`<pre class="wf-log">${x.log.map((line, n) => html`<span key=${n} class=${cx(/^(FAIL|  ✕)/.test(line) && 'bad')}><i>${n + 1}</i>${line}\n</span>`)}</pre>`}
        </div>`)}
      </div>
    </div>
  </section>`;
}
function Runs({ s, p, w }) {
  const now = useNow(5000); const [kind, setKind] = useState('all'); const [rid, setRid] = useState(null);
  const kinds = ['Full run', 'Check', 'Nightly'];
  const runs = w.runs.filter((r) => kind === 'all' || r.kind === kind).sort((a, b) => b.ts - a.ts);
  const sel = runs.find((r) => r.id === rid) || runs[0];
  const full = w.runs.filter((r) => r.kind !== 'Check' && !r.skippedRun).sort((a, b) => b.ts - a.ts)[0];
  const busy = w.runs.some((r) => r.running);
  const start = () => { const id = uid('run'); update(() => { w.runs.push({ id, kind: 'Full run', why: 'Started by you', commit: (full && full.commit) || 'HEAD', branch: p.branch, ts: Date.now(), dur: '—', passed: 0, failed: 0, skipped: 0, failures: [], running: true, by: null }); }); setRid(id);
    setTimeout(() => update(() => { const r = byId(w.runs, id); r.running = false; r.passed = full ? full.passed + full.failed : 1240; r.skipped = full ? full.skipped : 0; r.dur = full ? full.dur : '3 min 2 s'; r.ts = Date.now(); act.toast('Full run passed'); }), 3200); };
  return html`<div class="wf-body wf-wide">
    <div class="wf-bar">
      <div class="seg">${['all', ...kinds].map((k) => html`<button type="button" key=${k} aria-pressed=${kind === k} onClick=${() => setKind(k)}>${k === 'all' ? 'All' : k === 'Check' ? 'Checks' : k === 'Nightly' ? 'Nightly' : 'Full runs'}<span class="faint num">${k === 'all' ? w.runs.length : w.runs.filter((r) => r.kind === k).length}</span></button>`)}</div>
      <span class="grow"></span>
      ${p.tests === 'off' && html`<span class="muted wf-time">Tests are off</span>`}
      <button type="button" class="btn" disabled=${busy || p.tests === 'off' || p.archived} onClick=${start}><${Icon} name="play" size=${13} />Start full run</button>
    </div>
    <div class="wf-actions">
      <ul class="wf-runlist" aria-label="Runs">
        ${runs.length === 0 && html`<li class="muted wf-none" data-empty>No runs</li>`}
        ${runs.map((r) => { const t = toneOf(r); return html`<li key=${r.id}><button type="button" aria-current=${sel && sel.id === r.id ? 'true' : null} onClick=${() => setRid(r.id)}>
          <${StepIcon} tone=${t} /><span class="what"><b class="truncate">${r.why}</b><small class="muted"><span>${r.kind}</span> · <span class="mono">${r.commit}</span> · ${ago(r.ts, now) === 'now' ? 'just now' : ago(r.ts, now) + ' ago'}</small></span></button></li>`; })}
      </ul>
      <${RunDetail} key=${sel ? sel.id + (sel.running ? 'r' : '') : 'none'} s=${s} p=${p} r=${sel} now=${now} />
    </div>
  </div>`;
}

// ---- end-result page ---------------------------------------------------------------
const ST_WORD = { holds: ['success', 'Holds'], building: ['info', 'Being built'], review: ['info', 'In review'], stuck: ['warn', 'Stuck'], dropped: ['', 'Dropped'], open: ['', 'Not started'] };
function Result({ s, p, w }) {
  const now = useNow(); const res = w.result; const sts = res.statements; const lead = leadOf(s, p);
  const live = sts.filter((x) => x.state !== 'dropped'); const holds = live.filter((x) => x.state === 'holds').length;
  const finished = p.phase === 'handover' || p.phase === 'running'; const pr = res.pr; const merged = pr && (pr.merged || p.merged);
  const req = pr && pr.requestId && byId(s.requests, pr.requestId);
  const sprints = sprintsOf(s, p.id); const lastFull = w.runs.filter((r) => r.kind !== 'Check' && !r.skippedRun).sort((a, b) => b.ts - a.ts)[0]; const rv = w.reviews[0];
  return html`<div class="wf-body">
    <div class="wf-status">
      ${res.draft ? html`<span class="badge">Draft</span>` : finished ? html`<span class=${cx('badge', merged ? 'success' : 'info')}>${merged ? 'Merged' : 'Ready'}</span>` : null}
      <span><b class="num">${holds}</b> of ${plural(live.length, 'statement')} hold</span><span class="grow"></span>
      <div class="progress wf-prog" title=${`${holds} of ${live.length}`}>${live.map((x, i) => html`<i key=${i} class=${cx(x.state === 'stuck' && 'warn', (x.state === 'building' || x.state === 'review') && 'active')} style=${{ flex: 1, background: x.state === 'open' ? 'transparent' : null }}></i>`)}</div></div>

    ${pr && html`<section class=${cx('wf-pr', merged ? 'merged' : 'wait')}>
      <${Icon} name=${merged ? 'git-merge' : 'git-pull-request'} size=${18} />
      <div class="grow"><b>${pr.title} <span class="muted num">#${pr.number}</span></b>
        <p class="muted"><span class="mono">${pr.source}</span> into <span class="mono">${pr.target}</span> · ${pr.commits} commits · ${pr.files} files · ${merged ? `merged ${pr.mergedAt ? ago(pr.mergedAt, now) + ' ago' : 'by you'}` : 'waiting for you'}</p></div>
      ${merged ? html`<span class="badge success">Merged</span>` : req && req.status === 'open' ? html`<button type="button" class="btn primary" onClick=${() => act.openDialog({ type: 'merge-review', requestId: req.id })}>Review and merge</button>` : html`<span class="badge">${req ? req.answer : 'Open'}</span>`}
    </section>`}

    ${finished && html`<div class="wf-two">
      <section><h3>What was built</h3><ul class="wf-built">${sprints.map((sp) => html`<li key=${sp.id}><a class="link" href=${href(`/p/${p.id}/sprint/${sp.id}`)}>${sp.label} ${sp.name}</a><span>${sp.goal}</span></li>`)}
        ${sprints.length === 0 && html`<li><span>${p.goal}</span></li>`}</ul></section>
      <section><h3>Evidence</h3><ul class="wf-ev">
        ${lastFull && html`<li><${Icon} name=${lastFull.failed ? 'triangle-alert' : 'circle-check'} size=${14} class=${lastFull.failed ? 'warn-text' : 'success-text'} /><span>Full run ${lastFull.failed ? 'failed' : 'passed'} · ${fmt(lastFull.passed)} tests · commit <span class="mono">${lastFull.commit}</span></span><a class="link" href=${href(`/p/${p.id}/workflow/runs`)}>Runs</a></li>`}
        ${rv && html`<li><${Icon} name=${rv.state === 'clean' ? 'circle-check' : 'triangle-alert'} size=${14} class=${rv.state === 'clean' ? 'success-text' : 'warn-text'} /><span>Review ${rv.state === 'clean' ? `clean after round ${rv.rounds.length}` : `open in round ${rv.rounds.length}`}</span><a class="link" href=${href(`/p/${p.id}/workflow/review`)}>Rounds</a></li>`}
        <li><${Icon} name="circle-check" size=${14} class="success-text" /><span>${holds} of ${live.length} statements hold</span></li>
      </ul>
      <h3 style="margin-top:var(--space-4)">Open items</h3>
      ${res.open.length ? html`<ul class="wf-open">${res.open.map((o, i) => html`<li key=${i}>${o}</li>`)}</ul>` : html`<p class="muted">None</p>`}</section>
    </div>`}

    <div class="section-head wf-sec"><h2>End-result page</h2><span class="count">${sts.length}</span><span class="grow"></span>
      <a class="btn sm ghost" href=${href(routeForAgent(s, lead))}><${Icon} name="message-square" size=${13} />Request change</a></div>
    <ol class="wf-statements">${sts.length === 0 && html`<li class="open" data-empty><span class="n num"></span><div class="t"><span>No statements</span></div><span></span></li>`}${sts.map((x, i) => { const [tone, word] = ST_WORD[x.state] || ST_WORD.open;
      return html`<li key=${i} class=${x.state}><span class="n num">${i + 1}</span><div class="t"><span>${x.text}</span>${x.note && html`<small>${x.note}</small>`}</div>
        <span class=${cx('badge', tone)}>${x.state === 'holds' && html`<${Icon} name="check" size=${11} />`}${word}</span></li>`; })}</ol>
  </div>`;
}

// ---- settings --------------------------------------------------------------------
function Row({ title, hint, children }) { return html`<div class="wf-set"><div class="l"><b>${title}</b><span>${hint}</span></div><div class="r">${children}</div></div>`; }
function Switch({ on, onChange, label }) { return html`<button type="button" class="switch" role="switch" aria-checked=${on} aria-label=${label} onClick=${() => onChange(!on)}></button>`; }
function Settings({ s, p, w }) {
  const set = w.settings; const repo = repoOf(s, p);
  const save = (k, v, quiet) => { if (set[k] === v) return; update(() => { set[k] = v; }); if (!quiet) act.toast('Workflow settings saved'); };
  const proj = (k, v) => { update(() => { p[k] = v ? 'on' : 'off'; }); act.toast('Workflow settings saved'); };
  const step = (k, d, lo, hi) => save(k, Math.min(hi, Math.max(lo, set[k] + d)), true);
  return html`<div class="wf-body wf-settings">
    <p class="wf-status"><span>Build loop</span><span>Saved to <span class="mono">.lgcode/config</span> on <span class="mono">${p.branch}</span></span></p>
    <section><h3>Tests</h3>
      <${Row} title="Run tests" hint="Tests are written first and must fail. A merge needs a passing report."><${Switch} on=${p.tests === 'on'} onChange=${(v) => proj('tests', v)} label="Run tests" /><//>
      <${Row} title="Full-run command" hint="Runs the whole suite on a starting commit, before a merge, and every night."><input class="input mono" aria-label="Full-run command" disabled=${p.tests !== 'on'} value=${set.fullRun} onBlur=${(e) => save('fullRun', e.target.value.trim() || set.fullRun)} onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()} /><//>
      <${Row} title="Check command" hint="Runs the tests of one task after its builder commits."><input class="input mono" aria-label="Check command" disabled=${p.tests !== 'on'} value=${set.check} onBlur=${(e) => save('check', e.target.value.trim() || set.check)} onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()} /><//>
      <${Row} title="Nightly full run" hint="Runs when the code changed that day. You get a one-line summary."><${Switch} on=${set.nightly} onChange=${(v) => save('nightly', v)} label="Nightly full run" /><//>
    </section>
    <section><h3>Review</h3>
      <${Row} title="Agent review" hint="Reviewers score each plan and each change in rounds. The Review phase runs even when this is off."><${Switch} on=${p.agentReview === 'on'} onChange=${(v) => proj('agentReview', v)} label="Agent review" /><//>
      <${Row} title="Most review rounds" hint="At the last round you cut, split or accept. Rounds 5 and 6 always ask you first.">
        <div class="wf-step"><button type="button" class="btn icon sm" aria-label="One round fewer" disabled=${set.maxRounds <= 1} onClick=${() => step('maxRounds', -1, 1, 6)}><${Icon} name="minus" size=${13} /></button><b class="num">${set.maxRounds}</b><button type="button" class="btn icon sm" aria-label="One round more" disabled=${set.maxRounds >= 6} onClick=${() => step('maxRounds', 1, 1, 6)}><${Icon} name="plus" size=${13} /></button></div><//>
      <${Row} title="Stuck at" hint="A statement is stuck when it has this many points and 30% of a round, or a major or blocker in 3 rounds. You then keep, change or drop it.">
        <div class="wf-step"><button type="button" class="btn icon sm" aria-label="Fewer points" disabled=${set.stuckPoints <= 9} onClick=${() => step('stuckPoints', -1, 9, 27)}><${Icon} name="minus" size=${13} /></button><b class="num">${set.stuckPoints}</b><button type="button" class="btn icon sm" aria-label="More points" disabled=${set.stuckPoints >= 27} onClick=${() => step('stuckPoints', 1, 9, 27)}><${Icon} name="plus" size=${13} /></button><span class="muted">points</span></div><//>
      <${Row} title="Points for a finding" hint="Fixed by the build loop."><span class="muted num">Minor 1 · Major 3 · Blocker 9</span><//>
    </section>
    <section><h3>Merging</h3>
      <${Row} title="Fix sprints merge on their own" hint="Only a fix that users would not notice, and only after a passing full run. Anything users would notice comes to you."><${Switch} on=${set.autoMergeFix} onChange=${(v) => save('autoMergeFix', v)} label="Fix sprints merge on their own" /><//>
      <${Row} title="Merge into the base branch" hint=${`A pull request into ${repo.main}. You approve it.`}><span class="muted">Always yours</span><//>
    </section>
  </div>`;
}

// ---- the tab ---------------------------------------------------------------------
export function WorkflowTab({ s, project, route }) {
  const w = ensure(s, project); const view = route.parts[3] || 'overview';
  const stuck = w.stuck && byId(s.requests, w.stuck.requestId)?.status === 'open';
  const failed = w.runs.some((r) => r.failed > 0 && !r.expected && !r.running && r.kind !== 'Check' && r === w.runs.filter((x) => x.kind !== 'Check' && !x.skippedRun).sort((a, b) => b.ts - a.ts)[0]);
  const views = [
    { id: 'overview', label: 'Phases' },
    { id: 'review', label: 'Review rounds', mark: stuck ? 'warn' : null },
    { id: 'runs', label: 'Test runs', mark: failed ? 'error' : null },
    { id: 'result', label: 'End result' },
    { id: 'settings', label: 'Settings' },
  ];
  const V = { review: Review, runs: Runs, result: Result, settings: Settings }[view] || Overview;
  return html`<div class="wf" data-main>
    <nav class="wf-nav" aria-label="Workflow views">${views.map((v) => html`<a key=${v.id} class="wf-tab" aria-current=${(V === Overview ? 'overview' : view) === v.id ? 'page' : null} href=${href(`/p/${project.id}/workflow${v.id === 'overview' ? '' : '/' + v.id}`)}>${v.label}${v.mark && html`<i class=${cx('dot', v.mark === 'warn' ? 'waiting' : 'failed')}></i>`}</a>`)}</nav>
    <${V} key=${project.id + view} s=${s} p=${project} w=${w} />
  </div>`;
}
