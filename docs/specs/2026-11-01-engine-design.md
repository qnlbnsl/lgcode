# The Shephrd engine: design

Status: **approved by the owner on 2026-11-01.** The owner asked Claude to
check the spec against the design session instead of reading it, and to
proceed if it matched. The check found three gaps, now fixed: the
`harnesses` command, the "delivered" event, and crash reports for agents the
owner started. The four "chosen in this spec" items were accepted with it.
Amended on 2026-11-01 after the plan review; the last section, "Changes
after the plan review", lists every change and wins where it disagrees with
the sections above. Nothing in this document is built.

Designed with the owner, Kunal Bansal, in a design session on 2026-10-30 to
2026-11-01. Every decision below was approved in that session unless it is
marked **chosen in this spec**, which means it was decided while writing and
needs the owner's review.

## What the engine is

Shephrd is built in four pieces:

1. The engine.
2. The client API.
3. The message board.
4. The foundry roles.

This document designs piece 1. The engine is the background service that the
Herdr plugin starts. It runs coding agents over the Agent Client Protocol
(ACP), keeps a complete record of everything they do, and offers one
authenticated API through which agents and the owner's devices control them.

The other three pieces are built on top of the engine without changing it.
The client API adds device pairing, phone alerts and the web page. The message
board adds channels, direct messages and wake rules. The foundry roles add the
orchestrator, team leads, workers and the sheepdog that watches for stalls.

## How the engine is judged finished

The engine is finished when the Foundry needs nothing else from it. The
Foundry is the owner's software-foundry skill, which today runs teams of
agents through Herdr commands. Its Steps 3 to 5 and 8 give the list below.
Each capability is offered through one API that agents and the owner's
devices both use.

1. **Start an agent.** The caller chooses the harness, account, model,
   effort, permission mode, folder, name, role and group, and gets back the
   agent's id.
2. **Agents start agents.** An agent the engine started can start, prompt and
   stop its own agents through the same API. It can never give them a wider
   permission mode than its own.
3. **Prompt an agent,** as the owner or as another agent, with the sender
   recorded.
4. **Know an agent's state,** and be told when it changes.
5. **Wait without polling.** A waiting agent is woken once, when one agent or
   every agent in a set finishes its turn.
6. **Read any agent's thread live,** from any client: every message, tool
   call, changed file and permission request.
7. **Answer permission requests.** Each request goes to the agent that started
   the asker. That agent answers it or passes it up. The owner can answer any
   request.
8. **Reach the owner.** A request passed up to the owner, or a question for the
   owner, produces an "owner needed" event. The client API turns that event
   into a phone alert.
9. **Talk to any agent remotely.** The owner can read and prompt any agent's
   thread from any device.
10. **Stop, resume and compact an agent.**
11. **Group agents,** the way the Foundry puts agents in tabs.
12. **Use several accounts for each harness,** named by the caller or picked by
    the engine.

### What stays out of the engine

These are built on the capabilities above, in later pieces:

- The board's channels, direct messages and wake rules (piece 3).
- The rules for each role, and standing permission rules such as "always
  allow running the tests" (piece 4).
- Retrying, replacing or giving up on a failing agent (piece 4, the
  sheepdog).
- Git worktrees.
- Usage meters.
- Interactive mode, where an agent runs in a Herdr pane. It is added later as
  a second kind of runner behind the same interface.
- Device pairing, phone alerts and the web page (piece 2).

## Decisions this design rests on

- **Language: TypeScript** (2026-10-30). One language for the backend, the web
  page and the future apps, so the client API's types are written once.
- **Two run modes, ACP first** (2026-10-30). Every harness has a run-mode
  setting. ACP mode is built first, in this engine. Interactive mode comes
  later.
- **One service with an event log** (2026-11-01). Everything that happens is
  written to a numbered, append-only log in SQLite before anything acts on
  it. Threads, states, waits and the live stream are all read from that log.
  The rejected options were saved tables updated in place, and one
  supervisor process per agent sharing files.
- **Written with the Effect library, version 4** (2026-11-01). The reason is
  reuse: T3 Code is written with Effect 4, so its ACP client, event store,
  accounts and testing code can be copied with credit instead of rebuilt.
  Shephrd pins the same Effect version as the T3 Code commit it copies from.
  At commit `6fc9144`, that is Effect 4.0.5.
