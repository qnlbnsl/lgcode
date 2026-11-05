revise
Grade: 6  B/M/m: 0/4/8  Flags: none

# Plan review, round 4: shepherd-message-board, lens: logic and failure policy

I reviewed plan version 5 (`plan.md`), contract version 6 (`contract.md`),
`decisions.md` rows 84 to 101, the client API contract version 3 (its
section 3, "Waiting", and section 6, edits E1 to E22), the rulings file,
and the engine at commit `8ff4c9b`. Every engine claim below was checked at
that commit. "Clause 3" means the third hold-unsettled clause
(`plan.md:628-631`). "Edge rule" means a reactor rule written as "on event
X, do Y". "Level rule" means a rule written as "while state S holds, make
it right".

## Summary

The rework under ruling L26 kept every board rule. I diffed plan version 4
against version 5, and the removed text is seam wording, paths and package
names only. The round 3 answers hold as rules. The engine-change table is
mostly accurate, with two anchor gaps (minors m2 and m3).

Four majors remain. Each comes from rules that are correct one by one but
fail together:

- The owner's wait helper re-reads the board's condition results only after
  board events. Both conditions change on engine events that carry no board
  event. So the owner's wait ends early in the very window clause 3 was
  written for, and it hangs after the most common flow, an answered
  question.
- Clause 3 holds an addressee "not settled" while no wake carries its
  question, but nothing ever queues a wake for that state. A post left out
  by the byte cap therefore stays undelivered, and every wait on its
  addressee stalls.
- The reactor's progress is not durable. The view lists "the reactor's last
  handled sequence", but none of the eight board events writes it, and most
  reactor rules are edge rules with no state form for the catch-up.
- The manager seat moves for good on a crash, which the engine treats as
  recoverable. That move adds a member on a crash, against row 84. It also
  lets every member of the channel wake the inheriting ancestor, and it
  strips the opener's manager rights after a crash that lasts seconds.

There are no blockers.

## Truth table: which rule acts on each state, and whether anything repairs it

"Engine" is `settled` (`packages/engine/src/routing/waits.ts:39-45`).
"Board" is the board's hold-unsettled entry (B6). "Owner helper" is
`waitForAgents` as row 89 (4) defines it. "Repair" is the rule that moves
the state on without a person.

| State of addressee A, or of author L | Engine | Board | Owner helper | Repair |
|---|---|---|---|---|
| A's wake queued | not settled (queued delivery) | false | not settled | Dispatcher sends it |
| A's wake returned, reactor has not yet re-queued | settled (idle, nothing pending; `deliveries.ts:130-134`) | true (clause 3) | **settled**: its last summary predates the return, and the return batch holds no board event | Reactor edge rule (`plan.md:600-606`) |
| Same, and the service stops before the reactor writes | settled | true | settled | **None**: edge rule lost (M3) |
| A's wake accepted; A ended its turn without replying | settled | false (row 90) | settled | None needed (asker waits) |
| A's question left out by the byte cap; A ended its turn | settled | true (clause 3) | true, and correct | **None**: the idle rule covers completions only (M2) |
| Same, and A read it with `board.read incoming` but has not answered | settled | true (a page is not an accepted wake) | true | **None**, and row 90 says such an agent is settled (M2) |
| L's question closed; completion wake accepted; L idle | settled | false | **not settled**: its last summary predates the accept (M1) | Only an unrelated later board event |
| L's completion returned twice | settled | false ("failed twice") | depends on the last summary | `board.flush` by hand |
| L's channel manager seat moved on L's crash; L resumed | n/a | n/a | n/a | **Never**: rights do not return (M4) |
| L stopped, then `resume --fresh` | n/a | n/a | n/a | Group membership returns with no join event (m5) |

## Findings

### M1. MAJOR. The owner's wait helper uses board results that go stale on engine events, so it ends early in the return window and hangs after a completion is accepted

- **Category:** Bug (timing). Logic: whether a failure permits or denies,
  and two readers of one rule that disagree.
