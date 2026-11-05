---
topic: shepherd-message-board
status: accepted
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

The fourth review round found no blockers, and 22 major problems in ten
groups, each decided in its own row for the owner
(`attack/round-4-findings.md`). Five groups were gaps in the client API's
shared engine edits, which its planner fixed. Of the board's own, three
mattered most. The owner's wait could end too early or never end,
because it trusted board results that engine events had made stale. A
question left out of a full wake was never delivered. And a manager's
short crash moved its channel to its parent for good. In this version the
owner's wait checks a fresh board result before it ends, every reactor
rule repairs itself after a restart, and only a stop moves a manager.

The client API's own first review round then changed the shared engine edits
the board builds on, in that plan's contract version 8. This was not a review
round of the board. It adds two things the board agreed to. The owner's wait
now ends early when only the owner can answer, so it never waits for itself.
And the owner can read and answer a post on the phone, from the page an alert
opens, with a test that follows the whole path. The rest fits the board to the
tightened rules for background work, and to the message size budgets.

The client API's second review round, in its contract version 10, changed four
small things for the board. The owner's wait now notices a question to the owner
as soon as it is posted, even while the agent is still working. A question to
the owner that was already open when alerts first start now gets its alert. A
wake's record names the wake's own id, because the delivery's id does not exist
yet when the record is written. And the size check on the board's largest
message is now against the larger budget, so nothing about a wake changes.

Its third review round, in its contract version 11, changed less for the board.
A fault in the board's own rules can no longer stop the engine: each rule falls
back to a safe answer, and the error log shows it. The owner's wait makes one
last check before it ends for any reason. The board adds a test for its wakes
when a usage-capacity hold is on the agent's queue, which the roles plan builds.

The final review round found one major problem, reported by all four reviewers.
If an agent was stopped and then resumed before the board's background work ran,
the board forgot the stop: the agent kept its old questions open and kept
running its channels. The board now remembers when each stop, crash and departure
happened, and compares that with when each question was asked. The plan also now
reads against the engine as it stands today, 73 commits on from the first scans.
None of those commits changes the board's design.

The board knows nothing about teams, roles or workflows, because those do
not belong in Shephrd. The roles plan, piece 4, decides which channels
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
the manager stops. While the manager has crashed, its nearest ancestor
can act for it, without joining the channel. A direct pair never gains a
third member. A
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
asker is woken once with every reason, the answer that decided each
addressee, and as much of their text as fits a fixed size; everything
else is read page by page. That
closing notice is a lasting duty: it survives a crash, a failed send and a
merge, and it is cleared only when the asker has received it. The asker, a
channel manager, the owner or Shephrd's own code can also withdraw a
question; when someone else withdraws it, the asker is told. A stop, a crash
or a departure counts for what was already open, even if the agent came back
before the board acted; a question asked after it came back is not affected.
When a question closes, any of its wakes still waiting are removed, so nobody
spends a turn on a closed question.

**An agent waiting for a board answer is not finished.** If a lead asks
another lead a question and ends its turn, anyone waiting on the first lead
is not woken until its question closes and its closing notice has reached
it. An agent that received a question and ended its turn without answering gets one reminder. If its next turn
ends the same way, it is marked as having given no answer and counts as
finished, and its asker is told once; a late reply still counts. An addressee
can acknowledge a post when it starts responding, which takes the post out of
any wake still queued for it. A question that did not fit in a wake is sent in the next one. The
owner's own wait reads a fresh board result before it ends, so it agrees
with an agent's wait. An agent that is itself being
asked a question cannot be stuck behind a blocking wait on the asker; the
wait gives way, as the engine's own waits do for engine questions.

**Leaving a channel takes effect at once.** When an agent leaves a channel,
any wake still waiting for it is rebuilt without that channel's posts.
Text already delivered cannot be taken back, and the plan says so.

**Privacy has stated edges.** Channels keep messages apart for routing and
to limit mistakes. They are not a secrecy boundary: every agent runs as the
owner's user and can read Shephrd's files, and a parent sees its child's
whole conversation. Posts cannot be deleted.

**Text is data.** A post reaches another agent inside the engine's data
envelope, with a leading slash escaped, and secrets are removed before it
is written. The line naming a post's author is built from fixed words, so
an agent named "owner" cannot pass itself off as the owner. Only Shephrd's
own code can post as Shephrd.

**The owner's phone hears about questions for the owner.** A post that
needs the owner's reply raises one alert to the owner, and the
alert ends when the post closes. An agent can have at most three such
questions open at once. When the phone starts, it gets a bounded summary
of the board, with no post text, and reads the text page by page. Every
list the phone may ask for comes in pages. The alert opens the asking
agent's page, where the owner taps to read the post, and answers it there.
The tap matters: reading marks a post as read, and just opening a link must
change nothing. If the owner is waiting on an agent that has asked the owner a
question, the wait ends at once and says so.

**Sizes are measured as they travel.** Every wake and every page is
measured as the network encodes it, and control characters are removed
from posts. Pages stay under the client API's budget. One very full wake can
pass the size the phone's live stream takes, so the stream shows a marker in
its place, and the client reads the whole message on its own.

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

The board's nine commands and nine events join the engine's shared
definitions, which every client and the engine read. The risk is a
definition that shows a private message to the wrong agent, or a name that
collides with another piece's; tests check that every board event is
hidden from agents and that every name is unique. When done, the owner can
see the board's commands in `shephrd --help`.

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

### One door for agents, the owner and Shephrd's own code

The board's commands become Shephrd tools for agents, `shephrd board …`
commands for the owner's terminal, and calls for the web page and the
phone, all through the engine's own command lists with no door of their
own. The risk
is a new door that skips a check; the board's commands go through the
engine's one command handler. When done, a real `shephrd board post` from
the terminal wakes an agent.

### Proof that the board needs nothing else

An acceptance suite drives every main board rule through the public
connection only, with real agent tokens and the fake agent. One check
proves the board never looks at how an agent is run. When done, `pnpm
check` passes with the new board suite added, and the only existing engine
tests that changed are the ones this plan names.

### Reading and answering a post on the phone

The board adds its panel to the agent's page that an alert opens. The owner
taps to read the post, and replies from the same panel. The risk is an
agent's text running as code in the page, so the text is only ever shown as
text. When done, a browser test follows the notification, reads the post,
replies, and sees both the post and its alert close.

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
   where this plan names a change. The owner then runs one `shephrd board
   post` from the terminal.
7. **The panel on the phone's page.** It needs the client API's thread page
   and its alerts, so it waits for those units. Nothing else in the board
   waits for it: until it lands, the page shows the client API's fallback,
   which says that the post is answered from a terminal.

The work lands on a branch from `engine` after the client API plan's two
engine units merge.
Once the board writes its first event, the log needs the board's
definitions to be read; from then on, rollback means switching the board
off, not removing it.

---
<!-- ⛔ implementation details and gate evidence below; owner overview is complete -->

<details><summary><b>Implementation details (gates 2, 3, 5, 6, 8)</b></summary>

Conventions for every unit. Paths are relative to the Shephrd repository
root. The recorded engine commit is `9e386b0` (row 144). Engine anchors come from
`scouting.md` (scans at `8ff4c9b`) and the round-1 reviews
(`attack/round-1-*.md`), and every named file was re-checked at `9e386b0`. "The client API contract" is
`.plans/plans/shepherd-client-api/contract.md` on `worker/plans-api`,
version 17 at `b38aa6f`, copied to `client-api-contract-v17.md` in this folder
(rows 121, 128, 129, 135, 142, 146, 147, 150, 151, 155). "Edit EN" is that contract's section 6,
edit EN: a direct edit to the engine that the client API plan's units 1a
and 1b make, and that the board then adds its own entries to. "The piece
batch path" is edit E23: every batch a planner, a read's marks or the
reactor produces passes its checks before it is written. The board's own
contract is `contract.md`, version 15 (rows 121 to 156). "Ancestor" means by the
engine's fixed `parent` links, never by holder availability (lead ruling
L18). "Ceiling" means the permission an agent was started with, from its
`AgentStarted` (row 73). Greenfield anchors give
the target path and the neighbouring pattern file; every unit re-reads the
frozen contract before it starts. A "test id" is a Vitest file path, run
with `pnpm vitest run <path>`; a Playwright test runs with `pnpm playwright
test <path>`. "Rows" are rows in this plan's
`decisions.md`. RPC means remote procedure call: one request and its reply.
ACP is the Agent Client Protocol, through which the engine drives agents.
MCP means the Model Context Protocol, through which agents get Shephrd's
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
`board.status` function. The board's one page entry is in
`packages/web/src/thread/subjects/` (row 122). The engine folder imports the engine's views and the helpers of
edit E22, never `packages/engine/src/runner/`. Tests live in
`packages/contracts/test/board/` and `packages/engine/test/board/`, and the
acceptance tests in `packages/engine/test/acceptance/board-*.test.ts`
(pattern `flow-start-to-finish.test.ts`).

**The engine changes this plan makes (rows 99, 100).** Each is an entry
in a list or table that the client API plan's units 1a and 1b build. The
board's unit that owns it writes it. "Keeps its expectations" means only
its imports, fixtures or setup change.

Every function this plan adds to a per-piece table (view reducer, reach check, hold-unsettled, request-held, source rule, secret keep list, `snapshotFor`, alert source, `openMatters`) is called through the engine's `guardPiece` (client API contract, section 1, edit E30). If it throws, the engine logs the namespace, the table and the error's class name, with no event text, and uses the stated fallback. This plan adds no wrapper of its own, and no direct call. A reducer reads the event and the sequence, and nothing else from the envelope, because a projection passes placeholders for the rest. (Rows 136 and 137.) The client API's fixture test,
`packages/engine/test/pieces/throwing-piece.test.ts`, reaches every table the
board adds to, so the board adds nothing to its expectations.