- **Several accounts for every harness** (2026-11-01). Modelled on T3 Code's
  "provider instances".

## The six parts

The engine is split into six parts. Each part has one job and can be tested
on its own. Only the command handler changes anything, and only the event log
is the record of what happened. Every rule therefore lives in one place, and
the phone, the command-line tool and the agents' tools cannot disagree.

### 1. The event log

The event log is one SQLite file and the only code that writes to it.

- Each event gets the next number, called its sequence number, and is never
  changed afterwards.
- There is one writer, so two events can never get the same number.
- All the events produced by one command are written in one database
  transaction, so either all of them are in the log or none are.
- An event is written before anything acts on it.

**Chosen in this spec:** the first version keeps every event forever. A
retention rule is needed later, because the log grows without limit. It is
recorded as a known problem in `docs/issues.md`.

### 2. The views

The views are the current picture of the world, kept in memory and rebuilt
from the log when the service starts. They are updated as each event is
written. Nothing is stored in a view that cannot be rebuilt from the log.

The views hold:

- **Agents:** each agent's id, name, role, groups, parent, harness, account,
  model, effort, permission mode, folder, run mode, ACP session id, and state.
- **Threads:** each agent's conversation, in order.
- **Permission requests:** each open or closed request, who asked, who it is
  routed to, the options offered, and the answer.
- **Waits:** each open wait, who is waiting, on which agents, and whether it
  needs one of them or all of them.
- **Deliveries:** each message waiting to be delivered to an agent, in order.
- **Accounts:** each configured account and whether it is usable.

### 3. The command handler

The command handler is the only way anything changes. For each command it:

1. Identifies the caller from its credential.
2. Checks that the caller may do this.
3. Refuses a request id it has already seen, returning the first result
   instead. A double tap on the phone, or a client that resends after losing
   its connection, therefore acts once.
4. Writes the resulting events.

The commands are:

| Command | Who may call it | What it does |
| --- | --- | --- |
| `start` | The owner, or any agent | Starts an agent, optionally with a first prompt. |
| `prompt` | The owner, or the agent's parent | Sends a message to an agent. |
| `answer` | The owner, or the agent the request is routed to | Answers a permission request or a question. |
| `pass-up` | The agent the request is routed to | Sends a request to the routed agent's own parent, or to the owner. |
| `ask` | Any agent | Asks its parent, or the owner, a question. |
| `wait` | Any agent, on its own children | Waits for one child, or all of a set of children, to finish its turn. |
| `stop` | The owner, or the agent's parent | Stops an agent. |
| `resume` | The owner, or the agent's parent | Starts a stopped or crashed agent again from its saved session. |
| `compact` | The owner, or the agent's parent | Asks an agent to compact its context. |
| `group` | The owner, or the agent's parent | Adds or removes an agent's group labels. |
| `accounts` | The owner only | Adds, changes, disables or removes an account. |
| `harnesses` | The owner only | Reads and changes each harness's settings: its run mode, its ACP adapter command, and how its permission modes map onto Shephrd's scale. The service loads the defaults itself on its first start, when its log holds no harness settings, and `harnesses reset` loads them again. An empty list of models or efforts means the list is not checked. |
| `subscribe` | The owner, or any agent | Sends every event after a given sequence number, then each new event as it is written. |

"The agent's parent" means the agent that started it. **Chosen in this spec:**
a parent's rights reach only its own children, not its grandchildren. A lead
that needs to act on a worker's worker asks the worker, or the owner acts.

`subscribe` for an agent shows only its own thread and its children's. The
owner sees everything. The client API plan widens this by one case (lead
ruling L29, 2026-11-03): an agent also sees an agent whose parent is
unavailable and whose rights have passed up to it, for as long as that
lasts, so an agent can always see an agent it may act on.

### 4. The agent runner

There is one runner for each agent in ACP mode. The runner:

- Starts the harness's ACP adapter as a child process. Claude Code uses
  `claude-agent-acp`, Codex uses `codex-acp`, and Gemini CLI speaks ACP
  itself.
- Gives the process the account's environment (its home directory or API
  key), the agent's own token, and Shephrd's tools over the Model Context
  Protocol (MCP).
- Opens an ACP session and records the session id, which `resume` needs.
- Turns everything the agent streams into events: text, plan, tool calls,
  changed files and the end of each turn.
