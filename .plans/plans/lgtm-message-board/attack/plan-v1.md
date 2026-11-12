---
topic: lgtm-message-board
status: attack
tier: M
created: 2026-11-03
updated: 2026-11-03
epic: lgtm-foundation
---

# Build LGTM Studio's message board

## Overview

This plan builds the third of LGTM Studio's four pieces: the message board. The
board lets agents and the owner talk in channels and in direct messages,
and it decides who is woken by each message. The epic that holds the four
pieces sets the board's test: "A message on the board wakes only the agent
that needs to answer it." Every wake costs the woken agent a full turn of
its model. In the owner's earlier runs on Herdr Synapse, wakes that nobody
needed were the largest cost, so the board's main job is to wake as little
as possible without ever losing a message.

The engine, piece 1, already runs agents, keeps every event in a numbered
log, queues messages for each agent, and sends them through one interface
that does not care how the agent is run. Today there is no board: agents
can only prompt their own children, wait on them, or ask their parent a
question. A lead cannot ask a sibling lead anything, and a worker cannot
answer a question from anyone but its parent.

The recommended approach builds the board as a "piece" inside the engine's
process. The client API plan, piece 2, starts with one engine unit that
lets a piece add its own commands, events and views to the engine without
changing anything the engine already does. The board uses that extension
point. Each post is written to the engine's log, and in the same step the
board queues a wake for exactly the agents the post needs an answer from.
The engine's existing machinery then delivers that wake when the agent can
take it, in order, exactly once, through the same interface for every kind
of agent. Posts that need no answer wake nobody; the agent gets them with
its next real wake, or when it reads the channel.

There is one material uncertainty. The engine's design says the other
pieces are built on it "without changing it". The extension point is an
addition to the engine: nothing the engine does today changes, and every
existing engine test passes unchanged. The lead has sent that reading to
the owner as one question covering the client API and the board, and this
plan assumes the owner agrees. If the owner refuses, the board cannot be
built as planned, and the plan is rewritten.

The board knows nothing about teams, roles or workflows, because those do
not belong in LGTM Studio. The roles plan, piece 4, decides which channels
exist and who is in them. This plan writes a contract for it,
`contract.md`, answering each of its seven requests: four accepted as
asked, two accepted in another form, and one refused, with the reason.

## Key decisions

**Who is woken.** A post either needs a reply or does not. One that needs a
reply names its addressees and wakes exactly them. One that does not wakes
nobody, ever, and there is no timer that wakes for it later. When an
addressee answers, the asker is woken with the answer, so nobody has to
check back. The consequence is that a post that needs no reply may sit
unread until the agent's next real wake; the roles plan can force an early
hand-over with the "flush" command.

**Several wakes become one.** An agent never has more than one board wake
waiting. A new post for it while one is waiting replaces that wake with one
that carries both posts. This saves turns. A wake already on its way is
never changed.

**A question to several agents can wait for all of them.** A post can need
a reply from any one addressee, or from all of them. A lead that hands work
to three workers, asking all three to reply, is woken once, when the last
one replies. This replaces the Foundry's result-file collections.

**An agent waiting for a board answer is not finished.** If a lead asks
another lead a question and ends its turn, anyone waiting on the first lead
is not woken until its question is answered or closed. The engine's
existing waits already treat an open engine question this way; the board
adds the same rule for its own questions through the extension point.

**Channels follow the engine's authority.** An agent can open a channel and
add only the agents it already has authority over, and its own parent.
Two sibling agents can talk only if their common parent puts them in a
channel together, or they share one already. A channel can also follow an
engine group, so the roles plan's team is one membership list, not two.

**Privacy has a stated edge.** A channel is readable through the board only
by its members and the owner. A member's parent can still see what the
member was sent, because the engine has always shown a parent its child's
whole conversation. The plan says so rather than promising more.

**Text is data.** A post's text reaches another agent wrapped and labelled
as data, with any leading slash escaped, and secrets are removed before it
is written. No post can change permissions, members or settings. Only
LGTM Studio's own code, never an agent or a device, can post as LGTM Studio.

**The owner's phone hears about questions for the owner.** A post that
needs the owner's reply raises one alert on the owner's devices, through
the client API's alert rules, and the alert ends when the post is answered.

**Two parts are refused.** The board does not keep a "work state" per
agent, and it does not track each harness's prompt-cache deadline. Both are
the roles plan's policy. The board gives it the facts to decide them: a
status call per agent, and a flush command.

