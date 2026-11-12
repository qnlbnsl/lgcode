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

The recommended approach builds the board inside the engine itself. The
client API plan, piece 2, starts with two engine units that turn the
engine's fixed lists of commands, events and views into lists a later plan
adds to, and that build the delivery and caller rules once. The board then
adds its own entries to those lists, in its own folders inside the engine's
packages. Each post is written to the engine's log, and in the same step the
board queues a wake for exactly the agents the post needs an answer from.
The engine's existing machinery then delivers that wake when the agent can
take it, in order, through the same interface for every kind of agent.
Posts that need no answer wake nobody; the agent gets them with its next
real wake, or when it reads the channel.

The owner settled the one material uncertainty on 2026-11-03: the plans
edit the engine directly wherever they need to, "that is the whole point
of a phased build". Earlier versions kept every existing engine behaviour
and test unchanged; that rule is gone. Where the board changes something
the engine already does, the plan names the change, its file, the tests it
updates and its decision row. The main change is that an agent waiting
for a board answer no longer counts as finished. The security rules the
lead set for the board stay exactly as they were.

The first review round found no blockers and 33 major problems. Most were
gaps in what happens when things change under a message: a question closes
while other wakes for it are still waiting, an agent leaves a channel, an
agent crashes and is resumed, or a delivery fails. This version gives each
of those one written rule. It also tightens who may wake whom, because the
first version let an agent wake a sibling with wider permissions than its
own, and let a channel bound to a group label take in agents from anywhere
in the tree.

The second review round again found no blockers, and 24 major problems.
Three gaps mattered most. First, a channel's membership followed which
agents were awake, so a lead's usage pause silently emptied its team's
channel. Second, the notice that tells an asker its question has closed
could be lost if the asker crashed or the send failed. Third, the owner's
phone was to download every post at start-up, which would soon pass the
network's message size limit. This version ties membership to the fixed
family tree of agents, makes the closing notice a lasting duty, and sends
the phone only a summary.

The third review round found no blockers, and 18 major problems in seven
groups. Each group is decided in its own row, for the owner to read
(`attack/round-3-findings.md`). A crash no longer counts as leaving a
channel. A channel's manager is recorded and moves only when the manager
stops or crashes, never on a pause. A closing notice has a size limit,
with the rest of the replies readable page by page. Every status reply is
small or paged. The check made at the moment of sending is told which wake
it is judging; that needs a small change to the client API, which the lead
approved as ruling L23. Version 5 then reworks the plan for the owner's
answer: the board edits the engine directly, and it lives inside the
engine's two packages instead of two new ones.

The board knows nothing about teams, roles or workflows, because those do
not belong in LGTM Studio. The roles plan, piece 4, decides which channels
exist and who is in them. This plan's `contract.md` answers each of the
roles plan's seven requests: four accepted as asked, two accepted in
another form, and one refused, with the reason.

## Key decisions

**The board edits the engine directly.** The owner ruled that plans change
the engine wherever they need to. The board adds its commands, events,
view and rules to the engine's own lists, and its code lives in a `board`
folder inside each of the engine's two packages. Two things the engine
already does change: an agent waiting for a board answer is not finished,
and a blocking wait gives way when its waiter is asked a board question.
Each change is listed with the tests it updates.

**Who is woken.** A post either needs a reply or does not. One that needs a
reply names its addressees and wakes exactly them. One that does not wakes
nobody, ever, and there is no timer that wakes for it later. When the
question closes, the asker is woken once with the answers, so nobody has
to check back. A post that needs no reply may sit unread until the agent's
next real wake; the roles plan can force an early hand-over with the
"flush" command.

**Who may wake whom.** A channel's members may wake each other, but only
inside rules that keep the engine's own limits. An agent may not ask for a
reply from an agent started with wider permissions than its own, unless one
is the other's ancestor. A channel that follows a group label takes in only
labelled agents under one fixed agent, the one that opened it or the one
the owner names. That never changes when an agent pauses, crashes or is
resumed; only a stop, a label change or an explicit removal changes it. A
channel's manager is recorded, and it moves up the family tree only when
the manager stops or crashes. A
direct-message pair keeps its right to talk only while the reason for it
still holds; when the reason ends, its open questions close and their
askers are told. Every wake is checked again at the moment it is sent, so
an agent that has just lost access is not sent text it may no longer
read.

**Several wakes become one.** An agent never has more than one fresh board
wake waiting. A new post for it while one is waiting replaces that wake
with one that carries both posts. A wake that was already sent and then
put back in the queue, for example after a usage pause, keeps its place
and is not merged.

**Every question ends in a known way.** A question can need a reply from
any one addressee or from all of them. Each addressee ends in one of four
ways: it replied, it stopped or crashed, it left the channel, or the
message could not be delivered twice. When every addressee has ended, or
the first reply arrives in "any one" mode, the question closes and the
asker is woken once with every reason and as many answers as fit a
fixed size; any other answers are named, to be read page by page. That
closing notice is a lasting duty: it survives a crash, a failed send and a
merge, and it is cleared only when the asker has received it. The asker, a
channel manager, the owner or LGTM Studio's own code can also withdraw a
question; when someone else withdraws it, the asker is told. When a
question closes, any of its wakes still waiting are removed, so nobody
spends a turn on a closed question.

**An agent waiting for a board answer is not finished.** If a lead asks
another lead a question and ends its turn, anyone waiting on the first lead
is not woken until its question closes and its closing notice has reached
it. An agent that received a question and ended its turn without
answering counts as finished, as the engine would say; its asker keeps
waiting, and the stall watch or the owner deals with the silence. An agent that is itself being
asked a question cannot be stuck behind a blocking wait on the asker; the
wait gives way, as the engine's own waits do for engine questions.

**Leaving a channel takes effect at once.** When an agent leaves a channel,
any wake still waiting for it is rebuilt without that channel's posts.
Text already delivered cannot be taken back, and the plan says so.

**Privacy has stated edges.** Channels keep messages apart for routing and
to limit mistakes. They are not a secrecy boundary: every agent runs as the
owner's user and can read LGTM Studio's files, and a parent sees its child's
whole conversation. Posts cannot be deleted.

**Text is data.** A post reaches another agent inside the engine's data
envelope, with a leading slash escaped, and secrets are removed before it
is written. The line naming a post's author is built from fixed words, so
an agent named "owner" cannot pass itself off as the owner. Only LGTM Studio's
own code can post as LGTM Studio.

**The owner's phone hears about questions for the owner.** A post that
needs the owner's reply raises one alert on the owner's devices, and the
alert ends when the post closes. An agent can have at most three such
questions open at once. When the phone starts, it gets a bounded summary
of the board, with no post text, and reads the text page by page. Every
list the phone may ask for comes in pages, so no reply can outgrow the
network's limit.

**Sizes are measured as they travel.** Every wake and every page is
measured as the network encodes it, and control characters are removed
from posts, so no single message can pass the network's limit.

**The board can be switched off, not removed.** Once the board has written
to the log, the log needs the board's definitions to be read. Rolling back
means switching the board off: its commands are refused, and its own
background work stops.

**Two parts are refused.** The board does not keep a "work state" per
agent, and it does not track each harness's prompt-cache deadline. Both are
the roles plan's policy. Four exclusions written in the planner's own words
(work items, file and branch watches, the test queue and usage meters) are
marked for the owner's confirmation.

Full log → `decisions.md`

## Workstreams

### One shared definition of the board's commands and events

The board's eight commands and eight events join the engine's shared
definitions, which every client and the engine read. The risk is a
definition that shows a private message to the wrong agent, or a name that
collides with another piece's; tests check that every board event is
hidden from agents and that every name is unique. When done, the owner can
see the board's commands in `lgtm --help`.

### Channels, members and who may reach whom

The board keeps its own picture of channels, members, posts, each
addressee's outcome and read positions, rebuilt from the log like the
engine's own. It enforces who may open a channel, add members, post, read
and wake. The risk is a rule that lets an agent read or reach more than the
engine allows it; each rule has a test that tries the forbidden case. When
done, a test shows a worker refused when it tries to read a channel it is
not in, or to ask a wider-permission sibling for a reply.

### Posts that wake only the agent that must answer

Writing a post records it and queues its wakes in one step. Answers close
questions and wake the asker. Wakes for the same agent are merged, and
wakes for a closed question are removed. The risk is a lost or doubled
wake, which would cost a turn or leave an agent waiting forever; tests
count the wakes. When done, the epic's line is a passing test: in a channel
of four, a question to one wakes that one only.

