# Build loop design decisions, 2026-11-05

## What this note is

This note records how the owner wants LGTM Studio to run a piece of work from a
described change to a running product. The owner and an agent worked it out
as a set of state diagrams on 2026-11-04 and 2026-11-05.

The chart is at <https://claude.ai/artifact/LJx1tSx4h27WHQyc6qZjpF>. This note
holds the same steps as text, plus the reasons and the evidence.

This is a design draft. None of it is built, and no skill has been changed.
Measurements, model choices and round-by-round tuning were kept out of the
session on purpose.

The owner chose the spelling LGTM Studio on 2026-11-05, because "the pronunciation
works and its one less letter to type". The repository's code and current
documents were renamed on 2026-11-06.

## The goal of the loop

The owner's goal, in their words: "remove me as much as we can so that I just
talk to an agent about what I want to build". They do not read the code.

The loop covers engineering only. The first version of a product, called V0
here, is made outside the loop. Product choices, deployments, accounts, secrets
and security rules stay with the owner.

## The end result is fixed and everything else can change

The owner said: "the end result is what we want to get to, and everything in
between is usually malleable."

The owner also said that they contradict themselves, and that the agent should
realize this. A requirement that is causing trouble gets raised with them:
"Maybe the requirement isn't as important as it might seem."

Agents bring such a requirement to the owner. An agent never drops one on its
own. A builder in the foundation plans run changed production code to fit a
wrong test, so this limit matters.

## When a review stops and pings the owner

### Why this rule exists

Reviews on Ananke's plans kept finding problems with things the owner could
have settled in one sentence.

The clearest case is Ananke's rule-condition-builder plan, which ran 13 review
rounds. Round 2, on 2026-10-12, spent 39% of its weight on keeping old servers
and old requests working. The owner ended that on 2026-10-17 with one answer:
"There are no real users". That was about eight rounds later.

### How findings are scored

Each finding is tied to a statement. A statement is a numbered line of the
end-result page, the plan, or something the owner said. The reviewer picks the
number from a list, so that one problem cannot be split into several
differently worded statements. A statement keeps its number when the plan is
rewritten.

Duplicate findings are merged first. A script then adds up the points.

| Plan review label | 6 Review risk score | Points |
|-------------------|---------------------|--------|
| Minor             | Under 150           | 1      |
| Major             | 150 to 399          | 3      |
| Blocker           | 400 or more         | 9      |

Plan review uses the label, because no product exists yet to score. 6 Review
uses the settled risk score, because labels there have run high. The labels and
the risk score are the ones the Founder OS review rules already define.

Findings with no statement do not count. A cluster of ordinary bugs in one file
gets fixed without a ping.

### When a statement counts as stuck

A statement is stuck in either of two cases:

1. In one round, it has at least 12 points and at least 30% of that round's
   points.
2. It has drawn a major or a blocker in 3 rounds of the plan.

Twelve points means one blocker and one major, four majors, or twelve minors.
The owner confirmed 12 and said that 9 is too low.

A stuck statement stops that plan and pings the owner. Several stuck statements
go out in one ping. The owner keeps, changes or drops the statement. Their
answer is written into the plan, so later reviews stop raising it, and that
statement's count resets.

### Why rounds use a repeat count and not a share

The owner first asked for the 30% to apply across rounds. On the
rule-condition-builder plan it never fires there. Round 1 is so large that it
dilutes everything after it, and the highest share any statement reached across
rounds was 21%. The 3-round count does that job instead.

This table shows when the rule would have pinged on that plan. The findings were
grouped by hand on this one plan, so the numbers are evidence and not proof.

| Round | Statement                  | Why it pings   | Points | Share |
|-------|----------------------------|----------------|--------|-------|
| 2     | Old servers, old requests  | One round      | 27     | 39%   |
| 3     | Cooldown on re-filing      | 3 rounds       | n/a    | n/a   |
| 3     | More specific wins         | 3 rounds       | n/a    | n/a   |
| 5     | Cooldown on re-filing      | One round      | 12     | 32%   |
| 6     | Cooldown on re-filing      | One round      | 21     | 75%   |
| 10    | Rename rules               | One round      | 22     | 44%   |

The later cooldown pings would happen only if the round 3 answer did not end the
problem. Cooldown alone was 54 of the 128 points in rounds 4 to 9.

