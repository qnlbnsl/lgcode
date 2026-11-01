# What Shepherd should borrow from T3 Code

Researched on 2026-10-30. T3 Code was read at commit `6fc9144` of
`github.com/pingdotgg/t3code` (release v0.1.5, 2026-10-29). Paths in this
document that start with `apps/`, `docs/` or `packages/` are paths inside the
T3 Code repository unless they say otherwise.

"Synapse-list item N" means item N of the earlier message-board feature list
for the Synapse fork, at `docs/message-board/features.md` in the
`herdr-synapse` checkout (one folder up from this repository).

## The short answer

T3 Code is the wrong engine for Shepherd, but it has the right edges.

T3 Code runs every agent headless. Claude runs through Anthropic's Agent
Software Development Kit (the Agent SDK), Codex runs through its `app-server`
mode, and Pi runs in its remote procedure call (RPC) mode. None of them is a
visible, interactive terminal session, which breaks the owner's rule that
every agent stays a visible session you can watch and type into. T3 Code's
own FAQ also says that Claude usage through the Agent SDK drains the 5-hour
limit faster than Claude Code does directly (`docs/user/faq.md`).

The useful parts are around the edges. T3 Code solves five problems that
Shepherd has:

- how to give each agent a private credential and a tool server, so the agent
  can prove who it is without the terminal pane's environment;
- how to deliver a message to a busy or an idle agent without typing into its
  input box;
- how to time compaction against the prompt cache, which saves money;
- how to build a hand-off for a replacement agent without spending a model
  turn;
- how to stream a terminal to a browser without the browser typing junk into
  the agent.

Most of this transfers as design and protocol. Two small algorithms are worth
copying, with T3 Code's licence notice. Shepherd is written in TypeScript
(decided 2026-10-30), so they can be copied as they are rather than ported.

## How T3 Code compares with Herdr and Synapse today

This section records the comparison that led to Shepherd, so the reasoning is
not lost.

### Where T3 Code is ahead

- **Messages are delivered through each tool's own interface, not by typing.**
  A message to a busy agent waits and arrives as its next turn
  (`docs/user/outside-agents.md`, "Scripts on the host"). That removes the
  Synapse failures caused by typing into panes: held nudges that were never
  delivered, Claude's faint suggestion text being read as a draft, a
  `/compact` typed onto the end of the owner's half-written message, and the
  Codex sandbox blocking the Herdr socket.
- **Agents hand work to each other with built-in tools.** T3 Code gives every
  agent eleven tools through its Model Context Protocol (MCP) server, the
  protocol a coding agent uses to get extra tools from a server. The main
  ones are `delegate_task`, `t3_thread_send` and `t3_thread_wait`. A
  finished helper wakes the agent that started it, so the wake is an event,
  not a timed nudge (`docs/orchestration-v2/orchestrator-mcp-server.md`).
- **It already has a web page, a desktop app and phone apps,** with remote
  access through its own relay or through Tailscale.
- **It has a worktree per thread, approval modes per thread** (Supervised,
  Auto-accept edits, Auto, Full access), and a readable history of commands
  and file changes with diffs.

### Where T3 Code falls short for the Foundry

- **Claude does not run in its own terminal program,** and it costs more of
  the 5-hour limit (see above). Skills and plugins load; whether Claude Code
  hooks fire was not confirmed.
- **There is no team layer.** Delegation is a tree: a parent hands a task to a
  child, and the child sees only the task text. There is no shared board,
  roster, charter, roles, operator authority, audit trail, `orient`, facts,
  work items, labels, digests, open-question tracking, work states or stall
  detection.
- **It is very early software.** The README says "expect bugs", and the
  project mostly does not accept outside contributions.

### Where Herdr and Synapse are ahead

- Every agent is a real, visible terminal session in Herdr, on any of 24
  agent kinds.
- Synapse already has the team layer that T3 Code lacks: teams, a charter,
  manager and operator roles, the board, `orient`, work items, facts, usage
  meters and mission control.