- **The rules:** The helper "reads the results from the section, then,
  after each board event, re-reads the waited agents' `board.status`
  summaries, ignoring any summary computed at an older sequence than one it
  has already seen" (`contract.md:369-372`; row 89 (4); criterion 5.9,
  `plan.md:692`). The engine computes the board's conditions from the full
  view, projected with every batch (`waits.ts:110-120`).
- **What changes them without a board event:**
  - A return. `failed` writes only `DeliveryReturned` and `StateChanged`
    idle (`packages/engine/src/routing/deliveries.ts:130-134`). That makes
    clause 3 true.
  - An accept. `accepted` writes only `DeliveryAccepted`
    (`deliveries.ts:104-107`). That discharges a completion, so clause 2
    becomes false.
  - A send-time withdrawal under edit E18 writes only `DeliveryWithdrawn`.
    That can make clause 3 true.
- **Scenario A, an early end (wrong permit):** The owner runs `shephrd
  client wait A`. A's board wake is queued. The helper's last summary for
  A says "board: false", because a wake is queued, and the engine part says
  "not settled". The wake is sent, and the harness returns it. The batch
  holds `DeliveryReturned` and `StateChanged` idle, and no board event. The
  helper's engine part now says "settled". Its board part is the stale
  "false". The helper ends the wait. The engine's own `wait` on A does not
  end, because clause 3 holds in the projected view. That breaks the client
  API's promise that the owner's wait and an agent's wait agree (lead
  ruling L15; client API contract, section 3, "Waiting"). It is also the
  exact window that row 69 (8) and row 90 added clause 3 to close.
- **Scenario B, a hang (wrong deny):** Lead L asks W a question. W replies.
  The batch closes the post and queues L's completion wake. The helper
  re-reads, and L's summary says "board: true" (owed completion). The wake
  is sent and accepted, L's turn runs, and L goes idle. None of those
  events is a board event. The helper keeps the stale "true" and does not
  end. It ends only when some unrelated board event happens. When the
  owner waits at the end of a piece of work, there may be none.
- **Root cause:** The client API contract says each piece's condition is "a
  pure function over its own snapshot section" (section 3, "Waiting"). The
  board's conditions are functions of the full view (row 101, ruling L28),
  and the section carries only their results at one sequence. A result at
  one sequence cannot be advanced from the stream.
- **Evidence:** `contract.md:366-372`; `plan.md:692`; `decisions.md` row 89;
  `deliveries.ts:104-107`, `:130-134`; `waits.ts:39-45`.
- **Suggested fix:** Let the helper never conclude "settled" on a stale
  board result. Before it ends a wait, it reads each candidate agent's
  `board.status` and accepts the summary only if the summary's sequence is
  at least the last sequence the helper has applied from the stream. If a
  new event arrives meanwhile, it tries again. Re-reading after board
  events can stay as an optimisation. Add two cases to criterion 5.9: a
  return with no board event in its batch does not end the owner's wait,
  and an accepted completion ends it with no later board event.
- **Risk score:** severity 4 (the owner's wait is wrong until another event
  arrives, or ends while an answer is still owed) × fallout 3 (the owner
  re-runs it) × probability 8 (scenario B follows every answered question)
  = **96, schedule**.

### M2. MAJOR. Clause 3 holds an addressee "not settled" while no wake carries its question, but nothing ever queues one, so a post left out by the byte cap is never delivered

- **Category:** Bug (failures). Logic: durable repair.
- **The rules:** A wake carries "every must-reply post" within 256 KiB.
  Posts past the cap "stay open and unread", and the body ends with "N more
  posts need your reply; run board.read with incoming set"
  (`plan.md:521-527`; `contract.md:289-297`). Row 90 says clause 3
  "covers ... a post left out by the byte cap". The reactor's only "idle"
  rule queues a wake for owed completions (`plan.md:598-599`). The return
  rule and the send-time rule are edge rules on other events
  (`plan.md:600-609`).
