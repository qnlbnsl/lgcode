# Shepherd: the feature list

Status: **draft, not approved.** Some features are built inside the engine,
but none is reachable from a client yet.

Each feature has a short name, one paragraph saying what it does, and a state:
**idea** (written down, not agreed), **agreed** (the owner wants it), or
**built** (merged and working).

While the engine is being built, a feature can also be **built in the
engine** (unit numbers follow). That means its engine part is merged into
`area/engine` and passes its tests. Since unit 7b, the client library, the
`shepherd` command-line tool and `shepherd mcp` are merged too, so the owner
and agents can reach the engine from a terminal, but no web or phone client
exists yet. A feature
is **partly built in the engine** when only some of what its paragraph
describes is merged; the note after it says which part.

An earlier, much longer list of message-board features was written for the
Synapse fork. It is at `docs/message-board/features.md` in the
`herdr-synapse` checkout, and it is the main input for section 2 below.

## 1. The foundry: roles and their lifecycle

- **Orchestrator** (idea). The top-level agent. It receives the owner's goal,
  decides which teams to staff, and talks to team leads, not to workers.
- **Team leads** (idea). One per team. A lead plans its team's work, hands it
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
    7a answers every connection with 503 until recovery ends). Shepherd starts the agent as a child process
    and drives it through the Agent Client Protocol (ACP): it opens a
    session, sends prompts, and receives structured events (text, plan, tool
    calls, permission requests). Adding a harness means adding its ACP
    command, so Claude Code, Codex, Gemini CLI, OpenCode and the rest come
    almost for free. Claude Code and Codex need their adapters,
    `claude-agent-acp` and `codex-acp`.
  - **Interactive mode** (built second). Shepherd opens the harness's normal
    terminal program in a Herdr pane, as Herdr Synapse does, and the owner
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
  for Codex or three Cursor accounts, and Shepherd spreads agents across
  them. Each account is its own sign-in, kept apart by its own home
  directory (`CODEX_HOME` for Codex, `CLAUDE_CONFIG_DIR` for Claude Code) or
  by its own API key, plus any extra environment variables. Starting an agent
  names an account, or asks for any account of that harness. Secrets are
  stored as references and never written to the event log. The design is T3
  Code's "provider instances", including Codex's "shadow home", which lets
  two Codex accounts continue the same threads. See T3 Code's
  `docs/user/providers-codex.md`, `providers-claude.md` and `cursor.md`, and
  `packages/contracts/src/providerInstance.ts`, at commit `6fc9144`.
- **A token for every agent** (built in the engine: units 5a and 5b). When Shepherd starts an agent, it mints a
  private token for it and passes it in an environment variable. The agent
  proves who it is with that token, not with the pane's environment or the
  process tree, so Codex's sandbox and a backgrounded Claude stop breaking
  identity. Borrowed from T3 Code; see
  [research/t3-code.md](research/t3-code.md), item 1.
- **Shepherd's tools over MCP** (idea). The board's verbs (post, read, finish
  work, ask the owner) are offered to agents through a Model Context Protocol
  (MCP) server on a loopback address, as well as through the command line.
  Every tool declares which roles may call it. See research item 1.
- **A permission ceiling** (built in the engine: units 5a, 5b and 6a; unit
  6a sets back a mode change made inside the agent). An agent that a lead starts, swaps or
  messages never runs with a broader permission mode than the lead. See
  research item 6.
- **Hand-offs built from records** (idea). A replacement worker starts from a
  hand-off that Shepherd builds from the work brief, the worker's posts, the
  files it touched and the commands it ran, with no model turn spent. See
  research item 5.

## 2. The message board

- **Channels and direct messages** (idea). Each team has a channel. Leads can
  message the orchestrator directly. Workers can message each other.
- **Wake rules** (idea). Each post says whether it needs an answer. Only a
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
  long-lived `Monitor` running a Shepherd command that prints a line only when
  a post needs it. Claude Code starts the turn by itself, and nothing is typed
  into the pane. Other agents keep a typed nudge that only fires when the
  agent is idle. See research item 2.