Full log → `decisions.md`

## Workstreams

### One shared definition of the board's commands and events

The board's seven commands and five events get their own shared
definitions package, which every client and the engine read. The risk is a
definition that shows a private message to the wrong agent, or a name that
collides with another piece's; tests check that every board event is
hidden from agents and that every name is unique. When done, the owner can
see the board's commands in `lgtm --help`.

### Channels, members and who may read them

The board keeps its own picture of channels, members, posts, open
questions and read positions, rebuilt from the log like the engine's own.
It enforces who may open a channel, add members, post and read. The risk
is a rule that lets an agent read or reach more than the engine allows
it; each rule has its own test that tries the forbidden case. When done, a
test shows a worker refused when it tries to read a channel it is not in.

### Posts that wake only the agent that must answer

Writing a post records it and queues its wakes in one step. Answers close
questions and wake the asker. Wakes for the same agent are merged. A
question whose every addressee has stopped or crashed is closed, and its
asker is told once. The risk is a lost or doubled wake, which would cost a
turn or leave an agent waiting forever; the tests restart the service in
the middle and count the wakes. When done, the epic's line is a passing
test: in a channel of four, a question to one wakes that one only.

### One door for agents, the owner and LGTM Studio's own code

The board's commands become LGTM Studio tools for agents, `lgtm board …`
commands for the owner's terminal, and calls for the web page and the
phone, all through the extension point with no door of their own. LGTM Studio's
own code, such as the roles plan's stall watch, posts through the same
commands under its own name. The risk is a new door that skips a check; the
board's commands go through the engine's one command handler, with its
identity, request ids and receipts. When done, a real `lgtm board post`
from the terminal wakes an agent.

### Proof that the board needs nothing else

An acceptance suite drives every board rule through the public connection
only, with real agent tokens and the fake agent. One check proves the board
never looks at how an agent is run, so an interactive agent can later join
the same channel. When done, `pnpm check` passes with the old engine suite
unchanged and the new board suite added.

## Rollout order

1. **The engine's extension point, from the client API plan.** The board
   registers through it, so nothing of the board can start before it.
2. **Shared definitions.** Every later unit compiles against them, and the
   roles plan reads them too.
3. **The board's picture and its rules.** These are pure functions over the
   log, testable without a running agent.
4. **Posts and wakes.** This is the core, and it needs the picture and the
   rules.
5. **The doors.** The commands reach agents and the owner only once the
   rules behind them are proven.
6. **The acceptance suite.** It runs last, through the doors, and it must
   pass with every existing engine test unchanged. The owner then runs one
   `lgtm board post` from the terminal.

The work lands on a branch from `engine` after the extension point merges.
Nothing in this plan is irreversible: the board's events are new types in
the log, its tables are its own, and no existing table changes.

---
<!-- ⛔ implementation details and gate evidence below; owner overview is complete -->

<details><summary><b>Implementation details (gates 2, 3, 5, 6, 8)</b></summary>

Conventions for every unit. Paths are relative to the LGTM Studio repository
root. Engine anchors come from `scouting.md` (scans at `8ff4c9b`). "The
seam" is the extension point in the client API contract
(`.plans/plans/lgtm-client-api/contract.md`, sections 1 to 3 and 6,
frozen as v2 at `75ab185` with the addendum `cd1d836` and items 13 and 14,
row 42); "seam item N" is that contract's section 6, item N. Its own file and symbol
anchors do not exist yet; greenfield anchors below give the target path and
the neighbouring pattern file, and every unit re-reads the frozen contract
before it starts. A "test id" is a Vitest file path, run with
`pnpm vitest run <path>`. "Rows" are rows in this plan's `decisions.md`.
RPC means remote procedure call: one request and its reply. ACP is the
Agent Client Protocol, through which the engine drives agents. MCP means the
Model Context Protocol, through which agents get LGTM Studio's tools. Effect
code is written from Effect 4.0.5's current documentation, looked up,
never from memory (`AGENTS.md`, "Language"); this plan names no Effect
function that the engine or the client API contract does not already name.
No unit edits `package.json`, `pnpm-workspace.yaml` or `pnpm-lock.yaml`;
the two new packages' manifests are a dependency (known gap 4). Every unit
records any problem it finds in `docs/issues.md` in the same change
(`AGENTS.md` rule 3). Every unit keeps the regression gate: `pnpm check`
passes, and no existing test file under `packages/*/test/` is edited.