Round 10 is why the score uses points. By plain count, rename rules were 8 of 28
findings, which is 29% and would not have fired. Seven of that round's 11 majors
were about them.

### How many review rounds can run

| After round | What happens                                                  |
|-------------|---------------------------------------------------------------|
| 1 and 2     | Every finding is folded, then a full review runs.             |
| 3           | Every finding is folded. Round 4 runs only if blockers or     |
|             | majors are open, and it looks only for those.                 |
| 4 and 5     | The same, and the owner gets a ping saying why another round  |
|             | is needed. The next round waits for their approval.           |
| 6 and on    | There is no hard limit. Each further round asks the owner     |
|             | first. The owner approves the next round, or says to stop and |
|             | go on with the work. Decided by the owner on 2026-11-11.      |

Minors are folded in every round, including after round 3. A minor folded in the
last round has no review after it, so it is marked in the plan and left to the
later checks.

When the owner changes a plan's scope, the count restarts for the changed part,
and that part gets a full review. Without this, an amendment to a plan already
at its limit would get no review. Rounds 10 to 13 of the rule-condition-builder
plan reviewed such an amendment.

6 Review uses the same round count.

## Fix sprints run on their own

A sprint must start from a commit that has had a full test run. If that run
fails, a fix sprint is added ahead of the planned sprint.

The owner decided that fix sprints are autonomous. Unless users would see a
change, Hand over merges the fix with a full run and goes on to the next sprint.
The owner has no step in this, and nothing is deployed. A fix that users would
notice goes to the owner like any other work.

## Project setup is a conversation

The setup agent starts already knowing what V0 is and what it was made in. It
tells the owner what is there now, such as the languages and the architecture.
The owner gives the general direction and says whether anything should change.
Testing is one of the topics, and it is not the only one.

Setup runs before the first change, because the direction can change what that
first change should be. This placement was the agent's choice, and the owner has
seen it on the chart.

The owner decides whether the project has tests. If it has none, the owner
decides whether an agent review takes their place. Both are allowed to be off.
6 Review still runs in the default workflow.

The owner turns tests on later by telling their main agent. Nothing checks for
this automatically. Ananke took that path: it broke heavily first, and then its
testing grew to about 2 hours a run.

Setup produces a local `.lgtm` folder with a config file, similar to
`.claude`. The steps in this note are the default workflow, and they will become
a parsable list. Anyone who wants something else, such as skipping phase 6,
writes their own workflow.

The owner set the order on 2026-11-05. LGTM Studio looks in the repository's
`.lgtm` first, then `~/.lgtm`, then its built-in copy. The default install
places a copy in `~/.lgtm`. Agents can read `.lgtm` and cannot edit it.

## What is not decided

These points need the owner's word:

- **How setup's config arrives.** Decided by the owner on 2026-11-11: the owner
  runs `lgtm init` in the repository. It writes the template files into
  `.lgtm`, copies the global settings from `~/.lgtm` when they exist, and
  starts setup with the owner's preferred harness.
- **The end of round 6.** Decided by the owner on 2026-11-11: there is no hard
  limit. Each round from round 6 on asks the owner first, and the owner either
  approves it or says to stop and go on with the work.
- **The ping past round 4.** The owner asked for a notice and for approval of
  each round. The agent made them one ping.

These points were set aside on purpose: how migration numbers are handed out,
which other steps a script should control, a test index for
choosing narrow runs, and the template for the end-result page.

Model selection was set aside on 2026-11-05. The owner brought it into the loop
on 2026-11-10, in "Evaluation rounds and the model ledger" below.

## Additions still to be designed

The owner asked for these three additions on 2026-11-06. None of them is in the
chart or in the steps below yet. Only the quoted words are the owner's. The rest
of this section is the agent's reading and suggestions, and the owner has not
ruled on it.

### A lane for hotfixes

The owner said: "a lane for hotfixes. note it down, then for when user needs a
hotfix they talk to project lead and it spawns a hotfix team. very limited.
focused on fixing and pushing."

These points are open:

- **Who the project lead is.** This note has no role with that name. The closest
  is the owner's main agent.
- **What pushing may reach.** Rule 7 keeps the owner's approval for anything
  users would notice, and deployments stay with the owner. A hotfix is usually
  something users notice. Whether asking for the hotfix counts as that approval
  needs the owner's word.
