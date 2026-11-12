revise
Grade: 6  B/M/m: 0/5/6  Flags: none

# Plan review, round 1: lgtm-message-board, lens: logic and failure policy

Reviewer: logic and failure policy. Plan v1, `plan.md` with `decisions.md`,
`contract.md` and `scouting.md`. Every code claim was checked at commit
`8ff4c9b` (`git log -1` gives `8ff4c9b2e0e4…`). The known gaps 1 to 7 are not
re-filed.

The plan's wake path is sound in its main line. The merge of a queued wake
and the dispatcher's send cannot double-deliver, because the dispatcher
re-reads the queue inside its own writer transaction and writes
`DeliverySent` before it calls the runner
(`packages/engine/src/routing/deliveries.ts:239-252`), so the board's
handler sees either `queued` or `sent`, never both. Every close of a live
author's post also queues a wake for that author in the same batch, so the
lifting of the "hold unsettled" condition always coincides with a queued
delivery, and no waiter on the author is lost through it.

The findings below are about what happens when something fails, and about
rules that interact: the engine's blocking wait, its returned and requeued
deliveries, its crash-and-resume policy, and the board's own read cursor.

## Findings

### M1. MAJOR. A blocking wait on an agent that asked its waiter a board question deadlocks

- **Category:** Bug (failures). Logic: failure permits or denies, and lock lifecycle.
- **Scenario:** An orchestrator O calls `wait` with `block: true` on lead A.
  O's turn is now held open by the blocking tool call. A posts a question to
  O with `reply: any` (O is A's holder, so the post is allowed by
  `contract.md:55-59`). A ends its turn. A is idle but holds an open post,
  so the board's registered condition keeps A "not settled" (plan criterion
  3.12, `plan.md:339`; seam item 12, client API contract lines 588-595).
  O's board wake is queued, but O is working, so the dispatcher never sends
  it (`deliveries.ts:230-236` sends only to an idle agent). O's wait cannot
  end until A is settled, A cannot be settled until O answers, and O cannot
  answer until its wait ends. Nothing breaks the cycle until the
  connection closes.
- **Evidence:** The engine prevents exactly this deadlock for its own
  questions. A blocking wait is cancelled with "request held" as soon as
  the waiter holds an open request or question
  (`packages/engine/src/routing/waits.ts:83`, `holds` at `waits.ts:33-35`).
  The engine design states the rule: "A blocking `lgtm wait --block`
  returns at once if the caller already holds a request or question, and
  returns as soon as one is routed to it, so it cannot deadlock"
  (`docs/specs/2026-11-01-engine-design.md:499-501`; issue 176,
  `docs/issues.md:2478-2490`). The board's condition adds a new way for a
  member to be unsettled because of the waiter, but adds no matching
  cancellation. The same cycle forms transitively: A asks B, and B asks O.
- **Suggested fix:** Register a second board condition with the seam, or
  extend item 12: a blocking wait is cancelled with "request held" while its
  waiter is an addressee of an open board post that needs a reply and that
  it has not answered. Check it at open and after every board batch, as
  `waits.ts:83` is level-triggered. Add a criterion beside 3.12 and an
  acceptance case beside 5.2.
- **Risk score:** severity 6 (a core flow is stuck until someone acts by
  hand) × fallout 3 (undone by closing the connection) × probability 6 (an
  ordinary action: a lead asks the parent that is blocking on it) = **108,
  schedule**.

### M2. MAJOR. A board wake that the engine returns is lost, and its question never closes

- **Category:** Bug (failures). Logic: durable repair.
- **Scenario:** Worker W is woken by a question from lead L. The runner
  rejects the prompt, or the turn ends with an unclassified error. The
  engine writes `DeliveryReturned` for the wake and sets W idle
  (`deliveries.ts:130-134`, `failed`; `deliveries.ts:256-260` for a runner
  refusal). Because the wake's sender is not an agent, `returnTo` writes
  only the return and tells nobody (`deliveries.ts:45-49`). The board's
  view never folds `DeliveryReturned` (criterion 2.1, `plan.md:272`, lists
  only queued, sent, accepted and withdrawn), the board has no rule for a
  returned wake, and the post stays open. W is never woken again for it.
  L stays "not settled" for ever (row 33), and in `all` mode the
  collection (criterion 5.2) never closes.