| # | Change | Files | What the engine already does that changes | Existing tests updated | Unit |
|---|---|---|---|---|---|
| B1 | The board's command group joins `CommandsRpcGroup` (edit E1), with its access entries (edit E2); each planner sets its `reply` function (edit E3) | `packages/contracts/src/commands.ts`, one `.merge` line; `packages/contracts/src/board/commands.ts` | Agents get seven more tools, and `shephrd` gains a `board` subcommand group | `packages/contracts/test/commands.test.ts` updates its pinned list of MCP tools with the board's seven, as edit E2 requires of each piece (row 134). The others keep their expectations; `packages/contracts/test/unique.test.ts`, `packages/cli/test/parity.test.ts` and `command-inventory.test.ts` cover the board through their whole-group checks | 1 |
| B2 | The board's events join the `Event` union (edit E5), with one `...keepInEveryState(board tags)` line in the lifecycle table, each with the class `owner-only` (edit E8); its alert source joins the alert list, and its kind's title joins the client API's title table, added by whichever of this unit and client API unit 6a is built second (row 122) | `packages/contracts/src/events.ts`; `packages/contracts/src/stateMachine.ts`, `eventTable`; `packages/contracts/src/board/events.ts`; `packages/contracts/src/visibility.ts` | None: no board event changes a lifecycle state, no engine view reads a board tag, and no agent sees one | `packages/contracts/test/events-roundtrip.test.ts` gains the board's eight events; `packages/contracts/test/state-machine.test.ts` keeps its expectations and covers the board's tags; `packages/engine/test/api/subscribe-visibility.test.ts` gains one sample per board event (l.52, l.149) and keeps its expectations for the engine's tags (row 112) | 1 |
| B3 | The board's view is the views state's `board` field (edit E6) | `packages/engine/src/views/apply.ts`, `State`, `emptyViews`, `apply` | The views state gains a field, and `debug.compare-views` reports differences in it | `packages/engine/test/views/apply.test.ts`, `rebuild.test.ts`, `compare-views.test.ts` and `test/support/viewFixtures.ts` gain the field; their expectations for the engine's fields stay | 2a |
| B4 | The board's reach check replaces unit 1's "refuse" entry (edit E18) | `packages/engine/src/routing/reach.ts` | Board wakes can be queued and sent; the dispatcher withdraws a board wake that fails at send | `routing/deliveries.test.ts` and `accounts/carry-on-dispatch.test.ts` keep their expectations | 2b |
| B5 | The board's six planners join the planner table (edit E3): `board.open`, `board.members`, `board.post`, `board.close`, `board.acknowledge`, `board.flush` (rows 107, 152), none of which sets `afterCommit` (edit E3). Its source rule stays unit 1's "withdraw" (edit E16; row 126): edit E16 asks only what happens when the target stops or crashes, and a returned delivery is finished, so no rule applies to it | `packages/engine/src/commands/planners.ts`; a test on the source-rule table in `packages/engine/src/routing/deliveries.ts` | None for the engine's commands and sources | `commands/handler.test.ts` and `routing/deliveries.test.ts` keep their expectations | 3a |
| B6 | The board's hold-unsettled entry replaces "never" (edit E19) | The table in `packages/contracts/src/settled.ts`; `packages/contracts/src/board/conditions.ts` | `settled` is false for an agent with an open must-reply post of its own, an owed completion, or a question that never reached it, so a `wait` on that agent, and `waitForAgents`, last until it clears | `routing/waits.test.ts` and `acceptance/capability-05-wait.test.ts` keep their expectations, because they write no board event (criterion 4.8) | 3b |
| B7 | The board's request-held entry replaces "never" (edit E20) | The table that `packages/engine/src/routing/waits.ts` reads | A blocking `wait` ends with "request held" when its waiter is asked a board question it has not answered | `routing/waits.test.ts` keeps its expectations | 3b |
| B8 | The board's reactor joins the engine's followers of committed events, starting after `recovery.whenReady` and writing only through the piece batch path (edits E6, E23; row 124) | `packages/engine/src/service.ts`, where edit E6 starts piece reactors; today's followers start at `packages/engine/src/commands/CommandHandler.ts:179-181` (rows 117, 144) | The service runs one more follower | None | 3b |
| B9 | `board.read` (a read with marks), `board.channels` and `board.status` join the read table (edit E4; row 108); the board's snapshot entry replaces "no section" (edit E9), and it reads the one views value that edit E9 gives it; the "board disabled" setting is read at start-up | `packages/engine/src/api/reads.ts`; `packages/engine/src/api/snapshot.ts`; `packages/engine/src/board/switch.ts` | `client.snapshot` gains a board section for the owner and services | `packages/mcp/test/` and `packages/cli/test/` keep their expectations for the engine's commands; tool descriptions and CLI summaries gain the board's in unit 1, not unit 4, because adding the board's commands to the inventory stops those tables compiling (row 158) | 4 |
| B10 | "board disabled" joins the public reasons the server passes | `packages/engine/src/api/server.ts:41`, the allowed reasons that `commandError` (l.46) keeps | A board command refused while the board is off shows "board disabled", not "command refused" (row 116) | The server's error tests keep their expectations and gain the board's reason on both transports | 4 |
| B11 | The board's entry joins the thread page's subject panel table (row 122) | `packages/web/src/thread/subjects/board.tsx`, and one line in the table that client API unit 7b writes | The panel shows the board's entry for a board subject instead of the fallback | `packages/web/test/subject-panel.test.tsx` keeps its expectations for an unknown namespace | 6 |
| B12 | The board's `openMatters` replaces "none" in the client API's table (client API section 4; row 131) | `packages/engine/src/board/openMatters.ts`; one line in that table | The alert reactor's first-start scan raises a `baseline` alert for each post that is open and needs the owner's reply | None; client API criterion 6.16 uses a fixture entry | 4 |
| B13 | The board's id fields join the redactor's structure tables (rows 145, 148, 151, 152, 153). These are the exact event paths: `board.ChannelOpened`: `channelId`, `opener`, `manager`, `anchorAgentId`, `members`; `board.ChannelMembersChanged`: `channelId`, `membersAdded`, `membersRemoved`; `board.ManagerChanged`: `channelId`, `manager`; `board.PostWritten`: `postId`, `channelId`, `author`, `to`, `replyToPostId`; `board.PostAcknowledged`: `postId`, `addressee`; `board.AddresseeResolved`: `postId`, `addressee`, `decidingPostId`; `board.PostClosed`: `postId`, `closer`; `board.WakeBuilt`: `wakeId`, `targetAgentId`, `carried`, `mustReply`, `completions`, `completionReplyText`, `reminders`, `noAnswers`; `board.Read`: `channelId`, `reader`, `postIds`. A planner's `reply` in `receiptStructure` lists `channelId` and `postId`. `anchorAgentId`, `targetAgentId`, `decidingPostId`, `replyToPostId` and the plain ids are identities. The table already lists `to` as an `actor` for `PermissionMoved` and `QuestionMoved`, so this change adds `elements: actor` to that entry and keeps its `fields`. The author, reader, opener, closer, manager and addressee use `actor`, whose service fields come from client API edit E33. `membersAdded` and `membersRemoved` use the table's `member` under `elements`, and `carried`, `mustReply`, `completions`, `reminders` and `postIds` hold their ids under `elements`, and each of `noAnswers`'s `elements` has `postId` and `addressee`. The names are specific because the table exempts a field by its name across all events; the command, the read page and the view keep `replyTo`, `anchor` and `target` | `packages/engine/src/log/redactionStructure.ts`, `eventStructure` and `receiptStructure` | A board id bypasses string-value redaction, as the engine's own ids do; a post's text, a channel's name and a label stay text | None change their expectations | 3a |

The board writes no side table and adds no migration (edit E7): its state
is its view, rebuilt from the log.

**The outcome table (rows 49, 69, 70).** Used by the post planner,
`board.close` and the reactor, as one pure function in
`packages/engine/src/board/outcome.ts`.

