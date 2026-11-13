# LGTM Studio: the feature list

Status: **draft, not approved.** The foundation is merged into `master`, so
clients reach the built features through the web page, the command-line tool
and the client API. The owner lifted the development freeze on 2026-11-08
for the website build.

Each feature has a short name, one paragraph saying what it does, and a state:
**idea** (written down, not agreed), **agreed** (the owner wants it), or
**built** (merged and working).

The state **built in the engine** dates from when the engine had its own
branch, and that code is now on `master`. A feature is **partly built** when
only some of what its paragraph describes is merged; the note after it says
which part. The states were last compared with the code on 2026-11-07 by
searching for the matching source, not by running each feature.

An earlier, much longer list of message-board features was written for the
Synapse fork. It is at `docs/message-board/features.md` in the
`herdr-synapse` checkout, and it is the main input for section 2 below.

## The next piece: installation and configuration

- **Standalone installer and startup at login** (agreed, 2026-11-05).
  Install the `lgtm` command and let the owner start the service at login.
  The engine, board, and website run without Herdr.
  The optional plugin lives in `plugins/herdr` and calls the installed command.
  The installer and login integration are not built by the rename and split.
- **Project configuration in `.lgtm`** (agreed, 2026-11-05).
  Define the folder's contents and loading rules in the next piece.
  The owner decided on 2026-11-11 that `lgtm init`, run in a repository,
  creates the folder. It writes the template files, puts the project in setup
  mode, copies the global settings from `~/.lgtm` when LGTM Studio was set up
  globally before, and starts the setup conversation with the owner's
  preferred harness.
  Agents can read the folder, and changes require the owner through the
  existing settings protection.
- **An overridable default workflow** (agreed, 2026-11-05).
  LGTM Studio ships a default workflow.
  People can override its team definitions and instructions.

## 1. The foundry: roles and their lifecycle

- **Repeat the roles stall check without the cache wait** (agreed,
  2026-11-05). The owner can run `pnpm live-check:roles --skip-timed-flush`
  to repeat the team collection and first stall without waiting for the
  cache timer. The report marks the timed flush as skipped. The run remains
  incomplete and exits with code 1, even when every remaining step passes.
- **LGTM Studio tools need no harness approval** (agreed, 2026-11-05). An agent
  can call LGTM Studio's own Model Context Protocol server in every permission
  mode on Claude, Codex, Gemini, and Cursor. The engine authenticates every
  call and checks the caller's existing rights. Other servers and native
  file and command tools continue following the selected mode. The settings
  belong to the managed session or process, not the owner's harness settings.
- **Orchestrator** (built). The top-level agent. It receives the owner's goal,
  decides which teams to staff, and talks to team leads, not to workers.
- **Team leads** (built). One per team. A lead plans its team's work, hands it
  to workers, and reports to the orchestrator.
- **Worker kinds** (idea). Workers have a kind, such as implementer,
  reviewer, or researcher, and a harness, such as Claude Code or Codex. The
  kind decides what the worker is told; the harness decides how it is run.
- **Start, stop, and reuse** (idea). The foundry starts agents, retires them,
  and reuses an idle worker instead of starting a new one when it can.
- **Two run modes for every harness** (agreed). Each harness has a run-mode
  setting, which the client API exposes, so it can be changed from a phone.
  - **ACP mode** (built first; partly built in the engine: unit 6a starts
    the agent, opens its session, sends prompts and turns its updates and
    permission requests into events; unit 6b pauses and returns agents for
    their accounts; unit 6c records crashes, sweeps leftover process groups
    and tells a signed-out account from one out of usage; unit 6d recovers
    agents after an engine restart: it reloads each one with a new token,
    scans the replayed history for delivery ids, then sends a carry-on or
    re-sends, returns paused agents, and supports `resume --fresh`; unit
    7a answers every connection with 503 until recovery ends). LGTM Studio starts the agent as a child process
    and drives it through the Agent Client Protocol (ACP): it opens a
    session, sends prompts, and receives structured events (text, plan, tool
    calls, permission requests). Adding a harness means adding its ACP
    command, so Claude Code, Codex, Gemini CLI, OpenCode and the rest come
    almost for free. Claude Code and Codex need their adapters,
    `claude-agent-acp` and `codex-acp`.
  - **Interactive mode** (built second). LGTM Studio opens the harness's normal
    terminal program in a Herdr pane through the optional plugin, and the owner
    can watch it and type into it. Use this for Claude when the 5-hour limit
    matters: Claude in ACP mode runs through the Agent SDK, which T3 Code
    reports drains the 5-hour limit faster than interactive Claude Code.
  - Both kinds of agent share one board, roster and thread view. Only the way
    a post is delivered differs: an ACP agent receives it as a prompt, and an
    interactive agent receives it through its hooks or a typed nudge when it
    is idle. See [research/acp.md](research/acp.md).
- **Several accounts for every harness** (agreed, 2026-11-01; partly built
  in the engine: unit 6b picks an account, reads its secrets, gives a second
  Codex account its own shadow home, pauses agents whose account signs out or
  runs out of usage, and returns them when the account is available again;
  unit 7a carries the accounts command over the API). The owner can
  set up more than one account for a harness, such as two ChatGPT accounts
  for Codex or three Cursor accounts, and LGTM Studio spreads agents across
  them. Each account is its own sign-in, kept apart by its own home
  directory (`CODEX_HOME` for Codex, `CLAUDE_CONFIG_DIR` for Claude Code) or
  by its own API key, plus any extra environment variables. Starting an agent
  names an account, or asks for any account of that harness. Secrets are
  stored as references and never written to the event log. The design is T3
  Code's "provider instances", including Codex's "shadow home", which lets
  two Codex accounts continue the same threads. See T3 Code's
  `docs/user/providers-codex.md`, `providers-claude.md` and `cursor.md`, and
  `packages/contracts/src/providerInstance.ts`, at commit `6fc9144`.
- **A token for every agent** (built in the engine: units 5a and 5b). When LGTM Studio starts an agent, it mints a
  private token for it and passes it in an environment variable. The agent
  proves who it is with that token, not with the pane's environment or the
  process tree, so Codex's sandbox and a backgrounded Claude stop breaking
  identity. Borrowed from T3 Code; see
  [research/t3-code.md](research/t3-code.md), item 1.
