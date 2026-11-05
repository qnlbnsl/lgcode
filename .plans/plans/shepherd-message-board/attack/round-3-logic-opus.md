revise
Grade: 6  B/M/m: 0/4/6  Flags: none

# Plan review, round 3: shepherd-message-board, lens: logic and failure policy

Reviewed plan version 3 (`plan.md`), contract version 4 (`contract.md`),
`decisions.md` rows 45 to 83, and the engine at commit `8ff4c9b`. Every
engine anchor the plan cites was checked at that commit and resolves.

## Summary

The round 2 fold is mostly sound. The cleanup split, the per-post reach
rule, the interrupted addressee and the durable completion all hold as
written. Four new majors come from rules that interact badly:

- In a group channel, a crash counts as leaving the channel. That
  conflicts with the plan's crash rules and breaks the crash-and-resume
  flow that criterion 6.2 promises.
- The channel manager is always a member, but the manager who takes over
  after a crash is chosen by holder availability. A pause can therefore
  change membership, which lead ruling L18 forbids.
- The plan's per-post reach check needs to know which wake is being sent.
  Seam item 15 does not give the check that input.
- The third hold-unsettled clause, read as written, also holds an
  addressee that received its question and ended its turn without
  replying. The waits on that addressee then stall.

There are no blockers.

## Truth table: one crash, pause or stop, and the rules that fire

"3b" is the lifecycle reactor (`plan.md:516-530`). "3c" is the membership
reactor (`plan.md:534-544`). "Live" means not stopped and not crashed
(`contract.md:44`). Group membership is "live label carriers ... plus the
current manager" (`plan.md:383-384`, `contract.md:74-79`).

| Who, in group channel G | Event | 3b says | 3c says | Conflict? |
|---|---|---|---|---|
| Worker W, a labelled addressee of L's open `all` post P | W crashes | W is `gone`, and a later reply can upgrade it to `replied` | W is no longer live, so W leaves G: W is `removed`, with no upgrade | Yes. Which rule writes first decides the result. |
| W | W is resumed and replies | `gone` becomes `replied` | `removed` stays; the reply counts for nothing | Yes, depending on the row above |
| W | W pauses | No disposition | Paused agents are live, so no change | No |
| W | W is interrupted and cannot reload | `gone` | Interrupted agents are live, so no change | No |
| L, the opener, anchor and manager, with no label (the case criterion 2.6 names) | L crashes | P stays open, and replies are still recorded | L is not live, so it is not a label member, and rights passed up, so it is not the manager: L leaves, P is withdrawn, and a completion is owed "removed" | Yes |
| L | L stops | P is withdrawn, and nothing is owed | P is withdrawn, and a completion is owed for the leaving author | Yes, on whether a completion is owed |
| Holder H, which took over L's rights after the crash | L's parent pauses or resumes | Not covered | `holderAbove` moves the manager seat, so H leaves or another agent joins | Yes, and it breaks lead ruling L18 |
| L | L is resumed | Not covered | Not stated whether the rights return to L | Not defined |
| Direct pair A and B, whose only grant is sharing G | B crashes | Not covered | B leaves G, so the grant ends, and every open direct post in both directions closes `unanswerable` | Yes. A crash ends the conversation's open questions for good. |

## Findings

### M1. MAJOR. In a group channel, a crash counts as leaving, which contradicts the crash rules and drops resumed workers' answers

- **Category:** Bug (failures). Logic: interacting rules and the
  enforcement lifecycle.
- **Scenario A, a worker:** Lead L posts an `all` hand-off in group
  channel G to labelled workers W1, W2 and W3. W2 crashes. The engine
  writes `AgentCrashed`.
  - Rule 3b resolves W2 `gone` (`plan.md:516-518`).
  - Rule 3c sees "a crash ... that alters a group channel's computed
    members" (`plan.md:534-539`). A crashed carrier is not live
    (`contract.md:44`, `:74`), so rule 3c resolves W2 `removed`.
  - If `removed` is written first, W2's reply after it is resumed is
    discarded. Only `gone` may be upgraded to `replied`
    (`contract.md:187-189`). The collection closes without W2's result.
  - Criterion 6.2 (`plan.md:641`) promises that the collection "still
    closes". It would close, but with the wrong content.
  - Criterion 4.1 (`plan.md:559`), "every order of reply, crash, resume",
    has two possible answers.
