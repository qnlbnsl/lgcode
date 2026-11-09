# The website replacement and the engine support it needs

## What this note is

This note is the design for replacing the current page with the mock in
`design/workbench.html`, and for adding what the engine lacks. The checklist is
`.plans/plans/website-replacement/todo.md`. The owner authorized this build on
2026-11-08. Implementation status belongs in that checklist and the website run report.

The design was written against the mock as it stood at 09:18 on 2026-11-06. The section
"What changed in the mock after 09:18" records the later additions, against commit
`e2d5166` on the branch `area/web-mock`.

## What the owner decided

The following decisions were recorded on 2026-11-06.
The 2026-11-09 section below supersedes the earlier golden-mock and implementation-hold wording.

- The mock is golden, and the engine gets whatever it needs: "just add the missing
  support to the engine".
- Nothing is built until the owner says so: "just a discussion and todo. not making
  the changes."
- One master runs the work, and other computers join it as workers, "basically
  spread the load of a project accross machines. and they get their commands
  through the main."
- A new computer joins by running `lgcode connect` and entering the master's address.
- The link is "a secure WebSocket with self-signed certificates that both the host
  ... and the client Sheprd trust".
- A pairing code is fine for machines, and the website generates it. Web login stays
  one password.

## The parts and where they live

| Part | Where it lives | What it holds |
|---|---|---|
| Projects, teams, sprints, tasks | New `project` piece | Stored events and a view |
| Git reads and worktrees | Engine service, called by `project` commands | Nothing stored |
| Terminal | Engine service with its own stream | Nothing stored |
| Subscriptions | Existing accounts, extended | Existing account events |
| Machines | New `machines` piece and a new runner | Stored events and each side's keys |
| The page | `packages/web`, rewritten | Drafts and the color mode, in the browser |

The new pieces follow the board's pattern. Each registers its name in
`packages/contracts/src/namespaces.ts`, and the typed tables in
`packages/engine/src/pieces/lists.ts` then require its planners, reads, view,
visibility and snapshot section.

## Projects, teams, sprints and tasks

### The records

A project has an id, a repository, a name, a goal, a lead agent, an assigned branch,
a folder, a checkout type of worktree or main, a machine and a preferred shell. A name
is unique within its repository, ignoring case.

A team has an id, a project and a name. Its agents are the agents that carry the group
label `team:<projectId>/<teamId>`. This reuses agent groups, and a group board channel
then gives the team its chat.

A sprint has an id, a label such as `SP-01`, a name, a goal, a phase, an owner, the
sprints it depends on, and an optional completion with its evidence. The phases are the
build loop's: Define, Design, Plan, Build, Verify, Review and Hand over.

A task has an id, a label such as `SH-12`, a title, an owner, a team, a sprint, a state
and a workspace. The states are queue, active, review, blocked and done. Each task also
keeps a short history for the mock's Work and handoff timeline.

### What is worked out and not stored

These go in `packages/contracts`, so that the page and the engine share them:

- A sprint's board column, using the mock's rule. A completed sprint is Done. Any active
  or blocked task makes it In progress. Otherwise any task in review makes it Review. The
  rest are Planned.
- An agent's status: Needs you, Reviewing, Working or Ready.
- What needs the owner in a project: open permission requests and questions held by the
  owner, from agents in that project.

### How an agent joins a project

The lead is set when the project is created. Every other agent inherits its project from
the agent that started it. The `project` piece sees this from `AgentStarted`, so the
`start` command does not change.

### Commands

| Command | Who can call it |
|---|---|
| `project.settings`, `project.settings.set` | Owner |
| `project.repositories`, `project.workspaces` | Owner |
| `project.create` | Owner |
| `project.read`, `project.changes`, `project.history`, `project.commit` | Owner, and agents for their own project |
| `project.team.create`, `project.sprint.create`, `project.sprint.update`, `project.sprint.complete` | Owner and that project's lead |
| `project.task.create` | Owner and that project's leads |
| `project.task.update`, `project.task.note` | Owner, that project's leads, and the task's own worker |