| Event for one addressee | Its disposition |
|---|---|
| It replies in the same channel | `replied` |
| It stops or crashes after the post, even if since resumed (judged by the lifecycle rules only, never as leaving, rows 84, 143) | `gone` |
| `AgentInterrupted`, and the agents view shows `reloadable !== true` | `gone`, at once (the engine's `waits.ts:55` test) |
| `AgentReloadFailed` after the post, even if since resumed (row 143) | `gone` |
| Interrupted with a reloadable session | none while recovery tries it |
| It is removed from the channel or loses the label after the post, even if since re-added, or a carried post fails the reach check (rows 67, 68, 143) | `removed` |
| Two board wakes carrying this post to it are returned before either is accepted | `undeliverable` |
| It pauses | none; the post waits |
| It replies while the post is still open and it has any other disposition | `replied` (the one allowed change, row 93) |

| Post event | Result |
|---|---|
| `any` mode, first `replied` | closes `answered` |
| `all` mode, every addressee has a disposition, at least one `replied` | closes `answered` |
| Either mode, every addressee has a disposition, none `replied` | closes `unanswerable` |
| The owner replies | closes `answered` |
| `board.close` | closes `withdrawn` |
| The author stops, or is removed from the channel, after the post, even if since resumed or re-added (a crash is never removal, rows 84, 143) | closes `withdrawn` |
| The author crashes, or is interrupted and cannot reload | stays open; replies are still recorded |

**Completions (rows 69, 87, 88, 92, 95, 110, 111, 114, 115, 143).** At a close,
an agent author is owed a completion, unless it withdrew the post itself
or stopped after the post, even if it has since been resumed and whatever
closed the post. A withdrawal by someone else, or by the author's removal from
the channel, owes one with that reason. The view keeps owed completions
per agent. A completion always carries the post id, the outcome, every
disposition, the id of the reply that decided each `replied` addressee's
part, the id of the owner's closing reply if any, and the number of
replies: at most 17 ids. It carries the deciding replies' text only within
64 KiB encoded; every other reply is read with `board.read` and
`repliesTo`. A completion carrying reply text is judged at send like a
post of its channel. A completion is discharged only by `DeliveryAccepted`
for a wake whose `board.WakeBuilt` names it. While a queued or sent wake
carries it, no other wake carries it. It survives merging, cleanup, a
return and the author's crash; the reactor queues a wake for it whenever
no queued or sent wake carries it and it has not failed twice. After two
returns without an accept it is no longer re-queued, rides the next board
wake, is shown as "delivery failed", and can be sent with `board.flush`. A
wake returned after an accept is not re-queued, as the engine does not
re-queue an accepted delivery. The view folds `AgentStopped` to drop the
agent's owed completions, and a later resume does not bring them back.

**Cleanup (rows 47, 82).** At a close, the post is removed from every
still-queued board wake that carries it. When one addressee gets a
disposition, the post is removed only from that addressee's queued wakes.
A replacement is built from the target's current duties only: completions
still owed, no-answer notices and reminders still owed, and open must-reply
posts it has not acknowledged. An original question in the withdrawn wake
stays eligible after a read until acknowledgement (row 152).
A completion already discharged is never carried again (row 115).

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
| 1.2 | `board.ChannelOpened`, `board.ChannelMembersChanged`, `board.ManagerChanged`, `board.PostWritten`, `board.PostAcknowledged`, `board.AddresseeResolved`, `board.PostClosed`, `board.WakeBuilt` (with the wake's source id, `carried`, `mustReply`, `completions`, `completionReplyText`, `reminders` and `noAnswers`, and no delivery id; rows 132, 153) and `board.Read` round-trip unchanged | Test id: `packages/contracts/test/board/schemas.test.ts`, "events round-trip" |
| 1.3 | Every board event is `owner-only` in `boardVisibility`, and no board event has a top-level `agentId` field | Test id: `packages/contracts/test/board/schemas.test.ts`, "hidden from agents" |
| 1.4 | `boardAccess` matches `contract.md`'s command table: `board.flush` has no `agent`; `service` appears only on `board.post`, `board.close`, `board.status` and `board.flush` | Test id: `packages/contracts/test/board/schemas.test.ts`, "access table" |
| 1.5 | A post's text refuses more than 16,384 characters; `to` refuses more than 16 addressees; a channel name refuses anything outside `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`; a `board.status` summary has a fixed shape with no list in it; a completion holds at most 17 reply ids whatever the number of replies (row 111) | Test id: `packages/contracts/test/board/schemas.test.ts`, "limits" |
| 1.6 | `boardAlertSources` raises kind `board.post` with key `post:<postId>`, the author's agent id and the post's id as its subject, for a post that needs the owner's reply; it names no title and no post text; it ends the alert on `board.PostClosed`; a post from a service never raises it, because criterion 3.12 refuses one that names the owner (row 122) | Test id: `packages/contracts/test/board/alerts.test.ts` |
| 1.7 | `holdsUnsettled(agentId, view, deliveries)` and `holdsIncoming(agentId, view)` are exported pure functions of the board's view and the engine's delivery statuses from edit E19's input, with the cases of rows 69, 77, 90 and 104; two inputs with the same board view, before and after a send-time withdrawal, give different `holdsUnsettled` results; a must-reply post read through a `board.read` page counts as reached; the results the snapshot section and `board.status` carry equal these functions' results at the same sequence (row 89); `ownerHeld(view)` lists the agent author of every open post with the owner in `to`, and of no other post, and a close removes it (row 123) | Test id: `packages/contracts/test/board/conditions.test.ts` |
| 1.8 | Every command and event name in the full API is unique, and every board name starts with `board.` | Test id: `packages/contracts/test/unique.test.ts` (edit E1) passes with the board's group and events merged |
| 1.9 | The test runner runs the board's tests | Command: `pnpm vitest list` lists files under `packages/contracts/test/board/` and `packages/engine/test/board/` |
| 1.10 | Every board event keeps every lifecycle state, and the engine's visibility test has a sample for each board event (row 112) | Test ids: `packages/contracts/test/state-machine.test.ts` and `packages/engine/test/api/subscribe-visibility.test.ts` pass with the board's tags in the union |
| 1.11 | The board's stated largest event and page fit the client API's 900 KiB page budget, as real encoded RPC messages with chunk wrappers and escaping: a wake's `DeliveryQueued` and `PromptSent` with a full 256 KiB body, and a `board.read` page at 512 KiB; a `board.PostWritten` of 16,384 four-byte characters and 16 addressees, and a `board.WakeBuilt` for a full body of the smallest posts, are also under 256 KiB, so they never become markers (rows 127, 133; client API criterion 2.6) | Test id: `packages/contracts/test/size-limits.test.ts`, with the board's entries from `packages/contracts/src/board/limits.ts` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 1a | Ids, `ReplyMode`, `BoardAuthor`, `Disposition`, outcomes | Greenfield `packages/contracts/src/board/ids.ts`; pattern `packages/contracts/src/ids.ts`, `AgentId` |
| 1b | The nine events, as `BoardEvent`, joined to the `Event` union and the lifecycle table (B2) | Greenfield `packages/contracts/src/board/events.ts`; pattern `packages/contracts/src/events.ts`, `QuestionAsked`; `packages/contracts/src/stateMachine.ts`, `eventTable`, `keepInEveryState`; edit E5 |
| 1c | The nine commands, as `BoardRpcGroup`, prefixed `board.`, merged into `CommandsRpcGroup` (B1) | Greenfield `packages/contracts/src/board/commands.ts`; pattern `packages/contracts/src/commands.ts`, `CommandsRpcGroup`; edits E1, E2 |
| 1d | The access and visibility entries, `boardAlertSources`, the title for kind `board.post`, the board view's type, `holdsUnsettled`, `holdsIncoming`, `ownerHeld` | Greenfield `packages/contracts/src/board/index.ts` and `conditions.ts`; shapes from the client API contract, sections 1, 4 and 6 (edits E2, E8, E19) |
| 1e | The board's stated largest event and page | Greenfield `packages/contracts/src/board/limits.ts`; the client API's `packages/contracts/test/size-limits.test.ts` |

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
by `board.ManagerChanged`, rows 85 and 106; a direct channel has none; an
agent opener of a plain channel is an explicit member); posts (id,
channel, author, text, `to`, reply mode, `replyTo`, each addressee's
disposition and deciding reply, who has acknowledged, the sequence at which it took
the post, whether its reminder was accepted and at what sequence, replies, status open
or closed with its outcome); owed completions and no-answer notices per agent; each
agent's last turn's end, from `TurnEnded` with `compact` false or the return of an accepted board wake (rows 153, 156); return counts per post or
completion and target, counting only wakes returned without an accept
(rows 91, 110); each agent's ceiling, from its `AgentStarted` (row 73);
the set of stopped agents, from `AgentStopped` and the change out of
`stopped` (row 114); for each agent, the sequence of its last `AgentStopped`,
and of its last `AgentCrashed` or `AgentReloadFailed`, kept after a resume
(row 143); for each agent, its current labels, and the sequence at which it
last lost each one, from `AgentStarted` and `AgentGrouped`; for each plain
channel and member, the sequence of its last removal; each post's own sequence;
each channel's seat sequence, from `board.ChannelOpened` and
`board.ManagerChanged`; read state per member and channel (a watermark plus
post ids read above it, starting at the join, rows 48 and 79); and the
wake index from `board.WakeBuilt` (wake id, which is the delivery's source id;
target; carried posts, must-reply posts, completions), with the delivery id
joined from the `DeliveryQueued` whose source names the wake (row 132). It keeps no reactor position
(row 105). Delivery status is never stored: it is read from the engine's
deliveries view (row 46). A group channel's members are computed from the engine's agents
view at read time by rows 65 and 84: label carriers that are not stopped
and have the anchor as an ancestor or are the anchor, plus the anchor and
the current manager while they are not stopped. A crash, an interrupt, a
pause or a resume changes no membership.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 2.1 | `boardAfter` folds every board event, the engine's `DeliveryQueued` with a board source (joining the wake to its delivery id, row 132), its `DeliveryAccepted` and `DeliveryReturned` for a board wake, `AgentStarted` and `AgentGrouped` (for ceilings and group join positions), `AgentStopped` (dropping owed completions, including failed ones, and recording its sequence), `AgentCrashed` and `AgentReloadFailed` (recording their sequence) and the `StateChanged` out of `stopped` (restarting read state), and ignores every other event; those sequences, the post's and the seat's sequences and the last-left sequences survive a resume and a rejoin, and are equal in the live and rebuilt views (row 143); a stop with an already-closed post's completion owed, then a rebuild, then a resume, leaves no completion in the live view, the rebuilt view or the snapshot, and a crash and resume keep it (row 114) | Test id: `packages/engine/test/board/view.test.ts`, "fold" |
| 2.2 | The board's view rebuilt from the log alone equals the live view after every board test | The engine's rebuild check covers the views state's `board` field (edit E6); `pnpm vitest run packages/engine/test/board` exits 0 |
| 2.3 | Accepting a wake marks exactly its carried posts read and discharges exactly its completions; a `board.Read` marks exactly its page; the watermark moves forward only over a contiguous run; paging back never unreads a post; a member joining a channel of 400 posts starts with none unread; an agent stopped and then resumed with `resume --fresh` starts at each channel's last post, in plain and group channels (row 114) | Test id: `packages/engine/test/board/view.test.ts`, "read state" (cases: 25 unread plus a question, wake carries 21; read an old page; restart; late join to a plain channel and to a group channel; stop and resume) |
| 2.4 | An agent can add to a plain channel only an agent it holds and its own holder; every other add is refused | Test id: `packages/engine/test/board/access.test.ts`, "adding members" (child, parent, sibling refused, cousin refused, owner adds anyone) |
| 2.5 | When a manager stops, `board.ManagerChanged` names the nearest ancestor by `parent` links that is not stopped, not crashed and not interrupted with a session that cannot reload, or the owner; the new manager is a member with its read state at the channel's last post; a crash, an interrupt, a pause or an account change of the manager or any ancestor writes no `board.ManagerChanged`; while the manager is crashed, its acting manager can use `board.members` and manager `board.close` and is not a member, and after the manager's resume the acting manager has no right left; a plain channel's agent opener stays a member after its seat moves (row 106) | Test id: `packages/engine/test/board/access.test.ts`, "manager rights pass up" (cases: a paused opener, a paused inheritor, a crashed then resumed opener with no label, a stopped opener) |
| 2.6 | A group channel admits label carriers that are not stopped and have its anchor as an ancestor, plus the anchor and the current manager whether or not they carry the label; an owner-opened channel admits only carriers under the anchor the owner named; an agent naming an anchor other than itself is refused; an agent cannot bind a label that no agent in its subtree carries; a carrier in another subtree, whether started with the label or given it by `group`, is not a member; a member's crash, interrupt, pause or resume changes no membership; when the manager crashes, no one joins and no one leaves; when the manager stops, the inheriting manager joins and no one else does; a manager crash followed by its parent's pause and return changes nothing | Test id: `packages/engine/test/board/access.test.ts`, "group channels" (cases include a manager with no label posting an `all` hand-off to its labelled children) |
| 2.7 | A direct channel opens, and each later post in it is allowed, only while one side is the other's parent, the pair shares a plain or group channel, or one side is the owner or a service; a paused parent keeps the grant; a grant resting on a group channel survives one side's crash and resume; after one side leaves the last shared channel, the next post is refused, and losing one of two shared channels changes nothing; a direct channel has no manager, and when its sibling opener crashes, or the agent of an agent-and-service pair crashes and is resumed, the channel keeps exactly its two members, and the service's grant holds (rows 106, 117) | Test id: `packages/engine/test/board/access.test.ts`, "direct channels" |
| 2.8 | A non-member cannot read or post in a channel; the owner can; a service can post, and open a direct channel with an agent, but cannot read | Test id: `packages/engine/test/board/access.test.ts`, "read and post" |
| 2.9 | A post that needs a reply from an agent with a wider ceiling than its author is refused, unless one is the other's ancestor; a target that reports a narrower mode is still refused; a lead that narrows its own mode can still ask its workers | Test id: `packages/engine/test/board/access.test.ts`, "ceiling" |
| 2.10 | A `replyTo` naming a post in another channel, or sent by a caller no longer in the channel, is refused before anything is written | Test id: `packages/engine/test/board/access.test.ts`, "reply stays in its channel" |
| 2.11 | Given a delivery id and its board source, the reach check finds that wake and judges each carried post on its own: a failing no-reply post is left out, a failing must-reply post resolves its addressee `removed`, a completion without reply text always passes, a completion with reply text fails once its author is no longer a member of the post's channel, and an old carried post never refuses a new command; at queue time it finds the batch's own `board.WakeBuilt` by the source id, because the delivery request becomes an event after it (row 132); a service's post in its direct channel with an agent passes at queue and at send | Test id: `packages/engine/test/board/reach.test.ts` (edit E18) |
| 2.12 | Every board event, folded with a placeholder envelope that holds only the sequence, gives the same view as with its real envelope, because each event names its own reader, opener and closer (row 136) | Test id: `packages/engine/test/board/view.test.ts`, "reads only the event" |

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
| The client API's reach-check inputs differ from row 45 | Medium | Edit E18 at `5ceb503` matches it (rows 61, 98, 120, 121); a later difference goes to the lead |

**Verify:** `packages/engine/test/board/view.test.ts`, `packages/engine/test/board/access.test.ts`, the engine's rebuild check. Device or environment QA: none.

**WS-3: Posts that wake only the agent that must answer**

The `board.post` and `board.close` handlers, the wake builder, merging and
cleanup. One unit, 3a.

How a post is planned, inside the engine's command transaction, as a
planner in the engine's planner table (edit E3, engine change B5): remove control characters other than newline and tab from the text,
then redact it (row 72); check access and reach (2b), the owner-question
limit (row 54) and the limit of 64 open must-reply posts per author
(row 71); refuse a post that needs a reply with no addressee, with its
author in `to` (row 78), with a service in `to` (row 94), from a service
with the owner in `to` (row 122), or to an
addressee that is stopped, crashed, or
interrupted with a session that cannot reload (row 70); return
`board.PostWritten`; if it replies to an open post in the same channel
from an addressee with any disposition but `replied` (row 93), return
`board.AddresseeResolved` (`replied`), and, if the outcome function closes
the post, `board.PostClosed` and an owed completion for its agent author;
compute the wake set (agents only: the addressees of a post that needs a
reply, minus the author, plus the author of any post this one closed,
minus any stopped or crashed agent, whose completion stays owed, because the
piece batch path refuses a `DeliveryQueued` for one, row 125); apply
the cleanup rule (rows 47, 82); for each agent in the wake set, if it has
a board wake that is queued and was never sent, withdraw it (edit E17);
then return `board.WakeBuilt`, naming the wake by its source id, its carried
posts, its must-reply posts and its completions, and one delivery request. The
piece batch path turns that request into a `DeliveryQueued` after the planner's
own events (row 132), through the engine's piece-delivery helper,
`routing/pieceDelivery.ts` (edits E15, E23), with source `{ namespace:
"board", id: <wake id> }` and sender `piece { namespace: "board" }`. A wake carries only current duties that no
other queued or sent wake carries to the same target (row 115). The
planner's `reply` function returns the post id from its own batch
(edit E3, row 107). Every post placed in a
wake is judged by the reach check on its own (row 67). A wake that was sent and
requeued keeps its place; new posts for that agent go into one other wake
(row 46). A merged or replaced wake is a new delivery, so it goes to the
back of the target's queue (row 62). `board.flush` is a no-op when the
target already has a never-sent board wake queued (row 62).

The body is plain text, at most 256 KiB as JSON encodes it (row 72). It
carries, in order: the target's owed completions that no other queued or
sent wake carries, using at most 128 KiB, each bounded to 64 KiB with at
most 17 reply ids (rows 88, 111); then every open must-reply post the
target has not read and no other queued or sent wake carries to it; then
the oldest unread posts that need no reply, up to 20; then a count of the
rest. Completions never use the 20 digest places. If posts are left out,
the body ends with "N more posts need your reply; run board.read with
incoming set" (row 80), and the reactor queues the next wake for them
once this one is accepted or returned (row 104). Each post is a header line built
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
| 3.3 | `any` and `all` modes close by the outcome table, and the asker is woken once at the close with every disposition, each deciding reply's id, the number of replies, and deciding reply text within 64 KiB; a withdrawal by someone else, or the author's removal, tells the author once with the reason; the author's own `board.close` or stop tells no one | Test id: `packages/engine/test/board/wakes.test.ts`, "outcome table" (one case per row) |
| 3.4 | Three posts for one idle-target agent while its never-sent wake is queued leave one queued board wake carrying all three; a requeued wake keeps its place and is not merged; a sent wake is not withdrawn; a paused target is the control case, with its wake left queued and merged in the same way | Test id: `packages/engine/test/board/wakes.test.ts`, "wakes merge" |
| 3.5 | When a question closes, a queued wake carrying only it is withdrawn, and a queued wake carrying it and another open question is replaced by one carrying only the other; in `all` mode, W1's reply leaves W2's queued wake unchanged; a wake carrying a completion and a withdrawn question is replaced by one carrying the completion | Test id: `packages/engine/test/board/wakes.test.ts`, "closed questions leave the queue" |
| 3.6 | The wake reaches the agent inside the engine's envelope, whose fixed wording names the board and not another agent (edit E15); each post sits between its own fresh markers with a leading slash escaped; an agent named with a line break, `owner`, a service's name or a copied marker cannot change a header, because no agent-chosen name appears in it; a reactor-built wake names each post's original author | Test id: `packages/engine/test/board/wakes.test.ts`, "text is data" |
| 3.7 | A secret registered with the redactor never appears in a stored post or wake; a secret whose value also occurs inside a board id leaves that id whole in the event, the receipt and the view, and is still removed from the post's text (row 145); the same secret inside the `to` of a `PermissionMoved` leaves that agent id whole, and in a plain string under `to`, `author`, `replyTo` or `carried` it is still redacted (row 148); with the secret inside an agent id, through the real log writer and the receipt path, `board.ChannelOpened`'s `anchorAgentId` and `board.WakeBuilt`'s `targetAgentId` stay whole, so group membership, the wake-target join, the discharge of a completion and the rebuilt views all give the same result as with no secret, while a channel's name, a label and a post's text are still redacted (row 151) | Test id: `packages/engine/test/board/wakes.test.ts`, "redacted" |
| 3.8 | A wake body never exceeds 256 KiB as JSON encodes it, for posts of quotes, backslashes and 4-byte characters; control characters other than newline and tab are gone from stored text; posts past the cap stay open and unread, and `board.read` with `incoming` returns every left-out question, together with any carried question still unanswered, and nothing the caller may not read (row 97); when the target answers the carried questions and ends its turn, the left-out questions reach it in the next wake with no new post and no `board.flush`, and reading them with `board.read` and ending its turn leaves it settled (row 104) | Test id: `packages/engine/test/board/wakes.test.ts`, "byte cap" |
| 3.9 | A fourth open post needing the owner's reply from one agent is refused | Test id: `packages/engine/test/board/wakes.test.ts`, "owner limit" |
| 3.10 | `board.close` by the author, the manager, the owner or a service withdraws the post and cleans its wakes; anyone else is refused | Test id: `packages/engine/test/board/wakes.test.ts`, "close" |
| 3.11 | A merged wake queues behind an engine prompt queued after the wake it replaced; `board.flush` with a never-sent board wake queued adds no delivery | Test id: `packages/engine/test/board/wakes.test.ts`, "merge order and flush" |
| 3.12 | A post naming its author or a service in `to`, a post from a service that needs a reply and names the owner, a 65th open must-reply post from one author, or a question to an interrupted agent that cannot reload, is refused; while the post is open, a reply from an addressee resolved `gone`, `undeliverable`, or `removed` and then re-added counts as `replied` | Test id: `packages/engine/test/board/wakes.test.ts`, "refusals and late replies" |
| 3.13 | A sixteen-addressee `all` collection whose replies are each 16,384 backslashes gives a completion under 64 KiB encoded, with every disposition and each deciding reply's id; an open `all` post that collects 2,048 short repeated replies before its last addressee answers gives a completion under 64 KiB, with at most 17 ids and the reply count; `board.read` with `repliesTo` returns every reply in pages; five such completions owed at once take at most 128 KiB of one wake, and the rest ride the next (row 111) | Test id: `packages/engine/test/board/wakes.test.ts`, "completion size" |
| 3.14 | `board.open` returns its channel id and `board.post` its post id through the real handler; a resent request id returns an equal reply and writes nothing; no planner's reply holds post text (row 107) | Test id: `packages/engine/test/board/handler.test.ts`, "planner replies" |
| 3.15 | A completion carried by a sent wake that is not yet accepted is not packed into a second wake built meanwhile; after that wake is returned, the next wake carries it; a replacement built after `resume --fresh` re-queued an accepted wake carries no discharged completion (row 115) | Test id: `packages/engine/test/board/wakes.test.ts`, "one copy of a completion" |
| 3.16 | `board.acknowledge` by an addressee writes one `board.PostAcknowledged` and marks the post read; a repeat, a closed post and an addressee with a disposition write nothing and are not refused; a non-addressee, a non-member and a post with `reply: none` are refused; a queued wake holding only that post is withdrawn with no replacement; a wake that also holds another question, a completion, a notice or a reminder is replaced and still delivers those, with the completion's debt untouched; a sent wake is not recalled; reading alone withdraws nothing, including after another question closes, is acknowledged or merges into the wake; deferred reactor replacement preserves the same original duty, and acceptance ends it; `holdsIncoming` does not change; `board.status`, `board.read` and the snapshot name who has acknowledged, and a reply counts (row 152) | Test ids: `packages/engine/test/board/wakes.test.ts`, "acknowledge", and `packages/engine/test/board/wake-replacement.test.ts` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 3a.1 | Planners for the six commands and reads for `board.channels` and `board.status`, each planner returning events and its `reply` | Greenfield `packages/engine/src/board/commands.ts`; pattern `packages/engine/src/routing/questions.ts`, `ask`, and `packages/engine/src/commands/internal.ts`, `Plan`, `refused` |
| 3a.2 | The wake builder, with its reminders, no-answer notices and fixed lines, the merge and cleanup rules, and the acknowledge cleanup | Greenfield `packages/engine/src/board/wake.ts`; markers drawn as in `packages/engine/src/routing/envelope.ts`, `envelope`; `escapeLeadingSlash`; the engine's wrapping is edit E15 |
| 3a.3 | A test that the board's source rule is "withdraw": a queued wake is withdrawn when its target stops or crashes, and never returned (B5; row 126) | The source-rule table in `packages/engine/src/routing/deliveries.ts` (edit E16); the engine's rule for a `wait` source is `packages/engine/src/routing/deliveries.ts`, `movedOrWake` |

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

Every reactor rule is a level rule (row 105): a condition over the
board's view and the engine's views, and the duty it owes while the
condition holds. A resume or a rejoin can land before the reactor's next
transaction, so a rule compares recorded sequences and does not only ask about
an agent's state now (row 143). "After the post" means that the event's sequence
is higher than the post's. It keeps no list of pending duties and no position. The reactor runs after every committed batch, over the
agents, channels and posts that batch touches, and over the whole state at
start-up and when the board is switched on. It keeps no position, so a
duty lost to a restart, or to a batch the engine refused, is found again by
the next run. It writes only through the piece batch path (edit E23),
recorded with the caller `piece { namespace: "board" }`, so its batches
pass the engine's reach, withdrawal, state-table and wait checks. It gives
that path a function from the views to its batch, so each batch is built
inside the writer's transaction, from the views the checks read, and a
reply that committed after an earlier run is never overridden (row 62).
A whole-state run writes one batch for each target, so one refusal holds
back only that target's duties, and no transaction spans the whole scan
(row 125). A refused batch is not written; the engine records one
`CommandRefused`, with the sequence of the batch the reactor was handling
or, in a whole-state run, of the views it read, and the reactor tries that
duty again only after a later batch touches it, or at start-up. A
`CommandRefused` touches nothing, so a refusal never starts another run.

The reactor follows the client API's rules for every reactor (section 1,
row 108; row 124). It starts only after `recovery.whenReady`, and the piece
batch path refuses its batch before then, so an interrupted agent that
recovery can still reload is never judged early. It writes no first-start
event, because it keeps no position. On `LogWriteFailed` it stops, and a
restart finds its duties by the whole-state run. A defect is logged at error
level with no event text, and the reactor restarts after a pause with a
whole-state run.