- **Scenario B, the lead:** Criterion 2.6 (`plan.md:395`) names this case:
  "a manager with no label posting an `all` hand-off to its labelled
  children". L crashes.
  - L carries no label and is no longer the current manager, because its
    rights passed to its holder (`contract.md:65`, `:80-81`). So L leaves
    G.
  - Rule 3c withdraws L's hand-off and owes L a completion "with that
    reason".
  - The outcome table says the opposite: when the author crashes, the post
    "stays open; replies are still recorded" (`plan.md:308`,
    `contract.md:202-203`).
  - The workers' later replies close nothing. On resume, L is told its
    hand-off was withdrawn.
- **Scenario C, a direct pair:** A and B share only G, which is their
  direct grant (`contract.md:98-102`). B crashes, so B leaves G and the
  grant ends.
  - Row 68 resolves every open direct post in both directions `removed`,
    and each closes `unanswerable` (`contract.md:103-107`).
  - B's resume restores the grant, but the closed questions stay closed.
- **Also:** For a stop, rule 3c owes the leaving author a completion
  (`plan.md:537-538`). The completion rule owes nothing when the author
  stops (`plan.md:310-311`, `contract.md:204-205`).
- **Evidence:** `plan.md:383-384`, `:516-520`, `:534-539`, `:308`;
  `contract.md:44`, `:74-79`, `:142-144`, `:200-203`. The engine writes
  `AgentCrashed` and withdraws the crashed agent's deliveries in one batch
  (`packages/engine/src/recovery/crash.ts:67`). A crashed agent can be
  resumed (`packages/contracts/src/stateMachine.ts:255`, `:267`).
- **Suggested fix:**
  - Define group membership over carriers that are not stopped, not over
    live carriers. A crash then leaves membership unchanged, as it already
    does for plain channels, whose members are an explicit list.
  - Alternatively, state that for a crash, rule 3b wins and rule 3c does
    not run.
  - Either way, remove "a crash" from rule 3c's trigger list
    (`plan.md:535`) and from the reach re-run list (`contract.md:144`), or
    say what it still does there.
  - Make a stop's author rule one rule: withdraw the posts and owe nothing.
  - Add to criterion 4.1 a group-channel case for a worker crash and
    resume, and one for the lead's crash.
  - Add to criterion 2.7 a direct pair whose grant rests on a group
    channel, with one side crashed and resumed.
- **Risk score:** severity 6 (the lead's collection loses an answer or is
  withdrawn until someone re-asks by hand) × fallout 3 (repaired by
  re-posting) × probability 6 (a harness crash during a hand-off is the
  ordinary path criterion 6.2 tests) = **108, schedule**.
- **Round 2 note:** Round 2's M2 suggested "a live carrier" as the
  membership test. This finding shows that wording, as folded, is wrong
  for a crash.

### M2. MAJOR. The manager seat is chosen by holder availability, so a pause changes group membership, against lead ruling L18

- **Category:** Design. Logic: write ownership and the enforcement
  lifecycle.
- **The rules:**
  - A manager's rights pass to "its own holder" when it stops or crashes
    (`contract.md:65`). The holder is "the nearest ancestor that is idle
    or working, as the engine's `holderAbove` finds it"
    (`contract.md:39-41`). Plan task 2b.1 says manager rights come
    "through the seam's rights helper, which wraps `holderAbove`"
    (`plan.md:408`).
  - `holderAbove` skips any ancestor that is paused, starting,
    interrupted, crashed or stopped
    (`packages/engine/src/routing/holders.ts:14-17`, `:21-33`).
  - "The channel's current manager is always a member"
    (`contract.md:78-79`).
  - There is no board event that records a manager change. The board's
    seven events are listed at `contract.md:391-393`.
  - So the current manager can only be computed at read time, from
    availability.
- **Scenario:** Agent L opened group channel G and crashes. L's parent P
  is paused for a usage limit, so the seat goes to grandparent Q. Q is now
  a member of G and posts there.
  - P's account comes back, so the seat moves to P. Q leaves G. Rule 3c
    then withdraws Q's open posts in G and resolves Q `removed` on every
    open question to it.
  - This is a membership change caused by holder availability. Lead ruling
    L18 says "never holder availability; a pause or account change never
    changes it".
  - Rule 3c already lists "a manager change" as a trigger
    (`plan.md:535`), so the plan expects this to happen, while the ruling
    forbids it.
