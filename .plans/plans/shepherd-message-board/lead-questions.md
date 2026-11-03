# Questions and requests sent to plans-lead

Each entry is posted to `plans-lead` on the board, one question at a time.
Its answer is logged in `decisions.md` before the next question is sent.

## Q1 (decision row 9): may the board add to the engine's code?

**The question.** The engine's design says the other pieces are "built on
top of the engine without changing it". The board cannot be built without
editing some engine files. May the board's plan add to the engine, if it
changes no existing behaviour?

**Why it cannot be avoided.** Scouting at `8ff4c9b` found three closed
lists (see `scouting.md`):

1. The command handler serves a fixed set of commands
   (`CommandHandler.ts:supported` and the `planCommand` switch). A board
   command such as "post" needs an entry there to reach the engine's caller
   identity, receipts and log transaction.
2. The log's event list is a closed union (`contracts/src/events.ts:Event`),
   and the log writer decodes each written event against it
   (`EventLog.ts`, about line 182). A "post written" event needs a new tag.
3. Only the owner or an agent's parent may `prompt` an agent. A worker's
   question to its lead's sibling, or a lead's reply to its parent, needs
   the board to queue a delivery itself, in the same transaction as the
   post. The delivery's `source` list (permission, question, wait) needs a
   `post` case so a wake for a stopped agent is withdrawn, not bounced.

**The alternative, and why it fails.** A separate board process that talks
to the engine as a client would need the owner's credential to prompt
arbitrary agents. It would then act as the owner (the impersonation that
Synapse's `synapse-owner.sh` was criticised for), its prompts would skip the
engine's agent-text envelope, and it could not check which agent is calling
it, because the engine has no "verify this token" command.

**Recommendation.** Allow additive changes only, defined as: no existing
command, event, state, reply, rule or test changes; new commands, event
tags, a new delivery source and one new follower are added; every existing
engine test, including the acceptance suite and the rebuild check, passes
unchanged. The board's own code lives in a new folder,
`packages/engine/src/board/`, with its own reducer, so the engine's eight
views and their reducers are untouched. The client API plan likely meets
the same question for pairing commands, so one ruling could cover both.

**If the answer is no.** The board cannot be built as one plan. The engine
would first need a general extension seam (registered command planners,
event schemas and reducers), planned and reviewed as an engine change.

## R1: what the board needs from the client API's contract

Sent as a request so it lands in `.plans/plans/shepherd-client-api/contract.md`.

1. **Board commands on every client transport.** The transport that the web
   page and the phone use carries every command in the service's RPC group,
   generically, so the board's commands need no per-command transport code.
   The engine's socket already works this way (`api/server.ts:application`).
2. **Board events in the owner's live stream.** Board events reach owner
   devices through `subscribe` like any other event. Board events carry no
   top-level `agentId`, so the engine's existing agent filter hides them
   from agents; the client API must not widen that filter for board events.
3. **Alerts for posts addressed to the owner.** A post that needs a reply
   from the owner produces the engine's existing `OwnerNeeded` event, with
   the author's `agentId`, a reason, and no `subject`, because the subject
   list is permission or question only. The client API's alert rule must
   alert on an `OwnerNeeded` with no subject, and should let the alert open
   the post: either the contract adds a `post` subject, or the alert reads
   the newest open owner-addressed post from the board's read command.
   The board plan's recommendation is a `post` subject, added by the board.
4. **Paged reads, not only the stream.** A phone opening a channel reads a
   page of posts with a cursor (`board read`, with `after` and `limit`),
   instead of replaying the whole log through `subscribe`. The contract's
   read calls should allow a command whose reply is a page of records.
5. **The owner posts from any device as the owner.** A post from a paired
   device is recorded with the owner as its author, as the engine does for
   every device command today. If the client API records which device
   acted, the board reuses that field rather than adding its own.
6. **Size limits at the transport.** The transport's message size limit
   must be at least the board's post limit (planned at 16,384 characters of
   text) plus its envelope.

## Q2 (not yet sent; waits for Q1's answer): does an open board question keep its author "not settled"?

