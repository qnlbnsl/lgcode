# Website replacement build plan

## Authority and baseline

The owner lifted the development freeze on 2026-11-08 for this build.
The assignment is the whole current mock, not a smaller first release.
The team branch is `area/website` in `qnlbnsl/lgcode`.
The starting commit is `5050be1`.
The branch was fetched and fast-forward checks against `origin/master` and `origin/area/website` succeeded on 2026-11-08.
The lead must never open or merge a pull request into `master`.
The mock folder `design/` is read-only for this team.
Roles units 3, 4 and 11a remain out of scope.

## What changed since the earlier note and checklist

The earlier checklist names `e2d5166`, before the current mock merged through pull requests 30 to 33.
The live reference is the complete `design/workbench.html`, `workbench.js`, `tokens.css`, `DESIGN.md`, `FEATURE-PARITY.md`, and `data/README.md` at `5050be1`.
The following deltas supersede the earlier descriptions.

| Area | Current requirement | Earlier description replaced |
|---|---|---|
| First run | Login precedes three resumable pages: value, computer discovery, and project creation. Completion is a positive stored record. Failed scans retry. Missing harnesses show install commands. | No first-run implementation was listed. |
| New project | Run on precedes the name. The goal is stored. The branch and folder are previewed. Add repository opens Machines and returns with the draft preserved. | New repository creation alone did not cover registration on another machine. |
| Projects | Rename preserves the branch and folder. Archive stops running agents. Restore returns the project. | Only creation and shell preferences were listed. |
| Project stages | Design, Plan, Build, Review, and Hand over are shown. Projects without screens omit Design. Team names derive from stage and area. | Teams were generic named groups. |
| Mocks and repository Design | Show project screens, screen revisions, drafted data against schema, shared tokens, and draft components. Approval records evidence and hands work to planning. | The earlier note omitted this entire view. Design conversion remains later Build-team tooling. |
| Shell | The sidebar collapses to a remembered 48-pixel rail. Selection and disclosure differ. A single tab row adds Mocks when present and Tasks last for teams. Breadcrumbs navigate. | Tasks was described before Terminal. A separate Repositories destination and repeated titles are gone. |
| Requests | Failed starts precede the oldest request. An hour is amber. Filters cover repository, project, agent, and machine. Answered history names its result and time. There is one reusable question, approval, or failed-start block. | An isolated decision card is insufficient. |
| Composer | Enter sends and Shift+Enter inserts a line. Context search also opens with @. Subscription, model, effort, and context usage sit in the tool row. Stop reply differs from stop agent. | Initial notes only covered subscription and Add context. |
| Board and details | Cards lead with requests, stop at 300 pixels, and omit empty progress bars. Sprint requests precede its goal. Tasks name approval blockers and timestamp each activity. | Generic cards and timelines lacked the newest hierarchy. |
| Wide screens | Above 1800 pixels the selected thread can dock beside every project view. Chat adds the agent task and files. Duplicate request anchors are unique. | Only the board had a lead panel. |
| Git | Three scrolling columns, persistent per-worktree state, bulk stage and unstage, confirmed discard, history, split fallback, and inline ours/base/theirs conflict resolution. | Reads and simple staging did not cover the full service. |
| Terminal | Real character grid, named sessions, close and rename, paste, resize, interrupt, reconnect, and full-screen programs. | A command input is gone. |
| Service pages | Phone notifications show failure state, times, retry, and settings remedy. Subscriptions show per-account usage and reset, rename, remove, and login. Machines show last seen, rename, remove, leave master, and repository registration. | Fleet tables alone are insufficient. |
| Phone notifications offer | The oldest waiting request offers setup. Not now is stored permanently. The first waiting request does not receive a notification retroactively. | This is deliberately absent from first-run setup. |
| Phone layout | The top bar contains menu, place, and bell. Connection lives in the bell. Inspecting sits below tabs. The drawer scrolls as one and leads with attention. Boards become one ordered list. Responsive tables lead the second line with status. | Earlier horizontal board columns and desktop top-bar controls are gone on phones. |
| Foundations | Five text sizes, three weights, 4-pixel spacing, 32/28-pixel controls, local fonts, credited Lucide icons, visible focus, and reduced motion. | The palettes remain Field and Dusk. Design notes and every sample are excluded from production. |

## Build units and dependencies

Complexity describes the amount of integration and review required.
Every builder gets its own signed branch and worktree from the current team branch.
A new verifier checks each unit before it can merge.
The file lists name work areas and include the focused tests for that area.
Shared registration files may change when a unit must install its real handlers.
No command is advertised before it has a handler.

