# From today's LGcode to the build loop: what was found and the plan

The owner asked for this document on 2026-11-10. It has two halves. The first half is the
investigation of what the owner asked LGcode to be, what was built, and what is missing.
The second half is the plan to change the engine and the website until the product does
what the owner wants.

This is a plan. Nothing in the second half is built.

## The short version

The owner wants to describe a project to one agent, settle the deliverables with it over
a few rounds, and then be left alone until an agent needs an answer. LGcode today has the
parts underneath that: an engine that runs agents, a message board, requests, phone
alerts, and a website. It has none of the loop itself. No code moves a project from one
phase to the next.

The plan builds the loop as a thin path through all eight phases first, and then makes
each phase deeper. The website is brought up to the mock on the same path, one surface at
a time, as the loop needs it.

## Part one: the investigation

### How the investigation was done

An agent read the four reports in `docs/sessions/` and the two earliest files in
`.session-reports/` in full. It skimmed the other 17 session reports, which all cover the
website build of 2026-11-09 and 2026-11-10. It read `README.md` and the build loop design
in full, and it searched the source under `packages/`. No session report exists from
before 2026-11-01. The decisions of 2026-10-30 survive only inside the specs.

The claims below about the source come from that search on `master` at commit `55e1bbd`.
Nobody ran the product to confirm them.

### What the owner asked for at the start

From 2026-10-30 to 2026-11-01 the product was infrastructure. It had four pieces: the
engine, the client API, the message board and the foundry roles. The roadmap's goal was
to "set up and steer teams of coding agents from a phone". Workflows were kept out of the
repository on purpose.

### When the idea became the build loop

The owner and an agent drew the build loop on 2026-11-04 and 2026-11-05. The design is
`docs/specs/2026-11-05-build-loop-design.md`. The owner's goal there is: "remove me as
much as we can so that I just talk to an agent about what I want to build". The first
version of a product, called V0, is made outside the loop. On 2026-11-07 the OpenPencil
design file became the source of truth for design.

The idea changed five days into the build. The build did not change direction with it.

### What the owner wants, as stated on 2026-11-10

1. The owner builds only V0 of a product by hand.
2. From V1 onward, the owner works with one agent. That agent starts a project and its
   worktree.
3. The owner and the agent go through several rounds until the deliverables are clear.
4. When the work touches screens, design work and mocks happen first.
5. When a V0 is imported, its current design is imported into OpenPencil with the owner.
6. The autonomous workflow then takes over. It contacts the owner only for a question, an
   approval, or a requirement that turned out to be wrong.
7. Mistakes are expected. They are written down and learned from.
8. At the end of each key task and each project, an evaluation round runs and the model
   ledger is updated. The aim is to learn which model suits which kind of task.

### What was built that does not fit

| What was built | Why it does not fit | Evidence |
|---|---|---|
| Sealed evidence, hashes and receipts for each change | The owner wants small changes to be quick | The website run recorded "782 sealed artifacts". The owner said: "It cannot be taking this fricking long, especially for small changes." |
| Very large review rounds | Reviews found more than the build could absorb | Three foundation reviews produced 188, 794 and 179 raw findings. `docs/issues.md` has about 553 entries. |
| Hardening before the product | The owner deferred security | Redaction and receipts take hundreds of lines of the issues list. The engine has 208 source files and 377 test files. |
| Engine support for the old mock's data | The owner ruled that only the visible screens are the target | The owner stripped this on 2026-11-09. |
| Stall watching, alert carriers, accounts and recovery | They were built before any phase of the loop | No workflow code exists in the source. |
| Invented names for project leads | The owner wants role names | `packages/engine/src/project/lifecycle.ts:21`, recorded as issue 613. |
| A website with weak components | The owner said the page "sucks so bad" | Issue 612 lists the faults. |

### What the idea needs that is missing