### What happens when agents and channels change

A background reactor follows the engine's events: an agent that stops,
crashes, is interrupted, is resumed, or leaves a channel; a direct pair
that loses its reason to talk; and a delivery that fails or is stopped at
the moment of sending. Each case has one rule in the plan's outcome table. The risk is a question that
never closes, or a closed one that wakes someone; tests replay every order
of reply, crash and resume. When done, a crashed and resumed worker never
strands its lead's question.

### One door for agents, the owner and LGTM Studio's own code

The board's commands become LGTM Studio tools for agents, `lgtm board …`
commands for the owner's terminal, and calls for the web page and the
phone, all through the engine's own command lists with no door of their
own. The risk
is a new door that skips a check; the board's commands go through the
engine's one command handler. When done, a real `lgtm board post` from
the terminal wakes an agent.

### Proof that the board needs nothing else

An acceptance suite drives every main board rule through the public
connection only, with real agent tokens and the fake agent. One check
proves the board never looks at how an agent is run. When done, `pnpm
check` passes with the new board suite added, and the only existing engine
tests that changed are the ones this plan names.

## Rollout order

1. **The client API plan's two engine units.** They turn the engine's
   fixed lists into lists the board adds to, so nothing of the board can
   start before them. The board needs no new package.
2. **Shared definitions.** Every later unit compiles against them, and the
   roles plan reads them too.
3. **The board's picture and its rules.** These are pure functions over the
   log, testable without a running agent.
4. **Posts and wakes,** then **the reactor** for changes under them.
5. **The doors,** including the switch that turns the board off.
6. **The acceptance suite.** It runs last, through the doors, and it must
   pass with every existing engine test keeping its expectations, except
   where this plan names a change. The owner then runs one `lgtm board
   post` from the terminal.

The work lands on a branch from `engine` after the client API plan's two
engine units merge.
Once the board writes its first event, the log needs the board's
definitions to be read; from then on, rollback means switching the board
off, not removing it.

---
<!-- ⛔ implementation details and gate evidence below; owner overview is complete -->

<details><summary><b>Implementation details (gates 2, 3, 5, 6, 8)</b></summary>

Conventions for every unit. Paths are relative to the LGTM Studio repository
root. Engine anchors come from `scouting.md` (scans at `8ff4c9b`) and the
round-1 reviews (`attack/round-1-*.md`). "The client API contract" is
`.plans/plans/lgtm-client-api/contract.md` on `worker/plans-api`,
version 3 at `876bf4f`, reworked under lead ruling L26 (row 100). "Edit
EN" is that contract's section 6, edit EN: a direct edit to the engine
that the client API plan's units 1a and 1b make, and that the board then
adds its own entries to. The board's own contract is `contract.md`,
version 6 (row 100). "Ancestor" means by the
engine's fixed `parent` links, never by holder availability (lead ruling
L18). "Ceiling" means the permission an agent was started with, from its
`AgentStarted` (row 73). Greenfield anchors give
the target path and the neighbouring pattern file; every unit re-reads the
frozen contract before it starts. A "test id" is a Vitest file path, run
with `pnpm vitest run <path>`. "Rows" are rows in this plan's
`decisions.md`. RPC means remote procedure call: one request and its reply.
ACP is the Agent Client Protocol, through which the engine drives agents.
MCP means the Model Context Protocol, through which agents get LGTM Studio's
tools. Effect code is written from Effect 4.0.5's current documentation,
looked up, never from memory (`AGENTS.md`, "Language"); this plan names no
Effect function that the engine or the client API contract does not already
name. The board adds no package, so no unit edits `package.json`,
`pnpm-workspace.yaml`, `pnpm-lock.yaml` or `vitest.config.ts`. Every unit
reports problems and feature ideas to the lead, who writes `docs/issues.md`
and `docs/features.md` in the same integrated change (row 60). Every unit
keeps the regression gate: `pnpm check` passes, and an existing test file
under `packages/*/test/` changes only as the engine-change table below
names, keeping its expectations for what the engine already does.