The conclusion was to keep Herdr as the host, keep the team ideas from
Synapse, and borrow T3 Code's edges. That is Shepherd.

## Terms used below

- **MCP (Model Context Protocol):** how a coding agent such as Claude Code or
  Codex connects to a server and gets its tools. Synapse already ships one
  small MCP server (`herdr_team/canvas_mcp.py` in the Synapse checkout).
- **Prompt cache:** Anthropic keeps the start of a conversation cached. Reading
  the cache costs 0.1 times the normal input price. Writing it costs 1.25
  times (5-minute cache) or 2 times (1-hour cache). Claude subscriptions use
  the 1-hour cache.
- **Steer:** put a message into a turn that is already running, instead of
  waiting for the turn to end.
- **TUI (terminal user interface):** the interactive terminal program of Claude
  Code or Codex.

## Things to borrow, most valuable first

Each entry says what T3 Code does, what it fixes in Shepherd, how to borrow
it, the effort (S, M or L), and whether it fits the rule that agents stay
visible terminal sessions.

### 1. Shepherd as an MCP server, with a token per agent minted at launch

**What T3 Code does.** Before it opens an agent session, it mints a credential
scoped to that one session. The token is 32 random bytes. Only its SHA-256
hash is kept, in memory. The token expires after 24 idle hours and is revoked
when the session ends (`apps/server/src/mcp/McpSessionRegistry.ts`). The
token reaches each agent without being typed anywhere:

- Codex gets `-c mcp_servers.t3-code.url=http://127.0.0.1:<port>/mcp` and
  `-c mcp_servers.t3-code.bearer_token_env_var="T3_MCP_BEARER_TOKEN"`, with
  the token in that environment variable.
- Claude gets an HTTP MCP server entry with an `Authorization: Bearer` header,
  plus `allowedTools: ["mcp__t3-code__*"]`.
- Pi gets `T3_MCP_URL` and `T3_MCP_BEARER_TOKEN`.

Every tool declares who may call it, and the credential, not the tool's
arguments, sets the limits (`apps/server/src/mcp/McpToolAccess.ts`,
`apps/server/src/mcp/threadAccess.ts`). The principle is stated as "Provider
ids are evidence. App ids are identity."
(`docs/orchestration-v2/entity-ids-and-correlation.md`).

**What it fixes in Shepherd.**

- **The Codex sandbox** (Synapse-list items 29 and 30). With an MCP server
  over HTTP, the Codex program itself makes the call, not a sandboxed shell
  command, so the blocked Herdr socket stops mattering.
- **A background Claude that picks up the wrong `HERDR_PANE_ID`.** Identity
  comes from the token given at launch, not from the pane's environment or
  the process tree.
- **Joining waits** (item 27). The member is known the moment the agent
  starts.
- **Who may do what** (items 28 and 40). Permission checks live in one place,
  and every harness that speaks MCP works the same way.

**How to borrow.** Design and protocol only; no code needs to be copied.

1. Run a loopback HTTP MCP endpoint in the Shepherd daemon. Its tools are the
   board's verbs: post, read new posts, read a thread, finish work, set a work
   state, ask the owner.
2. When Shepherd starts an agent, mint a token for that member. Store
   `sha256(token)` with the member, team, role and session. Pass the raw
   token in an environment variable such as `SHEPHERD_TOKEN`. Revoke it when
   the member is retired, swapped or leaves.
3. Let the command-line tool use the same token, so a post from a shell also
   proves who sent it without the Herdr socket.
4. Every command declares which roles may call it: owner, orchestrator, lead,
   worker, or hook.

**Effort:** M. **Fits the visible-session rule:** yes. MCP servers attach to
normal interactive `claude` and `codex` sessions.

**Catches.**

- Check whether Codex starts a standard-input (stdio) MCP server outside its
  sandbox. An HTTP endpoint avoids the question.
- Codex may ask for approval on each MCP tool call in some modes, so the
  Shepherd tools should be approved in the launch configuration.
