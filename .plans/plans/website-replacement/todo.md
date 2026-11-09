# Replacing the website: the todo list

The owner approved the current mock as the reference and lifted the development
freeze for this build on 2026-11-08.
The scope is the whole mock.
The five build steps are an implementation order, not a reduced scope.

This list was reconciled against `master` at `5050be1` on 2026-11-08.
The source-to-mock map is `design/FEATURE-PARITY.md`.
The complete unit plan is `.plans/plans/website-replacement/plan.md`.
The main checkout also keeps a copy in `.scratch/foundry-runs/website-1/plan.md`.
The website team must not edit `design/`.

Each line below is one piece of work. "Agent's call" marks a choice the owner has
not ruled on.

## Engine: the data the mock shows

The engine has none of this today. All of it goes in a new `project` piece with
stored events, commands, a client API section and agent tools.

### Settings

- [ ] Store the workspace folder, which holds the owner's repositories. It is an
      owner-only setting. The installer will write it later.
- [ ] Store the defaults for a new project lead: harness, account, model, effort
      and permission. New project asks only for a repository and a name, so these
      must already exist. Agent's call.
- [ ] Store the owner's display name for the sidebar. It starts from git's
      `user.name`. Agent's call.

### Repositories, branches and changes

- [ ] List the repositories in the workspace folder, with name, path and project
      count.
- [ ] Create a brand new repository from New project: make the folder inside the
      workspace folder on the selected machine, run `git init`, and start on `main`.
      Report a name collision or a failure in a form the page can show.
- [ ] List a repository's branches and workspaces, with path, owner and activity,
      for the branch picker.
- [ ] Read a workspace's changes as a file tree, with added and removed line counts
      and the diff with line numbers. Unified and split views are drawn by the page.
      Give the reply a size limit.
- [ ] Read a branch's commit history, and the files and diff of one commit.
- [ ] Create a project's worktree when Start work tree is ticked, which is the
      default. A safe form of the project name sets the branch and the folder, with a
      numeric suffix on a collision. Unticked uses the main checkout. Report git
      errors in a form the page can show.
- [ ] Record which machine each repository and workspace is on.

### Git writes

The mock's Git page changes the repository, so these are not reads. Each one reports
git's failure in a form the page can show.

- [ ] Stage and unstage a file, and commit with a message, on the workspace's branch.
- [ ] Fetch, pull and push the branch, with counts of commits ahead and behind.
- [ ] Merge a team's branch into its project's branch, and list the conflicts when it
      stops. Refuse the merge when the destination has uncommitted changes.
- [ ] Open a review from the project's branch to the main branch. The page must not
      merge into the main branch directly.

### Projects and teams

- [ ] Add a project record: repository, name, goal, lead, assigned branch, checkout
      type, folder and machine.
- [ ] Refuse a second project with the same name in a repository, ignoring case.
- [ ] New project starts the lead with the stored defaults, in the project's
      worktree or main checkout, and opens its conversation.
- [ ] Store each project's preferred shell for its terminal sessions.
- [ ] Choose each lead's name from a list. Agent's call.
- [ ] Enforce exactly one lead per project.
- [ ] Add a team record under a project, with a name and its agents. Reuse agent
      groups and group board channels, so team chat is the board.
- [ ] Tie every agent to its project and team, so the sidebar tree can be built.
- [ ] Show each agent's status: Needs you, Reviewing, Working or Ready. Reviewing
      and Working come from the agent's task.

### Sprints and tasks

- [ ] Add a sprint record: label such as SP-01, name, goal, phase, owner,
      dependencies, completion and evidence. The phases are the build loop's.
- [ ] Add a task record: label such as SH-12, title, owner, team, sprint, state
      and workspace. The states are up next, in progress, in review, blocked and done.
- [ ] Work out a sprint's column in one shared function, as the mock does: Planned,
      In progress, Review or Done.
- [ ] Refuse new tasks in a completed sprint.
- [ ] Let moving to Done happen only with completion evidence. Keep release status
      separate.
- [ ] Record a task's history for its Work and handoff timeline.
- [ ] Tell the project lead when the owner adds a task. Agent's call.
- [ ] Let leads write sprints and tasks through agent tools, so the board works
      before the workflow runner exists.
- [ ] Let a worker change only its own tasks, and only in its own project.

### Decisions and conversations

- [ ] Extend a question with a title, a recommendation and a proposed answer. The
      mock's decision card shows all three.
