# LGcode app mockups

Serve this directory with `python3 -m http.server 4178 --bind 127.0.0.1`, then open
`http://127.0.0.1:4178/workbench.html`. Opening the file directly no longer works, because
the page reads its data with `fetch`. Add `?sample=heavy` to the address to load 10 projects,
31 agents, a long lead conversation, and a full request queue. The Design notes button in the
sidebar links to the same sample.

To open the mock from another computer or a phone, use `--bind 0.0.0.0` and the server's
address. That address has no password, so anyone on the network can open it. The server shares
this whole folder, which includes `data/prod/` if a real export exists, so do not bind to the
network while an export is there.

This is an exploratory browser prototype. It does not connect to the engine. Its data has the
shape of the engine's database, and functions named after the engine's commands hand it to
the page. [data/README.md](data/README.md) explains the files, the functions, and how to load
a real export. Sending a message or making a decision changes only this page's memory, and
refreshing resets the work. The selected color mode is remembered in this browser when storage
is available. The first visit follows the device setting.

The page has three parts: `workbench.html` holds the markup and styles, `workbench.js` holds
the app, and `data/stubs.js` holds the data functions.

The owner requested the working app on 2026-11-05. A public marketing site
is outside this pass. LGcode is a separate product inspired by Herdr
Synapse and T3 Code.

## What to try

Open the first run with `?sample=first`, or from the First run links in Design notes. The links
cover one or two signed-in harnesses, only Codex, signed out, nothing installed, no repositories,
and a computer that could not be read. Add `&reset=1` to start again from the login page.

- Start on Home. Needs attention gathers requests across projects.
  Questions and Approvals support answers in place and retain answered history.
  Each request is one line; use its chevron or click the row to expand its
  details underneath. Click again to collapse. There is no split detail pane.
  Use search and the repository, project, agent, machine, and status filters.
  All projects opens each project's board. The bell links to the full queue.
- Select a repository name to see its projects. Use its chevron to expand
  the tree. Add Project starts a named project within a known repository.
- Select Workspace app to open its sprint board with Sage in the right
  chat panel. Agent recovery has Vale, and Desktop companion has Nico.
  Each project has exactly one lead. There is no Board row in the tree.
- Close the lead panel to widen the board. The lead button reopens it. On smaller screens it opens as a drawer. Escape closes the
  drawer. The expand control opens the full conversation, preserving its
  messages and draft.
- The branch appears once, in the top bar, after Inspecting. Inspect another worktree, and
  the list still marks the assigned one.
- On the board, select a sprint to see its tasks,
  owners, phase, dependencies, and completion evidence. Select a task to
  see the assignment and continue to its agent or changed files.
- In Sage's chat, select the message that Rowan needs a decision. It opens
  Rowan's exact question. Rowan stays highlighted until the question is
  answered. Answering clears Sage's request and the sprint's blocker too.
- Expand Build team and Review team to see their agents. Teams are named for their stage:
  Design team, Planning team, Build team, and Review team. Two teams in the same stage add
  their area, such as Build team · Exports. A single tab row offers Board, Chat, Terminal,
  Git, and Project settings, and a team adds Tasks at the end, so no other tab moves. Drafts and reading position stay with each
  conversation. Teams remember their last tab.
- Open Inspecting at the top right. The list groups this repository's worktrees as Git does,
  one line each, with the machine at the right. Type in its search field to narrow it.
  Selecting one changes the inspected code context. It does not change repository
  binding or redirect an agent. Git displays the selected workspace and follows its owning project and machine.
- Select the repository, project, or team in the top bar. Each opens its page.
- Press Control + B, or Command + B on a Mac, to fold the sidebar into a rail of icons. The
  browser remembers it. The button at the top of the sidebar does the same.
- Open Rowan's chat. One line under the tabs names him, his role, and his status, and no
  title repeats the top bar.
- Press Control + K and type "ro". Names that start with the query come first, and each row
  shows what needs attention. Escape closes it.
- Send a message to see a reply. Stop cancels
  a pending reply. Both messages and drafts are scoped to their conversation.
- Add a task to an active sprint. Completed sprints do not accept new tasks.
- Every project board starts with a stage strip: Design, Plan, Build, Review, and Hand over.
  The repository page lists each project's stage.
- Open Desktop companion. It is in the Design stage, so its board is empty and points to the
  mocks. The Mocks tab sits after Board in any project that has mocks.
  - Screens lists each screen with its revision count. The frame shows the screen built from
    real code, at phone or desktop size, with the four-project or ten-project data.
  - Ask Nico for a change while a screen is open, such as "make it denser", "bluer",
    "rounder", or "add lines". The screen changes in place, and Changes records it.
  - Edit design opens OpenPencil on the project's design file, once OpenPencil runs.
    [openpencil/README.md](openpencil/README.md) says how to start it.
  - Data lists the fields the screens use and compares each with the schema: new,
    matches, or differs. Components lists what the screens use, real or draft.
  - Approve mocks promotes the drafts, moves the project to Plan, and starts a Planning team
    with a sprint of tasks to move components, change the schema, and wire each screen.