Agent tools come from this list automatically. So a lead can fill the board as soon as
these exist, and the workflow runner can later use the same commands.

`project.sprint.complete` requires evidence, and a completed sprint refuses new tasks.
The page never offers dragging a card to Done.

### Decisions

`ask` gains optional fields: title, recommendation, proposed answer and linked task.
While a linked question is open, its task shows as blocked. Answering it marks that task
done, as the mock does, so an agent whose task should continue asks without the link.

Nothing is written into the lead's conversation to surface a request. The page shows the
owner's open requests for that project at the end of the lead's chat, in the sidebar and on
the sprint. This also covers permission requests, as the mock does. Only an answer clears it.

## Git reads and worktrees

A small engine service runs git on the machine that holds the workspace. It returns:

- The repositories in the workspace folder.
- Each repository's branches and worktrees, with the owner and activity worked out from
  projects and tasks.
- A workspace's changed files, with line counts and diffs. The page draws the unified and
  split views from the same reply.
- A branch's commit history, and one commit's files and diff.

Every reply has a size limit, and a large diff says it was cut. These are reads, so
nothing is stored.

`project.create` makes the worktree when Start work tree is ticked. A safe form of the
name becomes the branch and the folder `<repository>/.worktrees/<name>`, and a collision
adds a number. Git's failures reach the page in a fixed form that the owner can act on.

This reverses the engine design's line that git worktrees stay out of the engine. The
owner's mock now asks for it.

## The terminal

The terminal is the owner's own shell, on the project's machine and folder, with the
project's preferred shell. It is not an agent tool, and it runs outside any agent sandbox.

It has its own stream on the web server, and not an event in the log. Its output can hold
anything, so it is never stored or logged. The engine keeps a small recent buffer in
memory, so that a reload can reattach. A session ends when its shell exits or the engine
stops. Resize, interrupt and clear are controls on the same stream.

A real terminal in Node.js normally means `node-pty`, which is a native dependency. It
would be Sheprd's first, and the installer has to carry it. The first task is to prove
that it builds and runs on Node.js 26.

## Subscriptions

These are the engine's existing accounts, and `shadowHome.ts` already keeps logins apart.
An account gains a machine, and the page works out its active agent count.

Signing in runs the harness's own login inside a terminal session, on the account's
machine, with the variable that points the harness at that account's private login folder.
`harnesses.ts` already knows those variables. So Sheprd never handles the provider's
password or token, and each harness's own flow still works. The status updates when the
engine next reads that login.

## Machines

### Pairing

1. The owner clicks Connect machine on the Machines page and names the machine. The master
   shows a code of about 20 characters that works once and expires after 10 minutes.
2. The owner runs `lgcode connect <address>` on the other computer, which asks for the code.
3. The two sides exchange public keys over a secure WebSocket. Each side proves that it
   knows the code by signing both public keys with it.
4. The machine appears on the page as awaiting confirmation, and the owner confirms it.
5. Each side then stores the other's public key and trusts only that key.

The master's worker port stays off until the owner connects a first machine, which keeps
`SECURITY.md` rule 1. It is its own port, because the owner's HTTPS proxy would end the
encryption before Sheprd saw it.

### Running work on a worker

The worker always connects out to the master. The master holds the only event log, the
board and the website. A worker holds agent processes and local files.

The engine already goes through one `Runner` interface: start, load, prompt, cancel,
answer, set mode, compact, stop, and a stream of events. A new remote runner sends those
calls to the worker, and the worker's copy of `AcpRunner` carries them out. The master picks
the runner from the project's machine, so placement is per project, as the mock shows.

These parts move with the work:

- **Agent tools:** an agent talks to its local worker, which passes the call to the master
  with the agent's token.