- **LGTM Studio's tools over MCP** (built). The board's verbs (post, read, finish
  work, ask the owner) are offered to agents through a Model Context Protocol
  (MCP) server on a loopback address, as well as through the command line.
  Every tool declares which roles may call it. See research item 1.
- **A permission ceiling** (built in the engine: units 5a, 5b and 6a; unit
  6a sets back a mode change made inside the agent). An agent that a lead starts, swaps or
  messages never runs with a broader permission mode than the lead. See
  research item 6.
- **Hand-offs built from records** (built). A replacement worker starts from a
  hand-off that LGTM Studio builds from the work brief, the worker's posts, the
  files it touched and the commands it ran, with no model turn spent. See
  research item 5.
- **Role rules enforced** (idea). The command handler refuses an action that a role's rules forbid, such as a worker starting an agent or asking the owner. It reads a role table that the team's definition supplies. Version 1 only advises and reports (roles decision row 10).
- **Pin Claude Code's shell folder at launch** (idea). A launch setting, such as `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR`, would keep Claude Code's shell in the session folder. Standing rules could then match Claude agents, whose shell input names no folder (roles round 2, N5).

## 2. The message board

- **Channels and direct messages** (built). Each team has a channel. Leads can
  message the orchestrator directly. Workers can message each other.
- **Wake rules** (built). Each post says whether it needs an answer. Only a
  post that needs an answer wakes its recipient, because every wake costs a
  full agent turn.
- **System events in a log** (idea). Joins, exits, and status changes go to
  an event log, not onto the boards that agents read.
- **A mailbox per agent, with receipts** (partly built in the engine:
  units 4a and 5d deliver to ACP agents, with queued, sent and accepted
  steps and request receipts; the hook and typed-nudge paths for
  interactive agents are not built). Every post is stored before
  it is delivered, and something is always responsible for delivering it. A
  post to an idle agent wakes it, a post to a busy Claude is steered into its
  running turn through a hook, and anything else waits for the turn to end.
  Each delivery is recorded with when and how it landed, so a wake can never
  be silently lost. See research item 3.
- **Wake Claude without typing** (idea). Each Claude agent keeps one
  long-lived `Monitor` running an LGTM Studio command that prints a line only when
  a post needs it. Claude Code starts the turn by itself, and nothing is typed
  into the pane. Other agents keep a typed nudge that only fires when the
  agent is idle. See research item 2.
- **Wait results that say why** (built in the engine: unit 5d's
  waits end with a reason per member, and unit 7b's `lgtm wait` exits
  with the codes below). A wait or a collection ends early,
  with a reason, when the agent it waits on is stuck on a question or an
  approval. The command line exits with 0 for done, 1 for failed, and 2 for
  waiting on an answer. See research item 7.
- **Post kinds** (idea). A label on each post, such as question, blocked, hand-off, done or decision, for filtering and for the dashboard. It was left out of the board's first plan, because the wake rule needs only "needs a reply" (board decisions row 14).
- **No acknowledgement-only posts** (idea). Refuse a reply that needs no reply to a post that needed none, to stop "thanks" posts. This is item 10 of the Synapse list, and it is not in the board's first plan.

## 3. Threads

- **One thread per agent conversation** (partly built in the engine: unit 6a
  writes each delivery's text, plan, tool calls and file changes as thread
  items; no client shows them yet). Every agent's conversation is
  visible as a thread, with its messages, approvals, and changed files, in the
  spirit of T3 Code.
- **Threads where the owner already works** (idea, 2026-11-01). The owner
  works in the terminal, with Herdr open inside Cursor and everything else
  hidden, and found T3 Code's separate chat window awkward to work beside.
  So threads should also be readable and answerable in two places besides
  the web page: a thread viewer that runs in a Herdr pane, and a Visual
  Studio Code extension, which Cursor can also run. Forking Visual Studio
  Code itself was considered and set aside, because keeping a fork of an
  editor current is a large, permanent job. Both views are clients of the
  same client API.
- **Steer a thread from any client** (idea). The owner can read, answer, and
  interrupt a thread from the web page, a desktop app, or a phone.

## 4. The client API

- **One authenticated API for every client** (idea; partly built in the
  engine: unit 7a serves an authenticated WebSocket API on a Unix socket in
  the owner-only state folder, for the owner, paired devices and agents; unit
  7b adds the client library). The web page, a future
  desktop app, and a future mobile app all use the same API.
- **Device pairing** (dropped for phones and browsers by the owner on
  2026-11-03, in favour of one password; a pairing code remains allowed for
  worker machines). A new device is added with a one-time pairing
  code, as described in [SECURITY.md](../SECURITY.md).