Unit 3b, lifecycle and delivery:

Lifecycle states (stopped, crashed, interrupted, reload failed) are
judged here only, never as leaving a channel (row 84).

- An addressee with no disposition that stopped, crashed or failed a reload
  after the post, even if it has since been resumed, or that is now interrupted
  with `reloadable !== true` (the engine's test at `waits.ts:55`), is resolved
  `gone` (rows 70, 143). An interrupt that a resume undoes counts for nothing,
  because the agent can still take its wake.
- An open post whose agent author stopped after the post, even if it has since
  been resumed, is withdrawn, with no completion; a completion already owed is
  dropped by the view's own fold of `AgentStopped` (rows 114, 143). The same
  comparison stops a later reply's close from owing a completion. A crashed
  author's posts stay open.
- A plain or group channel whose manager stopped after taking the seat, even if
  it has since been resumed, gets `board.ManagerChanged`, naming the nearest ancestor by `parent` links
  that is not stopped, not crashed and not interrupted with a session that
  cannot reload, or the owner (row 106). A crash moves nothing; the acting
  manager is computed at each check, never written.
- An owed completion that has not failed twice and that no queued or sent
  board wake carries is queued, while its target is neither stopped nor
  crashed and has no board wake queued or sent (rows 69, 92, 115, 125). The
  state guard matters: the piece batch path refuses a `DeliveryQueued` for a
  stopped or crashed target (edit E23, check 2). A `DeliveryWithdrawn` passes
  in every state.
- An open must-reply post that its addressee has not read, that no queued
  or sent board wake carries to it, and whose return count for that
  addressee is below two is queued, while the addressee is neither stopped
  nor crashed and has no board wake queued or sent (rows 104, 125). The guard keeps a full wake from being merged
  and cut again in a loop. This one rule re-queues
  after a return, after a send-time withdrawal (lead ruling L19), and for a
  post the byte cap left out.
- An addressee whose return count for an open post reaches two is
  resolved `undeliverable`; a completion that reaches two stops being
  queued (rows 46, 69). A wake returned after an accept counts toward
  nothing and is not re-queued (row 110).

Unit 3c, membership and reach:

- An addressee with no disposition that left the post's channel after the
  post, even if it has since rejoined, or that is not a member now, is resolved
  `removed`; an open post whose agent author left in the same way and did not
  stop after the post is withdrawn, owing the author a completion with that
  reason (rows 50, 143). For a plain channel, leaving is the removal in
  `board.ChannelMembersChanged`. For a group channel, it is losing the label,
  and it does not count for the anchor or the current manager, who are members
  without it.
- An open must-reply post in a direct channel whose grant fails now resolves
  its addressees `removed` (row 68). A grant is judged only as it stands now:
  if it lapses and returns before the reactor runs, the post stays open, because
  the addressee can still answer (row 143).
- A still-queued board wake that carries a post its target may no longer
  read is withdrawn and rebuilt by the per-post reach rule (row 67).

The hold-unsettled condition (edit E19, engine change B6, row 69): an agent is not
settled while it has an open post of its own that needs a reply, while it
has an owed completion that has not failed twice, or while it is an
addressee with no disposition of an open must-reply post that it has not
read and that no queued or sent board wake carries to it (rows 90, 104).
The condition reads the engine's delivery statuses from edit E19's input.
It also holds while the addressee's turn has ended since it took a question and the
reactor still owes it a reminder or a `no-answer`; once `no-answer` is written, it is
settled (row 153). The incoming condition (edit E20,
engine change B7, row 77): a blocking wait is cancelled with "request held" while its
waiter is an addressee with no disposition, or at `no-answer`, of an open post that
needs a reply.

**A question that gets no answer (row 153).** The contract's section of that name is the
rule. The reactor adds one reminder, one `no-answer` and one notice per post and target,
each a level rule over the sequences above, so a restart finds them again. There is no
timer. Its trigger is a turn's end: `TurnEnded` with `compact` false, which always follows
the accept of its own delivery (`packages/engine/src/runner/AcpRunner.ts:271-276`), or the
`DeliveryReturned` of an accepted board wake, which the engine's `failed` writes with
`StateChanged idle` and no `TurnEnded` (`packages/engine/src/routing/deliveries.ts:130-134`;
row 156). This needs no engine change.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 4.1 | Every row of the outcome table, in every order of reply, crash, resume and stop for two addressees, gives the table's result; an addressee interrupted with a session that cannot reload, and no reload attempt, is resolved `gone` at once, including at start-up catch-up; in a group channel, a labelled worker that crashes, is resumed and replies counts as `replied`, and a non-manager labelled author that crashes keeps its question open and receives its completion after resume; a lead with no label that crashes mid-collection keeps the collection open; when a resume or a rejoin commits before the reactor's next transaction, the table's result still holds: an addressee that crashed or stopped and was resumed is `gone`, and one removed and re-added is `removed`, and each may still upgrade to `replied` while the post is open; an author stopped and resumed has its post `withdrawn` with no completion, including when a reply closes it first; an author removed and re-added has its post `withdrawn` with a completion; a post written after the resume or the rejoin is not caught; a successful reload from an interrupt resolves nothing (row 143) | Test id: `packages/engine/test/board/reactor.test.ts`, "outcome orders" and "undone before the reactor" |
| 4.2 | An owed completion reaches its author once in each order: the close while the author is crashed; the close queued, then the author crashes before the send; the completion merged with a question that is then withdrawn | Test id: `packages/engine/test/board/reactor.test.ts`, "owed completion" |
| 4.3 | A board wake returned through the engine's real failed-send path carries the sender `piece { namespace: "board" }` in its `DeliveryReturned` (edit E15; row 109); it is re-queued once with its completions and open must-reply posts; a second return resolves the addressee `undeliverable`, or marks a completion "delivery failed", after which the agent goes idle and no third wake is queued until `board.flush`; a wake accepted and then returned is not re-queued and counts toward nothing (row 110); a waiter on the target is not told "settled" between the return and the re-queue | Test id: `packages/engine/test/board/reactor.test.ts`, "returned wake" (fake agent's error step) |
| 4.4 | An addressee removed from the channel, or losing the group label, is resolved `removed`, and a crash never is; its queued wake is rebuilt without that channel's posts; when a direct pair loses its last shared channel, its open question closes `unanswerable` and the asker is told; losing one of two shared channels changes nothing | Test id: `packages/engine/test/board/reactor.test.ts`, "leaving a channel" and "direct grant ends" |
| 4.5 | The reactor run twice on the same state writes each resolution and close once; a reply committed between two runs is not overridden; with the service stopped between each triggering commit and the reactor's write (a return, a member removal, the end of a direct grant, a send-time withdrawal, a manager's stop), every duty is done once after the restart; with the board switched off while a direct grant ends, switching it on resolves the grant's questions (row 105); a manager that stops and is resumed before the reactor's next transaction, with the reactor held back, across a restart, and with the board switched off for both transitions, loses its seat for good, its old post is withdrawn, and the live and rebuilt views are equal; the seat's new holder is unaffected by a stop from before it took the seat; running the reactor again writes nothing more (row 143) | Test id: `packages/engine/test/board/reactor.test.ts`, "twice is once", "racing reply" and "restart at every step" |
| 4.6 | An idle agent with an open post of its own that needs a reply is not settled; a paused or crashed one still resolves as the engine already does; an addressee that accepted its question, or read it with `board.read`, and ended its turn without replying is not settled until the reactor has written `no-answer`, and is settled then; an addressee whose only wake carrying a question was withdrawn at send is not settled until the reactor's next wake is queued (row 104); an addressee whose accepted wake carrying a question, or whose accepted reminder, is returned by an ordinary error is not settled until the reactor has queued its reminder or written `no-answer`, and an open capacity hold changes neither (row 156) | Test id: `packages/engine/test/board/settled.test.ts` (with a pause control case) |
| 4.7 | A blocking wait whose waiter is asked a board question by the agent it waits on returns "request held", whether the question came before or after the wait opened; a waiter resolved `removed` from that question is no longer held | Test id: `packages/engine/test/board/settled.test.ts`, "no deadlock" (edit E20) |
| 4.8 | With no board event in the log, neither board condition holds, so the engine's settled test and blocking waits behave as they did before engine changes B6 and B7 | Test id: `packages/engine/test/board/settled.test.ts`, "no board state"; `packages/engine/test/routing/waits.test.ts` and `acceptance/capability-05-wait.test.ts` keep their expectations |
| 4.9 | A label removed from a busy agent with a queued group wake: the dispatcher's send-time check withdraws the wake, goes on to the agent's next queued delivery, the reactor rebuilds the wake without that channel's posts, and the agent never receives them; the same holds with the board switched off; with one requeued wake that passes and one fresh wake that fails, only the failing one is withdrawn; a queued completion carrying reply text from a channel its author has left is withdrawn and rebuilt without the text; a withdrawn wake that carried only posts needing no reply ends a parent's open wait on its idle target in the withdrawal's batch (row 118, lead ruling L30); when a reactor's withdrawal leaves a reloaded target with nothing queued or sent, the batch holds `StateChanged idle` from the first step of `withWaitChecks` and the board's code returns no such event, and when the same batch queues a replacement it holds no `StateChanged idle` (row 134) | Test id: `packages/engine/test/board/reactor.test.ts`, "send-time reach" (lead rulings L19, L22, L23) |
| 4.10 | A reactor batch that would withdraw an engine delivery, or queue a wake with a post that fails reach, is refused by the piece batch path and nothing is written; the engine records one `CommandRefused { command: "board.reactor", reason, sourceSequence }` under `piece { namespace: "board" }`, and that refusal starts no further run; the reactor tries that duty again only after a later batch touches it; every reactor close, resolution and withdrawal is recorded with that caller, never the owner (rows 105, 119, 124) | Test id: `packages/engine/test/board/reactor.test.ts`, "write path" |
| 4.11 | With recovery held open, the board's reactor writes nothing; after `recovery.whenReady` it runs once over the whole state, and an agent that recovery reloaded in the meantime gets no `gone`; it writes no first-start event; with the writer made to fail, it stops on `LogWriteFailed` and writes nothing more, and a restart does each duty once; a defect is logged at error level with no event text, and the reactor runs again after a pause (row 124) | Test id: `packages/engine/test/board/reactor.test.ts`, "start and failure" |
| 4.12 | In normal running, the reactor and the planners never build a batch that check 2 of the piece batch path refuses: an owed completion whose author is crashed or stopped, and a question to one, queue no delivery and write no `CommandRefused`; the completion is queued after the crashed author's resume; a withdrawal of a wake whose target has stopped or crashed passes; `board.flush` for a stopped or crashed agent is refused with the engine's reason, and queues nothing (row 125) | Test id: `packages/engine/test/board/reactor.test.ts`, "state table" |
| 4.13 | For an unacknowledged and for an acknowledged question: a turn end queues exactly one reminder, durable across a restart; the next turn end writes `no-answer`, the addressee is settled, and the asker stays unsettled and is told once; an owner asker gets one `board.no-answer` alert and a service asker reads `board.status`; a late reply makes it `replied`; a stop, crash or leaving moves it from `no-answer` to `gone` or `removed`; in `any` mode a close withdraws the others' reminders; in `all` mode `no-answer` keeps the post open; a compact turn counts for nothing; acknowledging does not withdraw a reminder; a reminder returned twice gives `undeliverable` (row 153); an ordinary error after the question's accept queues the one reminder, and an ordinary error after the reminder's accept writes `no-answer`, each with no resend of the accepted wake and with the same result after a restart; an open capacity hold queues no reminder and writes no `no-answer`, and the carry-on's turn end then counts; a capacity error that returns the wake counts as a turn's end (row 156) | Test id: `packages/engine/test/board/reactor.test.ts`, "no answer" |
| 4.14 | No reminder goes to an addressee with an open post of its own, an owed completion or an open non-blocking wait, until that has ended and a further turn has ended; a paused or interrupted one gets none; two addressees that answer each other's notices write at most one reminder, one `no-answer` and one notice per post and target; running the reactor twice writes each once (row 153) | Test id: `packages/engine/test/board/reactor.test.ts`, "reminder bound" |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 3b.1 | The reactor's lifecycle and delivery rules, and the reminder, no-answer and notice rules, as level rules | Greenfield `packages/engine/src/board/reactor.ts`; the piece batch path `packages/engine/src/commands/pieceBatch.ts` (edit E23); its follower pattern `packages/engine/src/accounts/available.ts`, `followAvailability`, without its direct `append`; the engine's crash and resume rules in `packages/engine/src/routing/waits.ts` (suspended waits) and `packages/contracts/src/stateMachine.ts`, `commandOutcome` |
| 3b.2 | The two conditions and their table entries (B6, B7) | Greenfield `packages/contracts/src/board/conditions.ts`; the tables of edits E19 and E20, in `packages/contracts/src/settled.ts` and `packages/engine/src/routing/waits.ts` |
| 3b.3 | The reactor's place in the service (B8) | `packages/engine/src/service.ts`, where edit E6 starts piece reactors; today's followers start at `packages/engine/src/commands/CommandHandler.ts:179-181` |
| 3c.1 | The reactor's membership, direct-grant and reach rules | `packages/engine/src/board/reactor.ts`; group membership from `packages/engine/src/views/apply.ts`, `AgentRow.groups` and `AgentRow.parent`; the interrupted test from `packages/engine/src/routing/waits.ts:55`; recovery in `packages/engine/src/recovery/restart.ts`, `reloadInterrupted` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| The reactor writes a resolution twice after a restart | Medium | Each rule is a level rule, idempotent on the view; criterion 4.5 |
| A level rule runs over many items after each batch | Low | It runs only over what the batch touches; the whole state only at start-up and switch-on |
| A text that was already sent reaches an agent that just left the channel | Medium | Accepted and stated (row 50): sent text cannot be recalled; a wake still queued is stopped at send (row 67) |
| The reach-check inputs differ from what criteria 2.11 and 4.9 assume | Medium | They are in edit E18 at `5ceb503` (L23, rows 98, 120, 121); a later difference goes to the lead |
| A question to a live agent that never answers keeps its author unsettled | Medium | `board.close` repairs it; catching a silent agent is the sheepdog's job; `board.status` shows whom the author waits on |
| Engine change B6 makes a `wait` on a board author last longer than before | Medium | Intended (rows 33, 99); criterion 4.8 shows nothing changes without board state; criterion 4.6 has a pause control case; criterion 1.7 tests the conditions as pure functions |