- Do not put long waits behind an MCP call. Pi's MCP support has a 60-second
  request timeout, and Claude Code has its own tool timeout. Use item 2 for
  waiting.

### 2. Wake an idle Claude without typing into its pane

**What T3 Code does.** It relies on a Claude Code rule: when a background
command finishes, or a `Monitor` prints a line, Claude Code starts a new turn
on its own. T3 Code's recorded test fixtures capture this from live runs
(`apps/server/src/orchestration-v2/testkit/fixtures/claude_background_task_wake/`
and `.../claude_background_monitor_wake/`).

**How to borrow.** When an agent joins, it starts one long-lived `Monitor`
that runs a Shepherd command such as `shepherd inbox --follow`. That command
prints one line only when a post that needs an answer, or a digest, is due.
Claude Code then starts the turn itself, and the post arrives as the tool's
output.

- Nothing is typed into the pane, so typing over a draft (item 14), wakes
  that are held and never delivered (item 15), faint suggestion text read as
  a draft (item 16), and a stuck input box blocking wakes (item 25) all stop
  mattering for Claude.
- Subscriptions and collections (items 21 and 22) become the same mechanism:
  a watcher that prints once.

**A related finding, not from T3 Code.** Claude Code "channels" let an MCP
server push a message into an open session, which wakes it. This is a
research preview behind `claude --channels`, and there is an open report of
dropped messages (anthropics/claude-code issue #36411). It is worth trying as
the main wake path for Claude, with the `Monitor` as the fallback.

**Effort:** M. **Fits the rule:** yes; both are features of the interactive
Claude Code program.

**Catches.**

- **Claude only.** No equivalent was found for the Codex terminal program.
  Codex, Pi and OpenCode keep the typed nudge through Herdr's
  `prompt_if_idle`, with the safety rule from item 14.
- A wake still costs one turn. This fixes reliability, not the roughly
  230,000-token price of waking a lead. Item 4 is about the price.
- The daemon must notice an agent with no live watcher and fall back to the
  typed nudge.
- The watcher must print one line per digest, not one line per post, or each
  post becomes its own wake.

### 3. A stored mailbox per agent, with delivery modes and receipts

**What T3 Code does.** Every message is stored as an intent before it is
delivered. The send step picks one of four results: `started` (the agent was
idle), `steered` (it went into a running turn), `queued` (it waits for the
turn to end) or `restarted`. The call reports which one happened, and a
repeated request id returns the same result, so a retry never sends twice
(`apps/server/src/orchestration-v2/ThreadManagementService.ts`,
`sendToThread`; `apps/server/src/orchestration-v2/NotificationMailbox.ts`).

**How to borrow.** One mailbox per member in the daemon. Every undelivered
message has something responsible for delivering it.

- **The agent is idle:** wake it through item 2, or with the typed nudge for
  agents other than Claude.
- **The agent is busy and can be steered:** for Claude, a `PostToolUse` hook
  returns the post as `additionalContext`. That is a steer with no typing.
- **The agent is busy and cannot be steered:** queue the post, and the Stop
  hook hands it over when the turn ends.
- Record a receipt per post and per reader, with when and how it was
  delivered. A held wake then becomes a queued row with an owner, which is
  the fix for item 15.
- Give every post an idempotency key, so a retry never posts twice.

**Effort:** M. **Fits the rule:** yes.

**Catch.** A steer through `additionalContext` reaches the model only at its
next tool call, so a long stretch of thinking delays it. That is fine for an
`fyi` post. It should be measured for posts that need an answer.

### 4. Compact idle Claude agents just before the prompt cache expires

**What T3 Code does** (`apps/server/src/orchestration-v2/IdleCompaction.ts`
and `IdleCompactionService.ts`). After every finished turn, it schedules one
`/compact` for two minutes before the prompt cache of the last request
expires, but only when all of these hold:

- the context is at least 200,000 tokens, because below that a cold re-read is
  cheap and compacting mostly loses context;
- nothing is pending: no question, no approval, and no background work;
- the last turn was not itself a compaction;
- at most one compaction per finished turn, and a newer turn replaces the
  waiting timer.

The cache lasts 1 hour from the start of the request if
`usage.cache_creation.ephemeral_1h_input_tokens` is above zero, otherwise 5
minutes if `ephemeral_5m_input_tokens` is above zero. Otherwise the expiry is
unknown and nothing is scheduled
(`apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`,
`claudePromptCacheTtlMs`).

**Checked on the owner's machine:** interactive Claude Code transcripts carry
the same field next to a timestamp, so Shepherd can compute the deadline from
the transcript files with no SDK.

**Why it matters for cost.** A wake after the cache expires writes the whole
cached part again at 2 times the input price instead of reading it at 0.1
times, which is about 20 times more for that part. About 78% of the
Foundry's Claude cost is cache reads, so one late wake of a 230,000-token
lead costs about as much as many on-time wakes.

**How to borrow.**

- Replace the Foundry's fixed rule (compact idle leads at 150,000 tokens) with
  "compact an idle lead two minutes before its cache expires, when it is over
  the team's token floor" (Synapse-list items 31 and 46).
- **A new rule of Shepherd's own:** deliver posts that need an answer, and
  can wait, before a lead's cache expires rather than after. If only an `fyi`
  digest is waiting, let the cache lapse.

**Effort:** S. Copy about 100 lines of logic, with the licence
notice below. **Fits the rule:** yes; T3 Code also sends `/compact` as a
normal, visible turn.

**Catches.** The `/compact` is still typed into the pane, so it must use the
safe-typing rule from item 14; the 2026-10-25 incident, where a `/compact`
was typed onto the end of the owner's draft, had exactly this shape. A
comment in T3 Code's source says Claude Code has its own `idleCompaction`
setting; check whether the interactive program exposes it before building
this.

### 5. Hand-offs built from records, not written by the model

**What T3 Code does.** "A handoff is a budgeted selection, not an
agent-written summary" (`docs/user/portable-handoffs.md`). It keeps the
original request, the most recent requests and answers, and the relevant
activity, such as command results and file changes. Each item is shortened
to 240 characters, the default budget is 16,000 tokens, and it keeps
references to what it left out, which the agent can fetch later.

**How to borrow.** When a worker is retired or replaced (Synapse-list items
24, 56, 58 and 59, and `swap`), start the new one with a hand-off that the
daemon builds: the work item's brief and acceptance check, the worker's own
posts about it, the files it touched, the commands it ran, and the open
questions, with post ids to fetch more. This spends no model turns. A
`/compact` costs a full read of the context plus the summary, so the built
hand-off is the cheap path, and it matches the owner's earlier habit of
replacing subagents at about 60% context.

**Effort:** S to M. **Fits the rule:** yes; the hand-off is the first prompt
of a normal interactive launch.

### 6. A permission ceiling for anything one agent does to another

**What T3 Code does.** Permission modes are ranked. A child task, or a message
to another thread, may never run with a broader mode than the agent that
asked for it, and the check runs again just before the action, because the
owner can change modes in between
(`apps/server/src/orchestration-v2/DispatchModeLimit.ts`).

**How to borrow.** When a lead staffs or swaps its own workers, they start at
or below the lead's permission mode, and approval prompts are on by default
(Synapse-list items 26, 28, 44 and 55).

**Effort:** S. **Fits the rule:** yes.

### 7. A wait result that says why the wait ended

**What T3 Code does.** Waiting on a delegated task returns its status, its
work state, whether it has a pending question or approval, and whether the
wait timed out. A timeout never cancels the work. A question in the child
ends the parent's wait early and is routed to the parent. The command line
exits with 0 when the work is done, 1 when it failed or stopped, and 2 when
the agent is waiting for an answer (`docs/user/outside-agents.md`).

**How to borrow.** A "waiting on X" state and a collection should end early,
with a reason, when X is stuck on a question or an approval dialog
(Synapse-list items 21 to 24, 47 and 50). Copy the exit codes, so leads and
scripts can branch without parsing text.

**Effort:** S to M. **Fits the rule:** yes.

### 8. "Usage limit reached" is its own kind of stall

**What T3 Code does.** A thread that stopped on a usage limit with a known
reset time is resumed automatically after the reset, once, with guards
against retry loops
(`apps/server/src/orchestration-v2/UsageLimitRecoveryWorker.ts`).

**How to borrow.** Stall detection recognises the limit message. That stall
does not count toward "replace this worker after three stalls", and the
daemon resumes the agent at the reset instead of alerting the lead
(Synapse-list items 24 and 60). This matters because the weekly limit is the
owner's tightest constraint.

**Effort:** S. **Fits the rule:** yes.

### 9. Live updates that survive a sleeping phone

**What T3 Code does.** A client gets a full snapshot, then only the events
after a sequence number. Every command returns the sequence number it
committed, and a repeated command id returns the stored result. After a
phone wakes, it checks the connection, because the operating system can kill
a suspended connection without telling anyone
(`docs/internals/connection-runtime.md`). Long waits are split into calls of
at most 50 seconds, because proxies drop idle requests after about 100
seconds (`docs/internals/remote.md`).

**How to borrow.** Use Server-Sent Events (a one-way live stream over plain
HTTP) with `Last-Event-ID` set to the board's sequence number. Send a
heartbeat more often than the owner's reverse proxy times out. Give every
answer from the phone a request id, so a double tap answers once
(Synapse-list items 32 to 34 and 36).

**Effort:** S. **Fits the rule:** yes.

### 10. A browser terminal that cannot type junk into the agent

**What T3 Code does.** When it replays old terminal output into a browser, it
strips the escape codes that ask the terminal a question, such as cursor
position and colour queries. Otherwise the browser's terminal answers those
old questions, and the answers appear as text at the prompt
(`apps/server/src/terminal/Manager.ts`, the `shouldStrip...Sequence`
functions, around lines 1090 to 1120). Output is sent in a window of 8 chunks
or 64 kibibytes before the browser must acknowledge it
(`apps/server/src/terminal/OutputProtocol.ts`). There are separate
interactive and read-only ("observe") modes.

**Why it matters more for Shepherd.** If the dashboard replays an agent's pane
into a browser terminal and the browser answers an old query, the answer is
typed into the agent's input box. That is item 14's failure, caused by the
dashboard. So open agents read-only by default, and switch to typing only
when the owner chooses to (Synapse-list item 38).

**How to borrow.** Port the three strip functions, about 40 lines, with the
licence notice. Use xterm.js in the browser, not T3 Code's own renderer.

**Effort:** S for the stripping, the window and observe mode; M for the whole
page. **Fits the rule:** yes.

### 11. Phone alerts for four kinds of event only

**What T3 Code does.** It alerts when an agent finishes, fails, needs an
approval, or asks a question. A tap opens the thread. Alerts stay quiet while
the app is open (`docs/user/mobile-notifications.md`).

**How to borrow.** Send only four alerts: an owner question, an agent stuck on
an approval, a stall that reached the owner, and a failed run, each with a
link (Synapse-list item 41). Synapse's outbound ntfy support can carry them.

**Effort:** S.

### 12. Signed links that can answer one question

**What T3 Code does.** A guest link's token is a keyed hash (an HMAC) of the
thread and a share id, so nothing secret is stored. Closing the share revokes
every link, and a guest token cannot reach any other page
(`docs/internals/environment-auth.md`, "Guest links are not sessions").

**How to borrow.** A link in a phone alert that can only answer that one
question needs no login system. Check this against rules 3 and 4 of
[SECURITY.md](../../SECURITY.md) before adopting it; it is a narrow credential
for one action, not a device credential.

**Effort:** S.

### 13. Smaller ideas for the dashboard

- **Usage across accounts, by window,** with "days left at this pace"
  (`docs/user/usage.md`). Synapse's `usage.py` already reads the meters.
- **Activity summaries,** such as "Ran 2 commands and sent messages to 3
  threads", where commands and file changes outrank reads
  (`docs/user/activity-log.md`).
- **Posts cite ids, not titles,** because titles go stale. The page shows the
  current names.
- **Every message records who created it** (a person or an agent) separately
  from how it arrived (the MCP server, the agent, or the server). The
  evaluators get "who typed this" for free.
- **Settle and snooze.** A snoozed thread wakes early only for a pending
  request or a failure.

### 14. An event log with an outbox

**What T3 Code does.** It writes the events, the stored views, the command's
receipt and the side effects still to be done in one transaction. A separate
worker performs the side effects afterwards and records the results
(`docs/internals/overview.md`, "Durable intent and side effects").

**How to borrow.** A wake or a compaction becomes an outbox row with attempts
and the last error. A daemon restart cannot lose a wake, and the rows are
exactly what the evaluators' issue record needs (Synapse-list items 19 and
42).