- **Contradictions in the text:**
  - Criterion 2.6 (`plan.md:395`) says "membership is unchanged when the
    manager pauses, crashes and is resumed".
  - Contract lines 80 to 83 say the inheriting manager "is a member", and
    lead ruling L21 says "a manager who inherits rights on a crash becomes
    a member". So a crash does change membership, and the criterion cannot
    pass as written.
  - The plan does not say whether rights return to L when it is resumed.
    If they do, the inheriting holder leaves, with the effects above. If
    they do not, L carries no label and is no longer a member of the
    channel it opened.
  - The new manager's read position is not defined. Row 79 starts a
    group member's read position only at an `AgentStarted` or
    `AgentGrouped` event (`contract.md:332-335`). So Q starts at the
    first post, and its next wake carries the channel's 20 oldest posts.
- **Suggested fix:**
  - Fix the inheriting manager at the moment of the stop or crash: the
    holder in that batch's snapshot. Record it, with a board event or a
    field the view folds from the triggering event, so that later pauses
    of other ancestors do not move it.
  - State whether rights return to the opener on resume. The simplest rule
    consistent with L21 is "never". If so, the opener stays a member as
    the anchor, so it can still use its own channel.
  - Start the inheriting manager's read position at the channel's last
    post when it takes over.
  - Rewrite criterion 2.6 to match L21. Add a case where the manager
    crashes and then its parent pauses and unpauses, and membership stays
    the same.
- **Risk score:** severity 6 (an agent's posts are withdrawn and its
  questions dropped) × fallout 3 × probability 2 (a manager crash and an
  ancestor pause together) = **36, record**. It is labelled MAJOR because
  criterion 2.6 and lead ruling L21 cannot both pass, so a builder cannot
  meet the plan as written.

### M3. MAJOR. The per-post reach check cannot tell which wake it is judging: seam item 15 gives it no delivery input

- **Category:** Design (the shared contract). Possibly Security
  (isolation), if the check is built to let wakes through when it cannot
  tell.
- **The rule:** The board's check "judges each post a wake carries on its
  own" (`contract.md:120-122`; row 67 (2); criterion 2.11). The
  dispatcher runs it again at send and withdraws a wake that fails (L19).
- **The seam:** Seam item 15 gives the check only three inputs: "the
  caller, when there is one, the target and the views snapshot of the
  same transaction" (`inputs/client-api-contract.md:655-657`).
  - The delivery being sent, and its `{ namespace: "board", id: <wake id> }`
    source, are not inputs.
  - At send time, a target can hold two board wakes: one requeued wake and
    one fresh wake (`contract.md:268-272`). The check cannot tell which of
    them is being sent, so it cannot find that wake's carried posts in the
    `board.WakeBuilt` index.
  - When a wake is queued, the snapshot is "of the same transaction". The
    plan does not say whether that snapshot includes the batch's own
    `board.WakeBuilt`. If it does not, the new wake's carried posts are
    invisible to the check.
- **Consequence:** A builder must choose one of three behaviours, and
  each one breaks something:
  - The check passes any wake to a target that shares some channel with
    the author. That fails open, and L19's guarantee at
    `contract.md:289-293` is lost.
  - The check fails every wake to the target if any of its queued wakes
    fails. Then a good wake is withdrawn because of another wake's post.
  - The seam is changed during the build, which no board unit may do.
- **Evidence:** `inputs/client-api-contract.md:648-663`;
  `contract.md:111-140`; `plan.md:400`, `:409`, `:567`. Today's dispatcher
  sends one specific row: `nextQueued` returns it, and the send records
  that row's id (`packages/engine/src/routing/deliveries.ts:30-41`,
  `:239-251`). The id is available where the check would run.
- **Suggested fix:**
  - Ask the lead to change seam item 15's inputs to add the delivery,
    including its source id, and to state that the snapshot at queue time
    is projected with the batch, as `withWaitChecks` already does
    (`packages/engine/src/routing/waits.ts:28-31`, `:110-120`).
  - Until then, mark criteria 2.11 and 4.9 as depending on that change.
  - Add to criterion 4.9 a target with one requeued wake and one fresh
    wake, where only one of them carries the post that fails.