| Piece of the idea | State today | Evidence |
|---|---|---|
| Import an existing V0 | Partly built | The commands `project.repository.add` and `project.create` register a repository and start a lead. No agent reads the V0 and describes it. |
| Import the V0's design into OpenPencil | Partly built | The `skills/reverse-fig/` skill covers tokens and components. It does not cover screens. The engine starts OpenPencil but cannot save into the repository. |
| Rounds that settle the deliverables | Missing | No setup agent and no end-result page exist. `README.md` calls loading `.lgcode` "the next piece of work". |
| The loop running from start to end | Missing | No workflow code exists. A person or a lead sets each sprint, task and stage by hand. |
| Contacting the owner | The transport is built | Requests, the Home inbox and phone alerts work. The loop's own reasons to ask, such as a stuck statement, have no code. |
| Writing down mistakes and lessons | Missing in the product | It exists only as an agent habit in reports and in `docs/issues.md`. |
| Evaluation rounds and the model ledger | Missing in the product | The owner runs evaluations by hand. The ledger is `model-ledger/` in the Founder OS repository. |
| Choosing a model for each kind of task | Missing | The build loop design set it aside on 2026-11-05. The design gained a section for it on 2026-11-10. |
| Roles units 3, 4 and 11a, and the sandbox | Not built | `AGENTS.md` says so. |

## Part two: the plan

### The rules this plan is built under

These rules exist to stop the ceremony described in part one. All but two come from the
owner's earlier decisions. The two marked "proposed" are this plan's suggestions, and the
owner has not ruled on them.

- A commit hash is the identity of a piece of work. There are no manifests, receipts or
  sealed evidence.
- Proposed: a piece of work has one review, and a second only when the first found a
  blocker.
- Security faults are written to the running list and do not block the build.
- A later step edits earlier code directly. Nobody adds a layer to avoid touching it.
- The visible screens of the mock are the target. The mock's data shapes are not.
- Full test runs go to the remote test machine. A change to stored events runs
  `pnpm live-check` before it merges.
- Proposed: every step ends with something the owner can do in the browser.

### The shape of the plan: a thin path first

The build so far went deep on one layer at a time, and the loop never appeared. This plan
goes the other way. Step 2 makes the thinnest possible path through all eight phases,
with one team and almost no options. Each later step deepens one phase of a loop that
already runs.

The website follows the same path. A surface is rebuilt when a step needs it, against the
second round of the mock.

### Step 0: the second round of the mock

The mock gets the owner's walkthrough feedback applied. The brief is
`design/mock/ROUND-2-BRIEF.md`. This step runs beside steps 1 and 2 and does not block
them.

Finished when: the owner has looked at the second round and approved the daily surfaces,
which are Home, the sidebar, the board and Chat.

The second round was built on 2026-11-10 and 2026-11-11. It awaits the owner's approval.

### Step 1: clear the ground

This step is small. It removes the things that would mislead every later step.

Engine:

- Name every agent by its role. Remove the list of names at
  `packages/engine/src/project/lifecycle.ts:21`. This changes stored events, so
  `pnpm live-check` runs before the merge.
- Add a workflow piece, at `packages/engine/src/workflow/`. It holds one record for each
  project: the current phase, and the moves between phases that the design lists. It has
  no behaviour yet beyond recording a move.
- Load the `.lgcode` folder of a repository and `~/.lgcode`. `README.md` already names
  this as the next piece of work.

Website:

- Fix the thread view, so it shows role, time and readable text in place of raw engine
  data.
- Replace the permanent phone notification strip with one line that can be dismissed.
- Rename the sidebar heading to "Repositories".

Finished when: a new project's lead is called "Project lead" in the browser, and the
project's Workflow tab shows the phase the engine holds.

### Step 2: a project runs through all eight phases, thinly

This is the step that makes the loop exist. Each phase does the least that still counts.

This step was updated on 2026-11-11, after the second round of the mock and the changes
the owner made to it afterwards. The mock is on the branch `area/mock-rebuild`, up to
commit `036b0da`. Its result is recorded in
`design/mock/feedback/2026-11-10-round-2-result.md`. Each website item below names the
mock address that is its reference. The addresses follow `#` in the mock.

#### What each phase does in this step

| Phase | The least it does in this step |
|---|---|
| 1 Define | The owner types a goal. The lead asks its questions, names the project, and writes the end-result page as numbered statements. The owner approves the page. |
| 2 Design and teams | The lead starts one build team. Design work is skipped unless the owner asks. |
| 3 Plan | The lead writes one plan for each sprint, as an HTML page with a "Done when" section. Each task links to the part of the plan it carries out. One reviewer reads the plan once. |
| 4 Build | Builders work the tasks in the team's worktree. The lead merges with the engine's merge command after a passing check. |
| 5 Verify | The project's configured test command runs. A failure goes back to the build team. |
| 6 Review | One reviewer checks the work against the end-result page. Findings go back to the build team. |
| 7 Hand over | The lead opens a merge request into the base branch. The owner approves it or sends it back with a reason. |
| 8 Keep running | Nothing yet. The project is marked finished. |