- **Evidence:** `failed` applies to a delivery that is sent or already
  accepted (`deliveries.ts:121-125`), so even an accepted wake can be
  returned after W started reading it. The plan's only rule for a board
  wake is the one for a stopped target (task 3a.3, `plan.md:348`).
- **Suggested fix:** State the board's policy for a returned board wake.
  One choice: the reactor re-queues one fresh wake carrying the same
  needs-reply posts, at most once per post, and on a second return closes
  the post as undeliverable and wakes its author with the reason, as the
  unanswerable rule does. Add `DeliveryReturned` to the fold in 2.1 and a
  reactor criterion with the fake agent's error step.
- **Risk score:** severity 6 (the asker waits until a person notices) ×
  fallout 3 (the owner can repair it with `board.flush`, once they notice)
  × probability 4 (one rare system fault: an error reply) = **72,
  schedule**.

### M3. MAJOR. The board treats a crash as final, but the engine lets a crashed agent resume

- **Category:** Bug (failures). Logic: interacting rules, durable repair.
- **Scenario A, the author crashes:** Lead L hands work to three workers
  in `all` mode and ends its turn. L crashes. The reactor closes L's post as
  withdrawn and wakes nobody (criterion 3.9, `plan.md:336`; row 21). The
  owner resumes L. The workers' replies now answer a closed post, so they
  close nothing and, with `reply: none`, wake nobody (`plan.md:307-309`).
  L is idle with no wake, and its collection is gone.
- **Scenario B, an addressee crashes and is resumed:** L asks W1 and W2 in
  `all` mode. W1 crashes, and its board wake is withdrawn and "never
  returned" (criterion 3.9). The post stays open, because W2 is live. The
  owner resumes W1, which is live again. The plan does not re-queue W1's
  wake on resume, and `all` mode closes only when "every live addressee
  has replied" (`contract.md:80-83`). W2 replies. W1 is counted as live but
  has no wake, so the post never closes, and L is never woken.
- **Evidence:** A crashed agent may be resumed
  (`packages/contracts/src/stateMachine.ts:57`, `crashed: { … resume:
  "allowed" }`; `stateMachine.ts:69`, crashed to starting). The engine's own
  rule for a crashed waiter is suspension, not cancellation: "A suspended
  wait stays open, emits no wake, and is re-checked by a successful
  reloadable `resume`. Only `stop` writes `WaitCancelled`"
  (`docs/issues.md:927-928`; `waits.ts:78-81`). Row 21 cites the engine's
  wait rules as its basis, but it adopts the opposite policy for a crash.
  The engine also refuses `DeliveryQueued` to a crashed agent
  (`stateMachine.ts:102`), so the board cannot leave a wake queued across a
  crash; it must re-queue on resume. A further inconsistency: an
  interrupted agent that cannot reload also needs the owner's `resume`, and
  the engine's waits resolve it like a crash (`waits.ts:55`), but row 21
  keeps the post for it.
- **Suggested fix:** Follow the engine's precedent. On an author's crash,
  suspend its open posts (keep them open, wake nobody); withdraw them only
  on stop. On an addressee's crash, either record it as resolved at that
  moment, as `WaitMemberResolved` does, so a later resume does not re-add
  it to `all` mode, or have the reactor re-queue the addressee's wake when
  it leaves "crashed". Write the choice as a truth table in `decisions.md`
  and add reactor criteria for crash, resume and reply in each order.
- **Risk score:** severity 6 (a core flow, the collection, fails until a
  person acts) × fallout 3 (the owner can flush or reply by hand) ×
  probability 4 (one rare fault, a crash, followed by an ordinary resume) =
  **72, schedule**.

### M4. MAJOR. An open post has no repair path: it cannot be withdrawn, and it outlives its addressees' membership

