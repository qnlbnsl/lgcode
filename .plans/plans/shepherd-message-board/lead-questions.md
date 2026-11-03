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