- **Scenario:** Five workers each ask lead L a long question. L's wake
  carries three. L answers those three, does not run `board.read`, and ends
  its turn. Clause 3 now holds for the two left-out questions: no wake
  carries them, and none was accepted. No rule queues a wake for them,
  because L has no owed completion and no new post arrives. L stays "not
  settled" forever. L's parent's `wait` on L never ends. The two askers
  wait forever on their own open posts.
- **A second gap in the same clause:** If L does run `board.read` with
  `incoming` and reads the two questions, clause 3 still holds, because a
  page is not an accepted wake. Row 90's principle is that an addressee
  that received its question and ended its turn is settled. Reading it
  through `board.read` is receiving it.
- **Why the plan cannot rely on a person:** `board.flush` repairs this, but
  only the owner or a service may call it. The sheepdog does not exist yet.
- **Evidence:** `plan.md:521-527`, `:598-609`, `:625-631`;
  `contract.md:289-297`, `:355-360`; `decisions.md` rows 80 and 90.
- **Suggested fix:** Make clause 3 repair itself with one level rule in the
  reactor. While an agent is idle, holds an open must-reply post with no
  disposition, and no queued, sent or accepted board wake carries that
  post to it, and the post's return count for that agent is below two,
  queue one wake. That one rule also covers a lost return re-queue and a
  lost send-time rebuild (M3). In clause 3, count a post the addressee has
  read (its read state) the same as an accepted wake. Add a criterion: a
  question left out by the cap reaches its addressee with no new post and
  no `board.flush`.
- **Risk score:** severity 6 (a team stalls until fixed by hand) ×
  fallout 3 × probability 4 (a burst of long questions to one agent) =
  **72, schedule**.

### M3. MAJOR. The reactor's progress is not durable: no event records its position, and its edge rules have no state form for the catch-up

- **Category:** Bug (failures). Logic: durable repair and enforcement
  lifecycle.
- **The rules:** The view holds "the reactor's last handled sequence"
  (`plan.md:445-446`). The client API contract says a reactor "records the
  last sequence it handled in its own view, so after a restart it resumes
  from there" (section 1, "Views and reactors"). The plan says the start-up
  catch-up "applies the same rules to the state it finds"
  (`plan.md:582-583`).
- **The gaps:**
  - No writer. The view is a fold of the log, and the fold reads the eight
    board events plus five engine events (criterion 2.1, `plan.md:457`).
    None of the eight events carries a handled position
    (criterion 1.2, `plan.md:399`). A handler that decides to write nothing
    cannot advance any position either.
  - The engine's reactors keep no position. They follow an in-memory
    `PubSub` (`packages/engine/src/log/EventLog.ts:286`;
    `accounts/available.ts:76-90`; `routing/deliveries.ts:294-328`).
    Restart recovery has its own catch-up for each, such as step 8
    re-reading `AccountAvailable` from the log
    (`recovery/restart.ts:236-243`).
  - Edge rules. These are written as "on event X": the return re-queue and
    the "undeliverable" count (`plan.md:600-606`); the send-time rebuild
    (`plan.md:607-609`); the membership rules, "a leaving author's posts
    are withdrawn" and "a leaving addressee is `removed`"
    (`plan.md:613-618`); and the end of a direct grant
    (`plan.md:619-621`). "The same rules applied to the state" is not
    defined for them.
  - Failure policy. A reactor batch can be refused by the engine: by edit
    E17, by E18 at queue time, or by the state table. The engine's own
    reactor logs a failed write and moves on (`available.ts:86-88`). The
    plan does not say whether the board's reactor retries, skips, or stops.
- **Scenarios:**
  1. A wake is returned. The service stops before the reactor re-queues
     it. After the restart, the addressee is in M2's stuck state.
  2. The owner removes author L from plain channel C. The reactor's write
     is refused, or the service stops first. L's open post in C is never
     withdrawn, and L is never owed its completion. L stays "not settled"
     on a post in a channel it can no longer read.
  3. The board is switched off for a day, and the reactor stops (row 58).
     A direct grant ends during that day. When the board is switched back
     on, nothing resolves the grant's open questions.