- **Category:** Design. Logic: durable repair, enforcement lifecycle.
- **Scenario A:** Lead L asks W1 and W2 in `all` mode. L's manager, or the
  engine's `group` command for a group channel, removes W1 from the
  channel (`contract.md:44-54`). W1 is still live, so the post stays open,
  but W1 can no longer post in the channel (criterion 2.7) and so can never
  reply. The post never closes, and L stays "not settled".
- **Scenario B:** L asked the wrong agent, or the work changed. No command
  lets L, the channel's manager or a service withdraw the post. The seven
  commands (`contract.md:159-167`) have no close. Only the author's stop
  closes it.
- **Scenario C:** In `all` mode, the owner's reply has no defined effect.
  Row 26 says the owner's reply closes an `any` post; for `all` it says only
  "every live addressee" (`decisions.md:36`; `plan.md:307-309`).
- **Evidence:** The plan accepts that "a question to a live agent that
  never answers keeps its author unsettled forever", with the sheepdog as
  the remedy (`plan.md:360`). But a service may only post, read status and
  flush (`contract.md:180-189`), and a service's reply closes nothing
  (only an addressee or the owner can close, `plan.md:307-309`). So the
  named remedy has no tool to repair the state. Combined with row 33, an
  orchestrator waiting on L is blocked as long as the post is open.
- **Suggested fix:** Add one close path and state who may use it: for
  example `board.close` for the author, the channel's manager, the owner
  and a service, which writes `board.PostClosed` with reason "withdrawn"
  and wakes the remaining addressees' queued wakes out. Define the owner's
  reply in `all` mode (closes the whole post, or counts as one reply). Make
  the reactor treat an addressee who leaves the channel like one who
  stops. Add access and reactor criteria for each.
- **Risk score:** severity 6 (the author and its waiters are stuck until a
  person acts) × fallout 5 (no path short of stopping the author, so it
  needs the owner's intervention) × probability 4 (a membership change or
  a cancelled hand-off while a question is open) = **120, schedule**.

### M5. MAJOR. One read cursor per channel cannot record a wake that carries only some unread posts

- **Category:** Bug (numbers). Logic: write ownership and ordering.
- **Scenario:** Agent W has 30 unread posts that need no reply in channel
  C, and then a question Q arrives in C for W. W's wake carries Q and "up
  to 20" of the other 30 (`plan.md:316-317`). When the engine accepts the
  wake, "a wake's posts count as read" (criterion 3.10), but row 19 keeps
  one cursor per member per channel (`decisions.md:29`). If the cursor
  moves to Q, ten posts that W never saw are marked read, and later
  `board.status` reports zero unread. If it moves only to the twentieth
  post, Q stays "unread" and rides along again in the next wake. The plan
  also does not say which 20 posts ride along, the oldest or the newest.
- **Second writer:** `board.read` also moves the caller's cursor
  (`decisions.md:49`). A member who pages back through an old page with an
  early `after` cursor could move its read position backwards, so old
  posts become unread and ride along again. The plan does not say the
  cursor only moves forward, or which writer wins when both move it in one
  batch.
- **Evidence:** The overview promises "to wake as little as possible
  without ever losing a message" (`plan.md:20-21`), and row 18 promises
  that unread posts reach the agent with its next wake (`decisions.md:28`).
  Criterion 2.1 folds `DeliveryAccepted` into the view, while task 3b.1
  also gives the reactor "read positions on accepted wakes"
  (`plan.md:272`, `plan.md:349`), so even the writer of this cursor is
  named twice.
- **Suggested fix:** Choose one of two designs and write it as a row.
  Either record read state per post (a wake marks exactly the posts it
  carried), or carry the oldest unread posts first and move the cursor
  only to the last post carried, with needs-reply posts tracked apart from
  the cursor. In both, the cursor only moves forward, and one writer, the
  view's fold or the reactor, owns the move on accept.
- **Risk score:** severity 4 (wrong for a while; `board.read` repairs it
  for an agent that reads) × fallout 3 × probability 8 (a busy channel with
  more than 20 unread posts is common) = **96, schedule**.

### m1. MINOR. The board's view ignores requeued deliveries, so its wake index goes stale after a pause or a restart