#### Engine work

- **The moves between phases.** The workflow piece gains the moves for each phase, as
  commands and as agent tools, so a lead moves its own project forward.
- **A project from a goal.** A project is created from a goal alone. It has no name until
  the lead sets one with a tool. The website shows "Naming…" until then.
- **The end-result page.** It becomes a stored record with numbered statements. A
  "Request change" command sends the owner's change to the lead.
- **A request carries its own brief.** A question or an approval stores a short brief, one
  line of description, a recommendation, the other answers, and its references. The
  agent that asks writes them. The mock's cards are drawn from these fields.
- **An approval answers with Allow or Deny.** The mock also shows "Always allow" and
  "Always deny" in a menu on each button. Those two wait for the standing permission
  rules, which are not built. Step 2 stores only Allow and Deny.
- **A merge request carries its evidence.** It stores a brief, whether users will notice
  the change, and four facts: the tests, the review, the size of the change, and whether
  it merges cleanly into the base branch. "Send back" stores the owner's reason and
  passes it to the lead.
- **A sprint carries its plan.** The plan is an HTML page stored with the sprint. A task
  stores a link to one part of that plan. A sprint also stores a one-line summary, which
  the mock labels "TL;DR".
- **The board's Backlog lane.** A sprint gains the status "Backlog".
- **A test run keeps its log.** A run stores its jobs, their steps and each step's log, so
  the page can show them. The command comes from the project's configuration.
- **The loop's reasons to contact the owner.** In this step there are three: a question
  from the lead during Define, the approval of the end-result page, and the merge
  request.
- **Records for the evaluation round.** Each task result names the role, the model, the
  effort and the session. This is the cheap part of step 7, and it starts here.

#### Website work

Each surface is rebuilt against the mock. A surface that the thin path does not use is
left alone until its own step.

| Surface | What changes | Mock address |
|---|---|---|
| Home | One table of everything that waits for the owner, with the columns Title, Type, Repository, Project, Stage, Agent and Waiting. Headings sort. Type, Repository and Project filter. "Show answered" adds the answered rows. The longest wait is first. | `/home` |
| Home, an expanded row | A question or an approval opens as its brief, with Accept or Allow, Deny, and Details. A merge request opens as its brief, the "Users will notice" line, and one strip of Tests, Review, Changes and Into main. | `/home` |
| Phone notification offer | One line on the title row, with "Set up" and "Not now". | `/home` |
| Sidebar | The heading is "Repositories". One click opens a row. The arrow or a double click folds it. A button beside the heading opens the projects table. | every page, and `/projects` |
| New project | One "Goal" field. The subscriptions are a table with Harness, Subscription, Machine and Models. The project shows as "Naming…" until the lead names it. | the "+" beside "Repositories", and `/setup` |
| Chat | The owner's messages are on the right, and the agent's are on the left. A question is a card that shows its brief first. "Details" opens the full card in place. The recommended action carries the sparkles icon. | `/p/console/chat` |
| Chat, another agent | "Open thread" opens the asking agent's thread in the side panel, with that agent's name in the header and a "Back to the project lead" button. Only the project lead has a message box. Another agent's thread is read-only unless that agent has an open question. | `/p/console/chat` |
| Board | Fixed-width lanes that scroll sideways, with a Backlog lane. Opening the lead panel does not change a card's size. An empty project shows its lanes with no cards. A focus button hides everything but the board, and Escape leaves it. Hovering a card shows the sprint's summary. | `/p/console/board` |
| Sprint page | The plan and the tasks sit side by side, each with its own toggle. A task's link scrolls the plan to its part. | `/p/console/sprint/sp7` |
| Workflow | A small status line in place of a title. The phase track. Each phase's detail in five labelled parts. Agents grouped as Waiting, Working and Idle. | `/p/console/workflow` |
| Test runs | A run list on the left. The selected run shows its jobs, steps and log. "Start full run" names no command. | `/p/console/workflow/runs` |
| End result | A status line with a progress bar, the numbered statements, and a "Request change" button. | `/p/apiref/workflow/result` |
| Merge review | The same evidence strip as the Home row, with "Approve and merge" and "Send back". | opened from a merge row on `/home` |