**Verify:** `packages/engine/test/board/reactor.test.ts`, `settled.test.ts`; the engine suite, with the tests that engine changes B6 to B8 name keeping their expectations. Device or environment QA: none.

**WS-5: One door for agents, the owner and Shephrd's own code**

Adds the board's reads and snapshot entry to the engine's tables (engine
change B9), so with B1 its commands become MCP tools, CLI subcommands and
client calls with no code of their own; adds the "board disabled" switch
(row 58); and writes the board's `snapshotFor` entry (edit E9, rows 51 and
71): absent for agents, and for the owner and services a bounded
summary with no post text.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 5.1 | Each board planner runs with caller identity, a receipt and one transaction, and a repeated request id acts once; each board read checks the caller's current access on every request and is never deduplicated (rows 107, 108) | Test id: `packages/engine/test/board/handler.test.ts`, "identity, receipts, one transaction" |
| 5.2 | An invalid or stopped agent's token is refused for every board command | Test id: `packages/engine/test/board/handler.test.ts`, "bad credentials" |
| 5.3 | Agents get `board.open`, `board.members`, `board.post`, `board.close`, `board.acknowledge`, `board.read`, `board.channels` and `board.status` as tools, and never `board.flush`; the pinned list of MCP tools names exactly those eight for the board (rows 134, 152) | Test ids: `packages/engine/test/board/tools.test.ts`; `packages/contracts/test/commands.test.ts` |
| 5.4 | `shephrd --help` lists the nine `board` subcommands | Command: `./bin/shephrd --help`; `packages/cli/test/parity.test.ts` passes |
| 5.5 | A post from a service records the service's name as its author; no socket caller can set a service author | Test id: `packages/engine/test/board/handler.test.ts`, "service author" |
| 5.6 | `board.status` answers the owner, a service, the agent's holder and the agent itself, and refuses anyone else; its reply holds ids, counts and states only, so a holder that is in none of the agent's channels gets no post text and no channel name; its default summary has a fixed size and carries both condition results and its sequence; its `detail` lists come in pages under 512 KiB encoded, so 3,072 incoming questions for one agent stay under the client API's 900 KiB page budget | Test id: `packages/engine/test/board/handler.test.ts`, "status access" |
| 5.7 | A post from a logged-in web session records the owner as author (row 149) | Test id: `packages/engine/test/board/handler.test.ts`, "web post" |
| 5.8 | A `board.read` page closes at 512 KiB of encoded text, and always holds at least one item | Test id: `packages/engine/test/board/handler.test.ts`, "page byte cap" |
| 5.9 | An agent's `client.snapshot` holds no board section; after 1,000 posts of the largest size, the owner's board section holds no post text and stays under 256 KiB encoded; it always starts with the agents for which each condition holds and `ownerHeld`, equal to the full view's results at the sequence of the one views value it read (edit E9); a section marked `truncated` is completed by the paged `board.channels` and `board.status`; `board.status` with no agent returns both condition lists and `ownerHeld` at one sequence, for the owner and services only, and builds them from one views value, so its sequence is that value's own and at a batch's end, including while publication is held open between a commit and the views' update; before the helper ends the wait for any reason, it makes that read, applies the stream up to its sequence and decides again (row 135); with the board's `snapshotFor` made to throw, the snapshot marks the section as failed, and the owner's wait still ends correctly through that read (row 136); the helper reads `board.status` at open, when the engine's part says settled, and when its stream shows `board.PostWritten`, `board.AddresseeResolved` or `board.PostClosed`; an agent that posts a question to the owner and stays working ends the wait at once with exit 2; a stopped or crashed agent on the list follows the member table; and the helper does not end on an older list after the owner has answered (rows 123, 130); the owner's wait helper ends only when the engine's part and the board's lists agree at one sequence: a return with no board event in its batch does not end the owner's wait, an accepted completion ends it with no later board event, and in each case the owner's wait ends when an agent's `wait` on the same target would (row 103) | Test ids: `packages/engine/test/board/handler.test.ts`, "snapshot section" (edit E9), and the client helper's test, "board results stay fresh" |
| 5.10 | With the board switched off, every board command but `board.status` is refused with "board disabled" on both transports, never "command refused"; `board.status` and the snapshot section say `disabled` with empty condition lists and an empty `ownerHeld`, so the owner's wait and an agent's wait agree; the reactor and conditions stop; the reach check stays in force for the dispatcher; the service still rebuilds a log that holds board events; switching the board on runs the reactor once over the whole state (rows 116, 117) | Test id: `packages/engine/test/board/disabled.test.ts` |
| 5.11 | `board.read` writes no receipt: after 1,000 reads of the largest page, the receipts table holds no post text; a read whose reply is lost, followed by the caller's removal from the channel and a resend of the same request id, is refused; its `board.Read` marks are written as the caller with no receipt, and writing them twice changes nothing; a `board.post` receipt holds the batch and a reply of ids only, and is scanned like the post's events for registered secrets (row 108, which amends row 75) | Test id: `packages/engine/test/board/handler.test.ts`, "receipts" |
| 5.12 | `board.channels` pages under 512 KiB encoded with 2,000 channels; `board.read` with `repliesTo` is refused to a non-member of the post's channel | Test id: `packages/engine/test/board/handler.test.ts`, "paged lists" |
| 5.13 | `board.read` with `post` returns that one post, open or closed, with its channel id, author, `to`, reply mode, `replyTo` and state, to a member of its channel and to the owner; a non-member and an unknown id are refused; it marks only that post read, and no other (row 122) | Test id: `packages/engine/test/board/handler.test.ts`, "one post" |
| 5.14 | A wake whose `PromptSent` encodes to over 256 KiB reaches `client.subscribe` as a `client.Oversized` marker, for the owner and for its target; `client.event` and `client.thread` return it whole to the owner, and to its target inside the data envelope; the engine's `subscribe` is unchanged; no board event is ever replaced by a marker (rows 127, 133) | Test id: `packages/engine/test/board/handler.test.ts`, "oversized wake" |
| 5.15 | `openMatters` returns, for each open post that needs the owner's reply, the same key, kind, agent and subject that `boardAlertSources` gives for its `board.PostWritten`; it returns nothing for a closed post or a post that needs no owner's reply; it reads the rebuilt views, not the bounded snapshot section, so it is whole when the section is `truncated` (row 131) | Test id: `packages/engine/test/board/open-matters.test.ts` |
| 5.16 | An agent's `board.read` reply is `{ requestId, data }`, with `data` built by `agentReadReply`: a fresh marker, an escaped leading slash, and the JSON of the owner's reply between the engine's lines; the MCP tool and the CLI return it unchanged; the owner and a service get the plain reply; a page of posts of 16,384 quotes closes at 512 KiB measured on the wrapped string, under the 900 KiB page budget (row 154) | Test id: `packages/engine/test/board/handler.test.ts`, "labelled page" |
| 5.17 | `boardAlertSources` raises one `board.no-answer` alert, keyed `no-answer:<postId>`, from the `board.AddresseeResolved` of an owner's post, and ends it at `board.PostClosed`; `openMatters` returns the same for an open post in that state; the title comes from the fixed table (row 153) | Test id: `packages/engine/test/board/handler.test.ts`, "no-answer alert" |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 5.1 | The board's reads, with an agent's `board.read` wrapped by `agentReadReply` (row 154), and snapshot entry (B9), with the largest section added to the client API's snapshot size fixture | `packages/engine/src/api/reads.ts` (edit E4) and `packages/engine/src/api/snapshot.ts` (edit E9); `packages/engine/test/client/snapshot-size.test.ts` |
| 5.2 | Tool descriptions and CLI summaries, built in unit 1 (row 158); this unit checks them | `packages/mcp/src/tools.ts`, `descriptions`, and `packages/cli/src/commands/registry.ts`, `summaries` (edit E10) |
| 5.3 | The "board disabled" switch | Greenfield `packages/engine/src/board/switch.ts`; a setting read at start-up |
| 5.4 | `openMatters` and its line in the client API's table (B12) | Greenfield `packages/engine/src/board/openMatters.ts`; client API section 4, "The alert's life" |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A board command skips the receipt or identity step | High | Every board planner runs in the engine's one command handler (edit E3); criteria 5.1, 5.2; attack pass |
| A service author can be forged from the socket | High | The service path is in-process only; criterion 5.5 |
| An agent reads every direct message through `client.snapshot` | High | Criterion 5.9; row 51 |
| The owner's snapshot passes the client API's 4 MiB budget | High | No post text in the section, a 256 KiB cap and a `truncated` fallback to `board.status` (rows 71, 83); criterion 5.9 |
| A rollback to a build without the board cannot read the log | Medium | Rollback is the switch, not removal (row 58); criterion 5.10 |