- **Evidence:** `plan.md:445-446`, `:457`, `:399`, `:578-623`;
  `EventLog.ts:286`; `available.ts:76-90`; `restart.ts:236-243`;
  `contract.md:477-486`.
- **Suggested fix:** Write every reactor rule as a level rule over the
  board view and the engine views, so the reactor can run all of them on
  any snapshot. Some examples:
  - "an addressee with no disposition that is not a member: `removed`";
  - "an open post whose agent author is not a member and is not crashed:
    `withdrawn`";
  - "an open must-reply post in a direct channel whose grant fails:
    `removed`";
  - M2's re-queue rule, with return counts read from the view.

  The catch-up then needs no position, and a refused or lost batch is
  repaired by the next run. Run the rules after each batch, at start-up,
  and when the board is switched on. Drop "last handled sequence" from the
  view, or name the event that writes it. Add a post-build check that kills
  the service between each triggering commit and the reactor's write.
- **Risk score:** severity 6 (a question never ends until fixed by hand) ×
  fallout 3 × probability 4 (one stop at a bad moment, a refused batch, or
  one use of the off switch) = **72, schedule**.

### M4. MAJOR. The manager seat moves for good on a crash, the engine's recoverable failure. A crash then adds a member, widens who may wake the new manager, and strips the opener's rights

- **Category:** Design. Logic: interacting rules, and an irreversible
  action on a recoverable failure. This is a consequence of the round 3
  answer (row 85), not a re-filing. Row 85 holds against lead ruling L18.
  The consequences below are not addressed.
- **The rules:** The manager "changes only when the current manager stops
  or crashes"; the new manager "becomes a member"; rights "never return"
  (`contract.md:75-81`; `plan.md:113-114`, `:595-597`; criterion 2.5,
  `plan.md:461`). Row 84 says: "A crash, an interrupt, a pause or a resume
  changes no one's membership in any channel." The plan's overview says
  group membership "never changes when an agent pauses, crashes or is
  resumed" (`plan.md:110-113`).
- **The engine treats a crash as recoverable.** A crash notifies the holder
  (`packages/engine/src/recovery/crash.ts:51-79`). A crashed agent may be
  resumed (`packages/contracts/src/stateMachine.ts:57`, `:69`). The lead's
  crash rule is one automatic resume plus a carry-on prompt (rulings file).
- **Consequences:**
  1. **A contradiction.** Row 84 says a crash changes no one's membership.
     Row 85 and criterion 2.6 (`plan.md:462`, "when the manager crashes,
     the inheriting manager joins") say a crash adds a member.
  2. **Reach widens on a crash.** Lead L, which manages and anchors group
     channel G, crashes for seconds. Its parent P becomes the manager and a
     member of G. Every worker in G now shares a channel with P. So each
     worker can post in G with `to: [P]` and a reply mode, which wakes P;
     rule 4 passes, because P is an ancestor. Each worker can also open a
     direct channel with P. Before the crash, none of them could wake P.
     Over a long run, the root agent joins every channel whose manager ever
     crashed. Its wakes then carry those channels' unread posts that need
     no reply, up to 20 per wake (`contract.md:291-294`). That is a cost
     the board exists to avoid.
  3. **The opener loses its rights.** After a crash that lasted seconds, L
     can no longer use `board.members` on its own plain channel, so it
     cannot add the next worker it starts. It also loses manager
     `board.close`.
  4. **A plain channel's opener may lose membership.** Row 85 keeps the
     anchor a member of a group channel. Nothing says a plain channel's
     opener is an explicit member from `board.ChannelOpened`. If its
     membership comes only from being manager, a crash removes it from its
     own channel.
- **Evidence:** `contract.md:75-84`, `:97-100`; `plan.md:110-114`, `:461-462`,
  `:595-597`; `decisions.md` rows 84 and 85; `crash.ts:51-79`;
  `stateMachine.ts:57`, `:69`.
- **Suggested fix:** Move the manager seat only on a stop. While the
  manager is crashed, or interrupted and unable to reload, let the owner
  and the manager's nearest ancestor that is not stopped or crashed, by
  `parent` links, use manager-only commands as an acting manager. That
  grants rights only, never membership. It reads lifecycle state, not
  pause or account state, so L18 is kept. State that a plain channel's
  opener is an explicit member from `board.ChannelOpened`. If the seat must
  move on a crash, then say that the inheritor manages without joining, and
  correct row 84, the overview and criterion 2.6 to match. These are the
  lead's rulings L21 and L24, so the choice goes to the lead.
- **Risk score:** severity 4 (wrong rights and extra wake cost, which the
  owner can repair by hand) × fallout 3 × probability 6 (any crash of a
  channel manager) = **72, schedule**.

### m1. MINOR. A return after an accept re-queues without limit, so a post whose turn keeps failing after acceptance burns a turn on every cycle

- **Category:** Bug (failures).
- **The rule:** "A return after an accept re-queues only open must-reply
  posts and counts toward nothing" (`plan.md:376-377`, `:604-606`;
  row 91). The engine's own rule is the opposite: "An accepted delivery is
  not put back in the queue" (`deliveries.ts:127-129`).