- **What very limited means.** The agent suggests one fix, one test that shows
  the failure first, and a run of the failed and related tests. It also suggests
  no plan review rounds and no full 6 Review. The full run and the review could
  follow after the fix is out.
- **How the fix reaches running teams.** Every team in a sprint starts from the
  same commit, so a hotfix on the base branch can leave running teams behind it.

### A way to bisect

The owner said: "need a way to bisect(not sure what that means)."

To bisect is to find the commit that broke something by testing the middle of a
range of commits and halving the range each time. Finding the culprit among 1,000
commits takes about 10 tests.

The agent suggests an LGTM Studio command, because LGTM Studio limits which git commands
agents can run. The last passing full-run report gives the known-good commit, and
the failing commit gives the other end. The test runner agent would run only the
failing test at each step. The nightly run and the hotfix lane would both use it.

### A way to freeze the interfaces

The owner said: "Also a way to freeze the interfaces."

The agent reads an interface here as the agreed names, inputs and outputs of what
teams share, such as an API, a database schema or a message format. Freezing one
stops a team from changing it while another team is building against it.

The agent suggests freezing after Plans compared in 3 Plan, because that is when
the teams' plans have been checked against each other. A script could then fail
any change to a frozen interface, the way the frozen-test script does for tests.
A team that needs a change would take the existing plan wrong move back to 3 Plan.
What counts as an interface, and who can unfreeze one, are open.

## Evaluation rounds and the model ledger

The owner asked for this addition on 2026-11-10. It is not in the chart yet, and
none of it is built.

### What the owner asked for

The owner's words: "At the end of the project, or maybe not at the end of the
project but at the end of key tasks, we run an evaluation round, just seeing how
good things went or how bad it went, where we discovered issues and whatnot, and
whether the next time this runs, we should try a different model."

The purpose, in the owner's words: "figuring out which model is the best for
which task". The owner expects a pattern to emerge that sorts the AI labs into
buckets. One lab's frontier models are good at some kinds of work. Its faster
models are good at other kinds. Another lab is better at a third kind.

The owner also said that mistakes are expected, from the owner and from agents.
The rule is to learn from a mistake, write it down, and move on.

### When an evaluation round runs

The owner decided the timing on 2026-11-11. An evaluation round runs at the end
of each phase step, and it grades the work of that step. After 3 Plan, the
evaluators grade the planning. After 4 Build, they grade the building. The other
phases work the same way.

The session reports are the main evidence. Every agent writes one, so the round
does not need its own records beyond the result lines below.

The owner rejected a round after every team finishes. A project can have many
teams, and grading each one would be too many rounds.

- In 7 Hand over, the last round runs after the work is merged and the finished
  page is written.
- In 8 Keep running, the nightly lessons step feeds the same record.

An evaluation round never blocks the work. The next step starts while the round
runs.

Two related ideas are recorded in `docs/features.md`, under "Evaluation at
project teardown". They are not decided.

### What an evaluation round does

An evaluation round answers four questions about each task since the last
round.

1. How well did the work go? The round reads the review findings, the failure
   reports, the number of review rounds, and any later correction.
2. Where were problems found, and who found them?
3. Which model, at which effort, did the task?
4. Should a different model do this kind of task next time?

A grade counts only where an independent review or a later correction backs it.
A model's own claim that its work is good is not evidence.

Each task's result names the role, the model, the effort and the session that
did it. Each review result carries a grade for the work it reviewed. Without
these lines the round cannot grade the task.

### Where the results go

The agreed grades are written to the model ledger. The ledger is one file for
each run, at `model-ledger/runs/<date>-<project>-<run>.md` in the Founder OS
repository. Its README file defines the grades and the flags. The flags are
`unverified-claim`, `instruction-breach`, `test-gaming`, `scope-creep` and
`stub`.

The ledger feeds the model selection list, which says which model to try for
each kind of task. A model moves to harder or easier work when its grades say
so. The agent suggests that LGTM Studio reads the list when it starts an agent, and
that the owner can override the choice for one project.

A lesson that is about the work and not about a model goes into the skills, as
8 Keep running already says.

### What is not decided

The rest of this section is the agent's reading, and the owner has not ruled on
it.