**Verify:** the test ids above; the engine's CLI and MCP parity tests. Device or environment QA: rollout step 6, one `shephrd board post` from the owner's terminal against a fresh `/tmp` service, which wakes a fake agent.

**WS-6: Proof that the board needs nothing else**

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 6.1 | The epic's line: in a channel of four, a question to one wakes that one only, and the reply wakes the asker only | Test id: `packages/engine/test/acceptance/board-wakes-only-addressee.test.ts` |
| 6.2 | A lead's hand-off in `all` mode to three workers wakes the lead once; with one worker crashed and resumed midway, it still closes | Test id: `packages/engine/test/acceptance/board-collection.test.ts` |
| 6.3 | No `board.*` event and no board snapshot section reaches any agent's `subscribe`, `client.subscribe`, `client.event` or `client.snapshot`; an unrelated agent cannot get a direct message through `board.read`, `board.status`, `board.channels` or another agent's thread; as a positive control, the member and its parent see the member's own thread, which may quote the message (row 81); after a label removal that the dispatcher's send-time check catches, the withdrawn wake's text appears in none of the target's or its parent's `subscribe`, `client.subscribe`, `client.thread`, `client.event` or `client.snapshot`, and, as a positive control, the owner's `client.thread` of the target holds it, because edit E21's thread column includes a `DeliveryQueued`'s target (rows 113, 121) | Test id: `packages/engine/test/acceptance/board-privacy.test.ts` |
| 6.4 | No file under `packages/engine/src/board/` imports from `packages/engine/src/runner/` or `log/EventLog.ts`, reads `runMode`, or builds a `DeliveryQueued` itself (edit E23's boundary test covers the folder); a channel with one agent recorded as `interactive` behaves the same | Test id: `packages/engine/test/board/mode-independence.test.ts` |
| 6.5 | A service killed after a post and before its wake is sent delivers the wake once after restart; one killed after the send without replay proof may deliver it twice, and the board still holds one logical wake; an addressee on a harness that cannot reload is resolved `gone` after the restart, and its asker is told | Test id: `packages/engine/test/acceptance/board-restart.test.ts` (three cases) |
| 6.6 | `pnpm check` passes, and the only existing test files that changed are those the engine-change table names, each keeping its expectations for what the engine already does | Command: `pnpm check` exits 0; `git diff --stat <client API unit 1b merge> -- 'packages/*/test'` lists only new board files and the files the table names |
| 6.7 | Withdraw and replace a board wake while the target's capacity queue is held, across a restart, and then withdraw the last queued wake (logic Sol's R3-PB-05). The replacement stays behind the hold, and nothing is sent to the target while the hold is open, even once the queue is empty; a wait on the target does not end until the hold is released, because an open hold keeps its agent unsettled in the engine's part of the settled test, while the board's lists for it are empty; a release with an empty queue then ends that wait (rows 141, 142; client API row 177). At each complete-state boundary, the persisted events, the rebuilt views, the engine's wait result and the owner's wait helper agree. The same steps with no hold are the control: the target settles once its last wake is withdrawn, including from the reloaded state (row 138) | Test id: `packages/engine/test/acceptance/board-capacity-hold.test.ts`. Unit 5 writes the control. The held cases need `DeliveryHeld` from the roles plan's WS-7b, so whichever of unit 5 and that plan's unit 11b is built second adds them |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 6.1 | The acceptance files | `packages/engine/test/acceptance/`, pattern `flow-start-to-finish.test.ts`; harness `packages/engine/test/support/acceptance.ts`, `World`, `Spec` |
| 6.2 | Fake-agent scripts for posting, replying, ending turns and failing a turn | `packages/testing/src/fakeAgent.ts`, `Script`, `Step` (its `exec` step runs `shephrd board post` with the agent's token) |
| 6.3 | The import and `runMode` scan | Greenfield `packages/engine/test/board/mode-independence.test.ts` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| The fake agent cannot call a board command mid-turn | Medium | Its `exec` step runs the `shephrd` tool with the agent's token; the unit reports a gap if it cannot |
| The interactive check proves too little, since no interactive runner exists | Medium | Accepted: the check proves the board never branches on mode (row 24) |

**Verify:** the criteria above. Device or environment QA: WS-5's terminal check.

**WS-7: Reading and answering a post on the phone**

The board's entry in the thread page's subject panel (client API section 4,
"The subject panel"; row 122; engine change B11). One unit, 6. It depends on
the client API's units 7b (the panel), 6a (the alert reactor and its first-start
scan) and 6b (the carrier), so it is always the second to be built, and it connects the entry
to the panel's table. An alert has a link only while proxy mode is on and a
public address is set (client API section 4), so the browser test sets both.
It also sets the web password and logs in, because without a session the page
gets no API request answered (row 149).

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 7.1 | The panel shows the alert's fixed title and a button for a board subject, and sends no command until the owner taps | Test id: `packages/web/test/subjects/board.test.tsx`, "no read before a tap" |
| 7.2 | A tap sends one `board.read` with `post`; a planted `<img src=x onerror=...>`, a `javascript:` link and Markdown in a post are shown as text and run nothing; the author is shown by fixed words and its id | Test id: `packages/web/test/subjects/board.test.tsx`, "post is text" |
| 7.3 | A reply sends one `board.post` with the post's channel id and `replyTo`; a double tap acts once; a closed post shows its state and no reply box; a refusal, such as "board disabled", shows the reason and keeps the typed reply | Test id: `packages/web/test/subjects/board.test.tsx`, "reply" |
| 7.4 | End to end, in a real browser with the fake agent and a fake carrier: an agent posts a question to the owner; a notification arrives with no post text; following its link opens the author's thread and writes no `board.Read`; a tap reads the post; a reply closes the post `answered`; `client.AlertCleared` ends the alert; and the fake agent is woken once with its completion | Test id: `packages/web/e2e/board-alert.spec.ts` (Playwright; the client API's row 112 gives this test to the board's plan) |
| 7.5 | A post that is open and needs the owner's reply before the alert reactor's first start gets a `baseline` alert through the board's real `openMatters`; it is never pushed; and the post's close clears it (row 131) | Test id: `packages/engine/test/board/alert-baseline.test.ts` |
| 7.6 | The entry shows who has acknowledged a post and who has given no answer; a `board.no-answer` alert opens the addressee's thread with the same entry (rows 152, 153) | Test id: `packages/web/test/subjects/board.test.tsx`, "state" |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 6.1 | The entry and its line in the panel's table (B11) | Target `packages/web/src/thread/subjects/board.tsx`; the panel from client API unit 7b, `packages/web/src/thread/`; calls through `packages/client/src/browser.ts` (edit E26) |
| 6.2 | The unit tests and the end-to-end test | `packages/web/test/subjects/board.test.tsx`; `packages/web/e2e/board-alert.spec.ts`, on the flow of client API unit 11, `packages/web/e2e/`; fake agent `packages/testing/src/fakeAgent.ts` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| An agent's post runs as code in the owner's page | High | Criterion 7.2; React text rendering only; the page's content security policy from client API criterion 5.10; an attack pass on unit 6 |
| Opening a link marks a post as read | Medium | Criteria 7.1 and 7.4: the read runs only on a tap |
| The client API's thread page differs from what this unit assumes | Medium | The unit re-reads the panel's table at the commit the lead names; a difference goes to the lead |
| The panel is not reachable when the owner has no public address | Low | Accepted: the alerts page opens the same thread (client API criterion 7.7), and the owner's terminal has `shephrd board read` and `shephrd board post` |