- **Scenario:** A post's text makes the provider stop the turn with an
  unclassified error after it has started streaming. Each cycle is the
  same: queue, send, accept, error, return, re-queue. Nothing counts the
  cycles, so the loop never ends, and each cycle costs a full turn.
- **Suggested fix:** Count returns after an accept per post and target,
  and stop re-queuing after one. Alternatively, follow the engine and
  re-queue nothing after an accept.
- **Risk score:** 4 × 3 × 2 = **24, record**.

### m2. MINOR. Engine change B2 omits the lifecycle event table, which every board event tag must join for the contracts package to compile

- **Category:** Design (an incomplete engine-change table).
- **Evidence:** `eventTable` is typed `Record<Event["_tag"], Record<StateName,
  EventEffect>>` (`packages/contracts/src/stateMachine.ts:79`). Edit E5
  adds the board's eight tags to `Event`, so the table needs eight entries.
  B2 lists `events.ts`, `board/events.ts` and `visibility.ts` only
  (`plan.md:325`). The `board/contracts` scope does not cover
  `stateMachine.ts` (`plan.md:883-886`). The existing test
  `packages/contracts/test/state-machine.test.ts:285-345` walks every
  member of `Event` and expects `keep` for any tag it does not list. So it
  keeps its expectations only if every board entry is "keep" in every
  state.
- **Suggested fix:** Add `stateMachine.ts` to B2 and to the scope, with
  every board tag "keep" in all seven states. Name
  `state-machine.test.ts` as a test that keeps its expectations. The same
  gap exists in edit E5, which is for the client API's lead.
- **Risk score:** 1 × 1 × 10 = **10, record** (a build failure caught at
  once).

### m3. MINOR. Engine change B8's anchor is wrong: the engine's reactors are started in the command handler's layer, not in `service.ts`

- **Evidence:** B8 and task 3b.3 say "today `packages/engine/src/service.ts`,
  `program`" (`plan.md:331`, `:656`). `program` starts no reactor
  (`packages/engine/src/service.ts:45-120`). The dispatcher and the account
  follower are started at
  `packages/engine/src/commands/CommandHandler.ts:177-179`.
- **Suggested fix:** Cite `CommandHandler.ts:177-179`, or the place where
  unit 1a moves them. Add that file to the `board/backend` scope.
- **Risk score:** 1 × 1 × 10 = **10, record**.

### m4. MINOR. With the board switched off, the owner's wait helper loses its input, and the owner's wait and an agent's wait can disagree

- **Category:** Bug (failures).
- **The rules:** When the board is off, "every board command is refused",
  including `board.status`, and "the reactor and conditions stop"
  (criterion 5.10, `plan.md:693`; `contract.md:444-445`, `:477-486`). The
  owner's helper re-reads `board.status` (row 89 (4)). The plan does not
  say what the snapshot section reports while the board is off.