- Lets an agent call Shephrd's own tools without an approval prompt in every
  permission mode, by the owner's decision on 2026-11-05. The engine still
  authenticates each call and checks its caller's rights.
- Turns other ACP permission requests into a "permission requested" event
  and holds the agent until an "answer" event is written. A request whose
  server identity is uncertain follows this same path.
- Sends `compact` as the harness's own compact command when the adapter
  advertises one in its list of available commands. Otherwise `compact` is
  refused with the reason "not supported by this harness".

The runner is behind an interface, so interactive mode can add a second kind
of runner later without changing the other five parts.

ACP has no way to add a message to a turn that is already running. So a
message for a busy agent waits in the deliveries view until the agent's turn
ends, and is then delivered once, in order. Each delivery writes a
"delivered" event saying when and how the message reached the agent, so a
message can never be lost without the log showing it.

### 5. Identity

Every caller is either one of the owner's devices or an agent.

- **Agents.** Each agent gets its own token when it is started. The token is
  passed to the agent's process in an environment variable. It is stored only
  as a hash and never written to the log.
- **The owner's devices.** Each device has its own credential, and each can be
  revoked on its own. The engine creates one credential for the owner's
  terminal on the host on first start, saved in a file only the owner can
  read. Adding other devices by pairing belongs to piece 2.

What an agent may do depends on who started whom. That gives two rules:

- **The permission ceiling.** An agent cannot start, prompt or answer for an
  agent with a wider permission mode than its own.
- **Permission routing.** A permission request goes to the agent that started
  the asker.

**Chosen in this spec:** permission modes are compared on Shephrd's own
scale, because each harness names its modes differently. The scale, from
narrowest to widest, is: read only, ask before every change, edit files
without asking, and full access. Each harness maps its own modes onto this
scale in its settings.

An answer to a permission request routed to a person is an authenticated
`answer` command. It is never read out of an agent's text. Shephrd's own
server is exempt from the harness approval prompt. This exemption does not
change the authentication or authorization of its commands. That keeps
SECURITY.md's rule that agent text is data, not a command.

### 6. The doors

The engine offers one API with two kinds of call: commands, and `subscribe`.

- The web page, the phone and the owner's terminal use the API directly.
- Agents reach the same API in two ways: a small command-line tool, and
  Shephrd's tools over MCP. Both are thin wrappers with no rules of their
  own.

**Chosen in this spec:** the API runs over a WebSocket on the loopback
address, as T3 Code's does, and every message is checked against an Effect
schema. Listening on any other address is a setting the owner turns on, and
only over an encrypted channel, as SECURITY.md requires.

## Accounts

The owner can add more than one account for a harness, such as two ChatGPT
accounts for Codex or three Cursor accounts.

- Each account is its own sign-in, kept apart in one of two ways: its own home
  directory (`CODEX_HOME` for Codex, `CLAUDE_CONFIG_DIR` for Claude Code), or
  its own API key (`CURSOR_API_KEY` for Cursor).
- `HOME` is never changed, because that hides Claude Code's saved login.
- The account's `home` field is passed through the harness's own variable,
  and its `secret` field through the harness's key variable (`ANTHROPIC_API_KEY`
  for Claude Code, `OPENAI_API_KEY` for Codex, `GEMINI_API_KEY` for Gemini,
  `CURSOR_API_KEY` for Cursor). The mapping is keyed on the harness id and is
  in `runner/harnesses.ts`. Harness settings record no adapter kind, so a
  custom harness id, such as `custom-claude`, has no mapping.
- A field the harness has no variable for is refused, never dropped. A `home`
  on Gemini, Cursor or a custom harness id is refused, and so is a `secret` on
  a custom harness id. The refusal is fixed text that names the field and the
  harness id, such as `account home is not supported by harness gemini`, and
  holds no secret. It is made when the account is added, set, or given a
  secret, and again when the agent is started.
- An account whose `home` and explicit `CLAUDE_CONFIG_DIR` or `CODEX_HOME` name
  different folders is refused when it is set, and again when it is started.
  The check compares the folders the child would get, so a `secret:` reference
  is resolved through the secret store first. A reference to the same folder is
  accepted, a reference to another folder is refused, and a reference that
  cannot be resolved counts as different. The refusal text never holds the
  resolved value. An explicit key variable in the environment wins over
  `secret`.