**Verify:** the two test ids above, and client API criterion 7.13. Device or environment QA: the owner follows one real notification on the phone in client API unit 11's owner check, if this unit has landed by then.

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
   projected with the same batch, and every reactor batch goes through the
   piece batch path and its wait checks (edit E23; logic review, L-PB2 and
   L-PB3; round 4, V4-2).
6. A harness's own login token, from the account's shadow home, is
   removed from stored posts and wakes (TM-3; SECURITY.md rule 6).
7. A wake carries only posts from channels its target belongs to, both
   when it is queued and when it is sent (TM-5). The send-time half is the
   dispatcher's re-check under lead ruling L19; this check proves it
   under load, against a label change racing the dispatcher.
8. No `author` or `service` field in a socket or network payload is
   honoured, for agent tokens and web sessions, on both transports
   (TM-6, SEC-BOARD-3).
9. The largest wake event and the largest `board.read` page, built from
   posts of quotes, backslashes, 4-byte characters, and control characters
   sent before removal, fit the client API's 900 KiB page budget with the
   full envelope, and the wake event reaches `client.subscribe` as a marker
   when it passes 256 KiB (TM-7, C2-05, R2-TM-3; rows 127, 133).
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
15. The reach check at queue time sees the batch's own `board.WakeBuilt`, by its source id,
    and at send time judges only the wake it is given (logic M3, T3-1).