- **Consequence:** The helper's re-read fails, so it errors or hangs. If
  the section still lists agents for which a condition held, the owner's
  wait holds while the engine's does not.
- **Suggested fix:** While the board is off, the section carries a
  `disabled` mark and empty condition lists, and the helper treats the
  board as holding nothing. Alternatively, keep `board.status` readable
  while the board is off. Add the case to criterion 5.10.
- **Risk score:** 4 × 3 × 2 = **24, record**.

### m5. MINOR. A stopped agent can be resumed, but the board treats a stop as permanent: it rejoins group channels with no join event

- **Category:** Bug (numbers).
- **Evidence:** `resume` is allowed from `stopped`, and `stopped` may
  become `starting` (`stateMachine.ts:58`, `:70`). `resume --fresh` skips
  the reload check (`packages/engine/src/commands/resume.ts:23`) and writes
  only `StateChanged` to `starting` (`resume.ts:26`). Group membership is
  "label carriers that are not stopped" (`plan.md:448-450`), so the agent
  rejoins at once. Row 79 starts read state at "the `AgentStarted` or
  `AgentGrouped` that first makes it a member". The reactor's membership
  rules fire only on those events and on `board.ManagerChanged`
  (`plan.md:613-617`).
- **Consequence:** The agent's read position after it rejoins is
  undefined. If it keeps its old watermark, its next wake carries up to 20
  posts written while it was stopped. No rule says whether a stop removes
  the agent from its plain channels.
- **Suggested fix:** Treat a change from `stopped` to `starting` as a join
  for group channels, with the watermark at the last post. State whether a
  stop removes the agent from its plain channels. Add the case to
  criterion 2.6.
- **Risk score:** 2 × 3 × 4 = **24, record**.

### m6. MINOR. A rebuilt wake can carry completions that were already discharged, after `resume --fresh` re-queues an accepted wake

- **Category:** Bug (numbers).
- **Evidence:** `resume --fresh` re-queues every delivery accepted since
  the last turn end (`resume.ts:28-35`). That includes a board wake whose
  completions were discharged when it was accepted. The cleanup rule
  queues a replacement "whenever the wake still carries a completion"
  (`plan.md:383-384`; `contract.md:320-322`). That can be read as
  "whatever `board.WakeBuilt` named".
- **Consequence:** A closed post's notice is sent twice, which costs a
  turn.
- **Suggested fix:** Build every replacement from current duties only:
  completions still owed, and open must-reply posts where the target has
  no disposition.
- **Risk score:** 2 × 3 × 4 = **24, record**.

### m7. MINOR. A send-time withdrawal is written without the engine's wait checks, so a wait on its target can stay open with nothing to re-check it

- **Category:** Bug (timing). The owner is the client API's unit 1b; the
  board depends on it.
- **Evidence:** The dispatcher appends `DeliverySent` without
  `withWaitChecks` (`deliveries.ts:248-250`). Edit E18 adds the withdrawal
  to that send transaction and does not mention the wait checks. If the
  withdrawn wake carried only posts that need no reply, the reactor has
  nothing to rebuild and writes nothing (`contract.md:164-170`). The
  target is then idle with nothing queued, and no batch re-checks the
  parent's open `wait` on it.
- **Suggested fix:** Ask the lead that edit E18's withdrawal batch run the
  wait checks, as `failed` does (`deliveries.ts:259`). Add a criterion to
  4.9: the parent's wait ends in the withdrawal's batch.
- **Risk score:** 4 × 3 × 2 = **24, record**.

### m8. MINOR. Row 95's rule that a stop drops owed completions has no writer in the view

- **Category:** Design.
- **Evidence:** Criterion 2.1 says the fold reads board events,
  `DeliveryAccepted` and `DeliveryReturned` for board wakes, `AgentStarted`
  and `AgentGrouped`, "and ignores every other event" (`plan.md:457`).
  Dropping completions on a stop (`plan.md:593-594`, `:378`; row 95) needs
  either `AgentStopped` in the fold or a board event that records the
  drop. None of the eight events is named for it.