- [ ] Link a question to its task and sprint. A linked task shows as blocked while
      the question is open.
- [ ] Answering a linked question marks its task done, as the mock does. A worker
      whose task should continue asks without the link. Agent's call.
- [ ] Surface an open decision in the project lead's conversation, the sidebar and
      the sprint. Only an answer clears it.
- [ ] Add a command to stop a reply without stopping the agent. The runner can
      already cancel a turn, but no command reaches it.
- [ ] Let the owner read a team channel without leaving read marks. Today a board
      read marks posts, so the page waits for a tap.
- [ ] Add context to a message from the composer's Add context control.

### Requests across projects

Home, the bell and the sidebar dots all read this.

- [ ] Add a durable index of the owner's open requests across all projects: questions
      and permissions, with project, agent, task and the time each was raised.
- [ ] Filter that index by kind and by project, for Needs attention, Questions and
      Approvals.
- [ ] Keep answered requests, so the page can show them after the answer.
- [ ] Work out how long each request has waited and which task it blocks.

### Terminal

- [ ] Run a real terminal on the selected machine and workspace, using the project's
      preferred shell. It runs commands directly, as the owner.
- [ ] Stream input and output, and support resize, interrupt and reconnect, with an
      owner for each session. Only the logged-in owner can attach.
- [ ] Use a real pseudo-terminal, so full-screen programs such as vim and agent command
      lines run, and resize reports columns and rows to the program.
- [ ] Choose how Node.js runs a terminal. This may be the first native dependency.

### Subscriptions

- [ ] Show each account's name, harness, machine, sign-in state, enabled state and
      active agent count. `accounts` and `shadowHome.ts` already separate accounts,
      and the page keeps that.
- [ ] Add a machine to each account.
- [ ] Let each conversation choose its subscription, and offer only the subscriptions
      that are ready for that harness.
- [ ] Sign in to a provider from the page, in that account's private login. The agent
      suggests running the harness's own login in a terminal session. Agent's call.

### Machines: one master and paired workers

The mock makes this part of the website, so it no longer waits until after it.

- [ ] Add a worker mode: the computer chooses Master or Worker, and a worker joins a
      master by its HTTPS address and a pairing code.
- [ ] Pair with an expiring code, and confirm on both computers. The owner approved
      a pairing code for machines on 2026-11-06, and chose that the website generates
      it. Web login stays one password.
- [ ] Add `lgcode connect <address>`, which starts the pairing from the other computer.
- [ ] Secure the link with a secure WebSocket and self-signed certificates that each
      side trusts after pairing, as the owner described on 2026-11-06.
- [ ] Have the worker connect out to the master, and report its capacity in agent
      slots, its repositories, its health and its identity.
- [ ] Place a project on a machine. Offline or unconfirmed workers get no new projects,
      and a worker cannot place projects. Moving running work is separate.
- [ ] Run agents through the same runner commands the engine uses locally, with the
      master's event log as the only record, and no duplicate work after a failure.
- [ ] Let an agent's LGcode tools, the terminal and git reads reach the right machine.
- [ ] Rework who-is-calling checks, because the master cannot inspect a process on
      another machine.
- [ ] Decide how work moves between machines. Git through the shared remote is the
      obvious route.
- [ ] Handle a worker going away while its agents are working.

### Added by the designer's critique and the mock's data layer

The critique of 2026-11-06 changed these parts of the mock, and the data layer of 2026-11-07
shows which events they need. `design/data/README.md` on `area/web-mock` lists them.

- [ ] Add the proposed `project.*` events to the new `project` piece.
- [ ] Read merge evidence per branch head: the test result and the review verdict.
- [ ] Let a retry after a failed start change the model and the effort.
- [ ] Add a command to change a machine's role, with its effect stated first.
- [ ] Name the machine in failure text, in `startFailure.ts`.
- [ ] Use the attention words Question, Approval, and Failed start, including in
      `alertTitles.approval`.

## Website: rebuild `packages/web` to match the mock

- [ ] Move the Field and Dusk tokens and the mock's styles into files, because the
      site's security policy blocks inline styles and scripts.
- [ ] Rewrite the mock's string-built views in React. Agent data stays plain text.
- [ ] Build the sidebar tree: repositories, projects with lead and branch, teams
      and agents, with chevrons separate from selection. Include the filter for only
      projects needing the owner.