The board's code lives in the engine's two packages, in folders named
after its namespace (client API contract, section 1, "Where a piece's code
lives"; row 100). `packages/contracts/src/board/` holds the command group,
the event structs, the access and visibility entries, the alert source,
the board view's type, and the two conditions as pure functions of that
type (row 101). `packages/engine/src/board/` holds the planners, the
view's fold, the reach check, the wake builder, the reactor and the
`board.status` function. It imports the engine's views and the helpers of
edit E22, never `packages/engine/src/runner/`. Tests live in
`packages/contracts/test/board/` and `packages/engine/test/board/`, and the
acceptance tests in `packages/engine/test/acceptance/board-*.test.ts`
(pattern `flow-start-to-finish.test.ts`).

**The engine changes this plan makes (rows 99, 100).** Each is an entry
in a list or table that the client API plan's units 1a and 1b build. The
board's unit that owns it writes it. "Keeps its expectations" means only
its imports, fixtures or setup change.

| # | Change | Files | What the engine already does that changes | Existing tests updated | Unit |
|---|---|---|---|---|---|
| B1 | The board's command group joins `CommandsRpcGroup` (edit E1), with its access entries (edit E2) | `packages/contracts/src/commands.ts`, one `.merge` line; `packages/contracts/src/board/commands.ts` | Agents get seven more tools, and `lgtm` gains a `board` subcommand group | None change their expectations; `packages/contracts/test/unique.test.ts`, `packages/cli/test/parity.test.ts` and `command-inventory.test.ts` cover the board through their whole-group checks | 1 |
| B2 | The board's events join the `Event` union (edit E5), each with the class `owner-only` (edit E8); its alert source joins the alert list | `packages/contracts/src/events.ts`; `packages/contracts/src/board/events.ts`; `packages/contracts/src/visibility.ts` | None: no engine view reads a board tag, and no agent sees one | `packages/contracts/test/events-roundtrip.test.ts` gains the board's eight events | 1 |
| B3 | The board's view is the views state's `board` field (edit E6) | `packages/engine/src/views/apply.ts`, `State`, `emptyViews`, `apply` | The views state gains a field, and `debug.compare-views` reports differences in it | `packages/engine/test/views/apply.test.ts`, `rebuild.test.ts`, `compare-views.test.ts` and `test/support/viewFixtures.ts` gain the field; their expectations for the engine's fields stay | 2a |
| B4 | The board's reach check replaces unit 1's "refuse" entry (edit E18) | `packages/engine/src/routing/reach.ts` | Board wakes can be queued and sent; the dispatcher withdraws a board wake that fails at send | `routing/deliveries.test.ts` and `accounts/carry-on-dispatch.test.ts` keep their expectations | 2b |
| B5 | The board's planners join the planner table (edit E3): every command but `board.channels` and `board.status`; its source rule replaces unit 1's "withdraw" (edit E16): withdraw when the target stops or crashes, and keep `DeliveryReturned` on a return, for the reactor | `packages/engine/src/commands/planners.ts`; the source-rule table in `packages/engine/src/routing/deliveries.ts` | None for the engine's commands and sources | `commands/handler.test.ts` and `routing/deliveries.test.ts` keep their expectations | 3a |
| B6 | The board's hold-unsettled entry replaces "never" (edit E19) | The table in `packages/contracts/src/settled.ts`; `packages/contracts/src/board/conditions.ts` | `settled` is false for an agent with an open must-reply post of its own, an owed completion, or a question that never reached it, so a `wait` on that agent, and `waitForAgents`, last until it clears | `routing/waits.test.ts` and `acceptance/capability-05-wait.test.ts` keep their expectations, because they write no board event (criterion 4.8) | 3b |
| B7 | The board's request-held entry replaces "never" (edit E20) | The table that `packages/engine/src/routing/waits.ts` reads | A blocking `wait` ends with "request held" when its waiter is asked a board question it has not answered | `routing/waits.test.ts` keeps its expectations | 3b |
| B8 | The board's reactor joins the service's reactors (client API contract, section 1, "Reactors") | Where unit 1a lists reactors; today `packages/engine/src/service.ts`, `program` | The service runs one more reactor | None | 3b |
| B9 | `board.channels` and `board.status` join the read table (edit E4); the board's snapshot entry replaces "no section" (edit E9); the "board disabled" setting is read at start-up | `packages/engine/src/api/reads.ts`; `packages/engine/src/api/snapshot.ts`; `packages/engine/src/board/switch.ts` | `client.snapshot` gains a board section for the owner, devices and services | `packages/mcp/test/` and `packages/cli/test/` keep their expectations; tool descriptions and CLI summaries gain the board's | 4 |

The board writes no side table and adds no migration (edit E7): its state
is its view, rebuilt from the log.

**The outcome table (rows 49, 69, 70).** Used by the post planner,
`board.close` and the reactor, as one pure function in
`packages/engine/src/board/outcome.ts`.

| Event for one addressee | Its disposition |
|---|---|
| It replies in the same channel | `replied` |
| It stops or crashes (judged by the lifecycle rules only, never as leaving, row 84) | `gone` |
| `AgentInterrupted`, and the agents view shows `reloadable !== true` | `gone`, at once (the engine's `waits.ts:55` test) |
| `AgentReloadFailed` | `gone` |
| Interrupted with a reloadable session | none while recovery tries it |
| It is removed from the channel or loses the label, or a carried post fails the reach check (rows 67, 68) | `removed` |
| Its board wake for this post is returned twice | `undeliverable` |
| It pauses | none; the post waits |
| It replies while the post is still open and it has any other disposition | `replied` (the one allowed change, row 93) |

| Post event | Result |
|---|---|
| `any` mode, first `replied` | closes `answered` |
| `all` mode, every addressee has a disposition, at least one `replied` | closes `answered` |
| Either mode, every addressee has a disposition, none `replied` | closes `unanswerable` |
| The owner replies | closes `answered` |
| `board.close` | closes `withdrawn` |
| The author stops, or is removed from the channel (a crash is never removal, row 84) | closes `withdrawn` |
| The author crashes, or is interrupted and cannot reload | stays open; replies are still recorded |

**Completions (rows 69, 87, 88, 91, 92, 95).** At a close, an agent author
is owed a completion, unless it withdrew the post itself or stopped. A
withdrawal by someone else, or by the author's removal from the channel,
owes one with that reason. The view keeps owed completions per agent. A
completion always carries the post id, the outcome, every disposition and
every reply id, and carries reply text only within 64 KiB encoded; the
rest is read with `board.read` and `repliesTo`. A completion carrying reply
text is judged at send like a post of its channel. A completion is
discharged only by `DeliveryAccepted` for a wake whose `board.WakeBuilt`
names it. It survives merging, cleanup, a return and the author's crash;
the reactor queues a wake for an idle agent that has owed completions that
have not failed twice, and no queued board wake. After two returns without
an accept it is no longer re-queued, rides the next board wake, is shown
as "delivery failed", and can be sent with `board.flush`. A return after
an accept re-queues only open must-reply posts and counts toward nothing.
A stop drops the agent's owed completions.

**Cleanup (rows 47, 82).** At a close, the post is removed from every
still-queued board wake that carries it. When one addressee gets a
disposition, the post is removed only from that addressee's queued wakes.
A replacement is queued whenever the wake still carries a completion or a
must-reply post.

**WS-1: One shared definition of the board's commands and events**

Defines the board's ids, events, commands, access table, visibility table,
alert source and exported pure conditions. Fields follow `contract.md`.
Names follow the client API contract's namespace rule (section 1):
commands `board.<name>`, event tags `board.<PascalName>`. Engine changes
B1 and B2.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 1.1 | `ChannelId`, `PostId`, `WakeId` are branded ids; `ReplyMode` is `none`, `any` or `all`; `BoardAuthor` is owner, agent or service; `Disposition` is `replied`, `gone`, `removed` or `undeliverable`; a close outcome is `answered`, `unanswerable` or `withdrawn`; a group channel carries an anchor agent id | Test id: `packages/contracts/test/board/schemas.test.ts`, "ids, modes, authors, outcomes" |
| 1.2 | `board.ChannelOpened`, `board.ChannelMembersChanged`, `board.ManagerChanged`, `board.PostWritten`, `board.AddresseeResolved`, `board.PostClosed`, `board.WakeBuilt` (with `carried`, `mustReply` and `completions`) and `board.Read` round-trip unchanged | Test id: `packages/contracts/test/board/schemas.test.ts`, "events round-trip" |
| 1.3 | Every board event is `owner-only` in `boardVisibility`, and no board event has a top-level `agentId` field | Test id: `packages/contracts/test/board/schemas.test.ts`, "hidden from agents" |
| 1.4 | `boardAccess` matches `contract.md`'s command table: `board.flush` has no `agent`; `service` appears only on `board.post`, `board.close`, `board.status` and `board.flush` | Test id: `packages/contracts/test/board/schemas.test.ts`, "access table" |
| 1.5 | A post's text refuses more than 16,384 characters; `to` refuses more than 16 addressees; a channel name refuses anything outside `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`; a `board.status` summary has a fixed shape with no list in it | Test id: `packages/contracts/test/board/schemas.test.ts`, "limits" |
| 1.6 | `boardAlertSources` raises kind `board.post` with key `post:<postId>` for a post that needs the owner's reply, and ends it on `board.PostClosed` | Test id: `packages/contracts/test/board/alerts.test.ts` |
| 1.7 | `holdsUnsettled(agentId, view)` and `holdsIncoming(agentId, view)` are exported pure functions of the full view, with the cases of rows 69, 77 and 90; the results the snapshot section and the `board.status` summary carry equal these functions' results at the same sequence (row 89) | Test id: `packages/contracts/test/board/conditions.test.ts` |
| 1.8 | Every command and event name in the full API is unique, and every board name starts with `board.` | Test id: `packages/contracts/test/unique.test.ts` (edit E1) passes with the board's group and events merged |
| 1.9 | The test runner runs the board's tests | Command: `pnpm vitest list` lists files under `packages/contracts/test/board/` and `packages/engine/test/board/` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 1a | Ids, `ReplyMode`, `BoardAuthor`, `Disposition`, outcomes | Greenfield `packages/contracts/src/board/ids.ts`; pattern `packages/contracts/src/ids.ts`, `AgentId` |
| 1b | The eight events, as `BoardEvent`, joined to the `Event` union (B2) | Greenfield `packages/contracts/src/board/events.ts`; pattern `packages/contracts/src/events.ts`, `QuestionAsked`; edit E5 |
| 1c | The eight commands, as `BoardRpcGroup`, prefixed `board.`, merged into `CommandsRpcGroup` (B1) | Greenfield `packages/contracts/src/board/commands.ts`; pattern `packages/contracts/src/commands.ts`, `CommandsRpcGroup`; edits E1, E2 |
| 1d | The access and visibility entries, `boardAlertSources`, the board view's type, `holdsUnsettled`, `holdsIncoming` | Greenfield `packages/contracts/src/board/index.ts` and `conditions.ts`; shapes from the client API contract, sections 1, 4 and 6 (edits E2, E8, E19) |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A board event visible to agents would show a direct message to the author's parent | High | Criterion 1.3; the field is named `author`, never `agentId` |
| The client API's units 1a and 1b differ from what this plan assumes | Medium | Every unit re-reads the client API contract at the commit the lead names; differences go to the lead |
| The board's test folders are not run by the root check | Low | Criterion 1.9 |

**Verify:** the three test ids above, `packages/contracts/test/unique.test.ts`, and `pnpm vitest list`. Device or environment QA: none.

**WS-2: Channels, members and who may reach whom**

The board's view, rebuilt from the log, and the pure rules that decide who
may open, add, post, read and wake. Two units: 2a the view, 2b the rules.

The view (`packages/engine/src/board/view.ts`, the views state's `board`
field, engine change B3; its type is in `packages/contracts/src/board/`)
holds: channels (id, name, manager,
explicit members, optional group label and anchor, opener kind owner or
agent, kind plain, group or direct; the manager is stored and changes only
by `board.ManagerChanged`, row 85); posts (id, channel, author, text,
`to`, reply mode, `replyTo`, each addressee's disposition, replies, status
open or closed with its outcome); owed completions per agent, with their
return count, counting only wakes returned without an accept (row 91);
each agent's ceiling, from its `AgentStarted` (row 73); read
state per member and channel (a watermark plus post ids read above it,
starting at the join, rows 48 and 79); the wake index from
`board.WakeBuilt` (wake id, delivery id, target, carried posts, must-reply
posts, completions); and the reactor's last handled sequence. Delivery
status is never stored: it is read from the engine's deliveries view
(row 46). A group channel's members are computed from the engine's agents
view at read time by rows 65 and 84: label carriers that are not stopped
and have the anchor as an ancestor or are the anchor, plus the anchor and
the current manager while they are not stopped. A crash, an interrupt, a
pause or a resume changes no membership.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 2.1 | `boardAfter` folds every board event, the engine's `DeliveryAccepted` and `DeliveryReturned` for a board wake, and `AgentStarted` and `AgentGrouped` (for ceilings and group join positions), and ignores every other event | Test id: `packages/engine/test/board/view.test.ts`, "fold" |
| 2.2 | The board's view rebuilt from the log alone equals the live view after every board test | The engine's rebuild check covers the views state's `board` field (edit E6); `pnpm vitest run packages/engine/test/board` exits 0 |
| 2.3 | Accepting a wake marks exactly its carried posts read and discharges exactly its completions; a `board.Read` marks exactly its page; the watermark moves forward only over a contiguous run; paging back never unreads a post; a member joining a channel of 400 posts starts with none unread | Test id: `packages/engine/test/board/view.test.ts`, "read state" (cases: 25 unread plus a question, wake carries 21; read an old page; restart; late join to a plain channel and to a group channel) |
| 2.4 | An agent can add to a plain channel only an agent it holds and its own holder; every other add is refused | Test id: `packages/engine/test/board/access.test.ts`, "adding members" (child, parent, sibling refused, cousin refused, owner adds anyone) |
| 2.5 | When a manager stops or crashes, `board.ManagerChanged` names the nearest ancestor by `parent` links that is not stopped or crashed, or the owner; a pause or an account change of any ancestor moves nothing; rights never return on a resume; the new manager is a member with its read state at the channel's last post | Test id: `packages/engine/test/board/access.test.ts`, "manager rights pass up" |
| 2.6 | A group channel admits label carriers that are not stopped and have its anchor as an ancestor, plus the anchor and the current manager whether or not they carry the label; an owner-opened channel admits only carriers under the anchor the owner named; an agent naming an anchor other than itself is refused; an agent cannot bind a label that no agent in its subtree carries; a carrier in another subtree, whether started with the label or given it by `group`, is not a member; a member's crash, interrupt, pause or resume changes no membership; when the manager crashes, the inheriting manager joins and no one else does; a manager crash followed by its parent's pause and return changes nothing | Test id: `packages/engine/test/board/access.test.ts`, "group channels" (cases include a manager with no label posting an `all` hand-off to its labelled children) |
| 2.7 | A direct channel opens, and each later post in it is allowed, only while one side is the other's parent, the pair shares a plain or group channel, or one side is the owner or a service; a paused parent keeps the grant; a grant resting on a group channel survives one side's crash and resume; after one side leaves the last shared channel, the next post is refused, and losing one of two shared channels changes nothing | Test id: `packages/engine/test/board/access.test.ts`, "direct channels" |
| 2.8 | A non-member cannot read or post in a channel; the owner and every device can; a service can post, and open a direct channel with an agent, but cannot read | Test id: `packages/engine/test/board/access.test.ts`, "read and post" |
| 2.9 | A post that needs a reply from an agent with a wider ceiling than its author is refused, unless one is the other's ancestor; a target that reports a narrower mode is still refused; a lead that narrows its own mode can still ask its workers | Test id: `packages/engine/test/board/access.test.ts`, "ceiling" |
| 2.10 | A `replyTo` naming a post in another channel, or sent by a caller no longer in the channel, is refused before anything is written | Test id: `packages/engine/test/board/access.test.ts`, "reply stays in its channel" |
| 2.11 | Given a delivery id and its board source, the reach check finds that wake and judges each carried post on its own: a failing no-reply post is left out, a failing must-reply post resolves its addressee `removed`, a completion without reply text always passes, a completion with reply text fails once its author is no longer a member of the post's channel, and an old carried post never refuses a new command; at queue time it sees the batch's own `board.WakeBuilt`; a service's post in its direct channel with an agent passes at queue and at send | Test id: `packages/engine/test/board/reach.test.ts` (edit E18) |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 2a.1 | `emptyBoard` and `boardAfter(state, envelope)`, called from the engine's `apply` as the `board` field (B3) | Greenfield `packages/engine/src/board/view.ts`; pattern `packages/engine/src/views/apply.ts`, `deliveriesAfter`, `emptyViews`; edit E6 |
| 2a.2 | The outcome function | Greenfield `packages/engine/src/board/outcome.ts` (the outcome table above) |
| 2b.1 | Authority and reach rules as pure functions over the engine snapshot and the board's view | Greenfield `packages/engine/src/board/access.ts`; manager rights from the stored manager (row 85), never `holderAbove` or `mayActForHolder`; membership and grants from `parent` links in `packages/engine/src/views/apply.ts`, `AgentRow`; ceilings from `AgentStarted.permission` (`packages/contracts/src/events.ts`) compared with `packages/contracts/src/permission.ts` |
| 2b.2 | The reach check, written as the board's entry in the reach table (B4; rows 45, 61) | Greenfield `packages/engine/src/board/reach.ts`; the table in `packages/engine/src/routing/reach.ts` (edit E18) |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| An authority rule lets an agent read or wake outside its reach | High | Criteria 2.4 to 2.11 each test the forbidden case; unit 2b takes an attack pass |
| A parent inside the anchor's subtree gives its child the label, and the child joins | Low | Accepted and stated (row 66): the subtree is under the anchor's authority |
| The ceiling rule blocks a real flow, such as a read-only reviewer asking a builder sibling | Medium | The reviewer can post without needing a reply, or ask its parent; the rule is the engine's own ceiling (row 45) |
| The client API's reach-check inputs differ from row 45 | Medium | Edit E18 at `876bf4f` matches it (rows 61, 98, 100); a later difference goes to the lead |

**Verify:** `packages/engine/test/board/view.test.ts`, `packages/engine/test/board/access.test.ts`, the engine's rebuild check. Device or environment QA: none.

**WS-3: Posts that wake only the agent that must answer**

The `board.post` and `board.close` handlers, the wake builder, merging and
cleanup. One unit, 3a.

How a post is planned, inside the engine's command transaction, as a
planner in the engine's planner table (edit E3, engine change B5): remove control characters other than newline and tab from the text,
then redact it (row 72); check access and reach (2b), the owner-question
limit (row 54) and the limit of 64 open must-reply posts per author
(row 71); refuse a post that needs a reply with no addressee, with its
author in `to` (row 78), with a service in `to` (row 94), or to an
addressee that is stopped, crashed, or
interrupted with a session that cannot reload (row 70); return
`board.PostWritten`; if it replies to an open post in the same channel
from an addressee with any disposition but `replied` (row 93), return
`board.AddresseeResolved` (`replied`), and, if the outcome function closes
the post, `board.PostClosed` and an owed completion for its agent author;
compute the wake set (agents only: the addressees of a post that needs a
reply, minus the author, plus the author of any post this one closed,
minus any stopped or crashed agent, whose completion stays owed); apply
the cleanup rule (rows 47, 82); for each agent in the wake set, if it has
a board wake that is queued and was never sent, withdraw it (edit E17);
then return one `DeliveryQueued` through the engine's piece-delivery
helper, `routing/pieceDelivery.ts` (edit E15), with source `{ namespace: "board", id: <wake id> }` and sender
label `board`, and in the same batch `board.WakeBuilt` naming its carried
posts, its must-reply posts and its completions. Every post placed in a
wake is judged by the reach check on its own (row 67). A wake that was sent and
requeued keeps its place; new posts for that agent go into one other wake
(row 46). A merged or replaced wake is a new delivery, so it goes to the
back of the target's queue (row 62). `board.flush` is a no-op when the
target already has a never-sent board wake queued (row 62).

The body is plain text, at most 256 KiB as JSON encodes it (row 72). It
carries, in order: the target's owed completions, using at most 128 KiB,
each bounded to 64 KiB with its left-out replies named by id (row 88);
then every must-reply post, then the oldest unread posts that need no reply, up to 20, then a
count of the rest. Completions never use the 20 digest places. If posts
are left out, the body ends with "N more posts need your reply; run
board.read with incoming set" (row 80). Each post is a header line built
only from fixed words and the engine-authenticated id (rows 52, 63:
`owner`, `service <name>` or `agent <id>`, never an agent-chosen name),
its channel id but never its name (row 74), its reply mode and its state,
then the post's text between fresh random markers, with a leading slash
escaped. The engine wraps the whole body in its agent-text envelope.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 3.1 | In a channel of four agents, a post needing a reply from one queues exactly one delivery, to that one | Test id: `packages/engine/test/board/wakes.test.ts`, "wakes only the addressee" |
| 3.2 | A post needing no reply queues no delivery for anyone | Test id: `packages/engine/test/board/wakes.test.ts`, "no reply, no wake" |
| 3.3 | `any` and `all` modes close by the outcome table, and the asker is woken once at the close with every disposition, every reply id, and reply text within 64 KiB; a withdrawal by someone else, or the author's removal, tells the author once with the reason; the author's own `board.close` or stop tells no one | Test id: `packages/engine/test/board/wakes.test.ts`, "outcome table" (one case per row) |
| 3.4 | Three posts for one idle-target agent while its never-sent wake is queued leave one queued board wake carrying all three; a requeued wake keeps its place and is not merged; a sent wake is not withdrawn; a paused target is the control case, with its wake left queued and merged in the same way | Test id: `packages/engine/test/board/wakes.test.ts`, "wakes merge" |
| 3.5 | When a question closes, a queued wake carrying only it is withdrawn, and a queued wake carrying it and another open question is replaced by one carrying only the other; in `all` mode, W1's reply leaves W2's queued wake unchanged; a wake carrying a completion and a withdrawn question is replaced by one carrying the completion | Test id: `packages/engine/test/board/wakes.test.ts`, "closed questions leave the queue" |
| 3.6 | The wake reaches the agent inside the engine's envelope; each post sits between its own fresh markers with a leading slash escaped; an agent named with a line break, `owner`, a service's name or a copied marker cannot change a header, because no agent-chosen name appears in it; a reactor-built wake names each post's original author | Test id: `packages/engine/test/board/wakes.test.ts`, "text is data" |
| 3.7 | A secret registered with the redactor never appears in a stored post or wake | Test id: `packages/engine/test/board/wakes.test.ts`, "redacted" |
| 3.8 | A wake body never exceeds 256 KiB as JSON encodes it, for posts of quotes, backslashes and 4-byte characters; control characters other than newline and tab are gone from stored text; posts past the cap stay open and unread, and `board.read` with `incoming` returns every left-out question, together with any carried question still unanswered, and nothing the caller may not read (row 97) | Test id: `packages/engine/test/board/wakes.test.ts`, "byte cap" |
| 3.9 | A fourth open post needing the owner's reply from one agent is refused | Test id: `packages/engine/test/board/wakes.test.ts`, "owner limit" |
| 3.10 | `board.close` by the author, the manager, the owner or a service withdraws the post and cleans its wakes; anyone else is refused | Test id: `packages/engine/test/board/wakes.test.ts`, "close" |
| 3.11 | A merged wake queues behind an engine prompt queued after the wake it replaced; `board.flush` with a never-sent board wake queued adds no delivery | Test id: `packages/engine/test/board/wakes.test.ts`, "merge order and flush" |
| 3.12 | A post naming its author or a service in `to`, or a 65th open must-reply post from one author, or a question to an interrupted agent that cannot reload, is refused; while the post is open, a reply from an addressee resolved `gone`, `undeliverable`, or `removed` and then re-added counts as `replied` | Test id: `packages/engine/test/board/wakes.test.ts`, "refusals and late replies" |
| 3.13 | A sixteen-addressee `all` collection whose replies are each 16,384 backslashes gives a completion under 64 KiB encoded, with every disposition and reply id; `board.read` with `repliesTo` returns every reply in pages; five such completions owed at once take at most 128 KiB of one wake, and the rest ride the next | Test id: `packages/engine/test/board/wakes.test.ts`, "completion size" |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 3a.1 | Planners for six commands and reads for `board.channels` and `board.status`, each planner returning events | Greenfield `packages/engine/src/board/commands.ts`; pattern `packages/engine/src/routing/questions.ts`, `ask`, and `packages/engine/src/commands/internal.ts`, `Plan`, `refused` |
| 3a.2 | The wake builder and the merge and cleanup rules | Greenfield `packages/engine/src/board/wake.ts`; markers drawn as in `packages/engine/src/routing/envelope.ts`, `envelope`; `escapeLeadingSlash`; the engine's wrapping is edit E15 |
| 3a.3 | The board's source rule: withdraw when the target stops or crashes, never return; keep `DeliveryReturned` on a return (B5) | The source-rule table in `packages/engine/src/routing/deliveries.ts` (edit E16); the engine's rule for a `wait` source is `packages/engine/src/routing/deliveries.ts`, `movedOrWake` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A merge or cleanup withdraws a wake the dispatcher is about to send | High | The dispatcher writes `DeliverySent` in its own transaction before calling the runner (`deliveries.ts:dispatchQueued`); the handler withdraws only a wake the engine's deliveries view shows still queued in the same snapshot. Criteria 3.4, 3.5; post-build check 1 |
| A wake already sent costs its target a turn on a question that closed meanwhile | Low | Accepted (row 47); the wake's header names each post's state when built |
| A replaced requeued wake loses its head place in the queue | Low | Accepted (row 47) |
| Removing control characters changes pasted tool output | Low | Accepted (row 72): escape codes are noise to a reader, and newline and tab stay |
| A busy agent's wake waits for its turn to end | Low | Accepted: ACP cannot add to a running turn |

**Verify:** `packages/engine/test/board/wakes.test.ts`; the engine suite, with the tests that engine change B5 names keeping their expectations. Device or environment QA: none.

**WS-4: What happens when agents and channels change**

The reactor (client API contract, section 1, "Reactors"; engine change
B8) and the board's two condition entries (B6, B7).
Two units: 3b lifecycle, 3c membership.

The reactor reads committed events in order, writes through the engine's
command transaction path, records its last handled sequence, and is safe to run
twice. Before each write it re-reads the post's status in its own
transaction's snapshot, so a reply that committed after the reactor read
its event is never overridden (row 62). Its start-up catch-up applies the
same rules to the state it finds.

Unit 3b, lifecycle:

Lifecycle events (a stop, a crash, an interrupt, a reload failure) are
handled here only, never as leaving a channel (row 84).

- On an addressee's `AgentStopped` or `AgentCrashed`, on its
  `AgentInterrupted` when the agents view shows `reloadable !== true`, and
  on its `AgentReloadFailed`, it resolves that addressee `gone` (row 70).
- On the author's stop it withdraws the author's open posts and drops its
  owed completions (row 95); on the author's crash it leaves them open.
- On a channel manager's stop or crash, it writes `board.ManagerChanged`
  naming the nearest ancestor by `parent` links that is not stopped or
  crashed, or the owner (row 85).
- When an agent is idle with owed completions that have not failed twice
  and no queued board wake, it queues one (rows 69, 92).
- On `DeliveryReturned` for a board wake that was never accepted, it
  re-queues one fresh wake with the wake's completions and still-open
  must-reply posts. On a second such return for the same post and target,
  it resolves that addressee `undeliverable`; on a second return of a
  completion, it stops re-queuing it (rows 46, 69). On a return after an
  accept, it re-queues only the still-open must-reply posts, and the
  return counts toward nothing (row 91).
- On `DeliveryWithdrawn` for a board wake that the engine's dispatcher
  stopped at send (lead ruling L19), it rebuilds the wake by the per-post
  reach rule (row 67).

Unit 3c, membership and reach:

- On `board.ChannelMembersChanged`, and on `AgentStarted`, `AgentGrouped`
  or `board.ManagerChanged` that alters a group channel's computed
  members, it resolves a leaving addressee `removed`, withdraws a
  leaving author's posts in that channel (owing the author a completion
  with that reason), and rebuilds the leaving agent's still-queued board
  wakes without that channel's posts (row 50).
- On the same events, it checks every direct channel whose grant they may
  end. When a grant ends, it resolves every addressee of an open
  must-reply post there `removed` (row 68).
- On the same events, it re-runs the per-post reach rule over every
  still-queued board wake they may affect (row 67).

The hold-unsettled condition (edit E19, engine change B6, row 69): an agent is not
settled while it has an open post of its own that needs a reply, while it
has an owed completion that has not failed twice, or while it is an
addressee with no disposition of an open must-reply post that no queued or
sent board wake carries to it and none carrying it to it has been
accepted (row 90). An addressee that took its question and ended its turn
without replying is settled. The incoming condition (edit E20,
engine change B7, row 77): a blocking wait is cancelled with "request held" while its
waiter is an addressee with no disposition of an open post that needs a
reply.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 4.1 | Every row of the outcome table, in every order of reply, crash, resume and stop for two addressees, gives the table's result; an addressee interrupted with a session that cannot reload, and no reload attempt, is resolved `gone` at once, including at start-up catch-up; in a group channel, a labelled worker that crashes, is resumed and replies counts as `replied`, and a non-manager labelled author that crashes keeps its question open and receives its completion after resume; a lead with no label that crashes mid-collection keeps the collection open | Test id: `packages/engine/test/board/reactor.test.ts`, "outcome orders" |
| 4.2 | An owed completion reaches its author once in each order: the close while the author is crashed; the close queued, then the author crashes before the send; the completion merged with a question that is then withdrawn | Test id: `packages/engine/test/board/reactor.test.ts`, "owed completion" |
| 4.3 | A returned board wake is re-queued once with its completions and open must-reply posts; a second return resolves the addressee `undeliverable`, or marks a completion "delivery failed", after which the agent goes idle and no third wake is queued until `board.flush`; a wake accepted and then returned re-queues only open must-reply posts and does not count toward `undeliverable`; a waiter on the target is not told "settled" between the return and the re-queue | Test id: `packages/engine/test/board/reactor.test.ts`, "returned wake" (fake agent's error step) |
| 4.4 | An addressee removed from the channel, or losing the group label, is resolved `removed`, and a crash never is; its queued wake is rebuilt without that channel's posts; when a direct pair loses its last shared channel, its open question closes `unanswerable` and the asker is told; losing one of two shared channels changes nothing | Test id: `packages/engine/test/board/reactor.test.ts`, "leaving a channel" and "direct grant ends" |
| 4.5 | The reactor run twice on the same events writes each resolution and close once; a reply committed between the reactor's read and its write is not overridden | Test id: `packages/engine/test/board/reactor.test.ts`, "twice is once" and "racing reply" |
| 4.6 | An idle agent with an open post of its own that needs a reply is not settled; a paused or crashed one still resolves as the engine already does; an addressee that accepted its question and ended its turn without replying is settled | Test id: `packages/engine/test/board/settled.test.ts` (with a pause control case) |
| 4.7 | A blocking wait whose waiter is asked a board question by the agent it waits on returns "request held", whether the question came before or after the wait opened; a waiter resolved `removed` from that question is no longer held | Test id: `packages/engine/test/board/settled.test.ts`, "no deadlock" (edit E20) |
| 4.8 | With no board event in the log, neither board condition holds, so the engine's settled test and blocking waits behave as they did before engine changes B6 and B7 | Test id: `packages/engine/test/board/settled.test.ts`, "no board state"; `packages/engine/test/routing/waits.test.ts` and `acceptance/capability-05-wait.test.ts` keep their expectations |
| 4.9 | A label removed from a busy agent with a queued group wake: the dispatcher's send-time check withdraws the wake, goes on to the agent's next queued delivery, the reactor rebuilds the wake without that channel's posts, and the agent never receives them; the same holds with the board switched off; with one requeued wake that passes and one fresh wake that fails, only the failing one is withdrawn; a queued completion carrying reply text from a channel its author has left is withdrawn and rebuilt without the text | Test id: `packages/engine/test/board/reactor.test.ts`, "send-time reach" (lead rulings L19, L22, L23) |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 3b.1 | The reactor's lifecycle rules | Greenfield `packages/engine/src/board/reactor.ts`; pattern `packages/engine/src/accounts/available.ts`, `followAvailability`; the engine's crash and resume rules in `packages/engine/src/routing/waits.ts` (suspended waits) and `packages/contracts/src/stateMachine.ts`, `commandOutcome` |
| 3b.2 | The two conditions and their table entries (B6, B7) | Greenfield `packages/contracts/src/board/conditions.ts`; the tables of edits E19 and E20, in `packages/contracts/src/settled.ts` and `packages/engine/src/routing/waits.ts` |
| 3b.3 | The reactor's place in the service (B8) | Where unit 1a lists reactors; today `packages/engine/src/service.ts`, `program` |
| 3c.1 | The reactor's membership, direct-grant and reach rules | `packages/engine/src/board/reactor.ts`; group membership from `packages/engine/src/views/apply.ts`, `AgentRow.groups` and `AgentRow.parent`; the interrupted test from `packages/engine/src/routing/waits.ts:55`; recovery in `packages/engine/src/recovery/restart.ts`, `reloadInterrupted` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| The reactor writes a resolution twice after a restart | Medium | Each write is idempotent on the view; criterion 4.5 |
| A text that was already sent reaches an agent that just left the channel | Medium | Accepted and stated (row 50): sent text cannot be recalled; a wake still queued is stopped at send (row 67) |
| The reach-check inputs differ from what criteria 2.11 and 4.9 assume | Medium | They are in edit E18 at `876bf4f` (L23, rows 98, 100); a later difference goes to the lead |
| A question to a live agent that never answers keeps its author unsettled | Medium | `board.close` repairs it; catching a silent agent is the stall watch's job; `board.status` shows whom the author waits on |
| Engine change B6 makes a `wait` on a board author last longer than before | Medium | Intended (rows 33, 99); criterion 4.8 shows nothing changes without board state; criterion 4.6 has a pause control case; criterion 1.7 tests the conditions as pure functions |

**Verify:** `packages/engine/test/board/reactor.test.ts`, `settled.test.ts`; the engine suite, with the tests that engine changes B6 to B8 name keeping their expectations. Device or environment QA: none.

**WS-5: One door for agents, the owner and LGTM Studio's own code**

Adds the board's reads and snapshot entry to the engine's tables (engine
change B9), so with B1 its commands become MCP tools, CLI subcommands and
client calls with no code of their own; adds the "board disabled" switch
(row 58); and writes the board's `snapshotFor` entry (edit E9, rows 51 and
71): absent for agents, and for the owner, devices and services a bounded
summary with no post text.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 5.1 | Each board command runs with caller identity, a receipt and one transaction; a repeated request id acts once | Test id: `packages/engine/test/board/handler.test.ts`, "identity, receipts, one transaction" |
| 5.2 | An invalid or stopped agent's token is refused for every board command | Test id: `packages/engine/test/board/handler.test.ts`, "bad credentials" |
| 5.3 | Agents get `board.open`, `board.members`, `board.post`, `board.close`, `board.read`, `board.channels` and `board.status` as tools, and never `board.flush` | Test id: `packages/engine/test/board/tools.test.ts` |
| 5.4 | `lgtm --help` lists the eight `board` subcommands | Command: `./bin/lgtm --help`; `packages/cli/test/parity.test.ts` passes |
| 5.5 | A post from a service records the service's name as its author; no socket caller can set a service author | Test id: `packages/engine/test/board/handler.test.ts`, "service author" |
| 5.6 | `board.status` answers the owner, a device, a service, the agent's holder and the agent itself, and refuses anyone else; its reply holds ids, counts and states only, so a holder that is in none of the agent's channels gets no post text and no channel name; its default summary has a fixed size and carries both condition results and its sequence; its `detail` lists come in pages under 512 KiB encoded, so 3,072 incoming questions for one agent page without passing the network's limit | Test id: `packages/engine/test/board/handler.test.ts`, "status access" |
| 5.7 | A post from a paired device records the owner as author and the device in the envelope's `device` field | Test id: `packages/engine/test/board/handler.test.ts`, "device post" |
| 5.8 | A `board.read` page closes at 512 KiB of encoded text | Test id: `packages/engine/test/board/handler.test.ts`, "page byte cap" |
| 5.9 | An agent's `client.snapshot` holds no board section; after 1,000 posts of the largest size, the owner's board section holds no post text and stays under 256 KiB encoded; it always starts with the agents for which each condition holds, equal to the full view's results at its sequence; a section marked `truncated` is completed by the paged `board.channels` and `board.status`; the wait helper, re-reading summaries after board events, never ends a wait on a summary older than one it has seen | Test id: `packages/engine/test/board/handler.test.ts`, "snapshot section" (edit E9) |
| 5.10 | With the board switched off, every board command is refused with "board disabled", the reactor and conditions stop, the reach check stays in force for the dispatcher, and the service still rebuilds a log that holds board events | Test id: `packages/engine/test/board/disabled.test.ts` |
| 5.11 | A `board.read` receipt holds only its `board.Read` event, and a `board.post` receipt is scanned like the post's events for registered secrets | Test id: `packages/engine/test/board/handler.test.ts`, "receipts" |
| 5.12 | `board.channels` pages under 512 KiB encoded with 2,000 channels; `board.read` with `repliesTo` is refused to a non-member of the post's channel | Test id: `packages/engine/test/board/handler.test.ts`, "paged lists" |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 5.1 | The board's reads and snapshot entry (B9) | `packages/engine/src/api/reads.ts` (edit E4) and `packages/engine/src/api/snapshot.ts` (edit E9) |
| 5.2 | Tool descriptions and CLI summaries | `packages/mcp/src/tools.ts`, `descriptions`, and `packages/cli/src/commands/registry.ts`, `summaries` (edit E10) |
| 5.3 | The "board disabled" switch | Greenfield `packages/engine/src/board/switch.ts`; a setting read at start-up |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A board command skips the receipt or identity step | High | Every board planner runs in the engine's one command handler (edit E3); criteria 5.1, 5.2; attack pass |
| A service author can be forged from the socket | High | The service path is in-process only; criterion 5.5 |
| An agent reads every direct message through `client.snapshot` | High | Criterion 5.9; row 51 |
| The owner's snapshot outgrows the network's message limit | High | No post text in the section, a 256 KiB cap and a `truncated` fallback to `board.status` (rows 71, 83); criterion 5.9 |
| A rollback to a build without the board cannot read the log | Medium | Rollback is the switch, not removal (row 58); criterion 5.10 |

**Verify:** the test ids above; the engine's CLI and MCP parity tests. Device or environment QA: rollout step 6, one `lgtm board post` from the owner's terminal against a fresh `/tmp` service, which wakes a fake agent.

**WS-6: Proof that the board needs nothing else**

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 6.1 | The epic's line: in a channel of four, a question to one wakes that one only, and the reply wakes the asker only | Test id: `packages/engine/test/acceptance/board-wakes-only-addressee.test.ts` |
| 6.2 | A lead's hand-off in `all` mode to three workers wakes the lead once; with one worker crashed and resumed midway, it still closes | Test id: `packages/engine/test/acceptance/board-collection.test.ts` |
| 6.3 | No `board.*` event and no board snapshot section reaches any agent's `subscribe`, `client.subscribe` or `client.snapshot`; an unrelated agent cannot get a direct message through `board.read`, `board.status`, `board.channels` or another agent's thread; as a positive control, the member and its parent see the member's own thread, which may quote the message (row 81) | Test id: `packages/engine/test/acceptance/board-privacy.test.ts` |
| 6.4 | No file under `packages/engine/src/board/` imports from `packages/engine/src/runner/` or reads `runMode`; a channel with one agent recorded as `interactive` behaves the same | Test id: `packages/engine/test/board/mode-independence.test.ts` |
| 6.5 | A service killed after a post and before its wake is sent delivers the wake once after restart; one killed after the send without replay proof may deliver it twice, and the board still holds one logical wake; an addressee on a harness that cannot reload is resolved `gone` after the restart, and its asker is told | Test id: `packages/engine/test/acceptance/board-restart.test.ts` (three cases) |
| 6.6 | `pnpm check` passes, and the only existing test files that changed are those the engine-change table names, each keeping its expectations for what the engine already does | Command: `pnpm check` exits 0; `git diff --stat <client API unit 1b merge> -- 'packages/*/test'` lists only new board files and the files the table names |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 6.1 | The four acceptance files | `packages/engine/test/acceptance/`, pattern `flow-start-to-finish.test.ts`; harness `packages/engine/test/support/acceptance.ts`, `World`, `Spec` |
| 6.2 | Fake-agent scripts for posting, replying, ending turns and failing a turn | `packages/testing/src/fakeAgent.ts`, `Script`, `Step` (its `exec` step runs `lgtm board post` with the agent's token) |
| 6.3 | The import and `runMode` scan | Greenfield `packages/engine/test/board/mode-independence.test.ts` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| The fake agent cannot call a board command mid-turn | Medium | Its `exec` step runs the `lgtm` tool with the agent's token; the unit reports a gap if it cannot |
| The interactive check proves too little, since no interactive runner exists | Medium | Accepted: the check proves the board never branches on mode (row 24) |

**Verify:** the criteria above. Device or environment QA: WS-5's terminal check.

**Post-build checks** (run rule 6: code-level worries a plan cannot settle)

1. The merge and cleanup of a queued wake against the dispatcher's send:
   check under load that no agent receives a withdrawn wake.
2. A batch holding both an agent's stop and a post to it gives the same
   board view live and rebuilt.
3. Redaction of a combined wake: check that a secret split across two
   posts is not rebuilt in the wake's text.
4. Edit E17 lets a piece withdraw only a still-queued delivery whose
   source is its own namespace (threat review, TM-4).
5. The engine's wait checks judge the board's conditions on the board view
   projected with the same batch, and every reactor write goes through the
   engine's wait checks, as `CommandHandler.ts` and
   `accounts/available.ts` do (logic review, L-PB2 and L-PB3).
6. A harness's own login token, from the account's shadow home, is
   removed from stored posts and wakes (TM-3; SECURITY.md rule 6).
7. A wake carries only posts from channels its target belongs to, both
   when it is queued and when it is sent (TM-5). The send-time half is the
   dispatcher's re-check under lead ruling L19; this check proves it
   under load, against a label change racing the dispatcher.
8. No `author` or `service` field in a socket or network payload is
   honoured, for agent tokens and device credentials, on both transports
   (TM-6, SEC-BOARD-3).
9. The largest wake event and the largest `board.read` page, built from
   posts of quotes, backslashes, 4-byte characters, and control characters
   sent before removal, each stay under the network listener's message
   limit with the full envelope (TM-7, C2-05, R2-TM-3).
10. An owner alert for a board post carries no post text (SEC-BOARD-5).
11. Kills after the queue commit, after a send with replay proof, and after
    a receipt without replay proof each give one logical wake, with
    external sends as the engine allows (ARCH-PB-6; criterion 6.5).
12. The engine's recovery leaves no interrupted agent that is neither
    reloadable nor seen by the board's catch-up, for every harness's
    `reloadable` value (R2-A3).
13. The owner's board snapshot section, on a team of 50 agents with each
    agent's limit of open posts, is measured and stays under its cap, or
    is marked `truncated` (R2-A1), and its condition lists are always
    complete.
14. The dispatcher, after a send-time withdrawal, sends the target's next
    queued engine prompt in the same pass (logic m4; edit E18).
15. The reach check at queue time sees the batch's own `board.WakeBuilt`,
    and at send time judges only the wake it is given (logic M3, T3-1).

</details>

<details><summary><b>Traceability (gate 4)</b></summary>

Source universe: (a) the epic row 3 and its "Done when" line on wakes;
(b) `docs/features.md` section 2, its five items; (c) the roles plan's
seven requests (`requests.md`, "From the message board"); (d) `AGENTS.md`,
"How agents are run"; (e) SECURITY.md rules 6 and 7; (f) the Synapse list
items on channels, labels and waking (items 1 to 11, 13, 17, 19, 22);
(g) the client API contract's answers to the board's six needs (its
section 7); (h) round 1's 49 findings (`attack/round-1-findings.md`);
(i) round 2's 39 findings and lead rulings L17 to L19
(`attack/round-2-findings.md`); (j) round 3's 31 findings in the lead's
seven groups, and lead ruling L22 (`attack/round-3-findings.md`); (k) the
owner's answer to Q1, the owner's standing rule, and lead ruling L26
(board post #142).

| Source item | Workstream | Status |
|---|---|---|
| (a) Channels | WS-1, WS-2 | planned |
| (a) Direct messages | WS-2 | planned |
| (a) Wake rules | WS-3 | planned |
| (a) Behind one delivery interface | WS-3, WS-6 (6.4) | planned |
| (a) Done when: wakes only the agent that must answer | WS-3 (3.1), WS-6 (6.1) | planned |
| (b) Channels and direct messages | WS-2 | planned |
| (b) Wake rules | WS-3 | planned |
| (b) System events in a log | none needed | already true of the engine's log (row 22) |
| (b) A mailbox per agent, with receipts | WS-3 | uses the engine's deliveries; the hook path for interactive agents is out (row 4) |
| (b) Wake Claude without typing | none | out: interactive mode (row 4) |
| (b) Wait results that say why | WS-4 (4.6, 4.7) | built in the engine; the board adds its two conditions |
| (c) 1 One delivery interface | WS-3 | accepted (row 31) |
| (c) 2 Work state per agent | none | refused (rows 31, 44) |
| (c) 3 Work done signal | WS-3 (3.3), WS-6 (6.2) | accepted as `all` mode (row 26) |
| (c) 4 System author, needs-reply kind | WS-5 (5.5) | accepted through the service caller; kind label refused (rows 14, 36) |
| (c) 5 Team is an engine group | WS-2 (2.6) | accepted, within row 45's rule |
| (c) 6 Deliver before cache expiry | WS-3, WS-5 | accepted as `board.flush`; deadline tracking refused (row 29) |
| (c) 7 Read whether a post is waiting | WS-5 (5.6) | accepted as `board.status` (row 30) |
| (d) Board independent of run mode | WS-6 (6.4) | planned |
| (e) Rule 6, secrets never reach the board | WS-3 (3.7) | planned |
| (e) Rule 7, text is data | WS-3 (3.6), WS-5 (5.5) | planned |
| (f) Items 1, 2, 3, 6 | WS-2, WS-3 | adopted in the planner's reading; threads are `replyTo` |
| (f) Items 4, 5 | WS-2 | group channels adopted; a post is in one channel |
| (f) Item 7 | WS-1, WS-3 | adopted as `reply` |
| (f) Item 8 | none | not adopted (row 14) |
| (f) Items 9, 17 | WS-3 | adopted (rows 15, 18) |
| (f) Item 10 | none | not adopted; recorded for docs/features.md |
| (f) Item 11 | WS-3, WS-4 | adopted (rows 16, 49) |
| (f) Item 13 | WS-3 | adopted: the engine's dispatcher is the only sender |
| (f) Item 19 | none needed | row 22 |
| (f) Item 22 | WS-3 | adopted as `all` mode |
| (g) 1 to 6 | WS-1, WS-5 | taken in by the client API; `OwnerNeeded` subject refused (row 35) |
| (h) Round 1 findings | per row in `attack/round-1-findings.md` | every finding folded or answered |
| (i) Round 2 findings and rulings | per row in `attack/round-2-findings.md` | every finding folded; L17 as row 76, L18 as row 65, L19 as row 67 |
| (j) Round 3 findings and rulings L22 to L24 | per group in `attack/round-3-findings.md` | every finding folded as rows 84 to 98 |
| (k) Owner's answer to Q1 and ruling L26 | all workstreams; the engine-change table | reworked as plan v5 and contract v6 (rows 99 to 101) |

</details>

<details><summary><b>Guardrails triggered (gate 9)</b></summary>

| Repo rule (CLAUDE.md etc.) | How this plan satisfies it |
|---|---|
| `AGENTS.md` rule 1: push only to `qnlbnsl/lgtm-studio` | The plan's branch is pushed to `origin` only |
| `AGENTS.md` rule 2: credit copied code | No code is copied; the board's code is new |
| `AGENTS.md` rule 3: keep the lists current | Units report to the lead, who writes both lists (row 60) |
| `AGENTS.md` rule 4: follow SECURITY.md | Rules 6 and 7 are criteria 3.6, 3.7 and 5.5; the privacy edges are stated (row 55) |
| `AGENTS.md` rule 5: the client API is the surface | Every board command is in the composed API, for every client (WS-5) |
| `AGENTS.md` rule 6: no team shapes | Channels carry no team, role or phase (row 10) |
| `AGENTS.md` rule 7: no commit unless asked | Units commit under the run's standing authorization (team rules, rule 2) |
| `AGENTS.md`, "How agents are run" | Row 5, criterion 6.4 |
| `AGENTS.md`, "Language" (Effect 4, Node.js 26) | Conventions paragraph |
| The owner's answer to Q1 and standing rule: edit the engine directly, and name each change (lead ruling L26) | The engine-change table; rows 99 and 100; the regression gate; criterion 6.6 |
| Engine design: the permission ceiling | Rows 45 (d) and 73, by start ceilings; criterion 2.9 |
| Run rule 6: no `package.json` or lock edits | Conventions paragraph: the board adds no package |

</details>

<details><summary><b>Execution sizing (gate 10)</b></summary>

Models come from the harness-sessions plugin's model sheet (its harness-session skill)
at launch; this section names none (owner, 2026-10-16).

| Unit | Work area | Scope | Complexity | Why this complexity | Attack pass | Depends on |
|---|---|---|---|---|---|---|
| 1 Board contracts | contracts | board/contracts | medium | New schemas whose shapes `contract.md` fixes, merged into the engine's lists (B1, B2) with no change to what the engine does. | no | the client API plan's units 1a and 1b |
| 2a Board view and outcome function | backend | board/backend | medium | Pure fold functions and one pure table; the views state gains its `board` field (B3). | no | 1 |
| 2b Access and reach rules | backend | board/backend | high | Authorization: who may read, reach and wake whom, judged per post, with anchored groups, direct grants and start ceilings. | yes | 2a |
| 3a Posts, wakes, merge and cleanup | backend | board/backend | high | Wakes merged and cleaned inside one transaction, racing the dispatcher; the board's planners and source rule join the engine's tables (B5). | yes | 2b |
| 3b Reactor: lifecycle, managers, completions and conditions | backend | board/backend | high | Interacting crash, interrupt, resume, stop and return rules, manager succession, and durable bounded completions, run idempotently; changes the engine's settled test and blocking waits (B6, B7). | yes | 3a |
| 3c Reactor: membership, direct grants and reach | backend | board/backend | high | Membership, grant and per-post reach changes across every event that alters them, against the dispatcher's own check. | yes | 3b |
| 4 Reads, snapshot, doors and switch | backend | board/backend | medium | The board's reads and snapshot entry in the engine's tables (B9), which with B1 give the tools, CLI and transports. | yes | 3c |
| 5 Acceptance suite | backend | board/backend | medium | Four acceptance files and one restart file on the existing harness, plus one scan. | no | 4 |

Scopes: `board/contracts` would edit `packages/contracts/src/board/**`,
`packages/contracts/test/board/**`, and the board's lines in
`packages/contracts/src/commands.ts`, `events.ts`, `visibility.ts` and
`settled.ts` and in `packages/contracts/test/events-roundtrip.test.ts`.
`board/backend` would edit `packages/engine/src/board/**`,
`packages/engine/test/board/**`, the board's entries in the engine files
that engine changes B3 to B9 name, the test fixtures B3 names,
`packages/engine/test/acceptance/board-*`, `packages/mcp/src/tools.ts`,
`packages/cli/src/commands/registry.ts` and `packages/testing/**`.
Neither exists under `.plans/scopes/` yet; the lead runs the scoping skill
for both before launch (known gap 5).

Load: 8 build units, 29 launches (8 × 3 for builder, test writer and
review, plus 5 attack passes). Every unit that changes what the engine
already does has an attack pass, as an engine unit would (row 99). The lead looks up each unit's builder and
test writer from the sheet at launch and checks each vendor's remaining
weekly allowance first; the planner cannot read it (known gap 1).

</details>

<details><summary><b>Attack log (gate 7 — M/L only)</b></summary>

| Round | New findings (B/M/m) | Outcome |
|---|---|---|
| 1 | 0 / 33 / 16 | Six reviews, grades 6 to 7. Folded into plan v2 as rows 44 to 62. Seam needs approved by the lead (L15, post #69). Contract change asked as Q3 (post #73) and approved as L16 (post #75); `contract.md` is version 3. Details: `attack/round-1-findings.md`. |
| 2 | 0 / 24 / 15 | Six reviews of plan v2 (`attack/plan-v2.md`) and contract v3 (`attack/contract-v3.md`). Folded into plan v3 as rows 65 to 82, with lead rulings L17 to L19. Contract v4 asked as Q4 (post #96) and approved as L21 (post #98). Details: `attack/round-2-findings.md`. |
| 3 | 0 / 18 / 13 | Six reviews of plan v3 (`attack/plan-v3.md`) and contract v4 (`attack/contract-v4.md`), grades 6 to 7, in the lead's seven groups. Folded into plan v4 as rows 84 to 97. Client API item 15 changes asked as Q5 (post #113) and approved as L23 (`ced973b`); Contract v5 approved as L24. Details: `attack/round-3-findings.md`. |
| Rework | none | Not a review round. Plan v4 (`attack/plan-v4.md`) and contract v5 (`attack/contract-v5.md`) reworked for the owner's answer to Q1 and lead ruling L26 (post #142) on client API contract v3 at `876bf4f` (post #151), as plan v5 and contract v6 (rows 99 to 101). A full review round follows. |

</details>
