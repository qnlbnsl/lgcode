---
topic: shepherd-message-board
status: assemble
tier: M
created: 2026-11-03
updated: 2026-11-03
epic: shepherd-foundation
---

# Build Shephrd's message board

## Overview

This plan builds the third of Shephrd's four pieces: the message board. The
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

The recommended approach builds the board inside the engine's process, as
an addition to it. Each post is written to the engine's log, and in the
same step the board queues a wake for exactly the agents the post needs an
answer from. The engine's existing machinery then delivers that wake when
the agent can take it, in order, exactly once, through the same interface
for every kind of agent. Posts that need no answer wake nobody; the agent
gets them with its next real wake, or when it reads the channel.

There is one material uncertainty, sent to the lead as a question. The
engine's design says the other pieces are built on it "without changing
it". The board cannot be built without adding to some engine files: the
engine's list of commands, its list of event types, and its list of what a
queued message can come from are all fixed lists. The plan's recommendation
is to allow additions only: nothing the engine does today changes, and
every existing engine test passes unchanged. The alternative, a separate
board program, would have to act as the owner to reach other agents, and
it could not tell which agent was calling it. The lead has sent that
recommendation to the owner. Meanwhile the plan assumes it, in the form
the lead set: the client API plan's first unit builds one extension point
in the engine, and the board registers its commands, events and message
source through that point instead of editing the engine's files one by
one. The board's work therefore starts after that unit.

The board knows nothing about teams, roles or workflows, because those do
not belong in Shephrd. The roles plan, piece 4, decides which channels
exist and who is in them. This plan writes a contract for it,
`contract.md`, answering each of its seven requests: five accepted, one
accepted in another form, and one refused, with the reason.

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
is written. No post can change permissions, members or settings.

**Two parts are refused.** The board does not keep a "work state" per
agent, and it does not track each harness's prompt-cache deadline. Both are
the roles plan's policy. The board gives it the facts to decide them: a
status call per agent, and a flush command.

Full log → `decisions.md`

## Workstreams

### One shared definition of the board's commands and events

The board's seven commands and five events are added to Shephrd's shared
definitions, which every client and the engine use. Two existing
definitions each gain one case: a queued message can now come from the
board, and an "owner needed" alert can now point at a post. The risk is
that an addition quietly changes an existing definition; every existing
contract test must pass unchanged, and a new test checks that no board
event carries the field that would show it to the wrong agent. When done,
the owner can see the new commands in `shephrd --help`.

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

### One door for agents and the owner

The board's commands become Shephrd tools for agents and `shephrd board …`
commands for the owner's terminal, and are served to every client through
the engine's existing connection. A small internal module lets code inside
the engine, such as the roles plan's sheepdog, post as Shephrd itself. The
risk is a new door that skips a check; the board's commands go through the
engine's one command handler, with its identity, request ids and receipts.
When done, a real `shephrd board post` from the terminal wakes an agent.

### Proof that the board needs nothing else

An acceptance suite drives every board rule through the public connection
only, with real agent tokens and the fake agent. One check proves the board
never looks at how an agent is run, so an interactive agent can later join
the same channel. When done, `pnpm check` passes with the old engine suite
unchanged and the new board suite added.

## Rollout order

1. **The engine's extension point, from the client API plan.** The board
   registers through it, so nothing of the board can start before it.
2. **Shared definitions.** Every later unit compiles against them,
   and they are the part the client API and roles plans also read.
3. **The board's picture and its rules.** These are pure functions over the
   log, testable without a running agent.
4. **Posts and wakes.** This is the core, and it needs the picture and the
   rules.
5. **The doors.** The commands reach agents and the owner only once the
   rules behind them are proven.
6. **The acceptance suite.** It runs last, through the doors, and it must
   pass with every existing engine test unchanged.

The work lands on a branch from `engine`, after the current engine fix
round merges, because the fix round changes files the board also touches
(`service.ts` and the redactor). Nothing in this plan is irreversible: the
board's events are new types in the log, and no existing table changes.

---
<!-- ⛔ implementation details and gate evidence below; owner overview is complete -->

<details><summary><b>Implementation details (gates 2, 3, 5, 6, 8)</b></summary>