**The question.** A lead posts a question to another lead, with a reply
needed, and ends its turn to wait for the answer. In the engine's terms the
lead is now settled: it is idle and holds no engine request or question.
So an orchestrator waiting on that lead is woken as if the lead had
finished, although the lead is still waiting. Should an agent with an open
post of its own that needs a reply count as not settled?

**Options.**

1. **Yes (recommended).** Add one condition to the engine's settled rule
   (`routing/waits.ts:settled`): the agent has no open board post of its
   own that needs a reply. This matches the engine's existing rule that an
   agent with an open `ask` question, or an open wait, is not settled. It
   changes nothing for an agent that does not use the board, so every
   existing engine test passes unchanged. It is an edit to an existing
   engine rule, which is why it is asked separately from Q1.
2. **No.** The settled rule stays as it is. The orchestrator is woken
   early, spends a turn finding the lead still waiting, and waits again.
   The roles plan would have to tell leads to use the engine's `ask` for
   anything they wait on.

**Consequence of yes.** A question nobody answers keeps its author
unsettled until the post closes. The board already closes a post whose
addressees all stopped or crashed (row 21), so this cannot hang forever on
a dead addressee; it can hang on a live addressee that never replies,
which is the sheepdog's case to catch.

## Q3 (decision row 61): may the round-1 fold change the frozen board contract, and who is a board wake's sender?

**The question, part 1.** Folding round 1 changes the board's contract
(`contract.md`, frozen at `44cd371`). May it be replaced by
`attack/contract-v3-proposed.md`? The changes, each from a decision row:

1. A new command, `board.close` (row 50), and two new events,
   `board.AddresseeResolved` and `board.WakeBuilt` (rows 46, 49).
2. The board's reach check under seam item 15, with the group-channel,
   direct-channel and permission-ceiling rules (row 45).
3. One outcome table for replies, crashes, stops, removals and returned
   wakes (row 49).
4. Merging, cleanup of closed posts, returned wakes and leaving a channel
   (rows 46, 47, 50).
5. Read state as a watermark plus read ids (row 48).
6. Fixed-word author headers, byte caps, an owner-question limit of 3,
   channels addressed by id, `replyTo` in the same channel (rows 52 to 54,
   56, 57).
7. Privacy edges and the list of stores; posts cannot be deleted (row 55).
8. The incoming wait condition, `waitForAgents`, and no board section in an
   agent's snapshot, as approved in L15 (row 51).
9. The "board disabled" switch (row 58) and the restart guarantee (row 59).

**The question, part 2.** The client API contract at `d72fe26`, section 2,
says: "The envelope names the true sender, the calling agent, never the
piece alone and never the owner." A merged board wake carries posts from
several authors. Wakes the reactor builds (a returned wake, an owed close, a
rebuild after leaving a channel) have no calling agent at all.

**Recommendation.** A board wake's envelope carries the sender label
`board`, as seam item 14 says. Each post's true author is named in that
post's header line, built from fixed words (row 52). The reader still sees
the true author of every post, and wakes can still merge.

**The alternative.** One wake per author. This keeps the calling agent in
the envelope, but it breaks merging, so an agent with posts from three
authors spends three turns.