- **Who evaluates.** Today the owner runs three evaluators from different labs
  and compares their grades. Whether the loop starts them itself is open.
- **What counts as a key task.** Decided by the owner on 2026-11-11: a phase
  step. "When an evaluation round runs" above has the details.
- **Where the ledger lives for other users.** Decided by the owner on
  2026-11-11: model evaluation moves out of Founder OS and into LGTM Studio, as
  research. LGTM Studio ships one default model selection ledger, which each user
  can update. How Founder OS and LGTM Studio are split is decided after the
  build loop is built.
- **How the list reaches LGTM Studio.** Whether LGTM Studio reads the model selection
  list from a file or the owner copies choices into settings is open.

## Changes this design made to the repository's rules

The owner approved these changes to AGENTS.md on 2026-11-05, and they are in
place:

- Rule 6 allows one default workflow in this repository.
- Rule 7 limits agents to the git commands LGTM Studio allows.
- Rule 7 lets a fix sprint that users would not notice merge on its own after a
  full test run passes. Anything users would notice keeps the owner's approval.

## The steps in each phase

Each line below is one move: the state the work is in, an arrow, the next state,
and then the action or answer that causes the move. `[OWNER]` marks a step the
owner takes. `[OWNER IF NEEDED]` marks a step that reaches the owner only when
necessary.

### 1 Define

- V0 exists -> Config file?: LGTM Studio looks for the file
- Config file? -> Project set up: yes
- Project set up -> Change described: Say what to change [OWNER]
- Change described -> Mockups made if screens change: Make mockups
- Mockups made if screens change -> End-result page written: Write the page
  (HTML)
- End-result page written -> Page read: Read page, open mockups [OWNER]
- Page read -> Build this?
- Build this? -> 2 Design and teams: yes
- Config file? -> Project read: no: read V0, what it was made in
- Project read -> Project explained: Hear languages, architecture [OWNER]
- Project explained -> Direction set: Say direction, changes [OWNER]
- Direction set -> Want tests?: Talk testing, pros, cons [OWNER]
- Want tests? -> Test commands ready: yes: write test scripts, plugins
- Test commands ready -> Config file written: Write config
- Want tests? -> Agent review?: no
- Tests wanted later -> Direction set: Say: turn tests on [OWNER]
- Agent review? -> Config file written: yes
- Agent review? -> Config file written: no
- Config file written -> Project set up: config saved
- Build this? -> Change described: no: say what to change again [OWNER]

Setup runs before the first change, because the direction the owner gives can
change what that change should be. The setup agent starts already knowing what
V0 is and what it was made in. It tells the owner what is there now, such as
the languages and the architecture, and the owner says the general direction
for the project and whether anything should change. Testing is one of the
things it covers, and it explains the pros and cons of testing and says
whether it is needed at this stage.

An architecture change is not made during setup. It goes through this loop
like any change, starting from Say what to change.

The result is a local .lgtm folder with a config file, similar to .claude,
holding the project's settings, including the direction, how testing runs and
the paths to use. When the file exists, setup is skipped.

If things start going wrong later, the owner tells their main agent to turn
tests on, and setup picks up at the testing talk.

Testing off does not mean checks are skipped: the steps that would run tests
use an agent review instead. If agent review is off too, those steps are
skipped. 6 Review always runs in this workflow.

This chart is the default workflow. It will become a parsable list of steps,
and anyone wanting something else, such as skipping phase 6, writes their own
local workflow under ~/.lgtm.

### 2 Design and teams

- Change approved -> Tests on?
- Tests on? -> Valid checkpoint?: yes: LGTM Studio looks for full-run report
- Valid checkpoint? -> Code read: yes: read page and code
- Valid checkpoint? -> Full run passes?: no: full run
- Full run passes? -> Fix sprint added: no: add a fix sprint
- Code read -> Findings reconciled: Orchestrator reconciles
- Findings reconciled -> Split by domain: Split into database, server, mobile
- Split by domain -> Sized in points: Size; split what's over a lead's cap
- Sized in points -> Teams decided: Decide sprints, how many teams [OWNER IF
  NEEDED]
- Teams decided -> Tests on?
- Tests on? -> User-flow tests written: yes: write from page, mockups
- User-flow tests written -> Teams started: List teams in LGTM Studio, send each
  its plan
