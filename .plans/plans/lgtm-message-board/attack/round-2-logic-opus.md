revise
Grade: 6  B/M/m: 0/4/7  Flags: none

# Plan review, round 2: lgtm-message-board, lens: logic and failure policy

Reviewer: logic and failure policy. This round reviews plan version 2
(`plan.md`), `contract.md` version 3, `decisions.md` rows 44 to 63, and how
round 1 was answered (`attack/round-1-findings.md`). Every code claim was
checked at commit `8ff4c9b` (`git log -1` gives `8ff4c9b2e0e4…`). The known
gaps 1 to 8 are not re-filed.

## Summary

Most of round 1's answers hold. The incoming "request held" condition
(row 51, seam item 16) breaks the blocking-wait deadlock, including the
transitive case: any open post that needs the waiter's reply cancels the
wait, whoever wrote it. The returned-wake rule (row 46), the read-state rule
(row 48), the single outcome table (row 49) and `board.close` (row 50) each
answer their round 1 finding.

Four problems remain at major level:

1. The cleanup rule removes a post from every addressee's queued wake when
   one addressee answers.
2. Membership of agent-opened group channels, and the right to send direct
   messages, depend on agents' lifecycle state, and nothing reacts when that
   state changes.
3. The plan does not say what happens when a rebuilt wake carries an old
   post that no longer passes the reach check.
4. An addressee that is interrupted and cannot reload is never resolved, so
   the round 1 crash fix (M3) has a gap.

## Truth table: one addressee's state and the board's rules

The table below shows, for each engine state of one addressee, what the
plan does with a new post and with an open one, compared with the engine's
own wait rule (`packages/engine/src/routing/waits.ts:49-58`).

| Addressee state | New post needing its reply | Open post: disposition | Engine wait reason | Holds? |
|---|---|---|---|---|
| idle or working | allowed, wake queued | none until it replies | settled or none | yes |
| paused | allowed, wake queued | none; the post waits | `paused` | yes, a stated divergence |
| starting | allowed, wake queued | none | none | yes |
| interrupted, reloadable | allowed, wake queued | none; recovery reloads it | none | yes |
| interrupted, not reloadable | allowed, wake queued and never sent | **none, ever** | `interrupted`, at once | **no: M4** |
| interrupted, reload failed | allowed | `gone` on `AgentReloadFailed` | `interrupted` | yes |
| crashed | refused | `gone` on `AgentCrashed` | `crashed` | yes |
| stopped | refused | `gone` on `AgentStopped` | `stopped` | yes |
| left the channel by `board.members` or a label change | refused (non-member) | `removed` | not applicable | yes |
| stopped counting as a member because its lead paused or crashed | refused (non-member) | **none**; no reactor trigger | not applicable | **no: M2** |
| answered after already being `gone` (crashed, then resumed) | not applicable | stays `gone`; its reply is ignored | not applicable | **gap: m3** |

## Findings

### M1. MAJOR. The cleanup rule strips a post from every addressee's queued wake when one addressee answers

- **Category:** Bug (failures). Logic: write ownership, interacting rules.
- **Scenario:** Lead L posts a hand-off in `all` mode to workers W1, W2 and
  W3. W1 and W3 are idle, so their wakes are sent at once. W2 is busy, so
  its wake stays queued. W1 replies. Row 47 says that in the same
  transaction as "every terminal change ... of one addressee's obligation",
  the board "removes that post's demand from every still-queued board wake
  that carries it". `contract.md` says the same: "When a post closes, or one
  addressee's part in it ends, the board removes that post from every
  still-queued wake that carries it". W2's queued wake carries the post, so
  it is withdrawn. If W2 has no other post that needs its reply, no
  replacement is queued. W2 is never woken for the hand-off, and it has no
  disposition. The post never closes, L stays "not settled", and anyone
  waiting on L stays blocked.
- **Evidence:** `decisions.md:57` (row 47); `contract.md:203-206`. The
  plan's own outcome section limits cleanup to closes: "At every close, the
  post's demand is removed from every still-queued board wake"
  (`plan.md:276-277`). Criterion 3.5 (`plan.md:415`) tests only a close. The
  plan and the contract therefore disagree, and the contract's wider wording
  is wrong as written.
