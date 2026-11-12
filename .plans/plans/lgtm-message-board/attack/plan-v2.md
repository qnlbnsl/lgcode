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
take it, in order, through the same interface for every kind of agent.
Posts that need no answer wake nobody; the agent gets them with its next
real wake, or when it reads the channel.

There is one material uncertainty. The engine's design says the other
pieces are built on it "without changing it". The extension point is an
addition to the engine: nothing the engine does today changes, and every
existing engine test passes unchanged. The lead has sent that reading to
the owner as one question covering the client API and the board, and this
plan assumes the owner agrees. If the owner refuses, the board cannot be
built as planned, and the plan is rewritten.

The first review round found no blockers and 33 major problems. Most were
gaps in what happens when things change under a message: a question closes
while other wakes for it are still waiting, an agent leaves a channel, an
agent crashes and is resumed, or a delivery fails. This version gives each
of those one written rule. It also tightens who may wake whom, because the
first version let an agent wake a sibling with wider permissions than its
own, and let a channel bound to a group label take in agents from anywhere
in the tree.

The board knows nothing about teams, roles or workflows, because those do
not belong in LGTM Studio. The roles plan, piece 4, decides which channels
exist and who is in them. This plan's `contract.md` answers each of the
roles plan's seven requests: four accepted as asked, two accepted in
another form, and one refused, with the reason.

## Key decisions

**Who is woken.** A post either needs a reply or does not. One that needs a
reply names its addressees and wakes exactly them. One that does not wakes
nobody, ever, and there is no timer that wakes for it later. When the
question closes, the asker is woken once with the answers, so nobody has
to check back. A post that needs no reply may sit unread until the agent's
next real wake; the roles plan can force an early hand-over with the
"flush" command.

**Who may wake whom.** A channel's members may wake each other, but only
inside rules that keep the engine's own limits. An agent may not ask for a
reply from an agent with wider permissions than its own, unless that agent
is its own parent or grandparent, which the engine already lets it ask. A
channel that follows a group label takes in only the agents under the
channel's opener, unless the owner opened it. A direct-message pair keeps
its right to talk only while the reason for it still holds.

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
asker is woken once with every answer and every reason. The asker, a
channel manager, the owner or LGTM Studio's own code can also withdraw a
question. When a question closes, any of its wakes still waiting are
removed, so nobody spends a turn on a closed question.

**An agent waiting for a board answer is not finished.** If a lead asks
another lead a question and ends its turn, anyone waiting on the first lead
is not woken until its question closes. An agent that is itself being
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
questions open at once.

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

The board's eight commands and seven events get their own shared
definitions package, which every client and the engine read. The risk is a
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
crashes, is resumed, or leaves a channel, and a delivery that fails. Each
case has one rule in the plan's outcome table. The risk is a question that
never closes, or a closed one that wakes someone; tests replay every order
of reply, crash and resume. When done, a crashed and resumed worker never
strands its lead's question.

### One door for agents, the owner and LGTM Studio's own code

The board's commands become LGTM Studio tools for agents, `lgtm board …`
commands for the owner's terminal, and calls for the web page and the
phone, all through the extension point with no door of their own. The risk
is a new door that skips a check; the board's commands go through the
engine's one command handler. When done, a real `lgtm board post` from
the terminal wakes an agent.

### Proof that the board needs nothing else

An acceptance suite drives every main board rule through the public
connection only, with real agent tokens and the fake agent. One check
proves the board never looks at how an agent is run. When done, `pnpm
check` passes with the old engine suite unchanged and the new board suite
added.

## Rollout order

1. **The engine's extension point, from the client API plan.** The board
   registers through it, so nothing of the board can start before it. The
   new packages are registered with the build and the test runner in the
   same step.
2. **Shared definitions.** Every later unit compiles against them, and the
   roles plan reads them too.
3. **The board's picture and its rules.** These are pure functions over the
   log, testable without a running agent.
4. **Posts and wakes,** then **the reactor** for changes under them.
5. **The doors,** including the switch that turns the board off.
6. **The acceptance suite.** It runs last, through the doors, and it must
   pass with every existing engine test unchanged. The owner then runs one
   `lgtm board post` from the terminal.

The work lands on a branch from `engine` after the extension point merges.
Once the board writes its first event, the log needs the board's
definitions to be read; from then on, rollback means switching the board
off, not removing it.

---
<!-- ⛔ implementation details and gate evidence below; owner overview is complete -->

<details><summary><b>Implementation details (gates 2, 3, 5, 6, 8)</b></summary>