**Effort:** M. Idea only.

## Things not worth borrowing

| T3 Code part | Why not |
|---|---|
| Running agents headless (the Agent SDK, Codex `app-server`, Pi RPC mode) | It breaks the visible-session rule, and the Agent SDK drains Claude's 5-hour limit faster. |
| The internal model of runs, turns and tool calls | T3 Code built it because it owns the agent loop. Shepherd watches terminal programs it does not own. Keep only the principle that Shepherd's own ids are the identity. |
| Code snapshots with rollback, forking and merge-back | The Foundry already uses worktrees and branches, and a live terminal conversation cannot be rolled back. |
| Switching providers inside one conversation | The Foundry gives each role a model. Only the hand-off builder (item 5) carries over. |
| T3 Connect: the relay, the tunnel and the sign-in server | The owner already uses WireGuard and a reverse proxy. |
| The Expo phone app and the custom WebAssembly terminal | A phone-friendly web page with xterm.js covers the need. Borrow only the replay and flow-control rules (item 10). |
| Load balancing, multi-account pools, voice input, pull-request linking | Outside Shepherd's scope. |
| The TypeScript code wholesale | Shepherd is TypeScript too (decided 2026-10-30), but most of T3 Code's code serves its own design. Copy only small, self-contained functions (items 4 and 10), each under `third_party/t3code/`. |