- [ ] Build Home: Needs attention, All projects, Questions and Approvals, with one-line
      rows that expand in place and hand focus to the next row after an answer.
- [ ] Build the bell's popover, which counts the same requests as Home.
- [ ] Build the quick switcher.
- [ ] Build each repository's page. A repository name in the sidebar opens it, so there
      is no separate Repositories destination.
- [ ] Build the New project dialog, including its New repository option.
- [ ] Build panel resizing and remember each panel's width.
- [ ] Build the sprint board with its four columns and the empty board.
- [ ] Build the lead chat panel on the board: open, close, expand, and a drawer on
      smaller screens with Escape and contained focus.
- [ ] Build the sprint page and the task page, with evidence, dependencies and the
      timeline.
- [ ] Build the Add Task dialog.
- [ ] Build the conversation view: compact header, quiet owner turns, collapsed
      tool details and a growing composer that names its recipient.
- [ ] Build one tab row that keeps its position on every view: Board, Mocks when present, Chat,
      Terminal, Git, Project settings, and Tasks last in team scope. There is no Changes tab, because Git
      covers it. Remember the last tab.
- [ ] Build the Git view at full window height, with three columns that each scroll:
      worktrees, then the commit message above the file tree, then the diff. It has unified
      and split diffs, This file and All files, and commit history in the same pane.
- [ ] Build the Git actions: commit, fetch, pull, push, the conflict list, the team merge,
      the review to the main branch, and the block on a dirty destination.
- [ ] Build the branch picker. Picking a branch changes only what is viewed.
- [ ] Build the Terminal view with a terminal emulator such as xterm.js. It fills the
      main area below the tabs, with the prompt in the character grid and no input box. A
      slim bar holds the sessions, branch, machine and size in columns and rows.
- [ ] Build the Project settings tab: location and preferred shell.
- [ ] Build the Machines page in both modes, with its pairing dialog and project
      placement.
- [ ] Build the Subscriptions page, with its add and sign-in dialogs.
- [ ] Build the decision card and its links, down to the exact question.
- [ ] Keep each conversation's draft and reading position.
- [ ] Build the color mode switch, following the device until the owner chooses.
- [ ] Build mobile navigation with contained focus.
- [ ] Keep routes in the URL hash, including the alert links `/#/thread/<agentId>`.
- [ ] Leave out the mock's Design notes preview controls, its heavy sample and all its
      other sample data.

## Keep what the current page does

The mock now shows all of these. `design/FEATURE-PARITY.md` maps each to its source.

- [ ] Log in, log out, session expiry, rejected login and unavailable session. Entered
      secrets clear when the session ends.
- [ ] Connection state in the top bar. Reconnecting keeps the last view and drafts,
      and disables anything that changes state.
- [ ] Permission requests, showing the action input before the answer buttons, with
      hidden input, held requests and unconfirmed answers as separate states.
- [ ] Stopping and resuming an agent. Stopping cancels permissions and keeps questions.
- [ ] Failed-start reasons, which also prevent sending.
- [ ] Large thread items, with a loader, failure and retry.
- [ ] Tool calls and delivery history.
- [ ] The Alerts page as a table of notifications sent to the owner's phone, with paging,
      subject links and delivery failures. Its badge counts failed notifications only, and
      Home and the bell count the requests.
- [ ] The Settings page, with all twelve push kinds, the carrier and its write-only
      token, and the web server controls.

## Tests and proof

- [ ] Rewrite the 11 browser test files for the new page.
- [ ] Update `live-check-web.ts`, which finds elements by their current names.
- [ ] Port `design/checks.mjs`, `operations-checks.mjs`, `workspace-tools-checks.mjs`,
      `workspace-redesign-checks.mjs`, `home-checks.mjs`, `revision-checks.mjs` and
      `data-checks.mjs`, `onboarding-checks.mjs`, and `mocks-checks.mjs` to the browser suite at 390, 768, 1440 and 2560 pixels in both color modes.
- [ ] Add a real-agent proof: New project with a worktree, talk to the lead, the lead
      writes a sprint and a task, and a decision is answered from the board.
- [ ] Add real proofs for a terminal session running vim, a commit and merge from Git, a
      new repository, a provider sign-in and a worker on a second machine.
- [ ] Run `pnpm check`, `pnpm live-check:web` and `pnpm live-check` before merging,
      because stored events change.

## Attack list

