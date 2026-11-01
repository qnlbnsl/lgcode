# What Shepherd keeps from Herdr and Herdr Synapse

Researched on 2026-10-30, from Herdr 0.9.3 on the owner's machine and the
Herdr Synapse checkout one folder up from this repository (the owner's fork,
version 0.23.0). The Foundry currently runs the upstream Synapse 0.20.0, not
the fork.

"Synapse-list item N" means item N of the earlier message-board feature list
at `docs/message-board/features.md` in the `herdr-synapse` checkout. That list
has 60 items and records the owner's decisions of 2026-10-25. It remains the
main input for Shepherd's message board.

## Herdr: what Shepherd stands on

Herdr is a terminal workspace manager for coding agents. It has a terminal
client, a server that keeps running when the client closes, and a socket
interface that answers in JSON. Shepherd uses these parts of it:

- **Visible agent sessions.** `herdr agent start --kind <kind>` starts an
  interactive agent in its own pane. Herdr knows 24 agent kinds, including
  Claude, Codex, Cursor, Pi, OpenCode, Gemini and Grok.
- **Agent states.** Herdr reports each agent as idle, working, blocked, done
  or unknown. "Blocked" means Herdr recognised an approval or a question on
  screen. Stall detection and the waker both read these states.
- **Safe typing.** `prompt_if_idle` types a prompt only when the agent is
  idle. Shepherd's typed nudge, for agents that cannot be woken any other way,
  goes through it.
- **Reading and keys.** `agent read`, `agent send-keys` and
  `agent wait --until blocked`.
- **Attaching to one agent.** `herdr agent attach` connects to a single
  agent's terminal. A browser terminal on the dashboard can run behind it.
- **Worktrees.** `herdr worktree create|open|list|remove` opens a git
  worktree as a workspace. The Foundry does not use it yet; it runs plain
  `git worktree add` and points a tab at the folder.
- **Sessions that survive restarts.** With `resume_agents_on_restore`, Herdr
  reopens agent panes into their own conversations after the server restarts.
- **Remote machines.** `herdr --remote <ssh-target>` and `herdr machine`
  reach agents on other machines over SSH (Secure Shell).
- **Plugins.** A `herdr-plugin.toml` manifest declares startup commands and
  actions. This is how Shepherd installs into Herdr.

Herdr gaps that Shepherd must work around:

- There is no `agent stop`. Closing the pane is the only way to stop an agent.
- `agent start` sent right after a pane split was once silently swallowed.
- A pending Codex question makes `agent prompt` fail with `agent_blocked`.
- Herdr has no web or phone interface of its own.
- Herdr 0.9.5 was available on 2026-10-30; check its release notes before
  building on any of the gaps above.

## Synapse: what is worth carrying over

These are Synapse designs worth keeping. The file names are in the Synapse
checkout's `herdr_team/` folder. Ideas can be reused freely. Copied code must
follow rule 2 of [AGENTS.md](../../AGENTS.md): name the source file in the
commit, keep Synapse's copyright line, and record the port in a `NOTICE`
file.

- **The operator is proven, not claimed.** Synapse identifies the human by
  the process tree and a verified origin, not by a name an agent could set.
  `operator grant` hands that authority to an agent with an expiry, and every
  use is written to the audit log. Shepherd's token per agent (T3 Code
  research, item 1) replaces the process-tree check for agents. The rule that
  the owner's authority must be proven stays.
- **Only an idle, quiet agent is spoken to.** Synapse types a nudge only when
  the agent is idle and stable, has no dialog or draft open, and is not the
  pane the owner is looking at. Keep the rule for the typed fallback, and
  close the gap between checking and typing (Synapse-list item 14).
- **`orient` after a compaction.** One command restores an agent's identity,
  charter, brief and rules. Keep it, and serve it through the MCP server too.
- **The charter is the human's.** Only the owner writes the charter. Agents
  read it.
- **Work items** (`work.py`, `cmd_work.py`). Each piece of work has a brief,
  an owner, dependencies, attempts and a review. The owner decided on
  2026-10-25 that work states and stall detection are built on work items
  (Synapse-list item 23).
- **Mission control** (`mission.py`). It sorts every agent into five lanes:
  needs you, blocked, working, done and idle. This is the dashboard's
  situation report (item 37).
- **Asks** (`asks.py`). A question to the owner stays open until the owner
  answers. This is the base of the dashboard's question inbox (item 34).
- **Activity cards** (`activity.py`). It reads what each agent ran and
  edited, with timestamps, from the agent's own transcript. Stall detection,
  the record-built hand-off and "give related work to the worker that knows
  it" all need this (items 24, 57 and 58).
- **Usage meters** (`usage.py`). It reads the Anthropic and Codex usage
  meters (item 60).
- **Context measurement and compaction on request** (`context`, `compact`).
- **Swap** (`cmd_swap.py`). It replaces a member's agent with a fresh one,
  possibly on another harness, and keeps the member's name and history. This
  is how a stalling worker gets replaced (item 24).
- **Facts with sources.** Team facts record where they came from and when,
  and conflicting facts are flagged.
- **Search and export** (`recall`, `search`, `export`). These search boards,
  facts, work and the agents' own conversations, and save them to files. They
  are the evaluators' tools (item 42).
- **The web server skeleton** (`whiteboard_server.py` and `web/`). It has a
  one-use ticket login, live updates over Server-Sent Events, and a React page.
  The dashboard can start from it.
- **The small MCP server** (`canvas_mcp.py`). It is a standard-library MCP
  server with the launch flags already wired. It is the natural start for
  Shepherd's MCP server.
- **The test session** (`bin/herdr-synapse-sandbox`). It runs an isolated
  Herdr session with its own state, for trying things without touching real
  teams.

## Synapse: what to leave behind

The Synapse-list's cut list (its section 14) still applies:

- the terminal screen interface (`tui_model.py`, `console.py`);
- the canvas and whiteboard, about 20,000 lines;
- answering the owner's questions by phone message;
- schedules;
- `restore`.

## Lessons from running Synapse in the Foundry

These are the failures that Shepherd's design has to prevent. Each one was
seen in a real Foundry run.

- **A wake that was held was never delivered.** A planner stalled five times,
  and two finished reviews sat unread for an hour and a half (ananke run,
  2026-10-13).
- **Claude's faint suggestion text was read as a draft,** so wakes were held
  and two planners sat idle for over an hour (2026-10-11).
- **A `/compact` was typed onto the end of the owner's half-written message**
  and sent with it (2026-10-25).
- **A Claude session sent to the background picked up the wrong pane id** and
  dropped out of its team.
- **Codex's sandbox blocks the Herdr socket,** so posts from inside it were
  marked unverified and woke nobody.
- **Wakes cost too much.** In run `impl-p25`, 44% of posts (2,613 of 5,939)
  were system events, two wake systems ran at once (603 Synapse nudges and
  450 Foundry wakes), and three leads made 1,518 model calls in 8 hours at
  about 230,000 tokens a wake. About 78% of the Claude cost was cache reads.
- **Team files lived in two places,** the project folder and the state
  folder.
- **The Claude hooks were never installed,** so rules such as "make
  `board --new` the last command of every turn" existed only to cover the
  gap.
- **The terminal does not scale.** With many agents, scrolling is awkward and
  panes have to be resized to be read.