- **Risk score:** severity 6 (channel text shown to an agent that left
  the channel) × fallout 7 (sent text cannot be recalled) × probability 4
  (a label change racing a queued wake) = **168, fix before release**.
  The finding is unresolved, so it is scored at its worst plausible
  outcome.

### M4. MAJOR. As written, the third hold-unsettled clause holds every addressee that received its question, so a silent addressee stalls every wait on it

- **Category:** Bug (failures). Logic: whether a failure permits or
  denies, and durable repair.
- **The rule:** The clause reads: "it is an addressee with no disposition
  of an open must-reply post that no queued or sent board wake carries to
  it" (`plan.md:548-550`; `contract.md:310-312`). Once the wake is
  accepted, its status is `accepted` (`packages/engine/src/views/apply.ts:281-282`).
  It is then neither queued nor sent, so the clause holds from the
  moment the addressee takes the question until it replies.
- **Scenario:**
  - Lead L posts an `all` hand-off to its workers W1 to W3 and opens a
    non-blocking engine `wait` on them.
  - W2 accepts its wake, does the work, and ends its turn without posting
    a reply. This is common for a model.
  - W2 is idle, with nothing queued, so the engine would call it settled
    (`waits.ts:39-45`). The board's clause holds it instead.
  - L's wait never resolves W2, and L's own post stays open, so L is held
    too. Nothing wakes anyone, and nothing repairs it until the owner or
    the sheepdog notices.
  - Without the board, L's wait would have reported W2 settled and woken
    L to act.
- **Why it is a finding:** Row 69 (8) states this clause's purpose: "the
  gap between a return and the reactor's re-queue". The contract gives
  that gap only as an example ("as in the moment between ...").
  - The plan's key decision covers only the asker: "An agent waiting for a
    board answer is not finished" (`plan.md:115-117`).
  - Nothing decides that an addressee which owes a reply is unfinished,
    and nothing repairs the stall that follows.
  - Criteria 4.3 and 4.6 test only the gap, so this behaviour would ship
    untested.
- **Suggested fix:**
  - Narrow the clause to an open must-reply post with no disposition for
    this addressee, where no board wake carrying it to the addressee has
    been accepted and none is queued or sent. That covers a return, the
    byte cap and a send-time withdrawal, but not a question that was
    received and left unanswered.
  - If the planner means the wider reading, write it as a decision with a
    repair. For example, the reactor re-wakes, once, an idle addressee
    that accepted a question and has not replied, or the clause ends
    after one re-wake.
  - Add the "accepted, idle, no reply" case to criterion 4.6.
- **Risk score:** severity 6 (the team stalls until fixed by hand) ×
  fallout 3 × probability 8 (an addressee ending a turn without replying
  is a common path) = **144, schedule**.

### m1. MINOR. A wake that is accepted and then fails is returned: the completion and the return count have no rule for it

- **Category:** Bug (timing, numbers).
- **Scenario:**
  - A board wake is sent and accepted at the first content update
    (`deliveries.ts:104-116`). The view then discharges its completions
    and marks its posts read (criterion 2.3).
  - The same turn then fails. `failed` accepts a turn delivery that is
    `sent` or `accepted` and writes `DeliveryReturned`
    (`deliveries.ts:121-134`). The delivery row becomes `returned`
    (`apply.ts:287-288`).
  - The reactor then "re-queues one fresh wake with the wake's
    completions and still-open must-reply posts" (`plan.md:523-527`).
- **The gaps:**
  - The completion is either delivered twice, or it is re-queued after it
    was discharged. The plan does not say which.
  - This return counts towards "returned twice, so `undeliverable`", even
    though the addressee received the post.
  - The view keeps "owed completions per agent, with their return count"
    (`plan.md:375-376`), but criterion 2.1 says the fold ignores
    `DeliveryReturned` (`plan.md:390`). So it is not stated where that
    count comes from.
- **Suggested fix:**
  - On a return after acceptance, re-queue only the still-open must-reply
    posts. Do not re-queue the completions, which were discharged, and do
    not count it as a failed delivery for `undeliverable`.
  - Say whether the return count is folded from `DeliveryReturned` or
    derived from the deliveries view.
  - Add the "accepted, then error" order to criterion 4.3.