- **Suggested fix:** Split the rule in row 47, the contract, and the outcome
  section. When a post closes, remove it from every queued wake. When one
  addressee gets a disposition, remove the post only from that addressee's
  own queued wakes. Add a case to criterion 3.5: in `all` mode, W1's reply
  leaves W2's queued wake unchanged.
- **Risk score:** severity 6 (a collection fails until someone acts by
  hand) × fallout 3 (`board.close`, or the owner's reply, repairs it) ×
  probability 6 (an ordinary `all`-mode hand-off where one worker is busy)
  = **108, schedule**.

### M2. MAJOR. Group membership and direct-message rights depend on lifecycle state, and nothing reacts when that state changes

- **Category:** Bug (timing), Design. Logic: enforcement lifecycle.
- **Definitions the rules use:**
  - The contract defines an agent's holder as "the agent's nearest ancestor
    that is idle or working, as the engine's `holderAbove` finds it"
    (`contract.md:37-39`). The code skips every ancestor that is paused,
    starting, interrupted, crashed or stopped
    (`packages/engine/src/routing/holders.ts:14-17`, `:21-33`).
  - In an agent-opened group channel, an agent is a member only if "its
    chain of holders passes through the channel's current manager"
    (`contract.md:61-64`; criterion 2.6, `plan.md:346`).
  - A direct pair may post only while it "is holder and held"
    (`contract.md:74-77`).
  - A manager's rights pass to its holder when it stops or crashes
    (`contract.md:53-54`; criterion 2.5).
  - The membership reactor recomputes group membership only on
    `AgentStarted` and `AgentGrouped` (`plan.md:459-463`). Membership is
    otherwise computed afresh at every check (`plan.md:334-335`).
- **Scenario A, a lead pauses:** Lead L opens a group channel for its team's
  label. L's account hits a usage limit, and L is paused
  (`deliveries.ts:142-156`). Every worker's holder chain now skips L, so no
  worker counts as a member. While L is paused:
  - A worker's reply in the channel is refused, because non-members cannot
    post (criterion 2.8).
  - Siblings cannot ask each other anything.
  - Workers stay addressees of open posts with no disposition, because no
    event reaches the reactor.
  - A worker cannot send a direct message to its paused lead, because the
    pair is no longer "holder and held". The plan promises the opposite for
    a paused addressee: "It pauses: none; the post waits"
    (`contract.md:129`).
- **Scenario B, a manager crashes:** L crashes. Its rights pass to its
  holder, the orchestrator O, which becomes the "current manager". Every
  label carrier under O now passes rule 3, including carriers in other
  leads' subtrees. Round 1's threat finding M1 said this must not happen.
  These agents can read the channel's whole history with `board.read`. When
  L is resumed, the membership shrinks again without any event, and nobody
  is resolved `removed`.
- **Evidence:** See the definitions above. A paused or crashed agent is not
  available (`holders.ts:16`). Usage-limit pauses are a normal engine path
  (`deliveries.ts:172-198`).
- **Suggested fix:**
  - Define group membership by fixed parentage, not by the holder chain: an
    agent-opened group channel admits a live carrier whose parent chain (the
    `parent` links, not `holderAbove`) includes the channel's opener.
  - Keep manager rights passing up for managing only, never for membership.
  - Define the direct-pair "holder and held" test by parentage too, or say
    that a pause suspends it on purpose.
  - If any live-state input remains, list the engine events that change it
    and have the reactor recompute on each one, resolving `removed` where
    membership is lost.
  - Add criterion 2.6 cases: the manager pauses, then crashes; membership is
    unchanged in both cases, and no cousin is admitted.
- **Risk score:** severity 6 (team-channel replies are refused while a lead
  is paused, and open posts are stranded) × fallout 3 (it repairs itself
  when the lead returns, or with `board.close`) × probability 6 (a lead's
  usage-limit pause is an ordinary event) = **108, schedule**.

### M3. MAJOR. The plan gives no rule for a rebuilt wake that carries an old post that no longer passes the reach check

- **Category:** Bug (failures), Design. Logic: failure permits or denies.
- **How it arises:**
  - The reach check runs over every post a wake carries: "A wake to agent T
    is allowed only if ... every post it carries ..." (`contract.md:85-94`).
  - The board applies the check "to every wake it builds"
    (`contract.md:84-85`, row 61).
  - Many paths rebuild a wake around old posts: merging (`plan.md:385-393`),
    cleanup replacements (`contract.md:203-206`), re-queuing a returned wake,
    rebuilding after a member leaves (`plan.md:455-463`), and `board.flush`.
  - The check's inputs change without any board event. A direct pair stops
    sharing a channel. A member leaves a channel that is not the post's
    channel (unit 3c rebuilds only without the left channel's posts). An
    author's or target's permission level changes, because a harness's mode
    report writes `ModeChanged` (`CommandHandler.ts:153-157`), which
    overwrites the view's `permission` (`apply.ts:190-192`). M2's
    lifecycle-driven membership changes are a fourth input.
- **Scenario:** W1 and W2 share channel C, so W1 may send W2 direct
  messages. W1 sends W2 a direct question that needs a reply. W2 is busy,
  so the wake waits in the queue. W1 then leaves C, and the direct pair
  rule now fails. Unit 3c rebuilds W1's wakes, not W2's. Later the owner
  posts a question to W2 in another channel. The merge withdraws W2's
  queued wake and builds one that carries both posts. The direct post fails
  rule 2. The plan does not say whether:
  - the whole `board.post` is refused, so an unrelated author, here the
    owner, cannot reach W2 until something clears the old wake; or
  - the old post is silently dropped, so it loses its only wake and gets no
    disposition, and its author stays "not settled".

  The same choice comes up when a closing reply must wake an author that
  stopped counting as a member through M2. The reply itself would then be
  refused, and the addressee could never answer.
- **Evidence:** See the bullets above. Row 50(4) says "A closing reply is
  forwarded only to an author that is still a member", but it does not say
  what happens to the reply when the author is not.
- **Suggested fix:** Write the rebuild rule. Whenever a wake is built, check
  each carried post on its own:
  - a no-reply post that fails is left out;
  - a must-reply post that fails resolves that addressee with a disposition
    (`removed`, or a new `unreachable`) in the same batch, which may close
    the post through the outcome table;
  - an old carried post never causes the triggering command to be refused.

  Have the reactor apply the same rule on the events that change the
  inputs: `ModeChanged`, membership changes in any channel of a direct
  pair, and M2's events. Add a wakes criterion for each input.
- **Risk score:** severity 6 (either posts to one agent are blocked, or a
  question is stranded) × fallout 3 (`board.close` or a restart of the flow
  repairs it) × probability 4 (one uncommon change while a wake is queued)
  = **72, schedule**.

### M4. MAJOR. An addressee that is interrupted and cannot reload is never resolved, so its question never closes

- **Category:** Bug (failures). Logic: durable repair. This is where round
  1's M3 answer fails.
- **Scenario:** The service restarts. Every idle or working agent becomes
  `interrupted` (`packages/engine/src/recovery/restart.ts:118-125`).
  Recovery reloads only an agent that is reloadable and whose harness can
  reload. Any other agent "stays interrupted until `resume --fresh`", and
  no `AgentReloadFailed` is written for it (`restart.ts:150-159`, which
  returns `false` at line 159). Worker W, on a harness that cannot load
  sessions (`AcpRunner.ts:470`, `reloadable: loads || resumes`), is an
  addressee of L's open `all`-mode post. The plan's reactor resolves an
  addressee `gone` only on "`AgentStopped`, `AgentCrashed`, or
  `AgentReloadFailed` while interrupted" (`plan.md:451-453`). None of these
  is ever written for W. W's wake can be queued, because an interrupted
  agent accepts `DeliveryQueued` (`stateMachine.ts:102`), but it is never
  sent, because the dispatcher sends only to an idle agent
  (`deliveries.ts:230-236`). The post never closes, and L stays
  "not settled".
- **Second effect:** The plan refuses a new post only to "a stopped or
  crashed addressee" (`plan.md:378-379`, `contract.md:118-119`). A new
  question to an agent that is already interrupted and cannot reload is
  therefore accepted, and it strands at once.
- **Evidence:** Row 49 promises the right rule: "interrupted and not
  reloadable, judged when it happens, as the engine's `WaitMemberResolved`
  does". The engine judges such an agent resolved the moment it is
  interrupted (`waits.ts:55`, `reloadable === true ? undefined :
  "interrupted"`). The reactor's trigger list does not implement that rule.
- **Suggested fix:**
  - Resolve an addressee `gone` on `AgentInterrupted` when its view row has
    `reloadable !== true`. Also resolve it when recovery finishes and leaves
    it interrupted, since a reloadable agent can also stay interrupted when
    its harness cannot reload. Use the same test the engine's `reasonOf`
    uses.
  - Refuse a new post that needs the reply of an agent that is interrupted
    and cannot reload.
  - Add a case to criterion 4.1, and a restart acceptance case to 6.5.
- **Risk score:** severity 6 (the asker and its waiters are stuck until a
  person acts) × fallout 3 (`board.close`, or `resume --fresh`, repairs it)
  × probability 4 (one rare fault: a restart, with an addressee on a harness
  that cannot reload) = **72, schedule**.

### m1. MINOR. Wakes the reactor queues after an engine commit leave a window in which the target counts as settled

- **Category:** Bug (timing). Logic: ordering.
- **Scenario:** Worker W's board wake fails with an unclassified error. The
  engine writes `DeliveryReturned` and sets W idle in the same batch
  (`deliveries.ts:130-134`), and that batch runs the wait checks
  (`deliveries.ts:259`). W is now idle with nothing queued, so it is settled
  (`waits.ts:39-45`). A non-blocking wait by W's lead resolves W as
  "settled" and wakes the lead. Only afterwards does the board's reactor
  re-queue W's wake (row 46). The lead has been told W is done while W
  still has a question to answer. Nothing tells the lead again later,
  because its wait is already satisfied.
- **Same pattern:** A crashed author resumed to idle is settled until the
  reactor queues its owed close (`plan.md:274`, `plan.md:453-455`). A wait
  opened on that author while it was starting resolves "settled" too early.
- **Evidence:** Round 1 credited the plan because "every close of a live
  author's post also queues a wake for that author in the same batch". The
  two reactor-queued paths break that rule. The engine avoids this gap for
  its own returns by queuing the sender's notice in the same batch as the
  return (`deliveries.ts:45-54`).
- **Suggested fix:** Extend the hold-unsettled condition (seam item 12):
  an agent is also not settled while the board owes it a wake. That covers
  a returned board wake that is not yet re-queued, and an owed close that
  is not yet queued. Both are computable from the board's view. Add a case
  to criterion 4.3: a waiter on the target is not satisfied between the
  return and the re-queue.
- **Risk score:** 4 (a waiter is misinformed, and the work recovers) × 3 ×
  4 (an error reply while someone waits on the target) = **48, record**.

### m2. MINOR. The incoming condition counts "has not answered", not "has no disposition"

- **Category:** Bug (timing).
- **Scenario:** O is an addressee of an open `all`-mode post in channel C.
  O is removed from C, so its disposition is `removed`, while other
  addressees keep the post open. O cannot post in C. Every blocking `wait`
  O opens is still cancelled at once with "request held", because O "has
  not answered". O cannot clear that condition. The same happens to an
  addressee that was resolved `gone` and was then resumed.
- **Evidence:** `plan.md:466-469`, `contract.md:230-232` and row 51 all use
  the wording "that it has not answered".
- **Suggested fix:** Word the condition, and `holdsIncoming`, as "is an
  addressee with no disposition of an open post that needs a reply". Add the
  `removed` case to criterion 4.7.
- **Risk score:** 4 (an agent's blocking waits fail and cost it turns) × 3 ×
  2 (a removal or a resume while an `all` post stays open, then a blocking
  wait) = **24, record**.

### m3. MINOR. A late reply from an addressee resolved `gone` is discarded, even in `any` mode

- **Category:** Bug (numbers). Logic: interacting rules.
- **Scenario:** L asks W1 and W2 in `any` mode. W1 crashes, so it is
  resolved `gone`. The owner resumes W1, which still has the question in
  its reloaded session, and W1 replies. A disposition is "set once and
  never undone" (`contract.md:120-128`), so the reply cannot become
  `replied`, and the post stays open waiting for W2, which may be busy for a
  long time. The plan also does not say whether W1's reply text is included
  in L's close wake ("every reply").
- **Suggested fix:** State one of two rules. Either a reply from a live
  addressee whose disposition is `gone` counts as `replied` while the post
  is still open, which is the one allowed upgrade; or it is discarded, and
  the close wake lists it. Add the case to criterion 4.1.
- **Risk score:** 4 × 3 × 2 (a crash, a resume and a late reply) = **24,
  record**.

### m4. MINOR. An author may name itself in `to`, and an `all`-mode post then never closes on its own

- **Category:** Bug (numbers).
- **Scenario:** A posts in `all` mode with `to: [A, B]`. The wake set
  removes the author (`plan.md:381-383`), so A gets no wake and no
  disposition. After B replies, the post stays open until A replies to its
  own post, and A stays "not settled".
- **Suggested fix:** Refuse an author in its own `to`, or leave the author
  out of the dispositions. Add the case to criterion 1.5 or 3.3.
- **Risk score:** 2 × 3 × 2 = **12, record**.

### m5. MINOR. An author is not told when someone else withdraws its question, and its waiter is told "settled"

- **Category:** Design. Logic: failure permits or denies.
- **Scenario:** The stall watch, the manager or the owner runs `board.close` on
  L's open question. Alternatively, the manager removes L from the channel,
  which withdraws L's posts there (row 50(2)). A `withdrawn` close wakes
  nobody (`plan.md:276`). L's hold-unsettled condition lifts, so a waiter on
  L resolves L as "settled" and is woken. L itself is idle, still expects an
  answer, and is never told the answer will not come.
- **Suggested fix:** When someone other than the author withdraws a post,
  or the author is removed from the channel, wake a live author once with
  the reason. Keep "wakes nobody" for the author's own `board.close` and for
  its stop.
- **Risk score:** 4 × 3 × 4 = **48, record**.

### m6. MINOR. A new member's read state starts at the channel's first post, so its wakes carry stale history

- **Category:** Bug (numbers). Logic: periods.
- **Scenario:** A lead starts a worker with the team label, and the
  worker's group channel already holds 400 posts. The plan never sets where
  a new member's watermark starts (row 48, `decisions.md:58`). A wake
  carries "the oldest unread posts that need no reply" first
  (`plan.md:397-399`). The worker's first wakes are therefore filled with
  the 20 oldest posts from before it joined. Each later wake carries the
  next 20, never the recent ones. Each wake can approach the 256 KiB cap,
  which is roughly 64,000 tokens of stale text per turn. Its unread count in
  `board.status` starts at 400.
- **Suggested fix:** Start a member's watermark at the channel's last post
  when it joins. For a plain channel, that is the `board.ChannelMembersChanged`
  that adds it. For a group channel, it is the first moment the member is
  computed as a member, which the reactor's join handling in unit 3c can
  record. Alternatively, state that history is read only with `board.read`
  and is never carried. Add a case to criterion 2.3.
- **Risk score:** 4 (wasted tokens, and recent context is missed, for a
  while) × 3 × 6 (every labelled start into a busy channel) = **72,
  schedule**. The score is above the minor line, but the consequence is
  cost, not a broken flow, so the label stays minor.

### m7. MINOR. The ceiling rule's "permission level" is the current mode, so a lead that narrows its own mode cannot collect from its workers

- **Category:** Design. Logic: interacting rules.
- **Scenario:** Rule 4 refuses a post that needs T's reply unless the
  author's permission level is at least T's, or T is the author's ancestor
  (`contract.md:92-94`). The only level the view holds is the current mode.
  A harness's mode report overwrites it (`apply.ts:190-192`,
  `CommandHandler.ts:153-157`). Lead L was started at `edit`, and its
  workers were started at `edit`. L's harness then reports a narrower mode,
  for example a planning mode mapped to `read-only`. L's `all`-mode hand-off
  to its own workers, which is the plan's main collection flow
  (criterion 6.2), is now refused. The engine's own `prompt` has no such
  check (`commands/prompt.ts:7-12`); the engine enforces the ceiling at
  `start` only (`commands/start.ts:19`, `identity/ceiling.ts:311-312`).
- **Evidence:** Row 45(d) cites the engine's ceiling as the basis for rule
  4. The engine design's text covers `prompt` (design line 223), but the
  engine's code does not check it there. The plan does not say whether rule
  4 compares current modes or start levels.
- **Suggested fix:** Say which level rule 4 compares. Also exempt a target
  the author holds, so that a holder may always ask what it may already
  prompt. Record the design-versus-code gap on `prompt` for the lead's
  issues list. Add a criterion 2.9 case in which the parent has narrowed its
  mode.
- **Risk score:** 6 × 3 × 2 (a narrowed parent mode at the moment of a
  hand-off) = **36, record**.

## Risk register

| Id | Description | Sev | Fallout | Prob | Score | Band | Evidence | Owner |
|---|---|---|---|---|---|---|---|---|
| M1 | Cleanup on one addressee's reply strips the post from every addressee's queued wake | 6 | 3 | 6 | 108 | Schedule | Confirmed (`decisions.md:57`, `contract.md:203-206` against `plan.md:276-277`) | Planner, then 3a |
| M2 | Group membership and direct rights follow lifecycle state with no reactor trigger, and widen when a manager crashes | 6 | 3 | 6 | 108 | Schedule | Confirmed (`contract.md:37-39, 61-64`; `holders.ts:14-33`; `plan.md:459-463`) | Planner, then 2b and 3c |
| M3 | A rebuilt wake has no rule for an old post that fails the reach check | 6 | 3 | 4 | 72 | Schedule | Confirmed (plan text; `apply.ts:190-192`) | Planner, then 3a and 3b |
| M4 | An addressee that is interrupted and cannot reload is never resolved | 6 | 3 | 4 | 72 | Schedule | Confirmed (`restart.ts:150-159`; `waits.ts:55`; `plan.md:451-453`) | Planner, then 3b |
| m6 | A new member's read state starts at the first post, so wakes carry stale history | 4 | 3 | 6 | 72 | Schedule | Confirmed (plan text) | Planner, then 2a and 3c |
| m1 | A reactor-queued wake leaves a window in which the target counts as settled | 4 | 3 | 4 | 48 | Record | Confirmed (`deliveries.ts:130-134, 259`; `waits.ts:39-45`) | Planner, seam item 12, 3b |
| m5 | An author is not told when someone else withdraws its question | 4 | 3 | 4 | 48 | Record | Confirmed (plan text) | Planner, then 3a |
| m7 | Rule 4 compares current modes and blocks a narrowed parent's hand-off | 6 | 3 | 2 | 36 | Record | Confirmed (`apply.ts:190-192`, `prompt.ts:7-12`) | Planner, then 2b |
| m2 | The incoming condition ignores dispositions | 4 | 3 | 2 | 24 | Record | Confirmed (plan text) | Planner, then 3b |
| m3 | A late reply from a `gone` addressee is discarded | 4 | 3 | 2 | 24 | Record | Confirmed (plan text) | Planner, then 2a |
| m4 | An author may address itself, and an `all` post then hangs | 2 | 3 | 2 | 12 | Record | Confirmed (plan text) | 1, 3a |

No finding meets the severity floor, because none has severity 9 or 10.

## Proposed post-build checks

1. **L2-PB1, cleanup is scoped to each addressee.** Scenario: in `all`
   mode, W1 replies while W2's wake is still queued. Expected: W2's queued
   wake still carries the post; only a close removes it from everyone.
   Evidence: a wakes test that counts deliveries. Area: 3a.
2. **L2-PB2, membership is stable across a lead's pause and crash.**
   Scenario: the manager of an agent-opened group channel pauses, then
   crashes, then is resumed. Expected: the computed members do not change,
   no cousin carrier is admitted, and a member's reply is accepted
   throughout. Evidence: access and reactor tests. Area: 2b and 3c.
3. **L2-PB3, a rebuild with a lapsed post.** Scenario: a queued wake
   carries a direct post whose pair rule has lapsed, and a new post merges
   it. Expected: the new post is accepted; the lapsed post's addressee gets
   a disposition in the same batch. Evidence: a wakes test that reads the
   events written. Area: 3a.
4. **L2-PB4, a restart with an addressee that cannot reload.** Scenario: a
   restart leaves an addressee interrupted with `reloadable` false.
   Expected: the addressee is resolved `gone`, and an `all`-mode post
   closes. Evidence: a restart acceptance case. Area: 3b.
5. **L2-PB5, no settled window around a reactor-queued wake.** Scenario: a
   board wake is returned while the target's lead holds a non-blocking wait
   on it. Expected: the lead's wait is not satisfied before the re-queue
   commits. Evidence: a settled test with the fake agent's error step.
   Area: the seam and 3b.
6. **L2-PB6, a new member's first wake.** Scenario: an agent joins a channel
   that holds more than 20 earlier posts. Expected: its first wake carries
   no posts from before it joined, unless the plan chooses otherwise.
   Evidence: a view and wakes test. Area: 2a and 3c.

## Noted, not filed

- **Round 1 answers checked and holding:**
  - M1, the deadlock: seam item 16 covers the transitive case.
  - M2, returned wakes: row 46 (4), apart from m1 above.
  - M5, read state: row 48.
  - m1, m3, m5 and m6, the two close rules, the limits and replies across
    channels: rows 46, 49, 56 and 57.
  - The proposed checks L-PB1, L-PB4 and L-PB6: row 62.
  - Round 1 M4, repair: holds for `board.members` and label changes. The
    gap where lifecycle changes membership is M2 above.
  - Round 1 M3, crashes: holds for authors and for crashed addressees. Its
    gap is M4 above.
- **Seam item 13 and requeued wakes.** Row 47 withdraws a requeued wake
  during cleanup. A requeued delivery folds back to status `queued`
  (`apply.ts:284-286`), so "while that delivery is still queued" allows the
  withdrawal. A requeued wake is told apart from a never-sent one by its
  `reason`, which `DeliverySent` clears (`apply.ts:278-280`). The seam's
  phrase "a delivery that was sent ... cannot be withdrawn" could be read as
  "ever sent"; the seam unit should word it as "status queued".
- **Must-reply posts past the byte cap** get no wake of their own once the
  carrying wake is accepted. The wake's text tells the agent to run
  `board.read` with `open` set. This is acceptable, and rare: it needs more
  than 256 KiB of must-reply posts, about four maximum-size posts of 4-byte
  characters.
- **The owner's `lgtm client wait`** on an agent that asked the owner a
  board question does not end until the owner answers from another door.
  The `board.post` alert covers this, so it is not filed.
- **Switching the board back on** after it was off makes the reactor resume
  from its recorded sequence and write late resolutions, for example `gone`
  for a crash that was long ago followed by a resume. The rule is
  consistent with "judged when it happens", and row 62's re-read makes it
  safe. The plan could state it in one sentence.
- **The dispatcher race is still sound.** The reservation re-reads the
  queue inside `log.transact` and writes `DeliverySent` before calling the
  runner (`deliveries.ts:239-252`).
- **Anchors checked at `8ff4c9b`:** `holders.ts:21`, `waits.ts:33-45`,
  `waits.ts:55`, `waits.ts:83`, `deliveries.ts:61-68`, `deliveries.ts:130-134`,
  `stateMachine.ts:56-58`, `stateMachine.ts:102`, `apply.ts:284-292`,
  `restart.ts:118-159` and `CommandHandler.ts:153-157` all resolve as cited.