These are on `.scratch/security/attack-todo.md` as what must hold.

- [ ] Git reads and the changes view.
- [ ] Git writes from the page, and creating a new repository.
- [ ] Who may write projects, sprints and tasks.
- [ ] Agent-written fields on the page.
- [ ] The terminal, worktree creation and provider sign-in.
- [ ] Pairing and the worker connection.


## Requirements added by the current mock on 2026-11-08

### First run and project lifecycle

- [ ] Implement the three resumable setup pages after login, with real computer discovery.
- [ ] Store positive setup completion and monotonic progress.
- [ ] Support scan retry, Back, missing-harness install instructions, and Change folder.
- [ ] Reuse New project for setup, with ready harness defaults and the latest repository.
- [ ] Persist the project goal, rename, archive, and restore.
- [ ] Stop the project's running agents before archive.
- [ ] Implement Add repository through Machines and preserve the New project draft on return.

### Project stages, mocks, and repository Design

- [ ] Store project stages and stage-derived team names, with an area for repeated stages.
- [ ] Show the stage strip and the conditional Mocks tab.
- [ ] Read actual mock screens, routes, revisions, scenarios, drafted fields, and components.
- [ ] Compare drafted data against the repository schema.
- [ ] Record owner mock approval and its planning handoff.
- [ ] Show repository tokens and shared component previews in Design.
- [ ] Keep design-to-code conversion as later Build-team tooling.

### The current shell and responsive behavior

- [ ] Implement the remembered 48-pixel rail and its keyboard shortcut outside terminal focus.
- [ ] Use the current exact tab order, with Mocks conditional and Tasks last.
- [ ] Make breadcrumbs navigate without repeated page titles.
- [ ] Use the current typography, spacing, control heights, local fonts, and credited icons.
- [ ] Dock the selected thread beside every project view above 1800 pixels.
- [ ] Give duplicate request blocks unique anchors and focus the one answered.
- [ ] On phones, keep menu, place, and bell in the top bar and put connection details in the bell.
- [ ] Put Inspecting below the tabs on phones.
- [ ] Let the whole phone drawer scroll and put agents needing attention first.
- [ ] Render the phone board as one attention-first list.
- [ ] Stack responsive records with status first on their second line.
- [ ] Preserve overflow fades, readable breadcrumbs, and unwrapped avatar initials.

### Requests, composer, and service actions

- [ ] Sort failed starts first and then longest waits in Home and the bell.
- [ ] Mark waits of at least one hour in amber.
- [ ] Preserve answer result and time in history.
- [ ] Use one reusable block for questions, approvals, and failed starts.
- [ ] Put sprint requests before its goal and show approval-blocked tasks.
- [ ] Put timestamps on every task activity step.
- [ ] Send on Enter and use Shift+Enter for a line break.
- [ ] Open the context search with @ and preserve sent context references.
- [ ] Offer subscription, model, effort, and honest context usage beside the composer.
- [ ] Offer phone notifications at the first waiting request, outside setup.
- [ ] Persist Not now so that the offer never returns.
- [ ] Retry a failed notification and send a test notification through the real transport.
- [ ] Show subscription usage/reset where the provider reports them and unavailable state otherwise.
- [ ] Rename and remove subscriptions without combining their private logins.
- [ ] Rename and remove machines and leave a master with the stated effects.

### Git and terminal additions

- [ ] Stage all, unstage all, and discard with confirmation while preserving conflicts.
- [ ] Resolve each conflict in the diff pane with ours, base, and theirs.
- [ ] Persist selection and drafts per worktree and expose merge evidence by branch head.
- [ ] Support terminal session names, rename, close, paste, reconnect, and real program completion.
- [ ] Keep terminal output out of stored events and logs.

## The five ordered build gates

- [ ] Step 1: Engine data, including current first-run, service, stage, and mocks data.
- [ ] Step 2: Replace the page in React and pass the full browser parity matrix.
- [ ] Step 3: Real terminals and subscription sign-in.
- [ ] Step 4: Installer and `.lgcode` configuration.
- [ ] Step 5: Pairing, worker mode, remote runner, and final integration.

Each gate requires `pnpm check` and `pnpm live-check:web` from the website team.
The manager runs `pnpm live-check` from the manager shell at the gate commit.
The baseline is the manager's clean-checkout result of 19 stages out of 23.
Roles units 3, 4 and 11a remain unbuilt.