Conventions for every unit. Paths are relative to the Shephrd repository
root. Anchors come from `scouting.md` (scans at `8ff4c9b`). Greenfield
anchors give the target path and the neighbouring pattern file. A "test
id" is a Vitest file path, run with `pnpm vitest run <path>`. "Rows" are
rows in this plan's `decisions.md`; "engine rows" are rows in
`.plans/plans/shepherd-engine/decisions.md`. RPC means remote procedure
call: one request and its reply. MCP means the Model Context Protocol,
through which agents get Shephrd's tools. Effect code is written from Effect
4.0.5's current documentation, looked up, never from memory (`AGENTS.md`,
"Language"); where this plan names an Effect function, it is one the engine
already uses at the anchor given. No unit edits `package.json`,
`pnpm-workspace.yaml` or `pnpm-lock.yaml`. Every unit records any problem it
finds in `docs/issues.md` in the same change (`AGENTS.md` rule 3). Every
unit keeps the regression gate: `pnpm check` passes, and no existing test
file under `packages/*/test/` is edited, except to register the board's
rebuild comparison in `packages/engine/test/support/rebuildCheck.ts`.
All of this assumes row 9 is answered "additions only", in the form of
row 32: the board registers through the engine extension point ("the
seam") that the client API plan's first unit builds. Where a task below
names an engine file the board adds to (`commandNames`, `Event`,
`Delivery.source`, `OwnerNeeded.subject`, `supported`, `planCommand`,
`replyFor`, `movedOrWake`, the follower list in `CommandHandler.ts:layer`,
`Views.ts`, `compareViews`), the unit adds it through the seam's
registration call instead, if the seam offers one for it; the file and
symbol named are what the seam must reach (known gap 5). The seam's own
anchors are filled in when the client API contract is frozen.

The board's own code lives in `packages/engine/src/board/` (greenfield;
neighbouring pattern: `packages/engine/src/routing/`). Its tests live in
`packages/engine/test/board/` (pattern: `packages/engine/test/routing/`).

**WS-1: One shared definition of the board's commands and events**