- **Local checks:** folder limits and process checks need the worker's own disk and process
  table, so the worker runs them and the master relies on the paired worker's report.
- **Reads:** git reads and terminals are sent to the project's machine.
- **Lost connections:** the worker queues events until the master acknowledges them. Existing
  delivery and incarnation ids stop a message being acted on twice. If a worker stays away,
  its agents show as interrupted.
- **Moving work between machines:** git, through the shared remote. Moving a running project
  is not part of this, as the mock says.

Workers report their repositories, agent slots and health. A repository on two machines is
matched by its remote address.

## The page

`packages/web` is rewritten in React, screen by screen, against the mock. Three rules carry
over from today's page:

- **Agent data is plain text.** The mock builds strings of HTML, which is why it is rewritten
  and not copied. `DataText` and `visibleText` stay.
- **The site's security policy stays as strict.** The mock's inline styles and script move into
  files, and `style=` attributes become classes or script-set values.
- **Routes stay in the URL hash,** because the server does not rewrite paths and alert links
  use `/#/thread/<agentId>`.

The current page's watchers, request handling, lifecycle controls and admin pages are kept and
restyled, because they already hold the hard recovery logic. The mock's Design notes controls and
its sample data are left out.

Three small engine additions serve the chat:

- **Stopping a reply.** A new command calls the runner's existing cancel, and the agent keeps
  running. Today only stopping the whole agent is available.
- **Reading team chat.** The owner can read a channel without writing `board.Read`. Agents' reads
  keep their marks.
- **A project section in the snapshot,** with a size limit like the board's. Full lists come from
  `project.read`.

## Build order

The result is the whole mock, and the current page is replaced only when the first two steps
work together. This is the order of building and not a smaller scope.

1. **Engine data.** The `project` piece, git reads, worktrees, decisions, the reply stop and the
   team chat read.
2. **The page.** Rewritten against step 1, and replacing the current page.
3. **Terminal and subscriptions.** Terminal first, because sign-in uses it.
4. **Installer and `.lgcode` config.** This was already next, and a worker needs it to get Sheprd
   onto another computer. The workspace folder setting moves here from the page's first run.
5. **Machines.** Pairing, the worker mode and the remote runner.

Later work uses this. The workflow runner calls the sprint and task commands. The agent sandbox
wraps the harness in `AcpRunner`, on master and workers alike.

## What must hold

The running list is `.scratch/security/attack-todo.md`, under "From the website replacement". It
covers git reads, worktree creation, the terminal, sign-in, who may write project data, agent data
on the page, and pairing. `SECURITY.md` gains rules for the terminal and the worker port when they
are built.

## Choices the owner has not ruled on

The agent made these choices, and any of them can be overruled:

- A new project's lead uses stored defaults for harness, account, model, effort and permission,
  because New project asks only for a repository and a name.
- A lead's name comes from a fixed list.
- Task label prefixes come from the project's name.
- Answering a linked question marks its task done.
- Adding a task from the page tells the project lead.
- The owner's display name starts from git's `user.name`.
- Provider sign-in runs in a terminal session.
- The master relies on a paired worker's report for that worker's local checks.

## What changed in the mock after 09:18

These additions change what the engine has to do.

- **Home needs a durable request index.** Home, the bell and the sidebar dots count one
  list of the owner's open requests across all projects. It needs filters, answered
  history, the time each request has waited, and the task each one blocks.
- **Git writes the repository.** The note above describes git reads only. The mock now
  stages, commits, fetches, pulls and pushes, merges a team's branch into its project's
  branch, lists conflicts, and opens a review to the main branch. A merge is refused when
  the destination has uncommitted changes. Only the owner credential may explicitly
  approve and merge into main or master after both reviewed heads are revalidated.
  Agents and the existing team integration remain refused. The owner may choose
  Approve without evidence. Issue 545 supplies this separate engine path.
- **New project can create a repository.** It makes a folder inside the workspace folder
  on the selected machine, and runs `git init`. Cloning from an address is not offered.