#### What the mock shows that waits for a later step

| In the mock | Waits for | Why it waits |
|---|---|---|
| Epics, the Priority field, and the board's Table and Roadmap views | Step 4 | The thin path has one team and one sprint at a time. |
| The work assignment table, and the lead's model and effort in Project settings | Step 4 | The thin path uses the owner's default harness and model. |
| The Mocks tab and its approval | Step 4 | The thin path skips design work. |
| The repository Design page and its canvas | Step 3 | It needs the design import and the approved categories. |
| The repository's running product description | Step 3 | It needs the agent that reads a V0. |
| Files and images sent with a message | Step 3 | The deliverables rounds are where the owner will most want to send a screenshot. |
| "Always allow" and "Always deny" | The standing permission rules | The rules are not built. |
| Generated commit messages and pull request text | Step 6 | A lead writes its own message until then. |
| Review rounds with scoring | Steps 4 and 6 | The thin path has one review with no rounds. |
| Search that ranks by meaning | Step 8 | The current search keeps working. |
| The Files tab | No step yet | The mock marks it "coming soon", and `docs/features.md` lists it. |

#### What the owner ruled on 2026-11-11

The mock's result file lists 12 choices. The owner ruled on the two that shape this step.

**Where a question shows.** The owner said that the place does not matter, and that a
question shows in three places.

1. In the table on Home.
2. In the project lead's thread.
3. In the thread of the agent that asked. The owner leaned towards letting a worker's
   thread show its own question too, with the answer given right there.

An answer given in any of the three places has the same effect. It is posted to the
message board for the agent that asked. When the owner wants to talk a question over, the
conversation is with the lead of the team that asked, and that lead does the rest. So
"Open thread" on a worker's question opens its team lead's thread.

**How a project gets its name.** A new project's name comes from its goal. The lead sets
a first name as soon as it knows a little about the project. When the lead starts the
first team, it renames the project if the work has moved far from that name. After that,
a lead renames a project when the owner asks, or when the project has moved far from what
its name says.

The engine work for this step gains two items from these rulings. An answer to a question
is posted to the message board whichever screen it came from. The lead's naming tool can
be called again, and the engine records each rename.

The owner has not ruled on the other ten choices in the result file.

#### When this step is finished

The owner ruled on 2026-11-11 that the first real project is LGcode itself. The owner
types a goal for a real change to LGcode, answers the lead's
questions, approves the end-result page, and next hears from LGcode when the merge request
is ready. The first such run is recorded in a session report, with every place a person
had to step in.

### Step 3: Define and import, in full

This step delivers items 2, 3 and 5 of what the owner wants.

- **Rounds that settle the deliverables.** Define becomes the conversation in the design's
  "Project setup is a conversation" section. The lead proposes, the owner corrects, and
  each round updates the end-result page. The page records what changed in each round.
- **Importing a V0.** When a repository is added, an agent reads it and writes a running
  product description. The lead keeps that description current as projects finish. The
  repository page shows it.
- **Importing the design.** The Reverse Fig skill is extended from tokens and components
  to screens. The engine learns to save the OpenPencil file into the repository. The
  import is a conversation with the owner, because the owner must confirm what each screen
  is.
- **The design file's categories.** The owner wants a design lead to define how a design
  file is stored and sorted into categories. The owner calls this "Apple Hat". It is an
  agent launched with instructions to think like a senior user interface and user
  experience lead from Apple. The second round of the mock asks such an agent for a first
  proposal. The owner approves the standard before the repository Design page is built on
  real data.
- **Setup's config.** Define writes the `.lgcode` config. The design leaves open who
  writes it, because agents cannot edit that folder. This plan suggests that the engine
  writes it from a tool call that the owner approves.

Finished when: the owner adds an existing repository, reads a correct description of it,
sees its screens in the Design page, and settles a project's deliverables in the browser.

### Step 4: Design, teams and Plan, in full

- Stage-named teams start from the workflow: Design, Planning, Build and Review.
- When the work touches screens, the Design team makes mocks, and the owner approves them
  in the Mocks tab before Plan starts.
- User flow tests are written in this phase from the end-result page, as the design says.
- Plan gains its rounds: write each plan, review each plan, compare the plans, and score
  the findings with a script. The points are 1 for a minor finding, 3 for a major one and
  9 for a blocker.