- **Risk score:** 4 × 3 × 4 = **48, record**.

### m2. MINOR. The idle rule has no exception for a completion that failed twice, and nothing can repair one

- **Category:** Bug (failures). Logic: durable repair.
- **Scenario:**
  - After the second return, `failed` sets the agent idle
    (`deliveries.ts:133`).
  - Rule 3b says: "When an agent is idle with owed completions and no
    queued board wake, it queues one" (`plan.md:521-522`). It has no
    exception for a completion that failed twice, so it queues a third
    wake, then a fourth, with no end. Each failed wake costs a turn.
  - The completions paragraph (`plan.md:316-318`) and row 69 (5) say it
    is no longer re-queued, but the reactor rule a builder implements
    does not say so.
  - Once a completion has failed twice, nothing can deliver it again on
    purpose. `board.flush` carries only unread posts and does nothing
    when there are none (`contract.md:384`).
- **Suggested fix:**
  - Write "owed completions that have not failed twice" into the idle
    rule.
  - Let `board.flush` carry owed completions, including failed ones, so
    the owner or the sheepdog has a repair path.
  - Add to criterion 4.3: after the second return, the agent goes idle
    and no third wake is queued.
- **Risk score:** 6 × 3 × 2 = **36, record**.

### m3. MINOR. A late reply counts only from a `gone` addressee, so replies from `undeliverable` and re-added `removed` addressees are lost

- **Category:** Bug (numbers).
- **Scenario A:** W's wake is returned twice, so W is `undeliverable`.
  W is still live. Later, W reads the channel and replies while the `all`
  post is still open. The reply closes nothing (`contract.md:187-189`,
  `:214-215`).
- **Scenario B:** The same happens to an addressee that was removed and
  then re-added to the channel.
- **Why it matters:** In both cases a real answer is lost from the
  collection.
- **Suggested fix:** Allow the upgrade to `replied` from any disposition
  except `replied`, while the post is open. Alternatively, state that
  these replies are discarded on purpose and show them in the completion
  as "late".
- **Risk score:** 4 × 3 × 2 = **24, record**.

### m4. MINOR. After the dispatcher withdraws a wake at send, the agent's next queued delivery waits for some unrelated event

- **Category:** Bug (timing). The owner is the seam unit; the board
  depends on it.
- **Scenario:**
  - Under L19, the send-time check withdraws a board wake inside the send
    transaction. Today's dispatcher returns when nothing is reserved
    (`deliveries.ts:239-253`).
  - The drain loop repeats only when a new commit names the agent, and
    `DeliveryWithdrawn` is not one of those events
    (`deliveries.ts:269-280`, `:301-311`).
  - If the reactor's rebuild queues nothing, an engine prompt queued
    behind the wake is not sent. That happens when every carried post
    fails, the must-reply posts resolve `removed`, and the wake carries no
    completion. The idle agent then holds a queued prompt until something
    else happens to it.
- **Suggested fix:** Ask that seam item 15 say the dispatcher moves to the
  next queued delivery after a send-time withdrawal. Add post-build check
  P3 below.
- **Risk score:** 6 × 3 × 2 = **36, record**.

### m5. MINOR. A service can be named as an addressee, but nothing notifies it or closes its part

- **Category:** Design.
- **Scenario:** In an agent-and-service direct channel, the agent posts in
  `any` mode to the service.
  - `to` allows any member (`contract.md:162`), and the service is a
    member of the pair (`contract.md:94-97`).
  - Services are never woken and never pass `board.read`
    (`contract.md:166-168`, `:415`). They raise no owner alert, and no
    outcome table row resolves a service.
  - The agent is held unsettled until someone runs `board.close`.
- **Suggested fix:** Refuse a service in `to`, or define how it is told
  (for example, through its owner-only event stream) and give it a
  disposition rule.
- **Risk score:** 4 × 3 × 4 = **48, record**.

### m6. MINOR. Completions owed to a stopped agent are never discharged, and they build up at the front of the owner's snapshot

- **Category:** Bug (numbers).
- **Scenario:**
  - A completion owed to an agent that then stops "stays owed"
    (`contract.md:294-295`). A stopped agent gets no wakes, so the
    completion is discharged only if the agent is resumed.
  - The owner's snapshot section puts "owed completions first"
    (`contract.md:345-349`).
  - Over a service's lifetime, each stopped author keeps up to 64 of
    them, and they push channels out of the section until it is always
    `truncated`.