- **The terminal is a real grid.** It has no input box, so the page needs a terminal
  emulator such as xterm.js, and the engine needs a pseudo-terminal. Full-screen programs
  such as vim and agent command lines must run, and resize reports columns and rows. This
  makes `node-pty`, or an equivalent, a requirement rather than a likely choice.
- **Conversations choose a subscription.** The composer offers only the subscriptions that
  are ready for the harness, and it has an Add context control.
- **Alerts means notifications.** Its badge counts failed notifications to the owner's
  phone. It no longer counts requests, so it needs no new data.

These changes affect only the page:

- There is one tab row, with the same position on every view: Board, Chat, Tasks in team
  scope, Terminal, Git and Project settings. There is no Changes tab, and no separate
  Repositories destination.
- The page also gains a quick switcher, an attention filter in the sidebar, and panel
  resizing.

## What the mock's data layer shows the engine must provide

Since 2026-11-07 the mock reads JSON files shaped like the `events` table, through stub
functions named after the client commands. `design/data/README.md` on the branch
`area/web-mock` maps each stub to its command. Every row with an event type the engine has
already decodes against the contracts. These are the rest, and they are proposals:

- The `project` piece needs machine, repository, worktree, project, team, sprint, task, question
  link, account placement, prompt context, and stopped-reply events. The list is in that README.
- Failure text should name the machine, such as "Not signed in to Codex on Buildbox". Today
  `startFailure.ts` does not know the machine.
- The attention words are Question, Approval, and Failed start. `alertTitles.approval` still says
  "Permission needs your approval".
- Merge evidence is read per branch head, as tests and a review verdict.

## Changes the mock still needs

The owner picks from the critique's remaining Should fix and Polish findings.


## The current build reference, reconciled on 2026-11-08

The current reference is the mock merged into `master` at `5050be1`.
The owner lifted the development freeze for this build on 2026-11-08.
The build uses five ordered steps, and all five belong to its scope.
The committed plan is `.plans/plans/website-replacement/plan.md`.
The run folder also holds a copy in `.scratch/foundry-runs/website-1/plan.md`.
The mock files remain owned by the mock session.

The earlier descriptions above are historical where this section replaces them.
The product and command are LGcode and `lgcode`.
Configuration lives under `.lgcode`.

### Project discovery, setup, and lifecycle

The first run follows login and has three resumable pages.
They explain the product, show discovered harnesses and repositories, and create a project.
Setup completion is stored positively and does not reset when projects are archived.
Scans have retry and back controls.
A missing harness has an install command.
A project stores its goal.
Renaming a project preserves its branch and folder.
Archiving stops its running agents.
Restoring returns it without inventing a new project.
New project chooses Run on before the name.
Adding a repository opens Machines and returns with the project draft preserved.
Repository registration checks the actual folder on the selected online machine.

### Project stages and mocks

Projects show Design, Plan, Build, Review, and Hand over.
A project with no screens starts in Plan and omits Design.
Teams are named from their stage and optional area.
The Mocks tab reads real screen records, revisions, drafted fields, caller-reviewed comparisons, and components.
Omitted comparisons are Unavailable, and the engine does not infer an application schema.
Mock approval records the owner's decision and hands its concrete work to planning.
The repository Design tab reads its tokens and shared components.
Design-to-code tooling remains later Build-team work.
The production page has no scripted sample reactions or Design notes.

### The shell and responsive page

The project tabs are Board, Mocks when present, Chat, Terminal, Git, Project settings, and Tasks for a team.
The sidebar can fold into a remembered 48-pixel rail.
The phone drawer remains a drawer.
There is no separate global Repositories destination.
At widths above 1800 pixels the selected thread can dock beside every project view.
Each copy of a request has a unique anchor.
The phone top bar has the menu, place, and bell.
Its connection state lives in the bell.
Its Inspecting control sits below the tabs.
The phone board is one list ordered by owner attention and then sprint status.
Responsive tables put the status first on the second line.
Field and Dusk keep the exact approved tokens.
The five text sizes, three weights, local fonts, credited icons, and 4-pixel spacing follow `design/DESIGN.md`.