- Teams started -> 3 Plan
- Tests on? -> Code read: no
- Fix sprint added -> Code read: it runs first
- Full run passes? -> Code read: yes
- Tests on? -> Teams started: no

Before any planning, LGTM Studio looks up the report for the commit the sprint
starts from. Reports live in the LGTM Studio workspace, findable by commit. LGTM Studio
keeps the report for what is on dev and every report beyond it, including
local work and branches. Once work merges into dev and the full run happens,
it keeps only that one report for dev, because that run includes all the
earlier tests. Dev's report is replaced only when the new run fully passes. A
valid checkpoint is a commit that has had a full run, so it can be trusted as
a starting point. A commit that already has one does not run again. If
something fails later it gets fixed.

A sprint starts only from a valid checkpoint. A full run that fails adds a fix
sprint ahead of the planned one. The fix sprint goes through every phase
without this check, because its job is to make the failing commit good. It
runs on its own: unless users would see a change, Hand over merges it with a
full run and comes straight back here, without the owner and without a deploy.
The planned sprint then starts from a valid checkpoint.

Every team starts from that same commit.

### 3 Plan

- Teams started -> Plan read: Read the plan
- Plan read -> Subitems split: Split it
- Subitems split -> Plan written: Write each plan
- Plan written -> Question sets picked: Pick by domain
- Question sets picked -> Plan reviewed: Review each plan
- Plan reviewed -> Blocker?
- Blocker? -> Report clean?: no
- Report clean? -> Plans compared: yes, or minors past round 3: compare
- Plans compared -> Plans work together?
- Plans work together? -> 4 Build: yes
- Blocker? -> Subitems split: yes: back to the planner lead
- Report clean? -> Plan written: no: next round
- Plans work together? -> Plan written: no: planner agents fix

After every review, a script scores each statement. The reviewer's form picks
the statement each problem comes from, from a numbered list of the end-result
page, the plan and what the owner said. Duplicates are merged first. A minor
is 1 point, a major 3 and a blocker 9. A statement is stuck, which stops that
plan and pings the owner, in either of two cases: in one round it has at least
12 points and at least 30% of that round's points, or it has drawn a major or
a blocker in 3 rounds of the plan. The script keeps the running tally across
rounds, and a statement keeps its number when the plan is rewritten. Several
stuck statements go out in one ping. The owner's answer resets that
statement's count. The end result is what matters, and everything on the way
to it can change. Statements can contradict each other, and a requirement
causing trouble may matter less than it seemed. Agents bring it to the owner
and never drop it themselves. The owner's answer goes into the plan so later
reviews stop raising it.

Everything up to Report clean? runs per team, under the planner lead.
Comparing plans is the orchestrator's, and it runs once across all teams,
because no single lead can see every team's plans.

The planner lead picks the question sets. The planner agents that wrote the
plan do not pick them. The same planner agents that wrote a plan fix it,
because they already know what they wrote.

#### Block: Write each plan

- Subitems split -> Code read: Read the code
- Code read -> Question answered: Answer next, with citations [OWNER IF
  NEEDED]
- Question answered -> Answered enough?: Judge own answer
- Answered enough? -> All answered?: yes
- All answered? -> Citations real?: yes: script checks
- Citations real? -> Plan written: yes
- Answered enough? -> Code read: no: read more
- All answered? -> Code read: no: next question
- Citations real? -> Code read: no: fix the citation

#### Block: Review each plan

- Sets picked -> Question answered: Answer next question
- Question answered -> Blocker?
- Blocker? -> Answer logged: no: log any problem
- Answer logged -> All answered?
- All answered? -> Statement stuck?: yes: script scores
- Statement stuck? -> Statement settled: yes: ping the owner; keep, change or
  drop it [OWNER]
- Statement settled -> Plan reviewed: Write it in the plan
- Blocker? -> Blocker raised: yes
- Statement stuck? -> Plan reviewed: no
- All answered? -> Question answered: no: next question

#### Block: Next round