- **Suggested fix:** Add `AgentStopped` to criterion 2.1's fold list, or
  name the board event that the reactor writes for the drop.
- **Risk score:** 2 × 1 × 6 = **12, record**.

## Round 3 answers checked

| Round 3 finding | Answer | Holds? |
|---|---|---|
| M1, R3-L1: a crash counted as leaving | Row 84 | Yes for label carriers. Row 85's manager-on-crash join contradicts row 84 (M4). |
| M2, T3-2: the manager seat followed availability | Row 85 | Yes against L18. Its consequences are not addressed (M4). |
| M3, T3-1: the reach check could not tell which wake it judged | Row 86; edit E18 at `876bf4f` | Yes. E18 passes the delivery id and source, and projects the queue-time snapshot with the batch. |
| M4: clause 3 was too wide | Row 90 | Yes for an accepted wake. It now holds with no repair for byte-cap leftovers, and it ignores reading through `board.read` (M2). |
| m1: a return after an accept | Row 91 | Yes as a rule. The retry is unbounded (m1). |
| m2: completions that failed twice | Row 92 | Yes |
| m3: late replies | Row 93 | Yes |
| m4: the next delivery waits after a send-time withdrawal | E18, "goes on to the target's next queued delivery" | Yes. Wait checks are not mentioned (m7). |
| m5: a service as an addressee | Row 94 | Yes |
| m6: completions owed to a stopped agent | Row 95 | The rule holds. The view has no writer for it (m8). |
| R3-L2, R3-A1: the completion's size | Row 88 | Yes |
| R3-L3, R3-A2: the bounded fallback replies | Row 89 | The sizes hold. The helper's re-read trigger is wrong (M1). |

The rework (rows 99 to 101) dropped no board rule. No known gap is wrongly
scoped. Known gap 9 is evidence only and needs no change.

## The engine-change table, checked at `8ff4c9b`

| Change | Claim about what the engine does now | Checked |
|---|---|---|
| B1 | Merges into `CommandsRpcGroup`; agents get seven tools | Today's tool list is an explicit allow-list (`packages/mcp/src/tools.ts:6-12`). Edit E2 replaces it; B1 depends on E2. |
| B2 | No engine view reads a board tag | True for the reducers (`views/apply.ts:338-354`). The event table at `stateMachine.ts:79` is missing (m2). |
| B3 | The views state gains a field; the four named test files gain it | True. No other test builds a full `State` literal. |
| B4, B5 | `deliveries.test.ts` and `carry-on-dispatch.test.ts` keep their expectations | Plausible. `returnTo` already writes only `DeliveryReturned` for a sender that is not an agent (`deliveries.ts:45-47`). |
| B6 | `settled` changes only when board state exists | True. `settled` and `reasonOf` read only the views (`waits.ts:39-58`). The owner's helper disagrees with it (M1). |
| B7 | A blocking wait ends with "request held", as for `holds` | True. It sits beside `waits.ts:83`. |
| B8 | The reactor joins `service.ts`, `program` | Wrong anchor (m3) |
| B9 | Reads, snapshot entry, switch | New code. The switch's effect on the helper is open (m4). |

## Proposed post-build checks