| Unit | Step and complexity | Work area and files | Dependencies | Mock and proof boundary |
|---|---|---|---|---|
| W01 | 1, high | Project contracts, events, reducer, commands, snapshot, and registration in `packages/contracts/src/project/`, `packages/engine/src/project/`, piece tables, client, command-line interface, and Model Context Protocol tool generation. | Baseline. | Projects, teams, sprints, tasks, defaults, shared status derivation, permissions, event replay, bounded snapshots, and team membership. `data-checks.mjs`. |
| W02 | 1, high | Real Git service and tests in `packages/engine/src/project/git/`. | Service internals can start with baseline. Integration follows W01. | Safe bounded reads, repositories and worktrees, changes, history, staging, commits, sync, conflict choices, dirty destination refusal, and review creation without merging main. `workspace-tools-checks.mjs`, `workspace-redesign-checks.mjs`, Git cases in `revision-checks.mjs`. |
| W03 | 1, high | Existing question, request, runner and board commands, contracts, client reads, and runtime tests. | Baseline. Project links follow W01. | Reply cancellation keeps agent alive. Owner chat reads leave no read mark. Question title, recommendation, proposed answer, linked task completion, request history, model/effort changes, and honest context usage. `operations-checks.mjs`, composer cases in `revision-checks.mjs`. |
| W04 | 1, high | Project creation and Git integration in project planners and service lifecycle. | W01, W02, W03. | Real lead launch, repository creation and registration, collision-safe worktrees, inherited membership, owner task notification, rename/archive/restore, and API parity. `home-checks.mjs`, `data-checks.mjs`. |
| W05 | 1, high | Setup, project stage and mocks data, schema/design reads, notification retry/test/dismissal, and account read support. | W01 and W04. | No sample data. Real discovery, positive setup completion, stage team names, screen metadata and revision records, approval evidence, persisted notification dismissal, and fixed safe errors. `onboarding-checks.mjs`, `mocks-checks.mjs`, service cases in `revision-checks.mjs`. |
| W06 | 2, high | React application shell, routes, authentication, tokens, external styles, local font assets, sidebar, switchers, and shared UI in `packages/web/`. | Step 1 passes its three gates. | Keep authentication and current watchers. Hash routes and old alert deep links survive. Rail, drawer, breadcrumb, URL navigation, connection indicator, focus, and Field/Dusk match. `checks.mjs`, phone and foundations cases in `revision-checks.mjs`. |
| W07 | 2, high | Home, repository list, board, sprint/task details, New project and task dialogs in web workspace views. | W06. | Shared request queue, inline answers, attention order, history, filters, focus handoff, responsive tables, stage strip, cards, and detail timeline. `home-checks.mjs`, `checks.mjs`, relevant revision cases. |
| W08 | 2, high | Agent and team conversations, reusable request blocks, composer, thread dock, context and usage. Existing web thread recovery files remain authoritative. | W06 and W07 request primitives. | Existing large-item, lifecycle, held/unconfirmed permission, delivery, plain-text and reconnect behavior. Drafts and positions are per conversation. 1800-pixel dock. `operations-checks.mjs`, `workspace-redesign-checks.mjs`, composer and thread revision cases. |
| W09 | 2, high | Git React view, inspection picker, conflict resolution, merge review and browser tests. | W06 and engine Git integration. | Full-height independent scrolling, line pairing and bounded rendering, per-worktree state, all real mutations, keyboard/focus, and phone gutter. Workspace and revision Git checks. |
| W10 | 2, high | First-run, service pages, Project settings, mocks and repository Design React views. | W06, W05 and W07. | Full current screen behavior. Terminal login and machines connect become live in later ordered steps. Keep existing write-only settings recovery. `onboarding-checks.mjs`, `mocks-checks.mjs`, service and phone revision cases. |
| W11 | 2, high | Browser parity matrix, existing acceptance suites, `live-check-web.ts`, and first real-agent project journey. | W07 through W10. | Port all nine mock suites, including data, onboarding and mocks, to authenticated real-engine fixtures. Run at 390, 768, 1440 and 2560 pixels in light and dark. No production sample reads. Step gates. |
| W12 | 3, high | Node.js 26 pseudo-terminal proof, authenticated bounded terminal service, web stream, terminal emulator, and tests. | Step 2 gates. | Native build, shell grid, vim, named sessions, resize, interrupt, reconnect, lifecycle cleanup, no terminal events or output logs, no stale input. Terminal mock checks. |
| W13 | 3, high | Subscription placement, usage adapters and per-account provider login through terminal, contracts, API, page and tests. | W12. | Private shadow homes remain separate. Ready choices match harness and machine. Honest missing usage. Provider's own login is used. Step gates and real sign-in proof. |
| W14 | 4, high | Installer, service startup and update/uninstall recovery, CLI and packaging documentation/tests. | Step 3 gates. | Install Node.js 26 runtime requirements and native terminal support. Standalone starts remain supported. No repository-specific team definitions. |
| W15 | 4, high | User/repository `.lgcode` loading, validated precedence, workspace discovery, and API parity. | W14. | Global and repository overrides load the default build loop. Installer provides workspace folder and defaults. Step gates. |
| W16 | 5, high | Machine records, keys, pairing, role/confirmation/removal, worker CLI, secure transport and tests. | Step 4 gates. | Pairing codes expire and are one-use. Confirmed pinned peers only. Worker port stays off initially. One master event log. Machine and phone cases. |
| W17 | 5, high | Remote Runner, tool forwarding, event acknowledgements, remote Git and terminal, local checks, capacity, recovery and tests. | W16. | Correct host execution, no duplicate work after reconnect, no dispatch to unconfirmed/offline/full workers, honest interruption, remote repository identity. |
| W18 | 5, high | Final machines page wiring, installer-to-worker journey, four-width/two-mode regression and real second-machine proof. | W17. | Full paired worker flow and the complete mock matched. Final three gates, branch pushed, verifier evidence and closing report. |