- Start a new project and tell its lead about screens, pages, or a design. The lead starts a
  Design team, the Mocks tab appears, and the screens arrive one by one.
- Open a repository page and choose Design. View shows the colors and the components every
  project draws from, with live previews. Edit opens OpenPencil on that design file.
- Repositories that stay on this computer go in `data/local/`, which git ignores. Open one
  with `?with=<id>`; Design notes lists the ones present. `?with=ananke` adds Ananke's
  onboarding mocks, which need Ananke's mock server on port 8091.
- Open Service settings, the gear at the foot of the sidebar, and choose Light, Dark, or Match
  system under Appearance.
- Open Design notes and choose Logged out, Login rejected, Session expired, or Session
  unavailable. The page says "Sign in to LGcode" under the logo mark. A rejected password
  shows in the error color under the field, and an expired session shows in the muted
  color. The unavailable page offers Try again as its main button.
- Open Git in Agent console. Commit says what it needs before it can be used.
- Open Phone notifications, the phone icon at the foot of the sidebar, and choose Refresh.
  The notice appears at the top right, below the bell.
- Expand a request on Home and answer it. The row eases open, and the answered row folds away.

## Existing page capabilities and new workspace views

The navigation footer is a row of icons for Phone notifications, Machines,
Subscriptions, Service settings, and Design notes, above the account and Log out. The top bar shows the connection state. Design notes
contains preview controls for session expiry, login errors, connection loss,
failed starts, permissions, and large-item failure.

Agent threads retain stop/resume, failed-start reasons, permission controls,
full large-item loading, tool calls, and delivery history. Sage surfaces team
permission requests alongside design questions. Stopping an agent cancels
its permissions while leaving its questions answerable.

The project workspace offers Board, Chat, Terminal, Git, and Settings tabs.
Terminal fills the main area below the tabs. The prompt sits in the terminal's own
grid, directly after the last output, with no input box or Enter button. The bar
above it holds named sessions, the branch, the machine, and the size in columns and
rows. `vim <file>` shows how a full-screen program takes over the grid; `:q` returns.
Sessions keep separate history and drafts. No real command runs: `help` lists the commands with canned answers.
Git combines a repository worktree tree, staging, commit messages,
fetch/pull/push, conflicts, unified or split diffs, and commit history. A split diff needs 900 pixels, as Visual Studio Code does; a narrower window shows it unified.
Team branches integrate into their project branch. Project integration into
main opens a review. Dirty source or destination worktrees block integration. Clicking a file opens its diff directly. Workspace Settings shows
the assigned repository, branch, folder, and machine, with a saved shell
preference for this project. The global Settings page retains service controls.

New project defaults to Start work tree. Its repository list also offers New repository, which creates a folder in the workspace folder and starts on main. The project name determines its
branch and folder, with a numeric suffix when needed. Unchecking uses the
selected machine's main checkout. Run on chooses the machine before the
project name. The dialog previews that host's branch and folder. Offline
machines and hosts without the repository cannot start a project. These are
in-memory examples; no Git worktree is created on disk.
Machines previews master/worker pairing and project placement. Subscriptions
supports multiple separate accounts for the same harness on each machine.
Machines uses compact tables for hosts and future project placement. Start
project on a machine preserves that choice, including when no repository is
available there. Changing future placement does not move running work.

[FEATURE-PARITY.md](FEATURE-PARITY.md) maps the live page's source to each
mock flow and states what still needs backend integration.

## The current layout

The owner rejected the first composition's nested project menus and
repeated cards. The current proposal uses repositories, projects, and teams
in a compact tree. Selecting a project opens its board with the project
lead conversation beside it. The chat has one compact header, quiet user
turns, readable agent replies, collapsed tool details, and a composer that
grows with the draft. Boards, sprint details, and tasks are separate pages.