| Id | Scenario | Expected result | Evidence needed | Area |
|---|---|---|---|---|
| L4-PB1 | Run `shephrd client wait` on an addressee whose board wake is returned, and on an author whose completion is accepted, with no other board activity | The first wait does not end before the re-queue is accepted. The second ends right after the author's turn. Each result equals the engine's own `wait` at the same sequence. | Both waits' results with their sequences, from one test | board/backend and the client library |
| L4-PB2 | Kill the service between each triggering commit and the reactor's write: a return, a member removal, the end of a direct grant, and a send-time withdrawal | After restart, each duty is done once | The board view before and after, and the events of the reactor's catch-up | board/backend |
| L4-PB3 | Make a reactor batch be refused by edit E17 or E18 | The duty is retried on the next run and never dropped | Reactor log and events | board/backend |
| L4-PB4 | Five long questions to one agent, so two are left out. The agent answers three and ends its turn. | The two left-out questions reach it with no new post and no `board.flush` | Deliveries and `board.WakeBuilt` | board/backend |
| L4-PB5 | Stop an agent, then `resume --fresh` it, in a group channel and a plain channel | Membership and read position follow the stated rule, and its first wake carries no post from before its rejoin | View and wake body | board/backend |
| L4-PB6 | `resume --fresh` re-queues an accepted board wake, then a carried post closes | The replacement carries no completion that was already discharged | `board.WakeBuilt` and the deliveries | board/backend |
| L4-PB7 | A send-time withdrawal leaves its target idle with nothing to rebuild, while the parent's wait is open | The wait ends in the withdrawal's batch | The batch's events | client API unit 1b |

## Noted, not filed

- Row 101 is still marked "open". Lead ruling L28 already settles it:
  views and conditions live in `packages/contracts/src/<namespace>/`.
- Edits E19 and E20 in the client API contract describe the board's
  entries more narrowly than B6 and B7 do. E19 names only "an open post of
  its own". The board writes its own entries, so this is a wording gap for
  the client API's lead, not a board defect.
- Manager succession picks "the nearest ancestor that is not stopped or
  crashed". That can be an agent interrupted with a session that cannot
  reload, which may never act again. The owner can still manage the
  channel. M4's fix covers this case if the acting manager also skips such
  an agent.
- A board wake's `DeliveryQueued` has no top-level `agentId`, so the log
  stores no agent for it (`EventLog.ts:175`), and agents do not see it
  through `subscribe`. Its `PromptSent` does carry `agentId`, so the
  target and its parent see the text, as row 55 states.
- Rows I noted in round 3 still stand as product choices: any reply from
  the owner closes a post, and the incoming condition refuses every
  blocking wait of an addressee whoever asked it.

## Risk register

| Id | Description | Severity | Fallout | Probability | Score and band | Evidence | Owner |
|---|---|---|---|---|---|---|---|
| M1 | The owner's wait helper uses stale board results | 4: wrong until another event | 3: the owner re-runs it | 8: after every answered question | 96, schedule | Confirmed by reading | board 4 and the client library |
| M2 | Clause 3 has no repair; byte-cap leftovers are never delivered | 6: stall until fixed by hand | 3 | 4: a burst of long questions | 72, schedule | Confirmed by reading | board 3b |
| M3 | Reactor progress is not durable; edge rules are lost | 6 | 3 | 4: a stop, a refusal, or the off switch | 72, schedule | Confirmed by reading | board 3b and 3c |
| M4 | The manager seat moves for good on a recoverable crash | 4: wrong rights and extra cost | 3 | 6: any crash of a manager | 72, schedule | Confirmed by reading | board 2b and 3b; lead |
| m1 | Unbounded re-queue after accept | 4 | 3 | 2 | 24, record | Confirmed | board 3b |
| m4 | The off switch breaks the owner's helper | 4 | 3 | 2 | 24, record | Confirmed | board 4 |
| m5 | A stopped and resumed agent rejoins with no join | 2 | 3 | 4 | 24, record | Confirmed | board 2a and 3c |
| m6 | Rebuilds may resend discharged completions | 2 | 3 | 4 | 24, record | Unresolved: the wording is ambiguous | board 3a |
| m7 | Send-time withdrawal without wait checks | 4 | 3 | 2 | 24, record | Confirmed | client API unit 1b |
| m8 | No writer for row 95's drop | 2 | 1 | 6 | 12, record | Confirmed | board 2a |
| m2 | B2 omits `stateMachine.ts` | 1 | 1 | 10 | 10, record | Confirmed | board 1 |
| m3 | B8's anchor is wrong | 1 | 1 | 10 | 10, record | Confirmed | board 3b |

## Report line

Logic and failure policy, round 4: revise. 0 blockers, 4 majors, 8 minors.
No refusals.