Conventions for every unit. Paths are relative to the LGTM Studio repository
root. Engine anchors come from `scouting.md` (scans at `8ff4c9b`) and the
round-1 reviews (`attack/round-1-*.md`). "The seam" is the extension point
in the client API contract (`.plans/plans/lgtm-client-api/contract.md`,
sections 1 to 3 and 6, frozen as v2 at `75ab185` with the addendum
`cd1d836`, items 13 and 14, item 15 at `d72fe26`, and items 16 and 17 at
`296b1c3`; rows 42, 61, 63); "seam item N" is that contract's section 6,
item N. The board's own contract is `contract.md`, version 3 (row 63). Greenfield anchors give
the target path and the neighbouring pattern file; every unit re-reads the
frozen contract before it starts. A "test id" is a Vitest file path, run
with `pnpm vitest run <path>`. "Rows" are rows in this plan's
`decisions.md`. RPC means remote procedure call: one request and its reply.
ACP is the Agent Client Protocol, through which the engine drives agents.
MCP means the Model Context Protocol, through which agents get LGTM Studio's
tools. Effect code is written from Effect 4.0.5's current documentation,
looked up, never from memory (`AGENTS.md`, "Language"); this plan names no
Effect function that the engine or the client API contract does not already
name. No unit edits `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`
or `vitest.config.ts`; the two new packages' manifests, workspace entries
and test-runner projects are a dependency (known gap 5). Every unit reports
problems and feature ideas to the lead, who writes `docs/issues.md` and
`docs/features.md` in the same integrated change (row 60). Every unit keeps
the regression gate: `pnpm check` passes, and no existing test file under
`packages/*/test/` is edited.

The board's code lives in two new packages: `packages/board-contracts`
(schemas; pattern `packages/contracts/src/`) and `packages/board`
(handlers, view, reactor, wake builder; pattern
`packages/engine/src/routing/`). `packages/board` depends only on
`packages/contracts`, `packages/board-contracts` and the seam's exported
helpers, never on `packages/engine/src/runner/`. Tests live in
`packages/board/test/` and `packages/board-contracts/test/`, and the
acceptance tests in `packages/engine/test/acceptance/board-*.test.ts`
(pattern `flow-start-to-finish.test.ts`), or wherever the seam unit puts
the composed service's acceptance harness.

**The outcome table (row 49).** Used by the post handler, `board.close` and
the reactor, as one pure function in `packages/board/src/outcome.ts`.

| Event for one addressee | Its disposition |
|---|---|
| It replies in the same channel | `replied` |
| It stops, crashes, or is interrupted and cannot reload | `gone` (a later resume does not undo it) |
| It leaves the channel | `removed` |
| Its board wake for this post is returned twice | `undeliverable` |
| It pauses | none; the post waits |

| Post event | Result |
|---|---|
| `any` mode, first `replied` | closes `answered` |
| `all` mode, every addressee has a disposition, at least one `replied` | closes `answered` |
| Either mode, every addressee has a disposition, none `replied` | closes `unanswerable` |
| The owner replies | closes `answered` |
| `board.close` | closes `withdrawn` |
| The author stops, or leaves the channel | closes `withdrawn` |
| The author crashes, or is interrupted and cannot reload | stays open; a close owed to it is queued when it is next idle |

At every close except `withdrawn`, the author, if it is an agent, is woken
once with every reply and every addressee's disposition. At every close,
the post's demand is removed from every still-queued board wake (row 47).

**WS-1: One shared definition of the board's commands and events**