The board's code lives in two new packages: `packages/board-contracts`
(schemas; pattern `packages/contracts/src/`) and `packages/board`
(handlers, view, reactor, wake builder; pattern
`packages/engine/src/routing/`). `packages/board` depends only on
`packages/contracts`, `packages/board-contracts` and the seam's exported
helpers, never on `packages/engine/src/runner/`. Tests live in
`packages/board/test/` (pattern `packages/engine/test/routing/`), and the
acceptance tests in `packages/engine/test/acceptance/board-*.test.ts`
(pattern `flow-start-to-finish.test.ts`), or wherever the seam unit puts
the composed service's acceptance harness.

**WS-1: One shared definition of the board's commands and events**

Defines the board's ids, events, commands, access table, visibility table
and alert source. Fields follow `contract.md`. Names follow the seam's
namespace rule: commands `board.<name>`, event tags `board.<PascalName>`.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 1.1 | `ChannelId`, `PostId`, `WakeId` are branded ids; `ReplyMode` is `none`, `any` or `all`; `BoardAuthor` is owner, agent or service | Test id: `packages/board-contracts/test/schemas.test.ts`, "ids, modes and authors" |
| 1.2 | `board.ChannelOpened`, `board.ChannelMembersChanged`, `board.PostWritten`, `board.PostClosed` and `board.Read` round-trip unchanged | Test id: `packages/board-contracts/test/schemas.test.ts`, "events round-trip" |
| 1.3 | Every board event is `owner-only` in `boardVisibility`, and no board event has a top-level `agentId` field | Test id: `packages/board-contracts/test/schemas.test.ts`, "hidden from agents" |
| 1.4 | `boardAccess` matches `contract.md`'s command table: `board.flush` has no `agent`; only `board.post`, `board.status` and `board.flush` have `service` | Test id: `packages/board-contracts/test/schemas.test.ts`, "access table" |
| 1.5 | A post's text refuses more than 16,384 characters, `to` more than 16 addressees, a channel more than 64 members, and a channel name that is not a slug of at most 64 characters | Test id: `packages/board-contracts/test/schemas.test.ts`, "limits" |
| 1.6 | `boardAlertSources` raises kind `board.post` with key `post:<postId>` for a post that needs the owner's reply, and ends it on `board.PostClosed` | Test id: `packages/board-contracts/test/alerts.test.ts` |
| 1.7 | Every command and event name in the composed API is unique | The seam's uniqueness test in `packages/api` (client API contract, section 1, "Namespaces") passes with the board registered |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 1a | Ids, `ReplyMode`, `BoardAuthor` | Greenfield `packages/board-contracts/src/ids.ts`; pattern `packages/contracts/src/ids.ts`, `AgentId` |
| 1b | The five events, as `BoardEvent` | Greenfield `packages/board-contracts/src/events.ts`; pattern `packages/contracts/src/events.ts`, `QuestionAsked` |
| 1c | The seven commands, as `BoardRpcGroup`, built unprefixed and prefixed with `board.` as the seam requires | Greenfield `packages/board-contracts/src/commands.ts`; pattern `packages/contracts/src/commands.ts`, `CommandsRpcGroup` |
| 1d | `boardAccess`, `boardVisibility`, `boardAlertSources` | Greenfield `packages/board-contracts/src/index.ts`; shapes from the client API contract, section 1 ("A piece's contracts package exports exactly these five things") and section 4 |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A board event visible to agents through `subscribe` would show a direct message to the author's parent | High | Criterion 1.3; the field is named `author`, never `agentId` |
| The seam's frozen shape differs from contract v1, which this plan was written against | Medium | Every unit re-reads the frozen contract; differences go to the lead as a question (known gap 5) |
| A name collides with another piece's | Low | Criterion 1.7 |

**Verify:** the two test ids above and the seam's uniqueness test. Device or environment QA: none.

**WS-2: Channels, members and who may read them**

The board's view, rebuilt from the log, and the pure rules that decide
who may open, add, post and read. Two units: 2a the view, 2b the rules.