- A stuck statement contacts the owner with keep, change or drop.
- The lead proposes the assignment table, which says which harness, model and effort does
  each kind of work. The owner approves or changes it.

Finished when: a project that changes a screen stops for the owner at the mocks and at
nothing else before Build, unless a statement is stuck.

### Step 5: Build and Verify, in full

- Tests are written first and must fail, as the design says.
- The merge command refuses a commit with no passing report, and it tests a temporary
  merge before the lead's branch moves.
- Fix sprints run on their own. A fix that users would not notice merges after a passing
  full run.
- Verify runs every test type, then the user flows on the merged work.
- The Test runs page shows status and logs in the style of GitHub Actions. The owner does
  not operate a test runner.
- The sandbox for agents is built here, because this is the step where agents run the
  most code unattended.

Finished when: a project with two build teams merges its work without the owner, and a
failing test produces a fix sprint that the owner only reads about.

### Step 6: Review and Hand over, in full

- Review gains its rounds, with a limit of six, and the scoring that decides when a
  statement is stuck.
- Hand over writes the finished page, opens the pull request, and asks for the release
  approval.
- The commit message and the pull request title and description are written by a cheap
  model that the owner picks in settings.
- The three additions the owner asked for on 2026-11-06 are designed and built here: the
  hotfix lane, the way to bisect, and the way to freeze interfaces.

Finished when: the owner's part in a whole project is the goal, the deliverables rounds,
any mocks, and the final approval.

### Step 7: evaluation rounds, lessons and model choice

This step delivers items 7 and 8 of what the owner wants. Its design is the section
"Evaluation rounds and the model ledger" in the build loop design.

- Every task result names the role, the model, the effort and the session. Every review
  result carries a grade.
- An evaluation round runs when a sprint merges and when a project is handed over. It
  never holds up the next sprint.
- The round writes a run file in the format of the model ledger.
- A lesson about the work goes into the skills. A lesson about a model goes into the
  ledger.
- The engine reads the model selection list when it starts an agent. The assignment table
  from step 4 shows where a choice came from.
- The Workflow tab gains an "Evaluation" view, with the grades of the last round and any
  proposed change of model.

The record keeping in the first bullet is cheap, so it starts in step 2. The rest waits
until there are finished projects to evaluate.

Finished when: a finished project produces a ledger file without the owner starting
anything, and the next project's assignment table reflects it.

### Step 8: Keep running, and the search

- The nightly run, the check on skipped tests, and the one-line summary to the owner.
- A nightly job that refreshes the list of models each harness offers.
- Search over goals, descriptions and agent names with a small local embedding model, so
  a loose question finds the right project.

### What to stop doing, starting now

The owner has already ruled on the first item. The other four are this plan's
suggestions.

1. Stop sealing, hashing and writing receipts for changes.
2. Stop running three large reviews of one piece of work. One review becomes the rule.
3. Stop fixing review findings that no statement on an end-result page depends on. Record
   them and move on.
4. Stop building engine support for a screen before a step needs that screen.
5. Stop adding hardening that no step asks for. The security list keeps the debt visible.

The 20 unchecked foundation findings in issue 519 are handled by rule 3. Each is fixed
when a step touches its code, and not before.

### Where the orchestrated build stops

The owner set the end point on 2026-11-11. An agent orchestrates the build of this plan
until the owner can stop using the terminal.

The end point, in the owner's words: "when I can ditch this terminal UI, go on to" LGcode's
"hosted website, and be able to run the finalized build. That includes things like
publishing packages, doing mobile builds, and everything else, including the entire UI
and OpenPencil."

The owner's purpose: "to get to a point where I can open it and start working on all the
other finer details of LG code that are not built". The owner also wants the product
usable enough to bring the owner's project Ananke into it. Ananke is the code name, and
Enkra is its public name. The owner uses both for the same project.

What the end point requires, beyond steps 1 to 6:

- **The whole website matches the mock.** Every surface in the mock works on real
  records, not only the surfaces on the thin path.
- **The website is hosted.** The owner chose its address on 2026-11-12. The address
  is kept out of this repository, and it lives in the service's own configuration. The
  owner reaches it over HTTPS, as `docs/remote-access.md` describes,
  without a terminal open. The owner sets up the proxy for that address.
- **OpenPencil works inside it.** The repository Design page opens the design file and
  saves it into the repository.