- Scope changed -> Full review: the owner changes it: count restarts [OWNER]
- Report not clean -> All folded: Fold everything
- All folded -> Round 3 done?: Script counts
- Round 3 done? -> Full review: no
- Round 3 done? -> Round 4 done?: yes
- Round 4 done? -> Blockers, majors review: no
- Round 4 done? -> Round 6 done?: yes
- Round 6 done? -> Approve next round?: no: ping the owner, says why [OWNER]
- Approve next round? -> Blockers, majors review: yes [OWNER]
- Approve next round? -> Plan cut, split or accepted: no [OWNER]
- Plan cut, split or accepted -> Plans compared
- Round 6 done? -> Plan cut, split or accepted: yes: ping the owner [OWNER]

Every finding gets folded in every round, minors included. Past round 3
another review runs only for blockers and majors, and the reviewers are told
to look only for those. Past round 4, each further round pings the owner with
why it is needed and waits for their approval. From round 6 on this repeats
with no hard limit, until the owner says to stop and go on with the work.
A minor folded in the last round has no review after it, so it is marked in
the plan and left for the later checks. When the owner changes a plan's scope,
the count restarts for the changed part, which gets a full review. 6 Review
uses the same round count.

### 4 Build

- Plans agreed -> Tests on?
- Tests on? -> All teams merged: no: build without tests
- All teams merged -> 5 Verify
- Tests on? -> Plans read: yes: read the plans
- Plans read -> Subitems assigned: Assign up to its cap
- Subitems assigned -> Configs built: Script builds configs
- Configs built -> Subitems building: Start builders, send configs
- Subitems building -> Subitems built: Build subitems
- Subitems building -> 3 Plan: plan wrong
- Subitems built -> Passing report?: LGTM Studio merge looks up commit
- Passing report? -> Temp merge made: yes: temp merge; lead fixes conflicts
- Temp merge made -> All pass?: Run all merged workers' tests
- All pass? -> Subitems merged: yes: lead's branch moves
- Subitems merged -> More subitems?
- More subitems? -> Subitems assigned: yes: assign next
- More subitems? -> All teams merged: no: orchestrator merges teams
- All teams merged -> 5 Verify
- Passing report? -> Subitems building: no: run the check
- All pass? -> Subitems building: no: drop temp, tell newest worker

The build lead assigns subitems in the order they depend on each other, with
one writer per set of files and no more points at once than its cap. It also
picks which subitems count as risky.

The build lead names each subitem's domain. A script turns that into the
builder's config: the domain's checks from init plus the always-on guards. The
lead can add tests but cannot remove any.

Tests can be labelled risky and given a domain, so the right ones load. A
sign-in change loads the risky sign-in tests, such as a real sign-in through a
browser.

Build subitems runs per subitem, and the failure decisions live inside it.
Plan wrong is the only failure that leaves Build.

The build lead merges with an LGTM Studio command. Before merging, LGTM Studio looks for
a passing report for that exact commit. With one, it merges into a temporary
branch and the build lead fixes any conflicts. Without one, it refuses and
says to run the check. The temporary merge runs the tests of every worker
merged so far, so earlier work is tested with the new work. The lead's branch
moves only on a pass. On a failure the temporary branch is dropped and the
newest worker gets the report. The full suite waits for 5 Verify. LGTM Studio
limits which git commands builders and leads can run, so they merge through
its command.

#### Block: Build subitems

- Building -> Tests and stubs written: Write stubs, tests: unit, integration,
  behavior
- Tests and stubs written -> Fail on the assertion?: Script runs them
- Fail on the assertion? -> Tests match the page?: yes: check tests against
  page
- Tests match the page? -> Tests approved: yes
- Tests approved -> Code written: Write code, edit old work, narrow runs
  [OWNER IF NEEDED]
- Code written -> Code committed: Commit; tell build lead: done
- Code committed -> Checks pass?: Build lead calls lgtm check; test runner
  runs builder's config
- Checks pass? -> Risky tests?: yes: script finds risky labels
- Risky tests? -> Code broken on temp: yes: break it on a temp branch
- Code broken on temp -> Tests go red?: Script runs risky tests
- Tests go red? -> Subitem built: yes
- Checks pass? -> Type of failure?: no: report to builder, notice to lead
- Type of failure? -> 3 Plan: plan: tell lead
- Fail on the assertion? -> Building: no: fix the test
- Tests match the page? -> Building: no: rewrite
- Tests go red? -> Building: no: tests too weak
- Risky tests? -> Subitem built: no
- Type of failure? -> Building: test: tell lead
- Type of failure? -> Tests approved: code: tell lead