- **Wait results that say why** (built in the engine: unit 5d's
  waits end with a reason per member, and unit 7b's `shepherd wait` exits
  with the codes below). A wait or a collection ends early,
  with a reason, when the agent it waits on is stuck on a question or an
  approval. The command line exits with 0 for done, 1 for failed, and 2 for
  waiting on an answer. See research item 7.

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
- **Device pairing** (idea). A new device is added with a one-time pairing
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
- **Shepherd runs as its own user** (agreed). Shepherd gets its own Unix
  user, so its state folder, credentials and account keys are out of reach of
  the agents, which keep running as the owner's user. There are several ways
  to set it up. The owner deferred it on 2026-11-01; it comes before remote
  access is built.

## 5. The sheepdog

A shepherd leads the flock, and the shepherd's dog keeps the sheep in line so
none of them wander off. In Shepherd, the orchestrator and the owner lead. The
sheepdog is the part of Shepherd's background service that keeps every agent
moving without spending their turns. It never decides what the work is; it
only notices when an agent has strayed and nudges it back, or tells its lead.

- **Stall watch** (idea). The sheepdog knows each agent's work state (off,
  assigned, working, waiting, done) and notices an agent that has stopped
  without finishing. It wakes the agent once, then tells its lead. A worker
  that stalls three times in a row on the same work is replaced. The rules
  come from Synapse-list items 23 and 24 (see
  [research/herdr-and-synapse.md](research/herdr-and-synapse.md)).
- **Usage-limit pauses are not stalls** (idea). An agent stopped by a usage
  limit is resumed when the limit resets, and the pause never counts toward
  replacing it. See research item 8.
- **Stuck input boxes and approval dialogs** (idea). An agent whose input box
  has held the same text for a long time, or that is waiting on an approval
  dialog, is reported to its lead.
- **Compaction timed to the prompt cache** (idea). An idle Claude agent with a
  large context is compacted two minutes before its prompt cache expires, not
  after, because a wake after the cache expires costs about 20 times more for
  the cached part. Posts that need an answer and can wait are delivered
  before the cache expires. See research item 4.
- **Runaway work** (idea). Work that runs far past its expected length is
  reported to the lead, and can continue in a fresh agent with a built
  hand-off.

## 6. Source control

- **Remove agent credits when merging** (agreed). A setting, off by default,
  that each project can override. When Shepherd merges a worker's or a team's
  work with a merge commit or a squash commit, it removes the lines that
  credit a coding agent from that commit's message: `Co-authored-by:`
  trailers for known agents, and footers such as "🤖 Generated with Claude
  Code". Human co-authors stay credited. The original commits are not
  rewritten. The client API exposes the setting, so it can be changed from a
  phone. The code is T3 Code's own, copied with its MIT licence into
  [third_party/t3code/](../third_party/t3code/README.md).

## Open questions

- Which licence should Shepherd use?

## Decided

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
  Shepherd can copy T3's event store with credit. The rejected options were
  saved tables updated in place, and one supervisor process per agent
  sharing files.
- **Shepherd is written with the Effect library** (2026-11-01). Effect is a
  TypeScript library for whole programs: failures are part of each
  function's type, every running task has an owner that cleans it up, and
  one schema both checks data and defines its type. The reason for choosing
  it is reuse: T3 Code is written with Effect 4, so its ACP client
  (`packages/effect-acp`), event store, accounts and device pairing can be
  copied with credit instead of rebuilt. Shepherd pins the same Effect
  version as the T3 Code commit it copies from, so the copied code compiles
  unchanged.
- **Shepherd runs on Node.js 26** (2026-11-01). Node.js 26 is the current
  long-term support line, and the repository's `.nvmrc` says `26`. A single
  file compiled with Bun was considered and not chosen: T3 Code's SQLite
  code uses Node.js's own `node:sqlite`, and the Claude Code ACP adapter
  needs Node.js anyway.