- An account can carry extra environment variables.
- Secret values are stored as references, not plain text, and never reach
  the log or a client.
- Codex accounts can share one set of sessions through T3 Code's "shadow home"
  arrangement, so a Codex thread can move to another account. Claude Code has
  no equivalent, so a Claude thread stays on its first account.
- A Codex account that is not named `codex` gets a private login: its own
  `auth.json` in a shadow home under the state folder, with the sessions shared
  from its `home`. Only the account named `codex` uses `home` directly.

`start` either names an account or asks for any account of that harness. With
"any", the engine picks the usable account with the fewest running agents. An
account that is signed out, or out of usage until a known reset time, is
skipped. Picking by remaining usage needs usage meters, which come later.

## One request, start to finish

This is how capabilities 1, 2, 3, 5, 6 and 7 work together. A team lead starts
a worker, the worker asks for permission, the owner answers from the phone,
and the lead is woken once when the worker finishes.

1. **The lead asks.** The lead calls `start` through Shephrd's tools, with
   its own token. It asks for a Codex worker on any Codex account, in a
   folder, in the group "auth", with the permission mode "ask before every
   change", and with a first prompt.
2. **The command handler checks.** The token identifies the lead. The handler
   refuses a permission mode wider than the lead's own, and refuses a request
   id it has seen before. It picks the Codex account, writes "agent started"
   with the lead as parent, and creates the worker's token.
3. **The runner starts the worker.** It starts `codex-acp` as a child process
   with the account's home directory, the worker's token and Shephrd's
   tools. It opens an ACP session and writes the session id.
4. **The worker works.** The first prompt is written as "prompt sent, from the
   lead", then sent. Everything the worker streams back becomes events, and
   any subscribed device sees them live.
5. **The worker asks for permission.** The runner writes "permission
   requested", routed to the lead, and holds the worker's request open. The
   worker's state becomes "waiting on a permission".
6. **The lead sees it.** If the lead is idle, the request is delivered to it as
   a prompt at once. If the lead is busy, it is delivered when the lead's turn
   ends. This costs the lead a turn. The lead answers it, or calls `pass-up`.
7. **The owner answers from the phone.** `pass-up` writes "owner needed". The
   owner taps Allow, and the handler writes "permission answered, by the
   owner". The runner releases the worker.
8. **The lead is woken once.** Earlier, the lead called `wait` on the worker and
   ended its turn. When the worker's turn ends, the engine writes "wait
   satisfied" and delivers one prompt to the lead with the result. Nothing
   polls.

The first answer to a permission request wins, and any later answer is
refused. The owner and the lead can therefore never both answer the same
request.

## Agent states

An agent is always in exactly one of these states:

| State | Meaning |
| --- | --- |
| Starting | The adapter is starting, or the session is opening. |
| Working | A turn is running. |
| Idle | The last turn ended, and nothing is running. |
| Waiting on a permission | A permission request from this agent is open. |
| Waiting on an answer | A question from this agent, sent with `ask`, is open. |
| Paused for a limit | The account ran out of usage. This is not a failure. |
| Interrupted | Shephrd restarted while this agent was running. |
| Crashed | The adapter process ended without being stopped. |
| Stopped | The agent was stopped with `stop`. |

Every change of state is an event, so `subscribe` reports it.

## When things fail

1. **An agent crashes.** The runner writes "agent crashed", with the exit code
   and the last lines of the agent's error output, with secrets removed. Its
   open permission requests close as cancelled. Anyone waiting on it is woken
   once with the reason "crashed", and its parent is told. For an agent the
   owner started, the parent is the owner, so the crash produces an "owner
   needed" event. The engine does not restart it. Retrying is the sheepdog's job, in piece 4, because an
   agent that crashes on some input will usually crash again on the same
   input.
2. **Shephrd itself restarts.** The engine rebuilds the views from the log.
   Every agent that was running is marked "interrupted", and its open
   permission requests close, because the process that asked has gone. Each
   agent's ACP session is reloaded where its adapter supports reloading,
   which costs no model turn. A reloaded agent that was idle goes back to
   "idle". A reloaded agent that was in the middle of a turn gets one "you
   were interrupted, carry on" prompt. An agent whose adapter cannot reload
   stays "interrupted" until the owner or its parent calls `resume`. Open
   waits stay open through the restart.