Each subitem runs through this block on its own, at the same time as the
others, up to the build lead's cap.

Stubs carry only names, inputs and outputs, and return false or the empty
value for that type. Test data is built from the real schema, not by hand. The
build init agent never writes the code.

The script requires each test to fail on its assertion. A crash or a bad
import does not count.

The review agent reads the tests against the end-result page before any code
exists, because these tests are the build agent's spec.

The frozen-test script fails if the build agent changed a test, and it fails
if it has nothing to compare.

While it works, the build agent asks the test runner agent directly for narrow
runs, using the commands LGTM Studio's init set up. A busy test runner agent leaves
the request waiting. The orchestrator is not involved.

When done, the build agent commits locally and tells the build lead. The build
lead calls the LGTM Studio check command. LGTM Studio finds that builder's config, which
the build lead made when starting it, and runs that fixed list, including
tests, guards and the frozen-test script, against that commit. Uncommitted
code cannot be checked.

The test runner agent runs the tests, then fills in a report form from a
LGTM Studio template, naming the commit and the builder. Any test tool works,
because the agent only needs the tool's result to fill in the form. It traces
what broke and does not diagnose. LGTM Studio's engine wakes the builder with the
report.

Before 5 Verify, checks run only the specific tests in the builder's config.
The full suite runs only in 5 Verify, and failures there go to the fixing
path.

Red marks what AI must not control. Which other steps go red is open, and so
is a test index for choosing narrow runs.

When checks fail, the report goes to the build agent, with a notice to the
build lead so it knows. The build agent decides the type of failure, states it
in its notice to the lead, and can ask the lead for more help. Code goes back
to Tests approved, so the build agent writes it again. Test goes back to
Building, and only the build init agent changes tests. Plan goes to 3 Plan.

Tests can be labelled risky and given a domain. A script finds the ones that
apply by domain and by the files changed. A subitem with none goes straight to
built. Otherwise a review agent breaks the code on a temporary branch, the
script runs those tests, and they must go red. The report names each one,
which is the evidence, and the temporary branch is dropped, so the broken code
cannot ship. A test that stays green goes back to the build init agent.

#### Block: Build without tests

- Tests off -> Plans read: Read the plans
- Plans read -> Subitems assigned: Assign up to its cap
- Subitems assigned -> Code written: Write code
- Code written -> Agent review on?
- Agent review on? -> Subitems merged: no: merge, fix conflicts
- Agent review on? -> Looks good?: yes: review the code
- Subitems merged -> More subitems?
- More subitems? -> All teams merged: no: orchestrator merges teams
- Looks good? -> Subitems merged: yes: merge
- Looks good? -> Code written: no: fix
- More subitems? -> Subitems assigned: yes: assign next

With tests off, nothing in the build runs or checks tests, so there are no
configs, reports or temporary merges. An agent review takes the place of the
checks. If agent review is off too, code merges without it.

#### Block: Fix team

- Failure report -> Report read: Read the report
- Report read -> Fix team started: Set up a fix team
- Fix team started -> Fixes built: Build subitems
- Fixes built -> Passing report?: LGTM Studio merge: looks up commit
- Passing report? -> 5 Verify: yes: merge
- Passing report? -> Fix team started: no: run the check

A build team set up only to fix what the failure report lists. Each fix runs
through Build subitems, so tests stay frozen for the fix team, and a failure
with no test gets one written first. With tests off, fixes run through Build
without tests.

### 5 Verify

- Teams merged -> Tests on?
- Tests on? -> Install smoke-tested: yes: install, walk main flow
- Install smoke-tested -> Full suite run: Run every test type
- Full suite run -> User flows run: Run flows: web, phone size, Mac simulator
  [OWNER IF NEEDED]
- User flows run -> Evidence checked: Check text, screenshots, report
- Evidence checked -> All pass?
- All pass? -> 6 Review: yes
- Tests on? -> Agent review on?: no
- Agent review on? -> 6 Review: no
- Agent review on? -> Product checked: yes: open it, check against the page
- Product checked -> Looks good?
- Looks good? -> 6 Review: yes
- All pass? -> Failure report written: no: write report
- Fixes merged -> Failed, related tests run: Script picks failed, related
- Failed, related tests run -> Evidence checked: Check evidence
- Looks good? -> Failure report written: no
- Failure report written -> 4 Build: fix team