Defines the board's ids, events, commands, access table, visibility table,
alert source and exported pure conditions. Fields follow `contract.md`.
Names follow the seam's namespace rule: commands `board.<name>`, event tags
`board.<PascalName>`.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 1.1 | `ChannelId`, `PostId`, `WakeId` are branded ids; `ReplyMode` is `none`, `any` or `all`; `BoardAuthor` is owner, agent or service; `Disposition` is `replied`, `gone`, `removed` or `undeliverable`; a close outcome is `answered`, `unanswerable` or `withdrawn` | Test id: `packages/board-contracts/test/schemas.test.ts`, "ids, modes, authors, outcomes" |
| 1.2 | `board.ChannelOpened`, `board.ChannelMembersChanged`, `board.PostWritten`, `board.AddresseeResolved`, `board.PostClosed`, `board.WakeBuilt` and `board.Read` round-trip unchanged | Test id: `packages/board-contracts/test/schemas.test.ts`, "events round-trip" |
| 1.3 | Every board event is `owner-only` in `boardVisibility`, and no board event has a top-level `agentId` field | Test id: `packages/board-contracts/test/schemas.test.ts`, "hidden from agents" |
| 1.4 | `boardAccess` matches `contract.md`'s command table: `board.flush` has no `agent`; `service` appears only on `board.post`, `board.close`, `board.status` and `board.flush` | Test id: `packages/board-contracts/test/schemas.test.ts`, "access table" |
| 1.5 | A post's text refuses more than 16,384 characters; `to` refuses more than 16 addressees; a channel name refuses a non-slug or more than 64 characters | Test id: `packages/board-contracts/test/schemas.test.ts`, "limits" |
| 1.6 | `boardAlertSources` raises kind `board.post` with key `post:<postId>` for a post that needs the owner's reply, and ends it on `board.PostClosed` | Test id: `packages/board-contracts/test/alerts.test.ts` |
| 1.7 | `holdsUnsettled(agentId, boardSection)` and `holdsIncoming(agentId, boardSection)` are exported pure functions (row 51) | Test id: `packages/board-contracts/test/conditions.test.ts` |
| 1.8 | Every command and event name in the composed API is unique | The seam's uniqueness test in `packages/api` passes with the board registered |
| 1.9 | The test runner runs both new packages' tests | Command: `pnpm vitest list` lists files under `packages/board-contracts/test/` and `packages/board/test/` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 1a | Ids, `ReplyMode`, `BoardAuthor`, `Disposition`, outcomes | Greenfield `packages/board-contracts/src/ids.ts`; pattern `packages/contracts/src/ids.ts`, `AgentId` |
| 1b | The seven events, as `BoardEvent` | Greenfield `packages/board-contracts/src/events.ts`; pattern `packages/contracts/src/events.ts`, `QuestionAsked` |
| 1c | The eight commands, as `BoardRpcGroup`, prefixed `board.` | Greenfield `packages/board-contracts/src/commands.ts`; pattern `packages/contracts/src/commands.ts`, `CommandsRpcGroup` |
| 1d | `boardAccess`, `boardVisibility`, `boardAlertSources`, `holdsUnsettled`, `holdsIncoming` | Greenfield `packages/board-contracts/src/index.ts`; shapes from the client API contract, section 1 and section 4 |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A board event visible to agents would show a direct message to the author's parent | High | Criterion 1.3; the field is named `author`, never `agentId` |
| The seam's frozen shape, or its round-1 additions, differ from what this plan assumes | Medium | Every unit re-reads the client API contract at the commit the lead names; differences go to the lead |
| The new packages are not built or tested by the root check | Medium | Criterion 1.9; known gap 5 |

**Verify:** the three test ids above, the seam's uniqueness test, and `pnpm vitest list`. Device or environment QA: none.

**WS-2: Channels, members and who may reach whom**

The board's view, rebuilt from the log, and the pure rules that decide who
may open, add, post, read and wake. Two units: 2a the view, 2b the rules.