- **Category:** Bug (timing).
- **Scenario:** W's board wake is sent but not yet accepted when W's
  account pauses or the service restarts. The engine writes
  `DeliveryRequeued`, and the wake is queued again
  (`deliveries.ts:150-151`; `packages/engine/src/recovery/reload.ts:94`;
  `resume --fresh` at `packages/engine/src/commands/resume.ts:30-35`).
  Criterion 2.1 does not fold `DeliveryRequeued`, so the board's index
  still says "sent". The next post for W then queues a second board wake
  instead of merging, which breaks "at most one board wake waiting" and
  costs W an extra turn. `board.status` reports "sent" for a queued wake.
- **Second effect:** If the handler instead reads the engine's deliveries
  view, it withdraws the requeued wake and queues a new one, which loses
  the requeued wake's place at the head of the queue
  (`deliveries.ts:28-41`, `nextQueued` ranks a requeued delivery first).
  The plan's "still queued in the same transaction's snapshot"
  (`plan.md:356`) does not say which view it reads.
- **Suggested fix:** Fold `DeliveryRequeued` and `DeliveryReturned` in 2.1,
  name the engine's deliveries view as the source for the merge decision,
  and keep a merged wake at its predecessor's queue position or at least
  keep a requeued wake's priority.
- **Risk score:** 2 (an extra turn) × 3 × 4 (a pause or restart with a wake
  in flight) = **24, record**.

### m2. MINOR. The wake set is not filtered to live agents, so a valid reply can be refused

- **Category:** Bug (timing).
- **Scenario:** Lead L crashes. Before the reactor closes L's posts as
  withdrawn, W replies to L's open question. The handler closes the post
  and adds "the asker of any post this one closed" to the wake set
  (`plan.md:310-311`), then returns `DeliveryQueued` to L. The engine
  refuses `DeliveryQueued` to a crashed or stopped agent
  (`stateMachine.ts:102`), and the contract says a piece cannot write an
  engine event the engine would refuse (client API contract lines
  157-161), so W's whole reply is refused. The same wording also adds the
  asker when the asker is the owner or a service, neither of which can be
  a delivery's target, and it is silent on whether "minus the owner"
  applies to that term.
- **Suggested fix:** Define the wake set as agents only, minus the author,
  minus every target that is stopped or crashed in the transaction's
  snapshot. When the asker is gone, close the post as withdrawn in the
  same batch instead of waking it.