When anything fails, an evaluation agent writes a report and hands it to a fix
team in 4 Build. The work then comes back here, and only the failed tests and
anything related run again. A server fix runs the failed test and other server
tests, with no simulator or phone. A script picks them.

With tests off, an agent review opens the product and checks it against the
end-result page, and decides whether it is good. If agent review is off too,
this phase is skipped.

### 6 Review

- Verified -> Changes listed: List changes, who uses them
- Changes listed -> Slices reviewed: Review slices, main flows
- Slices reviewed -> Findings verified: Attack code, verify findings
- Findings verified -> Severity settled: Settle severity
- Severity settled -> Findings sorted: Sort findings [OWNER IF NEEDED]
- Findings sorted -> Statement stuck?: Script scores
- Statement stuck? -> All closed?: no
- Statement stuck? -> Statement settled: yes: ping the owner; keep, change or
  drop it [OWNER]
- All closed? -> 7 Hand over: yes
- Statement settled -> All closed?: write it down
- All closed? -> Slices reviewed: no: fix, re-verify

The same two cases run here across fix rounds, using the settled risk score
for points: under 150 is 1 point, 150 to 399 is 3 and 400 or more is 9. Only
problems tied to a statement count, so a cluster of ordinary bugs in one file
gets fixed without a ping.

### 7 Hand over

- Review closed -> Work merged: Merge; full run if none yet; write finished
  page
- Work merged -> Fix users can't see?
- Product tried -> Device checked: Check on a real device [OWNER IF NEEDED]
- Device checked -> Approve release?
- Approve release? -> Deployed: yes: approve deploy [OWNER]
- Deployed -> Live product tested: Test the live product
- Live product tested -> Evaluation round run: Grade each task, update the
  model ledger
- Evaluation round run -> More sprints?
- More sprints? -> 2 Design and teams: yes
- More sprints? -> 8 Keep running: no
- Approve release? -> 4 Build or 1 Define: no: ask for a change [OWNER]
- Fix users can't see? -> Product tried: no: try the product [OWNER]
- Fix users can't see? -> 2 Design and teams: yes: no deploy, next sprint

Fix sprints run on their own. A fix that users would notice comes to the owner
like any other work.

The evaluation round also runs after each sprint merges in 4 Build. It does not
hold up the next sprint. "Evaluation rounds and the model ledger" above has the
detail.

### 8 Keep running

- Released -> Tests on?
- Tests on? -> Next change: no: tests off
- Tests on? -> Nightly run done: yes: full run if code changed
- Nightly run done -> Skipped tests checked: Check skipped tests
- Skipped tests checked -> Failures explained: Explain what failed and why
  [OWNER IF NEEDED]
- Failures explained -> Lessons in skills: Write lessons into skills, grades into the
  model ledger
- Lessons in skills -> Owner told: Send owner a one-line summary [OWNER]
- Owner told -> Bug?
- Bug? -> 4 Build: yes
- Bug? -> Nightly run done: no: wait for next night

The nightly run skips only when the code has not changed since its last run. A
commit that had a full run in an earlier phase still gets its nightly run.

### Test types

The plan's Done when section names each test and its type.

- Unit: one function on its own. Written before the code in 4 Build.
- Integration: parts working together, such as code and a real database.
  Written before the code in 4 Build.
- Behavior: one thing the end-result page promises. Written before the code in
  4 Build.
- Smoke: the product installs and the main flow runs. Run in 5 Verify.
- User flow: a real person's path through the merged product. Written in 2
  Design and teams from the end-result page and mockups, before any plan or
  code, so a wrong plan can't shape it. It stays red until 5 Verify runs it on
  the merged work.
- Full suite: every type, old and new, in 5 Verify.

### Moves between phases

- Build to Plan: plan wrong.
- Verify to Build: failure report.
- Review to Verify: fix, re-verify.
- Review to Plan: design wrong.
- Hand over to Design and teams: next sprint.
- Hand over to Build: small change [OWNER].
- Hand over to Define: big change [OWNER].
- Keep running to Build: nightly bug.
- Keep running to Define: next change [OWNER].