The view (`packages/board/src/view.ts`) holds: channels (id, name, manager,
explicit members, optional group label, opener kind owner or agent, kind
plain, group or direct); posts (id, channel, author, text, `to`, reply
mode, `replyTo`, each addressee's disposition, replies, status open or
closed with its outcome, and whether a close is owed to a crashed author);
read state per member and channel (a watermark plus post ids read above
it, row 48); the wake index from `board.WakeBuilt` (wake id, delivery id,
target, carried posts, must-reply posts); and the reactor's last handled
sequence. Delivery status is never stored: it is read from the engine's
deliveries view (row 46). A group channel's members are computed from the
engine's agents view at read time by row 45's rule.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 2.1 | `boardAfter` folds every board event and the engine's `DeliveryAccepted` for a board wake, and ignores every other event | Test id: `packages/board/test/view.test.ts`, "fold" |
| 2.2 | The board's view rebuilt from the log alone equals the live view after every board test | The seam's rebuild check covers piece views (seam item 4); `pnpm vitest run packages/board/test` exits 0 |
| 2.3 | Accepting a wake marks exactly its carried posts read; a `board.Read` marks exactly its page; the watermark moves forward only over a contiguous run; paging back never unreads a post | Test id: `packages/board/test/view.test.ts`, "read state" (cases: 25 unread plus a question, wake carries 21; read an old page; restart) |
| 2.4 | An agent can add to a plain channel only an agent it holds and its own holder; every other add is refused | Test id: `packages/board/test/access.test.ts`, "adding members" (child, parent, sibling refused, cousin refused, owner adds anyone) |
| 2.5 | A manager's rights pass to its holder when it stops or crashes | Test id: `packages/board/test/access.test.ts`, "manager rights pass up" |
| 2.6 | An agent-opened group channel admits only label carriers whose holder chain passes through its manager; an owner-opened one admits every carrier; an agent cannot bind a label that no agent in its subtree carries; a carrier in another subtree, whether started with the label or given it by `group`, is not a member | Test id: `packages/board/test/access.test.ts`, "group channels" |
| 2.7 | A direct channel opens, and each later post in it is allowed, only while the pair is holder and held, shares a non-direct channel, or includes the owner; after one side leaves the shared channel, the next post is refused | Test id: `packages/board/test/access.test.ts`, "direct channels" |
| 2.8 | A non-member cannot read or post in a channel; the owner and every device can; a service can post but not read | Test id: `packages/board/test/access.test.ts`, "read and post" |
| 2.9 | A post that needs a reply from an agent with a wider permission level than its author is refused, unless that agent is the author's ancestor | Test id: `packages/board/test/access.test.ts`, "ceiling" |
| 2.10 | A `replyTo` naming a post in another channel, or sent by a caller no longer in the channel, is refused before anything is written | Test id: `packages/board/test/access.test.ts`, "reply stays in its channel" |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 2a.1 | `emptyBoard` and `boardAfter(state, envelope)`, registered as the board's view | Greenfield `packages/board/src/view.ts`; pattern `packages/engine/src/views/apply.ts`, `deliveriesAfter`, `emptyViews`; registration through seam item 1 |
| 2a.2 | The outcome function | Greenfield `packages/board/src/outcome.ts` (the outcome table above) |
| 2b.1 | Authority and reach rules as pure functions over the engine snapshot and the board's view | Greenfield `packages/board/src/access.ts`; uses the seam's rights helper (seam item 8), which wraps `packages/engine/src/routing/holders.ts`, `holderAbove`; the permission levels from `packages/contracts/src/permission.ts` and `packages/engine/src/identity/ceiling.ts` |
| 2b.2 | The reach check registered under seam item 15 (rows 45, 61) | Greenfield `packages/board/src/reach.ts` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| An authority rule lets an agent read or wake outside its reach | High | Criteria 2.4 to 2.10 each test the forbidden case; unit 2b takes an attack pass |
| The ceiling rule blocks a real flow, such as a read-only reviewer asking a builder sibling | Medium | The reviewer can post without needing a reply, or ask its parent; the rule is the engine's own ceiling (row 45) |
| The seam's reach check differs from row 45 | Medium | Seam item 15 at `d72fe26` matches it (row 61); a later difference goes to the lead |

**Verify:** `packages/board/test/view.test.ts`, `packages/board/test/access.test.ts`, the seam's rebuild check. Device or environment QA: none.

**WS-3: Posts that wake only the agent that must answer**

The `board.post` and `board.close` handlers, the wake builder, merging and
cleanup. One unit, 3a.