Adds the board's ids, events and commands to `@shephrd/contracts`, and the
two additive cases in existing unions. Every other unit compiles against
these. Fields follow `contract.md`.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 1.1 | `ChannelId`, `PostId` are branded ids; `BoardAuthor` is owner, agent, or `system` with a slug name | Test id: `packages/contracts/test/board.test.ts`, "ids and authors decode and refuse bad input" |
| 1.2 | `ChannelOpened`, `ChannelMembersChanged`, `PostWritten`, `PostClosed` and `BoardRead` are in `Event`, and an encode-decode round trip returns each unchanged | Test id: `packages/contracts/test/board.test.ts`, "board events round-trip" |
| 1.3 | No board event has a top-level `agentId` field | Test id: `packages/contracts/test/board.test.ts`, "no board event has a top-level agentId" (reads each tagged struct's fields) |
| 1.4 | `Delivery.source` accepts `{ _tag: "board" }` and `OwnerNeeded.subject` accepts `{ _tag: "post", id }`; every existing case still decodes | Test id: `packages/contracts/test/board.test.ts`, "additive cases"; `pnpm vitest run packages/contracts/test/events-roundtrip.test.ts` passes unchanged |
| 1.5 | `board open`, `board members`, `board post`, `board read`, `board channels`, `board status` are agent-callable; `board flush` is owner-only | Test id: `packages/contracts/test/board.test.ts`, "board command access" (reads `commandAccess`) |
| 1.6 | `PostWritten.text` refuses more than 16,384 characters; `to` refuses more than 16 addressees; a channel name refuses a non-slug or more than 64 characters | Test id: `packages/contracts/test/board.test.ts`, "limits" |
| 1.7 | Every existing contract test passes unchanged | Command: `pnpm vitest run packages/contracts/test` exits 0 with no edited existing file (`git diff --stat engine -- packages/contracts/test` lists only `board.test.ts`) |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 1a | Add `ChannelId`, `PostId` | `packages/contracts/src/ids.ts`, pattern of `AgentId` (branded `NonEmptyString`) |
| 1b | Add `BoardAuthor`, `ReplyMode` (`none`, `any`, `all`) and the five board events | `packages/contracts/src/events.ts`, `Event` union; pattern of `QuestionAsked` |
| 1c | Add `board` to `Delivery.source` and `post` to `OwnerNeeded.subject` | `packages/contracts/src/events.ts`, `Delivery`, `OwnerNeeded` |
| 1d | Add the seven board RPCs; append their names to `commandNames`; add `board flush` to `ownerOnlyCommands` | `packages/contracts/src/commands.ts`, `CommandsRpcGroup`, `commandNames`, `ownerOnlyCommands` |
| 1e | Export the new schemas | `packages/contracts/src/index.ts` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A board event with a top-level `agentId` would show a direct message to the author's parent through `subscribe` | High | Criterion 1.3, and the field is named `author`, never `agentId` |
| Adding a case to an existing union breaks decoding of stored events | Medium | Criterion 1.4 re-runs the existing round-trip test unchanged |
| A new command name collides with the CLI's parsing of multi-word names such as `accounts set-secret` | Low | Names follow the same "noun verb" form; WS-4 criterion 4.4 checks the CLI's help |

**Verify:** `packages/contracts/test/board.test.ts`; the existing contract suite. Device or environment QA: none.

**WS-2: Channels, members and who may read them**

The board's views, rebuilt from the log, and the pure rules that decide
who may open, add, post and read. Two units: 2a the views, 2b the rules.

The board's views (`packages/engine/src/board/views.ts`): channels (id,
name, manager, explicit members, optional group label, kind), posts (id,
channel, author, text, `to`, reply mode, `replyTo`, status open, closed,
unanswerable or withdrawn, replies received), cursors per member and
channel, and the wake index (board delivery id to post ids, and each
agent's queued or sent board wake). A group channel's members are computed
from the engine's agents view (`groups`) at read time, not stored, so the
engine's `group` command changes them with no board event (row 27).

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 2.1 | `boardAfter` folds every board event and the engine events it reads (`DeliveryQueued`, `DeliveryAccepted`, `DeliveryWithdrawn` with a `board` source) into the board's views, and ignores every other event | Test id: `packages/engine/test/board/views.test.ts`, "fold" |
| 2.2 | The board's views rebuilt from the log alone equal the live views after every engine and board test | Test id: `packages/engine/test/support/rebuildCheck.ts` compares the board's views too; `pnpm vitest run packages/engine/test` exits 0 |
| 2.3 | An agent can add to a channel only an agent it holds and its own holder; every other add is refused with a reason | Test id: `packages/engine/test/board/access.test.ts`, "adding members" (cases: child, parent, sibling refused, cousin refused, owner adds anyone) |
| 2.4 | A manager's rights pass to its holder when it stops or crashes | Test id: `packages/engine/test/board/access.test.ts`, "manager rights pass up" |
| 2.5 | A group channel can be opened only by the owner or by an agent that holds or is held by every agent carrying the label; its members follow `AgentGrouped` | Test id: `packages/engine/test/board/access.test.ts`, "group channels" |
| 2.6 | A direct channel opens only between an agent and its holder, an agent it holds, an agent it shares a channel with, or the owner; a second open for the same pair reuses the first | Test id: `packages/engine/test/board/access.test.ts`, "direct channels" |
| 2.7 | A non-member cannot read or post in a channel; the owner can read and post in every channel | Test id: `packages/engine/test/board/access.test.ts`, "read and post" |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 2a.1 | Write `emptyBoard` and `boardAfter(state, envelope)` | Greenfield `packages/engine/src/board/views.ts`; pattern `packages/engine/src/views/apply.ts`, `deliveriesAfter`, `emptyViews` |
| 2a.2 | Keep the board's views beside the engine's, updated after each commit and rebuilt on start | `packages/engine/src/views/Views.ts`, `layer`, `applyCommitted`; `packages/engine/src/views/rebuild.ts`, `rebuild`. The board's fold runs after `apply`, on the same batch; the engine's eight views are not changed |
| 2a.3 | Compare the board's views in the rebuild check | `packages/engine/src/views/compare.ts`, `compareViews`; `packages/engine/test/support/rebuildCheck.ts`, `registerRebuildCheck` |
| 2b.1 | Write the authority rules as pure functions over the engine snapshot and the board's views | Greenfield `packages/engine/src/board/access.ts`; uses `packages/engine/src/routing/holders.ts`, `holderAbove` |
| 2b.2 | Compute a group channel's members from the agents view | `packages/engine/src/views/apply.ts`, `AgentRow.groups` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| An authority rule lets an agent read a sibling's channel | High | Criteria 2.3 to 2.7 each test the forbidden case; unit 2b takes an attack pass |
| Folding the board's views changes the engine's own views | High | The board's fold is a separate function on a separate state object; criterion 2.2 and the unchanged engine suite catch any drift |
| A group channel opened by a lead keeps receiving agents the lead never held, as other parents add the label | Medium | The label's members are added by their own parents through the engine's `group` command, which already checks that right; recorded as known gap 3 for the security lens |

**Verify:** `packages/engine/test/board/views.test.ts`, `packages/engine/test/board/access.test.ts`, the rebuild check over the whole engine suite. Device or environment QA: none.

**WS-3: Posts that wake only the agent that must answer**

The `board post` planner, the wake builder, closing rules, and one
follower for events that close posts. Two units: 3a the post and its
wakes, 3b the follower and read positions.

How a post is planned (3a), in the command's one transaction: check access
(2b); refuse a post that needs a reply with no addressee, or to a stopped
or crashed addressee; write `PostWritten`; if it replies to an open post
from one of that post's addressees or the owner, record the reply and, when
the reply mode is met, write `PostClosed`; compute the wake set (the
addressees of a post that needs a reply, minus the author, plus the asker
of any post this one closed); for each agent in the wake set, if it has a
queued board wake, write `DeliveryWithdrawn` for it; then write one
`DeliveryQueued` with content `prompt`, sender `owner`, source `board`, and
text built from every post that wake must carry plus up to 20 unread posts
that need no reply from it; for an owner addressee, write `OwnerNeeded`
with the `post` subject. The command handler adds the wait checks
(`withWaitChecks`), so a waiter on a woken agent stays open.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 3.1 | In a channel of four agents, a post needing a reply from one queues exactly one delivery, to that one | Test id: `packages/engine/test/board/wakes.test.ts`, "wakes only the addressee" (counts `DeliveryQueued` events by target) |
| 3.2 | A post needing no reply queues no delivery for anyone | Test id: `packages/engine/test/board/wakes.test.ts`, "no reply, no wake" |
| 3.3 | In `any` mode the first addressee's reply closes the post and wakes the asker once; a non-addressee's reply closes nothing | Test id: `packages/engine/test/board/wakes.test.ts`, "any mode" |
| 3.4 | In `all` mode the asker is woken once, when the last live addressee replies, with every reply; earlier replies wake nobody | Test id: `packages/engine/test/board/wakes.test.ts`, "all mode" |
| 3.5 | Three posts for one idle-then-busy agent leave exactly one queued board wake carrying all three; a wake already sent is not withdrawn | Test id: `packages/engine/test/board/wakes.test.ts`, "wakes merge" |
| 3.6 | Each post in a wake sits in its own envelope with a fresh marker, and a leading slash is escaped | Test id: `packages/engine/test/board/wakes.test.ts`, "text is data" (uses `escapeLeadingSlash` cases from `packages/engine/test/routing/`) |
| 3.7 | A secret registered with the redactor never appears in a stored post or wake | Test id: `packages/engine/test/board/wakes.test.ts`, "redacted" |
| 3.8 | A post needing the owner's reply writes `OwnerNeeded` with the `post` subject | Test id: `packages/engine/test/board/wakes.test.ts`, "owner addressee" |
| 3.9 | When every remaining addressee of an open post stops or crashes, the post closes as unanswerable and the author is woken once | Test id: `packages/engine/test/board/follower.test.ts`, "unanswerable" |
| 3.10 | When the author stops or crashes, its open posts close as withdrawn and nobody is woken; a board wake for a stopped agent is withdrawn and never returned to a sender | Test id: `packages/engine/test/board/follower.test.ts`, "author gone" |
| 3.11 | A wake's posts count as read once the engine writes `DeliveryAccepted` for it | Test id: `packages/engine/test/board/follower.test.ts`, "read on accept" |
| 3.12 | A restart between a post and its delivery delivers the wake once, and the follower's closes are written once | Test id: `packages/engine/test/board/restart.test.ts`, "no lost or doubled wake" (pattern `packages/engine/test/recovery/`) |
| 3.13 | A waiter on an agent with a queued board wake is not woken until the wake is accepted and the agent settles | Test id: `packages/engine/test/board/wakes.test.ts`, "wait sees the board wake" (relies on `routing/waits.ts:settled`) |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 3a.1 | Plan `board post`, `board open`, `board members`, `board read`, `board flush` as functions returning a `Plan` | Greenfield `packages/engine/src/board/commands.ts`; pattern `packages/engine/src/routing/questions.ts`, `ask`, and `packages/engine/src/commands/internal.ts`, `Plan`, `refused` |
| 3a.2 | Build a wake's text from posts | Greenfield `packages/engine/src/board/wake.ts`; uses `packages/engine/src/routing/envelope.ts`, `envelope`, `escapeLeadingSlash` |
| 3a.3 | Treat a `board` source as a wake: withdraw, never return | `packages/engine/src/routing/deliveries.ts`, `movedOrWake` (one added case) |
| 3b.1 | Follow committed events and write closes for gone addressees and authors | Greenfield `packages/engine/src/board/follower.ts`; pattern `packages/engine/src/routing/deliveries.ts`, `dispatchCommitted` (subscribes before it forks) and `packages/engine/src/accounts/available.ts`, `followAvailability` |
| 3b.2 | Start the follower for the service's life | `packages/engine/src/commands/CommandHandler.ts`, `layer` (one added line after `followAvailability`) |
| 3b.3 | Mark a wake's posts read on `DeliveryAccepted` | `packages/engine/src/board/views.ts`, `boardAfter` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A merge withdraws a wake the dispatcher is about to send, so the agent gets both or neither | High | The dispatcher writes `DeliverySent` in its own transaction before calling the runner (`dispatchQueued`); the planner withdraws only a wake whose status is still `queued` in the same transaction's snapshot. Criterion 3.5; post-build check 1 |
| The follower writes a close twice after a restart | Medium | Each close is idempotent on the post's status in the snapshot; criterion 3.12 |
| A large unread backlog makes every wake long | Medium | At most 20 unread posts that need no reply ride along, with a count of the rest (row 18) |
| A busy agent's wake waits for its turn to end, so a reply is slow | Low | Accepted: ACP cannot add to a running turn (engine design, "The agent runner") |
| An author waiting on a board reply looks settled to the engine | Medium | Question Q2 to the lead (`lead-questions.md`); until answered, recorded as known gap 2 |

**Verify:** `packages/engine/test/board/wakes.test.ts`, `follower.test.ts`, `restart.test.ts`; the unchanged engine suite. Device or environment QA: none.

**WS-4: One door for agents and the owner**

Routes the board's commands through the engine's command handler, exposes
them as MCP tools and CLI commands, and adds the internal module.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 4.1 | Each board command runs through `CommandHandler.execute` with caller identity, a receipt, and one transaction; a repeated request id acts once | Test id: `packages/engine/test/board/handler.test.ts`, "identity, receipts, one transaction" |
| 4.2 | An invalid or stopped agent's token is refused for every board command | Test id: `packages/engine/test/board/handler.test.ts`, "bad credentials" |
| 4.3 | Agents get `board open`, `board members`, `board post`, `board read`, `board channels` and `board status` as tools, and never `board flush` | Test id: `packages/mcp/test/board-tools.test.ts` (reads `toolNames`) |
| 4.4 | `shephrd --help` lists the seven board commands with summaries | Command: `./bin/shephrd --help` output contains each name; test id `packages/cli/test/board-help.test.ts` |
| 4.5 | `postAsSystem` writes a post with a `system:<name>` author; no RPC payload can carry a `system` author | Test id: `packages/engine/test/board/internal.test.ts` |
| 4.6 | `board status` answers the owner, the agent's holder and the agent itself, and refuses anyone else | Test id: `packages/engine/test/board/handler.test.ts`, "status access" |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 4.1 | Add the board's command names to `supported` and route them in `planCommand` to `board/commands.ts` | `packages/engine/src/commands/CommandHandler.ts`, `supported`, `planCommand`; reply fields in `replyFor` |
| 4.2 | Add the six agent tools and their descriptions | `packages/mcp/src/tools.ts`, `toolNames`, `descriptions` |
| 4.3 | Add CLI summaries | `packages/cli/src/commands/registry.ts`, `summaries` |
| 4.4 | Write the internal module | Greenfield `packages/engine/src/board/internal.ts`; exports `postAsSystem`, `flush`, `status` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A board command skips the receipt or identity step | High | All board commands go through `execute`; criterion 4.1 and 4.2; attack pass on this unit |
| The served RPC group misses the board commands | Medium | The server serves every command in `ServiceRpcGroup` generically (scouting scan 2, item 4); criterion 4.1 runs over the socket |
| `postAsSystem` is reachable from a client | High | It is not an RPC; criterion 4.5 decodes a payload with a `system` author and expects refusal |

**Verify:** the four test ids above; the unchanged CLI and MCP suites. Device or environment QA: the owner runs `shephrd board post` once from the terminal against a fresh `/tmp` service (rollout step 6).

**WS-5: Proof that the board needs nothing else**

One acceptance file per board rule, through the public socket only, with
real tokens and the fake agent, on the engine's acceptance harness.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 5.1 | The epic's line: in a channel of four, a question to one wakes that one only, and the reply wakes the asker only | Test id: `packages/engine/test/acceptance/board-wakes-only-addressee.test.ts` |
| 5.2 | A lead's hand-off in `all` mode to three workers wakes the lead once | Test id: `packages/engine/test/acceptance/board-collection.test.ts` |
| 5.3 | A direct message is refused to a non-member on `board read`, and never appears in an agent's `subscribe` stream | Test id: `packages/engine/test/acceptance/board-privacy.test.ts` |
| 5.4 | No file under `packages/engine/src/board/` imports from `runner/` or reads `runMode`; a channel with one agent recorded as `interactive` behaves the same | Test id: `packages/engine/test/board/mode-independence.test.ts` |
| 5.5 | A service killed between a post and its wake delivers the wake once after restart | Test id: `packages/engine/test/acceptance/board-restart.test.ts` |
| 5.6 | Every existing engine test passes unchanged | Command: `pnpm check` exits 0; `git diff --stat engine -- packages/*/test` lists only new files and `rebuildCheck.ts` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 5.1 | Write the five acceptance files | `packages/engine/test/acceptance/`, pattern `flow-start-to-finish.test.ts`; harness `packages/engine/test/support/acceptance.ts`, `World`, `Spec` |
| 5.2 | Fake-agent scripts for posting, replying and ending turns | `packages/testing/src/fakeAgent.ts`, `Script`, `Step` |
| 5.3 | The import and `runMode` scan | Greenfield `packages/engine/test/board/mode-independence.test.ts` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| The fake agent cannot call a board tool mid-turn | Medium | Its `exec` step runs the `shephrd` command-line tool with the agent's token (scouting scan 2, item 9); the unit reports a gap if it cannot |
| The interactive check proves too little, since no interactive runner exists | Medium | Accepted: the epic puts interactive mode later; the check proves the board never branches on mode, which is what the delivery interface needs (row 24) |

**Verify:** the six criteria above. Device or environment QA: none beyond WS-4's terminal check.

**Post-build checks** (run rule 6: code-level worries a plan cannot settle)

1. The merge of a queued wake and the dispatcher's send (WS-3 risk 1):
   check under load that no agent receives a withdrawn wake.
2. The board's fold running after `apply` on each batch: check that a batch
   holding both an agent's stop and a post to it gives the same views live
   and rebuilt.
3. Redaction of the combined wake text: the redactor runs on each event, so
   check that a secret split across two posts is not rebuilt in the wake.

</details>

<details><summary><b>Traceability (gate 4)</b></summary>

Source universe: (a) the epic row 3 and its "Done when" line on wakes;
(b) `docs/features.md` section 2, its five items; (c) the roles plan's
seven requests (`requests.md`, "From the message board"); (d) `AGENTS.md`,
"How agents are run"; (e) SECURITY.md rules 6 and 7; (f) the Synapse list
items on channels, labels and waking (items 1 to 11, 13, 17, 19, 22).

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
| (b) Wait results that say why | none | built in the engine |
| (c) 1 One delivery interface | WS-3 | accepted (row 31) |
| (c) 2 Work state per agent | none | refused (row 31) |
| (c) 3 Work done signal | WS-3 (3.4), WS-5 (5.2) | accepted as `all` mode (row 26) |
| (c) 4 System author, needs-reply kind | WS-4 (4.5) | accepted; kind label refused (rows 14, 28) |
| (c) 5 Team is an engine group | WS-2 (2.5) | accepted (row 27) |
| (c) 6 Deliver before cache expiry | WS-3, WS-4 | accepted as `board flush`; deadline tracking refused (row 29) |
| (c) 7 Read whether a post is waiting | WS-4 (4.6) | accepted as `board status` (row 30) |
| (d) Board independent of run mode | WS-5 (5.4) | planned |
| (e) Rule 6, secrets never reach the board | WS-3 (3.7) | planned |
| (e) Rule 7, text is data | WS-3 (3.6), WS-4 (4.5) | planned |
| (f) Items 1, 2, 3, 6 channels, direct messages, across teams, threads | WS-2, WS-3 | adopted in the planner's reading; threads are `replyTo` |
| (f) Items 4, 5 one post to several teams, group channels | WS-2 | group channels adopted; a post is in one channel |
| (f) Item 7 action label | WS-1, WS-3 | adopted as `reply` |
| (f) Item 8 kinds | none | not adopted (row 14) |
| (f) Items 9, 17 fyi digest, broadcasts stop waking | WS-3 | adopted (rows 15, 18) |
| (f) Item 10 no acknowledgement-only posts | none | not adopted; recorded for docs/features.md |
| (f) Item 11 open questions tracked | WS-3 | adopted (row 16) |
| (f) Item 13 one waker | WS-3 | adopted: the engine's dispatcher is the only sender |
| (f) Item 19 system events in a log | none needed | row 22 |
| (f) Item 22 collections | WS-3 | adopted as `all` mode |

</details>

<details><summary><b>Guardrails triggered (gate 9)</b></summary>

| Repo rule (CLAUDE.md etc.) | How this plan satisfies it |
|---|---|
| `AGENTS.md` rule 1: push only to `qnlbnsl/sheprd` | The plan's branch is pushed to `origin` only |
| `AGENTS.md` rule 2: credit copied code | No code is copied; the board's code is new |
| `AGENTS.md` rule 3: keep the lists current | Every unit records problems in `docs/issues.md`; new feature ideas are in the result file for the lead |
| `AGENTS.md` rule 4: follow SECURITY.md | Rules 6 and 7 are criteria 3.6, 3.7 and 4.5 |
| `AGENTS.md` rule 5: the client API is the surface | Every board command is an RPC in `ServiceRpcGroup`, served to every client |
| `AGENTS.md` rule 6: no team shapes | Channels carry no team, role or phase (row 10) |
| `AGENTS.md` rule 7: no commit unless asked | Units commit under the run's standing authorization (team rules, rule 2) |
| `AGENTS.md`, "How agents are run" | Row 5, criterion 5.4 |
| `AGENTS.md`, "Language" (Effect 4, Node.js 26) | Conventions paragraph; Effect calls follow the engine's existing use |
| Engine design: pieces build on the engine without changing it | Row 9, asked of the lead; the regression gate in the conventions |
| Run rule 6: no `package.json` or lock edits | Conventions paragraph |

</details>

<details><summary><b>Execution sizing (gate 10)</b></summary>

Models come from the harness-sessions plugin's model sheet (its harness-session skill)
at launch; this section names none (owner, 2026-10-16).

| Unit | Work area | Scope | Complexity | Why this complexity | Attack pass | Depends on |
|---|---|---|---|---|---|---|
| 1 Board contracts | contracts | engine/contracts | medium | New schemas whose shapes `contract.md` fixes, plus two additive union cases. | no | engine fix round merged; the client API plan's seam unit |
| 2a Board views and rebuild | backend | engine/backend | medium | Pure fold functions on the engine's views pattern. | no | 1 |
| 2b Access rules | backend | engine/backend | high | Authorization: who may read and reach whom. | yes | 2a |
| 3a Posts and wakes | backend | engine/backend | high | Exactly-once wakes merged inside one transaction, racing the dispatcher. | no | 2b |
| 3b Follower and read positions | backend | engine/backend | medium | One follower on the existing pattern, idempotent closes. | no | 3a |
| 4 Doors and internal module | backend | engine/backend | medium | Thin routing into the existing handler, tools and CLI. | yes | 3b |
| 5 Acceptance suite | backend | engine/backend | medium | Five tests on the existing acceptance harness. | no | 4 |

Scopes: `engine/contracts` edits `packages/contracts/**`; `engine/backend`
edits `packages/engine/**`, `packages/cli/**`, `packages/mcp/**` and
`packages/testing/**`. Both exist under `.plans/scopes/engine/` and cover
every path in this plan, so no new scope is needed (known gap 4: the lead
runs `scope.py check` on them before launch).

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