### Requests and conversations

Failed starts come before the oldest request.
Home and the bell share that ordering.
Request history retains the answer result and time.
Filters include repository, project, agent, and machine.
One reusable block presents questions, approvals, and failed starts.
The composer sends on Enter and inserts a line on Shift+Enter.
It offers context search through Add context and @.
The tool row exposes subscription, model, effort, and actual context usage.
Usage that a harness does not report is unavailable rather than invented.
The first waiting request offers phone notifications when no service is set.
Not now is stored permanently.
That offer is absent from first-run setup.
Notification retry and a test notification use the real notification transport.

### Git, terminal, and service records

Git supports bulk stage and unstage, confirmed discard, and inline conflict choices for ours, base, and theirs.
It keeps its selection and draft per worktree.
The page opens a review to the base branch.
Only the owner credential may explicitly approve and merge into main or master.
The engine revalidates both reviewed source and destination heads before execution.
Agents remain refused, including through the existing team integration.
The owner may explicitly choose Approve without evidence.
Git reads are bounded.
Terminal sessions have names, close and rename controls, resize, interrupt, and reconnection.
The character grid supports full-screen programs.
Terminal output is neither stored as events nor logged.
Subscriptions retain independent private login folders.
Usage and reset times come from supported provider reports.
Machines retain last-seen times, role, repository locations, and confirmed pairing identity.
Rename, remove, and leave-master controls state their effect first.

### Verification scope

All nine mock suites are acceptance sources.
They include `onboarding-checks.mjs` and `mocks-checks.mjs`.
Browser proofs cover 390, 768, 1440, and 2560 pixels in both color modes.
Every build step runs `pnpm check` and `pnpm live-check:web` in the website team.
The manager runs `pnpm live-check` from the manager shell at the same gate commit.
This follows the manager's 2026-11-08 correction in issue 526.
The real-agent project journey, provider login, terminal vim, Git mutation, and paired second-machine journey each need their own evidence.

## The owner-approved simpler implementation, 2026-11-09

The visible screens remain the target and change only with the owner's approval.
The mock itself, its data records and its fixtures are not frozen contracts.
The owner approved these eight simplifications for the complete five-step build.

1. Team area labels are optional, and generated team names remain unique.
   Repeated stages do not require a peer-area admission rule.
2. A screen records routes only for the typed scenarios that it supports.
   Empty and partial binding lists are valid; unknown identities and duplicate bindings still refuse.
3. Drafted fields use optional caller-reviewed comparison metadata.
   Missing review is Unavailable, and the engine does not parse an application schema from mock data.
   Actual artifact fingerprints and owner approval remain required.
4. Pages read the existing typed engine records directly and reuse the shared request and recovery parts.
   No client data-transfer compatibility shapes or duplicate state machines are added.
5. Browser checks group visible behaviors across 390, 768, 1440 and 2560 pixels in both color modes.
   They preserve authority, recovery and plain-text assertions rather than multiplying every fixture permutation.
6. Shell use and harness sign-in share one real terminal service and emulator.
7. Settings use one schema and loader with validated precedence.
   Installation and update use one installer path.
8. Worker execution uses one transport behind the existing Runner, Git and terminal interfaces.
   The master retains the authoritative event log and duplicate-delivery protection.

The owner authorized step 2 before the aggregate step-1 gate.
A page unit waits only for its own missing accepted dependency.
W06, W07A and W10A ship as one composed foundation with individual author evidence, one builder full, and one fresh whole-composition review and full.
Preview/editor display remains a separate owner decision in website-1/preview-editor-owner-decision.md.
No policy or visible-screen change follows from a proposal alone.