How a post is planned, inside the seam's command transaction (seam item
3): check access and reach (2b) and the owner-question limit (row 54);
refuse a post that needs a reply with no addressee, or to a stopped or
crashed addressee; return `board.PostWritten`; if it replies to an open
post in the same channel from an addressee, return
`board.AddresseeResolved` (`replied`), and, if the outcome function closes
the post, `board.PostClosed`; compute the wake set (agents only: the
addressees of a post that needs a reply, minus the author, plus the asker
of any post this one closed, minus any stopped or crashed agent; a crashed
asker's close is marked owed); for every post that just closed, remove its
demand from every still-queued board wake (row 47); for each agent in the
wake set, if it has a board wake that is queued and was never sent,
withdraw it (seam item 13); then return one `DeliveryQueued` through the
delivery helper (seam item 14) with source `{ namespace: "board", id:
<wake id> }` and sender label `board`, and in the same batch
`board.WakeBuilt` naming its carried posts. A wake that was sent and
requeued keeps its place; new posts for that agent go into one other wake
(row 46). A merged or replaced wake is a new delivery, so it goes to the
back of the target's queue (row 62). `board.flush` is a no-op when the
target already has a never-sent board wake queued (row 62).

The body is plain text, at most 256 KiB of UTF-8 (row 53). It carries, in
order: every must-reply post, then the oldest unread posts that need no
reply, up to 20, then a count of the rest. Each post is a header line
built only from fixed words and the engine-authenticated id (rows 52, 63:
`owner`, `service <name>` or `agent <id>`, never an agent-chosen name),
its channel id and name,
its reply mode and its state, then the post's text between fresh random
markers, with a leading slash escaped. The engine wraps the whole body in
its agent-text envelope.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 3.1 | In a channel of four agents, a post needing a reply from one queues exactly one delivery, to that one | Test id: `packages/board/test/wakes.test.ts`, "wakes only the addressee" |
| 3.2 | A post needing no reply queues no delivery for anyone | Test id: `packages/board/test/wakes.test.ts`, "no reply, no wake" |
| 3.3 | `any` and `all` modes close by the outcome table, and the asker is woken once at the close with every reply and disposition | Test id: `packages/board/test/wakes.test.ts`, "outcome table" (one case per row) |
| 3.4 | Three posts for one idle-target agent while its never-sent wake is queued leave one queued board wake carrying all three; a requeued wake keeps its place and is not merged; a sent wake is not withdrawn; a paused target is the control case, with its wake left queued and merged in the same way | Test id: `packages/board/test/wakes.test.ts`, "wakes merge" |
| 3.5 | When a question closes, a queued wake carrying only it is withdrawn, and a queued wake carrying it and another open question is replaced by one carrying only the other | Test id: `packages/board/test/wakes.test.ts`, "closed questions leave the queue" |
| 3.6 | The wake reaches the agent inside the engine's envelope; each post sits between its own fresh markers with a leading slash escaped; an agent named with a line break, `owner`, a service's name or a copied marker cannot change a header, because no agent-chosen name appears in it; a reactor-built wake names each post's original author | Test id: `packages/board/test/wakes.test.ts`, "text is data" |
| 3.7 | A secret registered with the redactor never appears in a stored post or wake | Test id: `packages/board/test/wakes.test.ts`, "redacted" |
| 3.8 | A wake body never exceeds 256 KiB; posts past the cap stay open and unread and are counted in the body | Test id: `packages/board/test/wakes.test.ts`, "byte cap" |
| 3.9 | A fourth open post needing the owner's reply from one agent is refused | Test id: `packages/board/test/wakes.test.ts`, "owner limit" |
| 3.10 | `board.close` by the author, the manager, the owner or a service withdraws the post and cleans its wakes; anyone else is refused | Test id: `packages/board/test/wakes.test.ts`, "close" |
| 3.11 | A merged wake queues behind an engine prompt queued after the wake it replaced; `board.flush` with a never-sent board wake queued adds no delivery | Test id: `packages/board/test/wakes.test.ts`, "merge order and flush" |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 3a.1 | Handlers for all eight commands, each returning events | Greenfield `packages/board/src/commands.ts`; pattern `packages/engine/src/routing/questions.ts`, `ask`, and `packages/engine/src/commands/internal.ts`, `Plan`, `refused` |
| 3a.2 | The wake builder and the merge and cleanup rules | Greenfield `packages/board/src/wake.ts`; markers drawn as in `packages/engine/src/routing/envelope.ts`, `envelope`; `escapeLeadingSlash`; the engine's wrapping is seam item 14 |
| 3a.3 | The board's rule for its wake when the target stops or crashes: withdraw, never return | Registered through seam item 11; the engine's rule for a `wait` source is `packages/engine/src/routing/deliveries.ts`, `movedOrWake` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A merge or cleanup withdraws a wake the dispatcher is about to send | High | The dispatcher writes `DeliverySent` in its own transaction before calling the runner (`deliveries.ts:dispatchQueued`); the handler withdraws only a wake the engine's deliveries view shows still queued in the same snapshot. Criteria 3.4, 3.5; post-build check 1 |
| A wake already sent costs its target a turn on a question that closed meanwhile | Low | Accepted (row 47); the wake's header names each post's state when built |
| A replaced requeued wake loses its head place in the queue | Low | Accepted (row 47) |
| A busy agent's wake waits for its turn to end | Low | Accepted: ACP cannot add to a running turn |

**Verify:** `packages/board/test/wakes.test.ts`; the unchanged engine suite. Device or environment QA: none.

**WS-4: What happens when agents and channels change**

The reactor (seam item 1, "reactors") and the two registered conditions.
Two units: 3b lifecycle, 3c membership.

The reactor reads committed events in order, writes through the seam's
transaction path, records its last handled sequence, and is safe to run
twice. Before each write it re-reads the post's status in its own
transaction's snapshot, so a reply that committed after the reactor read
its event is never overridden (row 62). Unit 3b: on an addressee's `AgentStopped`, `AgentCrashed`, or
`AgentReloadFailed` while interrupted, it resolves that addressee `gone`;
on the author's stop it withdraws the author's open posts; on the author's
crash it does nothing but mark them suspended; when a crashed author is
next idle, it queues every close owed to it; on `DeliveryReturned` for a
board wake, it re-queues one fresh wake with the still-open must-reply
posts, and on a second return for the same post and target it resolves
that addressee `undeliverable` (row 46). Unit 3c: on
`board.ChannelMembersChanged`, and on `AgentStarted` or `AgentGrouped`
that changes a group channel's computed members, it resolves a leaving
addressee `removed`, withdraws a leaving author's posts in that channel,
and withdraws and rebuilds the leaving agent's still-queued board wakes
without that channel's posts (row 50).

The hold-unsettled condition (seam item 12): an agent with an open post of
its own that needs a reply is not settled. The incoming condition (seam item
16, row 51): a blocking wait is cancelled with "request held" while its
waiter is an addressee of an open post that needs its reply and that it
has not answered.

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 4.1 | Every row of the outcome table, in every order of reply, crash, resume and stop for two addressees, gives the table's result | Test id: `packages/board/test/reactor.test.ts`, "outcome orders" |
| 4.2 | A crashed author's question that closes while it is crashed wakes it once when it is resumed and idle | Test id: `packages/board/test/reactor.test.ts`, "owed close" |
| 4.3 | A returned board wake is re-queued once; a second return resolves the addressee `undeliverable` | Test id: `packages/board/test/reactor.test.ts`, "returned wake" (fake agent's error step) |
| 4.4 | An addressee removed from the channel, or losing the group label, is resolved `removed`; its queued wake is rebuilt without that channel's posts | Test id: `packages/board/test/reactor.test.ts`, "leaving a channel" |
| 4.5 | The reactor run twice on the same events writes each resolution and close once; a reply committed between the reactor's read and its write is not overridden | Test id: `packages/board/test/reactor.test.ts`, "twice is once" and "racing reply" |
| 4.6 | An idle agent with an open post of its own that needs a reply is not settled; a paused or crashed one still resolves as the engine already does | Test id: `packages/board/test/settled.test.ts` (with a pause control case) |
| 4.7 | A blocking wait whose waiter is asked a board question by the agent it waits on returns "request held", whether the question came before or after the wait opened | Test id: `packages/board/test/settled.test.ts`, "no deadlock" (seam item 16) |
| 4.8 | With the board not registered, the engine's settled test and blocking waits behave exactly as today | The engine's existing wait tests under `packages/engine/test/routing/` pass unchanged |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 3b.1 | The reactor's lifecycle rules | Greenfield `packages/board/src/reactor.ts`; pattern `packages/engine/src/accounts/available.ts`, `followAvailability`; the engine's crash and resume rules in `packages/engine/src/routing/waits.ts` (suspended waits) and `packages/contracts/src/stateMachine.ts`, `commandOutcome` |
| 3b.2 | The two conditions | Greenfield `packages/board/src/settled.ts`; seam items 12 and 16; the engine's `holds` in `packages/engine/src/routing/waits.ts` |
| 3c.1 | The reactor's membership rules | `packages/board/src/reactor.ts`; group membership from `packages/engine/src/views/apply.ts`, `AgentRow.groups` |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| The reactor writes a resolution twice after a restart | Medium | Each write is idempotent on the view; criterion 4.5 |
| A text that was already sent reaches an agent that just left the channel | Medium | Accepted and stated (row 50): sent text cannot be recalled |
| A question to a live agent that never answers keeps its author unsettled | Medium | `board.close` repairs it; catching a silent agent is the stall watch's job; `board.status` shows whom the author waits on |
| The seam's settled test moves into the engine's contracts package, and the board's condition reads only its own snapshot section | Medium | Criterion 4.8 keeps the engine's wait tests unchanged; criterion 1.7 tests the conditions as pure functions |

**Verify:** `packages/board/test/reactor.test.ts`, `settled.test.ts`; the unchanged engine suite. Device or environment QA: none.

**WS-5: One door for agents, the owner and LGTM Studio's own code**

Registers the board with the seam, so its commands become MCP tools, CLI
subcommands and client calls with no code of their own; adds the
"board disabled" switch (row 58); and gives the seam the board's snapshot
section through the seam's `snapshotFor` hook (seam item 17, row 51).

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 5.1 | Each board command runs with caller identity, a receipt and one transaction; a repeated request id acts once | Test id: `packages/board/test/handler.test.ts`, "identity, receipts, one transaction" |
| 5.2 | An invalid or stopped agent's token is refused for every board command | Test id: `packages/board/test/handler.test.ts`, "bad credentials" |
| 5.3 | Agents get `board.open`, `board.members`, `board.post`, `board.close`, `board.read`, `board.channels` and `board.status` as tools, and never `board.flush` | Test id: `packages/board/test/tools.test.ts` |
| 5.4 | `lgtm --help` lists the eight `board` subcommands | Command: `./bin/lgtm --help`; the seam's CLI parity test passes |
| 5.5 | A post from a service records the service's name as its author; no socket caller can set a service author | Test id: `packages/board/test/handler.test.ts`, "service author" |
| 5.6 | `board.status` answers the owner, a device, a service, the agent's holder and the agent itself, and refuses anyone else | Test id: `packages/board/test/handler.test.ts`, "status access" |
| 5.7 | A post from a paired device records the owner as author and the device in the envelope's `device` field | Test id: `packages/board/test/handler.test.ts`, "device post" |
| 5.8 | A `board.read` page closes at 512 KiB of encoded text | Test id: `packages/board/test/handler.test.ts`, "page byte cap" |
| 5.9 | An agent's `client.snapshot` holds no board section; the owner's holds the board's view | Test id: `packages/board/test/handler.test.ts`, "snapshot section" (seam item 17) |
| 5.10 | With the board switched off, every board command is refused with "board disabled", the reactor and conditions stop, and the service still rebuilds a log that holds board events | Test id: `packages/board/test/disabled.test.ts` |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 5.1 | The board's piece registration | Greenfield `packages/board/src/piece.ts`; registry from seam item 1; the composed service where the seam unit builds it (today `packages/engine/src/service.ts`, `program`) |
| 5.2 | Tool descriptions and CLI summaries | Wherever the seam keeps them; today's patterns `packages/mcp/src/tools.ts`, `descriptions`, and `packages/cli/src/commands/registry.ts`, `summaries` |
| 5.3 | The "board disabled" switch | Greenfield `packages/board/src/piece.ts`; a setting read at start-up |

**Risks:**

| Risk | Severity | Mitigation |
|---|---|---|
| A board command skips the receipt or identity step | High | The seam runs every piece command through the engine's handler; criteria 5.1, 5.2; attack pass |
| A service author can be forged from the socket | High | The service path is in-process only; criterion 5.5 |
| An agent reads every direct message through `client.snapshot` | High | Criterion 5.9; row 51 |
| A rollback to a build without the board cannot read the log | Medium | Rollback is the switch, not removal (row 58); criterion 5.10 |

**Verify:** the test ids above; the seam's CLI and MCP parity tests. Device or environment QA: rollout step 6, one `lgtm board post` from the owner's terminal against a fresh `/tmp` service, which wakes a fake agent.

**WS-6: Proof that the board needs nothing else**

**Done when:**

| # | Criterion | Observed by (test id / command / on-device step) |
|---|---|---|
| 6.1 | The epic's line: in a channel of four, a question to one wakes that one only, and the reply wakes the asker only | Test id: `packages/engine/test/acceptance/board-wakes-only-addressee.test.ts` |
| 6.2 | A lead's hand-off in `all` mode to three workers wakes the lead once; with one worker crashed and resumed midway, it still closes | Test id: `packages/engine/test/acceptance/board-collection.test.ts` |
| 6.3 | A direct message is refused to a non-member on `board.read`, and never appears in any agent's `subscribe`, `client.subscribe` or `client.snapshot` reply | Test id: `packages/engine/test/acceptance/board-privacy.test.ts` |
| 6.4 | No file under `packages/board/src/` imports from `packages/engine/src/runner/` or reads `runMode`; a channel with one agent recorded as `interactive` behaves the same | Test id: `packages/board/test/mode-independence.test.ts` |
| 6.5 | A service killed after a post and before its wake is sent delivers the wake once after restart; one killed after the send without replay proof may deliver it twice, and the board still holds one logical wake | Test id: `packages/engine/test/acceptance/board-restart.test.ts` (two cases) |
| 6.6 | Every existing engine test passes unchanged | Command: `pnpm check` exits 0; `git diff --stat <seam merge> -- packages/engine/test packages/contracts/test` lists only new `board-*` files |

**Tasks:**

| # | Task | Anchor (file + symbol; line optional) |
|---|---|---|
| 6.1 | The four acceptance files | `packages/engine/test/acceptance/`, pattern `flow-start-to-finish.test.ts`; harness `packages/engine/test/support/acceptance.ts`, `World`, `Spec` |
| 6.2 | Fake-agent scripts for posting, replying, ending turns and failing a turn | `packages/testing/src/fakeAgent.ts`, `Script`, `Step` (its `exec` step runs `lgtm board post` with the agent's token) |
| 6.3 | The import and `runMode` scan | Greenfield `packages/board/test/mode-independence.test.ts` |

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
4. Seam item 13 lets a piece withdraw only a still-queued delivery whose
   source is its own namespace (threat review, TM-4).
5. The engine's wait checks judge the board's conditions on the board view
   projected with the same batch, and every reactor write goes through the
   engine's wait checks, as `CommandHandler.ts` and
   `accounts/available.ts` do (logic review, L-PB2 and L-PB3).
6. A harness's own login token, from the account's shadow home, is
   removed from stored posts and wakes (TM-3; SECURITY.md rule 6).
7. A wake carries only posts from channels its target belongs to, both
   when it is queued and when it is sent (TM-5).
8. No `author` or `service` field in a socket or network payload is
   honoured, for agent tokens and device credentials, on both transports
   (TM-6, SEC-BOARD-3).
9. The largest wake event and the largest `board.read` page, built from
   posts of 4-byte characters, each stay under the network listener's
   message limit (TM-7).
10. An owner alert for a board post carries no post text (SEC-BOARD-5).
11. Kills after the queue commit, after a send with replay proof, and after
    a receipt without replay proof each give one logical wake, with
    external sends as the engine allows (ARCH-PB-6; criterion 6.5).

</details>

<details><summary><b>Traceability (gate 4)</b></summary>

Source universe: (a) the epic row 3 and its "Done when" line on wakes;
(b) `docs/features.md` section 2, its five items; (c) the roles plan's
seven requests (`requests.md`, "From the message board"); (d) `AGENTS.md`,
"How agents are run"; (e) SECURITY.md rules 6 and 7; (f) the Synapse list
items on channels, labels and waking (items 1 to 11, 13, 17, 19, 22);
(g) the client API contract's answers to the board's six needs (its
section 7); (h) round 1's 49 findings (`attack/round-1-findings.md`).

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
| Engine design: pieces build on the engine without changing it | Rows 9, 32, 33, 51, 63; the regression gate |
| Engine design: the permission ceiling | Row 45 (d), criterion 2.9 |
| Run rule 6: no `package.json` or lock edits | Conventions paragraph; known gap 5 |

</details>

<details><summary><b>Execution sizing (gate 10)</b></summary>

Models come from the harness-sessions plugin's model sheet (its harness-session skill)
at launch; this section names none (owner, 2026-10-16).

| Unit | Work area | Scope | Complexity | Why this complexity | Attack pass | Depends on |
|---|---|---|---|---|---|---|
| 1 Board contracts | contracts | board/contracts | medium | New schemas whose shapes `contract.md` fixes, on the seam's piece pattern. | no | the seam unit; package and test-runner setup (known gap 5) |
| 2a Board view and outcome function | backend | board/backend | medium | Pure fold functions and one pure table. | no | 1 |
| 2b Access and reach rules | backend | board/backend | high | Authorization: who may read, reach and wake whom, including the ceiling. | yes | 2a |
| 3a Posts, wakes, merge and cleanup | backend | board/backend | high | Wakes merged and cleaned inside one transaction, racing the dispatcher. | no | 2b |
| 3b Reactor: lifecycle and conditions | backend | board/backend | high | Interacting crash, resume, stop and return rules, run idempotently. | no | 3a |
| 3c Reactor: membership changes | backend | board/backend | medium | One rule set on 3b's reactor pattern. | no | 3b |
| 4 Registration, doors and switch | backend | board/backend | medium | Registration with the seam, which gives the tools, CLI and transports. | yes | 3c |
| 5 Acceptance suite | backend | board/backend | medium | Four acceptance files and one restart file on the existing harness, plus one scan. | no | 4 |

Scopes: `board/contracts` would edit `packages/board-contracts/**`, and
`board/backend` would edit `packages/board/**`,
`packages/engine/test/acceptance/board-*` and `packages/testing/**`.
Neither exists under `.plans/scopes/` yet; the lead runs the scoping skill
for both before launch (known gap 5).

Load: 8 build units, 26 launches (8 × 3 for builder, test writer and
review, plus 2 attack passes). The lead looks up each unit's builder and
test writer from the sheet at launch and checks each vendor's remaining
weekly allowance first; the planner cannot read it (known gap 1).

</details>

<details><summary><b>Attack log (gate 7 — M/L only)</b></summary>

| Round | New findings (B/M/m) | Outcome |
|---|---|---|
| 1 | 0 / 33 / 16 | Six reviews, grades 6 to 7. Folded into plan v2 as rows 44 to 62. Seam needs approved by the lead (L15, post #69). Contract change asked as Q3 (post #73) and approved as L16 (post #75); `contract.md` is version 3. Details: `attack/round-1-findings.md`. |

</details>