## Licence obligations

T3 Code is under the MIT licence, "Copyright (c) 2026 T3 Tools Inc." Its
condition is to keep the copyright and permission notice with any copy or
substantial portion of the code.

- **Ideas, protocols and interface shapes** (items 1 to 3 and 5 to 14) carry
  no obligation. This document is the credit.
- **Ported code** (item 4's compaction timing and item 10's strip functions)
  counts as a copy. If either is ported:
  1. add the full MIT text, for example as `LICENSES/t3code-MIT.txt`;
  2. add a paragraph to a `NOTICE` file: "Portions adapted from T3 Code
     (https://github.com/pingdotgg/t3code), Copyright (c) 2026 T3 Tools Inc.,
     MIT License", naming the files;
  3. put a header comment in each ported file naming the T3 Code source file
     and commit `6fc9144`.
- Shepherd's own licence is not chosen yet (see [README.md](../../README.md)).
  MIT code can be included under any common licence choice.

This is a practical reading, not legal advice.

## What was not verified

- Whether Codex starts a standard-input MCP server outside its sandbox. An
  HTTP endpoint avoids the question.
- Whether the Codex terminal program has any background-task wake like
  Claude Code's.
- Whether Claude Code channels deliver reliably. They are a research preview
  with an open report of dropped messages.
- Whether interactive Claude Code exposes the `idleCompaction` setting
  mentioned in T3 Code's source.
- Whether Claude Code hooks fire inside T3 Code's Claude threads. This only
  matters if T3 Code itself is ever used as a host.