W05 is split into three independently verified seats.
W05a builds notification retry, test delivery, and permanent prompt dismissal against the existing client machinery.
W05b builds setup, stages, and mock records after W04.
W05c builds actual next-turn model and effort changes and honest per-agent context reads against the existing runner.
The latter completes the composer engine scope named in W03 without expanding its request and cancellation seat.
Per-account provider usage and subscription placement remain in step 3.

## Seat rules and integration

The harness is Codex on `gpt-6.1-sol` with high reasoning effort for builders and verifiers.
The manager arranges Claude reviews separately.
No Claude seat is started by this lead.
The brief's builder-writes-tests instruction overrides the builder template's frozen-test assumption.
Each verifier is fresh and did not build the unit.
Each verifier reads the task, complete touched files, diff, relevant mock views and check suites.
It runs the unit's tests and `pnpm check` in that worktree.
A failed verification returns to the builder before a new verification round.
The lead checks the signed commit and clean worktree, merges the branch, and runs `pnpm check` on that merge.
No Co-Authored-By trailer is allowed.
Every commit ends with `Claude-Session: https://claude.ai/code/session_01TKETPLJ18SkHJufkrzj67J`.
The lead runs `scripts/check-credits.sh`.
Every copied open-source file follows `AGENTS.md` and `NOTICE`.

Use tabs named `web:<n>`, split right, with at most three panes per tab.
Use at most eight seats at once and keep system load below 38.
Do not touch workspace `w3` or pane `w3:pAD`.
Read each active seat's session log `used_percent`.
Report 90 percent to the manager and start no seats at 97 percent.

## Stage gates and evidence

At the end of every numbered build step, the website team runs `pnpm check` and `pnpm live-check:web`.
The manager runs `pnpm live-check` from the manager shell at the exact gate commit.
The manager changed this execution assignment on 2026-11-08 after reproducing the baseline at 19 of 23 stages.
Live account use is authorized by the brief.
The `sandbox-mcp` failure recorded in issue 524 gets one rerun before regression classification.
Reports name the commit checked and any dirty files.
A running command remains pending until its exit code is collected.
The plan does not claim that physical-phone or second-machine proof can be substituted by a browser resize or a same-host process.
If that environment is unavailable, report the exact missing proof to the manager while continuing independent work.

The security invariant list is `.scratch/security/attack-todo.md`, under "From the website replacement".
It describes what must hold and where, without attack recipes.
New implementation problems are recorded with the next free number in `docs/issues.md`.
New feature ideas go in `docs/features.md`.
Do not reopen the owner's password, encryption, Unix-user, or single-user decisions.

## Reports and artifacts

`plan.md` is this baseline and unit map.
`run.md` records seat launches, commits, reviews, checks, merge outcomes and meter readings.
Each seat gets a task file and writes its result in this run folder.
`closing.md` attributes every unit commit to agent, harness, model and effort.
It includes each verifier, final checks, seats used and meter.
Send the manager one line after the plan commit, each passing build step, or a decision that needs the owner.
Do not ask the owner directly and do not offer a journal entry.