- **LGcode installs from its repository.** The owner ruled on 2026-11-12 that
  distribution is simple for now. A person downloads the repository, runs the documented
  steps, and those steps build the package and install it locally. The release is
  published on GitHub. Wider distribution is decided later.
- **A project can publish packages and make phone builds.** These run as steps the lead
  starts and the owner approves, with their logs on the Test runs page. Accounts and
  secrets stay with the owner, and the build stops to ask when a step needs one.
- **The owner can change LGcode from inside LGcode.** The owner asked: "If I want to
  update something, how can I talk to the agent that actually updates it?" The answer in
  this plan is a project in the LGcode repository. The owner tells its project lead what
  to change, and the loop does the rest.

Steps 7 and 8 are not needed for the end point. The record keeping from step 7 that
starts in step 2 is kept.

How the orchestrated build is run:

- The work is integrated on one branch, `area/build-loop`, and each step is a pull request
  into it. Moving finished work into `master` stays the owner's approval, under rule 7 of
  `AGENTS.md`.
- The orchestrator watches the weekly usage and pauses at 90 percent.
- Each step ends with a session report that lists what a person can now do, what was not
  checked, and every choice made without the owner.

### OpenPencil: its server or the design file

The owner raised this on 2026-11-11 and decided the same day: agents change designs
through OpenPencil's tool server, because it is more reliable. An agent could change a
design in two ways.

- **Through OpenPencil's Model Context Protocol (MCP) server.** The agent calls tools, and
  OpenPencil changes the file. The editor's own rules keep the file valid, and an open
  editor shows the change at once. It needs OpenPencil running for every design change.
- **By editing the `.fig` file directly.** It needs nothing running. The agent must write
  a binary format correctly, and an open editor will not see the change until it reloads.

Changes go through the server. A direct read of the file is still allowed for import and
for drawing the Design page, because reading cannot corrupt the file. Step 3 starts by
proving the server on the real file before any code depends on it.

### Decisions the owner has made, and those still open

Made on 2026-11-11:

- The build loop is the next build, and an agent orchestrates it to the end point above.
- The first real project is LGcode itself.
- A project's name comes from its goal, and a lead may rename it.
- A question shows on Home, in the project lead's thread, and in the asking agent's
  thread.

Made on 2026-11-12:

- The hosted website's address is chosen. It is kept out of this repository.
- LGcode is installed from its repository and released on GitHub for now.

Made later on 2026-11-11:

- **Agents change designs through OpenPencil's tool server.** The owner: "It'll be way
  more reliable with that."
- **A project is set up by `lgcode init`.** Run inside a repository, it writes the
  template files into `.lgcode` and puts the project in setup mode. It checks whether
  LGcode was ever set up globally, in `~/.lgcode`. If it was, it copies those settings and
  starts the setup conversation with the owner's preferred harness. What `lgcode init`
  does when LGcode was never set up globally is not decided.
- **Model evaluation moves into LGcode.** The evaluation rounds, the model ledger and the
  related research leave Founder OS and become part of LGcode, as research. The owner
  will strip that content out of Ananke (Enkra) and Founder OS. LGcode ships one default
  model selection ledger, which each user can update. The run-by-run grades stay out of
  what LGcode ships.
- **Review rounds have no hard limit.** From round 6 on, each further round asks the
  owner first. The owner either approves the next round, and the question comes back
  after it, or says to stop reviewing and go on with the work.

Still open, in the order they block work:

1. **Does the owner approve the design file's categories?** A Design lead agent proposed
   them during the second round of the mock, in
   `design/mock/feedback/2026-11-10-design-categories.md`. The mock shows them at
   `/r/lgcode/design`. Step 3 needs the approved standard.
2. **What is a key task for an evaluation round?** The design suggests a merged sprint.

### What could go wrong

- **The thin path grows.** Each phase in step 2 will invite its full version. The table in
  step 2 is the limit, and anything else waits for its own step.
- **The first real run is slow or expensive.** That is a finding, and it is the reason to
  run it early. The session report for that run records the cost.
- **The design import is harder than it looks.** Turning real screens into a design file
  is the least proven part of this plan. If it stalls, step 3 ships without it and the
  import becomes its own step.
- **The website and the mock drift again.** The second round of the mock is the
  reference. A website change that the mock does not show needs the owner's approval, as
  it does today.