- **Suggested fix:**
  - Drop an agent's owed completions when it stops, consistent with
    "stop owes nothing".
  - Alternatively, keep them out of the snapshot section's
    priority block while the agent is stopped.
- **Risk score:** 2 × 3 × 6 = **36, record**.

## Round 2 answers checked

| Round 2 finding | Answer | Holds? |
|---|---|---|
| logic M1, cleanup per addressee | Row 82, criterion 3.5 | Yes |
| logic M2, R2-L3, membership by fixed links | Row 65 (L18) | Partly. Group carriers follow `parent` links, but the manager seat follows availability (M2), and "live" makes a crash a leave (M1). |
| logic M3, per-post reach | Row 67, criterion 2.11 | The rule holds. The seam cannot run it as specified (M3). |
| logic M4, R2-L1, interrupted and not reloadable | Row 70 | Yes. `waits.ts:55` is the same test, and recovery writes `AgentInterrupted` for every starting, working and idle agent (`recovery/restart.ts:118-125`), so catch-up sees them. |
| logic m1, the settled window | Row 69 (8) | The gap is covered, but the wording covers far more (M4). |
| logic m2, "has no disposition" | Row 77 | Yes |
| logic m3, a late `gone` reply | Row 70 (3) | Yes for `gone`; see m3 for the other dispositions |
| logic m4, m5, m6, m7 | Rows 78, 69 (1), 79, 73 | Yes. Row 79 does not cover a manager who joins by taking over rights (M2). |
| R2-L2, a direct grant ends | Row 68 | Yes, except when the grant rests on a group channel and a crash ends it (M1) |
| R2-L4, completions as reasons to wake | Row 69 | Yes, apart from m1 and m2 |
| R2-L5, the incoming read | Row 80 | Yes |

No known gap is wrongly scoped. Known gap 8 (a) is now closed by lead
ruling L22.

## Proposed post-build checks

| Id | Scenario | Expected result | Evidence needed | Area |
|---|---|---|---|---|
| P1 | The reactor sees three kinds of `DeliveryWithdrawn` for board wakes: one the board wrote while merging or cleaning up, one the dispatcher wrote at send, and one from `targetGone` | Only the dispatcher's withdrawal is rebuilt, exactly once. The other two are not rebuilt. | A reactor test over all three, with the reasons it tells them apart by | board/backend |
| P2 | A board wake is returned, and the same batch leaves the agent idle with owed completions | Exactly one wake is re-queued: the return rule and the idle rule do not both queue one | The batch's events in a reactor test | board/backend |
| P3 | A send-time withdrawal, with an engine prompt queued behind the wake and a rebuild that queues nothing | The engine prompt is sent without any further event | A dispatcher test in the seam unit | seam |
| P4 | A group carrier and a group manager each crash and are resumed | The live and rebuilt board views agree, and so do the computed member sets | The rebuild check plus a membership assertion | board/backend |
| P5 | The reach check is given the delivery under the amended seam item 15 | It judges exactly that wake's carried posts, at queue time and at send | A test with one requeued wake and one fresh wake | board/backend |

## Noted, not filed

- The incoming condition cancels every blocking wait an addressee opens,
  whoever asked the question. Criterion 4.7 tests only an asker that is
  the agent being waited on. This matches the engine's own `holds`
  (`waits.ts:33-35`, `:83`) and lead ruling L15. A worker that must
  answer a sibling cannot block-wait on its own children until it
  replies.
- Any owner reply closes the post as `answered`, including an `all`
  collection, even when the owner meant only a comment. This is a product
  choice, and it is stated.
- A group member that rejoins keeps its old read position, because row 79
  says "first makes it a member". A plain-channel member that is re-added
  starts again at the last post. The two rules are inconsistent, but this
  exposes no privacy edge, because members can read the full history.
- A flush wake that carries only no-reply posts and loses one post on a
  rebuild is withdrawn, and the cleanup rule does not replace it
  (`plan.md:323-324`). The flush is then silently lost.
- The return count is kept per post across merges. A wake's second
  failure may be caused by another post in the same merged wake.

## Report line

Logic and failure policy, round 3: revise. 0 blockers, 4 majors, 6
minors. No refusals.