- **Live updates** (idea; partly built in the engine: unit 7a's `subscribe`
  streams events, and an agent sees only its own and its children's). Clients receive board posts, thread events, and
  agent states as a stream, not by polling.
- **Updates that survive a sleeping phone** (partly built in the engine:
  units 4a to 4c give request receipts, gapless subscriptions and
  snapshots, unit 7a serves them over the socket, and unit 7b's client library
  reconnects and resumes from its cursor). A client gets a snapshot
  and then only newer events, picks up where it left off after a reconnect,
  and every action carries a request id so a double tap acts once. See
  research item 9.
- **A browser terminal that cannot type into the agent** (idea). The page
  opens an agent's terminal read-only by default, and strips old terminal
  queries before replaying output, so the browser never answers them into the
  agent's input box. See research item 10.
- **Four phone alerts** (idea). The phone is alerted only for an owner
  question, an agent stuck on an approval, a stall that reached the owner, and
  a failed run. See research item 11.
- **Agents run in a sandbox** (agreed, 2026-11-05). Each agent runs inside
  bubblewrap, wrapped around the whole harness. Only its worktree is writable
  and `.lgtm` is mounted read-only. The owner's home folder, LGTM Studio's state
  folder and other processes are not visible. This replaces the earlier plan
  for LGTM Studio to run as its own Unix user, because bubblewrap needs no root
  access at install and leaves worktree files owned by the owner. Real Codex
  and Claude command-line runs worked this way on 2026-11-05, in a manual test.
  It is not built.
  A harness's login stays visible inside its sandbox, and how to hide it from
  the commands an agent runs is still open.
- **Agents use API keys without holding them** (idea, 2026-11-05). The
  engine runs a tool server such as Firecrawl's outside the sandbox with the
  key, and agents call the tool. A proxy that swaps a placeholder for the real
  key may follow for scripts. Trusted steps such as test commands run outside
  the agent's sandbox. It is not built.
- **macOS support for the ancestry check, engine and client** (agreed). Version
  1 runs on Linux only, so the client refuses to send the owner credential on
  any other system, and the engine refuses it too. The owner agreed on
  2026-11-01 ("yeah linux only for now. shoud be easy enought to port to
  macos") that macOS comes later, as a port after version 1. The port adds
  the `ps -o ppid=,lstart=` ancestry reader to the client and the engine, and
  a macOS reader for the leftover-process sweep. See issue 183 and issue 120
  in [issues.md](issues.md).
- **Filtered live updates** (idea). A subscription for phones that is filtered by agent and by event kind, with checkpoints that keep the cursor moving.
- **One password login** (built). The service reads the password from the environment variable `LGTM_WEB_PASSWORD`, and the dashboard asks for it. One person uses LGTM Studio, and a logged-in session is the owner. This replaces the device pairing entry above (client API rows 184 to 188).
- **Owner phone notification actions** (built, 2026-11-08). The owner can
  retry a failed notification through the configured service and send a real test
  notification. Retry validates the displayed generation and attempt, and records
  the next result and its time. A test creates no alert and stores no carrier
  response. Declining the first waiting request's phone notification offer is
  remembered across service restarts.
- **Phone alerts through one sender** (built). Phone alerts go through one sender interface, `AlertSender`, with ntfy as the first carrier. A later carrier, such as Expo's push service for the phone app, slots in behind it (client API row 83).
- **Mobile login** (later). Starts by looking at what Home Assistant does.
- **VS Code extension** (later). One of the last things, along with the mobile app, by the owner's answer of 2026-11-03.

## 5. The stall watch

The orchestrator and the owner lead the work. The stall watch is the part of
LGTM Studio's background service that keeps every agent moving without
spending their turns. It never decides what the work is; it only notices when
an agent has stopped and nudges it back, or tells its lead.

- **Stall detection** (built). The stall watch knows each agent's work state (off,
  assigned, working, waiting, done) and notices an agent that has stopped
  without finishing. It wakes the agent once, then tells its lead. A worker
  that stalls three times in a row on the same work is replaced. The rules
  come from Synapse-list items 23 and 24 (see
  [research/herdr-and-synapse.md](research/herdr-and-synapse.md)).
- **Usage-limit pauses are not stalls** (built). An agent stopped by a usage
  limit is resumed when the limit resets, and the pause never counts toward
  replacing it. See research item 8.
- **Stuck input boxes and approval dialogs** (idea). An agent whose input box
  has held the same text for a long time, or that is waiting on an approval
  dialog, is reported to its lead.
- **Compaction timed to the prompt cache** (built). An idle Claude agent with a
  large context is compacted two minutes before its prompt cache expires, not
  after, because a wake after the cache expires costs about 20 times more for
  the cached part. Posts that need an answer and can wait are delivered
  before the cache expires. See research item 4.
- **Replacement waits for the lead's team** (agreed, 2026-11-07). When a
  lead has not answered three nudges, the stall watch marks the lead as advised
  for replacement and tells the orchestrator. When the lead's workers have all
  finished, the stall watch tells the orchestrator that the lead is ready to
  replace. The new lead starts from the original order and the old lead's
  transcript, and it reaches the team's workers directly. Issue 520 holds the
  details.
- **Runaway work** (built). Work that runs far past its expected length is
  reported to the lead, and can continue in a fresh agent with a built
  hand-off.
- **Cache lifetime setting** (built). A per-harness `cacheLifetime` setting, five minutes or one hour, for timing compaction when the adapter does not report which cache lifetime it wrote (roles round 1).
- **"Compact me when I am next idle"** (idea). An agent asks the stall watch to compact it after its current turn. This replaces the Foundry's `want-<name>` file for the context-keeper.

## 6. Source control

- **Remove agent credits when merging** (agreed). A setting, off by default,
  that each project can override. When LGTM Studio merges a worker's or a team's
  work with a merge commit or a squash commit, it removes the lines that
  credit a coding agent from that commit's message: `Co-authored-by:`
  trailers for known agents, and footers such as "🤖 Generated with Claude
  Code". Human co-authors stay credited. The original commits are not
  rewritten. The client API exposes the setting, so it can be changed from a
  phone. The code is T3 Code's own, copied with its MIT licence into
  [third_party/t3code/](../third_party/t3code/README.md).

## 7. Repository, project, and team navigation

- **A workspace folder chosen at installation** (agreed, 2026-11-05).
  Installation asks which folder contains the owner's repositories.
  Repository setup stays on the host. The mock uses known sample paths.
- **Repositories contain projects** (agreed, 2026-11-05; mocked in
  `design/mock/`). Repositories are the top level of navigation.
  Each repository has a page listing its projects and an Add Project
  action. Multiple projects can work within the same repository.
- **Exactly one lead per project** (agreed, 2026-11-05; mocked). Selecting
  a project opens its sprint board, updated on 2026-11-06. A right chat
  panel opens the project lead alongside that board. Each project has its own
  goal, sprint board, teams, and messages. The owner's clarification
  replaces the earlier ambiguous request for multiple leads within a
  project. Multiple projects have separate leads.
- **Start a project through its lead** (agreed, 2026-11-05; mocked).
  Add Project creates a named project under a known repository and opens
  its lead conversation. A new project has no sprints or teams until its
  plan is shaped. Existing projects never reopen repository setup.
- **Dedicated project worktrees** (updated by the owner, 2026-11-09).
  Every project has its own worktree. Add Project has no worktree checkbox.
  A safe version of the name determines its branch and worktree folder.
  Numeric suffixes resolve existing names. The dialog always previews Branch
  and Folder before submission. The repository main checkout remains recorded
  for the owner’s review and approval.
- **Workspace settings** (agreed, 2026-11-06; mocked). A Settings tab beside
  Board, Chat, Terminal, and Git shows the assigned repository, branch,
  checkout type, folder, and machine. It stores a project-specific terminal
  shell preference in the preview. Service settings remain a global page.
- **A project board of sprints** (agreed, 2026-11-05; mocked). The Kanban
  board shows Planned, In progress, Review, and Done. A sprint contains
  the plan's tasks and shows ownership, current phase, dependencies,
  blockers, and completion evidence. Team task lists and sprint details
  read the same assignments. The owner referenced Ananke's Cursor
  build-order roadmap. No implementation code was copied.
- **Talk to the lead beside the board** (agreed, 2026-11-06; mocked).
  The navigation tree has no separate Board row. The board has a right
  chat panel with its single lead and a working sample composer. It
  shares messages, drafts, and reading position with the full conversation.
  The panel can be collapsed. On smaller screens it opens as a drawer
  with contained keyboard focus and Escape to close.
- **The project states its assigned branch** (agreed, 2026-11-06; mocked).
  The sidebar shows it under the project name beside the lead. The board
  repeats it beside the title. The top-right picker says Viewing and only
  changes inspected code context. It leaves the project assignment intact.
- **Completion reflects evidence** (mock behavior, 2026-11-05). A completed
  sprint records verification and merge evidence. Release status is
  separate. Completed sprints do not accept new tasks. Moving a card is
  not offered as a substitute for verification or merging.
- **Teams and individual conversations** (agreed, 2026-11-05; mocked).
  Teams appear under their project. Each team has Chat, Tasks, and Changes.
  Each agent also has a direct conversation. Disclosure controls expand
  the tree independently of navigation. Senders identify their coding tool.
- **Conversation continuity** (agreed, 2026-11-05; mocked). Each conversation
  keeps its draft and reading position while navigating. A team remembers
  its last view. Messages and these preferences remain in memory until
  refresh. Sample replies can be stopped and are explicitly labelled.
- **Branches and workspaces in the context menu** (agreed, 2026-11-05;
  mocked). The menu lists the selected repository's branches, workspace
  paths, ownership, and activity. The mock treats selection as inspection:
  it changes the viewed code context and Changes view. It never changes
  the repository or redirects an agent's assigned workspace.
- **Project leads surface team requests** (agreed, 2026-11-05; mocked).
  Sage can point to Rowan's design question. The project and requesting
  agent are highlighted, and the affected sprint shows its dependency.
  Selecting the request opens Rowan's conversation at the exact question.
  Answering clears every indicator. Viewing alone does not resolve it.
- **Compact chat composition** (agreed, 2026-11-05; mocked). The header
  combines identity and navigation. User messages have a restrained
  treatment. Agent replies use readable text with grouped tool details.
  The composer grows when needed and retains its recipient label.

### Existing page capabilities the redesign must retain

Agreed on 2026-11-06 and represented in the browser mock. These are existing
product capabilities, not permission to remove them during implementation.
The source-to-mock mapping was `design/FEATURE-PARITY.md`. It was removed with the older
workbench on 2026-11-12, and it remains in the git history.

- Login, logout, and session expiry stay available. Rejected login and an
  unavailable session have explicit recovery states. Entered secrets clear
  when the session ends.
- Connection status stays visible. Reconnection retains the last received
  state and drafts. Stale views do not offer functioning mutation controls.
- Permission requests show their identity and action input before approval.
  Hidden inputs, held requests, denial, cancellation, and unconfirmed
  answers remain distinct from an agent's ordinary text.
- Agent stop and resume stay available. Stopping cancels permissions but
  preserves questions. A fresh resume explains its loss of prior context.
- Failed starts keep the current safe reason categories and prevent sends.
- Large thread items keep an explicit full loader with failure and retry.
- Tool calls keep identity, status, input, and output. Deliveries retain
  their sender, source, identity, and history.
- Alerts and Settings remain full pages. Alerts retain pagination, subject
  links, and notification delivery failures. Settings retain all current
  notification and web-server controls.

### Workspace scope and navigation refinement

Approved on 2026-11-06 after comparison with T3 Code and Visual Studio Code.
These interactions are represented in the browser mock.

- One workspace tab row follows the selected project, team, or agent.
  Git in team scope selects that team's worktree. The header names the
  worktree's branch, team or project, and machine.
- Team worktrees integrate into their project worktree. Project branches
  reach main through explicit owner review. Dirty source or destination
  worktrees and unresolved conflicts prevent integration.
- Each worktree has its own staging selection, commit message, history,
  incoming/outgoing state, and file diff. Git includes Commit, Fetch, Pull,
  Push, and conflict resolution controls.
- The navigation and project lead panel resize with pointer or keyboard.
  Focused chat stays centered and readable on wide monitors. The board fits
  four columns beside its lead at desktop width. Phone users have a status
  strip for jumping between columns.
- Composer controls show current agent progress, stop/resume, subscription
  choice, and attached file/task context. Activity details link to Git.
- An attention summary distinguishes decisions, permissions, and failed
  starts. A navigation filter hides projects with no unresolved attention.
  A keyboard quick switcher searches projects, teams, and agents.
- Named terminal sessions preserve independent input and command history
  within each machine and worktree. Context changes save the old session
  before selecting the destination.

### Terminal, Git, machines, and subscriptions

Requested on 2026-11-06. Interactive views are mocked. Live terminal and
machine coordination are not implemented by this design pass.

- The main conversation can switch to a terminal. The intended product
  provides actual direct commands on the selected machine and workspace.
  It needs an authenticated terminal session with streamed output,
  interruption, resizing, and reconnection. The current mock never runs a
  command. The owner requested normal product copy without repeated mock
  disclaimers on 2026-11-06. Prototype boundaries remain in design documentation.
- Git combines a changed-file tree with unified and split diffs. Clicking a
  file directly opens its diff. Branch-aware commit history uses the same
  pane. There is no separate Diff tab or intermediate file preview.
  Live repository reads, Git mutations, and merge validation remain integration work.
- One computer runs the master process. Other computers pair through a
  connect mode and act as workers. The master assigns projects across
  machines. Pairing, availability, host identity, and project placement
  need authenticated coordination and recovery without duplicate work.
  The machine page is a preview and does not move running work.
- A Subscriptions page supports several named accounts for the same
  harness. Each entry has its own machine, enabled state, and sign-in.
  Additional subscriptions do not reuse the default Codex authentication.
  The engine's existing account/profile separation must be preserved.

### Global Home, machine choice, and screen density

Requested on 2026-11-06 and represented in the browser mock.

- Home is the initial global page. Needs attention combines unresolved
  questions, permissions, failed starts, and project merge reviews across
  all projects. All projects opens each project's board.
- Questions and Approvals have their own global lists with answered history.
  Search combines with repository, project, agent, machine, and status filters.
  Requests are single-line disclosures, collapsed initially. Their details
  expand directly underneath rather than in a split pane. The same toggle
  closes them and retains keyboard focus.
  Questions and permissions can be answered without leaving Home. Merge
  requests retain the explicit review step. Links open the source conversation
  or board, preserving drafts and the requesting team's branch context.
- Add Project chooses a machine through Run on before the project name.
  The preview shows that host's branch and folder. Offline hosts and hosts
  without the repository cannot start work. The owner approved a dedicated
  worktree for every project. New project has no worktree checkbox and always
  previews Branch and Folder. No host is silently substituted.
- Machines uses compact tables for machine status, role, agent slots,
  project counts, start actions, and future project placement. Future
  placement does not relabel running work or imply that a project moved.
- Cursor is the primary design reference. T3 Code remains secondary, with
  explicit discoverability and space usage requirements from the owner.
  These flows remain an isolated prototype; durable queues and machine
  execution require service integration.
- Sidebar boundaries separate Home/search, Projects, and service pages.
  New project belongs to Projects. Only projects needing you names the tree
  filter's effect. Repository names open their project lists; a second
  Repositories destination is unnecessary and has been removed.

## 8. The build loop

The full design is in
[specs/2026-11-05-build-loop-design.md](specs/2026-11-05-build-loop-design.md).

- **A default workflow as a parsable list** (agreed, 2026-11-05). The eight
  phases become a list of steps that LGTM Studio reads. LGTM Studio looks in the
  repository's `.lgtm` first, then `~/.lgtm`, then its built-in copy. The
  default install places a copy in `~/.lgtm`.
- **`.lgtm` is read-only to agents** (agreed, 2026-11-05). Agents can read
  it and cannot edit it.
- **Skill files for any agent** (agreed, 2026-11-05). LGTM Studio ships skill files
  that let any agent work with it.
- **A project setup agent** (agreed, 2026-11-05). It tells the owner what the
  project is made of, asks for the general direction, talks through testing,
  and produces a local `.lgtm` folder with a config file. How that reaches a
  folder agents cannot edit is open.
- **Optional testing** (agreed, 2026-11-05). The owner can turn tests off, and
  can also turn agent review off. They can turn tests on later through their
  main agent.
- **Scored stops on stuck statements** (agreed, 2026-11-05). A script scores
  review findings by the statement they come from. A stuck statement pings the
  owner, who keeps, changes or drops it.
- **A limit on review rounds** (agreed, 2026-11-05). Past round 3, another
  review runs only for blockers and majors. Rounds 5 and 6 need the owner's
  approval, and 6 is the limit.
- **Autonomous fix sprints** (agreed, 2026-11-05). A fix that users would not
  notice merges and moves on without the owner.
- **A hotfix lane** (requested by the owner, 2026-11-06; not designed). The
  owner asks the project lead for a hotfix, and it starts a very limited team
  focused on fixing and pushing.
- **A way to bisect** (requested by the owner, 2026-11-06; not designed). A
  command finds the commit that broke something by halving the range of commits
  at each test.
- **A way to freeze interfaces** (requested by the owner, 2026-11-06; not
  designed). A frozen interface cannot change while teams build against it.
- **The design file is the source of truth** (decided by the owner, 2026-11-07;
  not designed). A project's design lives in a Figma-format `.fig` file. LGTM Studio
  runs OpenPencil, the open-source editor from openpencil.dev, on the same
  computer and shows it inside its page. OpenPencil opens only while someone is
  designing, looking at components, or weighing an edit. Mocks that are only
  looked at are built from the project's real code, so what the owner sees is
  what users get, and any gap between the mock and the design gets fixed.
  Since 2026-11-08 the web mock shows OpenPencil's web editor in a frame, built
  from source in `design/openpencil/`. It opens a
  repository's design file but cannot save into the repository yet. Saving back
  needs an endpoint that writes the file, or OpenPencil's automation bridge.
- **Teams named for their stage** (requested by the owner, 2026-11-07; not
  designed). A project moves through a Design team, a Planning team, a Build
  team and a Review team, in place of hand-picked names. The project page shows
  which stage the project is in.
- **Mocks made by the Design team** (requested by the owner, 2026-11-07; not
  designed). A project with user interface work gets a Mocks tab. The mocks use
  the project's real components and realistic, invented data, as Ananke's mocks
  did. While designing, the team records the fields the screens need and supplies
  reviewed comparisons with the real schema, as approved by the owner on 2026-11-09.
  The engine does not infer an application schema from mock data files.
  Fields without a supplied review remain unavailable. When the mocks are approved, new
  components move into the real component folder, and wiring them to real data
  becomes the Build team's tasks.
  The owner approved supported scenario routes on 2026-11-09, in item 2 of the
  website simplification shortlist. Each screen keeps its base route and only
  the concrete routes supplied for its supported declared scenario identities.
  The supported list may be empty. The engine does not invent missing routes
  or infer bindings from scenario names. Existing revisions remain unchanged.
- **A Reverse Fig skill** (requested by the owner, 2026-11-07; not designed).
  When someone connects a project that already has an interface, the skill
  turns its existing components and screens into a `.fig` file, so the design
  becomes the source of truth. Reverse Fig goes only from code to the design.
  The owner decided on 2026-11-08 that the conversion from the design file to
  code is a separate tool, built later as part of the Build team. A test
  on 2026-11-07 did this for three of the mock's components with OpenPencil's
  command-line tool. The result had real component sets, variants and color
  variables, and it exported back to React components. Some styling was lost
  on the way.
  A first version is in `skills/reverse-fig/` since 2026-11-08. It covers color tokens and
  components, not screens. Everything specific to a project lives in a profile
  file, so each project tunes its own profile.

## 9. Client mode

- **LGTM Studio in client mode** (requested by the owner, 2026-11-06; not designed).
  One main LGTM Studio holds the event log, the board and the website. Other machines
  run LGTM Studio in client mode and take their commands from the main one, so a
  project's load spreads across machines. How a client machine proves who it is
  needs the owner's word, because the login rule is one user, one password and no
  pairing.

## 10. Design and mock modes

- **Design mode and mock mode** (requested by the owner, 2026-11-07; not
  designed). The website gains an integrated design mode and a mock mode, so
  the owner can use it to design and update the mocks of projects and apps.
  Each project lists all of its mocks. For example, the owner could open the
  website, go to Ananke's mocks, and see every one of them there. The owner is
  adding this to the website mock first.

- **Recorded mock previews and OpenPencil** (decided by the owner,
  2026-11-09; implementation pending). The engine renders a project's recorded
  mocks itself instead of starting a separate mock web server. The screen preview
  and OpenPencil stay in sandboxed frames. Both frames use one hostname other than
  LGTM Studio's, so the owner's cookie never reaches them. The page's content security
  policy permits frames from that hostname only. The engine starts and manages
  OpenPencil with access to only the project's design folder. No separate one-file
  capability is built. This decision does not add an editor save pipeline.
  On 2026-11-10, the owner approved `allow-same-origin` for the editor frame
  in addition to `allow-scripts`, so OpenPencil can use its display hostname
  storage. Recorded mocks retain an opaque origin. The editor receives no
  owner cookie or owner origin authority.

## Evaluation at project teardown

The owner raised these ideas on 2026-11-11. They are not decided. The decided
timing is a round after each phase step, in the build loop design's
"Evaluation rounds and the model ledger".

- When a project is torn down, LGTM Studio offers: "Would you like to evaluate
  how the models did from the session reports and help improve the model
  ledger?" The round runs only if the user says yes.
- The round reads the project's session reports and logs. The user reads the
  evaluation before anything else happens with it.
- The results are kept locally, in LGTM Studio's config files.
- LGTM Studio could send the results to a public endpoint, so that many users
  improve the shared model ledger. This sends data off the user's machine, so it
  needs the user's consent each time, and the payload must leave out code, file
  paths and anything else private. SECURITY.md applies to it.

## Open questions

- Which licence should LGTM Studio use?

## Decided

- **The product is named LGTM Studio** (2026-11-11). The owner chose the name
  on 2026-11-11 and confirmed the spelling, two words with a space. On
  2026-11-12 the owner asked for the full rename. The command is `lgtm`, the
  packages are `@lgtm/...`, the environment variables start with `LGTM_`, and
  the state folder is `~/.local/state/lgtm`. The configuration folders are
  `.lgtm` and `~/.lgtm`. The GitHub repository is `qnlbnsl/lgtm-studio`. The
  owner chose to start fresh, so nothing reads earlier names, and every
  record in the repository uses the new name.
- **The public site is `lgtmstudio.dev`** (2026-11-11). It is the product's
  public website. It is not the address where the owner's own instance runs,
  which stays out of this repository.
- **LGTM Studio product website** (2026-11-11). The owner selected LGTM Studio
  as the new public name and requested a separate product website.
  On 2026-11-12 the owner moved the website out of this repository.
  It is no longer kept here.
  This change does not rename the engine packages, commands, or state folders.

- **Language: TypeScript** (2026-10-30). One language for the backend, the
  web page and the future apps, so the client API's types are written once.
  See [AGENTS.md](../AGENTS.md), "Language".
- **How agents are run: both ACP mode and interactive mode, ACP first**
  (2026-10-30). This answers the earlier question "panes, a structured
  protocol, or both?". ACP mode is built first, because it is the quickest
  start and gives every harness at once. Interactive mode follows, chosen per
  harness in its settings. See section 1, "Two run modes for every harness".
  The T3 Code research's rule that every agent stays a visible session now
  applies only to agents in interactive mode.
- **The engine is built first, and it is finished when the Foundry needs
  nothing else from it** (2026-10-31). The software-foundry skill's Steps 3
  to 5 and 8 give eleven capabilities, all offered through one API that
  agents and the owner's phone both use:
  1. Start an agent, with its harness, model, effort, permission mode,
     folder, name and role.
  2. Let agents start, prompt and stop their own agents, never with wider
     permissions than their own.
  3. Prompt an agent, with the sender recorded.
  4. Report each agent's state, and say when it changes.
  5. Wake a waiting agent once, when one agent or a whole set finishes,
     without polling.
  6. Stream any agent's thread live to any client.
  7. Route each permission request to the agent that started the asker,
     which answers it or passes it up. The owner can answer any request.
  8. Alert the owner's phone for a request passed up, or a question.
  9. Let the owner open and prompt any agent's thread remotely.
  10. Stop, resume and compact an agent.
  11. Group agents, as the Foundry's tabs do.
  12. Run each agent under one of several accounts for its harness, added by
      the owner on 2026-11-01.

  The board's channels and wake rules, the role rules, git worktrees, usage
  meters and interactive mode stay out of the engine.
- **The engine is one service with an event log** (2026-11-01). One
  background service owns every agent. Everything that happens is written to
  an append-only, numbered log in SQLite before anything acts on it, and
  threads, states, waits and the live stream are read from that log. T3 Code's
  server has the same shape, and since Effect was chosen (the next entry),
  LGTM Studio can copy T3's event store with credit. The rejected options were
  saved tables updated in place, and one supervisor process per agent
  sharing files.
- **LGTM Studio is written with the Effect library** (2026-11-01). Effect is a
  TypeScript library for whole programs: failures are part of each
  function's type, every running task has an owner that cleans it up, and
  one schema both checks data and defines its type. The reason for choosing
  it is reuse: T3 Code is written with Effect 4, so its ACP client
  (`packages/effect-acp`), event store, accounts and device pairing can be
  copied with credit instead of rebuilt. LGTM Studio pins the same Effect
  version as the T3 Code commit it copies from, so the copied code compiles
  unchanged.
- **LGTM Studio runs on Node.js 26** (2026-11-01). Node.js 26 is the current
  long-term support line, and the repository's `.nvmrc` says `26`. A single
  file compiled with Bun was considered and not chosen: T3 Code's SQLite
  code uses Node.js's own `node:sqlite`, and the Claude Code ACP adapter
  needs Node.js anyway.


## The real browser check

`pnpm live-check:web` exercises a private engine with a real Codex agent and
Chromium. It verifies streamed replies, prompts, command permission answers,
reload, stop, resume and safe startup failures. It also creates a real project
and worktree through first-run setup, has its actual lead create a linked
sprint, task and question with supported tools, answers from the board, and
checks the durable result and exact receipt again after service restart. It remains separate from
`pnpm check` because it consumes the signed-in account's allowance.

## Evaluation rounds that update the model ledger

The owner asked for this on 2026-11-10. It is not built. At the end of each key
task and at the end of a project, the build loop runs an evaluation round. The
round grades each task from its reviews and later corrections, and it writes the
grades to the model ledger. The ledger feeds the list that says which model to
try for each kind of task. The design is in "Evaluation rounds and the model
ledger" in
[docs/specs/2026-11-05-build-loop-design.md](specs/2026-11-05-build-loop-design.md).

The owner decided on 2026-11-11 that model evaluation leaves Founder OS and becomes
part of LGTM Studio, as research. LGTM Studio ships one default model selection ledger, and each
user can update it.

## Questions that carry their own brief

The owner asked for this on 2026-11-11, and it is agreed for the mock. It is not
built in the engine. When an agent asks the owner a question, it writes a short
brief of the question, one line of description, a short recommendation, what the
question is about, why it matters, why it recommends its answer, and the files it
cites. A thread shows the brief first, with Accept, Deny and Details, and the
full card opens from Details. The mock in `design/mock/` shows the layout. The
engine's question records and the agents' instructions would need these fields.

## A file explorer in the Git view

The owner asked for this on 2026-11-11. It is agreed and not built in the engine. A
project has a "Files" tab, beside its Git tab, that works like the file explorer of an
editor such as Visual Studio Code. It shows a folder tree of the inspected worktree, and
the open file beside it. References in questions, approvals and plans link to a file and
open it here. The mock in `design/mock/` shows the tab at `/p/console/files`.

### Where the files come from

The files live on whichever machine holds the worktree, such as Studio or Buildbox. The
web page and the phone app never reach that machine themselves. They ask the LGTM Studio
service through the client API, and the service asks the machine. The rules are these:

- The service lists one folder at a time, so a large repository does not load at once.
  Each entry carries its name, its size, whether it is a folder, and its Git status.
- The service returns one file at a time, as text. A file over 1 megabyte, or a binary
  file, is not returned as text. The client offers it as a download, which the service
  streams from the machine.
- Images, such as SVG and PNG files, are returned as images and shown as pictures.
- Every path is checked on the machine against the worktree's folder, after symbolic
  links are resolved, so a request cannot read a file outside the worktree.
- The owner can edit a text file, save it, and commit it. "Simple editing in the Files
  tab" below describes how.
- When the machine is offline, the tab keeps its structure and says so. It shows the
  files again when the machine reconnects.
- The tab follows the "Inspecting" choice in the top bar. A branch with no worktree yet
  shows the base branch, with a note that says so.

### Which component shows the files

The owner asked on 2026-11-11 for the option that works best across platforms. The
choice is the stack that T3 Code uses, so that its code can be copied under the MIT
License:

- `@pierre/diffs` renders files and diffs. T3 Code uses it on the web and in its server,
  and its import style works in React Native as well.
- `@pierre/highlights` colours the code. T3 Code moved its web app from Shiki to it,
  because Shiki took most of the render time on large files and could freeze the window.
  T3 Code's phone app already uses the native form of `@pierre/highlights`.

Highlighting runs in each client, so the service sends plain text and stays simple. The
licences of the two Pierre packages have not been read yet, and they must be read before
any code is copied. Monaco, the editor inside Visual Studio Code, was not chosen, because
it does not support phones.

The owner chose CodeMirror 6 for the Files tab on 2026-11-12, because the tab now edits
files and the Pierre packages only display them. CodeMirror 6 works on the web and in a
phone's web view. The mock uses it, from one bundle in
[third_party/codemirror/](../third_party/codemirror/README.md), because the mock has no
build step. The Pierre packages remain the choice for the diffs in the Git tab.

## Plans written as HTML pages

The owner decided this on 2026-11-11. It is agreed and not built. From now on,
every plan in LGTM Studio is an HTML page. Planner agents fill in one template, and the
page is written to get the point across to the owner in a human-friendly way. The
plans the agents work from keep their full detail. Each sprint has its own plan, shown on
the sprint page beside the sprint's tasks. The tasks are the short version of the plan,
and each task links to the part of the plan it carries out. The mock shows sprint SP-07
with a real LGTM Studio plan converted to HTML. The template is not written yet.

## Files and images sent with a message

The owner asked for this on 2026-11-11. It is agreed and not built in the engine. The
owner can send files and images to an agent with a message. They come from a paperclip
button in the message box, from a drop on the message box, or from a paste. Images show
as small pictures before sending and as larger pictures in the thread. Other files show
as a name and a size. The mock limits each file to 100 megabytes, and that limit is not
decided. The engine would need to store the files, pass them to the agent's harness, and
serve them back to every client through the client API.

Large photos are resized before they are sent, decided by the owner on 2026-11-11. A photo
from a phone can be 50 megabytes or more, and the models scale large images down anyway.
The rules the mock follows are these:

- A photo whose long edge is over 2,048 pixels, or whose file is over 2 megabytes, is
  redrawn on the owner's device with a long edge of at most 2,048 pixels.
- The redrawn photo is saved as a JPEG at 85 percent quality. A 33-megabyte test photo
  became 1.1 megabytes.
- Redrawing drops the photo's camera details, including the place where it was taken.
- The chip shows "Resized from 33.4 MB to 1.1 MB", with "Send original" to send the file
  as it was. A sent photo is captioned with both sizes.
- Animated images and drawings in the Scalable Vector Graphics format are sent unchanged.
- A photo that the browser cannot read is sent as a file. A HEIC photo, the iPhone's own
  format, is marked "Converted by the service", because Chrome cannot read it. Raw camera
  files, such as ProRAW, are sent as files.

The service must apply the same rules to images that other clients send at full size. The
common server image library, sharp, cannot read HEIC in its standard build, so the service
needs a separate converter for it.

## Pushing a finished project and opening its pull request

The owner raised this on 2026-11-12 and decided its shape the same day. It is
**agreed**, and it is not built in the engine or the mock. Agents merge their work
locally, from an agent's worktree into its team branch and from the team branch into the
project branch. Nothing reaches the remote during that work. When the project branch
holds everything, LGTM Studio pushes that one branch and opens a pull request.

LGTM Studio is meant to be the one place where the work happens, so the merge button
lives in LGTM Studio, not only on the code host. The steps are these:

- **The project lead asks.** When every team branch is integrated, every worktree of
  the project is clean, and no merge is in progress, the project lead asks the owner a
  question. It says that everything is ready, summarises where the work stands, and asks
  whether to start a pull request. The question carries an "Open pull request" button.
- **The base can be changed.** A small menu next to the button chooses the branch the
  pull request merges into. By default it is the branch that the project's worktree was
  made from.
- **Push and open.** LGTM Studio pushes only the project branch. Team and agent
  branches stay local. It then opens the pull request through the code host, such as
  GitHub, with a title and description that the owner can edit.
- **Review in the Git tab.** To read the pull request's changes, the owner opens the
  project's Git tab. The project lead stays open in the side panel meanwhile.
- **Watch.** The project shows the pull request's number, a link, the state of its
  checks, and its review state. Later commits on the project branch, such as fixes
  after review, are pushed to the same pull request.
- **The final merge goes through the project lead.** The owner approves the merge in
  LGTM Studio, and the project lead carries it out. A merge made on the code host is
  noticed, and the project is marked merged.
- **No remote.** A repository without a remote keeps the local merge that the mock
  shows today.

The fix-sprint exception in rule 7 of AGENTS.md could use the same path, with the pull
request merged automatically after a passing full test run.

## Simple editing in the Files tab

The owner raised this on 2026-11-12 and decided its shape the same day. It is
**agreed**, and the mock shows it. The engine does not have it yet. The Files tab is a
small editor for minor changes, without autocomplete or other language features. The
owner edits only one file at a time. Anything bigger is work for the project lead, and the
owner asks the lead to do it.

- The editor is CodeMirror 6, as "Which component shows the files" above says.
- An edited file shows a dot in the folder tree until it is saved.
- A "Save" button at the top of the file saves it. The keyboard shortcut is Control+S,
  or Command+S on a Mac.
- A saved file is an uncommitted change in the inspected worktree. The tree marks it as
  changed, and the Git tab shows its diff.
- After a save, a "Commit" button appears at the top of the file. It opens a small dialog
  for the commit message, and it commits that one file as the owner. The message can be
  written by the cheap model, as in the Git tab.
- The base branch is read-only, because agents never edit it directly.
- When the worktree's agent is working, the tab says so above the file. After a save, that
  agent is told which file the owner changed.
- A save carries the version of the file that the owner opened. If an agent changed the
  file since then, the save is refused and the owner sees both versions. The mock does not
  show this case.
- Writes follow the same path check as reads, and nothing under `.git` can be written.
- Every action is a client API call, as rule 5 of AGENTS.md requires.

## A database tab with one keeper of migration numbers

The owner raised this on 2026-11-12 and decided its shape the same day. It is
**agreed**, and it is not built in the engine or the mock.

### Where the databases are listed

A repository lists its databases in its LGTM Studio config file, in the repository's
`.lgtm` folder. Each entry names the database, its kind, such as PostgreSQL or Firestore,
and where its schema and migrations live. When an agent sets up a new database, the entry
is written into the config file, so the list stays current. How the agent's change reaches
the config file is not decided yet, because agents cannot write to `.lgtm` today.

A project shows a "Database" tab only when its config file lists at least one database.

### What the tab shows

When the config file lists more than one database, a small bar at the top of the tab
switches between them, with a menu. With one database, the bar is hidden. The view
depends on the kind of database, and it stays simple:

- **Relational databases**, such as PostgreSQL and SQLite, show their tables, columns,
  keys and indexes, and the list of migrations.
- **Document databases**, such as Firestore and MongoDB, show their collections, the
  fields their documents usually carry, their indexes, and their security rules. Their
  migrations are usually scripts that rewrite data, and those are listed too.

Other kinds, such as key-value stores, wait until a project needs them.

### One keeper hands out migration numbers

Parallel agents that each write a migration pick the same next number, and the merges
then conflict. LGTM Studio's service keeps one counter for each migrations folder. An
agent asks the service for a number before it writes a migration. No two branches hold
the same number.

The config file only lists the databases. The service tracks the migrations in its own
local SQLite database, where it records these things:

- which number was given to which agent, on which branch;
- which numbers are already in the base branch;
- which numbers are still being worked on;
- whether each migration's tests have passed, and on which commit.

A number is a reservation until its migration reaches the base branch. Branches often
merge in a different order from the order they reserved in. For example, branch 1
reserves 123 and branch 2 reserves 124, while the base branch ends at 122. If branch 2
is ready first, it merges as 123, the next number after the base branch. The service
then tells branch 1 to renumber to 124 and to run its tests again on the new base. So
the final numbers follow the order of the merges.

Renumbering depends on the migration tool:

- Tools that order migrations by a number in the file name, such as Flyway and
  golang-migrate, need a rename. LGTM Studio can do that rename itself.
- Tools that chain each migration to its parent, such as Alembic and Django, need the
  parent reference rewritten. The agent that owns the branch does this.
- Tools that name migrations by timestamp, such as Rails, Prisma and Drizzle, rarely
  collide on names. They can still apply migrations in an order that nobody tested, so
  the rerun of the tests on the new base still applies.

## A one-sentence reason on every approval request

The owner asked on 2026-11-13 for an approval card to say what is being attempted.
The live website can name only the program, because a harness reports the command and not the reason.
The engine could ask the requesting agent for one sentence of intent, or take it from the agent's last message before the tool call.
The card would then show that sentence as its summary.

## One Harnesses page in place of harness settings and Subscriptions

The owner asked for this on 2026-11-13.
One page lists every harness.
Each harness shows its accounts and subscriptions.
A button on a harness adds another account or subscription.
Adding an account checks whether the harness is installed.
A harness that is not installed shows its install script and is installed from the page.
"Subscriptions" then leaves the left navigation.

## A harness installer

The owner asked for this on 2026-11-13.
LGTM Studio installs a missing harness by itself.
The page shows the install script before it runs.

## Notifications with more than one kind of delivery

The owner asked for this on 2026-11-13.
The page and its navigation entry are named "Notifications".
Delivery kinds are added, starting with email and ntfy, and others may follow.
Email is sent through the user's own mail account, with the user's own credentials or key.
LGTM Studio's maker never sends the email.

The engine and website support independent email and ntfy delivery as of 2026-11-13.
Email uses the owner's Simple Mail Transfer Protocol (SMTP) server through Nodemailer.
The owner can remove its settings and store its password from the terminal.
Quiet hours expose a held state and allow an override for agent failures, account problems, and a web server outage.
Each configured carrier has an enable switch and a test action.
Tests report whether that carrier accepted the message.
Quiet hours use a start, an end, and a named time zone.
The owner can let failure alerts through during quiet hours.
Sprint completion events raise sprint alerts, which are off by default.
Opening an owner merge review raises a merge alert.
Passwords and access tokens stay in the owner's secret store.
Clients receive only whether a secret is set.


## A Workflows tab with a visual editor

The owner asked for this on 2026-11-13.
The build loop is shown in a "Workflows" tab.
A user sees the default workflow as a picture.
A user clones it and changes the copy in a visual editor.
A user can also make a workflow from nothing.