3. **Nothing is half-written.** Each command's events are written in one
   transaction, and a resent request id acts once.
4. **A permission request has nobody to answer it.** If the agent it is routed
   to has stopped or crashed, the request moves up to that agent's parent, and
   finally to the owner. It never times out into an answer by itself, because
   a silent "deny" or "allow" would be a decision nobody made.
5. **An account is signed out or out of usage.** The runner tells the two
   apart from the adapter's error. A signed-out account is marked as needing
   sign-in, and the owner is told. An agent that runs out of usage is marked
   "paused for a limit", with the reset time when the harness gives one. New
   agents asking for any account skip that account until it is usable again.
6. **A message is for an agent that cannot take it.** A message for a busy,
   interrupted or paused agent stays queued, in order, and is delivered when
   the agent can take it. It is never dropped. A message for a crashed agent
   goes back to its sender with the reason.
7. **Leftover processes after a hard crash.** When a runner starts an adapter,
   it records the process group and its start time. On the next start, the
   engine stops any recorded group that is still alive. It checks the start
   time first, so it never stops an unrelated program that reused the number.
8. **The disk or the database fails.** The engine refuses new commands and says
   why. It never acts without writing first, so nothing happens that the log
   does not show.

Effect provides the mechanics for rules 1, 2 and 7. Every agent's process and
streams belong to one owner, so stopping or losing an agent cleans up
everything under it.

## How the engine is tested

1. **A scripted fake agent.** A small program that speaks real ACP over
   standard input and output, built on the agent side of T3 Code's ACP
   package. Each test gives it a script: stream some text, call a tool, ask for
   permission, end its turn, crash, run out of usage, or be signed out. It
   costs no usage and runs in seconds.
2. **Recorded real sessions.** A real Claude Code session and a real Codex
   session are each recorded to a file once, and tests replay them. This
   catches how the real adapters behave without spending usage on every run.
3. **Tests for each part.** Each of the six parts is tested on its own, with
   Effect swapping in fakes for the other five.
4. **The rebuild check.** After every test, the views are rebuilt from the log
   alone and compared with the live views. If they differ, the rule that the
   log is the whole truth has been broken.
5. **The acceptance suite.** One scenario for each of the twelve capabilities
   and each of the eight failure rules, including "One request, start to
   finish" above. Every scenario goes only through the public API, with real
   agent tokens and a real owner credential. One scenario kills the service in
   the middle of a turn and restarts it.
6. **A live check, by hand.** "One request, start to finish" against the real
   Claude Code and Codex adapters, on the owner's accounts. It runs by hand
   before a release, not on every change, because it spends usage.

The engine counts as done when tests 4 and 5 pass and test 6 has passed once.

The test runner is Vitest with `@effect/vitest`, which T3 Code also uses.

## Code to copy from T3 Code

T3 Code is MIT-licensed, by T3 Tools Inc. Every piece copied from it follows
`AGENTS.md` rule 2: it goes under `third_party/t3code/` with the licence, a
README naming the source commit and files, a NOTICE entry, and the original
copyright lines. Each candidate is read in full before it is copied, and the
implementation plan records what was changed.

| What | Where in T3 Code, at commit `6fc9144` | Used for |
| --- | --- | --- |
| The ACP client and agent | `packages/effect-acp` | The runner, and the fake agent. |
| The event store | `apps/server/src/orchestration-v2/EventStore.ts`, `apps/server/src/persistence/OrchestrationEventStore.ts` | The event log. |
| Accounts | `packages/contracts/src/providerInstance.ts`, `packages/provider-core/src/server/instanceEnvironment.ts`, `apps/server/src/provider/Drivers/ClaudeHome.ts` | Accounts. |
| The Codex shadow home | `apps/server/src/provider/Drivers/CodexHomeLayout.ts`, `apps/server/src/provider/CodexManagedHome.ts` | Codex accounts that share sessions. Not read yet. |
| Replay and fake programs | `packages/provider-testing` | Tests 1 and 2. |

T3 Code's code is written for T3's own design. Where Shephrd's design
differs, such as permission routing, waits and deliveries, the copied code is
changed rather than used as it is.

## Security

The engine keeps every rule in SECURITY.md's "Security rules the design
keeps". The ones the engine itself enforces are:

- The API listens on the loopback address by default (rule 1).
- Every request is authenticated, including on loopback (rule 2).
- Each device credential can be revoked on its own (rule 4).
- Secrets, including agent tokens and account keys, never reach the log or a
  client (rule 6). Agent tokens are stored only as hashes. A crash report has
  secrets removed before it is written.
- Agent text is data, not a command (rule 7). Permissions change only through
  authenticated commands, and never wider than the caller's own permission
  mode.

Pairing (rule 3) and encrypted remote access (rule 5) belong to piece 2.

## What this spec leaves open

- **Packaging.** Shephrd could run as a Node.js program or as one file
  compiled with Bun. Effect supports both. T3 Code runs on Node.js, so the
  copied code is known to work there.
- **Licence.** Shephrd's own licence is not chosen yet.
- **The log's retention rule.** Recorded in `docs/issues.md`.
- **The client API (piece 2).** Device pairing, phone alerts, remote access
  and the web page need their own short design round. This spec gives piece 2
  the `subscribe` call, the "owner needed" event and per-device credentials
  to build on.

## Changes after the plan review (2026-11-01)

Four independent reviewers checked the implementation plan twice on
2026-11-01 and found gaps in this design. The changes below amend the sections above. Where
they disagree, this section wins. Each change is a row in
`.plans/plans/shepherd-engine/decisions.md`, named in brackets.

### How clients reach the engine (row 21)

The engine listens on a Unix domain socket, `engine.sock`, in Shephrd's
state folder, not on a TCP port. The state folder is `$SHEPHRD_HOME`, which
defaults to `~/.local/state/shephrd`, and only the owner's user can open it,
so only the owner's user can connect. Every connection still presents a
credential before it can do anything (row 48). The loopback WebSocket for the web page and the phone moves to piece 2,
which adds Origin and Host checks and connection limits.

### One state machine (row 24)

An agent's lifecycle state is one of: starting, working, idle, paused,
interrupted, crashed or stopped. A paused agent records why: a usage limit,
or a signed-out account. "Waiting on a permission" and "waiting on an
answer" are counted from open requests and questions, so an agent can be
waiting on both. The contracts hold one table of which command is allowed in
which state. `resume` works on stopped, crashed and interrupted agents.
`compact` works only on an idle agent. A prompt to a working agent is queued;
a prompt to a crashed or stopped agent is refused.

### When a wait is satisfied (rows 25, 26, 50)

A waited-on agent counts as done when it is settled. Settled describes the
agent's current state: it is idle, every message sent to it has been
accepted, it has no open request or question of its own, it holds none for
anyone else, it has no open wait, and it is not compacting. It also counts,
with that reason, when it crashes, stops, pauses, or is interrupted and
cannot be reloaded. So a lead that ends its turn to wait on its workers does
not wake the orchestrator that is waiting on the lead.

- An agent becomes working as soon as a message is sent to it. A first
  prompt given to `start` is queued in the same step as the start.
- A holder that ends its turn without answering a request delivered to it,
  or passing it up, has the request passed up for it.
- A wait ends without a wake ("wait cancelled") when a blocking wait's
  connection closes, or when the waiter stops or crashes.
- Each wait is checked when it opens, with every event that could satisfy
  it, and again after a restart, so a wake cannot be lost. The waiter gets
  one message that gives each member's state when the wait closed. A crash
  is reported at once as well.
- A blocking `shephrd wait --block` returns at once if the caller already
  holds a request or question, and returns as soon as one is routed to it,
  so it cannot deadlock.

### Who holds a request, and who has a parent's rights (rows 27, 51)

A permission request or a question goes to the nearest ancestor that is idle
or working, and to the owner if there is none. Whenever the owner becomes the
holder, the owner is alerted. When a request moves, the old holder's copy is
withdrawn, and a request never moves back down. `pass-up` follows the same
rule from the holder's parent. A parent's rights over its children pass up
in the same way while the parent is crashed, stopped, paused or interrupted,
so an orchestrator can manage a crashed lead's team. Stopping an agent does
not stop its children. An answer is accepted only from the current holder or
the owner. This replaces the "chosen in this spec" rule that a parent's
rights reach only its own children.

### Coming back from a pause, and picking accounts (rows 28, 53)

- When a harness gives a reset time, the engine writes "account available"
  at that time, measured by the wall clock, and that clears usage pauses.