- **Risk score:** 2 (one refused reply that succeeds on retry) × 3 × 2 (a
  crash and a reply inside the reactor's window) = **12, record**.

### m3. MINOR. `all` mode has two conflicting close rules when replies and crashes mix

- **Category:** Bug (numbers). Logic: interacting rules.
- **Truth table** for a post in `all` mode to agents A and B. "Closed"
  means closed normally, with the replies. "Unanswerable" means closed
  with a reason.

  | A | B | Rule 3.4 / `contract.md:82` ("every live addressee has replied") | Rule 3.8 / `contract.md:89-91` ("every remaining addressee stops or crashes") |
  |---|---|---|---|
  | replied | replied | closed | not triggered |
  | replied | crashed after A's reply | closed (live = {A}, all replied) | unanswerable (remaining = {B}, all gone) |
  | crashed | replied after the crash | closed | not triggered |
  | crashed | crashed | not triggered | unanswerable |
  | replied | paused | open | open |
  | owner replies | open | undefined (see M4, scenario C) | not triggered |

  The second row is decided differently by the two rules, and the author's
  wake differs: "with every reply" or "with the reason". The plan also does
  not say whether "live" is judged at each reply or at the close, which
  matters once M3 is fixed.
- **Suggested fix:** Add this table to `decisions.md` with one outcome per
  row. A reasonable choice: if at least one reply exists when the last
  addressee is resolved, close normally with the replies and list the gone
  addressees; otherwise close as unanswerable.
- **Risk score:** 2 × 3 × 4 = **24, record**.

### m4. MINOR. The owner's `wait --block` and an agent's `wait` would disagree about a lead that waits on a board answer

- **Category:** Design (contract).
- **Scenario:** The owner runs `lgtm wait --block` on lead L, which has
  an open board question. The client API contract says the owner's helper
  `waitForAgents` uses "the same settled test the engine uses", moved into
  `packages/contracts` "so the helper and the engine share one copy and
  cannot disagree" (client API contract lines 389-397). The board's
  condition is registered with the engine at service start-up and reads
  the board's view (seam item 12, lines 588-595). The plan does not say
  how the client helper learns that condition. If it does not, the owner's
  wait returns "settled" while an agent's wait on the same lead does not.
- **Suggested fix:** State in the plan how the hold-unsettled condition
  reaches the client helper. One way: `board-contracts` exports the
  condition as a pure function over the board's snapshot section, and the
  helper applies every piece's exported condition. Send this to the lead as
  a seam question if it changes item 12.
- **Risk score:** 4 (wrong for a while) × 3 × 6 (an ordinary owner action)
  = **72, schedule**.

### m5. MINOR. Two channel limits cannot be enforced as written

- **Category:** Bug (numbers).
- **Group channels:** The 64-member limit (row 25; criterion 1.5) is
  checked when a channel is opened or changed. A group channel's members
  are computed from the engine's labels at read time (`plan.md:264-266`),
  and the engine's `group` command adds labels with no board check, so a
  group channel can exceed 64 members.
- **Names:** Names are "unique among open channels" (`contract.md:60-61`),
  but no command closes a channel, so the phrase has no meaning, and any
  agent can take a name first (`board.open` is open to any agent,
  `contract.md:161`).
- **Suggested fix:** Say what happens when a label pushes a group channel
  past 64 (the wake set or read is capped, or the board refuses to bind a
  label that already exceeds it), and either add a close or drop "open"
  from the uniqueness rule.
- **Risk score:** 2 × 3 × 4 = **24, record**.

### m6. MINOR. A reply is not required to be in the same channel as its post

- **Category:** Security (isolation), low impact.
- **Scenario:** W is an addressee of L's post in channel C. W replies with
  `replyTo` naming that post, but in another channel D that W shares with
  others and L is not in. The reply closes L's post and wakes L, so L's
  wake carries a post from channel D, which L cannot read through the
  board (criterion 2.7). The plan's close rule checks only that the reply
  comes from an addressee or the owner (`plan.md:307-309`).
- **Suggested fix:** Refuse a `replyTo` that names a post in another
  channel, and add the case to criterion 2.7 or 3.3.
- **Risk score:** 4 (one post shown outside its channel) × 3 × 2 = **24,
  record**.

## Risk register

| Id | Description | Sev | Fallout | Prob | Score | Band | Evidence | Owner |
|---|---|---|---|---|---|---|---|---|
| M4 | An open post cannot be withdrawn and outlives its addressees' membership | 6 | 5 | 4 | 120 | Schedule | Confirmed (plan text) | Planner, then 3a and 3b |
| M1 | A blocking wait deadlocks on a board question to its waiter | 6 | 3 | 6 | 108 | Schedule | Confirmed (`waits.ts:83`, design 499-501) | Planner, seam item 12, 3b |
| M5 | One cursor per channel cannot record a partial wake | 4 | 3 | 8 | 96 | Schedule | Confirmed (plan text) | Planner, then 2a and 3b |
| M2 | A returned board wake is lost and its post never closes | 6 | 3 | 4 | 72 | Schedule | Confirmed (`deliveries.ts:45-49, 130-134`) | Planner, then 3b |
| M3 | A crash closes or loses posts that the engine lets resume | 6 | 3 | 4 | 72 | Schedule | Confirmed (`stateMachine.ts:57, 69`; issues 927-928) | Planner, then 3b |
| m4 | The owner's wait helper lacks the board's condition | 4 | 3 | 6 | 72 | Schedule | Unresolved (seam text) | Planner and lead |
| m1 | The view ignores requeued and returned wakes | 2 | 3 | 4 | 24 | Record | Confirmed (`apply.ts:284-292`) | 2a |
| m3 | `all` mode has two close rules for one case | 2 | 3 | 4 | 24 | Record | Confirmed (plan text) | Planner |
| m5 | Group channel size and name uniqueness cannot be enforced | 2 | 3 | 4 | 24 | Record | Confirmed (plan text) | Planner, 2b |
| m6 | A reply can be posted in another channel | 4 | 3 | 2 | 24 | Record | Confirmed (plan text) | 2b, 3a |
| m2 | The wake set is not filtered to live agents | 2 | 3 | 2 | 12 | Record | Confirmed (`stateMachine.ts:102`) | 3a |

No finding meets the severity floor (none has severity 9 or 10).

## Proposed post-build checks

1. **L-PB1, the reactor's close against a racing reply.** Scenario: W1
   stops, and before the reactor runs, W2's reply closes the post normally.
   Expected: the reactor writes nothing for that post, because it
   re-evaluates the post's status in its own transaction's snapshot rather
   than from the event it read. Evidence: a reactor test that commits the
   reply between the reactor's read and its write. Area: 3b.
2. **L-PB2, wait checks see the board's projected view.** Scenario: one
   batch both writes a board event that changes the hold-unsettled
   condition and resolves an engine wait. Expected: `withWaitChecks` (or
   the seam's equivalent) evaluates the condition on the board view
   projected with the same batch, not on the view before it
   (`waits.ts:28-31` projects only the engine's views today). Evidence: a
   settled test with a close and a turn end in one batch. Area: the seam
   unit and 3b.
3. **L-PB3, every board write runs the wait checks.** Scenario: the
   reactor writes an unanswerable close and the author's wake. Expected:
   the reactor's append goes through `withWaitChecks`, as
   `CommandHandler.ts:269` and `accounts/available.ts:65` do. Evidence: an
   open non-blocking wait on the author that is checked in the same
   commit. Area: 3b.
4. **L-PB4, a merged wake keeps its order.** Scenario: a board wake W1 is
   queued, the parent prompts the agent, then a second post merges W1 into
   W2. Expected: the documented order holds (W2 takes W1's place, or the
   plan says it moves behind the prompt). Evidence: a dispatch-order test.
   Area: 3a.
5. **L-PB5, read on accept is written once.** Scenario: a wake is
   accepted. Expected: exactly one writer moves the read position, and the
   view rebuilt from the log equals the live view. Evidence: the rebuild
   check plus a count of `board.Read` events. Area: 2a and 3b.
6. **L-PB6, `board.flush` with a wake already queued.** Scenario: the
   sheepdog flushes an agent whose board wake is queued. Expected: no
   second wake; the plan should state whether flush is a no-op or a merge.
   Evidence: a wakes test. Area: 3a.

## Noted, not filed

- **The dispatcher race is sound.** WS-3's first risk is handled as the
  plan says: the dispatcher's reservation re-reads the queue inside
  `log.transact` (`deliveries.ts:239-242`), so the board's withdrawal and
  the send are serialized. Post-build check 1 in the plan still applies.
- **Paused addressees diverge from the engine on purpose.** The engine's
  waits resolve a paused member (`waits.ts:54`); the board keeps the post
  for a paused addressee (row 21). Keeping the post is defensible, because
  the addressee can still answer. The plan should say the divergence is
  deliberate.
- **No pass-up at turn end for board questions.** The engine passes a
  request up when its holder ends a turn without answering it
  (`docs/specs/2026-11-01-engine-design.md:490-491`). The board has no
  equivalent, which the plan accepts (`plan.md:360`). This acceptance
  depends on M4's repair path, which the plan does not yet have.
- **The visibility edge is stated, not hidden.** A board wake is a
  `DeliveryQueued` on the target's thread (`apply.ts:122-123`), so a
  member's parent sees the wake's text, including up to 20 unread posts
  from other channels. The plan states this (`plan.md:86-90`). It is for
  the security lens; known gap 3 is not re-filed.
- **Anchors checked.** `waits.ts:39` (`settled`), `holders.ts:21`
  (`holderAbove`), `apply.ts:290` (`DeliveryWithdrawn`, row 17) and
  `deliveries.ts:61-68` (`movedOrWake`) resolve at `8ff4c9b` as the plan
  and scouting cite them. Row 24 names `packages/engine/src/board/`, while
  the plan's criterion 5.4 scans `packages/board/src/`; row 34 amends the
  location, so this is noted only.