16. After `resume --fresh` of an agent removed from a channel since its
    last accepted board wake, the re-sent wake is withdrawn at send and
    never reaches the runner (round 3's TM3-2; round 4, V4-5).
17. A wake withdrawn at send never appears, by its text, in the target's
    or its parent's `subscribe`, `client.subscribe`, `client.thread`,
    `client.event` or `client.snapshot`, under real agent tokens (round 3's TM3-3;
    criterion 6.3).
18. The service killed between each triggering commit and the reactor's
    write does every duty once after the restart, and a reactor batch made
    to fail edit E17 or E18 is retried on a later batch, never dropped and
    never written (L4-PB2, L4-PB3, TM4-1).
19. The owner's `shephrd client wait` and an agent's `wait` on the same
    target end at the same sequence, through a return, an accepted
    completion, and a truncated first section (L4-PB1, R4-PB-3, C4-PB6).
20. A post whose text holds a planted `<img src=x onerror=...>`, a
    `javascript:` link and Markdown, read through the board's panel in a
    real browser, runs nothing, and opening the alert's link writes no
    `board.Read` (row 122).
21. PB-R7-1. Through the real runner-event handler, an ordinary error after a wake's accept,
    with and without an acknowledgement, before and after the reminder's accept, and a
    restart after each error batch: the log, the rebuilt view, `board.status`, the engine's
    wait and the owner's helper agree, with no early settling and no reminder held for ever.
22. PB-R7-2. A kill between the reminder's building, queueing, accept, turn's end,
    `no-answer`, the notice's queueing and its accept, with each reactor run repeated: at most
    one accepted reminder and one notice per post and target, with late replies and races
    with a stop, a crash and a leaving, and rebuilt views equal to live ones.
23. PB-R7-3. Acknowledging an original-only wake, a mixed wake, a returned wake and a wake
    behind a capacity hold: the question goes, other duties and the hold stay, no reminder is
    removed, no sent wake is recalled, and the engine's and the owner's waits are right at
    every complete batch, in both reply modes.
24. PB-R7-4. Each deferral condition held open, then finished with its response turn: no
    early reminder or `no-answer`. The mutual-question case runs with the sheepdog on, as a
    control, with no other board reminder rule.
25. PB-R7-5. The owner's wait across a turn's end and `board.AddresseeResolved`, with a status
    result and a stream at one sequence; live and first-start `board.no-answer` alerts for a
    post with several silent addressees: one key, the intended thread, cleared at the close.
26. PB-R7-6. The final encoded `{ requestId, data }` frame, with escaping and the envelope,
    for pages of quotes, backslashes, control characters and multibyte text: the 512 KiB cap
    and the 900 KiB budget hold, cursors and marks cover only the returned items, and
    `agentReadReply`, fresh markers and unchanged tool and CLI output hold.

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
(board post #142); (l) round 4's 41 findings in the lead's ten groups, and
lead ruling L28 (`attack/round-4-findings.md`); (m) the client API contract
version 8 (`04e1f83`), the lead's list of what to fold
(`api-v8-for-pieces.md`, post #212), lead ruling L31 (post #217), and version
9 (`5ceb503`, post #221); (n) the client API contract version 10 (`a7f1c9f`)
and the lead's list (`api-v10-for-pieces.md`, post #229); (o) the client API
contract version 11 (`3bd2358`) and the lead's list (`api-v11-for-pieces.md`,
post #240); (p) the final review round's major finding, its minors, and the
lead's rulings (`attack/round-5-findings.md`, `final-round-rulings.md`, post
#266); (q) the owner's one web password, the lead's rulings
(`password-login-rulings.md`, post #301), and the client API contract version
15 (`668a341`, post #310); (r) the short final check's major finding
(`attack/round-6-findings.md`, post #325), with the client API contract version
16 (`220a433`, post #330); (s) the owner's change before acceptance, its rulings
(`owner-q12-change.md`, `q12-ack-rulings.md`, post #360), and the client API
contract version 17 (`b38aa6f`); (t) the logic review of that change and the lead's
ruling (`attack/round-7-findings.md`, `q12-r7-ruling.md`, post #365).

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
| (l) Round 4 findings and ruling L28 | per group in `attack/round-4-findings.md` | every finding folded as rows 102 to 120; contract v7 and four client API changes approved as L30 |
| (m) Edits E2, E3, E5, E9, E11 to E13, E15, E21, E24 to E28 | row 121 | folded, or stated not to touch the board |
| (m) E19 and section 3: `ownerHeld` | WS-1 (1.7), WS-5 (5.9, 5.10) | agreed and planned (row 123) |
| (m) Row 112: the subject panel entry, its read on a tap, its reply and its test | WS-7 (7.1 to 7.4), WS-5 (5.13) | agreed and planned (row 122) |
| (m) Alert sources name a kind, never a title | WS-1 (1.6) | planned (row 122) |
| (m) E6 and section 1: reactor rules; E23: batch built in the transaction, check 2, refusal table | WS-4 (4.10, 4.11, 4.12) | planned (rows 124, 125) |
| (m) E16: the source rule's one question | WS-3 (3a.3), B5 | corrected (row 126) |
| (m) Message budgets, criterion 2.6 | WS-1 (1.11), WS-5 (5.1, 5.14) | checked: the board fits (row 127) |
| (n) Ruling 6: when the owner's wait reads `ownerHeld` | WS-5 (5.9) | folded with the lead's text; no tag to add (row 130) |
| (n) Ruling 7: `openMatters` | WS-5 (5.15), WS-7 (7.5), B12 | folded with the lead's text (row 131) |
| (n) Row 147: `board.WakeBuilt` names the source id | WS-1 (1.2), WS-2 (2.1, 2.11), WS-3 | folded (row 132) |
| (n) Row 137: the largest event against the page budget | WS-1 (1.11), WS-5 (5.14) | folded; the wake is unchanged (row 133) |
| (n) E1 and E2 pin, E17 and E18 reloaded state | WS-5 (5.3), WS-4 (4.9), B1 | folded (row 134) |
| (n) E12, E19, E23's worker row, E27, and the items for the roles plan | row 129 | stated not to touch the board |
| (o) Ruling 1: `client.event` for an agent | contract, WS-5 (5.14), WS-6 (6.3) | folded word for word (row 135) |
| (o) Ruling 2: one gate before any end | contract, WS-5 (5.9) | folded word for word (row 135) |
| (o) Ruling 4: `guardPiece`; a reducer reads only the event and the sequence | contract, the engine-change section, WS-2 (2.12) | folded word for word (row 136) |
| (o) Row 173: where the reloaded-state rule runs | contract, WS-4 (4.9) | folded (row 137) |
| (o) Logic Sol's R3-PB-05 | WS-6 (6.7) | planned, in two parts (row 138) |
| (o) Rulings 3, 5 and 6, rows 166, 171 and 172, `client.sequence` | row 139 | stated, with their text, not to change the board |
| (p) R5-A1, C5-01, R5-L1, R5-TM-1 | WS-2 (2.1), WS-4 (4.1, 4.5) | folded in the lead's shape (row 143) |
| (p) Re-anchor to engine `9e386b0` | conventions, B8, B13, task 3b.3, criterion 3.7 | done; no design changes (rows 144, 145) |
| (p) C5-03 | `attack/known-gaps.md` | minor, not folded, by the lead's ruling |
| (p) R5-A2, C5-02 | row (s) | closed by the owner's change (rows 152, 154) |
| (q) One web password; no devices | contract, access; WS-2 (2.8), WS-5 (5.6, 5.7, 5.9), WS-7, B9, post-build check 8 | folded; no rule of the board changes (rows 149, 150) |
| (r) R6-L1 | B13, WS-3 (3.7), contract's event section | folded (row 151) |
| (s) Acknowledge | B5, B13, WS-1, WS-3 (3.16), WS-5 (5.3, 5.4), WS-7 (7.6) | planned (row 152) |
| (s) A question that gets no answer | WS-1, WS-2 (the view), WS-3, WS-4 (4.6, 4.7, 4.13, 4.14), WS-5 (5.17) | planned (row 153) |
| (s) Label the text, R5-A2 | WS-5 (5.16) | planned (row 154) |
| (t) R7-L1 | WS-2 (the view), WS-4 (4.6, 4.13), contract's rule | folded (row 156) |
| (t) PB-R7-1 to PB-R7-6 | Post-build checks 21 to 26 | proposed (row 156) |

</details>

<details><summary><b>Guardrails triggered (gate 9)</b></summary>

| Repo rule (CLAUDE.md etc.) | How this plan satisfies it |
|---|---|
| `AGENTS.md` rule 1: push only to `qnlbnsl/sheprd` | The plan's branch is pushed to `origin` only |
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
| 4 Reads, snapshot, doors and switch | backend | board/backend | medium | The board's reads and snapshot entry in the engine's tables (B9), which with B1 give the tools, CLI and transports. | yes | 3c, and the client API plan's unit 3, for `client.subscribe`, `client.thread` and the wait helper |
| 5 Acceptance suite | backend | board/backend | medium | Five acceptance files and one restart file on the existing harness, plus one scan. | no | 4 |
| 6 The board's entry on the thread page | mobile-ui | board/web | medium | One panel entry and one Playwright flow on the client API's page, rendering untrusted text as text. | yes | 4, and the client API plan's units 6b and 7b |

Scopes: `board/contracts` would edit `packages/contracts/src/board/**`,
`packages/contracts/test/board/**`, and the board's lines in
`packages/contracts/src/commands.ts`, `events.ts`, `visibility.ts` and
`settled.ts` and in `packages/contracts/test/events-roundtrip.test.ts`.
`board/backend` would edit `packages/engine/src/board/**`,
`packages/engine/test/board/**`, the board's entries in the engine files
that engine changes B3 to B10, B12 and B13 name, the test fixtures B3 names,
`packages/engine/test/acceptance/board-*`, `packages/mcp/src/tools.ts`,
`packages/cli/src/commands/registry.ts` and `packages/testing/**`.
`board/web` would edit `packages/web/src/thread/subjects/board.tsx`, the
board's line in the panel's table, `packages/web/test/subjects/**`,
`packages/web/e2e/board-alert.spec.ts` and
`packages/engine/test/board/alert-baseline.test.ts`.
`board/contracts` also edits the board's lines in
`packages/contracts/test/commands.test.ts`.
None exists under `.plans/scopes/` yet; the lead runs the scoping skill
for all three before launch (known gap 5).

Load: 9 build units, 33 launches (9 × 3 for builder, test writer and
review, plus 6 attack passes). Every unit that changes what the engine
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
| 4 | 0 / 22 / 19 | Six reviews of plan v5 (`attack/plan-v5.md`) and contract v6 (`attack/contract-v6.md`), all grade 6, in the lead's ten groups. Groups 5, 6, 7 and 9, and the reactor's write path, were shared gaps fixed in client API contract v4 (`8e80a13`). Folded into plan v6 as rows 102 to 120. Contract v7 and four client API changes asked as Q6 (post #171) and approved as L30 (post #172); the client API changes are in its v5 at `09018d6`. Details: `attack/round-4-findings.md`. |
| Client API v8 fold | none | Not a review round. Plan v6 (`attack/plan-v6.md`) and contract v7 (`attack/contract-v7.md`) folded client API contract v8 at `04e1f83` (post #212), as plan v7 and contract v8 (rows 121 to 128). Both additions are agreed: `ownerHeld`, and the subject panel entry with its test. Two more board contract changes and two client API points were asked as Q7 (post #216) and approved as L31 (post #217); the client API points are in its v9 at `5ceb503` (post #221). |
| Client API v10 fold | none | Not a review round of the board. Plan v7 (`attack/plan-v7.md`) and contract v8 (`attack/contract-v8.md`) folded client API contract v10 at `a7f1c9f` (post #229), as plan v8 and contract v9 (rows 129 to 134). |
| Client API v11 fold | none | Not a review round of the board. Plan v8 (`attack/plan-v8.md`) and contract v9 (`attack/contract-v9.md`) folded client API contract v11 at `3bd2358` (post #240), as plan v9 and contract v10 (rows 135 to 139), with logic Sol's R3-PB-05 as criterion 6.7. Client API v12 at `8a34e59` (post #258) changes only citations here (row 142). |
| 5 | 0 / 4 / 3 | Four Codex Sol reviews of `a5e8eb3`, grade 7, no refusals. The four majors are one finding. Folded as plan v10 and contract v11 under the lead's ruling (post #266; row 143), with the engine re-anchored to `9e386b0` (rows 144, 145). Minors are not folded, by the lead's ruling, and are listed in `attack/known-gaps.md`. Details: `attack/round-5-findings.md`. |
| Password login fold | none | Not a review round. Plan v10 (`attack/plan-v10.md`) and contract v11 (`attack/contract-v11.md`) became plan v11 and contract v12: the words about devices go, under the lead's rulings (post #301; rows 149, 150). |
| 6 | 0 / 1 / 0 | One Codex Sol logic check of plan v11 (`attack/plan-v11.md`) and contract v12 (`attack/contract-v12.md`), grade 7, no refusals. Its major, R6-L1, is folded as plan v12 and contract v13 (row 151; `attack/round-6-findings.md`). |
| Acknowledge fold | none | Not a review round. Plan v12 (`attack/plan-v12.md`) and contract v13 (`attack/contract-v13.md`) became plan v13 and contract v14, at the owner's request before accepting (post #360; rows 152 to 155). |
| 7 | 0 / 1 / 0 | One Codex Sol logic review of the acknowledge change, grade 7, no refusals. Its major, R7-L1, is folded as plan v14 and contract v15 (row 156; `attack/round-7-findings.md`), with plan v13 and contract v14 kept as `attack/plan-v13.md` and `attack/contract-v14.md`. No further review, by the lead's ruling. |

</details>