**Answer (lead ruling L16, post #75).** Part 1: yes; `contract.md` is
replaced by version 3. Part 2: the recommendation stands. The sender label
is `board`, never `owner`. Each post's header is built only from fixed
words and the engine-authenticated id, never from post text or an
agent-chosen name, and reactor-built wakes name the original authors the
same way. Logged as row 63.

## Q4 (decision rows 65, 67, 71): may the round-2 fold change the contract, and three points for the seam

**Part 1.** Folding round 2 changes `contract.md` (version 3, ruling L16).
May it be replaced by `attack/contract-v4-proposed.md`? The changes, by
row: anchored group membership by `parent` links, with the manager always a
member (65, 66); direct grants by parentage, and their end (68); the
reach check judged per post, with the dispatcher's re-check (67);
completions as durable wake reasons (69); interrupted addressees (70); a
bounded snapshot section with no post text (71); the wake cap measured as
encoded JSON, and control characters removed (72); rule 4 by ceilings
(73); `board.status` and header fields (74); receipts in the store list
(75); the agent and service direct pair (76); and rows 77 to 82.

**Part 2, my reading of L18.** "Through the manager" is read as through the
channel's anchor, which is its first manager. When manager rights pass up
on a crash, the new manager manages the channel and is a member, but the
channel takes in no one else. Otherwise an opener's crash would widen the
channel to its holder's whole subtree (threat S4, scenario B).

**Part 3, a seam request.** The board's snapshot section holds no post
text and is at most 256 KiB, but it can still be truncated on a large
team. When it is marked `truncated`, `waitForAgents` reads the waited
agents' condition inputs from `board.status` instead of the section. The
board's `board.status` reply carries those inputs.

**Part 4, a note for L19.** The board's reach check stays registered while
the board is switched off, so the dispatcher's re-check still runs then
(threat R2-TM-1 asked for this).

## Q5 (decision rows 84 to 86): the exact client API text that groups 5 and 6 need

Round 3's groups 5 and 6 (logic M3, threat T3-1, T3-3, R3-TM-1) show that
the board's reach check cannot judge the posts of one wake, because seam
item 15 never tells it which delivery it is judging. Logic m4 adds that the
dispatcher stalls after a send-time withdrawal. Threat T3-5 notes a stale
sentence about the board's snapshot section. The text below is against the
client API contract at `586a7ff`. Words in **bold** are new; everything
else is unchanged.

**Change 1, seam item 15, the sentence on inputs.** Replace
"Its inputs are the caller, when there is one, the target and the views
snapshot of the same transaction, never an earlier read (lead ruling L15)."
with:

> Its inputs are the caller, when there is one; the target; **the
> delivery being judged, as its delivery id and its piece source
> `{ namespace, id }`;** and the views snapshot of the same transaction,
> never an earlier read (lead ruling L15). **When the check runs at queue
> time, that snapshot is projected with the command's own batch, including
> the piece's own events in it, as the engine's wait checks already project
> their views (`routing/waits.ts`, `withWaitChecks`).**

**Change 2, seam item 15, the send-time sentence.** Replace
"A delivery that fails the second check is withdrawn with
`DeliveryWithdrawn` and never sent." with:

> A delivery that fails the second check is withdrawn with
> `DeliveryWithdrawn` and never sent, **and the dispatcher goes on to the
> target's next queued delivery in the same pass.**

**Change 3, section 2, the exception's sentence on purity.** Replace
"The reach check is a pure function of the caller, the target and the views
snapshot taken in the same transaction as the delivery" with:

> The reach check is a pure function of the caller, the target, **the
> delivery being judged** and the views snapshot taken in the same
> transaction as the delivery

**Change 4, section 3, the snapshot sentence.** Replace
"The board's section is its whole view for the owner, devices and
services, and absent for an agent." with:

> The board's section is **a bounded summary with no post text** for the
> owner, devices and services, and absent for an agent. **The board's own
> contract states its fields and its cap (lead ruling L21).**

**Why the board needs each.** Change 1 lets the board find the wake in its
`board.WakeBuilt` index and judge exactly its carried posts and its
completions' reply text, so a passing requeued wake is never withdrawn
because of a failing fresh one. The projected snapshot lets the queue-time
check see the batch's own `board.WakeBuilt`. Change 2 stops an engine
prompt queued behind a withdrawn wake from waiting for an unrelated event.
Changes 3 and 4 keep the text consistent.

**Change 5, the board's own contract.** Folding round 3 also changes the
board's `contract.md` (version 4, ruling L21). May it be replaced by
`attack/contract-v5-proposed.md`? It adds `board.ManagerChanged` (row 85),
`board.read` with `repliesTo` (row 88), a fixed-size `board.status` summary
with paged detail and a paged `board.channels` (row 89), and the rules of
rows 84 to 97. It assumes changes 1 to 4.

**Answer (lead rulings L23 and L24, posts #114 and #119).** Yes to changes
1 to 4; plans-api committed them at `ced973b`. Yes to change 5: version 5
replaces `contract.md`. The lead added that the service-and-agent direct
pair must pass the reach check at queue and at send, with a test. Logged
as row 98.

**Answer to Q1 (owner, relayed by the lead in post #142; lead ruling
L26).** The plans edit the engine directly wherever they need to. There is
no extension seam and no rule that existing behaviour stays the same.
Logged as rows 99 and 100.

## Q6 (decision rows 103 to 119): round 4's contract changes, for the board and the client API

Round 4 needs four changes to the client API contract version 4
(`8e80a13`) and one to the board's own contract. Each is given as exact
text. Please also confirm that `8e80a13` is the version 4 the board should
build on (row 119).

**Change 1, client API section 3, "Waiting, for owners and devices"
(row 103; logic M1, architect R4-A3, logic R4-L1).** Replace "Each piece
writes its condition in its folder in `packages/contracts` as a pure
function over its own snapshot section. So the helper needs a caller whose
snapshot holds those sections: the owner, a device or a service." with:

> Each piece writes its condition in its folder in `packages/contracts` as
> a pure function (lead ruling L28). A client does not hold a piece's full
> view. So a piece whose condition reads its view, such as the board's,
> carries in its snapshot section the ids of the agents for which its
> condition holds and the sequence they were computed at, and offers a
> read that returns the same lists at the current sequence (for the board,
> `board.status` with no agent). The helper never ends a wait on a piece
> result older than the stream it has applied. Whenever the engine's part
> of the settled test says the waited agents are settled, it reads each
> such piece's lists. If they are newer than the stream it has applied, it
> applies the stream up to their sequence and decides again. It ends the
> wait only when the engine's part and every piece's lists agree at one
> sequence. No timer and no polling are added. So the helper needs a
> caller whose snapshot holds those sections and who may make those reads:
> the owner, a device or a service.

**Change 2, client API edit E19 (row 104; critic C4-03, logic R4-L2).**
Replace "The board's plan writes the board's: an agent with an open post
of its own that needs a reply is not settled. The client helper
`waitForAgents` applies the same table (section 3)." with:

> The input carries the engine's deliveries with their status by delivery
> id. A piece's entry also takes the piece's own view, which the engine
> passes. The board's plan writes the board's entry, a function of both,
> because its third clause asks whether a queued or sent board wake
> carries a post (board contract, "Settled and waiting"). The client
> helper `waitForAgents` applies the engine's part of the test itself, and
> each piece's part through that piece's results (section 3).

**Change 3, client API edit E18, the "At send time" bullet (row 118;
logic m7).** Add at the end of the bullet:

> The withdrawal runs the engine's wait checks (`withWaitChecks`,
> `routing/waits.ts:110`), as the failed-send batch does
> (`routing/deliveries.ts:259`), so a wait on the target is judged again
> in the same batch.

**Change 4, client API section 1, "Reactors", and edit E23 (row 105;
logic M3).** In section 1, after "It records the last sequence it handled
in its own view, so after a restart it resumes from there.", add:

> A reactor whose rules are all level rules over the current views, such
> as the board's, keeps no position instead: it runs over what each batch
> touches, and over the whole state at start-up.

In edit E23, after "and the reactor counts that event as handled, so a
restart does not retry it forever.", add:

> A reactor with level rules instead tries that duty again only after a
> later batch touches it, or at start-up.

**Change 5, the board's contract version 7.** Replace `contract.md` with
`attack/contract-v7-proposed.md` (ref `board-contract-v7-proposed.md`).
Against version 6, it changes these rules: the manager seat moves only on
a stop, with an acting manager while it is crashed, a plain channel's
opener as an explicit member, and no manager in a direct channel
(row 106); "read" counts a `board.read` page, the third hold-unsettled
clause reads "not read", and the reactor queues unread questions (row 104);
`board.status` with no agent, and the owner's wait rule (row 103); level
rules for the reactor, which writes through edit E23 (row 105);
`board.read` as a read with marks, and the five planners' replies
(rows 107, 108); a wake returned after an accept is not re-queued
(row 110); a completion names at most 17 reply ids (row 111); the stop and
resume fold (row 114); one copy of a completion at a time (row 115); the
off switch keeps `board.status` and its reason (row 116); and the service
grant's wording (row 117). It assumes changes 1 to 4.

**Answer (lead ruling L30, posts #172 and #180).** Yes to changes 1 to 4,
now in the client API contract version 5 at `09018d6`, and yes to
contract version 7. `8e80a13` is version 4. Logged as row 120.