The view (`packages/board/src/view.ts`) holds: channels (id, name,
manager, explicit members, optional group label, kind plain, group or
direct), posts (id, channel, author, text, `to`, reply mode, `replyTo`,
status open, closed, unanswerable or withdrawn, replies received), read
positions per member and channel, the wake index (wake id to post ids, and
each agent's queued or sent board wake, from the engine's delivery events
whose source is `{ namespace: "board" }`), and the reactor's last handled
sequence (row 38). A group channel's members are computed from the
engine's agents view at read time, not stored, so the engine's `group`
command changes them with no board event (row 27).

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 2.1 | `boardAfter` folds every board event, and the engine's `DeliveryQueued`, `DeliverySent`, `DeliveryAccepted` and `DeliveryWithdrawn` for board wakes, and ignores every other event | Test id: `packages/board/test/view.test.ts`, "fold" |
| 2.2 | The board's view rebuilt from the log alone equals the live view after every board test | The seam's rebuild check covers piece views (seam item 4); `pnpm vitest run packages/board/test` exits 0 |
| 2.3 | An agent can add to a channel only an agent it holds and its own holder; every other add is refused with a reason | Test id: `packages/board/test/access.test.ts`, "adding members" (cases: child, parent, sibling refused, cousin refused, owner adds anyone) |
| 2.4 | A manager's rights pass to its holder when it stops or crashes | Test id: `packages/board/test/access.test.ts`, "manager rights pass up" |
| 2.5 | A group channel can be opened only by the owner or by an agent that holds or is held by every agent carrying the label; its members follow `AgentGrouped` | Test id: `packages/board/test/access.test.ts`, "group channels" |
| 2.6 | A direct channel opens only between an agent and its holder, an agent it holds, an agent it shares a channel with, or the owner; a second open for the same pair reuses the first | Test id: `packages/board/test/access.test.ts`, "direct channels" |
| 2.7 | A non-member cannot read or post in a channel; the owner, every device and a service with access can | Test id: `packages/board/test/access.test.ts`, "read and post" |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 2a.1 | Write `emptyBoard` and `boardAfter(state, envelope)` and register them as the board's view | Greenfield `packages/board/src/view.ts`; pattern `packages/engine/src/views/apply.ts`, `deliveriesAfter`, `emptyViews`; registration through seam item 1 |
| 2b.1 | Write the authority rules as pure functions over the engine snapshot and the board's view | Greenfield `packages/board/src/access.ts`; uses the seam's exported rights helper (seam item 8), which wraps `packages/engine/src/routing/holders.ts`, `holderAbove` |
| 2b.2 | Compute a group channel's members from the agents view | `packages/engine/src/views/apply.ts`, `AgentRow.groups` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| An authority rule lets an agent read a sibling's channel | High | Criteria 2.3 to 2.7 each test the forbidden case; unit 2b takes an attack pass |
| A group channel opened by a lead takes in agents the lead never held, when another parent adds the label to its own child | Medium | Known gap 3, for the security lens |
| A large view slows every command's snapshot | Low | Posts are folded as plain records; the view holds no derived indexes beyond the wake index |

**Verify:** `packages/board/test/view.test.ts`, `packages/board/test/access.test.ts`, the seam's rebuild check. Device or environment QA: none.

**WS-3: Posts that wake only the agent that must answer**

The `board.post` handler, the wake builder, closing rules, the reactor,
and the "hold unsettled" condition. Two units: 3a the post and its wakes,
3b the reactor, read positions and the settled condition.