The visual research inspected a [T3 Code interface screenshot](https://betterstack.com/community/guides/ai/t3-code/)
and [Cursor's agent interface examples](https://cursor.com/changelog/2-0).
The agent also read the owner's local Ananke Cursor build-order canvas.
Its explicit ownership, dependencies, phases, and evidence inform the sprint
model. No implementation code was copied. Layout and typography remain
proposals awaiting the owner's review.

The refinement captures use `previews/redesign-`. Browser results include
`previews/workspace-redesign-checks.json`. Earlier layout and selected-state
contrast measurements remain in `previews/projects-layout.json`. Earlier captures
preserve previous proposals for comparison.

## Browser checks

Serve this directory on port 4178, then run `node design/checks.mjs` from
the repository root with Playwright and its Chromium browser available.
Also run `node design/operations-checks.mjs`,
`node design/workspace-tools-checks.mjs`, and
`node design/workspace-redesign-checks.mjs` for operational and workspace flows.
Run `node design/revision-checks.mjs` for the terminal, Git height, naming, density,
new repositories, and the heavy sample.
Run `node design/onboarding-checks.mjs` for the first run, from login to the lead's first message.
Run `node design/home-checks.mjs` for global queues, filters, inline answers,
merge approvals, machine-aware creation, density, and keyboard navigation.
Run `node design/mocks-checks.mjs` for stages, stage team names, the Mocks tab, live
revisions, approval, the repository Design tab, and a local repository when one is present.
Each script accepts `MOCK_URL` for another preview address,
`PLAYWRIGHT_MODULE` for a local Playwright module path, and `CHROMIUM_PATH`
for an existing Chromium executable. It does not install dependencies.

The checks cover repository and project navigation, one lead per project,
sprint details, task ownership, workspace inspection, linked request
resolution, completed-sprint protection, shared board and lead chat, safe
messages, sample replies, and mobile focus. Both modes are checked at 390,
768, 1440, and 2560 pixels. The script saves screenshots and assertion
results under `previews/`.

## Where the visual directions came from

The UI plugin's local design catalog was queried for a cool, dense agent
workspace; a bright botanical team workspace; and a warm, focused workspace.
Its first and third results paired IBM Plex Sans with JetBrains Mono. Its
second result proposed an editorial pairing that did not fit this app.
Its suggested marketing page patterns did not fit the requested working app.
Those patterns and the second type pairing were discarded.

All three palettes are custom explorations, filtered through the UI skill's
craft rules. Harbor uses layered blue surfaces. Field uses green-tinted light
surfaces. Dusk uses layered plum surfaces with a peach action color. Each
used the operating system's available sans-serif and monospace fonts. Since
2026-11-08 the workbench uses Inter and JetBrains Mono, served from the repository, as
DESIGN.md records.

The owner selected Field as light mode and Dusk as dark mode on 2026-11-05.
Harbor remains in the initial screenshots as a historical candidate.
`DESIGN.md` records the palette decision. `tokens.css` contains the approved
mode tokens. The layout and typography remain exploratory.

The workbench keeps the design-forge template's token vocabulary.
Its sample marketing page was replaced by the working app requested by
the owner. The examples show proposed interfaces, not a claim that the
underlying features are available in the engine.

## Interface copy

The owner requested normal product language on 2026-11-06. Repeated sample,
mock, and preview disclaimers have been removed from the interface,
including its accessible labels, placeholders, replies, and save messages.
The implementation boundary remains documented in this file and
FEATURE-PARITY.md. This copy change does not connect any backend services.

## Refinements approved after the UI critique

The navigation and lead panel resize by dragging or with their focused arrow
keys. Home resets either handle. Four board columns fit at desktop width.
Phone users can use the status strip to jump between columns. Focused chat
is centered on larger monitors.

Find project or agent opens the quick switcher. Command or Control + K
also opens it, and the hint shows the key for the system in use. Arrow keys and Enter choose a result. Only projects needing you filters
the navigation tree, and the top-bar bell opens decisions, permissions, and
failed starts with direct links to the relevant thread item.

The sidebar now groups Home and Find project or agent above a border.
Projects has New project and Only projects needing you beside its repository
tree. Repository names still open their project lists; there is no separate
Repositories destination. Borders separate the project tree, repository
groups, and service pages. This replaces the earlier disconnected controls.

The composer shows current progress and stop/resume, a subscription picker,
and Add context for task and file references. Activity details link to Git.
Terminal's plus button starts another session within that worktree. Switching
projects, teams, or terminal sessions preserves each session's input.

## Home and density critique

Cursor is the primary comparison for working context and efficient use of
space. T3 Code is secondary; the owner's difficulty discovering its controls
is a constraint on this design. The latest comparison uses the official
[Cursor agents-window documentation](https://cursor.com/docs/agent/agents-window)
and [Cursor 3 announcement](https://cursor.com/blog/cursor-3).

`UI-CRITIQUE-2026-11-06-HOME.md` records the observed gaps, changes, and
remaining judgments. Fresh captures use `previews/home-final-`,
`previews/machines-final-`, and `previews/project-machine-final-`.
`previews/home-cold-verification.md` records independent functional verification.