- A signed-out account is cleared only by the owner, with
  `accounts mark-available`.
- A usage pause with no reset time alerts the owner.
- An agent that paused in the middle of a turn is told to carry on when it
  comes back.
- Pauses and their timers survive a restart.
- "Any account" picks the usable account with the fewest agents that are
  starting, working, idle or paused, and breaks ties by account id. With no
  usable account, `start` is refused with the reason.

### Messages that survive a restart (rows 29, 51)

A message to an agent is queued, then sent, then accepted. It counts as
accepted only when the adapter replies successfully or starts producing
output. An error reply, such as "out of usage", puts the message back at the
front of the queue. Each message carries its own id inside its envelope.
After a restart, the engine looks for that id in the reloaded conversation:
a message the agent already received is not sent again, and the agent is
told to carry on instead. A message the reloaded conversation does not show
may be sent twice; none is lost. Only a usage or sign-in error puts a
message back in the queue; any other error returns it to its sender.

### Repeated requests (row 30)

A request id belongs to its caller. The same caller reusing an id with a
different request is refused. Another caller's id is a different request.

### Start-up order (rows 31, 49, 52)

The owner chose fully automatic recovery (row 49). In order:

1. The engine takes a lifetime lock, so a second copy reports the running one
   and exits.
2. It removes a leftover socket file and listens, but refuses every
   connection with "recovering" until step 9. Shephrd's tool server for agents retries
   for up to a minute.
3. It rebuilds the views.
4. It revokes every agent token.
5. It stops leftover adapter processes and waits for them to exit. A leftover
   process is stopped only when its boot, start time, user and program all
   match the record.
6. Agents that were working or idle are marked interrupted, recording what
   each was doing. Paused agents stay paused. Open permission requests are
   cancelled, because the process that asked is gone. Questions stay open.
7. It reloads every agent it can, except paused ones, each with a new token.
   Each reload sets the agent's state and queues what it must be sent in one
   step, so a reloaded agent never looks finished by mistake. A failed
   reload is recorded with its reason. A paused agent is reloaded when its
   pause clears.
8. It restarts the pause timers, and clears pauses whose reset time passed
   while it was down.
9. It moves requests and questions whose holder could not be reloaded,
   re-checks every wait, and starts serving commands.
10. It re-sends messages that were not accepted, or tells an agent that was
    mid-turn to carry on. `resume` does the same for one agent.

### What agents are given (rows 32 to 38, 54 to 58)

- Each start, resume or reload gives the agent a new token, and the old one
  stops working. Stopping, a crash or a restart also revokes it.
- The adapter's environment is built from a short allow-list plus the
  account's own settings, and exactly two Shephrd variables: the socket path
  and the token. Herdr's variables and unrelated API keys are never passed on.
- Shephrd's command-line tool acts as the owner only when neither Shephrd
  variable is set and the command was not started from inside an agent's
  process tree. It checks the socket and its folders before it sends any
  credential. The agents' tool server never acts as the owner.
- Agents get Shephrd's commands as tools, except the owner's commands, the
  live stream and the secret-setting command.
- The engine offers agents no file or terminal access through ACP. Agents use
  their own harness's tools and sandbox.
- The permission ceiling also covers where a child works (inside its
  parent's folder, or a worktree of the same repository, and never the
  owner's home folder, Shephrd's state folder or Shephrd's own install),
  the "allow always" kind of answer, and mode changes the adapter reports.
  An answer that would save a permission rule, or a request to edit a
  harness's settings file, always goes to the owner.
- Every secret Shephrd knows is removed from every event before it is
  written, including encoded forms and secrets split across streamed pieces,
  and from the service's own log.
- Text from one agent that reaches another is wrapped in an envelope with a
  random marker and labelled as data. A leading `/` in any prompt one agent
  sends to another is escaped, so it cannot run a command.
- Shephrd's files are readable only by the owner's user.

### What agents can read (rows 47, 61)

Agents run as the owner's Unix user, so they can read Shephrd's state
folder, including the owner's credential. The owner accepted this on
2026-11-01: the permission ceiling protects against mistakes, not against a
deliberately hostile agent, and SECURITY.md says so. Where a harness offers
a way, Shephrd adds a rule forbidding its agents to read the state folder.
The real fix, Shephrd running as its own Unix user, comes before remote
access is built.