How a post is planned (3a), inside the seam's command transaction (seam
item 3): check access (2b); refuse a post that needs a reply with no
addressee, or to a stopped or crashed addressee; return
`board.PostWritten`; if it replies to an open post and comes from one of
that post's addressees or the owner, record the reply, and when the reply
mode is met return `board.PostClosed`; compute the wake set (the
addressees of a post that needs a reply, minus the author and the owner,
plus the asker of any post this one closed); for each agent in the wake
set, if its board wake is still queued, return `DeliveryWithdrawn` for it
through the seam's planning helper (seam item 13, row 41); then return
one `DeliveryQueued` through the delivery helper (seam item 14), with
source `{ namespace: "board", id: <wake id> }`, the sender label
`board`, and a plain-text body built from every post that wake must carry
plus up to 20 unread posts that need no reply from it. In the body, each
post sits between its own fresh random markers, after a line naming its
author, channel and reply mode, with its leading slash escaped. The engine
wraps the whole body in its agent-text envelope; the board never passes
pre-wrapped text. The engine checks those engine events against its own rules and adds
its wait checks.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 3.1 | In a channel of four agents, a post needing a reply from one queues exactly one delivery, to that one | Test id: `packages/board/test/wakes.test.ts`, "wakes only the addressee" (counts `DeliveryQueued` events by target) |
| 3.2 | A post needing no reply queues no delivery for anyone | Test id: `packages/board/test/wakes.test.ts`, "no reply, no wake" |
| 3.3 | In `any` mode the first addressee's reply closes the post and wakes the asker once; a non-addressee's reply closes nothing | Test id: `packages/board/test/wakes.test.ts`, "any mode" |
| 3.4 | In `all` mode the asker is woken once, when the last live addressee replies, with every reply; earlier replies wake nobody | Test id: `packages/board/test/wakes.test.ts`, "all mode" |
| 3.5 | Three posts for one agent while its wake is queued leave exactly one queued board wake carrying all three; a wake already sent is not withdrawn | Test id: `packages/board/test/wakes.test.ts`, "wakes merge" |
| 3.6 | The wake reaches the agent inside the engine's agent-text envelope; inside it, each post sits between its own fresh markers with a leading slash escaped, so a post that copies another post's header cannot end it | Test id: `packages/board/test/wakes.test.ts`, "text is data" (cases from `packages/engine/src/routing/envelope.ts`, `escapeLeadingSlash`) |
| 3.7 | A secret registered with the redactor never appears in a stored post or wake | Test id: `packages/board/test/wakes.test.ts`, "redacted" |
| 3.8 | When every remaining addressee of an open post stops or crashes, the post closes as unanswerable and the author is woken once | Test id: `packages/board/test/reactor.test.ts`, "unanswerable" |
| 3.9 | When the author stops or crashes, its open posts close as withdrawn and nobody is woken; a board wake for a stopped agent is withdrawn and never returned to a sender | Test id: `packages/board/test/reactor.test.ts`, "author gone" |
| 3.10 | A wake's posts count as read once the engine writes `DeliveryAccepted` for it | Test id: `packages/board/test/reactor.test.ts`, "read on accept" |
| 3.11 | The reactor run twice on the same events writes each close once | Test id: `packages/board/test/reactor.test.ts`, "twice is once" |
| 3.12 | A waiter on an agent with a queued board wake, or on an agent with an open post of its own that needs a reply, is not woken until both clear | Test id: `packages/board/test/settled.test.ts` (the board's "hold unsettled" condition, row 33) |
| 3.13 | With the board not registered, the engine's settled test behaves exactly as today | The engine's existing wait tests under `packages/engine/test/routing/` pass unchanged |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 3a.1 | Handlers for `board.open`, `board.members`, `board.post`, `board.read`, `board.channels`, `board.status` and `board.flush`, each returning events | Greenfield `packages/board/src/commands.ts`; pattern `packages/engine/src/routing/questions.ts`, `ask`, and `packages/engine/src/commands/internal.ts`, `Plan`, `refused` |
| 3a.2 | Build a wake's plain-text body from posts | Greenfield `packages/board/src/wake.ts`; markers drawn as in `packages/engine/src/routing/envelope.ts`, `envelope`, and slashes escaped with `escapeLeadingSlash`, through the seam's exports; the engine's own wrapping is seam item 14 |
| 3a.3 | The board's rule for its wake when the target stops: withdraw, never return | Registered through seam item 11; the engine's existing rule for a `wait` source is `packages/engine/src/routing/deliveries.ts`, `movedOrWake` |
| 3b.1 | The reactor: closes for gone addressees and authors, read positions on accepted wakes | Greenfield `packages/board/src/reactor.ts`; pattern `packages/engine/src/accounts/available.ts`, `followAvailability`; registered through seam item 1 ("reactors") |
| 3b.2 | The "hold unsettled" condition: an agent with an open post of its own that needs a reply | Greenfield `packages/board/src/settled.ts`; registered through seam item 12 (row 33); the engine's test is `packages/engine/src/routing/waits.ts`, `settled` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A merge withdraws a wake the dispatcher is about to send, so the agent gets both or neither | High | The dispatcher writes `DeliverySent` in its own transaction before calling the runner (`deliveries.ts:dispatchQueued`); the handler withdraws only a wake whose status is still `queued` in the same transaction's snapshot. Criterion 3.5; post-build check 1 |
| The reactor writes a close twice after a restart | Medium | Each close is idempotent on the post's status; criterion 3.11 |
| A large unread backlog makes every wake long | Medium | At most 20 unread posts that need no reply ride along, with a count of the rest (row 18) |
| A busy agent's wake waits for its turn to end, so a reply is slow | Low | Accepted: ACP cannot add to a running turn (engine design, "The agent runner") |
| A question to a live agent that never answers keeps its author unsettled forever | Medium | Accepted for the board: catching a silent agent is the stall watch's job (epic plan 4), and `board.status` shows whom the author waits on |

**Verify:** `packages/board/test/wakes.test.ts`, `reactor.test.ts`, `settled.test.ts`; the unchanged engine suite. Device or environment QA: none.

**WS-4: One door for agents, the owner and LGTM Studio's own code**

Registers the board with the seam, so its commands become MCP tools, CLI
subcommands and client calls with no code of their own, and checks the
service caller's path.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 4.1 | Each board command runs with caller identity, a receipt and one transaction; a repeated request id acts once | Test id: `packages/board/test/handler.test.ts`, "identity, receipts, one transaction" |
| 4.2 | An invalid or stopped agent's token is refused for every board command | Test id: `packages/board/test/handler.test.ts`, "bad credentials" |
| 4.3 | Agents get `board.open`, `board.members`, `board.post`, `board.read`, `board.channels` and `board.status` as tools, and never `board.flush` | Test id: `packages/board/test/tools.test.ts` (reads the composed MCP tool list) |
| 4.4 | `lgtm --help` lists the seven `board` subcommands | Command: `./bin/lgtm --help` output contains `board post` and the six others; the seam's CLI parity test passes |
| 4.5 | A post from a service records the service's name as its author; no payload from a socket caller can set a service author | Test id: `packages/board/test/handler.test.ts`, "service author" |
| 4.6 | `board.status` answers the owner, a device, a service, the agent's holder and the agent itself, and refuses anyone else | Test id: `packages/board/test/handler.test.ts`, "status access" |
| 4.7 | A post from a paired device records the owner as author and the device in the envelope's `device` field | Test id: `packages/board/test/handler.test.ts`, "device post" |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 4.1 | The board's piece registration: group, events, access, visibility, handlers, view, reactor, alert source, delivery-source rule, hold-unsettled condition | Greenfield `packages/board/src/piece.ts`; registry from seam item 1; the composed service is built where the seam unit builds it (today `packages/engine/src/service.ts`, `program`) |
| 4.2 | Tool descriptions for the six agent tools | Wherever the seam keeps piece tool descriptions; today's pattern `packages/mcp/src/tools.ts`, `descriptions` |
| 4.3 | CLI summaries for the seven subcommands | Wherever the seam keeps piece summaries; today's pattern `packages/cli/src/commands/registry.ts`, `summaries` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A board command skips the receipt or identity step | High | The seam runs every piece command through the engine's handler (seam item 3); criteria 4.1 and 4.2; attack pass on this unit |
| A service author can be forged from the socket | High | The service path is in-process only (client API contract, section 2); criterion 4.5 |
| `board.flush` reaches agents and lets one agent spend another's turns | Medium | Access excludes `agent`; criterion 4.3 |

**Verify:** the test ids above; the seam's CLI and MCP parity tests. Device or environment QA: rollout step 6, one `lgtm board post` from the owner's terminal against a fresh `/tmp` service, which wakes a fake agent.

**WS-5: Proof that the board needs nothing else**

One acceptance file per main board rule, through the public socket only,
with real tokens and the fake agent.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 5.1 | The epic's line: in a channel of four, a question to one wakes that one only, and the reply wakes the asker only | Test id: `packages/engine/test/acceptance/board-wakes-only-addressee.test.ts` |
| 5.2 | A lead's hand-off in `all` mode to three workers wakes the lead once | Test id: `packages/engine/test/acceptance/board-collection.test.ts` |
| 5.3 | A direct message is refused to a non-member on `board.read`, and never appears in any agent's `subscribe` stream | Test id: `packages/engine/test/acceptance/board-privacy.test.ts` |
| 5.4 | No file under `packages/board/src/` imports from `packages/engine/src/runner/` or reads `runMode`; a channel with one agent recorded as `interactive` behaves the same | Test id: `packages/board/test/mode-independence.test.ts` |
| 5.5 | A service killed between a post and its wake delivers the wake once after restart | Test id: `packages/engine/test/acceptance/board-restart.test.ts` |
| 5.6 | Every existing engine test passes unchanged | Command: `pnpm check` exits 0; `git diff --stat <seam merge> -- packages/engine/test packages/contracts/test` lists only new `board-*` files |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 5.1 | The four acceptance files | `packages/engine/test/acceptance/`, pattern `flow-start-to-finish.test.ts`; harness `packages/engine/test/support/acceptance.ts`, `World`, `Spec` |
| 5.2 | Fake-agent scripts for posting, replying and ending turns | `packages/testing/src/fakeAgent.ts`, `Script`, `Step` (its `exec` step runs `lgtm board post` with the agent's token) |
| 5.3 | The import and `runMode` scan | Greenfield `packages/board/test/mode-independence.test.ts` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| The fake agent cannot call a board command mid-turn | Medium | Its `exec` step runs the `lgtm` tool with the agent's token (scouting scan 2, item 9); the unit reports a gap if it cannot |
| The interactive check proves too little, since no interactive runner exists | Medium | Accepted: the epic puts interactive mode later; the check proves the board never branches on mode, which is what the delivery interface needs (row 24) |

**Verify:** the criteria above. Device or environment QA: WS-4's terminal check.

**Post-build checks** (run rule 6: code-level worries a plan cannot settle)

1. The merge of a queued wake and the dispatcher's send (WS-3 risk 1):
   check under load that no agent receives a withdrawn wake.
2. A batch holding both an agent's stop and a post to it gives the same
   board view live and rebuilt.
3. Redaction of a combined wake: the redactor runs on each event, so check
   that a secret split across two posts is not rebuilt in the wake's text.

</details>

<details><summary><b>Traceability (gate 4)</b></summary>

Source universe: (a) the epic row 3 and its "Done when" line on wakes;
(b) `docs/features.md` section 2, its five items; (c) the roles plan's
seven requests (`requests.md`, "From the message board"); (d) `AGENTS.md`,
"How agents are run"; (e) SECURITY.md rules 6 and 7; (f) the Synapse list
items on channels, labels and waking (items 1 to 11, 13, 17, 19, 22);
(g) the client API contract's answers to the board's six needs (its
section 7).

| Source item | Workstream | Status |
|---|---|---|
| (a) Channels | WS-1, WS-2 | planned |
| (a) Direct messages | WS-2 | planned |
| (a) Wake rules | WS-3 | planned |
| (a) Behind one delivery interface | WS-3, WS-5 (5.4) | planned |
| (a) Done when: wakes only the agent that must answer | WS-3 (3.1), WS-5 (5.1) | planned |
| (b) Channels and direct messages | WS-2 | planned |
| (b) Wake rules | WS-3 | planned |
| (b) System events in a log | none needed | already true of the engine's log (row 22) |
| (b) A mailbox per agent, with receipts | WS-3 | uses the engine's deliveries; the hook path for interactive agents is out (row 4) |
| (b) Wake Claude without typing | none | out: interactive mode (row 4) |
| (b) Wait results that say why | WS-3 (3.12) | built in the engine; the board adds its hold-unsettled condition (row 33) |
| (c) 1 One delivery interface | WS-3 | accepted (row 31) |
| (c) 2 Work state per agent | none | refused (row 31) |
| (c) 3 Work done signal | WS-3 (3.4), WS-5 (5.2) | accepted as `all` mode (row 26) |
| (c) 4 System author, needs-reply kind | WS-4 (4.5) | accepted through the service caller; kind label refused (rows 14, 36) |
| (c) 5 Team is an engine group | WS-2 (2.5) | accepted (row 27) |
| (c) 6 Deliver before cache expiry | WS-3, WS-4 | accepted as `board.flush`; deadline tracking refused (row 29) |
| (c) 7 Read whether a post is waiting | WS-4 (4.6) | accepted as `board.status` (row 30) |
| (d) Board independent of run mode | WS-5 (5.4) | planned |
| (e) Rule 6, secrets never reach the board | WS-3 (3.7) | planned |
| (e) Rule 7, text is data | WS-3 (3.6), WS-4 (4.5) | planned |
| (f) Items 1, 2, 3, 6: channels, direct messages, across teams, threads | WS-2, WS-3 | adopted in the planner's reading; threads are `replyTo` |
| (f) Items 4, 5: one post to several teams, group channels | WS-2 | group channels adopted; a post is in one channel |
| (f) Item 7: action label | WS-1, WS-3 | adopted as `reply` |
| (f) Item 8: kinds | none | not adopted (row 14) |
| (f) Items 9, 17: digest, broadcasts stop waking | WS-3 | adopted (rows 15, 18) |
| (f) Item 10: no acknowledgement-only posts | none | not adopted; recorded for docs/features.md |
| (f) Item 11: open questions tracked | WS-3 | adopted (row 16) |
| (f) Item 13: one waker | WS-3 | adopted: the engine's dispatcher is the only sender |
| (f) Item 19: system events in a log | none needed | row 22 |
| (f) Item 22: collections | WS-3 | adopted as `all` mode |
| (g) 1 Commands on every transport | WS-4 | taken in by the client API |
| (g) 2 Board events owner-only | WS-1 (1.3) | taken in |
| (g) 3 Alert for owner posts | WS-1 (1.6) | taken in as alert source `board.post`; `OwnerNeeded` subject refused (row 35) |
| (g) 4 Paged reads | WS-3 (`board.read`) | taken in (row 39) |
| (g) 5 Device posts as owner | WS-4 (4.7) | taken in (row 40) |
| (g) 6 Transport size | none needed | taken in by the client API (1 mebibyte) |

</details>

<details><summary><b>Guardrails triggered (gate 9)</b></summary>

| Repo rule (CLAUDE.md etc.) | How this plan satisfies it |
|---|---|
| `AGENTS.md` rule 1: push only to `qnlbnsl/lgtm-studio` | The plan's branch is pushed to `origin` only |
| `AGENTS.md` rule 2: credit copied code | No code is copied; the board's code is new |
| `AGENTS.md` rule 3: keep the lists current | Every unit records problems in `docs/issues.md`; new feature ideas are in the result file for the lead |
| `AGENTS.md` rule 4: follow SECURITY.md | Rules 6 and 7 are criteria 3.6, 3.7 and 4.5 |
| `AGENTS.md` rule 5: the client API is the surface | Every board command is in the composed API, for every client (WS-4) |
| `AGENTS.md` rule 6: no team shapes | Channels carry no team, role or phase (row 10) |
| `AGENTS.md` rule 7: no commit unless asked | Units commit under the run's standing authorization (team rules, rule 2) |
| `AGENTS.md`, "How agents are run" | Row 5, criterion 5.4 |
| `AGENTS.md`, "Language" (Effect 4, Node.js 26) | Conventions paragraph |
| Engine design: pieces build on the engine without changing it | Rows 9, 32, 33; the regression gate in the conventions |
| Run rule 6: no `package.json` or lock edits | Conventions paragraph; known gap 4 |

</details>

<details><summary><b>Execution sizing (gate 10)</b></summary>

Models come from the harness-sessions plugin's model sheet (its harness-session skill)
at launch; this section names none (owner, 2026-10-16).

| Unit | Work area | Scope | Complexity | Why this complexity | Attack pass | Depends on |
|---|---|---|---|---|---|---|
| 1 Board contracts | contracts | board/contracts | medium | New schemas whose shapes `contract.md` fixes, on the seam's piece pattern. | no | the client API plan's seam unit; package manifests (known gap 4) |
| 2a Board view | backend | board/backend | medium | Pure fold functions on the engine's views pattern. | no | 1 |
| 2b Access rules | backend | board/backend | high | Authorization: who may read and reach whom. | yes | 2a |
| 3a Posts and wakes | backend | board/backend | high | Exactly-once wakes merged inside one transaction, racing the dispatcher. | no | 2b |
| 3b Reactor, read positions, settled condition | backend | board/backend | medium | One reactor on the seam's pattern, idempotent closes, one registered condition. | no | 3a |
| 4 Registration and doors | backend | board/backend | medium | Registration with the seam, which gives the tools, CLI and transports. | yes | 3b |
| 5 Acceptance suite | backend | board/backend | medium | Four tests on the existing acceptance harness, plus one scan. | no | 4 |

Scopes: `board/contracts` would edit `packages/board-contracts/**` and
`board/backend` would edit `packages/board/**`,
`packages/engine/test/acceptance/board-*` and `packages/testing/**`.
Neither exists under `.plans/scopes/` yet; the lead runs the scoping skill
for both before launch (known gap 4).

Load: 7 build units, 23 launches (7 × 3 for builder, test writer and
review, plus 2 attack passes). The lead looks up each unit's builder and
test writer from the sheet at launch and checks each vendor's remaining
weekly allowance first; the planner cannot read it (known gap 1).

</details>

<details><summary><b>Attack log (gate 7 — M/L only)</b></summary>

| Round | New findings (B/M/m) | Outcome |
|---|---|---|
| (none yet) | | The lead runs the four plan lenses after the freeze. |

</details>
